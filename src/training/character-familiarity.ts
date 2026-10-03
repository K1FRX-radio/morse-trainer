import { recentAccuracy, type CurriculumState } from "../core/curriculum.ts";
import type { CharacterProgress } from "../core/types.ts";

export type FamiliarityLevel = "new" | "learning" | "familiar" | "solid";

export type CharacterFamiliarity = {
  character: string;
  level: FamiliarityLevel;
  ringFill: number;
  observations: number;
  recentAccuracy: number;
  needsReview: boolean;
};

export type LearnDashboard = {
  unlocked: number;
  total: number;
  curriculumProgress: number;
  characters: CharacterFamiliarity[];
};

function clamp01(value: number): number {
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

export function deriveCharacterFamiliarity(
  progress: CharacterProgress,
): CharacterFamiliarity {
  const observations = progress.rx.recentResults.length;
  const accuracy = recentAccuracy(progress.rx);
  const evidenceFactor = clamp01(observations / 20);
  const confidence = evidenceFactor * accuracy;

  let level: FamiliarityLevel;
  let ringFill: number;
  if (observations < 3) {
    level = "new";
    ringFill = 0.1 + evidenceFactor * 0.15;
  } else if (confidence < 0.45) {
    level = "learning";
    ringFill = 0.25 + confidence * 0.4;
  } else if (confidence < 0.75) {
    level = "familiar";
    ringFill = 0.55 + confidence * 0.25;
  } else {
    level = "solid";
    ringFill = 0.8 + confidence * 0.2;
  }

  if (progress.needsReview) {
    ringFill = Math.max(0.2, ringFill - 0.12);
  }

  return {
    character: progress.character,
    level,
    ringFill: clamp01(ringFill),
    observations,
    recentAccuracy: accuracy,
    needsReview: progress.needsReview,
  };
}

export function deriveLearnDashboard(state: CurriculumState): LearnDashboard {
  const unlocked = state.characters.length;
  const total = state.config.order.length;
  return {
    unlocked,
    total,
    curriculumProgress: total === 0 ? 0 : unlocked / total,
    characters: state.characters.map((progress) =>
      deriveCharacterFamiliarity(progress),
    ),
  };
}
