import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  newestCharacter,
  type CurriculumState,
} from "../../core/curriculum.ts";
import { encodeText, isSupportedCharacter } from "../../core/morse.ts";
import { createRng } from "../../core/rng.ts";
import { recommendedContinuousCopyDurationMs } from "../../core/settings.ts";
import type { CharacterProgress } from "../../core/types.ts";
import type {
  LearnPersistenceSnapshot,
  LearnSessionPersistence,
} from "../../data/learn-persistence.ts";
import type { RetryClassification } from "../../data/retry-history.ts";
import {
  acceptAdvancement as acceptAdvancementOffer,
  type AdvancementAcceptance,
} from "../../training/advancement.ts";
import {
  LearnSession,
  MIN_RETRY_ISOLATED_OBSERVATIONS,
  type LessonEvent,
  type LessonNotification,
  type LessonTransition,
  type LearnSessionMode,
  type SessionSummary,
} from "../../training/learn-session.ts";
import type { PlannedExercise } from "../../training/lesson-plan.ts";
import {
  recommendRetry,
  type RetryRecommendation,
} from "../../training/retry-recommendation.ts";
import { useLearnAudio } from "../learn-audio-context.ts";
import { useSettings } from "../settings-context.ts";
import { useTrainingData } from "../training-data-context.ts";
import { useContinuousCopy } from "./useContinuousCopy.ts";

// Brief holds (ms). Introductions are paced only by completed audio and input.
const HOLD_AFTER_CORRECT = 450;
const HOLD_AFTER_MISS = 500;

export type LearnPhase = "onboarding" | "exercise" | "summary";
export type PersistenceStatus = "pending" | "ready" | "error";

export type Feedback = {
  correct: boolean;
  expected: string;
  morse: string;
};

export type IntroStage = "playing" | "ready";

type QueuedSubmission =
  | {
      token: number;
      kind: "automatic" | "explicit";
    }
  | {
      token: number;
      kind: "isolated";
      value: string;
      playbackGeneration: number;
    };

type FinalizationWork = {
  persistence: LearnSessionPersistence;
  session: LearnSession;
  snapshot: LearnPersistenceSnapshot;
};

