import { describe, expect, it } from "vitest";
import { createRng } from "../core/rng.ts";
import { WORD_CORPUS, eligibleWords, selectEligibleWord } from "./words.ts";

describe("eligibleWords", () => {
  it("returns only words made of unlocked characters", () => {
    const unlocked = ["A", "N", "E", "T"];
    const words = eligibleWords(unlocked);
    expect(words.length).toBeGreaterThan(0);
    for (const word of words) {
      for (const char of word.text) {
        expect(unlocked).toContain(char);
      }
    }
  });

  it("returns nothing when the unlocked set is too small", () => {
    expect(eligibleWords(["K"])).toEqual([]);
  });

  it("can require the newest character", () => {
    const unlocked = ["A", "N", "E", "T", "M"];
    const words = eligibleWords(unlocked, { requireNewest: true, newest: "M" });
    expect(words.length).toBeGreaterThan(0);
    for (const word of words) {
      expect(word.text).toContain("M");
    }
  });

  it("filters by tag", () => {
    const unlocked = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
    const words = eligibleWords(unlocked, { tags: ["qso"] });
    expect(words.length).toBeGreaterThan(0);
    for (const word of words) {
      expect(word.tags).toContain("qso");
    }
  });
});

describe("selectEligibleWord", () => {
  it("is deterministic for a seed", () => {
    const unlocked = ["A", "N", "E", "T", "R", "S"];
    const a = selectEligibleWord(unlocked, createRng(5));
    const b = selectEligibleWord(unlocked, createRng(5));
    expect(a).toEqual(b);
  });

  it("returns undefined when no word qualifies", () => {
    expect(selectEligibleWord(["K"], createRng(1))).toBeUndefined();
  });

  it("only draws words containing the newest when required", () => {
    const unlocked = ["A", "N", "E", "T", "M"];
    const rng = createRng(2);
    for (let i = 0; i < 30; i++) {
      const word = selectEligibleWord(unlocked, rng, {
        requireNewest: true,
        newest: "M",
      });
      if (word) {
        expect(word.text).toContain("M");
      }
    }
  });

  it("every corpus word is uppercase A-Z", () => {
    for (const word of WORD_CORPUS) {
      expect(word.text).toMatch(/^[A-Z]+$/);
    }
  });
});
