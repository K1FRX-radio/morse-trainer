import { describe, expect, it } from "vitest";
import {
  MORSE_CHARACTERS,
  decodePattern,
  encodeCharacter,
  encodeText,
  isSupportedCharacter,
} from "./morse.ts";

describe("morse mapping", () => {
  it("round-trips every supported character", () => {
    for (const character of MORSE_CHARACTERS) {
      const pattern = encodeCharacter(character);
      expect(pattern, `pattern for ${character}`).toBeDefined();
      expect(decodePattern(pattern!)).toBe(character);
    }
  });

  it("is case-insensitive on input", () => {
    expect(encodeCharacter("a")).toBe(".-");
    expect(encodeCharacter("A")).toBe(".-");
  });

  it("returns undefined for unsupported characters and patterns", () => {
    expect(encodeCharacter("~")).toBeUndefined();
    expect(encodeCharacter("é")).toBeUndefined();
    expect(decodePattern("........")).toBeUndefined();
    expect(isSupportedCharacter("~")).toBe(false);
    expect(isSupportedCharacter("S")).toBe(true);
  });

  it("encodes text with word boundaries and skips unsupported characters", () => {
    expect(encodeText("A B")).toEqual([
      { character: "A", pattern: ".-" },
      { character: " ", pattern: "" },
      { character: "B", pattern: "-..." },
    ]);
    expect(encodeText("A~B")).toEqual([
      { character: "A", pattern: ".-" },
      { character: "B", pattern: "-..." },
    ]);
  });
});
