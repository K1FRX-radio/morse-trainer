// Word corpus for Learn-mode copy practice. Words are filtered so only those
// composed entirely of unlocked characters are offered, with an option to favor
// words containing the newest character. Pure and seedable.

import type { Rng } from "../core/rng.ts";

export type WordTag = "general" | "ham" | "qso" | "prosign";

export const ON_AIR_VOCABULARY_STAGES = [
  "contact-setup",
  "signal-report",
  "courtesy-flow",
  "wrap-up",
] as const;

export type OnAirVocabularyStage = (typeof ON_AIR_VOCABULARY_STAGES)[number];

export type CorpusWord = {
  text: string;
  tags: readonly WordTag[];
  stages?: readonly OnAirVocabularyStage[];
};

/** Short, common words plus ham/QSO terms, all uppercase A-Z/0-9. */
export const WORD_CORPUS: readonly CorpusWord[] = [
  { text: "AN", tags: ["general"] },
  { text: "AS", tags: ["general", "prosign"] },
  { text: "AT", tags: ["general"] },
  { text: "AM", tags: ["general"] },
  { text: "ARE", tags: ["general"] },
  { text: "EAR", tags: ["general"] },
  { text: "ERA", tags: ["general"] },
  { text: "EAT", tags: ["general"] },
  { text: "TEA", tags: ["general"] },
  { text: "ATE", tags: ["general"] },
  { text: "NET", tags: ["general", "ham"] },
  { text: "TEN", tags: ["general"] },
  { text: "MAN", tags: ["general"] },
  { text: "NAME", tags: ["general", "qso"] },
  { text: "MEAN", tags: ["general"] },
  { text: "MEAT", tags: ["general"] },
  { text: "TEAM", tags: ["general"] },
  { text: "TERN", tags: ["general"] },
  { text: "RENT", tags: ["general"] },
  { text: "REST", tags: ["general"] },
  { text: "STAR", tags: ["general"] },
  { text: "RATE", tags: ["general"] },
  { text: "TEAR", tags: ["general"] },
  { text: "SANE", tags: ["general"] },
  { text: "NEAR", tags: ["general"] },
  { text: "SEAT", tags: ["general"] },
  { text: "EAST", tags: ["general"] },
  { text: "SENT", tags: ["general"] },
  { text: "MAST", tags: ["general", "ham"] },
  { text: "SMART", tags: ["general"] },
  { text: "STREAM", tags: ["general"] },
  { text: "MASTER", tags: ["general"] },
  {
    text: "CQ",
    tags: ["ham", "qso"],
    stages: ["contact-setup"],
  },
  {
    text: "DE",
    tags: ["ham", "qso"],
    stages: ["contact-setup"],
  },
  {
    text: "QRZ",
    tags: ["ham", "qso"],
    stages: ["contact-setup"],
  },
  {
    text: "QSO",
    tags: ["ham", "qso"],
    stages: ["contact-setup", "courtesy-flow"],
  },
  {
    text: "RST",
    tags: ["ham", "qso"],
    stages: ["signal-report"],
  },
  {
    text: "599",
    tags: ["ham", "qso"],
    stages: ["signal-report"],
  },
  {
    text: "579",
    tags: ["ham", "qso"],
    stages: ["signal-report"],
  },
  {
    text: "559",
    tags: ["ham", "qso"],
    stages: ["signal-report"],
  },
  {
    text: "QRM",
    tags: ["ham"],
    stages: ["signal-report"],
  },
  {
    text: "QRN",
    tags: ["ham"],
    stages: ["signal-report"],
  },
  {
    text: "QSB",
    tags: ["ham"],
    stages: ["signal-report"],
  },
  {
    text: "WX",
    tags: ["ham", "qso"],
    stages: ["signal-report", "courtesy-flow"],
  },
  {
    text: "QTH",
    tags: ["ham", "qso"],
    stages: ["courtesy-flow"],
  },
  {
    text: "TU",
    tags: ["ham", "qso"],
    stages: ["courtesy-flow", "wrap-up"],
  },
  {
    text: "TNX",
    tags: ["ham", "qso"],
    stages: ["courtesy-flow"],
  },
  {
    text: "FB",
    tags: ["ham", "qso"],
    stages: ["courtesy-flow"],
  },
  {
    text: "OM",
    tags: ["ham", "qso"],
    stages: ["courtesy-flow"],
  },
  {
    text: "ES",
    tags: ["ham", "qso"],
    stages: ["courtesy-flow"],
  },
  {
    text: "HR",
    tags: ["ham", "qso"],
    stages: ["courtesy-flow"],
  },
  {
    text: "AGN",
    tags: ["ham", "qso"],
    stages: ["courtesy-flow"],
  },
  {
    text: "PSE",
    tags: ["ham", "qso"],
    stages: ["courtesy-flow"],
  },
  {
    text: "BK",
    tags: ["ham", "qso", "prosign"],
    stages: ["courtesy-flow"],
  },
  {
    text: "KN",
    tags: ["ham", "qso", "prosign"],
    stages: ["courtesy-flow"],
  },
  {
    text: "AR",
    tags: ["ham", "qso", "prosign"],
    stages: ["courtesy-flow", "wrap-up"],
  },
  {
    text: "73",
    tags: ["ham", "qso"],
    stages: ["wrap-up"],
  },
  {
    text: "88",
    tags: ["ham", "qso"],
    stages: ["wrap-up"],
  },
  {
    text: "SK",
    tags: ["ham", "qso", "prosign"],
    stages: ["wrap-up"],
  },
  {
    text: "QSL",
    tags: ["ham", "qso"],
    stages: ["wrap-up"],
  },
  {
    text: "QRT",
    tags: ["ham"],
    stages: ["wrap-up"],
  },
  {
    text: "QRP",
    tags: ["ham"],
    stages: ["signal-report"],
  },
  {
    text: "QSY",
    tags: ["ham"],
    stages: ["courtesy-flow"],
  },
  {
    text: "DX",
    tags: ["ham"],
    stages: ["contact-setup", "signal-report"],
  },
];

