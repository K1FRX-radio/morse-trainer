import { describe, expect, it } from "vitest";
import {
  gradeCopy,
  gradeCopyAligned,
  gradeCopyDetailed,
  normalizeCopy,
} from "./scoring.ts";

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

describe("gradeCopyAligned repeated and ambiguous characters", () => {
  // Deterministic tie-break: right-most occurrences are credited, and a single
  // insertion/deletion stays confined to one target position (no cascade).
  it("confines a dropped repeat to one interior position", () => {
    expect(gradeCopyAligned("KMM", "KM").perChar).toEqual([true, false, true]);
    expect(gradeCopyAligned("KMK", "KK").perChar).toEqual([true, false, true]);
  });

  it("confines a dropped leading repeat to the first position", () => {
    expect(gradeCopyAligned("KKM", "KM").perChar).toEqual([false, true, true]);
  });

  it("does not shift later characters after a leading insertion", () => {
    expect(gradeCopyAligned("KM", "XKM").perChar).toEqual([true, true]);
  });

  it("does not shift characters after a trailing insertion", () => {
    expect(gradeCopyAligned("KM", "KMX").perChar).toEqual([true, true]);
  });

  it("credits later characters after a leading deletion", () => {
    expect(gradeCopyAligned("KMUR", "MUR").perChar).toEqual([
      false,
      true,
      true,
      true,
    ]);
  });

  it("handles multiple insertions and deletions", () => {
    // Mid insertion of X: every target position still credited.
    expect(gradeCopyAligned("KMUR", "KXMUR").perChar).toEqual([
      true,
      true,
      true,
      true,
    ]);
    // Leading deletion plus a trailing substitution.
    expect(gradeCopyAligned("KMUR", "MUX").perChar).toEqual([
      false,
      true,
      true,
      false,
    ]);
  });

  it("is deterministic for the same inputs", () => {
    expect(gradeCopyAligned("KMM", "KM")).toEqual(
      gradeCopyAligned("KMM", "KM"),
    );
  });
});

describe("gradeCopyDetailed", () => {
  it("counts insertions, deletions, substitutions, and aligned matches", () => {
    expect(gradeCopyDetailed("KMUR", "KXMUR")).toMatchObject({
      targetCharacters: 4,
      typedCharacters: 5,
      alignedCorrect: 4,
      insertions: 1,
      deletions: 0,
      substitutions: 0,
      perChar: [true, true, true, true],
      alignment: [
        { kind: "match", target: "K", answer: "K" },
        { kind: "insertion", answer: "X" },
        { kind: "match", target: "M", answer: "M" },
        { kind: "match", target: "U", answer: "U" },
        { kind: "match", target: "R", answer: "R" },
      ],
    });
    expect(gradeCopyDetailed("KMUR", "KMR")).toMatchObject({
      alignedCorrect: 3,
      insertions: 0,
      deletions: 1,
      substitutions: 0,
      perChar: [true, true, false, true],
    });
    expect(gradeCopyDetailed("KMU", "KXU")).toMatchObject({
      alignedCorrect: 2,
      insertions: 0,
      deletions: 0,
      substitutions: 1,
      perChar: [true, false, true],
    });
  });

  it("preserves repeated-character tie-breaking", () => {
    expect(gradeCopyDetailed("KMM", "KM")).toMatchObject({
      perChar: [true, false, true],
      alignedCorrect: 2,
      deletions: 1,
    });
  });
});
