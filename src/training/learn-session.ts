// Learn-mode practice session. Drives a phase-based LessonPlan, records practice
// results into the curriculum for scheduling and review, and tracks active
// practice time excluding idle and paused spans. Practice does NOT advance the
// curriculum; a separate checkpoint (later stage) drives unlocks. Pure
// application service: no DOM or storage.

import {
  newestCharacter,
  recentAccuracy,
  recordAttempt,
  recordReviewOutcome,
  reviewCharacters,
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

export type LessonTransition = {
  type: "transition";
  id: "multi-character-copy";
  title: "Ready for something longer?";
  text: "You’ve learned the individual sounds. Now copy several characters without stopping between them.";
  destinationPhase: "groups-2";
  actionLabel: "Go";
};

export type LessonNotification = {
  type: "notification";
  id: "three-character-groups";
  title: "Now copying 3-character groups";
  destinationPhase: "groups-3";
  actionLabel: "Go";
  delayMs: number;
};

export type LessonEvent =
  PlannedExercise | LessonTransition | LessonNotification;

const MULTI_CHARACTER_TRANSITION: LessonTransition = {
  type: "transition",
  id: "multi-character-copy",
  title: "Ready for something longer?",
  text: "You’ve learned the individual sounds. Now copy several characters without stopping between them.",
  destinationPhase: "groups-2",
  actionLabel: "Go",
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
  /** Active characters flagged for review; defaults to the state's flags. */
  review?: Iterable<string>;
  now?: () => number;
  lessonConfig?: LessonConfig;
  sessionConfig?: SessionConfig;
};

export class LearnSession {
  private readonly state: CurriculumState;
  private readonly now: () => number;
  private readonly config: SessionConfig;
  private readonly plan: LessonPlan;
  private readonly groupLengthNoticeMs: number;

  private current: LessonEvent | undefined;
  private pendingExercise: PlannedExercise | undefined;
  private showedMultiCharacterTransition = false;
  private showedThreeCharacterNotification = false;
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
    const lessonConfig = options.lessonConfig ?? DEFAULT_LESSON_CONFIG;
    this.groupLengthNoticeMs = lessonConfig.groupLengthNoticeMs;
    this.plan = new LessonPlan({
      active: unlockedCharacters(options.state),
      introduced: options.introduced ?? [],
      newest: newestCharacter(options.state)?.character ?? "",
      review: options.review ?? reviewCharacters(options.state),
      weak: options.state.characters
        .filter(
          (character) =>
            character.rx.recentResults.length > 0 &&
            recentAccuracy(character.rx) < lessonConfig.contrastMinAccuracy,
        )
        .map((character) => character.character),
      rng: options.rng,
      config: lessonConfig,
    });
  }

  start(time = this.now()): void {
    this.lastActivityAt = time;
  }

  /** The next lesson event, or undefined when the lesson is complete. */
  next(): LessonEvent | undefined {
    this.accrue(this.now());
    if (
      this.current?.type === "transition" ||
      this.current?.type === "notification"
    ) {
      return this.current;
    }
    this.replayedThisCard = false;
    const exercise = this.pendingExercise ?? this.plan.next();
    this.pendingExercise = undefined;
    if (
      exercise?.phase === "groups-2" &&
      !this.showedMultiCharacterTransition
    ) {
      this.showedMultiCharacterTransition = true;
      this.pendingExercise = exercise;
      this.current = MULTI_CHARACTER_TRANSITION;
      return this.current;
    }
    if (
      exercise?.phase === "groups-3" &&
      !this.showedThreeCharacterNotification
    ) {
      this.showedThreeCharacterNotification = true;
      this.pendingExercise = exercise;
      this.current = {
        type: "notification",
        id: "three-character-groups",
        title: "Now copying 3-character groups",
        destinationPhase: "groups-3",
        actionLabel: "Go",
        delayMs: this.groupLengthNoticeMs,
      };
      return this.current;
    }
    this.current = exercise;
    return this.current;
  }

  get currentExercise(): PlannedExercise | undefined {
    return this.current?.type === "transition" ||
      this.current?.type === "notification"
      ? undefined
      : this.current;
  }

  get currentEvent(): LessonEvent | undefined {
    return this.current;
  }

  get phaseLabel(): string | undefined {
    const event = this.current;
    if (!event) return undefined;
    if (event.type === "transition") return "Single-character copy";
    if (event.type === "notification") return "3-character groups";
    if (event.phase === "introduce" || event.phase === "acquire") {
      return `Learning ${event.focus}`;
    }
    if (event.phase === "remediate") return `Reviewing ${event.focus}`;
    if (event.phase === "contrast") return "Single-character copy";
    return `${event.target.length}-character groups`;
  }

  /** A transition changes mode but records no card or mastery observation. */
  continueTransition(): boolean {
    if (this.current?.type !== "transition") {
      return false;
    }
    this.current = undefined;
    return true;
  }

  continueNotification(): boolean {
    if (this.current?.type !== "notification") {
      return false;
    }
    this.current = undefined;
    return true;
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
    if (exercise.type === "transition" || exercise.type === "notification") {
      throw new Error("submit called for a lesson interstitial");
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
        recordReviewOutcome(this.state, exercise.target, correct);
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
    const update = this.plan.reportResult(correct, !assisted);
    if (update.acquisitionCapped) {
      const progress = this.state.characters.find(
        (character) => character.character === update.acquisitionCapped,
      );
      if (progress) {
        progress.needsReview = true;
        progress.reviewStreak = 0;
      }
    }
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
