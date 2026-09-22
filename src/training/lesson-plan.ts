// Phase-based Learn lesson plan. Replaces random exercise mixing with a
// deterministic acquisition sequence: introduce every un-introduced active
// character, drill it in isolation (repeating misses), then contrast within the
// active set, short groups, and a few sends. Pure and seedable. Advancement is
// NOT decided here; a separate checkpoint (later stage) drives unlocks.

import type { LearnExerciseType } from "../core/exercises.ts";
import type { Rng } from "../core/rng.ts";
import type { Direction } from "../core/types.ts";

export type LessonPhase =
  | "introduce"
  | "acquire"
  | "remediate"
  | "contrast"
  | "groups";

export type PlannedExercise = {
  type: LearnExerciseType;
  target: string;
  direction: Direction;
  phase: LessonPhase;
  /** The character this card focuses on. */
  focus: string;
  newestCharacter: boolean;
  /** True when this card is an assisted reinforcement after a miss (shows the
   * character + Morse). Assisted cards must not count toward checkpoint
   * readiness. */
  assisted: boolean;
};

export type LessonConfig = {
  /** Isolated reps of each new character right after its introduction. */
  acquirePerNewChar: number;
  /** Mixed isolated recognition cards drawn from the active set. */
  contrastCount: number;
  /** Short group cards. */
  groupCount: number;
  groupMinLen: number;
  groupMaxLen: number;
  /** Isolated unassisted prompts each pending review character receives. */
  remediationPrompts: number;
  /** Cap on immediate repeat cards inserted after misses. */
  maxMissRepeats: number;
};

export const DEFAULT_LESSON_CONFIG: LessonConfig = {
  acquirePerNewChar: 4,
  contrastCount: 6,
  groupCount: 4,
  groupMinLen: 2,
  groupMaxLen: 3,
  remediationPrompts: 3,
  maxMissRepeats: 6,
};

type LessonOptions = {
  /** Unlocked characters in curriculum order. */
  active: readonly string[];
  /** Characters already introduced in earlier sessions. */
  introduced: Iterable<string>;
  /** Newest unlocked character. */
  newest: string;
  /** Active characters flagged for review (targeted remediation). */
  review?: Iterable<string>;
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
  private readonly reviewChars: string[];
  private cursor = 0;
  private insertedRepeats = 0;

  readonly newlyIntroduced: string[];

  constructor(options: LessonOptions) {
    this.config = options.config ?? DEFAULT_LESSON_CONFIG;
    this.newest = options.newest;
    const introduced = new Set(options.introduced);
    const active = options.active;
    const newChars = active.filter((char) => !introduced.has(char));
    const reviewSet = new Set(options.review ?? []);
    this.reviewChars = active.filter(
      (char) => reviewSet.has(char) && !newChars.includes(char),
    );
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
    const emphasis = [...new Set([...newChars, ...this.reviewChars])];
    const focusPool = emphasis.length > 0 ? emphasis : active;

    // Introduce each new character, then drill it in isolation.
    for (const char of newChars) {
      q.push(this.card("introduce", char, "rx", "introduce", char));
      for (let i = 0; i < this.config.acquirePerNewChar; i++) {
        q.push(this.card("copy-character", char, "rx", "acquire", char));
      }
    }

    // Targeted remediation: guaranteed isolated prompts for review characters.
    for (const char of this.reviewChars) {
      for (let i = 0; i < this.config.remediationPrompts; i++) {
        q.push(this.card("copy-character", char, "rx", "remediate", char));
      }
    }

    // Mixed isolated recognition across the active set, favoring new chars.
    for (let i = 0; i < this.config.contrastCount; i++) {
      const focus = rng() < 0.6 ? pick(focusPool, rng) : pick(active, rng);
      q.push(this.card("copy-character", focus, "rx", "contrast", focus));
    }

    // Short groups with a ramping length, each containing the focus character.
    if (active.length > 1) {
      const span = this.config.groupMaxLen - this.config.groupMinLen + 1;
      for (let i = 0; i < this.config.groupCount; i++) {
        const len = Math.min(
          this.config.groupMaxLen,
          this.config.groupMinLen +
            Math.floor((i * span) / Math.max(1, this.config.groupCount)),
        );
        const focus = rng() < 0.6 ? pick(focusPool, rng) : pick(active, rng);
        const group = randomGroup(active, len, focus, rng);
        q.push(this.card("copy-group", group, "rx", "groups", focus));
      }
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
  reportResult(correct: boolean): void {
    const justDone = this.queue[this.cursor - 1];
    if (
      !correct &&
      justDone &&
      justDone.type === "copy-character" &&
      (justDone.phase === "acquire" ||
        justDone.phase === "contrast" ||
        justDone.phase === "remediate") &&
      !justDone.assisted &&
      this.insertedRepeats < this.config.maxMissRepeats
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
      this.insertedRepeats += 1;
    }
  }

  get length(): number {
    return this.queue.length;
  }

  get position(): number {
    return this.cursor;
  }
}
