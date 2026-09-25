import { describe, expect, it } from "vitest";
import {
  DEFAULT_ADVANCEMENT_CONFIG,
  DEFAULT_CURRICULUM_CONFIG,
} from "../content/curriculum-data.ts";
import {
  createInitialState,
  forceUnlockNext,
  type CurriculumState,
} from "../core/curriculum.ts";
import type {
  ContinuousCharacterResult,
  ContinuousCopyResult,
} from "./continuous-copy.ts";
import {
  acceptAdvancement,
  evaluateAdvancementEvidence,
  minimumAdvancementObservations,
} from "./advancement.ts";

function stateWith(activeCount = 2): CurriculumState {
  const state = createInitialState(DEFAULT_CURRICULUM_CONFIG);
  while (state.characters.length < activeCount) forceUnlockNext(state);
  return state;
}

function observations(
  character: string,
  count: number,
  correct: number = count,
): ContinuousCharacterResult[] {
  return Array.from({ length: count }, (_, index) => ({
    character,
    correct: index < correct,
  }));
}

function stream(
  perCharacterResults: ContinuousCharacterResult[],
  overrides: Partial<ContinuousCopyResult> = {},
): ContinuousCopyResult {
  const alignedCorrect = perCharacterResults.filter(
    (observation) => observation.correct,
  ).length;
  return {
    randomGroupTokens: 6,
    wordTokens: 2,
    totalTokens: 8,
    targetCharacters: perCharacterResults.length,
    typedCharacters: perCharacterResults.length,
    alignedCorrect,
    accuracy:
      perCharacterResults.length === 0
        ? 0
        : alignedCorrect / perCharacterResults.length,
    perCharacterResults,
    insertions: 0,
    deletions: 0,
    substitutions: perCharacterResults.length - alignedCorrect,
    durationCompleted: 60000,
    abandoned: false,
    ...overrides,
  };
}

describe("minimumAdvancementObservations", () => {
  it("scales evidence sizing with the active set", () => {
    expect(minimumAdvancementObservations(2)).toBe(24);
    expect(minimumAdvancementObservations(5)).toBe(30);
    expect(minimumAdvancementObservations(10)).toBe(50);
    expect(minimumAdvancementObservations(41)).toBe(50);
  });

  it("throws when maximum evidence cannot cover the active set", () => {
    expect(() =>
      minimumAdvancementObservations(44, DEFAULT_ADVANCEMENT_CONFIG),
    ).toThrow(RangeError);
  });
});

