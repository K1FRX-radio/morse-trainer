// Minimal deterministic adaptive scheduler. Selects the next character to
// practice from unlocked characters only, weighted toward the newest and
// weakest, and returns a reason code. Fuller weighting lands in a later phase.

import type { CurriculumState } from "./curriculum.ts";
import { recentAccuracy } from "./curriculum.ts";
import type { Rng } from "./rng.ts";
import { weightedIndex } from "./rng.ts";
import type { ExerciseSelection, SchedulerReason } from "./types.ts";

export type SchedulerWeights = {
  /** Bonus applied to the newest unlocked character. */
  newest: number;
  /** Scales the weight added for weak RX accuracy. */
  weakRx: number;
  /** Baseline weight so every unlocked character stays reachable. */
  base: number;
};

export const DEFAULT_SCHEDULER_WEIGHTS: SchedulerWeights = {
  newest: 3,
  weakRx: 4,
  base: 1,
};

function reasonFor(
  isNewest: boolean,
  accuracy: number,
  weights: SchedulerWeights,
): SchedulerReason {
  if (isNewest) {
    return "NEW_CHARACTER";
  }
  if (weights.weakRx * (1 - accuracy) >= weights.newest) {
    return "WEAK_RX";
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
  weights: SchedulerWeights = DEFAULT_SCHEDULER_WEIGHTS,
): ExerciseSelection {
  const characters = state.characters;
  if (characters.length === 0) {
    throw new Error("selectExercise requires at least one unlocked character");
  }

  const newestIndex = characters.length - 1;
  const weightValues = characters.map((progress, index) => {
    const accuracy = recentAccuracy(progress.rx);
    let weight = weights.base + weights.weakRx * (1 - accuracy);
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
      recentAccuracy(progress.rx),
      weights,
    ),
  };
}
