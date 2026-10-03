import { describe, expect, it } from "vitest";
import { createRng } from "../core/rng.ts";
import {
  CW_WORDS,
  GROUP_SIZE,
  eligibleCopyWords,
  generateCallsign,
  generateCopyPrompt,
  generateScopedCopyPrompt,
} from "./practice-content.ts";

describe("generateCopyPrompt", () => {
  it("is deterministic for a given seed", () => {
    const a = generateCopyPrompt("letters", createRng(42));
    const b = generateCopyPrompt("letters", createRng(42));
    expect(a).toBe(b);
  });

  it("produces letter groups of the configured size", () => {
    const group = generateCopyPrompt("letters", createRng(1));
    expect(group).toHaveLength(GROUP_SIZE);
    expect(group).toMatch(/^[A-Z]+$/);
  });

  it("includes digits only in the letters-numbers mode", () => {
    const rng = createRng(7);
    let sawDigit = false;
    for (let i = 0; i < 50; i++) {
      if (/[0-9]/.test(generateCopyPrompt("letters-numbers", rng))) {
        sawDigit = true;
        break;
      }
    }
    expect(sawDigit).toBe(true);
  });

  it("draws words from the CW word list", () => {
    const word = generateCopyPrompt("words", createRng(3));
    expect(CW_WORDS).toContain(word);
  });

  it("generates callsign-style prompts with a digit", () => {
    const call = generateCallsign(createRng(9));
    expect(call).toMatch(/^[A-Z]{1,2}[0-9][A-Z]{1,3}$/);
  });

  it("defaults letters scope to unlocked characters only", () => {
    const prompt = generateScopedCopyPrompt(
      "letters",
      createRng(12),
      "unlocked",
      ["K", "M"],
    );
    expect(prompt).toBeDefined();
    expect(prompt).toHaveLength(GROUP_SIZE);
    expect(prompt).toMatch(/^[KM]+$/);
  });

  it("keeps digits locked in unlocked letters-numbers scope", () => {
    const prompt = generateScopedCopyPrompt(
      "letters-numbers",
      createRng(13),
      "unlocked",
      ["K", "M"],
    );
    expect(prompt).toBeDefined();
    expect(prompt).toMatch(/^[KM]+$/);
  });

  it("filters words to unlocked characters only", () => {
    const unlocked = ["Q", "R", "M", "N"];
    const words = eligibleCopyWords(unlocked);
    expect(words.length).toBeGreaterThan(0);
    for (const word of words) {
      expect(word).toMatch(/^[QRMN]+$/);
    }
    const prompt = generateScopedCopyPrompt(
      "words",
      createRng(14),
      "unlocked",
      unlocked,
    );
    expect(prompt).toBeDefined();
    expect(prompt).toMatch(/^[QRMN]+$/);
  });

  it("returns undefined for unlocked words with no eligible corpus entries", () => {
    const prompt = generateScopedCopyPrompt(
      "words",
      createRng(15),
      "unlocked",
      ["K", "M"],
    );
    expect(prompt).toBeUndefined();
  });

  it("returns undefined for unlocked callsigns without unlocked digits", () => {
    const prompt = generateScopedCopyPrompt(
      "callsigns",
      createRng(16),
      "unlocked",
      ["K", "M", "U"],
    );
    expect(prompt).toBeUndefined();
  });

  it("preserves broad pool behavior in all-characters scope", () => {
    const prompt = generateScopedCopyPrompt(
      "letters",
      createRng(17),
      "all-characters",
      ["K", "M"],
    );
    expect(prompt).toBeDefined();
    expect(prompt).toMatch(/^[A-Z]+$/);
    expect(prompt).not.toMatch(/^[KM]+$/);
  });

  it("generates unlocked callsigns when letters and digits are available", () => {
    const prompt = generateScopedCopyPrompt(
      "callsigns",
      createRng(18),
      "unlocked",
      ["K", "M", "2"],
    );
    expect(prompt).toBeDefined();
    expect(prompt).toMatch(/^[KM]{1,2}2[KM]{1,3}$/);
  });
});
