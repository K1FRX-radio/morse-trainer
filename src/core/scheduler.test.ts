import { describe, expect, it } from "vitest";
import { DEFAULT_CURRICULUM_CONFIG } from "../content/curriculum-data.ts";
import {
  createInitialState,
  recordAttempt,
  unlockedCharacters,
} from "./curriculum.ts";
import { createRng } from "./rng.ts";
import {
  buildSendTarget,
  buildSendWordTarget,
  selectExercise,
} from "./scheduler.ts";

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

  it("builds 2- and 3-character send targets using only unlocked characters", () => {
    const state = createInitialState(config);
    const allowed = new Set(unlockedCharacters(state));
    const rng = createRng(61);

    for (let i = 0; i < 200; i++) {
      const pair = buildSendTarget(state, rng, 2);
      const triple = buildSendTarget(state, rng, 3);
      expect(pair.target.length).toBe(2);
      expect(triple.target.length).toBe(3);
      for (const character of pair.target) {
        expect(allowed.has(character)).toBe(true);
      }
      for (const character of triple.target) {
        expect(allowed.has(character)).toBe(true);
      }
    }
  });

  it("always includes the adaptive focus character inside generated groups", () => {
    const state = createInitialState(config);
    const group = buildSendTarget(state, () => 0, 3, {
      K: 0,
      M: 1,
      U: 1,
      R: 1,
    });
    expect(group.target.includes(group.focusCharacter)).toBe(true);
    expect(group.focusCharacter).toBe("K");
    expect(group.reason).toBe("WEAK_TX");
  });

  it("buildSendTarget is deterministic with injected RNG", () => {
    const left = createInitialState(config);
    const right = createInitialState(config);
    const rngA = createRng(222);
    const rngB = createRng(222);
    const runA = Array.from({ length: 100 }, () =>
      buildSendTarget(left, rngA, 3, {
        K: 0.4,
        M: 0.9,
        U: 0.2,
        R: 0.7,
      }),
    );
    const runB = Array.from({ length: 100 }, () =>
      buildSendTarget(right, rngB, 3, {
        K: 0.4,
        M: 0.9,
        U: 0.2,
        R: 0.7,
      }),
    );
    expect(runA).toEqual(runB);
  });

  it("buildSendWordTarget uses unlocked characters only", () => {
    const state = createInitialState({
      ...config,
      order: ["A", "N", "E", "T", "M"],
      startCount: 5,
    });
    const allowed = new Set(unlockedCharacters(state));
    const rng = createRng(101);

    for (let i = 0; i < 200; i++) {
      const selection = buildSendWordTarget(state, rng, {
        minimumLength: 2,
        maximumLength: 4,
      });
      expect(selection.target).toBeDefined();
      for (const character of selection.target ?? "") {
        expect(allowed.has(character)).toBe(true);
      }
    }
  });

  it("buildSendWordTarget prefers words containing the adaptive focus", () => {
    const state = createInitialState({
      ...config,
      order: ["A", "M", "N"],
      startCount: 3,
    });
    const selection = buildSendWordTarget(state, () => 0.2, {
      minimumLength: 2,
      maximumLength: 4,
      performance: {
        A: 1,
        M: 0,
        N: 1,
      },
    });

    expect(selection.focusCharacter).toBe("M");
    expect(selection.reason).toBe("WEAK_TX");
    expect(selection.target).toBeDefined();
    expect(selection.target).toContain("M");
  });

  it("buildSendWordTarget is deterministic with seeded RNG", () => {
    const left = createInitialState(config);
    const right = createInitialState(config);
    const rngA = createRng(555);
    const rngB = createRng(555);
    const runA = Array.from({ length: 100 }, () =>
      buildSendWordTarget(left, rngA, {
        minimumLength: 2,
        maximumLength: 4,
        performance: { K: 0.2, M: 0.9, U: 0.4, R: 0.8 },
      }),
    );
    const runB = Array.from({ length: 100 }, () =>
      buildSendWordTarget(right, rngB, {
        minimumLength: 2,
        maximumLength: 4,
        performance: { K: 0.2, M: 0.9, U: 0.4, R: 0.8 },
      }),
    );
    expect(runA).toEqual(runB);
  });

  it("buildSendWordTarget returns undefined target when no words are eligible", () => {
    const state = createInitialState({
      ...config,
      order: ["K"],
      startCount: 1,
    });

    const selection = buildSendWordTarget(state, createRng(7), {
      minimumLength: 2,
      maximumLength: 4,
    });

    expect(selection.target).toBeUndefined();
    expect(selection.focusCharacter).toBe("K");
  });
});
