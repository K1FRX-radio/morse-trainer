import { describe, expect, it } from "vitest";
import {
  DEFAULT_ADVANCEMENT_CONFIG,
  DEFAULT_CURRICULUM_CONFIG,
} from "../content/curriculum-data.ts";
import { createInitialState, nextLockedCharacter } from "../core/curriculum.ts";
import { createRng } from "../core/rng.ts";
import { recommendedContinuousCopyDurationMs } from "../core/settings.ts";
import { buildSchedule } from "../core/timing.ts";
import { minimumAdvancementObservations } from "./advancement.ts";
import {
  DEFAULT_CONTINUOUS_COPY_CONFIG,
  applyContinuousCopyResult,
  buildContinuousCopyPlan,
  gradeContinuousCopy,
} from "./continuous-copy.ts";
import { selectGroupCharacter } from "./continuous-copy-selector.ts";
import { focusedWordEligibility } from "./lesson-plan.ts";

const timing = { charWpm: 20, effectiveWpm: 12 };
const kmActive = ["K", "M"];

function expectValidKmSelection(
  generated: ReturnType<typeof buildContinuousCopyPlan>,
): void {
  const remainingCoverage = new Map([
    ["K", 1],
    ["M", DEFAULT_ADVANCEMENT_CONFIG.minNewestObservations],
  ]);
  let previousToken: string | undefined;

  for (const token of generated.tokens) {
    expect(token.kind).toBe("random-group");
    expect(
      [...token.text].every((character) => kmActive.includes(character)),
    ).toBe(true);
    expect(token.text).not.toMatch(/(.)\1\1/);

    const prefix: string[] = [];
    for (const selected of token.text) {
      const satisfiesRunLimit = (candidate: string) => {
        const run = prefix.slice(
          -DEFAULT_CONTINUOUS_COPY_CONFIG.maxIdenticalRun,
        );
        return !(
          run.length === DEFAULT_CONTINUOUS_COPY_CONFIG.maxIdenticalRun &&
          run.every((character) => character === candidate)
        );
      };
      const avoidsRepeatedToken = (candidate: string) =>
        !(
          previousToken?.length === token.text.length &&
          prefix.length === token.text.length - 1 &&
          prefix.every(
            (character, index) => character === previousToken?.[index],
          ) &&
          candidate === previousToken[prefix.length]
        );
      const runSafe = kmActive.filter(satisfiesRunLimit);
      const coverage = runSafe.filter(
        (candidate) => (remainingCoverage.get(candidate) ?? 0) > 0,
      );
      const tiers = [
        coverage.filter(avoidsRepeatedToken),
        coverage,
        runSafe.filter(avoidsRepeatedToken),
        runSafe,
      ];
      const selectedTier = tiers.find((candidates) => candidates.length > 0);

      expect(selectedTier).toBeDefined();
      expect(selectedTier).toContain(selected);
      if (
        prefix.length === token.text.length - 1 &&
        token.text === previousToken
      ) {
        expect(tiers[0]).toHaveLength(0);
        if (coverage.length === 0) expect(tiers[2]).toHaveLength(0);
      }

      prefix.push(selected);
      const remaining = remainingCoverage.get(selected) ?? 0;
      if (remaining > 0) remainingCoverage.set(selected, remaining - 1);
    }

    previousToken = token.text;
  }
}

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

const wordEligibleActive = ["K", "M", "U", "R", "E", "S", "N", "A"];

describe("selectGroupCharacter", () => {
  it("relaxes token uniqueness rather than the hard run limit", () => {
    const selected = selectGroupCharacter({
      active: ["K", "M"],
      prefix: ["M", "M"],
      tokenLength: 3,
      previousToken: "MMK",
      remainingCoverage: new Map([
        ["K", 1],
        ["M", 8],
      ]),
      requireCoverage: true,
      maxIdenticalRun: 2,
      weight: () => 1,
      rng: createRng(1),
    });

    expect(selected).toBe("K");
  });
});

function mixedPlan(seed = 1, durationMs = 60000) {
  return buildContinuousCopyPlan({
    active: wordEligibleActive,
    newest: "A",
    review: ["K"],
    weak: ["M"],
    durationMs,
    timing,
    rng: createRng(seed),
    wordEligibility: focusedWordEligibility(wordEligibleActive),
  });
}

