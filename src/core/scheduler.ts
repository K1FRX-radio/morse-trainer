// Minimal deterministic adaptive scheduler. Selects the next character to
// practice from unlocked characters only, weighted toward the newest and
// weakest, and returns a reason code. Fuller weighting lands in a later phase.

import type { CurriculumState } from "./curriculum.ts";
import { recentAccuracy } from "./curriculum.ts";
import type { Rng } from "./rng.ts";
import { weightedIndex } from "./rng.ts";
import type { ExerciseSelection, SchedulerReason } from "./types.ts";
import { eligibleWords } from "../content/words.ts";

type SchedulerDirection = "rx" | "tx";

export type SchedulerPerformance = Partial<Record<string, number>>;

export type SchedulerOptions = {
  direction?: SchedulerDirection;
  performance?: SchedulerPerformance;
};

export type SendTargetLength = 1 | 2 | 3;

export type SendTargetSelection = {
  target: string;
  focusCharacter: string;
  reason: SchedulerReason;
};

export type SendWordTargetSelection = {
  target: string | undefined;
  focusCharacter: string;
  reason: SchedulerReason;
};

export type SendWordTargetOptions = {
  minimumLength: number;
  maximumLength: number;
  performance?: SchedulerPerformance;
};

export type SchedulerWeights = {
  /** Bonus applied to the newest unlocked character. */
  newest: number;
  /** Scales the weight added for weak RX accuracy. */
  weakRx: number;
  /** Scales the weight added for weak TX accuracy. */
  weakTx: number;
  /** Baseline weight so every unlocked character stays reachable. */
  base: number;
};

export const DEFAULT_SCHEDULER_WEIGHTS: SchedulerWeights = {
  newest: 3,
  weakRx: 4,
  weakTx: 4,
  base: 1,
};

function clampAccuracy(accuracy: number): number {
  if (!Number.isFinite(accuracy)) {
    return 0;
  }
  return Math.max(0, Math.min(1, accuracy));
}

function recentByDirection(
  state: CurriculumState,
  index: number,
  direction: SchedulerDirection,
): number {
  const progress = state.characters[index];
  return direction === "rx"
    ? recentAccuracy(progress.rx)
    : recentAccuracy(progress.tx);
}

function accuracyFor(
  state: CurriculumState,
  index: number,
  direction: SchedulerDirection,
  performance: SchedulerPerformance,
): number {
  const character = state.characters[index].character;
  const fromPerformance = performance[character];
  if (fromPerformance !== undefined) {
    return clampAccuracy(fromPerformance);
  }
  return clampAccuracy(recentByDirection(state, index, direction));
}

function reasonFor(
  isNewest: boolean,
  accuracy: number,
  direction: SchedulerDirection,
  weights: SchedulerWeights,
): SchedulerReason {
  if (isNewest) {
    return "NEW_CHARACTER";
  }
  const weakWeight = direction === "tx" ? weights.weakTx : weights.weakRx;
  if (weakWeight * (1 - accuracy) >= weights.newest) {
    return direction === "tx" ? "WEAK_TX" : "WEAK_RX";
  }
  return "BALANCED_PRACTICE";
}

/**
 * Deterministically selects a character to practice given a seeded RNG. Only
 * unlocked characters can be returned.
 */
export function selectExercise(
  state: CurriculumState,
  rng: Rng,
  options: SchedulerOptions = {},
  weights: SchedulerWeights = DEFAULT_SCHEDULER_WEIGHTS,
): ExerciseSelection {
  const direction = options.direction ?? "rx";
  const performance = options.performance ?? {};
  const characters = state.characters;
  if (characters.length === 0) {
    throw new Error("selectExercise requires at least one unlocked character");
  }

  const newestIndex = characters.length - 1;
  const weightValues = characters.map((_progress, index) => {
    const accuracy = accuracyFor(state, index, direction, performance);
    const weakWeight = direction === "tx" ? weights.weakTx : weights.weakRx;
    let weight = weights.base + weakWeight * (1 - accuracy);
    if (index === newestIndex) {
      weight += weights.newest;
    }
    return weight;
  });

  const chosen = weightedIndex(weightValues, rng);
  const progress = characters[chosen];
  return {
    character: progress.character,
    reason: reasonFor(
      chosen === newestIndex,
      accuracyFor(state, chosen, direction, performance),
      direction,
      weights,
    ),
  };
}

/**
 * Builds a deterministic Send Practice target around an adaptive TX focus
 * character while mixing additional unlocked characters.
 */
export function buildSendTarget(
  state: CurriculumState,
  rng: Rng,
  length: SendTargetLength,
  performance: SchedulerPerformance = {},
): SendTargetSelection {
  if (!Number.isInteger(length) || length < 1) {
    throw new Error("buildSendTarget requires a positive integer length");
  }
  const focus = selectExercise(state, rng, {
    direction: "tx",
    performance,
  });
  if (length === 1) {
    return {
      target: focus.character,
      focusCharacter: focus.character,
      reason: focus.reason,
    };
  }

  const unlocked = state.characters.map((progress) => progress.character);
  const chars = Array.from({ length }, () => {
    const index = Math.floor(rng() * unlocked.length);
    return unlocked[index];
  });
  const focusIndex = Math.floor(rng() * length);
  chars[focusIndex] = focus.character;
  return {
    target: chars.join(""),
    focusCharacter: focus.character,
    reason: focus.reason,
  };
}

/**
 * Builds a deterministic Send Practice word target composed only of unlocked
 * characters. The adaptive TX focus character is preferred whenever eligible
 * candidates include it.
 */
export function buildSendWordTarget(
  state: CurriculumState,
  rng: Rng,
  options: SendWordTargetOptions,
): SendWordTargetSelection {
  const performance = options.performance ?? {};
  const focus = selectExercise(state, rng, {
    direction: "tx",
    performance,
  });
  const unlocked = state.characters.map((progress) => progress.character);
  const candidates = eligibleWords(unlocked).filter(
    (word) =>
      word.text.length >= options.minimumLength &&
      word.text.length <= options.maximumLength,
  );
  if (candidates.length === 0) {
    return {
      target: undefined,
      focusCharacter: focus.character,
      reason: focus.reason,
    };
  }

  const weights = candidates.map((word) => {
    const characters = new Set(word.text.split(""));
    let weakBonus = 0;
    for (const character of characters) {
      const accuracy = performance[character];
      if (accuracy === undefined) {
        continue;
      }
      weakBonus += 1 - clampAccuracy(accuracy);
    }
    return 1 + (word.text.includes(focus.character) ? 4 : 0) + weakBonus;
  });

  return {
    target: candidates[weightedIndex(weights, rng)]?.text,
    focusCharacter: focus.character,
    reason: focus.reason,
  };
}
