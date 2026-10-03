import { describe, expect, it } from "vitest";
import { DEFAULT_CURRICULUM_CONFIG } from "../content/curriculum-data.ts";
import { createInitialState } from "../core/curriculum.ts";
import {
  deriveCharacterFamiliarity,
  deriveLearnDashboard,
} from "./character-familiarity.ts";

describe("deriveCharacterFamiliarity", () => {
  it("is deterministic for a fixed character progress snapshot", () => {
    const state = createInitialState(DEFAULT_CURRICULUM_CONFIG);
    const progress = state.characters[0];
    progress.rx.recentResults = [true, true, false, true, true];

    expect(deriveCharacterFamiliarity(progress)).toEqual(
      deriveCharacterFamiliarity(progress),
    );
  });

  it("does not over-rank low-sample perfect accuracy", () => {
    const state = createInitialState(DEFAULT_CURRICULUM_CONFIG);
    const lowSample = state.characters[0];
    lowSample.character = "K";
    lowSample.rx.recentResults = [true, true];

    const strong = state.characters[1];
    strong.character = "M";
    strong.rx.recentResults = [
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      false,
      true,
    ];

    const lowSampleView = deriveCharacterFamiliarity(lowSample);
    const strongView = deriveCharacterFamiliarity(strong);

    expect(lowSampleView.level).not.toBe("solid");
    expect(lowSampleView.ringFill).toBeLessThan(strongView.ringFill);
  });

  it("marks review state without mutating curriculum state", () => {
    const state = createInitialState(DEFAULT_CURRICULUM_CONFIG);
    const progress = state.characters[0];
    progress.rx.recentResults = [true, false, true, false, true, true];
    progress.needsReview = true;

    const before = structuredClone(state.characters);
    const view = deriveCharacterFamiliarity(progress);

    expect(view.needsReview).toBe(true);
    expect(state.characters).toEqual(before);
  });
});

describe("deriveLearnDashboard", () => {
  it("reports unlocked/total curriculum progress", () => {
    const state = createInitialState({
      ...DEFAULT_CURRICULUM_CONFIG,
      startCount: 4,
    });
    const dashboard = deriveLearnDashboard(state);
    expect(dashboard.unlocked).toBe(4);
    expect(dashboard.total).toBe(DEFAULT_CURRICULUM_CONFIG.order.length);
    expect(dashboard.curriculumProgress).toBe(
      4 / DEFAULT_CURRICULUM_CONFIG.order.length,
    );
  });
});
