import { describe, expect, it } from "vitest";
import { createRng } from "../core/rng.ts";
import {
  DEFAULT_LESSON_CONFIG,
  LessonPlan,
  buildWordCopyExercises,
  focusedWordEligibility,
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

function laterLesson(seed = 1): LessonPlan {
  return new LessonPlan({
    active: ["K", "M", "U"],
    introduced: ["K", "M"],
    newest: "U",
    rng: createRng(seed),
  });
}

function play(
  plan: LessonPlan,
  result: (
    card: PlannedExercise,
    cleanAttempt: number,
  ) => {
    correct: boolean;
    clean?: boolean;
  },
): { cards: PlannedExercise[]; capped: string[] } {
  const cards: PlannedExercise[] = [];
  const capped: string[] = [];
  let cleanAttempt = 0;
  let card = plan.next();
  while (card) {
    cards.push(card);
    if (card.type !== "introduce") {
      const outcome = result(card, cleanAttempt);
      if (!card.assisted && outcome.clean !== false) cleanAttempt += 1;
      const update = plan.reportResult(
        outcome.correct,
        outcome.clean ?? !card.assisted,
      );
      if (update.acquisitionCapped) capped.push(update.acquisitionCapped);
    }
    card = plan.next();
  }
  return { cards, capped };
}

describe("LessonPlan first lesson", () => {
  it("introduces every new character exactly once", () => {
    const cards = drain(firstLesson());
    const intros = cards
      .filter((c) => c.type === "introduce")
      .map((c) => c.target);
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

  it("runs eight two-character and eight three-character groups", () => {
    const cards = drain(firstLesson());
    const twoCharacter = cards.filter((card) => card.phase === "groups-2");
    const threeCharacter = cards.filter((card) => card.phase === "groups-3");
    expect(twoCharacter).toHaveLength(
      DEFAULT_LESSON_CONFIG.twoCharacterGroupCount,
    );
    expect(threeCharacter).toHaveLength(
      DEFAULT_LESSON_CONFIG.threeCharacterGroupCount,
    );
    expect(twoCharacter.every((card) => card.target.length === 2)).toBe(true);
    expect(threeCharacter.every((card) => card.target.length === 3)).toBe(true);
    expect(cards.indexOf(twoCharacter.at(-1)!)).toBeLessThan(
      cards.indexOf(threeCharacter[0]),
    );
  });

  it("includes the focus character in every group", () => {
    const cards = drain(firstLesson());
    for (const card of cards) {
      if (card.type === "copy-group") {
        expect(card.target).toContain(card.focus);
      }
    }
  });

  it("contains no sending cards (Learn is RX-only)", () => {
    const cards = drain(firstLesson());
    for (const card of cards) {
      expect(card.direction).toBe("rx");
      expect(card.type).not.toBe("send-character");
    }
  });

  it("is deterministic for a seed", () => {
    expect(drain(firstLesson(7))).toEqual(drain(firstLesson(7)));
  });
});

describe("focusedWordEligibility", () => {
  it("uses the configured length filter and minimum pool once", () => {
    const early = focusedWordEligibility(["K", "M"]);
    expect(early.eligible).toBe(false);

    const active = ["K", "M", "U", "R", "E", "S", "N", "A"];
    const later = focusedWordEligibility(active);
    expect(later.eligible).toBe(true);
    expect(later.candidates.length).toBeGreaterThanOrEqual(
      DEFAULT_LESSON_CONFIG.minimumEligibleWordCount,
    );
    expect(
      later.candidates.every(
        (word) =>
          word.text.length >= DEFAULT_LESSON_CONFIG.initialWordMinLength &&
          word.text.length <= DEFAULT_LESSON_CONFIG.initialWordMaxLength,
      ),
    ).toBe(true);
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

describe("LessonPlan adaptive acquisition", () => {
  it("gives K and M equal clean minimum coverage", () => {
    const { cards } = play(firstLesson(), () => ({ correct: true }));
    const acquisition = cards.filter(
      (card) => card.phase === "acquire" && !card.assisted,
    );
    expect(acquisition.filter((card) => card.focus === "K")).toHaveLength(
      DEFAULT_LESSON_CONFIG.acquireMinAttempts,
    );
    expect(acquisition.filter((card) => card.focus === "M")).toHaveLength(
      DEFAULT_LESSON_CONFIG.acquireMinAttempts,
    );
  });

  it("exits after the minimum when recent performance is clean", () => {
    const { cards, capped } = play(laterLesson(), () => ({ correct: true }));
    expect(
      cards.filter((card) => card.phase === "acquire" && !card.assisted),
    ).toHaveLength(DEFAULT_LESSON_CONFIG.acquireMinAttempts);
    expect(capped).toEqual([]);
  });

  it("extends weak acquisition until the recent criterion is met", () => {
    const outcomes = [false, false, false, true, true, true, true, true, true];
    let acquisitionAttempt = 0;
    const { cards, capped } = play(laterLesson(), (card) => {
      if (card.phase !== "acquire" || card.assisted) return { correct: true };
      const correct = outcomes[acquisitionAttempt] ?? true;
      acquisitionAttempt += 1;
      return { correct };
    });
    expect(
      cards.filter((card) => card.phase === "acquire" && !card.assisted),
    ).toHaveLength(9);
    expect(capped).toEqual([]);
  });

  it("caps persistently weak acquisition", () => {
    const { cards, capped } = play(laterLesson(), (card) => ({
      correct: card.assisted,
    }));
    expect(
      cards.filter((card) => card.phase === "acquire" && !card.assisted),
    ).toHaveLength(DEFAULT_LESSON_CONFIG.acquireMaxAttempts);
    expect(capped).toEqual(["U"]);
  });

  it("replaces replayed cards instead of counting them toward the minimum", () => {
    let replayed = false;
    const { cards } = play(laterLesson(), (card) => {
      if (card.phase === "acquire" && !card.assisted && !replayed) {
        replayed = true;
        return { correct: true, clean: false };
      }
      return { correct: true };
    });
    expect(
      cards.filter((card) => card.phase === "acquire" && !card.assisted),
    ).toHaveLength(DEFAULT_LESSON_CONFIG.acquireMinAttempts + 1);
  });

  it("keeps assisted reinforcement outside clean acquisition counts", () => {
    let missed = false;
    const { cards } = play(laterLesson(), (card) => {
      if (card.phase === "acquire" && !card.assisted && !missed) {
        missed = true;
        return { correct: false };
      }
      return { correct: true };
    });
    expect(
      cards.filter((card) => card.phase === "acquire" && !card.assisted),
    ).toHaveLength(DEFAULT_LESSON_CONFIG.acquireMinAttempts);
    expect(
      cards.filter((card) => card.phase === "acquire" && card.assisted),
    ).toHaveLength(1);
  });

  it("is deterministic for the same seed and outcomes", () => {
    const run = () =>
      play(laterLesson(19), (card) => ({ correct: card.assisted })).cards;
    expect(run()).toEqual(run());
  });
});

describe("LessonPlan adaptive contrast", () => {
  it("runs the configured minimum and balances the initial K/M pair", () => {
    const { cards } = play(firstLesson(4), () => ({ correct: true }));
    const contrast = cards.filter(
      (card) => card.phase === "contrast" && !card.assisted,
    );
    expect(contrast).toHaveLength(DEFAULT_LESSON_CONFIG.contrastMinAttempts);
    expect(contrast.filter((card) => card.target === "K")).toHaveLength(8);
    expect(contrast.filter((card) => card.target === "M")).toHaveLength(8);
  });

  it("extends weak contrast to its configured maximum", () => {
    const { cards } = play(firstLesson(4), (card) => ({
      correct: card.phase !== "contrast" || card.assisted,
    }));
    expect(
      cards.filter((card) => card.phase === "contrast" && !card.assisted),
    ).toHaveLength(DEFAULT_LESSON_CONFIG.contrastMaxAttempts);
  });

  it("replaces replayed contrast cards instead of counting them", () => {
    let replayed = false;
    const { cards } = play(firstLesson(4), (card) => {
      if (card.phase === "contrast" && !card.assisted && !replayed) {
        replayed = true;
        return { correct: true, clean: false };
      }
      return { correct: true };
    });
    expect(
      cards.filter((card) => card.phase === "contrast" && !card.assisted),
    ).toHaveLength(DEFAULT_LESSON_CONFIG.contrastMinAttempts + 1);
  });

  it("avoids runs longer than two and includes every early active character", () => {
    const plan = new LessonPlan({
      active: ["K", "M", "U", "R", "E"],
      introduced: ["K", "M", "U", "R", "E"],
      newest: "E",
      review: ["K"],
      weak: ["M"],
      rng: createRng(11),
    });
    const contrast = drain(plan).filter((card) => card.phase === "contrast");
    expect(new Set(contrast.map((card) => card.target))).toEqual(
      new Set(["K", "M", "U", "R", "E"]),
    );
    for (let index = 2; index < contrast.length; index++) {
      expect(
        contrast[index].target === contrast[index - 1].target &&
          contrast[index].target === contrast[index - 2].target,
      ).toBe(false);
    }
  });

  it("never omits a review character from the mixed minimum", () => {
    const active = "KMURESNAPTLIJZFOYVGC".split("");
    const review = active.at(-1) ?? "C";
    const plan = new LessonPlan({
      active,
      introduced: active,
      newest: review,
      review: [review],
      rng: createRng(2),
    });
    const contrast = drain(plan).filter((card) => card.phase === "contrast");
    expect(contrast.some((card) => card.target === review)).toBe(true);
  });

  it("weights newest, review, and weak characters above ordinary characters", () => {
    const totals = new Map<string, number>();
    for (let seed = 1; seed <= 100; seed++) {
      const plan = new LessonPlan({
        active: ["K", "M", "U", "R", "E"],
        introduced: ["K", "M", "U", "R", "E"],
        newest: "E",
        review: ["K"],
        weak: ["M"],
        rng: createRng(seed),
      });
      for (const card of drain(plan)) {
        if (card.phase === "contrast") {
          totals.set(card.target, (totals.get(card.target) ?? 0) + 1);
        }
      }
    }

    const emphasized =
      ((totals.get("K") ?? 0) +
        (totals.get("M") ?? 0) +
        (totals.get("E") ?? 0)) /
      3;
    const ordinary = ((totals.get("U") ?? 0) + (totals.get("R") ?? 0)) / 2;
    expect(emphasized).toBeGreaterThan(ordinary);
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

  it("weights review and weak characters as group focuses", () => {
    const totals = new Map<string, number>();
    for (let seed = 1; seed <= 100; seed++) {
      const plan = new LessonPlan({
        active: ["K", "M", "U", "R", "E"],
        introduced: ["K", "M", "U", "R", "E"],
        newest: "E",
        review: ["K"],
        weak: ["M"],
        rng: createRng(seed),
      });
      for (const card of drain(plan)) {
        if (card.type === "copy-group") {
          totals.set(card.focus, (totals.get(card.focus) ?? 0) + 1);
        }
      }
    }

    const emphasized = ((totals.get("K") ?? 0) + (totals.get("M") ?? 0)) / 2;
    const ordinary =
      ((totals.get("U") ?? 0) +
        (totals.get("R") ?? 0) +
        (totals.get("E") ?? 0)) /
      3;
    expect(emphasized).toBeGreaterThan(ordinary);
  });
});

describe("buildWordCopyExercises", () => {
  const active = "KMURESNAPT".split("");

  it("omits word copy until the useful-pool threshold is met", () => {
    expect(
      buildWordCopyExercises({
        active: ["K", "M"],
        newest: "M",
        rng: createRng(1),
      }),
    ).toEqual([]);
  });

  it("builds short, active-only, nonrepeating RX words", () => {
    const exercises = buildWordCopyExercises({
      active,
      newest: "T",
      review: ["K"],
      weak: ["M"],
      rng: createRng(4),
    });
    expect(exercises).toHaveLength(DEFAULT_LESSON_CONFIG.wordCopyCount);
    expect(new Set(exercises.map((exercise) => exercise.target))).toHaveLength(
      exercises.length,
    );
    for (const exercise of exercises) {
      expect(exercise.type).toBe("copy-word");
      expect(exercise.direction).toBe("rx");
      expect(exercise.phase).toBe("words");
      expect(exercise.target.length).toBeGreaterThanOrEqual(2);
      expect(exercise.target.length).toBeLessThanOrEqual(4);
      expect(
        [...exercise.target].every((character) => active.includes(character)),
      ).toBe(true);
    }
  });

  it("is deterministic for the same seed", () => {
    const build = () =>
      buildWordCopyExercises({
        active,
        newest: "T",
        review: ["K"],
        weak: ["M"],
        rng: createRng(17),
      });
    expect(build()).toEqual(build());
  });

  it("favors words containing newest, review, and weak characters", () => {
    let emphasized = 0;
    let ordinary = 0;
    for (let seed = 1; seed <= 100; seed++) {
      const exercises = buildWordCopyExercises({
        active,
        newest: "T",
        review: ["K"],
        weak: ["M"],
        rng: createRng(seed),
      });
      for (const exercise of exercises) {
        if (/[TKM]/.test(exercise.target)) emphasized += 1;
        else ordinary += 1;
      }
    }
    expect(emphasized).toBeGreaterThan(ordinary);
  });
});

describe("LessonPlan remediation", () => {
  function reviewLesson(review: string[], seed = 1): LessonPlan {
    return new LessonPlan({
      active: ["K", "M", "U"],
      introduced: ["K", "M", "U"],
      newest: "U",
      review,
      rng: createRng(seed),
    });
  }

  it("gives a review character the configured remediation prompts", () => {
    const cards = drain(reviewLesson(["K"]));
    const remediate = cards.filter(
      (c) => c.phase === "remediate" && c.target === "K",
    );
    expect(remediate.length).toBe(DEFAULT_LESSON_CONFIG.remediationPrompts);
    for (const card of remediate) {
      expect(card.assisted).toBe(false);
      expect(card.direction).toBe("rx");
    }
  });

  it("remediates every pending review character", () => {
    const cards = drain(reviewLesson(["K", "M"]));
    const perChar = (ch: string) =>
      cards.filter((c) => c.phase === "remediate" && c.target === ch).length;
    expect(perChar("K")).toBe(DEFAULT_LESSON_CONFIG.remediationPrompts);
    expect(perChar("M")).toBe(DEFAULT_LESSON_CONFIG.remediationPrompts);
  });

  it("keeps remediation RX-only", () => {
    const cards = drain(reviewLesson(["K", "M"]));
    for (const card of cards) {
      expect(card.direction).toBe("rx");
    }
  });
});