describe("evaluateAdvancementEvidence", () => {
  it("accepts a perfect completed stream", () => {
    const result = stream([...observations("K", 16), ...observations("M", 8)]);
    expect(evaluateAdvancementEvidence(stateWith(), result)).toMatchObject({
      eligible: true,
      reason: "READY",
      overallAccuracy: 1,
      newestAccuracy: 1,
      newestObservations: 8,
      totalObservations: 24,
      coveredCharacters: ["K", "M"],
      missingCharacters: [],
      nextCharacter: "U",
    });
  });

  it("accepts exactly 90% overall and rejects just below it", () => {
    const exact = stream([
      ...observations("K", 22, 20),
      ...observations("M", 8, 7),
    ]);
    expect(evaluateAdvancementEvidence(stateWith(), exact)).toMatchObject({
      eligible: true,
      overallAccuracy: 0.9,
    });

    const below = stream([
      ...observations("K", 22, 19),
      ...observations("M", 8, 7),
    ]);
    expect(evaluateAdvancementEvidence(stateWith(), below).reason).toBe(
      "LOW_OVERALL_ACCURACY",
    );
  });

  it("accepts exactly 85% newest accuracy and rejects below it", () => {
    const exact = stream([
      ...observations("K", 13),
      ...observations("M", 20, 17),
    ]);
    expect(evaluateAdvancementEvidence(stateWith(), exact)).toMatchObject({
      eligible: true,
      newestAccuracy: 0.85,
    });

    const below = stream([
      ...observations("K", 20),
      ...observations("M", 20, 16),
    ]);
    expect(evaluateAdvancementEvidence(stateWith(), below).reason).toBe(
      "LOW_NEWEST_ACCURACY",
    );
  });

  it("requires exactly eight newest observations", () => {
    const exact = stream([...observations("K", 16), ...observations("M", 8)]);
    expect(evaluateAdvancementEvidence(stateWith(), exact).eligible).toBe(true);

    const seven = stream([...observations("K", 17), ...observations("M", 7)]);
    expect(evaluateAdvancementEvidence(stateWith(), seven).reason).toBe(
      "INSUFFICIENT_NEWEST_COVERAGE",
    );
  });

  it("requires every active character to appear", () => {
    const covered = stream([
      ...observations("K", 8),
      ...observations("M", 8),
      ...observations("U", 8),
    ]);
    expect(evaluateAdvancementEvidence(stateWith(3), covered).eligible).toBe(
      true,
    );

    const missing = stream([...observations("K", 16), ...observations("U", 8)]);
    expect(evaluateAdvancementEvidence(stateWith(3), missing)).toMatchObject({
      eligible: false,
      reason: "INCOMPLETE_ACTIVE_COVERAGE",
      missingCharacters: ["M"],
    });
  });

  it("accepts exact minimum evidence and rejects one observation below", () => {
    const exact = stream([...observations("K", 16), ...observations("M", 8)]);
    expect(evaluateAdvancementEvidence(stateWith(), exact).eligible).toBe(true);

    const short = stream([...observations("K", 15), ...observations("M", 8)]);
    expect(evaluateAdvancementEvidence(stateWith(), short).reason).toBe(
      "INSUFFICIENT_TOTAL_EVIDENCE",
    );
  });

  it("never accepts an abandoned stream", () => {
    const result = stream([...observations("K", 16), ...observations("M", 8)], {
      abandoned: true,
    });
    expect(evaluateAdvancementEvidence(stateWith(), result).reason).toBe(
      "ABANDONED",
    );
  });

  it("lets unresolved review veto otherwise strong evidence", () => {
    const state = stateWith();
    state.characters[0].needsReview = true;
    const result = stream([...observations("K", 16), ...observations("M", 8)]);
    expect(evaluateAdvancementEvidence(state, result)).toMatchObject({
      eligible: false,
      reason: "NEEDS_REVIEW",
      weakCharacter: "K",
    });
  });

  it("ignores TX history when evaluating advancement", () => {
    const state = stateWith();
    state.characters[0].tx.totalAttempts = 20;
    state.characters[0].tx.recentResults = new Array(20).fill(false);
    state.characters[1].tx.totalAttempts = 20;
    state.characters[1].tx.recentResults = new Array(20).fill(false);
    const result = stream([...observations("K", 16), ...observations("M", 8)]);

    expect(evaluateAdvancementEvidence(state, result)).toMatchObject({
      eligible: true,
      reason: "READY",
    });
  });

  it("offers completion only after the final active set passes evidence", () => {
    const state = stateWith(DEFAULT_CURRICULUM_CONFIG.order.length);
    const result = stream(
      state.characters.flatMap((character) =>
        observations(character.character, 8),
      ),
    );
    const assessment = evaluateAdvancementEvidence(state, result);
    expect(assessment).toMatchObject({
      eligible: true,
      reason: "COMPLETE",
    });
    expect(assessment).not.toHaveProperty("nextCharacter");
  });

  it.each<[string, Partial<ContinuousCopyResult>]>([
    ["ABANDONED", { abandoned: true }],
    ["INSUFFICIENT_TOTAL_EVIDENCE", { perCharacterResults: [] }],
  ])(
    "applies %s before offering final curriculum completion",
    (reason, overrides) => {
      const state = stateWith(DEFAULT_CURRICULUM_CONFIG.order.length);
      const complete = state.characters.flatMap((character) =>
        observations(character.character, 8),
      );
      const result = stream(complete, overrides);

      expect(evaluateAdvancementEvidence(state, result)).toMatchObject({
        eligible: false,
        reason,
      });
    },
  );

  it("applies review, coverage, newest, and accuracy checks to the final set", () => {
    const state = stateWith(DEFAULT_CURRICULUM_CONFIG.order.length);
    const active = state.characters.map(({ character }) => character);
    const newest = active.at(-1)!;
    const strong = active.flatMap((character) => observations(character, 8));

    state.characters[0].needsReview = true;
    expect(evaluateAdvancementEvidence(state, stream(strong)).reason).toBe(
      "NEEDS_REVIEW",
    );
    state.characters[0].needsReview = false;

    const missingCharacter = active[0];
    expect(
      evaluateAdvancementEvidence(
        state,
        stream(
          strong.filter(({ character }) => character !== missingCharacter),
        ),
      ).reason,
    ).toBe("INCOMPLETE_ACTIVE_COVERAGE");

    expect(
      evaluateAdvancementEvidence(
        state,
        stream([
          ...active.slice(0, -1).map((character) => ({
            character,
            correct: true,
          })),
          ...observations(newest, 7),
          ...observations(active[0], 50),
        ]),
      ).reason,
    ).toBe("INSUFFICIENT_NEWEST_COVERAGE");

    expect(
      evaluateAdvancementEvidence(
        state,
        stream(
          strong.map((result, index) => ({
            ...result,
            correct: index % 5 !== 0,
          })),
        ),
      ).reason,
    ).toBe("LOW_OVERALL_ACCURACY");

    expect(
      evaluateAdvancementEvidence(
        state,
        stream([
          ...active
            .slice(0, -1)
            .flatMap((character) => observations(character, 8)),
          ...observations(newest, 8, 6),
        ]),
      ).reason,
    ).toBe("LOW_NEWEST_ACCURACY");
  });

  it("allows strong overall evidence to carry a weak older character", () => {
    const result = stream([
      ...observations("K", 1, 0),
      ...observations("M", 39),
    ]);
    expect(evaluateAdvancementEvidence(stateWith(), result)).toMatchObject({
      eligible: true,
      reason: "READY",
      overallAccuracy: 0.975,
    });
  });

  it("treats word and group observations identically to token boundaries", () => {
    const perCharacterResults = [
      ...observations("K", 16),
      ...observations("M", 8),
    ];
    const grouped = stream(perCharacterResults, {
      randomGroupTokens: 8,
      wordTokens: 0,
      totalTokens: 8,
    });
    const mixed = stream(perCharacterResults, {
      randomGroupTokens: 4,
      wordTokens: 4,
      totalTokens: 8,
    });
    expect(evaluateAdvancementEvidence(stateWith(), mixed)).toEqual(
      evaluateAdvancementEvidence(stateWith(), grouped),
    );
  });

  it("attributes repeated aligned characters deterministically", () => {
    const result = stream([
      { character: "K", correct: true },
      { character: "M", correct: false },
      { character: "K", correct: false },
      ...observations("K", 14, 13),
      ...observations("M", 7),
    ]);
    expect(evaluateAdvancementEvidence(stateWith(), result)).toMatchObject({
      totalObservations: 24,
      overallAccuracy: 21 / 24,
      newestObservations: 8,
      newestAccuracy: 7 / 8,
    });
  });

  it("does not mutate curriculum state or stream evidence", () => {
    const state = stateWith();
    const result = stream([...observations("K", 16), ...observations("M", 8)]);
    const stateBefore = structuredClone(state);
    const resultBefore = structuredClone(result);
    evaluateAdvancementEvidence(state, result);
    expect(state).toEqual(stateBefore);
    expect(result).toEqual(resultBefore);
  });
});

