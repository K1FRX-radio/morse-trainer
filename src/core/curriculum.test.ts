import { describe, expect, it } from "vitest";
import {
  DEFAULT_CURRICULUM_CONFIG,
  type CurriculumConfig,
} from "../content/curriculum-data.ts";
import {
  canUnlockNext,
  checkpointReadiness,
  createInitialState,
  newestCharacter,
  recordAttempt,
  recordReviewOutcome,
  unlockNext,
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
  unlockAccuracy: 0.9,
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

describe("curriculum unlocks", () => {
  it("starts with the configured number of characters", () => {
    const state = createInitialState(config);
    expect(unlockedCharacters(state)).toEqual(["K", "M"]);
    expect(newestCharacter(state)?.character).toBe("M");
  });

  it("unlocks the next character once RX accuracy and sample size are met", () => {
    const state = createInitialState(config);
    feed(state, "M", "rx", [true, true, true, true, true, true]);
    expect(canUnlockNext(state)).toBe(true);
    expect(unlockNext(state)).toBe("U");
    expect(unlockedCharacters(state)).toEqual(["K", "M", "U"]);
  });

  it("does not unlock below the accuracy threshold", () => {
    const state = createInitialState(config);
    // 3/6 correct = 50% over 6 observations.
    feed(state, "M", "rx", [true, false, true, false, true, false]);
    expect(canUnlockNext(state)).toBe(false);
    expect(unlockNext(state)).toBeUndefined();
    expect(unlockedCharacters(state)).toEqual(["K", "M"]);
  });

  it("does not unlock before the minimum observation count", () => {
    const state = createInitialState(config);
    // Perfect but only 3 observations (< minNewCharObservations of 5).
    feed(state, "M", "rx", [true, true, true]);
    expect(canUnlockNext(state)).toBe(false);
  });

  it("keeps RX unlocks independent of TX performance", () => {
    const state = createInitialState(config);
    feed(state, "M", "tx", [false, false, false, false, false, false]);
    feed(state, "M", "rx", [true, true, true, true, true, true]);
    expect(canUnlockNext(state)).toBe(true);
    expect(unlockNext(state)).toBe("U");
  });

  it("never relocks an unlocked character", () => {
    const state = createInitialState(config);
    feed(state, "M", "rx", [true, true, true, true, true, true]);
    unlockNext(state);
    // Now tank U's accuracy; it must remain unlocked.
    feed(state, "U", "rx", [false, false, false, false, false, false]);
    expect(unlockedCharacters(state)).toContain("U");
    expect(unlockedCharacters(state)).toEqual(["K", "M", "U"]);
  });

  it("stops unlocking after the last character", () => {
    const state = createInitialState({ ...config, startCount: 5 });
    feed(state, "E", "rx", [true, true, true, true, true, true]);
    expect(canUnlockNext(state)).toBe(false);
    expect(unlockNext(state)).toBeUndefined();
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

describe("checkpointReadiness", () => {
  function readyState(): CurriculumState {
    const state = createInitialState(config);
    feed(state, "K", "rx", new Array(10).fill(true));
    feed(state, "M", "rx", new Array(10).fill(true));
    return state;
  }

  it("lets an unresolved older character veto otherwise-ready statistics", () => {
    const state = readyState();
    state.characters[0].needsReview = true;

    expect(checkpointReadiness(state)).toEqual({
      ready: false,
      reason: "NEEDS_REVIEW",
      weakCharacter: "K",
    });
  });

  it("lets an unresolved newest character veto otherwise-ready statistics", () => {
    const state = readyState();
    state.characters[1].needsReview = true;

    expect(checkpointReadiness(state)).toEqual({
      ready: false,
      reason: "NEEDS_REVIEW",
      weakCharacter: "M",
    });
  });

  it("becomes ready only after the full remediation streak", () => {
    const state = readyState();
    state.characters[0].needsReview = true;

    recordReviewOutcome(state, "K", true);
    recordReviewOutcome(state, "K", true);
    expect(checkpointReadiness(state).ready).toBe(false);

    recordReviewOutcome(state, "K", true);
    expect(checkpointReadiness(state)).toEqual({
      ready: true,
      reason: "READY",
    });
  });
});
