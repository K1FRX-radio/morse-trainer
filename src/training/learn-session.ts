// Learn-mode session orchestrator. Generates exercises, records results into
// the curriculum, detects unlocks, and tracks active practice time excluding
// idle and paused spans. Pure application service: no DOM or storage. The UI
// drives it and reacts to the returned outcomes.

import { selectEligibleWord } from "../content/words.ts";
import {
  recordAttempt,
  unlockNext,
  unlockedCharacters,
  type CurriculumState,
} from "../core/curriculum.ts";
import {
  nextExercise,
  type ExerciseOptions,
  type LearnExercise,
} from "../core/exercises.ts";
import type { Rng } from "../core/rng.ts";
import { gradeCopy } from "../core/scoring.ts";

// selectEligibleWord is re-exported so the UI can preview words without
// reaching into the content layer directly.
export { selectEligibleWord };

export type SessionConfig = {
  /** Gaps longer than this (ms) between activity are treated as idle. */
  idleThresholdMs: number;
  /** Minimum active time (ms) for a session to count for analytics. */
  minActiveMs: number;
};

export const DEFAULT_SESSION_CONFIG: SessionConfig = {
  idleThresholdMs: 60000,
  minActiveMs: 30000,
};

export type AttemptOutcome = {
  exercise: LearnExercise;
  correct: boolean;
  /** Newly unlocked character, if this attempt crossed the threshold. */
  unlockedCharacter?: string;
};

export type SessionSummary = {
  activeMs: number;
  attempts: number;
  correct: number;
  accuracy: number;
  rxAttempts: number;
  txAttempts: number;
  charactersPracticed: string[];
  unlockedCharacters: string[];
  /** True when the session meets the minimum active time and attempt count. */
  valid: boolean;
};

type SessionOptions = {
  state: CurriculumState;
  rng: Rng;
  now?: () => number;
  exerciseOptions?: Omit<ExerciseOptions, "introduced">;
  sessionConfig?: SessionConfig;
};

export class LearnSession {
  private readonly state: CurriculumState;
  private readonly rng: Rng;
  private readonly now: () => number;
  private readonly exerciseOptions: Omit<ExerciseOptions, "introduced">;
  private readonly config: SessionConfig;
  private readonly introduced = new Set<string>();

  private current: LearnExercise | undefined;
  private lastActivityAt: number | undefined;
  private paused = false;
  private activeMs = 0;

  private attempts = 0;
  private correctCount = 0;
  private rxAttempts = 0;
  private txAttempts = 0;
  private readonly practiced = new Set<string>();
  private readonly unlocked: string[] = [];

  constructor(options: SessionOptions) {
    this.state = options.state;
    this.rng = options.rng;
    this.now =
      options.now ??
      (() =>
        typeof performance !== "undefined" ? performance.now() : Date.now());
    this.exerciseOptions = options.exerciseOptions ?? {};
    this.config = options.sessionConfig ?? DEFAULT_SESSION_CONFIG;
  }

  start(time = this.now()): void {
    this.lastActivityAt = time;
  }

  /** Generates and stores the next exercise. */
  next(): LearnExercise {
    this.accrue(this.now());
    const exercise = nextExercise(this.state, this.rng, {
      ...this.exerciseOptions,
      introduced: this.introduced,
    });
    this.current = exercise;
    return exercise;
  }

  get currentExercise(): LearnExercise | undefined {
    return this.current;
  }

  /**
   * Records the result for the current exercise. Pass the typed answer for copy
   * exercises, or a boolean for sending drills. Introductions take any input and
   * record no attempt.
   */
  submit(input: string | boolean): AttemptOutcome {
    const exercise = this.current;
    if (!exercise) {
      throw new Error("submit called before next");
    }
    this.accrue(this.now());

    if (exercise.type === "introduce") {
      this.introduced.add(exercise.target);
      return { exercise, correct: true };
    }

    let correct: boolean;
    if (exercise.type === "send-character") {
      correct = input === true;
      recordAttempt(this.state, exercise.target, "tx", correct);
      this.txAttempts += 1;
      this.practiced.add(exercise.target);
    } else {
      const answer = typeof input === "string" ? input : "";
      const grade = gradeCopy(exercise.target, answer);
      correct = grade.correct;
      const chars = [...exercise.target.toUpperCase()];
      chars.forEach((char, index) => {
        recordAttempt(this.state, char, "rx", grade.perChar[index] ?? false);
        this.rxAttempts += 1;
        this.practiced.add(char);
      });
    }

    this.attempts += 1;
    if (correct) {
      this.correctCount += 1;
    }

    const outcome: AttemptOutcome = { exercise, correct };
    const unlockedChar = unlockNext(this.state);
    if (unlockedChar) {
      this.unlocked.push(unlockedChar);
      outcome.unlockedCharacter = unlockedChar;
    }
    return outcome;
  }

  pause(time = this.now()): void {
    if (!this.paused) {
      this.accrue(time);
      this.paused = true;
    }
  }

  resume(time = this.now()): void {
    if (this.paused) {
      this.paused = false;
      this.lastActivityAt = time;
    }
  }

  end(time = this.now()): SessionSummary {
    this.accrue(time);
    return this.summary();
  }

  get elapsedActiveMs(): number {
    return this.activeMs;
  }

  summary(): SessionSummary {
    return {
      activeMs: this.activeMs,
      attempts: this.attempts,
      correct: this.correctCount,
      accuracy: this.attempts === 0 ? 0 : this.correctCount / this.attempts,
      rxAttempts: this.rxAttempts,
      txAttempts: this.txAttempts,
      charactersPracticed: [...this.practiced],
      unlockedCharacters: [...this.unlocked],
      valid: this.activeMs >= this.config.minActiveMs && this.attempts > 0,
    };
  }

  get unlockedNow(): string[] {
    return unlockedCharacters(this.state);
  }

  private accrue(time: number): void {
    if (!this.paused && this.lastActivityAt !== undefined) {
      const delta = time - this.lastActivityAt;
      if (delta > 0) {
        this.activeMs += Math.min(delta, this.config.idleThresholdMs);
      }
    }
    this.lastActivityAt = time;
  }
}
