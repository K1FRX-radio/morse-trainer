import { describe, expect, it } from "vitest";
import { gradeCopy, gradeCopyAligned, normalizeCopy } from "./scoring.ts";

describe("normalizeCopy", () => {
  it("uppercases and strips whitespace", () => {
    expect(normalizeCopy(" ab cd ")).toBe("ABCD");
  });
});

describe("gradeCopy", () => {
  it("marks an exact match correct", () => {
    const grade = gradeCopy("SANE", "sane");
    expect(grade.correct).toBe(true);
    expect(grade.perChar).toEqual([true, true, true, true]);
  });

  it("reports per-character mismatches", () => {
    const grade = gradeCopy("CAT", "COT");
    expect(grade.correct).toBe(false);
    expect(grade.perChar).toEqual([true, false, true]);
  });

  it("fails when the answer is too short", () => {
    const grade = gradeCopy("REST", "RES");
    expect(grade.correct).toBe(false);
    expect(grade.perChar).toEqual([true, true, true, false]);
  });

  it("fails when the answer is too long", () => {
    expect(gradeCopy("AN", "ANT").correct).toBe(false);
  });
});

describe("gradeCopyAligned", () => {
  it("matches positional grading for exact answers", () => {
    const grade = gradeCopyAligned("KMU", "kmu");
    expect(grade.correct).toBe(true);
    expect(grade.perChar).toEqual([true, true, true]);
  });

  it("credits later characters despite a dropped character", () => {
    const grade = gradeCopyAligned("KMUR", "MUR");
    expect(grade.correct).toBe(false);
    expect(grade.perChar).toEqual([false, true, true, true]);
  });

  it("credits target characters despite an inserted character", () => {
    const grade = gradeCopyAligned("KMU", "KXMU");
    expect(grade.correct).toBe(false);
    expect(grade.perChar).toEqual([true, true, true]);
  });

  it("marks a substitution wrong only at that position", () => {
    const grade = gradeCopyAligned("CAT", "COT");
    expect(grade.correct).toBe(false);
    expect(grade.perChar).toEqual([true, false, true]);
  });
});
