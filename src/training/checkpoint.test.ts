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

describe("buildCheckpoint", () => {
  const active = ["K", "M", "U", "R"];

  it("has a bounded length that grows with the active set", () => {
    expect(checkpointLength(2)).toBe(DEFAULT_CHECKPOINT_CONFIG.minLength);
    expect(checkpointLength(100)).toBe(DEFAULT_CHECKPOINT_CONFIG.maxLength);
  });

  it("guarantees newest-character coverage and only active characters", () => {
    const items = buildCheckpoint(active, "R", createRng(1));
    expect(items.length).toBe(checkpointLength(active.length));
    const newest = items.filter((c) => c === "R").length;
    expect(newest).toBeGreaterThanOrEqual(
      DEFAULT_CHECKPOINT_CONFIG.minNewestObservations,
    );
    for (const item of items) {
      expect(active).toContain(item);
    }
  });

  it("is deterministic for a seed", () => {
    expect(buildCheckpoint(active, "R", createRng(9))).toEqual(
      buildCheckpoint(active, "R", createRng(9)),
    );
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
    expect(checkpointReadiness(state)).toEqual({ ready: true, reason: "READY" });
  });

  it("vetoes readiness for a well-sampled weak older character", () => {
    const state = makeState(3);
    setRx(state, "U", Array(12).fill(true));
    setRx(state, "K", [...Array(8)].map((_, i) => i < 5)); // 62.5% over 8
    const readiness = checkpointReadiness(state);
    expect(readiness.reason).toBe("NEEDS_REVIEW");
    expect(readiness.weakCharacter).toBe("K");
  });
});
