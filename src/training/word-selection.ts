import {
  eligibleCallsigns,
  type CallsignEntry,
  type CallsignStage,
} from "../content/callsigns.ts";
import {
  eligibleOnAirVocabulary,
  eligibleWords,
  type CorpusWord,
  type OnAirVocabularyStage,
} from "../content/words.ts";

export type FocusedWordEligibility = {
  eligible: boolean;
  candidates: readonly CorpusWord[];
};

export type FocusedCallsignEligibility = {
  eligible: boolean;
  candidates: readonly CallsignEntry[];
};

export type WordEligibilityOptions = {
  active: readonly string[];
  minimumLength: number;
  maximumLength: number;
  minimumPoolSize: number;
};

export type OnAirVocabularyEligibilityOptions = WordEligibilityOptions & {
  stage: OnAirVocabularyStage;
};

export type CallsignEligibilityOptions = WordEligibilityOptions & {
  stage: CallsignStage;
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

export function evaluateOnAirVocabularyEligibility(
  options: OnAirVocabularyEligibilityOptions,
): FocusedWordEligibility {
  const candidates = eligibleOnAirVocabulary(
    options.active,
    options.stage,
  ).filter(
    (word) =>
      word.text.length >= options.minimumLength &&
      word.text.length <= options.maximumLength,
  );
  return {
    eligible: candidates.length >= options.minimumPoolSize,
    candidates,
  };
}

export function evaluateCallsignEligibility(
  options: CallsignEligibilityOptions,
): FocusedCallsignEligibility {
  const candidates = eligibleCallsigns(options.active, options.stage).filter(
    (callsign) =>
      callsign.text.length >= options.minimumLength &&
      callsign.text.length <= options.maximumLength,
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
