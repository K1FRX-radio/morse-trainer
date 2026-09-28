// Phase-based Learn lesson plan. Replaces random exercise mixing with a
// deterministic acquisition sequence: introduce every un-introduced active
// character, drill it in isolation (repeating misses), then contrast within the
// active set and short groups. Pure and seedable. Advancement is not decided
// here; completed continuous copy supplies evidence.

import type { LearnExerciseType } from "../core/exercises.ts";
import { weightedIndex, type Rng } from "../core/rng.ts";
import type { Direction } from "../core/types.ts";
import {
  evaluateWordEligibility,
  wordSelectionWeight,
  type FocusedWordEligibility,
} from "./word-selection.ts";

export type LessonPhase =
  | "introduce"
  | "acquire"
  | "remediate"
  | "contrast"
  | "groups-2"
  | "groups-3"
  | "words";

export type LearnPhaseId = LessonPhase | "continuous-copy" | "summary";

export type LearnPhaseContract = {
  id: LearnPhaseId;
  label: string;
  permittedExerciseTypes: readonly LearnExerciseType[];
  entryCondition: string;
  completionCondition: string;
  transitionTo: readonly LearnPhaseId[];
  recordsScoredAttempts: boolean;
  affectsSchedulingOrReview: boolean;
  evidenceMayAffectReadiness: boolean;
  typingDuringPlayback: boolean;
  submissionDuringPlayback: boolean;
};

export const LEARN_PHASE_ORDER = [
  "introduce",
  "acquire",
  "remediate",
  "contrast",
  "groups-2",
  "groups-3",
  "words",
  "continuous-copy",
  "summary",
] as const satisfies readonly LearnPhaseId[];

export const LEARN_PHASES: Readonly<Record<LearnPhaseId, LearnPhaseContract>> =
  {
    introduce: {
      id: "introduce",
      label: "Introduction",
      permittedExerciseTypes: ["introduce"],
      entryCondition: "An active character has not been introduced.",
      completionCondition: "The learner completes its introduction.",
      transitionTo: ["acquire"],
      recordsScoredAttempts: false,
      affectsSchedulingOrReview: false,
      evidenceMayAffectReadiness: false,
      typingDuringPlayback: false,
      submissionDuringPlayback: false,
    },
    acquire: {
      id: "acquire",
      label: "Acquisition",
      permittedExerciseTypes: ["copy-character"],
      entryCondition: "A newly introduced character needs isolated practice.",
      completionCondition:
        "The configured recent-correct threshold or attempt cap is reached.",
      transitionTo: ["introduce", "remediate", "contrast"],
      recordsScoredAttempts: true,
      affectsSchedulingOrReview: true,
      evidenceMayAffectReadiness: false,
      typingDuringPlayback: true,
      submissionDuringPlayback: false,
    },
    remediate: {
      id: "remediate",
      label: "Remediation",
      permittedExerciseTypes: ["copy-character"],
      entryCondition: "An active character is flagged for isolated review.",
      completionCondition:
        "The configured isolated remediation prompts are completed.",
      transitionTo: ["contrast"],
      recordsScoredAttempts: true,
      affectsSchedulingOrReview: true,
      evidenceMayAffectReadiness: false,
      typingDuringPlayback: true,
      submissionDuringPlayback: false,
    },
    contrast: {
      id: "contrast",
      label: "Contrast",
      permittedExerciseTypes: ["copy-character"],
      entryCondition: "Acquisition and any isolated remediation are complete.",
      completionCondition:
        "The configured mixed-recognition threshold or attempt cap is reached.",
      transitionTo: ["groups-2", "continuous-copy"],
      recordsScoredAttempts: true,
      affectsSchedulingOrReview: true,
      evidenceMayAffectReadiness: false,
      typingDuringPlayback: true,
      submissionDuringPlayback: false,
    },
    "groups-2": {
      id: "groups-2",
      label: "Two-character groups",
      permittedExerciseTypes: ["copy-group"],
      entryCondition: "Mixed isolated recognition is complete.",
      completionCondition:
        "The configured two-character group count is completed.",
      transitionTo: ["groups-3"],
      recordsScoredAttempts: true,
      affectsSchedulingOrReview: true,
      evidenceMayAffectReadiness: false,
      typingDuringPlayback: true,
      submissionDuringPlayback: false,
    },
    "groups-3": {
      id: "groups-3",
      label: "Three-character groups",
      permittedExerciseTypes: ["copy-group"],
      entryCondition: "Two-character groups are complete.",
      completionCondition:
        "The configured three-character group count is completed.",
      transitionTo: ["words", "continuous-copy"],
      recordsScoredAttempts: true,
      affectsSchedulingOrReview: true,
      evidenceMayAffectReadiness: false,
      typingDuringPlayback: true,
      submissionDuringPlayback: false,
    },
    words: {
      id: "words",
      label: "Focused words",
      permittedExerciseTypes: ["copy-word"],
      entryCondition: "The unlocked character set has enough eligible words.",
      completionCondition: "The configured focused-word count is completed.",
      transitionTo: ["continuous-copy"],
      recordsScoredAttempts: true,
      affectsSchedulingOrReview: true,
      evidenceMayAffectReadiness: false,
      typingDuringPlayback: true,
      submissionDuringPlayback: false,
    },
    "continuous-copy": {
      id: "continuous-copy",
      label: "Continuous copy",
      permittedExerciseTypes: [],
      entryCondition: "The planned card sequence is complete.",
      completionCondition: "The stream completes or the learner abandons it.",
      transitionTo: ["summary"],
      recordsScoredAttempts: true,
      affectsSchedulingOrReview: true,
      evidenceMayAffectReadiness: true,
      typingDuringPlayback: true,
      submissionDuringPlayback: true,
    },
    summary: {
      id: "summary",
      label: "Summary",
      permittedExerciseTypes: [],
      entryCondition: "The session ends.",
      completionCondition: "The learner chooses a next action.",
      transitionTo: [],
      recordsScoredAttempts: false,
      affectsSchedulingOrReview: false,
      evidenceMayAffectReadiness: false,
      typingDuringPlayback: false,
      submissionDuringPlayback: false,
    },
  };

