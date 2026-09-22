import { eligibleWords, type CorpusWord } from "../content/words.ts";

export type FocusedWordEligibility = {
  eligible: boolean;
  candidates: readonly CorpusWord[];
};

export type WordEligibilityOptions = {
  active: readonly string[];
  minimumLength: number;
  maximumLength: number;
  minimumPoolSize: number;
};

export type WordSelectionWeights = {
  newest: number;
  review: number;
  weak: number;
};

export const DEFAULT_WORD_SELECTION_WEIGHTS: WordSelectionWeights = {
  newest: 2,
  review: 3,
  weak: 2,
};

export function evaluateWordEligibility(
  options: WordEligibilityOptions,
): FocusedWordEligibility {
  const candidates = eligibleWords(options.active).filter(
    (word) =>
      word.text.length >= options.minimumLength &&
      word.text.length <= options.maximumLength,
  );
  return {
    eligible: candidates.length >= options.minimumPoolSize,
    candidates,
  };
}

export function wordSelectionWeight(
  text: string,
  newest: string,
  review: ReadonlySet<string>,
  weak: ReadonlySet<string>,
  weights: WordSelectionWeights = DEFAULT_WORD_SELECTION_WEIGHTS,
): number {
  return (
    1 +
    (text.includes(newest) ? weights.newest : 0) +
    ([...review].some((character) => text.includes(character))
      ? weights.review
      : 0) +
    ([...weak].some((character) => text.includes(character)) ? weights.weak : 0)
  );
}
