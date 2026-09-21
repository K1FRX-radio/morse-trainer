import { describe, expect, it } from "vitest";
import { createRng } from "../core/rng.ts";
import {
  CW_WORDS,
  GROUP_SIZE,
  generateCallsign,
  generateCopyPrompt,
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
});
