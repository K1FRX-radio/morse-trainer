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
import type { CharacterProgress } from "../../core/types.ts";
import {
  applyCheckpoint,
  CheckpointSession,
  type CheckpointApplied,
} from "../../training/checkpoint.ts";
import {
  LearnSession,
  type SessionSummary,
} from "../../training/learn-session.ts";
import type { PlannedExercise } from "../../training/lesson-plan.ts";
import { useLearnAudio } from "../learn-audio-context.ts";
import { useSettings } from "../settings-context.ts";

const CURRICULUM_STORAGE_KEY = "k1frx.curriculum.v2";
const INTRODUCED_STORAGE_KEY = "k1frx.introduced.v1";

// Brief holds (ms). Introductions and misses are otherwise paced by audio.
const INTRO_GAP = 400;
const HOLD_AFTER_CORRECT = 450;
const HOLD_AFTER_MISS = 500;

export type LearnPhase =
  "onboarding" | "exercise" | "summary" | "checkpoint" | "checkpoint-result";

export type Feedback = {
  correct: boolean;
  expected: string;
  morse: string;
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
  const introDoneToken = useRef<number | null>(null);

  const [phase, setPhase] = useState<LearnPhase>("onboarding");
  const [exercise, setExercise] = useState<PlannedExercise | undefined>(
    undefined,
  );
  const exerciseRef = useRef<PlannedExercise | undefined>(undefined);
  exerciseRef.current = exercise;

  const [feedback, setFeedback] = useState<Feedback | undefined>(undefined);
  const [awaitingContinue, setAwaitingContinue] = useState(false);
  const [summary, setSummary] = useState<SessionSummary | undefined>(undefined);
  const [checkpointResult, setCheckpointResult] = useState<
    CheckpointApplied | undefined
  >(undefined);
  const [inputReady, setInputReady] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [, forceTick] = useState(0);

  const timing = useMemo(
    () => ({ charWpm: settings.charWpm, effectiveWpm: settings.effectiveWpm }),
    [settings.charWpm, settings.effectiveWpm],
  );

  const play = useCallback(
    async (text: string) => {
      playingRef.current = true;
      setIsPlaying(true);
      try {
        await audio.play(text, timing, { toneHz: settings.toneHz });
      } finally {
        playingRef.current = false;
        setIsPlaying(false);
      }
    },
    [audio, timing, settings.toneHz],
  );

  // Locks input, plays the prompt, and unlocks only after playback completes
  // if this prompt is still current.
  const presentPrompt = useCallback(
    async (target: string, token: number) => {
      lockedRef.current = true;
      setInputReady(false);
      await play(target);
      if (token !== flowToken.current) return;
      lockedRef.current = false;
      setInputReady(true);
    },
    [play],
  );

  const advanceRef = useRef<() => void>(() => {});

  const completeIntro = useCallback((token: number) => {
    if (introDoneToken.current === token) return;
    introDoneToken.current = token;
    sessionRef.current?.submit("");
    saveCurriculum(stateRef.current);
    advanceRef.current();
  }, []);

  const runIntro = useCallback(
    async (target: string, token: number) => {
      lockedRef.current = true;
      setInputReady(false);
      await play(target);
      if (token !== flowToken.current) return;
      await delay(INTRO_GAP);
      if (token !== flowToken.current) return;
      await play(target);
      if (token !== flowToken.current) return;
      if (auto) completeIntro(token);
      else setAwaitingContinue(true);
    },
    [auto, play, completeIntro],
  );

  const endSession = useCallback(() => {
    audio.cancel();
    window.setTimeout(() => audio.suspend(), 60);
    flowToken.current += 1;
    const session = sessionRef.current;
    if (!session) return;
    setSummary(session.end());
    saveIntroduced([...loadIntroduced(), ...session.completedIntroductions]);
    saveCurriculum(stateRef.current);
    setPhase("summary");
  }, [audio]);

  const showExercise = useCallback(
    (card: PlannedExercise) => {
      const token = (flowToken.current += 1);
      acceptedTokenRef.current = null;
      lockedRef.current = true;
      setInputReady(false);
      setExercise(card);
      setFeedback(undefined);
      setAwaitingContinue(false);
      if (card.type === "introduce") void runIntro(card.target, token);
      else void presentPrompt(card.target, token);
    },
    [runIntro, presentPrompt],
  );

  const advance = useCallback(() => {
    const session = sessionRef.current;
    if (!session) return;
    const next = session.next();
    if (!next) {
      endSession();
      return;
    }
    showExercise(next);
  }, [endSession, showExercise]);
  advanceRef.current = advance;

  const begin = useCallback(async () => {
    audio.cancel();
    flowToken.current += 1;
    await audio.unlock();
    const session = new LearnSession({
      state: stateRef.current,
      rng: createRng(Date.now() >>> 0),
      introduced: loadIntroduced(),
    });
    session.start();
    sessionRef.current = session;
    introDoneToken.current = null;
    setSummary(undefined);
    setCheckpointResult(undefined);
    setPhase("exercise");
    const first = session.next();
    if (first) showExercise(first);
    else endSession();
  }, [audio, showExercise, endSession]);

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

  const submitGroupWord = useCallback(
    (value: string) => {
      const ex = exerciseRef.current;
      if (!ex || (ex.type !== "copy-group" && ex.type !== "copy-word")) return;
      const token = claimPrompt();
      if (token === null) return;
      void afterAnswer(value, token);
    },
    [claimPrompt, afterAnswer],
  );

  const replay = useCallback(() => {
    const ex = exerciseRef.current;
    if (!ex || ex.type === "introduce") {
      if (ex?.type === "introduce" && !playingRef.current) void play(ex.target);
      return;
    }
    if (playingRef.current) return;
    sessionRef.current?.markReplayed();
    void play(ex.target);
  }, [play]);

  const continueNow = useCallback(() => {
    const ex = exerciseRef.current;
    if (ex?.type === "introduce") completeIntro(flowToken.current);
    else advanceRef.current();
  }, [completeIntro]);

  // --- Checkpoint mode -----------------------------------------------------
  const finishCheckpoint = useCallback(() => {
    const cp = checkpointRef.current;
    if (!cp) return;
    audio.cancel();
    window.setTimeout(() => audio.suspend(), 60);
    const applied = applyCheckpoint(stateRef.current, cp.grade());
    saveCurriculum(stateRef.current);
    setCheckpointResult(applied);
    setPhase("checkpoint-result");
  }, [audio]);

  const startCheckpoint = useCallback(async () => {
    audio.cancel();
    flowToken.current += 1;
    await audio.unlock();
    checkpointRef.current = new CheckpointSession({
      active: unlockedCharacters(stateRef.current),
      newest: newestCharacter(stateRef.current)?.character ?? "",
      rng: createRng(Date.now() >>> 0),
    });
    setCheckpointResult(undefined);
    setPhase("checkpoint");
    const token = (flowToken.current += 1);
    acceptedTokenRef.current = null;
    const first = checkpointRef.current.current();
    if (first) void presentPrompt(first, token);
    else finishCheckpoint();
  }, [audio, presentPrompt, finishCheckpoint]);

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
      const nextToken = (flowToken.current += 1);
      acceptedTokenRef.current = null;
      if (next) void presentPrompt(next, nextToken);
    },
    [claimPrompt, presentPrompt, finishCheckpoint],
  );

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
      flowToken.current += 1;
      audio.cancel();
      audio.suspend();
    },
    [audio],
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
    feedback,
    awaitingContinue,
    summary,
    auto,
    readiness,
    checkpointResult,
    inputReady,
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
      submitGroupWord,
      acceptCheckpoint,
      replay,
      continueNow,
      endSession,
      startCheckpoint,
    },
  };
}
