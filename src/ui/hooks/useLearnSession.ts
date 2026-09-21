import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_CURRICULUM_CONFIG } from "../../content/curriculum-data.ts";
import {
  createInitialState,
  newestCharacter,
  type CurriculumState,
} from "../../core/curriculum.ts";
import { encodeText } from "../../core/morse.ts";
import { createRng } from "../../core/rng.ts";
import type { CharacterProgress } from "../../core/types.ts";
import {
  LearnSession,
  type SessionSummary,
} from "../../training/learn-session.ts";
import type { PlannedExercise } from "../../training/lesson-plan.ts";
import { useSettings } from "../settings-context.ts";
import { useAudioEngine } from "./useAudioEngine.ts";

const CURRICULUM_STORAGE_KEY = "k1frx.curriculum.v2";
const INTRODUCED_STORAGE_KEY = "k1frx.introduced.v1";

// Auto-flow timings (ms).
const INTRO_REPLAY_DELAY = 1300;
const INTRO_ADVANCE_DELAY = 2700;
const ADVANCE_AFTER_CORRECT = 500;
const ADVANCE_AFTER_MISS = 1500;

export type LearnPhase = "onboarding" | "exercise" | "summary";

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

  const schedule = useCallback((fn: () => void, ms: number) => {
    const id = window.setTimeout(fn, ms);
    timers.current.push(id);
  }, []);

  const play = useCallback(
    (text: string) => {
      void engine.playText(text, timing, { toneHz: settings.toneHz });
    },
    [engine, timing, settings.toneHz],
  );

  const endSession = useCallback(() => {
    clearTimers();
    const session = sessionRef.current;
    if (!session) return;
    setSummary(session.end());
    saveIntroduced([...loadIntroduced(), ...session.newlyIntroduced]);
    saveCurriculum(stateRef.current);
    setPhase("summary");
  }, [clearTimers]);

  const showExercise = useCallback(
    (next: PlannedExercise) => {
      clearTimers();
      setExercise(next);
      setFeedback(undefined);
      setAwaitingContinue(false);

      if (next.type === "introduce") {
        play(next.target);
        schedule(() => play(next.target), INTRO_REPLAY_DELAY);
        if (auto) {
          schedule(() => advanceRef.current(), INTRO_ADVANCE_DELAY);
        } else {
          setAwaitingContinue(true);
        }
      } else if (next.type !== "send-character") {
        play(next.target);
      }
    },
    [auto, clearTimers, play, schedule],
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

  // Stable ref so timers scheduled inside showExercise can call the latest advance.
  const advanceRef = useRef(advance);
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
        play(exercise.target);
      }
      if (auto) {
        schedule(
          () => advanceRef.current(),
          outcome.correct ? ADVANCE_AFTER_CORRECT : ADVANCE_AFTER_MISS,
        );
      } else {
        setAwaitingContinue(true);
      }
    },
    [auto, exercise, feedback, play, schedule],
  );

  const replay = useCallback(() => {
    if (exercise && exercise.type !== "send-character") {
      play(exercise.target);
    }
  }, [exercise, play]);

  const continueNow = useCallback(() => advance(), [advance]);

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

  return {
    phase,
    exercise,
    feedback,
    awaitingContinue,
    summary,
    auto,
    completed: session?.completedCards ?? 0,
    total: session?.totalCards ?? 0,
    progress: {
      unlocked: stateRef.current.characters.length,
      total: stateRef.current.config.order.length,
      current: current?.character,
    },
    actions: { begin, record, replay, continueNow, endSession },
  };
}
