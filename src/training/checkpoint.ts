// Unassisted RX-only checkpoint: the assessment that advances the curriculum.
// Isolated characters are sampled across the active set with guaranteed newest
// coverage; correctness is withheld until the end. Pure and seedable. Advancement
// is at most one character per passed checkpoint.

import {
  DEFAULT_CHECKPOINT_CONFIG,
  type CheckpointConfig,
} from "../content/curriculum-data.ts";
import { forceUnlockNext, type CurriculumState } from "../core/curriculum.ts";
import type { Rng } from "../core/rng.ts";
import { normalizeCopy } from "../core/scoring.ts";

/**
 * The minimum items needed to give every active character coverage and the
 * newest character its minimum observations.
 */
function requiredLength(activeCount: number, config: CheckpointConfig): number {
  const minNewest = Math.max(1, config.minNewestObservations);
  return activeCount - 1 + minNewest;
}

/**
 * The checkpoint length for an active-set size: grows with the set within the
 * configured bounds, but is raised when needed to guarantee full coverage. Throws
 * if the configured capacity cannot cover the active set (a config error).
 */
export function checkpointLength(
  activeCount: number,
  config: CheckpointConfig = DEFAULT_CHECKPOINT_CONFIG,
): number {
  if (activeCount < 1) {
    throw new RangeError("checkpoint requires at least one active character");
  }
  const required = requiredLength(activeCount, config);
  if (required > config.maxLength) {
    throw new RangeError(
      `checkpoint maxLength ${config.maxLength} cannot cover ${activeCount} active ` +
        `characters with ${config.minNewestObservations} newest observations ` +
        `(needs ${required})`,
    );
  }
  const base = Math.min(
    config.maxLength,
    Math.max(config.minLength, Math.round(activeCount * config.itemsPerActive)),
  );
  return Math.max(base, required);
}

/**
 * Builds the isolated-character checkpoint sequence with guaranteed balance:
 * every active character appears, the newest appears at least its minimum,
 * remaining slots approach the desired newest share and are otherwise spread
 * evenly across the other characters, then a seeded shuffle sets the order.
 * Coverage never depends on randomness.
 */
export function buildCheckpoint(
  active: readonly string[],
  newest: string,
  rng: Rng,
  config: CheckpointConfig = DEFAULT_CHECKPOINT_CONFIG,
): string[] {
  if (active.length === 0) {
    throw new RangeError("checkpoint requires active characters");
  }
  const length = checkpointLength(active.length, config);
  const others = active.filter((c) => c !== newest);
  const minNewest = Math.max(1, config.minNewestObservations);

  // Priority: coverage, then newest minimum, then desired newest share (capped so
  // every other character keeps its one slot), then even repetitions of others.
  const desiredNewest = Math.round(length * config.newestShare);
  const targetNewest = Math.min(
    Math.max(minNewest, desiredNewest),
    length - others.length,
  );

  const counts = new Map<string, number>();
  for (const c of active) {
    counts.set(c, c === newest ? targetNewest : 1);
  }

  let total = [...counts.values()].reduce((a, b) => a + b, 0);
  if (others.length === 0) {
    counts.set(newest, length); // single-character edge case
    total = length;
  }
  // Round-robin the remaining slots across the other characters for even spread.
  let cursor = 0;
  while (total < length && others.length > 0) {
    const c = others[cursor % others.length];
    counts.set(c, (counts.get(c) ?? 0) + 1);
    cursor += 1;
    total += 1;
  }

  const items: string[] = [];
  for (const c of active) {
    for (let i = 0; i < (counts.get(c) ?? 0); i++) {
      items.push(c);
    }
  }

  // Deterministic Fisher-Yates shuffle (ordering only; coverage already fixed).
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

export type CheckpointResult = {
  pass: boolean;
  overallAccuracy: number;
  newestAccuracy: number;
  newestObservations: number;
  total: number;
  correct: number;
  /** Characters missed at least once, for targeted review after the checkpoint. */
  missedCharacters: string[];
};

export function gradeCheckpoint(
  targets: readonly string[],
  answers: readonly string[],
  newest: string,
  config: CheckpointConfig = DEFAULT_CHECKPOINT_CONFIG,
): CheckpointResult {
  const total = targets.length;
  let correct = 0;
  let newestTotal = 0;
  let newestCorrect = 0;
  const missed = new Set<string>();

  targets.forEach((target, index) => {
    const ok = normalizeCopy(answers[index] ?? "") === normalizeCopy(target);
    if (ok) {
      correct += 1;
    } else {
      missed.add(target);
    }
    if (target === newest) {
      newestTotal += 1;
      if (ok) newestCorrect += 1;
    }
  });

  const overallAccuracy = total === 0 ? 0 : correct / total;
  const newestAccuracy = newestTotal === 0 ? 0 : newestCorrect / newestTotal;
  const pass =
    total > 0 &&
    overallAccuracy >= config.overallAccuracy &&
    newestTotal >= config.minNewestObservations &&
    newestAccuracy >= config.newestAccuracy;

  return {
    pass,
    overallAccuracy,
    newestAccuracy,
    newestObservations: newestTotal,
    total,
    correct,
    missedCharacters: [...missed],
  };
}

type CheckpointOptions = {
  active: readonly string[];
  newest: string;
  rng: Rng;
  config?: CheckpointConfig;
};

/** Drives a checkpoint one isolated character at a time, without feedback. */
export class CheckpointSession {
  private readonly targets: string[];
  private readonly answers: string[] = [];
  private readonly newest: string;
  private readonly config: CheckpointConfig;
  private cursor = 0;

  constructor(options: CheckpointOptions) {
    this.newest = options.newest;
    this.config = options.config ?? DEFAULT_CHECKPOINT_CONFIG;
    this.targets = buildCheckpoint(
      options.active,
      options.newest,
      options.rng,
      this.config,
    );
  }

  get length(): number {
    return this.targets.length;
  }

  get position(): number {
    return this.cursor;
  }

  current(): string | undefined {
    return this.targets[this.cursor];
  }

  /** Records the answer to the current item and advances. No feedback. */
  answer(input: string): void {
    if (this.cursor >= this.targets.length) {
      return;
    }
    this.answers[this.cursor] = input;
    this.cursor += 1;
  }

  isComplete(): boolean {
    return this.cursor >= this.targets.length;
  }

  grade(): CheckpointResult {
    return gradeCheckpoint(this.targets, this.answers, this.newest, this.config);
  }
}

export type CheckpointApplied = {
  result: CheckpointResult;
  /** The character unlocked by a pass, if any (at most one). */
  unlockedCharacter?: string;
};

/**
 * Applies a checkpoint result: flags missed characters for review (pass or
 * fail), and on a pass unlocks the next character (at most one).
 */
export function applyCheckpoint(
  state: CurriculumState,
  result: CheckpointResult,
  at?: string,
): CheckpointApplied {
  for (const character of result.missedCharacters) {
    const progress = state.characters.find((c) => c.character === character);
    if (progress) {
      progress.needsReview = true;
      progress.reviewStreak = 0; // require a fresh clean streak to clear
    }
  }
  if (!result.pass) {
    return { result };
  }
  const unlocked = forceUnlockNext(state, at);
  return unlocked ? { result, unlockedCharacter: unlocked } : { result };
}
