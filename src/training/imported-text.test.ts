import { describe, expect, it } from "vitest";
import {
  createImportedTextPlan,
  MAX_IMPORTED_TEXT_LENGTH,
} from "./imported-text.ts";

describe("createImportedTextPlan", () => {
  it("normalizes whitespace and emits bounded playback chunks", () => {
    const plan = createImportedTextPlan("  CQ\n\nTEST\tDE   K1FRX  ");

    expect(plan.normalizedText).toBe("CQ TEST DE K1FRX");
    expect(plan.chunks).toEqual(["CQ ", "TEST ", "DE ", "K1FRX"]);
    expect(plan.totalWords).toBe(4);
    expect(plan.unsupportedCharacters).toEqual([]);
  });

  it("reports unsupported characters while preserving playable text", () => {
    const plan = createImportedTextPlan("A @ B # C @");

    expect(plan.normalizedText).toBe("A B C");
    expect(plan.unsupportedCharacters).toEqual(["@", "#"]);
    expect(plan.chunks).toEqual(["A ", "B ", "C"]);
  });

  it("returns an empty plan when no supported characters are available", () => {
    const plan = createImportedTextPlan("@@@ ###");

    expect(plan.normalizedText).toBe("");
    expect(plan.chunks).toEqual([]);
    expect(plan.totalWords).toBe(0);
    expect(plan.unsupportedCharacters).toEqual(["@", "#"]);
  });

  it("rejects unbounded input lengths", () => {
    const tooLong = "A".repeat(MAX_IMPORTED_TEXT_LENGTH + 1);

    expect(() => createImportedTextPlan(tooLong)).toThrow(
      /cannot exceed 10000/,
    );
  });
});
