import { describe, expect, it } from "vitest";
import { createRng } from "../core/rng.ts";
import {
  DEFAULT_LESSON_CONFIG,
  LessonPlan,
  type PlannedExercise,
} from "./lesson-plan.ts";

function drain(plan: LessonPlan): PlannedExercise[] {
  const all: PlannedExercise[] = [];
  let card = plan.next();
  while (card) {
    all.push(card);
    card = plan.next();
  }
  return all;
}

function firstLesson(seed = 1): LessonPlan {
  return new LessonPlan({
    active: ["K", "M"],
    introduced: [],
    newest: "M",
    rng: createRng(seed),
  });
}

describe("LessonPlan first lesson", () => {
  it("introduces every new character exactly once", () => {
    const cards = drain(firstLesson());
    const intros = cards.filter((c) => c.type === "introduce").map((c) => c.target);
    expect(intros).toEqual(["K", "M"]);
  });

  it("never tests a character before it has been introduced", () => {
    const cards = drain(firstLesson());
    const introducedSoFar = new Set<string>();
    for (const card of cards) {
      if (card.type === "introduce") {
        introducedSoFar.add(card.target);
        continue;
      }
      for (const char of card.target) {
        expect(introducedSoFar.has(char)).toBe(true);
      }
    }
  });

  it("keeps early groups short", () => {
    const cards = drain(firstLesson());
    for (const card of cards) {
      if (card.type === "copy-group") {
        expect(card.target.length).toBeLessThanOrEqual(
          DEFAULT_LESSON_CONFIG.groupMaxLen,
        );
        expect(card.target.length).toBeGreaterThanOrEqual(
          DEFAULT_LESSON_CONFIG.groupMinLen,
        );
      }
    }
  });

  it("includes the focus character in every group", () => {
    const cards = drain(firstLesson());
    for (const card of cards) {
      if (card.type === "copy-group") {
        expect(card.target).toContain(card.focus);
      }
    }
  });

  it("emits sending drills with tx direction", () => {
    const cards = drain(firstLesson());
    const sends = cards.filter((c) => c.type === "send-character");
    expect(sends.length).toBe(DEFAULT_LESSON_CONFIG.sendCount);
    for (const card of sends) {
      expect(card.direction).toBe("tx");
    }
  });

  it("is deterministic for a seed", () => {
    expect(drain(firstLesson(7))).toEqual(drain(firstLesson(7)));
  });
});

describe("LessonPlan misses", () => {
  it("inserts an immediate repeat after a missed isolated card", () => {
    const plan = firstLesson();
    // Advance to the first acquire card (after the K introduction).
    let card = plan.next();
    while (card && card.phase !== "acquire") {
      card = plan.next();
    }
    expect(card?.type).toBe("copy-character");
    const before = plan.length;
    plan.reportResult(false);
    expect(plan.length).toBe(before + 1);
    const repeat = plan.next();
    expect(repeat?.assisted).toBe(true);
    expect(repeat?.focus).toBe(card?.focus);
  });

  it("does not repeat after a correct card", () => {
    const plan = firstLesson();
    plan.next();
    const before = plan.length;
    plan.reportResult(true);
    expect(plan.length).toBe(before);
  });

  it("does not insert a second repeat after a missed assisted card", () => {
    const plan = firstLesson();
    let card = plan.next();
    while (card && card.phase !== "acquire") {
      card = plan.next();
    }
    plan.reportResult(false); // inserts an assisted repeat
    const assisted = plan.next();
    expect(assisted?.assisted).toBe(true);
    const before = plan.length;
    plan.reportResult(false); // miss on the assisted card must not recurse
    expect(plan.length).toBe(before);
  });
});

describe("LessonPlan later stage", () => {
  it("does not re-introduce already-introduced characters", () => {
    const plan = new LessonPlan({
      active: ["K", "M", "U"],
      introduced: ["K", "M"],
      newest: "U",
      rng: createRng(3),
    });
    expect(plan.newlyIntroduced).toEqual(["U"]);
    const intros = drain(plan)
      .filter((c) => c.type === "introduce")
      .map((c) => c.target);
    expect(intros).toEqual(["U"]);
  });
});
