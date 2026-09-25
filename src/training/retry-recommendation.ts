import { SETTING_RANGES } from "../core/settings.ts";
import type { AdvancementReason } from "./advancement.ts";
import { DEFAULT_LESSON_CONFIG } from "./lesson-plan.ts";

export type RetryAction = "long-copy" | "full-lesson";

export type SpacingRecommendation = {
  charWpm: number;
  currentEffectiveWpm: number;
  effectiveWpm: number;
};

export type RetryRecommendation = {
  emphasizedAction: RetryAction;
  spacing?: SpacingRecommendation;
};

export type RetryRecommendationInput = {
  reason: AdvancementReason;
  isolatedObservations: number;
  isolatedAccuracy: number;
  hasMinimumIsolatedSample: boolean;
  shouldSuggestSpacing: boolean;
  charWpm: number;
  effectiveWpm: number;
};

const ACCURACY_MISS_REASONS: readonly AdvancementReason[] = [
  "LOW_OVERALL_ACCURACY",
  "LOW_NEWEST_ACCURACY",
];

/** Chooses retry emphasis without changing readiness or progression state. */
export function recommendRetry(
  input: RetryRecommendationInput,
): RetryRecommendation {
  const weakIsolatedPerformance =
    input.reason === "NEEDS_REVIEW" ||
    (input.hasMinimumIsolatedSample &&
      input.isolatedObservations > 0 &&
      input.isolatedAccuracy < DEFAULT_LESSON_CONFIG.contrastMinAccuracy);
  const emphasizedAction: RetryAction = weakIsolatedPerformance
    ? "full-lesson"
    : "long-copy";
  const canAddSpacing =
    input.shouldSuggestSpacing &&
    ACCURACY_MISS_REASONS.includes(input.reason) &&
    input.effectiveWpm > SETTING_RANGES.effectiveWpm.min;

  if (!canAddSpacing) return { emphasizedAction };
  return {
    emphasizedAction,
    spacing: {
      charWpm: input.charWpm,
      currentEffectiveWpm: input.effectiveWpm,
      effectiveWpm: Math.max(
        SETTING_RANGES.effectiveWpm.min,
        input.effectiveWpm - 2,
      ),
    },
  };
}
