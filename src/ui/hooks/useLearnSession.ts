import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_CURRICULUM_CONFIG } from "../../content/curriculum-data.ts";
import {
  checkpointReadiness,
  createInitialState,
  newestCharacter,
  unlockedCharacters,
  type CurriculumState,
  type Readiness,
} from "../../core/curriculum.ts";
import { encodeText, isSupportedCharacter } from "../../core/morse.ts";
import { createRng } from "../../core/rng.ts";
import { recommendedContinuousCopyDurationMs } from "../../core/settings.ts";
import type { CharacterProgress } from "../../core/types.ts";
import {
  applyCheckpoint,
  CheckpointSession,
  type CheckpointApplied,
} from "../../training/checkpoint.ts";
import {
  LearnSession,
  type LessonEvent,
  type LessonNotification,
  type LessonTransition,
  type SessionSummary,
} from "../../training/learn-session.ts";
import type { PlannedExercise } from "../../training/lesson-plan.ts";
import { useLearnAudio } from "../learn-audio-context.ts";
import { useSettings } from "../settings-context.ts";
import { useContinuousCopy } from "./useContinuousCopy.ts";

const CURRICULUM_STORAGE_KEY = "k1frx.curriculum.v2";
const INTRODUCED_STORAGE_KEY = "k1frx.introduced.v1";

// Brief holds (ms). Introductions and misses are otherwise paced by audio.
const INTRO_REPEAT_GAP_MS = 700;
const INTRO_READY_HOLD_MS = 900;
const HOLD_AFTER_CORRECT = 450;
const HOLD_AFTER_MISS = 500;

export type LearnPhase =
  "onboarding" | "exercise" | "summary" | "checkpoint" | "checkpoint-result";

export type Feedback = {
  correct: boolean;
  expected: string;
  morse: string;
};

export type IntroStage = "first-play" | "repeat-gap" | "second-play" | "ready";

type QueuedSubmission = {
  token: number;
  kind: "automatic" | "explicit";
};

type PendingIntroDelay = {
  timeoutId: number;
  resolve: (completed: boolean) => void;
};

function loadCurriculum(): CurriculumState {
  try {
    const raw = localStorage.getItem(CURRICULUM_STORAGE_KEY);
    if (raw) {
      const characters = JSON.parse(raw) as CharacterProgress[];
      if (Array.isArray(characters) && characters.length >= 2) {
        return { config: DEFAULT_CURRICULUM_CONFIG, characters };
      }
    }
  } catch {
    // Ignore malformed storage; start fresh.
  }
  return createInitialState(DEFAULT_CURRICULUM_CONFIG);
}

function saveCurriculum(state: CurriculumState): void {
  try {
    localStorage.setItem(
      CURRICULUM_STORAGE_KEY,
      JSON.stringify(state.characters),
    );
  } catch {
    // Best-effort until the storage milestone.
  }
}

function loadIntroduced(): string[] {
  try {
    const raw = localStorage.getItem(INTRODUCED_STORAGE_KEY);
    if (raw) {
      const chars = JSON.parse(raw) as string[];
      if (Array.isArray(chars)) return chars;
    }
  } catch {
    // Ignore malformed storage.
  }
  return [];
}

function saveIntroduced(chars: string[]): void {
  try {
    localStorage.setItem(
      INTRODUCED_STORAGE_KEY,
      JSON.stringify([...new Set(chars)]),
    );
  } catch {
    // Best-effort.
  }
}

function toMorse(target: string): string {
  return encodeText(target)
    .map((entry) => entry.pattern)
    .join(" ");
}

