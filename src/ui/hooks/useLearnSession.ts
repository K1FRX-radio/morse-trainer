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
import { encodeText } from "../../core/morse.ts";
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
import { useSettings } from "../settings-context.ts";
import { useAudioEngine } from "./useAudioEngine.ts";

const CURRICULUM_STORAGE_KEY = "k1frx.curriculum.v2";
const INTRODUCED_STORAGE_KEY = "k1frx.introduced.v1";

// Brief holds after grading an answer (ms); introductions are paced by audio.
const ADVANCE_AFTER_CORRECT = 500;
const ADVANCE_AFTER_MISS = 1500;
const INTRO_GAP = 400;

export type LearnPhase =
  | "onboarding"
  | "exercise"
  | "summary"
  | "checkpoint"
  | "checkpoint-result";

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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export function useLearnSession() {
  const { settings } = useSettings();
  const { engine, unlock } = useAudioEngine();
  const auto = settings.pacing === "auto";

  const stateRef = useRef<CurriculumState>(
    undefined as unknown as CurriculumState,
  );
  if (!stateRef.current) {
    stateRef.current = loadCurriculum();
  }
  const sessionRef = useRef<LearnSession | undefined>(undefined);
  const timers = useRef<number[]>([]);
  const flowToken = useRef(0);
  const introDoneToken = useRef<number | null>(null);

  const [phase, setPhase] = useState<LearnPhase>("onboarding");
  const [exercise, setExercise] = useState<PlannedExercise | undefined>(
    undefined,
  );
  const [feedback, setFeedback] = useState<Feedback | undefined>(undefined);
  const [awaitingContinue, setAwaitingContinue] = useState(false);
  const [summary, setSummary] = useState<SessionSummary | undefined>(undefined);
  const [, forceTick] = useState(0);

  const timing = useMemo(
    () => ({ charWpm: settings.charWpm, effectiveWpm: settings.effectiveWpm }),
    [settings.charWpm, settings.effectiveWpm],
  );

  const clearTimers = useCallback(() => {
    for (const id of timers.current) window.clearTimeout(id);
    timers.current = [];
  }, []);

  // Resolves when playback finishes so introductions pace to real audio length.
  const play = useCallback(
    (text: string): Promise<void> =>
      engine.playText(text, timing, { toneHz: settings.toneHz }),
    [engine, timing, settings.toneHz],
  );

  const advanceRef = useRef<() => void>(() => {});

  const endSession = useCallback(() => {
    clearTimers();
    flowToken.current += 1;
    const session = sessionRef.current;
    if (!session) return;
    setSummary(session.end());
    saveIntroduced([...loadIntroduced(), ...session.completedIntroductions]);
    saveCurriculum(stateRef.current);
    setPhase("summary");
  }, [clearTimers]);

  // Records the current introduction exactly once, then advances.
  const completeIntro = useCallback(() => {
    const token = flowToken.current;
    if (introDoneToken.current === token) return;
    introDoneToken.current = token;
    sessionRef.current?.submit("");
    saveCurriculum(stateRef.current);
    advanceRef.current();
  }, []);

  const runIntro = useCallback(
    async (card: PlannedExercise, token: number) => {
      await play(card.target);
      if (token !== flowToken.current) return;
      await delay(INTRO_GAP);
      if (token !== flowToken.current) return;
      await play(card.target);
      if (token !== flowToken.current) return;
      if (auto) completeIntro();
      else setAwaitingContinue(true);
    },
    [auto, play, completeIntro],
  );

  const showExercise = useCallback(
    (next: PlannedExercise) => {
      clearTimers();
      const token = (flowToken.current += 1);
      setExercise(next);
      setFeedback(undefined);
      setAwaitingContinue(false);

      if (next.type === "introduce") {
        void runIntro(next, token);
      } else if (next.type !== "send-character") {
        void play(next.target);
      }
    },
    [clearTimers, play, runIntro],
  );

  const advance = useCallback(() => {
    clearTimers();
    const session = sessionRef.current;
    if (!session) return;
    const next = session.next();
    if (!next) {
      endSession();
      return;
    }
    showExercise(next);
  }, [clearTimers, endSession, showExercise]);
  advanceRef.current = advance;

  const begin = useCallback(async () => {
    await unlock();
    const session = new LearnSession({
      state: stateRef.current,
      rng: createRng(Date.now() >>> 0),
      introduced: loadIntroduced(),
    });
    session.start();
    sessionRef.current = session;
    introDoneToken.current = null;
    setSummary(undefined);
    setPhase("exercise");
    const first = session.next();
    if (first) showExercise(first);
    else endSession();
  }, [unlock, showExercise, endSession]);

  const record = useCallback(
    (input: string | boolean) => {
      const session = sessionRef.current;
      if (!session || !exercise || feedback) return;
      const outcome = session.submit(input);
      saveCurriculum(stateRef.current);
      forceTick((n) => n + 1);

      setFeedback({
        correct: outcome.correct,
        expected: exercise.target,
        morse: toMorse(exercise.target),
      });
      if (!outcome.correct) {
        void play(exercise.target);
      }
      if (auto) {
        const id = window.setTimeout(
          () => advanceRef.current(),
          outcome.correct ? ADVANCE_AFTER_CORRECT : ADVANCE_AFTER_MISS,
        );
        timers.current.push(id);
      } else {
        setAwaitingContinue(true);
      }
    },
    [auto, exercise, feedback, play],
  );

  const replay = useCallback(() => {
    if (!exercise || exercise.type === "send-character") return;
    if (exercise.type !== "introduce") {
      // Replaying an answer card is an assist, so exclude it from mastery.
      sessionRef.current?.markReplayed();
    }
    void play(exercise.target);
  }, [exercise, play]);

  const continueNow = useCallback(() => {
    if (exercise?.type === "introduce") completeIntro();
    else advance();
  }, [exercise, completeIntro, advance]);

  // --- Checkpoint mode -----------------------------------------------------
  const checkpointRef = useRef<CheckpointSession | undefined>(undefined);
  const [checkpointResult, setCheckpointResult] = useState<
    CheckpointApplied | undefined
  >(undefined);

  const presentCheckpoint = useCallback(() => {
    const target = checkpointRef.current?.current();
    if (target) void play(target);
  }, [play]);

  const startCheckpoint = useCallback(async () => {
    await unlock();
    checkpointRef.current = new CheckpointSession({
      active: unlockedCharacters(stateRef.current),
      newest: newestCharacter(stateRef.current)?.character ?? "",
      rng: createRng(Date.now() >>> 0),
    });
    setCheckpointResult(undefined);
    setPhase("checkpoint");
    presentCheckpoint();
  }, [unlock, presentCheckpoint]);

  const checkpointAnswer = useCallback(
    (input: string) => {
      const cp = checkpointRef.current;
      if (!cp) return;
      cp.answer(input);
      forceTick((n) => n + 1);
      if (cp.isComplete()) {
        const applied = applyCheckpoint(stateRef.current, cp.grade());
        saveCurriculum(stateRef.current);
        setCheckpointResult(applied);
        setPhase("checkpoint-result");
      } else {
        presentCheckpoint();
      }
    },
    [presentCheckpoint],
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

  useEffect(() => clearTimers, [clearTimers]);

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
      record,
      replay,
      continueNow,
      endSession,
      startCheckpoint,
      checkpointAnswer,
    },
  };
}
