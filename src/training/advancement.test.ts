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
  it("preserves scaled checkpoint evidence sizing", () => {
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

  it("reports complete when every curriculum character is unlocked", () => {
    const state = stateWith(DEFAULT_CURRICULUM_CONFIG.order.length);
    const result = stream(
      state.characters.flatMap((character) =>
        observations(character.character, 8),
      ),
    );
    expect(evaluateAdvancementEvidence(state, result).reason).toBe("COMPLETE");
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
