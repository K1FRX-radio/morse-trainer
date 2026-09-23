import { describe, expect, it } from "vitest";
import {
  DEFAULT_CURRICULUM_CONFIG,
  type CurriculumConfig,
} from "../content/curriculum-data.ts";
import {
  createInitialState,
  newestCharacter,
  recordAttempt,
  recordReviewOutcome,
  unlockedCharacters,
  DEFAULT_REMEDIATION_STREAK,
  type CurriculumState,
} from "./curriculum.ts";
import type { Direction } from "./types.ts";

const config: CurriculumConfig = {
  ...DEFAULT_CURRICULUM_CONFIG,
  order: ["K", "M", "U", "R", "E"],
  startCount: 2,
  windowSize: 10,
  minNewCharObservations: 5,
  reviewDecayAccuracy: 0.7,
};

function feed(
  state: CurriculumState,
  character: string,
  direction: Direction,
  results: boolean[],
) {
  for (const correct of results) {
    recordAttempt(state, character, direction, correct);
  }
}

describe("curriculum state", () => {
  it("starts with the configured number of characters", () => {
    const state = createInitialState(config);
    expect(unlockedCharacters(state)).toEqual(["K", "M"]);
    expect(newestCharacter(state)?.character).toBe("M");
  });

  it("caps the rolling window to windowSize", () => {
    const state = createInitialState(config);
    feed(state, "M", "rx", new Array(20).fill(true));
    expect(newestCharacter(state)?.rx.recentResults.length).toBe(
      config.windowSize,
    );
    expect(newestCharacter(state)?.rx.totalAttempts).toBe(20);
  });
});

describe("recordReviewOutcome", () => {
  function flagged(): CurriculumState {
    const state = createInitialState(config);
    state.characters[0].needsReview = true;
    state.characters[0].reviewStreak = 0;
    return state;
  }

  it("does not clear a review flag from a single correct response", () => {
    const state = flagged();
    recordReviewOutcome(state, "K", true);
    expect(state.characters[0].needsReview).toBe(true);
    expect(state.characters[0].reviewStreak).toBe(1);
  });

  it("clears the flag after the configured clean streak", () => {
    const state = flagged();
    for (let i = 0; i < DEFAULT_REMEDIATION_STREAK; i++) {
      recordReviewOutcome(state, "K", true);
    }
    expect(state.characters[0].needsReview).toBe(false);
    expect(state.characters[0].reviewStreak).toBe(0);
  });

  it("resets the streak on a miss", () => {
    const state = flagged();
    recordReviewOutcome(state, "K", true);
    recordReviewOutcome(state, "K", true);
    recordReviewOutcome(state, "K", false);
    expect(state.characters[0].reviewStreak).toBe(0);
    recordReviewOutcome(state, "K", true);
    expect(state.characters[0].needsReview).toBe(true);
  });

  it("does not pre-accumulate a streak before review is required", () => {
    const state = createInitialState(config);
    for (let i = 0; i < DEFAULT_REMEDIATION_STREAK; i++) {
      recordReviewOutcome(state, "K", true);
    }
    expect(state.characters[0].reviewStreak).toBe(0);
  });

  it("requires a fresh streak after rolling accuracy triggers review", () => {
    const state = createInitialState(config);
    state.characters[0].reviewStreak = DEFAULT_REMEDIATION_STREAK - 1;
    feed(state, "K", "rx", [false, false, false, false, false]);

    expect(state.characters[0].needsReview).toBe(true);
    expect(state.characters[0].reviewStreak).toBe(0);

    recordReviewOutcome(state, "K", true);
    recordReviewOutcome(state, "K", true);
    expect(state.characters[0].needsReview).toBe(true);
    recordReviewOutcome(state, "K", true);
    expect(state.characters[0].needsReview).toBe(false);
  });
});
