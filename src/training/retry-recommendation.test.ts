import { describe, expect, it } from "vitest";
import { SETTING_RANGES } from "../core/settings.ts";
import type { AdvancementReason } from "./advancement.ts";
import { recommendRetry } from "./retry-recommendation.ts";

function recommendation(
  reason: AdvancementReason,
  overrides: Partial<Parameters<typeof recommendRetry>[0]> = {},
) {
  return recommendRetry({
    reason,
    isolatedObservations: 12,
    isolatedAccuracy: 1,
    hasMinimumIsolatedSample: true,
    shouldSuggestSpacing: false,
    charWpm: 20,
    effectiveWpm: 12,
    ...overrides,
  });
}

describe("recommendRetry", () => {
  it("emphasizes long copy when isolated work is strong", () => {
    expect(recommendation("LOW_OVERALL_ACCURACY")).toEqual({
      emphasizedAction: "long-copy",
    });
    expect(recommendation("INCOMPLETE_ACTIVE_COVERAGE")).toEqual({
      emphasizedAction: "long-copy",
    });
  });

  it("emphasizes a full lesson when isolated work is weak", () => {
    expect(
      recommendation("LOW_OVERALL_ACCURACY", { isolatedAccuracy: 0.75 }),
    ).toEqual({ emphasizedAction: "full-lesson" });
    expect(recommendation("NEEDS_REVIEW")).toEqual({
      emphasizedAction: "full-lesson",
    });
  });

  it("does not infer weakness without the minimum isolated sample", () => {
    expect(
      recommendation("LOW_OVERALL_ACCURACY", {
        isolatedObservations: 3,
        isolatedAccuracy: 0.5,
        hasMinimumIsolatedSample: false,
      }),
    ).toEqual({ emphasizedAction: "long-copy" });
  });

  it("offers two WPM of additional spacing after repeated accuracy misses", () => {
    expect(
      recommendation("LOW_NEWEST_ACCURACY", {
        shouldSuggestSpacing: true,
      }),
    ).toEqual({
      emphasizedAction: "long-copy",
      spacing: {
        charWpm: 20,
        currentEffectiveWpm: 12,
        effectiveWpm: 10,
      },
    });
  });

  it("does not suggest spacing for coverage-only results or at the minimum", () => {
    expect(
      recommendation("INCOMPLETE_ACTIVE_COVERAGE", {
        shouldSuggestSpacing: true,
      }),
    ).toEqual({ emphasizedAction: "long-copy" });
    expect(
      recommendation("LOW_OVERALL_ACCURACY", {
        shouldSuggestSpacing: true,
        effectiveWpm: SETTING_RANGES.effectiveWpm.min,
      }),
    ).toEqual({ emphasizedAction: "long-copy" });
  });
});
