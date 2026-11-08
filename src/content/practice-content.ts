// Copy-practice content generation, ported from the legacy prototype: random
// letter/number groups, common CW words, and callsign-style prompts. Pure and
// seedable so exercises are reproducible in tests.

import type { Rng } from "../core/rng.ts";
import {
  generateCallsignForStage,
  selectCallsign,
  type CallsignStage,
} from "./callsigns.ts";

export type CopyContentMode =
  "letters" | "letters-numbers" | "words" | "callsigns";

export type CopyPracticeScope = "unlocked" | "all-characters";

export const COPY_CONTENT_MODES: readonly CopyContentMode[] = [
  "letters",
  "letters-numbers",
  "words",
  "callsigns",
];

export const COPY_CONTENT_LABELS: Record<CopyContentMode, string> = {
  letters: "Letters",
  "letters-numbers": "Letters + numbers",
  words: "Common CW words",
  callsigns: "Callsigns",
};

export const COPY_PRACTICE_SCOPES: readonly CopyPracticeScope[] = [
  "unlocked",
  "all-characters",
];

export const COPY_PRACTICE_SCOPE_LABELS: Record<CopyPracticeScope, string> = {
  unlocked: "Unlocked",
  "all-characters": "All characters",
};

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const DIGITS = "0123456789";

/** Common CW abbreviations and words, as in the prototype. */
export const CW_WORDS: readonly string[] = [
  "CQ",
  "DE",
  "73",
  "88",
  "RST",
  "QTH",
  "QRZ",
  "QRM",
  "QRN",
  "QSB",
  "QSL",
  "QSO",
  "QRP",
  "QRT",
  "QSY",
  "TU",
  "FB",
  "OM",
  "YL",
  "GM",
  "GA",
  "GE",
  "GN",
  "DX",
  "ES",
  "HR",
  "PSE",
  "AGN",
  "TNX",
  "WX",
];

/** Number of characters in a random letter/number group. */
export const GROUP_SIZE = 5;

function pick(pool: string, rng: Rng): string {
  return pool[Math.floor(rng() * pool.length)];
}

function randomGroup(pool: string, size: number, rng: Rng): string {
  let group = "";
  for (let i = 0; i < size; i++) {
    group += pick(pool, rng);
  }
  return group;
}

function randomInt(min: number, max: number, rng: Rng): number {
  return min + Math.floor(rng() * (max - min + 1));
}

function uniqueCharacters(characters: Iterable<string>): string {
  let unique = "";
  for (const character of characters) {
    const upper = character.toUpperCase();
    if (!unique.includes(upper)) {
      unique += upper;
    }
  }
  return unique;
}

function filterPool(pool: string, allowed: string): string {
  let filtered = "";
  for (const character of pool) {
    if (allowed.includes(character)) {
      filtered += character;
    }
  }
  return filtered;
}

function isComposedOf(word: string, allowed: string): boolean {
  for (const character of word) {
    if (!allowed.includes(character)) {
      return false;
    }
  }
  return true;
}

export function eligibleCopyWords(unlocked: Iterable<string>): string[] {
  const allowed = uniqueCharacters(unlocked);
  if (allowed.length === 0) {
    return [];
  }
  return CW_WORDS.filter((word) => isComposedOf(word, allowed));
}

/** Generates a stage-specific plausible callsign prompt. */
export function generateCallsign(
  rng: Rng,
  stage: CallsignStage = "basic-domestic",
): string {
  return generateCallsignForStage(stage, rng);
}

export function generateStagedCallsignPrompt(
  stage: CallsignStage,
  rng: Rng,
  scope: CopyPracticeScope,
  unlocked: Iterable<string>,
): string | undefined {
  if (scope === "all-characters") {
    return generateCallsign(rng, stage);
  }
  const staged = selectCallsign(unlocked, rng, stage)?.text;
  if (staged) {
    return staged;
  }

  // Keep existing unlocked-scope practice behavior as a safe fallback for
  // sparse active sets while OP-2 stage gates are integrated in UI flow.
  if (stage === "basic-domestic") {
    const unlockedPool = uniqueCharacters(unlocked);
    const letters = filterPool(LETTERS, unlockedPool);
    const digits = filterPool(DIGITS, unlockedPool);
    if (letters.length > 0 && digits.length > 0) {
      const prefix = randomGroup(letters, randomInt(1, 2, rng), rng);
      const digit = pick(digits, rng);
      const suffix = randomGroup(letters, randomInt(1, 3, rng), rng);
      return prefix + digit + suffix;
    }
  }
  return undefined;
}

/** Generates one copy prompt for the given content mode. */
export function generateCopyPrompt(mode: CopyContentMode, rng: Rng): string {
  switch (mode) {
    case "letters":
      return randomGroup(LETTERS, GROUP_SIZE, rng);
    case "letters-numbers":
      return randomGroup(LETTERS + DIGITS, GROUP_SIZE, rng);
    case "words":
      return CW_WORDS[Math.floor(rng() * CW_WORDS.length)];
    case "callsigns":
      return generateCallsign(rng);
  }
}

export function generateScopedCopyPrompt(
  mode: CopyContentMode,
  rng: Rng,
  scope: CopyPracticeScope,
  unlocked: Iterable<string>,
): string | undefined {
  if (scope === "all-characters") {
    return generateCopyPrompt(mode, rng);
  }

  const unlockedPool = uniqueCharacters(unlocked);
  switch (mode) {
    case "letters": {
      const letters = filterPool(LETTERS, unlockedPool);
      return letters.length > 0
        ? randomGroup(letters, GROUP_SIZE, rng)
        : undefined;
    }
    case "letters-numbers": {
      const lettersAndNumbers = filterPool(LETTERS + DIGITS, unlockedPool);
      return lettersAndNumbers.length > 0
        ? randomGroup(lettersAndNumbers, GROUP_SIZE, rng)
        : undefined;
    }
    case "words": {
      const words = eligibleCopyWords(unlockedPool);
      if (words.length === 0) {
        return undefined;
      }
      return words[Math.floor(rng() * words.length)];
    }
    case "callsigns": {
      return generateStagedCallsignPrompt(
        "basic-domestic",
        rng,
        scope,
        unlockedPool,
      );
    }
  }
}
