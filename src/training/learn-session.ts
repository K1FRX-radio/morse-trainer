// Learn-mode practice session. Drives a phase-based LessonPlan, records practice
// results into the curriculum for scheduling and review, and tracks active
// practice time excluding idle and paused spans. Practice does NOT advance the
// curriculum; a separate checkpoint (later stage) drives unlocks. Pure
// application service: no DOM or storage.

import {
  checkpointReadiness,
  newestCharacter,
  recentAccuracy,
  recordAttempt,
  recordReviewOutcome,
  reviewCharacters,
  unlockedCharacters,
  type CurriculumState,
  type Readiness,
} from "../core/curriculum.ts";
import type { Rng } from "../core/rng.ts";
import { gradeCopy, gradeCopyAligned, normalizeCopy } from "../core/scoring.ts";
import type { TimingOptions } from "../core/timing.ts";
import {
  applyContinuousCopyResult,
  buildContinuousCopyPlan,
  gradeContinuousCopy,
  type ContinuousCopyPlan,
  type ContinuousCopyResult,
} from "./continuous-copy.ts";
import {
  DEFAULT_LESSON_CONFIG,
  LessonPlan,
  buildWordCopyExercises,
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
  id: "multi-character-copy" | "continuous-copy" | "word-copy";
  title: string;
  text: string;
  destinationPhase: "groups-2" | "continuous-copy" | "words";
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

export type ContinuousCopyEvent = {
  type: "continuous-copy";
  id: "continuous-copy";
  plan: ContinuousCopyPlan;
};

export type LessonEvent =
  PlannedExercise | LessonTransition | LessonNotification | ContinuousCopyEvent;

const MULTI_CHARACTER_TRANSITION: LessonTransition = {
  type: "transition",
  id: "multi-character-copy",
  title: "Ready for something longer?",
  text: "You’ve learned the individual sounds. Now copy several characters without stopping between them.",
  destinationPhase: "groups-2",
  actionLabel: "Go",
};

const CONTINUOUS_COPY_TRANSITION: LessonTransition = {
  type: "transition",
  id: "continuous-copy",
  title: "Ready for continuous copy?",
  text: "Type continuously while you listen. Keep going if you miss a character; the sound will not pause.",
  destinationPhase: "continuous-copy",
  actionLabel: "Go",
};

const WORD_COPY_TRANSITION: LessonTransition = {
  type: "transition",
  id: "word-copy",
  title: "Ready to copy words?",
  text: "Now listen for complete word rhythms instead of separate characters.",
  destinationPhase: "words",
  actionLabel: "Go",
};

export const DEFAULT_CONTINUOUS_COPY_DURATION_MS = 60000;
const DEFAULT_CONTINUOUS_COPY_TIMING: TimingOptions = {
  charWpm: 20,
  effectiveWpm: 12,
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
  isolatedPrompts: number;
  groups: number;
  words: number;
  continuousCopyDurationMs: number;
  /** Group, word, and completed-stream target characters. */
  charactersTransmitted: number;
  /** Normalized characters typed for group, word, and completed-stream work. */
  charactersTyped: number;
  alignedCorrectCharacters: number;
  alignedCharacterAccuracy: number;
  /** Assisted or replayed ordinary cards deliberately excluded from mastery. */
  excludedFromMastery: number;
  charactersNeedingReview: string[];
  checkpointReadiness: Readiness;
  charactersPracticed: string[];
  /** True when the session meets the minimum active time and attempt count. */
  valid: boolean;
  continuousCopyResult?: ContinuousCopyResult;
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
  continuousCopyDurationMs?: number;
  continuousCopyTiming?: TimingOptions;
};

export class LearnSession {
  private readonly state: CurriculumState;
  private readonly now: () => number;
  private readonly config: SessionConfig;
  private readonly plan: LessonPlan;
  private readonly rng: Rng;
  private readonly groupLengthNoticeMs: number;
  private readonly contrastMinAccuracy: number;
  private readonly continuousCopyDurationMs: number;
  private readonly continuousCopyTiming: TimingOptions;
  private readonly lessonConfig: LessonConfig;

  private current: LessonEvent | undefined;
  private pendingExercise: PlannedExercise | undefined;
  private showedMultiCharacterTransition = false;
  private showedThreeCharacterNotification = false;
  private showedContinuousCopyTransition = false;
  private startedContinuousCopy = false;
  private completedContinuousCopy = false;
  private lastContinuousCopyResult: ContinuousCopyResult | undefined;
  private wordExercises: PlannedExercise[] = [];
  private wordCursor = 0;
  private showedWordTransition = false;
  private lastActivityAt: number | undefined;
  private paused = false;
  private activeMs = 0;

  private cards = 0;
  private attempts = 0;
  private correctCount = 0;
  private rxAttempts = 0;
  private txAttempts = 0;
  private isolatedPrompts = 0;
  private groups = 0;
  private words = 0;
  private alignedTargetCharacters = 0;
  private alignedTypedCharacters = 0;
  private alignedCorrectCharacters = 0;
  private excludedFromMastery = 0;
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
    this.rng = options.rng;
    const lessonConfig = options.lessonConfig ?? DEFAULT_LESSON_CONFIG;
    this.lessonConfig = lessonConfig;
    this.groupLengthNoticeMs = lessonConfig.groupLengthNoticeMs;
    this.contrastMinAccuracy = lessonConfig.contrastMinAccuracy;
    this.continuousCopyDurationMs =
      options.continuousCopyDurationMs ?? DEFAULT_CONTINUOUS_COPY_DURATION_MS;
    this.continuousCopyTiming =
      options.continuousCopyTiming ?? DEFAULT_CONTINUOUS_COPY_TIMING;
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
      this.current?.type === "notification" ||
      this.current?.type === "continuous-copy"
    ) {
      return this.current;
    }
    this.replayedThisCard = false;
    const exercise =
      this.pendingExercise ??
      this.plan.next() ??
      (this.completedContinuousCopy
        ? this.wordExercises[this.wordCursor++]
        : undefined);
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
    if (!exercise && !this.showedContinuousCopyTransition) {
      this.showedContinuousCopyTransition = true;
      this.current = CONTINUOUS_COPY_TRANSITION;
      return this.current;
    }
    if (
      !exercise &&
      !this.startedContinuousCopy &&
      !this.completedContinuousCopy
    ) {
      this.startedContinuousCopy = true;
      this.current = {
        type: "continuous-copy",
        id: "continuous-copy",
        plan: buildContinuousCopyPlan({
          active: unlockedCharacters(this.state),
          newest: newestCharacter(this.state)?.character ?? "",
          review: reviewCharacters(this.state),
          weak: this.state.characters
            .filter(
              (character) =>
                character.rx.recentResults.length > 0 &&
                recentAccuracy(character.rx) < this.contrastMinAccuracy,
            )
            .map((character) => character.character),
          durationMs: this.continuousCopyDurationMs,
          timing: this.continuousCopyTiming,
          rng: this.rng,
        }),
      };
      return this.current;
    }
    if (exercise?.phase === "words" && !this.showedWordTransition) {
      this.showedWordTransition = true;
      this.pendingExercise = exercise;
      this.current = WORD_COPY_TRANSITION;
      return this.current;
    }
    this.current = exercise;
    return this.current;
  }

  get currentExercise(): PlannedExercise | undefined {
    return this.current?.type === "transition" ||
      this.current?.type === "notification" ||
      this.current?.type === "continuous-copy"
      ? undefined
      : this.current;
  }

  get currentEvent(): LessonEvent | undefined {
    return this.current;
  }

  get phaseLabel(): string | undefined {
    const event = this.current;
    if (!event) return undefined;
    if (event.type === "transition") {
      if (event.destinationPhase === "continuous-copy") {
        return "3-character groups";
      }
      if (event.destinationPhase === "words") return "Continuous copy";
      return "Single-character copy";
    }
    if (event.type === "notification") return "3-character groups";
    if (event.type === "continuous-copy") return "Continuous copy";
    if (event.phase === "introduce" || event.phase === "acquire") {
      return `Learning ${event.focus}`;
    }
    if (event.phase === "remediate") return `Reviewing ${event.focus}`;
    if (event.phase === "contrast") return "Single-character copy";
    if (event.phase === "words") return "Word copy";
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

  completeContinuousCopy(
    typed: string,
    durationCompleted: number,
    abandoned = false,
  ): ContinuousCopyResult {
    if (this.current?.type !== "continuous-copy") {
      if (this.lastContinuousCopyResult) return this.lastContinuousCopyResult;
      throw new Error("completeContinuousCopy called outside continuous copy");
    }
    this.accrue(this.now());
    const result = gradeContinuousCopy(this.current.plan, typed, {
      durationCompleted,
      abandoned,
    });
    const observations = applyContinuousCopyResult(this.state, result);
    this.rxAttempts += observations;
    if (!result.abandoned) {
      this.alignedTargetCharacters += result.targetCharacters;
      this.alignedTypedCharacters += result.typedCharacters;
      this.alignedCorrectCharacters += result.alignedCorrect;
    }
    for (const observation of result.perCharacterResults) {
      this.practiced.add(observation.character);
    }
    this.lastContinuousCopyResult = result;
    this.completedContinuousCopy = true;
    if (!abandoned) {
      this.wordExercises = buildWordCopyExercises({
        active: unlockedCharacters(this.state),
        newest: newestCharacter(this.state)?.character ?? "",
        review: reviewCharacters(this.state),
        weak: this.state.characters
          .filter(
            (character) =>
              character.rx.recentResults.length > 0 &&
              recentAccuracy(character.rx) < this.contrastMinAccuracy,
          )
          .map((character) => character.character),
        rng: this.rng,
        config: this.lessonConfig,
      });
    }
    this.current = undefined;
    return result;
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
    if (
      exercise.type === "transition" ||
      exercise.type === "notification" ||
      exercise.type === "continuous-copy"
    ) {
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
    if (assisted) this.excludedFromMastery += 1;

    let correct: boolean;
    if (exercise.type === "send-character") {
      correct = input === true;
      if (!assisted) {
        recordAttempt(this.state, exercise.target, "tx", correct);
        this.txAttempts += 1;
      }
      this.practiced.add(exercise.target);
    } else if (exercise.type === "copy-character") {
      this.isolatedPrompts += 1;
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
      const normalizedTarget = normalizeCopy(exercise.target);
      const normalizedAnswer = normalizeCopy(answer);
      if (exercise.type === "copy-group") this.groups += 1;
      else this.words += 1;
      this.alignedTargetCharacters += normalizedTarget.length;
      this.alignedTypedCharacters += normalizedAnswer.length;
      this.alignedCorrectCharacters += grade.perChar.filter(Boolean).length;
      correct = grade.correct;
      if (!assisted) {
        [...normalizedTarget].forEach((char, index) => {
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
    const update =
      exercise.phase === "words"
        ? {}
        : this.plan.reportResult(correct, !assisted);
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
    return this.plan.length + this.wordExercises.length;
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
      isolatedPrompts: this.isolatedPrompts,
      groups: this.groups,
      words: this.words,
      continuousCopyDurationMs:
        this.lastContinuousCopyResult?.durationCompleted ?? 0,
      charactersTransmitted: this.alignedTargetCharacters,
      charactersTyped: this.alignedTypedCharacters,
      alignedCorrectCharacters: this.alignedCorrectCharacters,
      alignedCharacterAccuracy:
        this.alignedTargetCharacters === 0
          ? 0
          : this.alignedCorrectCharacters / this.alignedTargetCharacters,
      excludedFromMastery: this.excludedFromMastery,
      charactersNeedingReview: reviewCharacters(this.state),
      checkpointReadiness: checkpointReadiness(this.state),
      charactersPracticed: [...this.practiced],
      valid: this.activeMs >= this.config.minActiveMs && this.attempts > 0,
      ...(this.lastContinuousCopyResult
        ? { continuousCopyResult: this.lastContinuousCopyResult }
        : {}),
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
