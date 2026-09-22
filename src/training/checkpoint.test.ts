import { describe, expect, it } from "vitest";
import {
  DEFAULT_CHECKPOINT_CONFIG,
  DEFAULT_CURRICULUM_CONFIG,
  KOCH_ORDER,
} from "../content/curriculum-data.ts";
import {
  checkpointReadiness,
  createInitialState,
  forceUnlockNext,
  unlockedCharacters,
  type CurriculumState,
} from "../core/curriculum.ts";
import { createRng } from "../core/rng.ts";
import {
  CheckpointSession,
  applyCheckpoint,
  buildCheckpoint,
  checkpointLength,
  gradeCheckpoint,
  type CheckpointResult,
} from "./checkpoint.ts";

function makeState(activeCount: number): CurriculumState {
  const state = createInitialState(DEFAULT_CURRICULUM_CONFIG);
  while (state.characters.length < activeCount) {
    forceUnlockNext(state);
  }
  return state;
}

function setRx(state: CurriculumState, char: string, results: boolean[]) {
  const progress = state.characters.find((c) => c.character === char);
  if (progress) progress.rx.recentResults = [...results];
}

describe("checkpointLength", () => {
  it("stays within configured bounds across the current curriculum", () => {
    for (let n = 2; n <= KOCH_ORDER.length; n++) {
      const length = checkpointLength(n);
      expect(length).toBeGreaterThanOrEqual(
        DEFAULT_CHECKPOINT_CONFIG.minLength,
      );
      expect(length).toBeLessThanOrEqual(DEFAULT_CHECKPOINT_CONFIG.maxLength);
    }
  });

  it("throws when the configured capacity cannot cover the active set", () => {
    const tiny = { ...DEFAULT_CHECKPOINT_CONFIG, maxLength: 10 };
    expect(() => checkpointLength(20, tiny)).toThrow(RangeError);
  });
});

describe("buildCheckpoint", () => {
  function build(n: number, seed: number) {
    const state = makeState(n);
    const active = unlockedCharacters(state);
    const newest = active[active.length - 1];
    return {
      active,
      newest,
      items: buildCheckpoint(active, newest, createRng(seed)),
    };
  }

  function counts(items: string[]): Record<string, number> {
    const map: Record<string, number> = {};
    for (const c of items) map[c] = (map[c] ?? 0) + 1;
    return map;
  }

  it("covers every active character for all set sizes 2..41", () => {
    for (let n = 2; n <= KOCH_ORDER.length; n++) {
      const { active, newest, items } = build(n, 1);
      expect(items.length).toBe(checkpointLength(n));
      const present = new Set(items);
      for (const character of active) {
        expect(present.has(character)).toBe(true);
      }
      for (const item of items) {
        expect(active).toContain(item);
      }
      const newestCount = items.filter((c) => c === newest).length;
      expect(newestCount).toBeGreaterThanOrEqual(
        DEFAULT_CHECKPOINT_CONFIG.minNewestObservations,
      );
    }
  });

  it("keeps older-character counts balanced (differ by at most one)", () => {
    const { active, newest, items } = build(6, 3);
    const others = active.filter((c) => c !== newest);
    const otherCounts = others.map((c) => items.filter((x) => x === c).length);
    expect(
      Math.max(...otherCounts) - Math.min(...otherCounts),
    ).toBeLessThanOrEqual(1);
  });

  it("is deterministic for identical seeds", () => {
    expect(build(8, 5).items).toEqual(build(8, 5).items);
  });

  it("changes order but not coverage for different seeds", () => {
    const a = build(8, 5);
    const b = build(8, 9);
    expect(a.items).not.toEqual(b.items);
    expect(counts(a.items)).toEqual(counts(b.items));
  });

  it("throws for an impossible configuration", () => {
    const active = unlockedCharacters(makeState(20));
    const tiny = { ...DEFAULT_CHECKPOINT_CONFIG, maxLength: 10 };
    expect(() =>
      buildCheckpoint(active, active[active.length - 1], createRng(1), tiny),
    ).toThrow(RangeError);
  });
});