type AdvancementWork = {
  persistence: LearnSessionPersistence;
  state: CurriculumState;
  acceptance: AdvancementAcceptance;
};

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
  const { settings, update: updateSettings } = useSettings();
  const {
    loadCurriculum,
    saveCurriculum,
    loadIntroductions,
    saveIntroductions,
    startLearnSessionPersistence,
    getRetryClassification,
  } = useTrainingData();
  const audio = useLearnAudio();
  const auto = settings.pacing === "auto";

  const stateRef = useRef<CurriculumState>(
    undefined as unknown as CurriculumState,
  );
  if (!stateRef.current) {
    stateRef.current = loadCurriculum();
  }
  const sessionRef = useRef<LearnSession | undefined>(undefined);
  const persistenceRef = useRef<LearnSessionPersistence | undefined>(undefined);
  const finalizationRef = useRef<FinalizationWork | undefined>(undefined);
  const advancementRef = useRef<AdvancementWork | undefined>(undefined);
  const persistenceOperation = useRef(0);

  // Flow tokens invalidate stale async transitions; the one-shot lock guarantees
  // exactly one accepted answer per presented prompt.
  const flowToken = useRef(0);
  const lockedRef = useRef(true);
  const acceptedTokenRef = useRef<number | null>(null);
  const playingRef = useRef(false);
  const playbackGeneration = useRef(0);
  const heldKeysRef = useRef(new Set<string>());
  const introDoneToken = useRef<number | null>(null);
  const introStageRef = useRef<IntroStage | undefined>(undefined);
  const queuedSubmissionRef = useRef<QueuedSubmission | null>(null);
  const currentAnswerRef = useRef("");
  const flushQueuedSubmissionRef = useRef<
    (token: number, playbackGeneration: number) => void
  >(() => {});

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
  const [retryClassification, setRetryClassification] = useState<
    RetryClassification | undefined
  >(undefined);
  const [inputReady, setInputReady] = useState(false);
  const [typingReady, setTypingReady] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [persistenceStatus, setPersistenceStatus] =
    useState<PersistenceStatus>("ready");
  const [persistenceError, setPersistenceError] = useState<string | undefined>(
    undefined,
  );
  const [, forceTick] = useState(0);

  const persistenceSnapshot = useCallback(
    (session: LearnSession): LearnPersistenceSnapshot => ({
      activeMs: session.elapsedActiveMs,
      completedCards: session.completedCards,
      curriculum: stateRef.current,
      introductions: [
        ...loadIntroductions(),
        ...session.completedIntroductions,
      ],
    }),
    [loadIntroductions],
  );

  const setPersistenceFailed = useCallback(() => {
    setPersistenceStatus("error");
    setPersistenceError(
      "Your session could not be saved. Check storage access and try again.",
    );
  }, []);

  const trackPersistence = useCallback(
    (persistence: LearnSessionPersistence, operation: Promise<void>) => {
      const token = ++persistenceOperation.current;
      setPersistenceStatus("pending");
      setPersistenceError(undefined);
      void operation
        .then(() => {
          if (
            persistenceRef.current === persistence &&
            persistenceOperation.current === token
          ) {
            setPersistenceStatus("ready");
          }
        })
        .catch(() => {
          if (
            persistenceRef.current === persistence &&
            persistenceOperation.current === token
          ) {
            setPersistenceFailed();
          }
        });
    },
    [setPersistenceFailed],
  );

  const finalizePersistence = useCallback(
    async (work: FinalizationWork) => {
      const token = ++persistenceOperation.current;
      setPersistenceStatus("pending");
      setPersistenceError(undefined);
      try {
        await work.persistence.finish(work.snapshot);
        const assessment = work.session.summary().advancementAssessment;
        const classification = assessment
          ? await getRetryClassification(
              {
                activeCharacters: work.session.unlockedNow,
                charWpm: settings.charWpm,
                effectiveWpm: settings.effectiveWpm,
              },
              settings.speedSuggestionAfterAttempts,
            )
          : undefined;
        if (
          persistenceRef.current === work.persistence &&
          persistenceOperation.current === token
        ) {
          setRetryClassification(classification);
          setPersistenceStatus("ready");
        }
      } catch {
        if (
          persistenceRef.current === work.persistence &&
          persistenceOperation.current === token
        ) {
          setPersistenceFailed();
        }
      }
    },
    [
      getRetryClassification,
      setPersistenceFailed,
      settings.charWpm,
      settings.effectiveWpm,
      settings.speedSuggestionAfterAttempts,
    ],
  );

  const recordContinuousCopy = useCallback(
    (typed: string, durationCompleted: number, abandoned: boolean) => {
      const session = sessionRef.current;
      if (!session) {
        throw new Error("continuous copy completed without a Learn session");
      }
      const event = session.currentEvent;
      if (event?.type !== "continuous-copy") {
        throw new Error("continuous copy event is unavailable");
      }
      const result = session.completeContinuousCopy(
        typed,
        durationCompleted,
        abandoned,
      );
      const assessment = session.summary().advancementAssessment;
      const persistence = persistenceRef.current;
      if (persistence) {
        trackPersistence(
          persistence,
          persistence.recordAttempt(
            {
              exerciseType: "continuous-copy",
              target: event.plan.gradingTarget,
              response: typed,
              assisted: false,
              replayed: false,
              abandoned,
              durationMs: durationCompleted,
              ...(assessment ? { readinessReason: assessment.reason } : {}),
            },
            persistenceSnapshot(session),
          ),
        );
      }
      saveCurriculum(stateRef.current);
      forceTick((value) => value + 1);
      return result;
    },
    [persistenceSnapshot, saveCurriculum, trackPersistence],
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
      return generation;
    },
    [audio, timing, settings.toneHz],
  );

  // Copy fields permit typing during playback, but every prompt remains locked
  // against grading until its audio completes.
  const presentPrompt = useCallback(
    async (target: string, token: number, allowTyping = false) => {
      lockedRef.current = true;
      setInputReady(false);
      setTypingReady(allowTyping);
      const generation = await play(target);
      if (token !== flowToken.current) return;
      lockedRef.current = false;
      setInputReady(true);
      flushQueuedSubmissionRef.current(token, generation);
    },
    [play],
  );

  const advanceRef = useRef<() => void>(() => {});

  const updateIntroStage = useCallback((stage: IntroStage | undefined) => {
    introStageRef.current = stage;
    setIntroStage(stage);
  }, []);

  const nextFlowToken = useCallback(() => {
    return (flowToken.current += 1);
  }, []);

  const completeIntro = useCallback(
    (token: number) => {
      if (token !== flowToken.current || introStageRef.current !== "ready") {
        return;
      }
      if (introDoneToken.current === token) return;
      introDoneToken.current = token;
      sessionRef.current?.submit("");
      saveCurriculum(stateRef.current);
      advanceRef.current();
    },
    [saveCurriculum],
  );

  const clearHeldKeys = useCallback(() => {
    heldKeysRef.current.clear();
  }, []);

  const runIntro = useCallback(
    async (target: string, token: number) => {
      lockedRef.current = true;
      setInputReady(false);
      setTypingReady(false);
      updateIntroStage("playing");
      await play(target);
      if (token !== flowToken.current) return;
      updateIntroStage("ready");
    },
    [play, updateIntroStage],
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
    const completedSummary = session.end();
    setSummary(completedSummary);
    setRetryClassification(undefined);
    const persistence = persistenceRef.current;
    if (persistence) {
      const work = {
        persistence,
        session,
        snapshot: persistenceSnapshot(session),
      };
      finalizationRef.current = work;
      void finalizePersistence(work);
    }
    saveIntroductions([
      ...loadIntroductions(),
      ...session.completedIntroductions,
    ]);
    saveCurriculum(stateRef.current);
    setExercise(undefined);
    setTransition(undefined);
    setNotification(undefined);
    setPhaseLabel(undefined);
    updateIntroStage(undefined);
    setPhase("summary");
  }, [
    audio,
    clearHeldKeys,
    continuousCopy,
    loadIntroductions,
    nextFlowToken,
    saveCurriculum,
    saveIntroductions,
    persistenceSnapshot,
    finalizePersistence,
    updateIntroStage,
  ]);

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
      if (event.type === "introduce") void runIntro(event.target, token);
      else {
        void presentPrompt(event.target, token, true);
      }
    },
    [
      runIntro,
      presentPrompt,
      clearHeldKeys,
      continuousCopy,
      nextFlowToken,
      updateIntroStage,
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

  const startSession = useCallback(
    async (mode: LearnSessionMode, sessionTiming = timing) => {
      const startToken = nextFlowToken();
      const previousPersistence = persistenceRef.current;
      const previousSession = sessionRef.current;
      if (previousPersistence && previousSession) {
        previousSession.end();
        setPersistenceStatus("pending");
        setPersistenceError(undefined);
        try {
          await previousPersistence.interrupt(
            persistenceSnapshot(previousSession),
          );
        } catch {
          setPersistenceFailed();
          return;
        }
        if (startToken !== flowToken.current) return;
      }
      persistenceRef.current = undefined;
      finalizationRef.current = undefined;
      advancementRef.current = undefined;
      continuousCopy.reset();
      clearHeldKeys();
      queuedSubmissionRef.current = null;
      currentAnswerRef.current = "";
      playbackGeneration.current += 1;
      playingRef.current = false;
      setIsPlaying(false);
      await audio.cancel();
      await audio.unlock();
      if (startToken !== flowToken.current) return;
      const session = new LearnSession({
        state: stateRef.current,
        mode,
        rng: createRng(Date.now() >>> 0),
        introduced: loadIntroductions(),
        continuousCopyDurationMs: settings.continuousCopyDurationMs,
        continuousCopyTiming: sessionTiming,
      });
      let persistence: LearnSessionPersistence;
      try {
        persistence = await startLearnSessionPersistence({
          mode,
          activeCharacters: session.unlockedNow,
          settings: {
            charWpm: sessionTiming.charWpm,
            effectiveWpm: sessionTiming.effectiveWpm,
            toneHz: settings.toneHz,
            noiseLevel: settings.noiseLevel,
          },
        });
      } catch {
        setPersistenceFailed();
        return;
      }
      if (startToken !== flowToken.current) {
        session.end();
        await persistence.interrupt(persistenceSnapshot(session));
        return;
      }
      session.start();
      sessionRef.current = session;
      persistenceRef.current = persistence;
      setPersistenceStatus("ready");
      setPersistenceError(undefined);
      introDoneToken.current = null;
      setSummary(undefined);
      setRetryClassification(undefined);
      setPhase("exercise");
      const first = session.next();
      if (first) showEvent(first);
      else endSession();
    },
    [
      audio,
      showEvent,
      endSession,
      clearHeldKeys,
      continuousCopy,
      nextFlowToken,
      settings.continuousCopyDurationMs,
      settings.noiseLevel,
      settings.toneHz,
      timing,
      loadIntroductions,
      startLearnSessionPersistence,
      persistenceSnapshot,
      setPersistenceFailed,
    ],
  );

  const restartFullLesson = useCallback(() => {
    if (phase === "summary" && persistenceStatus !== "ready") return;
    return startSession("learn");
  }, [persistenceStatus, phase, startSession]);
  const practiceLongCopy = useCallback(() => {
    if (phase === "summary" && persistenceStatus !== "ready") return;
    return startSession("review");
  }, [persistenceStatus, phase, startSession]);
  const begin = restartFullLesson;

  const retryRecommendation: RetryRecommendation | undefined = useMemo(() => {
    const assessment = summary?.advancementAssessment;
    if (!assessment || assessment.eligible) return undefined;
    const historicalIsolated = retryClassification?.isolatedPerformance;
    const isolatedObservations =
      summary.mode === "review" && historicalIsolated
        ? historicalIsolated.eligibleObservations
        : summary.eligibleIsolatedObservations;
    const isolatedAccuracy =
      summary.mode === "review" && historicalIsolated
        ? historicalIsolated.accuracy
        : summary.isolatedAccuracy;
    return recommendRetry({
      reason: assessment.reason,
      isolatedObservations,
      isolatedAccuracy,
      hasMinimumIsolatedSample:
        isolatedObservations >= MIN_RETRY_ISOLATED_OBSERVATIONS,
      shouldSuggestSpacing: retryClassification?.shouldSuggestSpacing ?? false,
      charWpm: settings.charWpm,
      effectiveWpm: settings.effectiveWpm,
    });
  }, [retryClassification, settings.charWpm, settings.effectiveWpm, summary]);

  const acceptSpacingSuggestion = useCallback(() => {
    if (persistenceStatus !== "ready") return;
    const spacing = retryRecommendation?.spacing;
    if (!spacing) return;
    updateSettings({ effectiveWpm: spacing.effectiveWpm });
    void startSession("review", spacing);
  }, [persistenceStatus, retryRecommendation, startSession, updateSettings]);

  // Records the answer, replays on a miss, and advances only after any
  // corrective playback finishes and while this prompt is still current.
  const afterAnswer = useCallback(
    async (input: string, token: number) => {
      const session = sessionRef.current;
      const ex = exerciseRef.current;
      if (!session || !ex) return;
      const outcome = session.submit(input);
      if (
        outcome.exercise.type === "copy-character" ||
        outcome.exercise.type === "copy-group" ||
        outcome.exercise.type === "copy-word"
      ) {
        const persistence = persistenceRef.current;
        if (persistence) {
          trackPersistence(
            persistence,
            persistence.recordAttempt(
              {
                exerciseType: outcome.exercise.type,
                target: outcome.exercise.target,
                response: typeof input === "string" ? input : "",
                assisted: outcome.assisted,
                replayed: outcome.replayed,
                abandoned: false,
              },
              persistenceSnapshot(session),
            ),
          );
        }
      }
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
    [auto, persistenceSnapshot, play, saveCurriculum, trackPersistence],
  );

  // The single one-shot gate: returns the current token and locks, or null.
  const claimPrompt = useCallback((keepTypingReady = false): number | null => {
    const token = flowToken.current;
    if (lockedRef.current) return null;
    if (acceptedTokenRef.current === token) return null;
    acceptedTokenRef.current = token;
    lockedRef.current = true;
    setInputReady(false);
    if (!keepTypingReady) setTypingReady(false);
    return token;
  }, []);

  const acceptIsolated = useCallback(
    (raw: string) => {
      const ex = exerciseRef.current;
      if (!ex || ex.type !== "copy-character") return;
      const first = firstSupported(raw);
      if (!first) return;
      const token = flowToken.current;
      if (
        acceptedTokenRef.current === token ||
        (queuedSubmissionRef.current?.token === token &&
          queuedSubmissionRef.current.kind === "isolated")
      ) {
        return;
      }
      if (lockedRef.current) {
        if (!playingRef.current) return;
        queuedSubmissionRef.current = {
          token,
          kind: "isolated",
          value: first,
          playbackGeneration: playbackGeneration.current,
        };
        return;
      }
      const claimedToken = claimPrompt(true);
      if (claimedToken === null) return;
      void afterAnswer(first, claimedToken);
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
    (token: number, completedPlaybackGeneration: number) => {
      const queued = queuedSubmissionRef.current;
      if (!queued || queued.token !== token) return;
      if (
        queued.kind === "isolated" &&
        queued.playbackGeneration !== completedPlaybackGeneration
      ) {
        return;
      }
      queuedSubmissionRef.current = null;
      const claimedToken = claimPrompt(queued.kind === "isolated");
      if (claimedToken !== null) {
        void afterAnswer(
          queued.kind === "isolated" ? queued.value : currentAnswerRef.current,
          claimedToken,
        );
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
      updateIntroStage("playing");
      void play(ex.target).then(() => {
        if (token !== flowToken.current) return;
        updateIntroStage("ready");
      });
      return;
    }
    if (playingRef.current) return;
    const token = flowToken.current;
    lockedRef.current = true;
    setInputReady(false);
    setTypingReady(
      ex.type === "copy-character" ||
        ex.type === "copy-group" ||
        ex.type === "copy-word",
    );
    sessionRef.current?.markReplayed();
    void play(ex.target).then((generation) => {
      if (token !== flowToken.current) return;
      lockedRef.current = false;
      setInputReady(true);
      flushQueuedSubmissionRef.current(token, generation);
    });
  }, [play, updateIntroStage]);

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

  const persistAdvancement = useCallback(
    async (work: AdvancementWork) => {
      const token = ++persistenceOperation.current;
      setPersistenceStatus("pending");
      setPersistenceError(undefined);
      try {
        await work.persistence.acceptAdvancement(work.state, work.acceptance);
        if (
          persistenceRef.current !== work.persistence ||
          persistenceOperation.current !== token
        ) {
          return;
        }
        stateRef.current = work.state;
        saveCurriculum(work.state);
        advancementRef.current = undefined;
        setPersistenceStatus("ready");
        if (work.acceptance.type === "character-unlocked") {
          void startSession("learn");
          return;
        }
        setSummary((current) =>
          current?.advancementAssessment
            ? {
                ...current,
                advancementAssessment: {
                  ...current.advancementAssessment,
                  eligible: false,
                },
              }
            : current,
        );
      } catch {
        if (
          persistenceRef.current === work.persistence &&
          persistenceOperation.current === token
        ) {
          setPersistenceFailed();
        }
      }
    },
    [saveCurriculum, setPersistenceFailed, startSession],
  );

  const acceptAdvancement = useCallback(() => {
    if (persistenceStatus !== "ready") return;
    const assessment = summary?.advancementAssessment;
    const result = summary?.continuousCopyResult;
    const persistence = persistenceRef.current;
    if (!assessment || !result || !persistence || advancementRef.current) {
      return;
    }
    const nextState = structuredClone(stateRef.current);
    const acceptance = acceptAdvancementOffer(
      nextState,
      result,
      assessment,
      new Date().toISOString(),
    );
    if (!acceptance) return;
    const work = { persistence, state: nextState, acceptance };
    advancementRef.current = work;
    void persistAdvancement(work);
  }, [persistAdvancement, persistenceStatus, summary]);

  const retryPersistence = useCallback(() => {
    const advancement = advancementRef.current;
    if (advancement) {
      void persistAdvancement(advancement);
      return;
    }
    const finalization = finalizationRef.current;
    if (finalization) {
      void finalizePersistence(finalization);
      return;
    }
    const persistence = persistenceRef.current;
    if (!persistence) {
      if (phase === "onboarding") void startSession("learn");
      return;
    }
    trackPersistence(persistence, persistence.retry());
  }, [
    finalizePersistence,
    persistAdvancement,
    phase,
    startSession,
    trackPersistence,
  ]);

  const physicalKeyDown = useCallback(
    (
      key: string,
      code: string,
      repeat: boolean,
      modified: boolean,
    ): boolean => {
      const ex = exerciseRef.current;
      const acceptsCharacter =
        phase === "exercise" && ex?.type === "copy-character";
      if (!acceptsCharacter || modified) return false;

      const character = key.toUpperCase();
      if ([...character].length !== 1 || !isSupportedCharacter(character)) {
        return false;
      }
      const physicalKey = code || key.toUpperCase();
      if (repeat || heldKeysRef.current.has(physicalKey)) return true;

      heldKeysRef.current.add(physicalKey);
      acceptIsolated(character);
      return true;
    },
    [phase, acceptIsolated],
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

  // Invalidate pending async work, stop audio, and terminally interrupt storage.
  useEffect(
    () => () => {
      flowToken.current += 1;
      queuedSubmissionRef.current = null;
      currentAnswerRef.current = "";
      playbackGeneration.current += 1;
      heldKeysRef.current.clear();
      void audio.cancelAndSuspend();
      const persistence = persistenceRef.current;
      const session = sessionRef.current;
      persistenceRef.current = undefined;
      finalizationRef.current = undefined;
      if (persistence && session) {
        session.end();
        void persistence.interrupt(persistenceSnapshot(session));
      }
    },
    [audio, persistenceSnapshot],
  );

  const current: CharacterProgress | undefined = newestCharacter(
    stateRef.current,
  );
  const session = sessionRef.current;

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
    retryRecommendation,
    persistenceStatus,
    persistenceError,
    auto,
    inputReady,
    typingReady,
    isPlaying,
    completed: session?.completedCards ?? 0,
    total: session?.totalCards ?? 0,
    progress: {
      unlocked: stateRef.current.characters.length,
      total: stateRef.current.config.order.length,
      current: current?.character,
    },
    actions: {
      begin,
      restartFullLesson,
      practiceLongCopy,
      acceptSpacingSuggestion,
      retryPersistence,
      acceptIsolated,
      updateGroupWord,
      submitGroupWord,
      acceptAdvancement,
      replay,
      continueNow,
      continueTransition,
      continueNotification,
      updateContinuousCopy: continuousCopy.setText,
      finishContinuousCopy: continuousCopy.finish,
      continueContinuousCopy,
      endSession,
      physicalKeyDown,
      physicalKeyUp,
      clearHeldKeys,
    },
  };
}
