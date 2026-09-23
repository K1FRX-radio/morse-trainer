import {
  DEFAULT_ADVANCEMENT_CONFIG,
  type AdvancementConfig,
} from "../content/curriculum-data.ts";
import {
  newestCharacter,
  nextLockedCharacter,
  unlockedCharacters,
  type CurriculumState,
} from "../core/curriculum.ts";
import type { ContinuousCopyResult } from "./continuous-copy.ts";

export type AdvancementReason =
  | "READY"
  | "ABANDONED"
  | "INSUFFICIENT_TOTAL_EVIDENCE"
  | "INCOMPLETE_ACTIVE_COVERAGE"
  | "INSUFFICIENT_NEWEST_COVERAGE"
  | "LOW_OVERALL_ACCURACY"
  | "LOW_NEWEST_ACCURACY"
  | "NEEDS_REVIEW"
  | "COMPLETE";

export type AdvancementAssessment = {
  eligible: boolean;
  reason: AdvancementReason;
  overallAccuracy: number;
  newestAccuracy: number;
  newestObservations: number;
  totalObservations: number;
  activeCharacters: string[];
  newestCharacter?: string;
  coveredCharacters: string[];
  missingCharacters: string[];
  weakCharacter?: string;
  nextCharacter?: string;
};

export function minimumAdvancementObservations(
  activeCharacterCount: number,
  config: AdvancementConfig = DEFAULT_ADVANCEMENT_CONFIG,
): number {
  if (activeCharacterCount < 1) {
    throw new RangeError("advancement requires at least one active character");
  }
  const requiredCoverage =
    activeCharacterCount - 1 + config.minNewestObservations;
  if (requiredCoverage > config.maxLength) {
    throw new RangeError(
      `advancement maxLength ${config.maxLength} cannot cover ${activeCharacterCount} active ` +
        `characters with ${config.minNewestObservations} newest observations ` +
        `(needs ${requiredCoverage})`,
    );
  }
  const scaled = Math.min(
    config.maxLength,
    Math.max(
      config.minLength,
      Math.round(activeCharacterCount * config.itemsPerActive),
    ),
  );
  return Math.max(scaled, requiredCoverage);
}

export function evaluateAdvancementEvidence(
  state: CurriculumState,
  result: ContinuousCopyResult,
  config: AdvancementConfig = DEFAULT_ADVANCEMENT_CONFIG,
): AdvancementAssessment {
  const activeCharacters = unlockedCharacters(state);
  const newest = newestCharacter(state)?.character;
  const nextCharacter = nextLockedCharacter(state);
  const counts = new Map<string, { observations: number; correct: number }>();
  let totalCorrect = 0;
  for (const observation of result.perCharacterResults) {
    const current = counts.get(observation.character) ?? {
      observations: 0,
      correct: 0,
    };
    current.observations += 1;
    if (observation.correct) {
      current.correct += 1;
      totalCorrect += 1;
    }
    counts.set(observation.character, current);
  }

  const totalObservations = result.perCharacterResults.length;
  const newestResult = newest ? counts.get(newest) : undefined;
  const newestObservations = newestResult?.observations ?? 0;
  const coveredCharacters = activeCharacters.filter(
    (character) => (counts.get(character)?.observations ?? 0) > 0,
  );
  const missingCharacters = activeCharacters.filter(
    (character) => !coveredCharacters.includes(character),
  );
  const overallAccuracy =
    totalObservations === 0 ? 0 : totalCorrect / totalObservations;
  const newestAccuracy =
    newestObservations === 0
      ? 0
      : (newestResult?.correct ?? 0) / newestObservations;
  const unresolved = state.characters.find(
    (character) => character.needsReview,
  );

  const base = {
    overallAccuracy,
    newestAccuracy,
    newestObservations,
    totalObservations,
    activeCharacters,
    ...(newest ? { newestCharacter: newest } : {}),
    coveredCharacters,
    missingCharacters,
    ...(nextCharacter ? { nextCharacter } : {}),
  };

  if (!nextCharacter) {
    return { ...base, eligible: false, reason: "COMPLETE" };
  }
  if (result.abandoned) {
    return { ...base, eligible: false, reason: "ABANDONED" };
  }
  if (unresolved) {
    return {
      ...base,
      eligible: false,
      reason: "NEEDS_REVIEW",
      weakCharacter: unresolved.character,
    };
  }
  if (
    totalObservations <
    minimumAdvancementObservations(activeCharacters.length, config)
  ) {
    return {
      ...base,
      eligible: false,
      reason: "INSUFFICIENT_TOTAL_EVIDENCE",
    };
  }
  if (missingCharacters.length > 0) {
    return {
      ...base,
      eligible: false,
      reason: "INCOMPLETE_ACTIVE_COVERAGE",
    };
  }
  if (newestObservations < config.minNewestObservations) {
    return {
      ...base,
      eligible: false,
      reason: "INSUFFICIENT_NEWEST_COVERAGE",
    };
  }
  if (overallAccuracy < config.overallAccuracy) {
    return { ...base, eligible: false, reason: "LOW_OVERALL_ACCURACY" };
  }
  if (newestAccuracy < config.newestAccuracy) {
    return { ...base, eligible: false, reason: "LOW_NEWEST_ACCURACY" };
  }
  return { ...base, eligible: true, reason: "READY" };
}