export type PlannedExercise = {
  type: LearnExerciseType;
  target: string;
  direction: Direction;
  phase: LessonPhase;
  /** The character this card focuses on. */
  focus: string;
  newestCharacter: boolean;
  /** True when this card is an assisted reinforcement after a miss (shows the
   * character + Morse). Assisted cards do not contribute advancement evidence. */
  assisted: boolean;
};

export type LessonConfig = {
  acquireMinAttempts: number;
  acquireRecentWindow: number;
  acquireMinCorrect: number;
  acquireMaxAttempts: number;
  contrastMinAttempts: number;
  contrastMaxAttempts: number;
  contrastRecentWindow: number;
  contrastMinAccuracy: number;
  twoCharacterGroupCount: number;
  threeCharacterGroupCount: number;
  groupLengthNoticeMs: number;
  minimumEligibleWordCount: number;
  initialWordMinLength: number;
  initialWordMaxLength: number;
  wordCopyCount: number;
  /** Isolated unassisted prompts each pending review character receives. */
  remediationPrompts: number;
};

export const DEFAULT_LESSON_CONFIG: LessonConfig = {
  acquireMinAttempts: 8,
  acquireRecentWindow: 8,
  acquireMinCorrect: 6,
  acquireMaxAttempts: 14,
  contrastMinAttempts: 16,
  contrastMaxAttempts: 24,
  contrastRecentWindow: 12,
  contrastMinAccuracy: 0.8,
  twoCharacterGroupCount: 8,
  threeCharacterGroupCount: 8,
  groupLengthNoticeMs: 1800,
  minimumEligibleWordCount: 10,
  initialWordMinLength: 2,
  initialWordMaxLength: 4,
  wordCopyCount: 8,
  remediationPrompts: 3,
};

type WordExerciseOptions = {
  active: readonly string[];
  newest: string;
  review?: Iterable<string>;
  weak?: Iterable<string>;
  rng: Rng;
  config?: LessonConfig;
  eligibility?: FocusedWordEligibility;
};

export function focusedWordEligibility(
  active: readonly string[],
  config: LessonConfig = DEFAULT_LESSON_CONFIG,
): FocusedWordEligibility {
  return evaluateWordEligibility({
    active,
    minimumLength: config.initialWordMinLength,
    maximumLength: config.initialWordMaxLength,
    minimumPoolSize: config.minimumEligibleWordCount,
  });
}

export function buildWordCopyExercises(
  options: WordExerciseOptions,
): PlannedExercise[] {
  const config = options.config ?? DEFAULT_LESSON_CONFIG;
  const eligibility =
    options.eligibility ?? focusedWordEligibility(options.active, config);
  if (!eligibility.eligible) return [];

  const review = new Set(options.review ?? []);
  const weak = new Set(options.weak ?? []);
  const remaining = [...eligibility.candidates];
  const exercises: PlannedExercise[] = [];
  const count = Math.min(config.wordCopyCount, remaining.length);
  for (let index = 0; index < count; index++) {
    const weights = remaining.map((word) =>
      wordSelectionWeight(word.text, options.newest, review, weak),
    );
    const selectedIndex = weightedIndex(weights, options.rng);
    const [selected] = remaining.splice(selectedIndex, 1);
    const focus =
      (selected.text.includes(options.newest) && options.newest) ||
      [...review].find((character) => selected.text.includes(character)) ||
      [...weak].find((character) => selected.text.includes(character)) ||
      selected.text[0];
    exercises.push({
      type: "copy-word",
      target: selected.text,
      direction: "rx",
      phase: "words",
      focus,
      newestCharacter: selected.text.includes(options.newest),
      assisted: false,
    });
  }
  return exercises;
}

