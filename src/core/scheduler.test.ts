import { describe, expect, it } from "vitest";
import { DEFAULT_CURRICULUM_CONFIG } from "../content/curriculum-data.ts";
import {
  createInitialState,
  recordAttempt,
  unlockNext,
  unlockedCharacters,
} from "./curriculum.ts";
import { createRng } from "./rng.ts";
import { selectExercise } from "./scheduler.ts";

const config = {
  ...DEFAULT_CURRICULUM_CONFIG,
  order: ["K", "M", "U", "R", "E", "S", "N", "A"],
  startCount: 4,
  minNewCharObservations: 5,
  windowSize: 20,
};

describe("scheduler", () => {
  it("is reproducible for a given seed", () => {
    const a = createInitialState(config);
    const b = createInitialState(config);
    const runA = Array.from(
      { length: 50 },
      (_, i) => selectExercise(a, createRng(123 + i)).character,
    );
    const runB = Array.from(
      { length: 50 },
      (_, i) => selectExercise(b, createRng(123 + i)).character,
    );
    expect(runA).toEqual(runB);
  });

  it("only ever selects unlocked characters across many draws", () => {
    const state = createInitialState(config);
    unlockNext(state); // no-op without accuracy; keeps 4 unlocked
    const allowed = new Set(unlockedCharacters(state));
    const rng = createRng(42);
    for (let i = 0; i < 10000; i++) {
      const selection = selectExercise(state, rng);
      expect(allowed.has(selection.character)).toBe(true);
    }
  });

  it("labels the newest character selection as NEW_CHARACTER", () => {
    const state = createInitialState(config);
    // Force selection onto the newest character with a stub RNG at weight start.
    const selection = selectExercise(state, () => 0.999999);
    expect(selection.character).toBe("R");
    expect(selection.reason).toBe("NEW_CHARACTER");
  });

  it("flags weak non-newest characters as WEAK_RX", () => {
    const state = createInitialState(config);
    // Make K (oldest) weak; pick the very first slot with rng ~ 0.
    for (let i = 0; i < 10; i++) recordAttempt(state, "K", "rx", false);
    const selection = selectExercise(state, () => 0);
    expect(selection.character).toBe("K");
    expect(selection.reason).toBe("WEAK_RX");
  });
});
