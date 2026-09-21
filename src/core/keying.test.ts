import { describe, expect, it } from "vitest";
import {
  classifyGap,
  decodeKeying,
  markToElement,
  thresholdsForWpm,
  type KeyEdge,
} from "./keying.ts";

// At 20 WPM the reference dit is 60 ms.
const t = thresholdsForWpm(20);

/**
 * Builds key edges from element/gap descriptors so tests read like Morse.
 * Marks are given in dit-multiples of tone-on; gaps in dit-multiples of silence.
 */
function edges(sequence: Array<[mark: number, gapAfter: number]>): KeyEdge[] {
  const result: KeyEdge[] = [];
  let now = 0;
  for (const [markDits, gapDits] of sequence) {
    result.push({ type: "down", t: now });
    now += markDits * t.ditMs;
    result.push({ type: "up", t: now });
    now += gapDits * t.ditMs;
  }
  return result;
}

describe("thresholdsForWpm", () => {
  it("derives a 60 ms dit at 20 WPM", () => {
    expect(t.ditMs).toBe(60);
    expect(t.dahThresholdDits).toBe(2);
    expect(t.charGapDits).toBe(3);
    expect(t.wordGapDits).toBe(7);
  });
});

describe("markToElement", () => {
  it("treats a 1-dit mark as a dit and a 3-dit mark as a dah", () => {
    expect(markToElement(60, t)).toBe(".");
    expect(markToElement(180, t)).toBe("-");
  });

  it("uses the 2-dit boundary inclusively for dahs", () => {
    expect(markToElement(119, t)).toBe(".");
    expect(markToElement(120, t)).toBe("-");
  });
});

describe("classifyGap", () => {
  it("classifies intra, character, and word gaps by dit thresholds", () => {
    expect(classifyGap(60, t)).toBe("intra");
    expect(classifyGap(179, t)).toBe("intra");
    expect(classifyGap(180, t)).toBe("char");
    expect(classifyGap(419, t)).toBe("char");
    expect(classifyGap(420, t)).toBe("word");
  });
});

describe("decodeKeying", () => {
  it("decodes a single character from its elements", () => {
    // A = dit dah, elements separated by a 1-dit intra gap.
    const result = decodeKeying(
      edges([
        [1, 1],
        [3, 0],
      ]),
      t,
    );
    expect(result.text).toBe("A");
    expect(result.marksMs).toEqual([60, 180]);
    expect(result.spacesMs).toEqual([60]);
  });

  it("splits characters on a 3-dit gap", () => {
    // A (dit dah) [char gap] N (dah dit) -> "AN".
    const result = decodeKeying(
      edges([
        [1, 1],
        [3, 3],
        [3, 1],
        [1, 0],
      ]),
      t,
    );
    expect(result.text).toBe("AN");
  });

  it("inserts a word space on a 7-dit gap", () => {
    // A [word gap] N -> "A N".
    const result = decodeKeying(
      edges([
        [1, 1],
        [3, 7],
        [3, 1],
        [1, 0],
      ]),
      t,
    );
    expect(result.text).toBe("A N");
  });

  it("emits ? for an unknown pattern", () => {
    // Six dahs is not a defined character.
    const result = decodeKeying(
      edges([
        [3, 1],
        [3, 1],
        [3, 1],
        [3, 1],
        [3, 1],
        [3, 0],
      ]),
      t,
    );
    expect(result.text).toBe("?");
  });

  it("returns empty output for no edges", () => {
    expect(decodeKeying([], t)).toEqual({
      text: "",
      marksMs: [],
      spacesMs: [],
    });
  });

  it("ignores a trailing unmatched key-down", () => {
    const result = decodeKeying(
      [
        { type: "down", t: 0 },
        { type: "up", t: 60 },
        { type: "down", t: 200 },
      ],
      t,
    );
    expect(result.text).toBe("E");
    expect(result.marksMs).toEqual([60]);
  });
});