function firstSupported(raw: string): string | undefined {
  for (const char of raw.toUpperCase()) {
    if (isSupportedCharacter(char)) return char;
  }
  return undefined;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export function useLearnSession() {
  const { settings } = useSettings();
  const audio = useLearnAudio();
  const auto = settings.pacing === "auto";

  const stateRef = useRef<CurriculumState>(
    undefined as unknown as CurriculumState,
  );
  if (!stateRef.current) {
    stateRef.current = loadCurriculum();
  }
  const sessionRef = useRef<LearnSession | undefined>(undefined);
  const checkpointRef = useRef<CheckpointSession | undefined>(undefined);

  // Flow tokens invalidate stale async transitions; the one-shot lock guarantees
  // exactly one accepted answer per presented prompt.
  const flowToken = useRef(0);
  const lockedRef = useRef(true);
  const acceptedTokenRef = useRef<number | null>(null);
  const playingRef = useRef(false);
  const playbackGeneration = useRef(0);
  const heldKeysRef = useRef(new Set<string>());
  const heldKeysTokenRef = useRef<number | null>(null);
  const introDoneToken = useRef<number | null>(null);
  const introStageRef = useRef<IntroStage | undefined>(undefined);
  const introDelayRef = useRef<PendingIntroDelay | undefined>(undefined);
  const queuedSubmissionRef = useRef<QueuedSubmission | null>(null);
  const currentAnswerRef = useRef("");
  const flushQueuedSubmissionRef = useRef<(token: number) => void>(() => {});

  const [phase, setPhase] = useState<LearnPhase>("onboarding");
  const [exercise, setExercise] = useState<PlannedExercise | undefined>(
    undefined,
  );
  const [transition, setTransition] = useState<LessonTransition | undefined>(
    undefined,
  );
  const [notification, setNotification] = useState<
    LessonNotification | undefined
  >(undefined);
  const [phaseLabel, setPhaseLabel] = useState<string | undefined>(undefined);
  const exerciseRef = useRef<PlannedExercise | undefined>(undefined);
  exerciseRef.current = exercise;

  const [feedback, setFeedback] = useState<Feedback | undefined>(undefined);
  const [introStage, setIntroStage] = useState<IntroStage | undefined>(
    undefined,
  );
  const [awaitingContinue, setAwaitingContinue] = useState(false);
  const [summary, setSummary] = useState<SessionSummary | undefined>(undefined);
  const [checkpointResult, setCheckpointResult] = useState<
    CheckpointApplied | undefined
  >(undefined);
  const [inputReady, setInputReady] = useState(false);
  const [typingReady, setTypingReady] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [, forceTick] = useState(0);

  const recordContinuousCopy = useCallback(
    (typed: string, durationCompleted: number, abandoned: boolean) => {
      const session = sessionRef.current;
      if (!session) {
        throw new Error("continuous copy completed without a Learn session");
      }
      const result = session.completeContinuousCopy(
        typed,
        durationCompleted,
        abandoned,
      );
      saveCurriculum(stateRef.current);
      forceTick((value) => value + 1);
      return result;
    },
    [],
  );
  const continuousCopy = useContinuousCopy({
    audio,
    toneHz: settings.toneHz,
    onComplete: recordContinuousCopy,
  });

  const timing = useMemo(
    () => ({ charWpm: settings.charWpm, effectiveWpm: settings.effectiveWpm }),
    [settings.charWpm, settings.effectiveWpm],
  );

  const play = useCallback(
    async (text: string) => {
      const generation = ++playbackGeneration.current;
      playingRef.current = true;
      setIsPlaying(true);
      try {
        await audio.play(text, timing, { toneHz: settings.toneHz });
      } finally {
        if (generation === playbackGeneration.current) {
          playingRef.current = false;
          setIsPlaying(false);
        }
      }
    },
    [audio, timing, settings.toneHz],
  );

  // Group and word fields permit typing during playback, but every prompt
  // remains locked against grading until its audio completes.
  const presentPrompt = useCallback(
    async (target: string, token: number, typeBehind = false) => {
      lockedRef.current = true;
      setInputReady(false);
      setTypingReady(typeBehind);
      await play(target);
      if (token !== flowToken.current) return;
      lockedRef.current = false;
      setInputReady(true);
      flushQueuedSubmissionRef.current(token);
    },
    [play],
  );

  const advanceRef = useRef<() => void>(() => {});

  const updateIntroStage = useCallback((stage: IntroStage | undefined) => {
    introStageRef.current = stage;
    setIntroStage(stage);
  }, []);

  const cancelIntroDelay = useCallback(() => {
    const pending = introDelayRef.current;
    if (!pending) return;
    introDelayRef.current = undefined;
    window.clearTimeout(pending.timeoutId);
    pending.resolve(false);
  }, []);

  const waitForIntroDelay = useCallback(
    (ms: number): Promise<boolean> => {
      cancelIntroDelay();
      return new Promise((resolve) => {
        const timeoutId = window.setTimeout(() => {
          if (introDelayRef.current?.timeoutId === timeoutId) {
            introDelayRef.current = undefined;
          }
          resolve(true);
        }, ms);
        introDelayRef.current = { timeoutId, resolve };
      });
    },
    [cancelIntroDelay],
  );

  const nextFlowToken = useCallback(() => {
    cancelIntroDelay();
    return (flowToken.current += 1);
  }, [cancelIntroDelay]);

  const completeIntro = useCallback(
    (token: number) => {
      if (token !== flowToken.current || introStageRef.current !== "ready") {
        return;
      }
      if (introDoneToken.current === token) return;
      cancelIntroDelay();
      introDoneToken.current = token;
      sessionRef.current?.submit("");
      saveCurriculum(stateRef.current);
      advanceRef.current();
    },
    [cancelIntroDelay],
  );

  const clearHeldKeys = useCallback(() => {
    heldKeysRef.current.clear();
    heldKeysTokenRef.current = null;
  }, []);

  const bindHeldKeysToPrompt = useCallback((token: number) => {
    heldKeysRef.current.clear();
    heldKeysTokenRef.current = token;
  }, []);

  const runIntro = useCallback(
    async (target: string, token: number) => {
      lockedRef.current = true;
      setInputReady(false);
      setTypingReady(false);
      updateIntroStage("first-play");
      await play(target);
      if (token !== flowToken.current) return;
      updateIntroStage("repeat-gap");
      if (!(await waitForIntroDelay(INTRO_REPEAT_GAP_MS))) return;
      if (token !== flowToken.current) return;
      updateIntroStage("second-play");
      await play(target);
      if (token !== flowToken.current) return;
      updateIntroStage("ready");
      setAwaitingContinue(true);
      if (auto && (await waitForIntroDelay(INTRO_READY_HOLD_MS))) {
        completeIntro(token);
      }
    },
    [auto, play, completeIntro, updateIntroStage, waitForIntroDelay],
  );

  const endSession = useCallback(() => {
    continuousCopy.abandon();
    continuousCopy.reset();
    nextFlowToken();
    queuedSubmissionRef.current = null;
    currentAnswerRef.current = "";
    playbackGeneration.current += 1;
    clearHeldKeys();
    playingRef.current = false;
    setIsPlaying(false);
    void audio.cancelAndSuspend();
    const session = sessionRef.current;
    if (!session) return;
    setSummary(session.end());
    saveIntroduced([...loadIntroduced(), ...session.completedIntroductions]);
    saveCurriculum(stateRef.current);
    setExercise(undefined);
    setTransition(undefined);
    setNotification(undefined);
    setPhaseLabel(undefined);
    updateIntroStage(undefined);
    setPhase("summary");
  }, [audio, clearHeldKeys, continuousCopy, nextFlowToken, updateIntroStage]);

  const showEvent = useCallback(
    (event: LessonEvent) => {
      const token = nextFlowToken();
      acceptedTokenRef.current = null;
      queuedSubmissionRef.current = null;
      currentAnswerRef.current = "";
      lockedRef.current = true;
      setInputReady(false);
      setTypingReady(false);
      setFeedback(undefined);
      setAwaitingContinue(false);
      updateIntroStage(undefined);
      setPhaseLabel(sessionRef.current?.phaseLabel);
      if (event.type === "transition") {
        setExercise(undefined);
        setNotification(undefined);
        setTransition(event);
        return;
      }
      if (event.type === "notification") {
        setExercise(undefined);
        setTransition(undefined);
        setNotification(event);
        void delay(event.delayMs).then(() => {
          if (token !== flowToken.current) return;
          if (sessionRef.current?.continueNotification()) {
            advanceRef.current();
          }
        });
        return;
      }
      if (event.type === "continuous-copy") {
        clearHeldKeys();
        setExercise(undefined);
        setTransition(undefined);
        setNotification(undefined);
        continuousCopy.start(event);
        return;
      }
      setTransition(undefined);
      setNotification(undefined);
      setExercise(event);
      bindHeldKeysToPrompt(token);
      if (event.type === "introduce") void runIntro(event.target, token);
      else {
        void presentPrompt(
          event.target,
          token,
          event.type === "copy-group" || event.type === "copy-word",
        );
      }
    },
    [
      runIntro,
      presentPrompt,
      clearHeldKeys,
      continuousCopy,
      nextFlowToken,
      updateIntroStage,
      bindHeldKeysToPrompt,
    ],
  );

  const advance = useCallback(() => {
    const session = sessionRef.current;
    if (!session) return;
    const next = session.next();
    if (!next) {
      endSession();
      return;
    }
    showEvent(next);
  }, [endSession, showEvent]);
  advanceRef.current = advance;

  const begin = useCallback(async () => {
    continuousCopy.reset();
    clearHeldKeys();
    await audio.cancel();
    nextFlowToken();
    queuedSubmissionRef.current = null;
    currentAnswerRef.current = "";
    playbackGeneration.current += 1;
    playingRef.current = false;
    setIsPlaying(false);
    await audio.unlock();
    const session = new LearnSession({
      state: stateRef.current,
      rng: createRng(Date.now() >>> 0),
      introduced: loadIntroduced(),
      continuousCopyDurationMs: settings.continuousCopyDurationMs,
      continuousCopyTiming: timing,
    });
    session.start();
    sessionRef.current = session;
    introDoneToken.current = null;
    setSummary(undefined);
    setCheckpointResult(undefined);
    setPhase("exercise");
    const first = session.next();
    if (first) showEvent(first);
    else endSession();
  }, [
    audio,
    showEvent,
    endSession,
    clearHeldKeys,
    continuousCopy,
    nextFlowToken,
    settings.continuousCopyDurationMs,
    timing,
  ]);

  // Records the answer, replays on a miss, and advances only after any
  // corrective playback finishes and while this prompt is still current.
  const afterAnswer = useCallback(
    async (input: string, token: number) => {
      const session = sessionRef.current;
      const ex = exerciseRef.current;
      if (!session || !ex) return;
      const outcome = session.submit(input);
      saveCurriculum(stateRef.current);
      forceTick((n) => n + 1);
      setFeedback({
        correct: outcome.correct,
        expected: ex.target,
        morse: toMorse(ex.target),
      });
      if (!outcome.correct) {
        await play(ex.target);
        if (token !== flowToken.current) return;
      }
      if (auto) {
        await delay(outcome.correct ? HOLD_AFTER_CORRECT : HOLD_AFTER_MISS);
        if (token !== flowToken.current) return;
        advanceRef.current();
      } else {
        setAwaitingContinue(true);
      }
    },
    [auto, play],
  );

  // The single one-shot gate: returns the current token and locks, or null.
  const claimPrompt = useCallback((): number | null => {
    const token = flowToken.current;
    if (lockedRef.current) return null;
    if (acceptedTokenRef.current === token) return null;
    acceptedTokenRef.current = token;
    lockedRef.current = true;
    setInputReady(false);
    setTypingReady(false);
    return token;
  }, []);

  const acceptIsolated = useCallback(
    (raw: string) => {
      const ex = exerciseRef.current;
      if (!ex || ex.type !== "copy-character") return;
      const first = firstSupported(raw);
      if (!first) return;
      const token = claimPrompt();
      if (token === null) return;
      void afterAnswer(first, token);
    },
    [claimPrompt, afterAnswer],
  );

  const updateGroupWord = useCallback(
    (value: string) => {
      const ex = exerciseRef.current;
      if (!ex || (ex.type !== "copy-group" && ex.type !== "copy-word")) return;
      const token = flowToken.current;
      if (acceptedTokenRef.current === token) return;
      currentAnswerRef.current = value;
      if (ex.type !== "copy-group") return;

      if (value.length < ex.target.length) {
        if (
          queuedSubmissionRef.current?.token === token &&
          queuedSubmissionRef.current.kind === "automatic"
        ) {
          queuedSubmissionRef.current = null;
        }
        return;
      }

      if (lockedRef.current) {
        queuedSubmissionRef.current ??= { token, kind: "automatic" };
        return;
      }
      const claimedToken = claimPrompt();
      if (claimedToken !== null) {
        void afterAnswer(currentAnswerRef.current, claimedToken);
      }
    },
    [claimPrompt, afterAnswer],
  );

  const submitGroupWord = useCallback(
    (value: string) => {
      const ex = exerciseRef.current;
      if (!ex || (ex.type !== "copy-group" && ex.type !== "copy-word")) return;
      const token = flowToken.current;
      if (acceptedTokenRef.current === token) return;
      currentAnswerRef.current = value;
      if (lockedRef.current) {
        queuedSubmissionRef.current = { token, kind: "explicit" };
        return;
      }
      const claimedToken = claimPrompt();
      if (claimedToken !== null) {
        void afterAnswer(currentAnswerRef.current, claimedToken);
      }
    },
    [claimPrompt, afterAnswer],
  );

  const flushQueuedSubmission = useCallback(
    (token: number) => {
      const queued = queuedSubmissionRef.current;
      if (!queued || queued.token !== token) return;
      queuedSubmissionRef.current = null;
      const claimedToken = claimPrompt();
      if (claimedToken !== null) {
        void afterAnswer(currentAnswerRef.current, claimedToken);
      }
    },
    [claimPrompt, afterAnswer],
  );
  flushQueuedSubmissionRef.current = flushQueuedSubmission;

  const replay = useCallback(() => {
    const ex = exerciseRef.current;
    if (!ex) return;
    if (ex.type === "introduce") {
      if (introStageRef.current !== "ready" || playingRef.current) return;
      const token = flowToken.current;
      cancelIntroDelay();
      void play(ex.target).then(async () => {
        if (token !== flowToken.current) return;
        if (auto && (await waitForIntroDelay(INTRO_READY_HOLD_MS))) {
          completeIntro(token);
        }
      });
      return;
    }
    if (playingRef.current) return;
    const token = flowToken.current;
    lockedRef.current = true;
    setInputReady(false);
    setTypingReady(ex.type === "copy-group" || ex.type === "copy-word");
    sessionRef.current?.markReplayed();
    void play(ex.target).then(() => {
      if (token !== flowToken.current) return;
      lockedRef.current = false;
      setInputReady(true);
      flushQueuedSubmissionRef.current(token);
    });
  }, [auto, play, cancelIntroDelay, completeIntro, waitForIntroDelay]);

  const continueNow = useCallback(() => {
    const ex = exerciseRef.current;
    if (ex?.type === "introduce") {
      if (introStageRef.current !== "ready" || playingRef.current) return;
      completeIntro(flowToken.current);
    } else advanceRef.current();
  }, [completeIntro]);

  const continueTransition = useCallback(() => {
    if (sessionRef.current?.continueTransition()) {
      advanceRef.current();
    }
  }, []);

  const continueNotification = useCallback(() => {
    if (sessionRef.current?.continueNotification()) {
      advanceRef.current();
    }
  }, []);

  const continueContinuousCopy = useCallback(() => {
    continuousCopy.reset();
    advanceRef.current();
  }, [continuousCopy]);

  // --- Checkpoint mode -----------------------------------------------------
  const finishCheckpoint = useCallback(() => {
    const cp = checkpointRef.current;
    if (!cp) return;
    nextFlowToken();
    queuedSubmissionRef.current = null;
    currentAnswerRef.current = "";
    playbackGeneration.current += 1;
    clearHeldKeys();
    playingRef.current = false;
    setIsPlaying(false);
    void audio.cancelAndSuspend();
    const applied = applyCheckpoint(stateRef.current, cp.grade());
    saveCurriculum(stateRef.current);
    setCheckpointResult(applied);
    setPhase("checkpoint-result");
  }, [audio, clearHeldKeys, nextFlowToken]);

  const startCheckpoint = useCallback(async () => {
    continuousCopy.reset();
    clearHeldKeys();
    await audio.cancel();
    nextFlowToken();
    queuedSubmissionRef.current = null;
    currentAnswerRef.current = "";
    playbackGeneration.current += 1;
    playingRef.current = false;
    setIsPlaying(false);
    await audio.unlock();
    checkpointRef.current = new CheckpointSession({
      active: unlockedCharacters(stateRef.current),
      newest: newestCharacter(stateRef.current)?.character ?? "",
      rng: createRng(Date.now() >>> 0),
    });
    setCheckpointResult(undefined);
    setPhase("checkpoint");
    const token = nextFlowToken();
    acceptedTokenRef.current = null;
    bindHeldKeysToPrompt(token);
    const first = checkpointRef.current.current();
    if (first) void presentPrompt(first, token);
    else finishCheckpoint();
  }, [
    audio,
    presentPrompt,
    finishCheckpoint,
    clearHeldKeys,
    continuousCopy,
    nextFlowToken,
    bindHeldKeysToPrompt,
  ]);

  const acceptCheckpoint = useCallback(
    (raw: string) => {
      const cp = checkpointRef.current;
      if (!cp) return;
      const first = firstSupported(raw);
      if (!first) return;
      const token = claimPrompt();
      if (token === null) return;
      cp.answer(first);
      forceTick((n) => n + 1);
      if (cp.isComplete()) {
        finishCheckpoint();
        return;
      }
      const next = cp.current();
      const nextToken = nextFlowToken();
      acceptedTokenRef.current = null;
      queuedSubmissionRef.current = null;
      currentAnswerRef.current = "";
      bindHeldKeysToPrompt(nextToken);
      if (next) void presentPrompt(next, nextToken);
    },
    [
      claimPrompt,
      presentPrompt,
      finishCheckpoint,
      nextFlowToken,
      bindHeldKeysToPrompt,
    ],
  );

  const physicalKeyDown = useCallback(
    (
      key: string,
      code: string,
      repeat: boolean,
      modified: boolean,
    ): boolean => {
      const ex = exerciseRef.current;
      const acceptsCharacter =
        phase === "checkpoint" ||
        (phase === "exercise" && ex?.type === "copy-character");
      if (!acceptsCharacter || modified) return false;

      const character = key.toUpperCase();
      if ([...character].length !== 1 || !isSupportedCharacter(character)) {
        return false;
      }
      const token = flowToken.current;
      if (heldKeysTokenRef.current !== token) {
        bindHeldKeysToPrompt(token);
      }
      const physicalKey = code || key.toUpperCase();
      if (repeat || heldKeysRef.current.has(physicalKey)) return true;

      heldKeysRef.current.add(physicalKey);
      if (phase === "checkpoint") acceptCheckpoint(character);
      else acceptIsolated(character);
      return true;
    },
    [phase, acceptCheckpoint, acceptIsolated, bindHeldKeysToPrompt],
  );

  const physicalKeyUp = useCallback((key: string, code: string) => {
    heldKeysRef.current.delete(code || key.toUpperCase());
  }, []);

  useEffect(() => {
    const onVisibility = () => {
      const session = sessionRef.current;
      if (!session) return;
      if (document.visibilityState === "hidden") session.pause();
      else session.resume();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  // Invalidate pending async work and stop audio on unmount.
  useEffect(
    () => () => {
      cancelIntroDelay();
      flowToken.current += 1;
      queuedSubmissionRef.current = null;
      currentAnswerRef.current = "";
      playbackGeneration.current += 1;
      heldKeysRef.current.clear();
      void audio.cancelAndSuspend();
    },
    [audio, cancelIntroDelay],
  );

  const current: CharacterProgress | undefined = newestCharacter(
    stateRef.current,
  );
  const session = sessionRef.current;
  const checkpoint = checkpointRef.current;
  const readiness: Readiness = checkpointReadiness(stateRef.current);

  return {
    phase,
    exercise,
    transition,
    notification,
    continuousCopy: {
      stage: continuousCopy.stage,
      text: continuousCopy.text,
      remainingMs: continuousCopy.remainingMs,
      totalMs: continuousCopy.totalMs,
      result: continuousCopy.result,
      active: continuousCopy.active,
      selectedDurationMs: settings.continuousCopyDurationMs,
      recommendedDurationMs: recommendedContinuousCopyDurationMs(
        stateRef.current.characters.length,
      ),
    },
    phaseLabel,
    feedback,
    introStage,
    awaitingContinue,
    summary,
    auto,
    readiness,
    checkpointResult,
    inputReady,
    typingReady,
    isPlaying,
    checkpoint: {
      position: checkpoint?.position ?? 0,
      length: checkpoint?.length ?? 0,
    },
    completed: session?.completedCards ?? 0,
    total: session?.totalCards ?? 0,
    progress: {
      unlocked: stateRef.current.characters.length,
      total: stateRef.current.config.order.length,
      current: current?.character,
    },
    actions: {
      begin,
      acceptIsolated,
      updateGroupWord,
      submitGroupWord,
      acceptCheckpoint,
      replay,
      continueNow,
      continueTransition,
      continueNotification,
      updateContinuousCopy: continuousCopy.setText,
      finishContinuousCopy: continuousCopy.finish,
      continueContinuousCopy,
      endSession,
      startCheckpoint,
      physicalKeyDown,
      physicalKeyUp,
      clearHeldKeys,
    },
  };
}
