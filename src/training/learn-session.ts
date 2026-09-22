// Learn-mode practice session. Drives a phase-based LessonPlan, records practice
// results into the curriculum for scheduling and review, and tracks active
// practice time excluding idle and paused spans. Practice does NOT advance the
// curriculum; a separate checkpoint (later stage) drives unlocks. Pure
// application service: no DOM or storage.

import {
  newestCharacter,
  recordAttempt,
  unlockedCharacters,
  type CurriculumState,
} from "../core/curriculum.ts";
import type { Rng } from "../core/rng.ts";
import { gradeCopy, gradeCopyAligned, normalizeCopy } from "../core/scoring.ts";
import {
  DEFAULT_LESSON_CONFIG,
  LessonPlan,
  type LessonConfig,
  type PlannedExercise,
} from "./lesson-plan.ts";

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
  exercise: PlannedExercise;
  correct: boolean;
};

export type SessionSummary = {
  activeMs: number;
  /** Cards completed, including introductions. */
  cards: number;
  /** Scored attempts (excludes introductions). */
  attempts: number;
  correct: number;
  accuracy: number;
  rxAttempts: number;
  txAttempts: number;
  charactersPracticed: string[];
  /** True when the session meets the minimum active time and attempt count. */
  valid: boolean;
};

type SessionOptions = {
  state: CurriculumState;
  rng: Rng;
  /** Characters already introduced in earlier sessions. */
  introduced?: Iterable<string>;
  now?: () => number;
  lessonConfig?: LessonConfig;
  sessionConfig?: SessionConfig;
};

export class LearnSession {
  private readonly state: CurriculumState;
  private readonly now: () => number;
  private readonly config: SessionConfig;
  private readonly plan: LessonPlan;

  private current: PlannedExercise | undefined;
  private lastActivityAt: number | undefined;
  private paused = false;
  private activeMs = 0;

  private cards = 0;
  private attempts = 0;
  private correctCount = 0;
  private rxAttempts = 0;
  private txAttempts = 0;
  private replayedThisCard = false;
  private readonly practiced = new Set<string>();
  private readonly introducedCompleted = new Set<string>();

  constructor(options: SessionOptions) {
    this.state = options.state;
    this.now =
      options.now ??
      (() =>
        typeof performance !== "undefined" ? performance.now() : Date.now());
    this.config = options.sessionConfig ?? DEFAULT_SESSION_CONFIG;
    this.plan = new LessonPlan({
      active: unlockedCharacters(options.state),
      introduced: options.introduced ?? [],
      newest: newestCharacter(options.state)?.character ?? "",
      rng: options.rng,
      config: options.lessonConfig ?? DEFAULT_LESSON_CONFIG,
    });
  }

  start(time = this.now()): void {
    this.lastActivityAt = time;
  }

  /** The next planned card, or undefined when the lesson is complete. */
  next(): PlannedExercise | undefined {
    this.accrue(this.now());
    this.replayedThisCard = false;
    this.current = this.plan.next();
    return this.current;
  }

  get currentExercise(): PlannedExercise | undefined {
    return this.current;
  }

  /** Marks the current card as replayed, so its result does not feed mastery. */
  markReplayed(): void {
    this.replayedThisCard = true;
  }

  /**
   * Records the result for the current card. Pass the typed answer for copy
   * cards, or a boolean for sending drills. Introductions take any input and
   * record no attempt. Practice never unlocks characters.
   */
  submit(input: string | boolean): AttemptOutcome {
    const exercise = this.current;
    if (!exercise) {
      throw new Error("submit called before next");
    }
    this.accrue(this.now());
    this.cards += 1;

    if (exercise.type === "introduce") {
      this.introducedCompleted.add(exercise.target);
      return { exercise, correct: true };
    }

    // Assisted or replayed cards reveal or repeat the answer, so they are
    // teaching moments and must not feed the curriculum or scored accuracy.
    const assisted = exercise.assisted || this.replayedThisCard;

    let correct: boolean;
    if (exercise.type === "send-character") {
      correct = input === true;
      if (!assisted) {
        recordAttempt(this.state, exercise.target, "tx", correct);
        this.txAttempts += 1;
      }
      this.practiced.add(exercise.target);
    } else if (exercise.type === "copy-character") {
      const answer = typeof input === "string" ? input : "";
      correct = gradeCopy(exercise.target, answer).correct;
      if (!assisted) {
        recordAttempt(this.state, exercise.target, "rx", correct);
        this.rxAttempts += 1;
      }
      this.practiced.add(exercise.target);
    } else {
      // Groups and words: sequence-aligned grading credits target positions even
      // when characters are inserted or dropped, so per-character mastery is safe.
      const answer = typeof input === "string" ? input : "";
      const grade = gradeCopyAligned(exercise.target, answer);
      correct = grade.correct;
      if (!assisted) {
        [...normalizeCopy(exercise.target)].forEach((char, index) => {
          recordAttempt(this.state, char, "rx", grade.perChar[index] ?? false);
          this.rxAttempts += 1;
          this.practiced.add(char);
        });
      } else {
        this.practiced.add(exercise.focus);
      }
    }

    if (!assisted) {
      this.attempts += 1;
      if (correct) {
        this.correctCount += 1;
      }
    }
    this.plan.reportResult(correct);
    return { exercise, correct };
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

  get totalCards(): number {
    return this.plan.length;
  }

  get completedCards(): number {
    return this.cards;
  }

  /** Characters newly introduced by this session's lesson. */
  get newlyIntroduced(): string[] {
    return this.plan.newlyIntroduced;
  }

  /** Characters whose introduction card was actually completed this session. */
  get completedIntroductions(): string[] {
    return [...this.introducedCompleted];
  }

  get unlockedNow(): string[] {
    return unlockedCharacters(this.state);
  }

  summary(): SessionSummary {
    return {
      activeMs: this.activeMs,
      cards: this.cards,
      attempts: this.attempts,
      correct: this.correctCount,
      accuracy: this.attempts === 0 ? 0 : this.correctCount / this.attempts,
      rxAttempts: this.rxAttempts,
      txAttempts: this.txAttempts,
      charactersPracticed: [...this.practiced],
      valid: this.activeMs >= this.config.minActiveMs && this.attempts > 0,
    };
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