describe("buildContinuousCopyPlan", () => {
  it("uses only active characters and preserves its complete schedule", () => {
    const generated = plan();
    expect(
      [...generated.gradingTarget].every((character) =>
        "KMUR".includes(character),
      ),
    ).toBe(true);
    expect(generated.schedule).toEqual(
      buildSchedule(generated.audioText, timing),
    );
    expect(generated.audioText).toBe(
      generated.tokens.map((token) => token.text).join(" "),
    );
    expect(generated.gradingTarget).toBe(
      generated.tokens.map((token) => token.text).join(""),
    );
    expect(generated.scheduledDurationMs).toBe(generated.schedule.totalMs);
  });

  it("meets duration without cutting a token", () => {
    const generated = plan();
    const lastToken = generated.tokens.at(-1)?.text ?? "";
    const maximumOvershoot =
      buildSchedule(`E ${lastToken}`, timing).totalMs -
      buildSchedule("E", timing).totalMs;
    const repairTokenAllowance =
      buildSchedule("E E", timing).totalMs - buildSchedule("E", timing).totalMs;
    expect(generated.scheduledDurationMs).toBeGreaterThanOrEqual(60000);
    expect(generated.scheduledDurationMs).toBeLessThan(
      60000 + maximumOvershoot + repairTokenAllowance,
    );
  });

  it("is deterministic for the same seed", () => {
    expect(plan(17)).toEqual(plan(17));
  });

  it("produces meaningfully different tokens for different seeds", () => {
    const first = plan(17).tokens.map((token) => token.text);
    const second = plan(18).tokens.map((token) => token.text);
    expect(first).not.toEqual(second);
    expect(
      first.filter((token, index) => token !== second[index]).length,
    ).toBeGreaterThan(first.length / 2);
  });

  it("covers the active set when the duration permits", () => {
    expect(new Set(plan().gradingTarget)).toEqual(
      new Set(["K", "M", "U", "R"]),
    );
  });

  it("meets advancement coverage across recommended streams", () => {
    const timings = [
      { charWpm: 20, effectiveWpm: 12 },
      { charWpm: 8, effectiveWpm: 5 },
    ];
    for (let activeCount = 2; activeCount <= 40; activeCount++) {
      const active = DEFAULT_CURRICULUM_CONFIG.order.slice(0, activeCount);
      const newest = active.at(-1) ?? "";
      const durationMs = recommendedContinuousCopyDurationMs(activeCount);
      for (const selectedTiming of timings) {
        for (let seed = 1; seed <= 5; seed++) {
          const generated = buildContinuousCopyPlan({
            active,
            newest,
            durationMs,
            timing: selectedTiming,
            rng: createRng(seed),
            wordEligibility: focusedWordEligibility(active),
          });
          expect(
            generated.gradingTarget.length,
            `active=${activeCount}, timing=${selectedTiming.charWpm}/${selectedTiming.effectiveWpm}, seed=${seed}`,
          ).toBeGreaterThanOrEqual(minimumAdvancementObservations(activeCount));
          const counts = new Map<string, number>();
          for (const character of generated.gradingTarget) {
            counts.set(character, (counts.get(character) ?? 0) + 1);
          }
          expect(
            active.every((character) => (counts.get(character) ?? 0) >= 1),
          ).toBe(true);
          expect(counts.get(newest)).toBeGreaterThanOrEqual(
            DEFAULT_ADVANCEMENT_CONFIG.minNewestObservations,
          );
        }
      }
    }
  });

  it("preserves selector priorities across seeded K/M streams", () => {
    const timings = [
      { charWpm: 20, effectiveWpm: 12 },
      { charWpm: 8, effectiveWpm: 5 },
    ];
    const oneMinuteSeeds = Array.from(
      { length: 1000 },
      (_, index) => index + 1,
    );
    const longerDurationSeeds = [1, 17, 101, 251, 509, 751, 997, 1000];
    const durationSamples = [
      { durationMs: 60000, seeds: oneMinuteSeeds },
      { durationMs: 180000, seeds: longerDurationSeeds },
      { durationMs: 300000, seeds: longerDurationSeeds },
      { durationMs: 600000, seeds: longerDurationSeeds },
    ];

    for (const selectedTiming of timings) {
      for (const sample of durationSamples) {
        for (const seed of sample.seeds) {
          const options = {
            active: kmActive,
            newest: "M",
            durationMs: sample.durationMs,
            timing: selectedTiming,
          };
          const generated = buildContinuousCopyPlan({
            ...options,
            rng: createRng(seed),
          });
          const repeated = buildContinuousCopyPlan({
            ...options,
            rng: createRng(seed),
          });

          expect(generated).toEqual(repeated);
          expectValidKmSelection(generated);
        }
      }
    }
  }, 20000);

  it("prevents excessive identical runs", () => {
    for (let seed = 1; seed <= 100; seed++) {
      for (const token of plan(seed).tokens) {
        expect(token.text).not.toMatch(/(.)\1\1/);
      }
    }
  });

  it("uses variable group lengths and respects selector priorities", () => {
    for (let seed = 1; seed <= 100; seed++) {
      const generated = plan(seed);
      expect(
        new Set(generated.tokens.map((token) => token.text.length)).size,
      ).toBeGreaterThan(1);
    }
  });

  it("uses word gaps between tokens and character gaps inside them", () => {
    const generated = plan(4, 10000);
    const gaps = generated.schedule.segments.filter((segment) => !segment.tone);
    expect(gaps.some((segment) => segment.gap === "word")).toBe(true);
    expect(gaps.some((segment) => segment.gap === "inter-char")).toBe(true);
  });

  it("weights newest, review, and weak characters", () => {
    const counts = new Map<string, number>();
    for (let seed = 1; seed <= 40; seed++) {
      for (const character of plan(seed, 10000).gradingTarget) {
        counts.set(character, (counts.get(character) ?? 0) + 1);
      }
    }
    expect(counts.get("K")).toBeGreaterThan(counts.get("U") ?? 0);
    expect(counts.get("M")).toBeGreaterThan(counts.get("U") ?? 0);
    expect(counts.get("R")).toBeGreaterThan(counts.get("U") ?? 0);
  });

  it("keeps KMUR streams close to uniform with only mild newest bias", () => {
    const totals = new Map<string, number>();
    for (let seed = 1; seed <= 200; seed++) {
      for (const character of buildContinuousCopyPlan({
        active: ["K", "M", "U", "R"],
        newest: "R",
        durationMs: recommendedContinuousCopyDurationMs(4),
        timing,
        rng: createRng(seed),
      }).gradingTarget) {
        totals.set(character, (totals.get(character) ?? 0) + 1);
      }
    }

    const sum = [...totals.values()].reduce((a, b) => a + b, 0);
    const share = (character: string) => (totals.get(character) ?? 0) / sum;
    const peerShares = [share("K"), share("M"), share("U")];
    const peerMean = peerShares.reduce((a, b) => a + b, 0) / peerShares.length;

    for (const candidate of ["K", "M", "U", "R"]) {
      expect(totals.get(candidate)).toBeGreaterThan(0);
    }
    expect(share("R")).toBeGreaterThan(peerMean);
    expect(share("R")).toBeLessThan(peerMean + 0.08);
  });

  it("does not front-load newest character heavily in stream prefixes", () => {
    let prefixNewest = 0;
    let prefixTotal = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const generated = buildContinuousCopyPlan({
        active: ["K", "M", "U", "R"],
        newest: "R",
        durationMs: recommendedContinuousCopyDurationMs(4),
        timing,
        rng: createRng(seed),
      });
      const prefixLength = Math.max(
        1,
        Math.floor(generated.gradingTarget.length * 0.25),
      );
      const prefix = generated.gradingTarget.slice(0, prefixLength);
      prefixTotal += prefix.length;
      prefixNewest += [...prefix].filter(
        (character) => character === "R",
      ).length;
    }

    const prefixShare = prefixNewest / prefixTotal;
    expect(prefixShare).toBeGreaterThan(0.2);
    expect(prefixShare).toBeLessThan(0.38);
  });

  it("prevents pathological domination when newest, review, and weak overlap", () => {
    const totals = new Map<string, number>();
    for (let seed = 1; seed <= 200; seed++) {
      const generated = buildContinuousCopyPlan({
        active: ["K", "M", "U", "R"],
        newest: "R",
        review: ["R"],
        weak: ["R"],
        durationMs: recommendedContinuousCopyDurationMs(4),
        timing,
        rng: createRng(seed),
      });
      for (const character of generated.gradingTarget) {
        totals.set(character, (totals.get(character) ?? 0) + 1);
      }
    }

    const sum = [...totals.values()].reduce((a, b) => a + b, 0);
    const newestShare = (totals.get("R") ?? 0) / sum;
    expect(newestShare).toBeLessThan(0.6);
  });

  it("mixes only eligible words while retaining random groups", () => {
    const generated = mixedPlan(9, 180000);
    const words = generated.tokens.filter((token) => token.kind === "word");
    const groups = generated.tokens.filter(
      (token) => token.kind === "random-group",
    );
    expect(words.length).toBeGreaterThan(0);
    expect(groups.length).toBeGreaterThan(0);
    expect(
      words.every((token) =>
        [...token.text].every((character) =>
          wordEligibleActive.includes(character),
        ),
      ),
    ).toBe(true);
  });

  it("does not mix words before covering the active set", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const generated = mixedPlan(seed, 180000);
      const firstWord = generated.tokens.findIndex(
        (token) => token.kind === "word",
      );
      expect(firstWord).toBeGreaterThan(0);
      const prefix = generated.tokens
        .slice(0, firstWord)
        .map((token) => token.text)
        .join("");
      expect(
        wordEligibleActive.every((character) => prefix.includes(character)),
      ).toBe(true);
    }
  });

  it("does not extend a short stream to force advancement coverage", () => {
    const generated = buildContinuousCopyPlan({
      active: wordEligibleActive,
      newest: "A",
      durationMs: 1000,
      timing: { charWpm: 8, effectiveWpm: 5 },
      rng: createRng(4),
      wordEligibility: focusedWordEligibility(wordEligibleActive),
    });

    expect(generated.gradingTarget.length).toBeLessThan(
      minimumAdvancementObservations(wordEligibleActive.length),
    );
    expect(
      generated.tokens.every((token) => token.kind === "random-group"),
    ).toBe(true);
  });

  it("does not mix words when focused word copy is ineligible", () => {
    const generated = buildContinuousCopyPlan({
      active: ["K", "M"],
      newest: "M",
      durationMs: 60000,
      timing,
      rng: createRng(7),
      wordEligibility: focusedWordEligibility(["K", "M"]),
    });
    expect(
      generated.tokens.every((token) => token.kind === "random-group"),
    ).toBe(true);
  });

  it("respects the word ratio and consecutive-word limit over seeded plans", () => {
    const tokens = Array.from({ length: 20 }, (_, index) =>
      mixedPlan(index + 1, 180000),
    ).flatMap((generated) => generated.tokens);
    const wordRatio =
      tokens.filter((token) => token.kind === "word").length / tokens.length;
    expect(wordRatio).toBeGreaterThan(0.24);
    expect(wordRatio).toBeLessThan(0.38);

    let consecutiveWords = 0;
    for (const token of tokens) {
      consecutiveWords = token.kind === "word" ? consecutiveWords + 1 : 0;
      expect(consecutiveWords).toBeLessThanOrEqual(
        DEFAULT_CONTINUOUS_COPY_CONFIG.maxConsecutiveWordTokens,
      );
    }
  });

  it("avoids immediate repeated words when alternatives exist", () => {
    const tokens = mixedPlan(13, 600000).tokens;
    for (let index = 1; index < tokens.length; index++) {
      if (tokens[index].kind === "word" && tokens[index - 1].kind === "word") {
        expect(tokens[index].text).not.toBe(tokens[index - 1].text);
      }
    }
  });

  it("measurably favors newest, review, and weak characters in words", () => {
    function emphasizedWordRatio(emphasized: boolean): number {
      let matching = 0;
      let total = 0;
      for (let seed = 1; seed <= 100; seed++) {
        const generated = buildContinuousCopyPlan({
          active: ["K", "M", "U", "R", "E", "S", "N", "A", "P", "T"],
          newest: emphasized ? "T" : "",
          review: emphasized ? ["E"] : [],
          weak: emphasized ? ["M"] : [],
          durationMs: 180000,
          timing,
          rng: createRng(seed),
          wordEligibility: focusedWordEligibility([
            "K",
            "M",
            "U",
            "R",
            "E",
            "S",
            "N",
            "A",
            "P",
            "T",
          ]),
          config: {
            ...DEFAULT_CONTINUOUS_COPY_CONFIG,
            continuousWordRatio: 0.7,
          },
        });
        for (const token of generated.tokens) {
          if (token.kind !== "word") continue;
          total += 1;
          if (/[TEM]/.test(token.text)) matching += 1;
        }
      }
      return matching / total;
    }

    expect(emphasizedWordRatio(true)).toBeGreaterThan(
      emphasizedWordRatio(false),
    );
  });

  it.each([
    [60000, { charWpm: 20, effectiveWpm: 12 }],
    [180000, { charWpm: 20, effectiveWpm: 12 }],
    [300000, { charWpm: 20, effectiveWpm: 12 }],
    [600000, { charWpm: 20, effectiveWpm: 12 }],
    [60000, { charWpm: 8, effectiveWpm: 5 }],
  ])("meets %i ms at %o timing", (durationMs, selectedTiming) => {
    const generated = buildContinuousCopyPlan({
      active: ["K", "M"],
      newest: "M",
      durationMs,
      timing: selectedTiming,
      rng: createRng(31),
    });
    expect(generated.scheduledDurationMs).toBeGreaterThanOrEqual(durationMs);
    expect(generated.schedule).toEqual(
      buildSchedule(generated.audioText, selectedTiming),
    );
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
    const typed = `${shortPlan.gradingTarget[0]} X ${shortPlan.gradingTarget.slice(1)}`;
    const result = gradeContinuousCopy(shortPlan, typed, {
      durationCompleted: shortPlan.scheduledDurationMs,
    });
    expect(result.targetCharacters).toBe(shortPlan.gradingTarget.length);
    expect(result.typedCharacters).toBe(shortPlan.gradingTarget.length + 1);
    expect(result.alignedCorrect).toBe(shortPlan.gradingTarget.length);
    expect(result.insertions).toBe(1);
    expect(result.deletions).toBe(0);
    expect(result.substitutions).toBe(0);
    expect(result.accuracy).toBe(1);
    expect(result.perCharacterResults.every((item) => item.correct)).toBe(true);
  });

  it("treats token separators as optional and excludes them from results", () => {
    const fixed = {
      ...shortPlan,
      tokens: [
        { kind: "random-group" as const, text: "KMK" },
        { kind: "random-group" as const, text: "MM" },
        { kind: "random-group" as const, text: "KKM" },
      ],
      audioText: "KMK MM KKM",
      gradingTarget: "KMKMMKKM",
      schedule: buildSchedule("KMK MM KKM", timing),
    };
    for (const answer of ["KMKMMKKM", "KMK MM KKM"]) {
      const result = gradeContinuousCopy(fixed, answer, {
        durationCompleted: fixed.schedule.totalMs,
      });
      expect(result.accuracy).toBe(1);
      expect(result.targetCharacters).toBe(8);
      expect(result.perCharacterResults).toHaveLength(8);
    }

    const shorter = gradeContinuousCopy(fixed, "KMK MM", {
      durationCompleted: fixed.schedule.totalMs,
    });
    expect(shorter).toMatchObject({
      alignedCorrect: 5,
      insertions: 0,
      deletions: 3,
      substitutions: 0,
    });
    expect(shorter.perCharacterResults.map((item) => item.correct)).toEqual([
      true,
      true,
      true,
      false,
      true,
      false,
      false,
      true,
    ]);

    const shortest = gradeContinuousCopy(fixed, "KKM", {
      durationCompleted: fixed.schedule.totalMs,
    });
    expect(shortest).toMatchObject({
      alignedCorrect: 3,
      insertions: 0,
      deletions: 5,
      substitutions: 0,
    });
    expect(shortest.perCharacterResults.map((item) => item.correct)).toEqual([
      false,
      false,
      false,
      false,
      false,
      true,
      true,
      true,
    ]);
  });

  it("handles deletion, substitution, and repeated characters deterministically", () => {
    const fixed = {
      ...shortPlan,
      tokens: [
        { kind: "random-group" as const, text: "KMM" },
        { kind: "random-group" as const, text: "U" },
      ],
      audioText: "KMM U",
      gradingTarget: "KMMU",
      schedule: buildSchedule("KMM U", timing),
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
    const result = gradeContinuousCopy(generated, generated.gradingTarget, {
      durationCompleted: generated.scheduledDurationMs,
    });
    const locked = nextLockedCharacter(state);

    expect(applyContinuousCopyResult(state, result)).toBe(
      generated.gradingTarget.length,
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
    const result = gradeContinuousCopy(generated, generated.gradingTarget, {
      durationCompleted: generated.scheduledDurationMs,
    });
    const finished = performance.now();

    expect(generated.scheduledDurationMs).toBeGreaterThanOrEqual(600000);
    expect(result.accuracy).toBe(1);
    expect(generatedAt - started).toBeLessThan(1000);
    expect(finished - generatedAt).toBeLessThan(1000);
  });
});
