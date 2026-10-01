import { describe, expect, it } from "vitest";
import { DEFAULT_CURRICULUM_CONFIG } from "../content/curriculum-data.ts";
import {
  createInitialState,
  recordAttempt,
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

  it("flags weak non-newest characters as WEAK_TX for TX scheduling", () => {
    const state = createInitialState(config);
    // Choose the first slot by forcing K accuracy weakest via performance map.
    const selection = selectExercise(
      state,
      () => 0,
      {
        direction: "tx",
        performance: {
          K: 0,
          M: 1,
          U: 1,
          R: 1,
        },
      },
      {
        base: 1,
        newest: 3,
        weakRx: 4,
        weakTx: 4,
      },
    );
    expect(selection.character).toBe("K");
    expect(selection.reason).toBe("WEAK_TX");
  });

  it("keeps all unlocked characters reachable in TX scheduling", () => {
    const state = createInitialState(config);
    const allowed = new Set(unlockedCharacters(state));
    const seen = new Set<string>();
    const rng = createRng(9001);
    for (let i = 0; i < 10000; i++) {
      const selection = selectExercise(state, rng, {
        direction: "tx",
      });
      expect(allowed.has(selection.character)).toBe(true);
      seen.add(selection.character);
    }
    expect(seen).toEqual(allowed);
  });

  it("is deterministic for TX when given a fixed seed and performance map", () => {
    const left = createInitialState(config);
    const right = createInitialState(config);
    const performance = { K: 0.8, M: 0.4, U: 0.2, R: 0.6 };
    const rngA = createRng(77);
    const rngB = createRng(77);
    const a = Array.from({ length: 200 }, () =>
      selectExercise(left, rngA, {
        direction: "tx",
        performance,
      }),
    );
    const b = Array.from({ length: 200 }, () =>
      selectExercise(right, rngB, {
        direction: "tx",
        performance,
      }),
    );
    expect(a).toEqual(b);
  });
});
