import { describe, expect, it } from "vitest";
import { DEFAULT_CURRICULUM_CONFIG } from "../content/curriculum-data.ts";
import { createInitialState, nextLockedCharacter } from "../core/curriculum.ts";
import { createRng } from "../core/rng.ts";
import { buildSchedule } from "../core/timing.ts";
import {
  applyContinuousCopyResult,
  buildContinuousCopyPlan,
  gradeContinuousCopy,
} from "./continuous-copy.ts";

const timing = { charWpm: 20, effectiveWpm: 12 };

function plan(seed = 1, durationMs = 60000) {
  return buildContinuousCopyPlan({
    active: ["K", "M", "U", "R"],
    newest: "R",
    review: ["K"],
    weak: ["M"],
    durationMs,
    timing,
    rng: createRng(seed),
  });
}

describe("buildContinuousCopyPlan", () => {
  it("uses only active characters and preserves its complete schedule", () => {
    const generated = plan();
    expect(
      [...generated.target].every((character) => "KMUR".includes(character)),
    ).toBe(true);
    expect(generated.schedule).toEqual(buildSchedule(generated.target, timing));
    expect(generated.scheduledDurationMs).toBe(generated.schedule.totalMs);
  });

  it("meets duration without cutting a character", () => {
    const generated = plan();
    const maxAddition = Math.max(
      ...["K", "M", "U", "R"].map(
        (character) =>
          buildSchedule(`E${character}`, timing).totalMs -
          buildSchedule("E", timing).totalMs,
      ),
    );
    expect(generated.scheduledDurationMs).toBeGreaterThanOrEqual(60000);
    expect(generated.scheduledDurationMs).toBeLessThan(60000 + maxAddition);
  });

  it("is deterministic for the same seed", () => {
    expect(plan(17)).toEqual(plan(17));
  });

  it("covers the active set when the duration permits", () => {
    expect(new Set(plan().target)).toEqual(new Set(["K", "M", "U", "R"]));
  });

  it("prevents excessive identical runs", () => {
    expect(plan().target).not.toMatch(/(.)\1\1/);
  });

  it("weights newest, review, and weak characters", () => {
    const counts = new Map<string, number>();
    for (let seed = 1; seed <= 40; seed++) {
      for (const character of plan(seed, 10000).target) {
        counts.set(character, (counts.get(character) ?? 0) + 1);
      }
    }
    expect(counts.get("K")).toBeGreaterThan(counts.get("U") ?? 0);
    expect(counts.get("M")).toBeGreaterThan(counts.get("U") ?? 0);
    expect(counts.get("R")).toBeGreaterThan(counts.get("U") ?? 0);
  });
});

describe("gradeContinuousCopy", () => {
  const shortPlan = buildContinuousCopyPlan({
    active: ["K", "M"],
    newest: "M",
    durationMs: 1000,
    timing,
    rng: createRng(3),
  });

  it("ignores answer whitespace and reports rich aligned results", () => {
    const typed = `${shortPlan.target[0]} X ${shortPlan.target.slice(1)}`;
    const result = gradeContinuousCopy(shortPlan, typed, {
      durationCompleted: shortPlan.scheduledDurationMs,
    });
    expect(result.targetCharacters).toBe(shortPlan.target.length);
    expect(result.typedCharacters).toBe(shortPlan.target.length + 1);
    expect(result.alignedCorrect).toBe(shortPlan.target.length);
    expect(result.insertions).toBe(1);
    expect(result.deletions).toBe(0);
    expect(result.substitutions).toBe(0);
    expect(result.accuracy).toBe(1);
    expect(result.perCharacterResults.every((item) => item.correct)).toBe(true);
  });

  it("handles deletion, substitution, and repeated characters deterministically", () => {
    const fixed = {
      ...shortPlan,
      target: "KMMU",
      schedule: buildSchedule("KMMU", timing),
    };
    const first = gradeContinuousCopy(fixed, "KMK", {
      durationCompleted: fixed.scheduledDurationMs,
    });
    expect(first.perCharacterResults.map((item) => item.correct)).toEqual([
      true,
      false,
      true,
      false,
    ]);
    expect(first).toEqual(
      gradeContinuousCopy(fixed, "KMK", {
        durationCompleted: fixed.scheduledDurationMs,
      }),
    );
  });

  it("discards an abandoned stream instead of penalizing unplayed targets", () => {
    const result = gradeContinuousCopy(shortPlan, "K", {
      durationCompleted: 300,
      abandoned: true,
    });
    expect(result.abandoned).toBe(true);
    expect(result.accuracy).toBeNull();
    expect(result.perCharacterResults).toEqual([]);
  });
});

describe("applyContinuousCopyResult", () => {
  it("updates RX practice without unlocking or clearing remediation", () => {
    const state = createInitialState(DEFAULT_CURRICULUM_CONFIG);
    state.characters[0].needsReview = true;
    state.characters[0].reviewStreak = 2;
    const generated = buildContinuousCopyPlan({
      active: ["K", "M"],
      newest: "M",
      durationMs: 1000,
      timing,
      rng: createRng(2),
    });
    const result = gradeContinuousCopy(generated, generated.target, {
      durationCompleted: generated.scheduledDurationMs,
    });
    const locked = nextLockedCharacter(state);

    expect(applyContinuousCopyResult(state, result)).toBe(
      generated.target.length,
    );
    expect(nextLockedCharacter(state)).toBe(locked);
    expect(state.characters[0].needsReview).toBe(true);
    expect(state.characters[0].reviewStreak).toBe(2);
    expect(
      state.characters.some((character) => character.rx.totalAttempts > 0),
    ).toBe(true);
  });

  it("records no mastery for an abandoned stream", () => {
    const state = createInitialState(DEFAULT_CURRICULUM_CONFIG);
    const generated = plan(1, 1000);
    const result = gradeContinuousCopy(generated, "K", {
      durationCompleted: 200,
      abandoned: true,
    });
    expect(applyContinuousCopyResult(state, result)).toBe(0);
    expect(
      state.characters.every((character) => character.rx.totalAttempts === 0),
    ).toBe(true);
  });
});

describe("continuous-copy performance", () => {
  it("generates and grades a ten-minute stream within a reasonable budget", () => {
    const started = performance.now();
    const generated = plan(23, 600000);
    const generatedAt = performance.now();
    const result = gradeContinuousCopy(generated, generated.target, {
      durationCompleted: generated.scheduledDurationMs,
    });
    const finished = performance.now();

    expect(generated.scheduledDurationMs).toBeGreaterThanOrEqual(600000);
    expect(result.accuracy).toBe(1);
    expect(generatedAt - started).toBeLessThan(1000);
    expect(finished - generatedAt).toBeLessThan(1000);
  });
});
