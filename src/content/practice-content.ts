// Copy-practice content generation, ported from the legacy prototype: random
// letter/number groups, common CW words, and callsign-style prompts. Pure and
// seedable so exercises are reproducible in tests.

import type { Rng } from "../core/rng.ts";

export type CopyContentMode =
  | "letters"
  | "letters-numbers"
  | "words"
  | "callsigns";

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

function randomInt(min: number, max: number, rng: Rng): number {
  return min + Math.floor(rng() * (max - min + 1));
}

function randomGroup(pool: string, size: number, rng: Rng): string {
  let group = "";
  for (let i = 0; i < size; i++) {
    group += pick(pool, rng);
  }
  return group;
}

/** Generates a callsign-style prompt: 1-2 prefix letters, a digit, 1-3 suffix. */
export function generateCallsign(rng: Rng): string {
  const prefix = randomGroup(LETTERS, randomInt(1, 2, rng), rng);
  const digit = pick(DIGITS, rng);
  const suffix = randomGroup(LETTERS, randomInt(1, 3, rng), rng);
  return prefix + digit + suffix;
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