type LessonOptions = {
  /** Unlocked characters in curriculum order. */
  active: readonly string[];
  /** Characters already introduced in earlier sessions. */
  introduced: Iterable<string>;
  /** Newest unlocked character. */
  newest: string;
  /** Active characters flagged for review (targeted remediation). */
  review?: Iterable<string>;
  /** Active characters with weak recent performance. */
  weak?: Iterable<string>;
  rng: Rng;
  config?: LessonConfig;
};

function pick<T>(items: readonly T[], rng: Rng): T {
  return items[Math.floor(rng() * items.length)];
}

function randomGroup(
  pool: readonly string[],
  size: number,
  mustInclude: string,
  rng: Rng,
): string {
  const chars: string[] = [];
  for (let i = 0; i < size; i++) {
    chars.push(pick(pool, rng));
  }
  if (!chars.includes(mustInclude)) {
    chars[Math.floor(rng() * size)] = mustInclude;
  }
  return chars.join("");
}

export class LessonPlan {
  private readonly queue: PlannedExercise[];
  private readonly config: LessonConfig;
  private readonly newest: string;
  private readonly active: readonly string[];
  private readonly rng: Rng;
  private readonly reviewChars: string[];
  private readonly weakChars: Set<string>;
  private readonly acquisitionResults = new Map<string, boolean[]>();
  private readonly contrastResults: boolean[] = [];
  private readonly contrastCounts = new Map<string, number>();
  private readonly contrastTargets: string[] = [];
  private cursor = 0;

  readonly newlyIntroduced: string[];

  constructor(options: LessonOptions) {
    this.config = options.config ?? DEFAULT_LESSON_CONFIG;
    this.newest = options.newest;
    this.active = options.active;
    this.rng = options.rng;
    const introduced = new Set(options.introduced);
    const active = options.active;
    const newChars = active.filter((char) => !introduced.has(char));
    const reviewSet = new Set(options.review ?? []);
    this.reviewChars = active.filter(
      (char) => reviewSet.has(char) && !newChars.includes(char),
    );
    this.weakChars = new Set(options.weak ?? []);
    this.newlyIntroduced = newChars;
    this.queue = this.build(active, newChars, options.rng);
  }

  private card(
    type: LearnExerciseType,
    target: string,
    direction: Direction,
    phase: LessonPhase,
    focus: string,
    assisted = false,
  ): PlannedExercise {
    return {
      type,
      target,
      direction,
      phase,
      focus,
      newestCharacter: focus === this.newest,
      assisted,
    };
  }

  private build(
    active: readonly string[],
    newChars: readonly string[],
    rng: Rng,
  ): PlannedExercise[] {
    const q: PlannedExercise[] = [];
    const emphasis = [
      ...new Set([...newChars, ...this.reviewChars, ...this.weakChars]),
    ];
    const focusPool = emphasis.length > 0 ? emphasis : active;

    // Introduce each new character, then drill it in isolation.
    for (const char of newChars) {
      q.push(this.card("introduce", char, "rx", "introduce", char));
      for (let i = 0; i < this.config.acquireMinAttempts; i++) {
        q.push(this.card("copy-character", char, "rx", "acquire", char));
      }
    }

    // Targeted remediation: guaranteed isolated prompts for review characters.
    for (const char of this.reviewChars) {
      for (let i = 0; i < this.config.remediationPrompts; i++) {
        q.push(this.card("copy-character", char, "rx", "remediate", char));
      }
    }

    // Mixed isolated recognition across the active set. Further cards are
    // inserted from reportResult when recent clean performance remains weak.
    for (let i = 0; i < this.config.contrastMinAttempts; i++) {
      q.push(this.nextContrastCard());
    }

    // Short groups teach continuous entry at one stable length at a time. Each
    // generated group contains its selected focus character.
    if (active.length > 1) {
      const addGroups = (
        count: number,
        length: number,
        phase: "groups-2" | "groups-3",
      ) => {
        for (let i = 0; i < count; i++) {
          const focus = rng() < 0.6 ? pick(focusPool, rng) : pick(active, rng);
          const group = randomGroup(active, length, focus, rng);
          q.push(this.card("copy-group", group, "rx", phase, focus));
        }
      };
      addGroups(this.config.twoCharacterGroupCount, 2, "groups-2");
      addGroups(this.config.threeCharacterGroupCount, 3, "groups-3");
    }

    return q;
  }

  hasNext(): boolean {
    return this.cursor < this.queue.length;
  }

