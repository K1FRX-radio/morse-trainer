// Word corpus for Learn-mode copy practice. Words are filtered so only those
// composed entirely of unlocked characters are offered, with an option to favor
// words containing the newest character. Pure and seedable.

import type { Rng } from "../core/rng.ts";

export type WordTag = "general" | "ham" | "qso" | "prosign";

export type CorpusWord = {
  text: string;
  tags: readonly WordTag[];
};

/** Short, common words plus ham/QSO terms, all uppercase A-Z. */
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
  { text: "CQ", tags: ["ham", "qso"] },
  { text: "DE", tags: ["ham", "qso"] },
  { text: "RST", tags: ["ham", "qso"] },
  { text: "QTH", tags: ["ham", "qso"] },
  { text: "QSO", tags: ["ham", "qso"] },
  { text: "QRP", tags: ["ham"] },
  { text: "QRM", tags: ["ham"] },
  { text: "QSL", tags: ["ham", "qso"] },
  { text: "TU", tags: ["ham", "qso"] },
  { text: "FB", tags: ["ham", "qso"] },
  { text: "OM", tags: ["ham", "qso"] },
  { text: "ES", tags: ["ham", "qso"] },
  { text: "HR", tags: ["ham", "qso"] },
  { text: "TNX", tags: ["ham", "qso"] },
  { text: "AGN", tags: ["ham", "qso"] },
  { text: "WX", tags: ["ham", "qso"] },
  { text: "DX", tags: ["ham"] },
];

export type WordSelectionOptions = {
  /** When true, only return words that contain the newest character. */
  requireNewest?: boolean;
  /** The newest unlocked character, used with requireNewest. */
  newest?: string;
  /** Restrict to words carrying at least one of these tags. */
  tags?: readonly WordTag[];
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