describe("gradeCheckpoint", () => {
  const targets = [...Array(8).fill("R"), ...Array(12).fill("K")];

  it("passes when overall and newest thresholds are met with coverage", () => {
    const result = gradeCheckpoint(targets, targets.slice(), "R");
    expect(result.pass).toBe(true);
    expect(result.overallAccuracy).toBe(1);
    expect(result.newestObservations).toBe(8);
  });

  it("fails when the newest character is below its threshold", () => {
    const answers = targets.slice();
    answers[0] = "X";
    answers[1] = "X"; // 6/8 newest = 0.75 < 0.85
    expect(gradeCheckpoint(targets, answers, "R").pass).toBe(false);
  });

  it("fails when overall accuracy is below threshold", () => {
    const answers = targets.slice();
    answers[8] = "X";
    answers[9] = "X";
    answers[10] = "X"; // 17/20 = 0.85 < 0.9
    const result = gradeCheckpoint(targets, answers, "R");
    expect(result.pass).toBe(false);
    expect(result.missedCharacters).toContain("K");
  });

  it("fails without sufficient newest coverage even when perfect", () => {
    const few = [...Array(4).fill("R"), ...Array(20).fill("K")];
    expect(gradeCheckpoint(few, few.slice(), "R").pass).toBe(false);
  });
});

describe("CheckpointSession", () => {
  it("collects answers and grades without per-item feedback", () => {
    const session = new CheckpointSession({
      active: ["K", "M"],
      newest: "M",
      rng: createRng(2),
    });
    expect(session.length).toBe(checkpointLength(2));
    while (!session.isComplete()) {
      session.answer(session.current() ?? ""); // answer correctly
    }
    const result = session.grade();
    expect(result.pass).toBe(true);
    expect(result.correct).toBe(result.total);
  });
});

describe("applyCheckpoint", () => {
  function result(overrides: Partial<CheckpointResult>): CheckpointResult {
    return {
      pass: false,
      overallAccuracy: 1,
      newestAccuracy: 1,
      newestObservations: 8,
      total: 20,
      correct: 20,
      missedCharacters: [],
      ...overrides,
    };
  }

  it("unlocks exactly one character on a pass", () => {
    const state = makeState(3); // K, M, U -> next locked is R
    const applied = applyCheckpoint(state, result({ pass: true }));
    expect(applied.unlockedCharacter).toBe("R");
    expect(state.characters).toHaveLength(4);
  });

  it("unlocks nothing on a fail", () => {
    const state = makeState(3);
    const applied = applyCheckpoint(state, result({ pass: false }));
    expect(applied.unlockedCharacter).toBeUndefined();
    expect(state.characters).toHaveLength(3);
  });

  it("flags missed characters for review even on a pass", () => {
    const state = makeState(3);
    applyCheckpoint(state, result({ pass: true, missedCharacters: ["M"] }));
    expect(state.characters.find((c) => c.character === "M")?.needsReview).toBe(
      true,
    );
  });

  it("unlocks one new character while retaining missed older characters", () => {
    const state = makeState(3); // K, M, U -> next is R
    const applied = applyCheckpoint(
      state,
      result({ pass: true, missedCharacters: ["K"] }),
    );
    expect(applied.unlockedCharacter).toBe("R");
    expect(state.characters).toHaveLength(4);
    const k = state.characters.find((c) => c.character === "K");
    expect(k?.needsReview).toBe(true);
    expect(k?.reviewStreak).toBe(0);
  });
});

describe("checkpointReadiness", () => {
  it("is COMPLETE when every character is unlocked", () => {
    const state = makeState(KOCH_ORDER.length);
    expect(checkpointReadiness(state).reason).toBe("COMPLETE");
  });

  it("needs practice when the newest character is under-sampled", () => {
    const state = makeState(3); // newest U, no observations
    expect(checkpointReadiness(state).reason).toBe("NEEDS_PRACTICE");
  });

  it("is ready when the newest character is well practiced", () => {
    const state = makeState(3);
    setRx(state, "U", Array(12).fill(true));
    expect(checkpointReadiness(state)).toEqual({
      ready: true,
      reason: "READY",
    });
  });

  it("vetoes readiness for a well-sampled weak older character", () => {
    const state = makeState(3);
    setRx(state, "U", Array(12).fill(true));
    setRx(
      state,
      "K",
      [...Array(8)].map((_, i) => i < 5),
    ); // 62.5% over 8
    const readiness = checkpointReadiness(state);
    expect(readiness.reason).toBe("NEEDS_REVIEW");
    expect(readiness.weakCharacter).toBe("K");
  });
});