  next(): PlannedExercise | undefined {
    const exercise = this.queue[this.cursor];
    if (exercise) {
      this.cursor += 1;
    }
    return exercise;
  }

  /**
   * Reports the result of the exercise just returned by next(). A missed
   * isolated recognition card inserts one immediate repeat, up to the cap.
   */
  reportResult(correct: boolean, clean = true): { acquisitionCapped?: string } {
    const justDone = this.queue[this.cursor - 1];
    if (!justDone) return {};

    let acquisitionCapped: string | undefined;
    if (justDone.type === "copy-character" && !justDone.assisted) {
      if (!clean) {
        this.queue.splice(
          this.cursor,
          0,
          this.card(
            "copy-character",
            justDone.target,
            "rx",
            justDone.phase,
            justDone.focus,
          ),
        );
      } else if (justDone.phase === "acquire") {
        const results = this.acquisitionResults.get(justDone.focus) ?? [];
        results.push(correct);
        this.acquisitionResults.set(justDone.focus, results);
        if (!this.hasPendingCleanCard("acquire", justDone.focus)) {
          const recent = results.slice(-this.config.acquireRecentWindow);
          const meetsCriterion =
            results.length >= this.config.acquireMinAttempts &&
            recent.filter(Boolean).length >= this.config.acquireMinCorrect;
          if (
            !meetsCriterion &&
            results.length < this.config.acquireMaxAttempts
          ) {
            this.queue.splice(
              this.cursor,
              0,
              this.card(
                "copy-character",
                justDone.focus,
                "rx",
                "acquire",
                justDone.focus,
              ),
            );
          } else if (!meetsCriterion) {
            acquisitionCapped = justDone.focus;
          }
        }
      } else if (justDone.phase === "contrast") {
        this.contrastResults.push(correct);
        if (!this.hasPendingCleanCard("contrast")) {
          const recent = this.contrastResults.slice(
            -this.config.contrastRecentWindow,
          );
          const accuracy =
            recent.filter(Boolean).length / Math.max(1, recent.length);
          if (
            this.contrastResults.length < this.config.contrastMinAttempts ||
            (accuracy < this.config.contrastMinAccuracy &&
              this.contrastResults.length < this.config.contrastMaxAttempts)
          ) {
            this.queue.splice(this.cursor, 0, this.nextContrastCard());
          }
        }
      }
    }

    if (
      !correct &&
      justDone.type === "copy-character" &&
      (justDone.phase === "acquire" ||
        justDone.phase === "contrast" ||
        justDone.phase === "remediate") &&
      !justDone.assisted
    ) {
      this.queue.splice(
        this.cursor,
        0,
        this.card(
          "copy-character",
          justDone.focus,
          "rx",
          justDone.phase,
          justDone.focus,
          true,
        ),
      );
    }
    return acquisitionCapped ? { acquisitionCapped } : {};
  }

  private hasPendingCleanCard(phase: LessonPhase, focus?: string): boolean {
    return this.queue
      .slice(this.cursor)
      .some(
        (card) =>
          card.phase === phase &&
          !card.assisted &&
          (focus === undefined || card.focus === focus),
      );
  }

  private nextContrastCard(): PlannedExercise {
    const focus = this.pickContrastFocus();
    this.contrastTargets.push(focus);
    this.contrastCounts.set(focus, (this.contrastCounts.get(focus) ?? 0) + 1);
    return this.card("copy-character", focus, "rx", "contrast", focus);
  }

  private pickContrastFocus(): string {
    const previous = this.contrastTargets.at(-1);
    const repeated =
      previous !== undefined && this.contrastTargets.at(-2) === previous;
    let candidates = repeated
      ? this.active.filter((character) => character !== previous)
      : [...this.active];
    if (candidates.length === 0) candidates = [...this.active];

    if (this.active.length === 2) {
      const minimum = Math.min(
        ...candidates.map(
          (character) => this.contrastCounts.get(character) ?? 0,
        ),
      );
      candidates = candidates.filter(
        (character) => (this.contrastCounts.get(character) ?? 0) === minimum,
      );
    } else {
      const required = candidates.filter((character) => {
        if ((this.contrastCounts.get(character) ?? 0) > 0) return false;
        return (
          this.reviewChars.includes(character) ||
          this.active.length <= this.config.contrastMinAttempts
        );
      });
      if (required.length > 0) candidates = required;
    }

    const weighted = candidates.flatMap((character) => {
      const weight =
        1 +
        (character === this.newest ? 1 : 0) +
        (this.reviewChars.includes(character) ? 2 : 0) +
        (this.weakChars.has(character) ? 1 : 0);
      return new Array<string>(weight).fill(character);
    });
    return pick(weighted, this.rng);
  }

  get length(): number {
    return this.queue.length;
  }

  get position(): number {
    return this.cursor;
  }
}
