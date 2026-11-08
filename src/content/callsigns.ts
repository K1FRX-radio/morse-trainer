import type { Rng } from "../core/rng.ts";

export const CALLSIGN_STAGES = [
  "basic-domestic",
  "international",
  "portable-identifiers",
  "special-event",
] as const;

export type CallsignStage = (typeof CALLSIGN_STAGES)[number];

export type CallsignEntry = {
  text: string;
  stages: readonly CallsignStage[];
  source: "curated" | "generated";
};

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const DIGITS = "0123456789";

function pick<T>(items: readonly T[], rng: Rng): T {
  return items[Math.floor(rng() * items.length)];
}

function pickChar(pool: string, rng: Rng): string {
  return pool[Math.floor(rng() * pool.length)];
}

function randomInt(min: number, max: number, rng: Rng): number {
  return min + Math.floor(rng() * (max - min + 1));
}

function randomLetters(length: number, rng: Rng): string {
  let text = "";
  for (let i = 0; i < length; i++) {
    text += pickChar(LETTERS, rng);
  }
  return text;
}

function randomBaseCallsign(prefixes: readonly string[], rng: Rng): string {
  const prefix = pick(prefixes, rng);
  const digit = pickChar(DIGITS, rng);
  const suffix = randomLetters(randomInt(1, 3, rng), rng);
  return prefix + digit + suffix;
}

export const CALLSIGN_CURATED_EXAMPLES: readonly CallsignEntry[] = [
  { text: "K1ABC", stages: ["basic-domestic"], source: "curated" },
  { text: "W9DX", stages: ["basic-domestic"], source: "curated" },
  { text: "N4T", stages: ["basic-domestic"], source: "curated" },
  { text: "AA7Q", stages: ["basic-domestic"], source: "curated" },
  { text: "DL1ABC", stages: ["international"], source: "curated" },
  { text: "JA3YAA", stages: ["international"], source: "curated" },
  { text: "VK2DX", stages: ["international"], source: "curated" },
  { text: "ZS6TN", stages: ["international"], source: "curated" },
  {
    text: "K1ABC/P",
    stages: ["portable-identifiers"],
    source: "curated",
  },
  {
    text: "DL2AN/M",
    stages: ["portable-identifiers"],
    source: "curated",
  },
  {
    text: "EA8/K1ABC",
    stages: ["portable-identifiers"],
    source: "curated",
  },
  {
    text: "W1AW/4",
    stages: ["portable-identifiers"],
    source: "curated",
  },
  { text: "W1A", stages: ["special-event"], source: "curated" },
  { text: "N4C", stages: ["special-event"], source: "curated" },
  { text: "GB2RS", stages: ["special-event"], source: "curated" },
  { text: "II0HQ", stages: ["special-event"], source: "curated" },
];

const BASIC_PREFIXES = ["K", "N", "W", "AA", "AB", "AC"] as const;
const INTERNATIONAL_PREFIXES = [
  "DL",
  "F",
  "G",
  "I",
  "JA",
  "VK",
  "ZS",
  "VE",
  "VA",
  "XE",
  "PY",
  "SM",
  "OH",
  "EA",
  "LU",
] as const;
const PORTABLE_ISLAND_PREFIXES = ["EA8", "CT3", "KH6", "VP9", "ZS8"] as const;

export function isPlausibleCallsignForStage(
  text: string,
  stage: CallsignStage,
): boolean {
  switch (stage) {
    case "basic-domestic":
      return /^[KNW][0-9][A-Z]{1,3}$|^[A-Z]{2}[0-9][A-Z]{1,3}$/.test(text);
    case "international":
      return /^[A-Z]{1,2}[0-9][A-Z]{1,3}$/.test(text);
    case "portable-identifiers":
      return (
        /^[A-Z]{1,2}[0-9][A-Z]{1,3}\/(P|M|QRP)$/.test(text) ||
        /^[A-Z0-9]{2,4}\/[A-Z]{1,2}[0-9][A-Z]{1,3}$/.test(text) ||
        /^[A-Z]{1,2}[0-9][A-Z]{1,3}\/[0-9]$/.test(text)
      );
    case "special-event":
      return (
        /^[KNW][0-9][A-Z]$/.test(text) ||
        /^GB[0-9][A-Z]{2}$/.test(text) ||
        /^(II|AO|TM|LZ|9A)[0-9][A-Z]{2}$/.test(text)
      );
  }
}

export function generateCallsignForStage(
  stage: CallsignStage,
  rng: Rng,
): string {
  switch (stage) {
    case "basic-domestic":
      return randomBaseCallsign(BASIC_PREFIXES, rng);
    case "international":
      return randomBaseCallsign(INTERNATIONAL_PREFIXES, rng);
    case "portable-identifiers": {
      const base = randomBaseCallsign(INTERNATIONAL_PREFIXES, rng);
      const variant = Math.floor(rng() * 5);
      switch (variant) {
        case 0:
          return `${base}/P`;
        case 1:
          return `${base}/M`;
        case 2:
          return `${base}/QRP`;
        case 3:
          return `${pick(PORTABLE_ISLAND_PREFIXES, rng)}/${randomBaseCallsign(BASIC_PREFIXES, rng)}`;
        default:
          return `${randomBaseCallsign(BASIC_PREFIXES, rng)}/${pickChar(DIGITS, rng)}`;
      }
    }
    case "special-event": {
      const variant = Math.floor(rng() * 3);
      switch (variant) {
        case 0:
          return `${pick(["K", "N", "W"] as const, rng)}${pickChar(DIGITS, rng)}${randomLetters(1, rng)}`;
        case 1:
          return `GB${pickChar(DIGITS, rng)}${randomLetters(2, rng)}`;
        default:
          return `${pick(["II", "AO", "TM", "LZ", "9A"] as const, rng)}${pickChar(DIGITS, rng)}${randomLetters(2, rng)}`;
      }
    }
  }
}

function isEligibleText(text: string, unlocked: ReadonlySet<string>): boolean {
  for (const character of text) {
    if (!unlocked.has(character)) {
      return false;
    }
  }
  return true;
}

/** Returns stage-tagged curated callsigns that can be copied with unlocked symbols. */
export function eligibleCallsigns(
  unlocked: Iterable<string>,
  stage: CallsignStage,
): CallsignEntry[] {
  const set = new Set(unlocked);
  return CALLSIGN_CURATED_EXAMPLES.filter(
    (entry) => entry.stages.includes(stage) && isEligibleText(entry.text, set),
  );
}

/**
 * Deterministically selects one plausible callsign for a stage, preferring
 * curated examples when available and falling back to seeded generation.
 */
export function selectCallsign(
  unlocked: Iterable<string>,
  rng: Rng,
  stage: CallsignStage,
): CallsignEntry | undefined {
  const set = new Set(unlocked);
  const curated = eligibleCallsigns(set, stage);
  if (curated.length > 0 && rng() < 0.6) {
    return curated[Math.floor(rng() * curated.length)];
  }
  for (let attempt = 0; attempt < 32; attempt++) {
    const text = generateCallsignForStage(stage, rng);
    if (isEligibleText(text, set)) {
      return { text, stages: [stage], source: "generated" };
    }
  }
  if (curated.length === 0) {
    return undefined;
  }
  return curated[Math.floor(rng() * curated.length)];
}