describe("acceptAdvancement", () => {
  function qualifyingOffer(state: CurriculumState) {
    const result = stream([...observations("K", 16), ...observations("M", 8)]);
    return {
      result,
      assessment: evaluateAdvancementEvidence(state, result),
    };
  }

  it("unlocks exactly the offered next character", () => {
    const state = stateWith();
    const { result, assessment } = qualifyingOffer(state);

    expect(acceptAdvancement(state, result, assessment)).toEqual({
      type: "character-unlocked",
      character: "U",
    });
    expect(state.characters.map(({ character }) => character)).toEqual([
      "K",
      "M",
      "U",
    ]);
  });

  it("rejects duplicate acceptance", () => {
    const state = stateWith();
    const { result, assessment } = qualifyingOffer(state);

    expect(acceptAdvancement(state, result, assessment)).toEqual({
      type: "character-unlocked",
      character: "U",
    });
    expect(acceptAdvancement(state, result, assessment)).toBeUndefined();
    expect(state.characters.map(({ character }) => character)).toEqual([
      "K",
      "M",
      "U",
    ]);
  });

  it("rejects an offer when the active set changed", () => {
    const state = stateWith();
    const { result, assessment } = qualifyingOffer(state);
    forceUnlockNext(state);

    expect(acceptAdvancement(state, result, assessment)).toBeUndefined();
    expect(state.characters).toHaveLength(3);
  });

  it("rejects an offer invalidated by live review state", () => {
    const state = stateWith();
    const { result, assessment } = qualifyingOffer(state);
    state.characters[0].needsReview = true;

    expect(acceptAdvancement(state, result, assessment)).toBeUndefined();
    expect(state.characters).toHaveLength(2);
  });

  it("marks the final active set mastered only after completion acceptance", () => {
    const state = stateWith(DEFAULT_CURRICULUM_CONFIG.order.length);
    const result = stream(
      state.characters.flatMap(({ character }) => observations(character, 8)),
    );
    const assessment = evaluateAdvancementEvidence(state, result);
    const characterCount = state.characters.length;

    expect(state.characters.some(({ state }) => state !== "mastered")).toBe(
      true,
    );
    expect(
      acceptAdvancement(state, result, assessment, "2026-09-24T18:00:00.000Z"),
    ).toEqual({
      type: "curriculum-completed",
    });
    expect(state.characters).toHaveLength(characterCount);
    expect(state.characters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          state: "mastered",
          masteredAt: "2026-09-24T18:00:00.000Z",
        }),
      ]),
    );
    expect(state.characters.every(({ state }) => state === "mastered")).toBe(
      true,
    );
  });
});