export type WordSelectionOptions = {
  /** When true, only return words that contain the newest character. */
  requireNewest?: boolean;
  /** The newest unlocked character, used with requireNewest. */
  newest?: string;
  /** Restrict to words carrying at least one of these tags. */
  tags?: readonly WordTag[];
  /** Restrict to one staged on-air vocabulary track. */
  stage?: OnAirVocabularyStage;
};

function isEligible(
  word: CorpusWord,
  unlocked: ReadonlySet<string>,
  options: WordSelectionOptions,
): boolean {
  for (const char of word.text) {
    if (!unlocked.has(char)) {
      return false;
    }
  }
  if (options.requireNewest && options.newest) {
    if (!word.text.includes(options.newest)) {
      return false;
    }
  }
  if (options.tags && options.tags.length > 0) {
    if (!word.tags.some((tag) => options.tags?.includes(tag))) {
      return false;
    }
  }
  if (options.stage !== undefined) {
    if (!word.stages?.includes(options.stage)) {
      return false;
    }
  }
  return true;
}

/** All corpus words made only of unlocked characters, matching the options. */
export function eligibleWords(
  unlocked: Iterable<string>,
  options: WordSelectionOptions = {},
): CorpusWord[] {
  const set = new Set(unlocked);
  return WORD_CORPUS.filter((word) => isEligible(word, set, options));
}

/** Returns staged on-air vocabulary that matches unlocked characters. */
export function eligibleOnAirVocabulary(
  unlocked: Iterable<string>,
  stage: OnAirVocabularyStage,
): CorpusWord[] {
  return eligibleWords(unlocked, { stage });
}

/**
 * Picks one eligible word deterministically from the seeded RNG, or undefined
 * when no word qualifies (common in the earliest stages).
 */
export function selectEligibleWord(
  unlocked: Iterable<string>,
  rng: Rng,
  options: WordSelectionOptions = {},
): CorpusWord | undefined {
  const candidates = eligibleWords(unlocked, options);
  if (candidates.length === 0) {
    return undefined;
  }
  return candidates[Math.floor(rng() * candidates.length)];
}

/** Deterministically selects one staged on-air term, if any are eligible. */
export function selectOnAirVocabularyWord(
  unlocked: Iterable<string>,
  rng: Rng,
  stage: OnAirVocabularyStage,
): CorpusWord | undefined {
  return selectEligibleWord(unlocked, rng, { stage });
}
