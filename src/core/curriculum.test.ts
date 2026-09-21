import { describe, expect, it } from "vitest";
import {
  DEFAULT_CURRICULUM_CONFIG,
  type CurriculumConfig,
} from "../content/curriculum-data.ts";
import {
  canUnlockNext,
  createInitialState,
  newestCharacter,
  recordAttempt,
  unlockNext,
  unlockedCharacters,
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
