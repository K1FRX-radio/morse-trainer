import {
  DEFAULT_ADVANCEMENT_CONFIG,
  type AdvancementConfig,
} from "../content/curriculum-data.ts";
import {
  completeCurriculum,
  forceUnlockNext,
  newestCharacter,
  nextLockedCharacter,
  unlockedCharacters,
  type CurriculumState,
} from "../core/curriculum.ts";
import type { CharacterWpmBand, EffectiveWpmBand } from "../core/settings.ts";
import type { ContinuousCopyResult } from "./continuous-copy.ts";

type AdvancementEvidence = Pick<
  ContinuousCopyResult,
  "abandoned" | "perCharacterResults"
>;

export type AdvancementReason =
  | "READY"
  | "ABANDONED"
  | "INSUFFICIENT_TOTAL_EVIDENCE"
  | "INCOMPLETE_ACTIVE_COVERAGE"
  | "INSUFFICIENT_NEWEST_COVERAGE"
  | "LOW_OVERALL_ACCURACY"
  | "LOW_NEWEST_ACCURACY"
  | "NEEDS_REVIEW"
  | "SPEED_REACQUISITION"
  | "COMPLETE";

export type AdvancementSpeedBands = {
  charWpmBand: CharacterWpmBand;
  effectiveWpmBand: EffectiveWpmBand;
};

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
  speedBands?: AdvancementSpeedBands;
};

export type AdvancementAcceptance =
  | { type: "character-unlocked"; character: string }
  | { type: "curriculum-completed" };

export type AdvancementTransitionRequest = {
  activeCharacters: string[];
  type: AdvancementAcceptance["type"];
  unlockedCharacter?: string;
};

export type AdvancementTransitionResult = {
  acceptance: AdvancementAcceptance;
  newlyMasteredCharacters: string[];
};

export function applyAdvancementTransition(
  state: CurriculumState,
  request: AdvancementTransitionRequest,
  at?: string,
): AdvancementTransitionResult | undefined {
  if (
    state.characters.some(({ needsReview }) => needsReview) ||
    request.activeCharacters.length !== state.characters.length ||
    request.activeCharacters.some(
      (character, index) => character !== state.characters[index]?.character,
    )
  ) {
    return undefined;
  }
  const nextCharacter = nextLockedCharacter(state);
  if (
    (request.type === "character-unlocked" &&
      (request.unlockedCharacter === undefined ||
        request.unlockedCharacter !== nextCharacter)) ||
    (request.type === "curriculum-completed" &&
      (request.unlockedCharacter !== undefined || nextCharacter !== undefined))
  ) {
    return undefined;
  }

  const newlyMasteredCharacters = state.characters
    .filter(({ state }) => state !== "mastered")
    .map(({ character }) => character);
  completeCurriculum(state, at);
  if (request.type === "curriculum-completed") {
    return {
      acceptance: { type: "curriculum-completed" },
      newlyMasteredCharacters,
    };
  }
  const character = forceUnlockNext(state, at);
  if (character === undefined) return undefined;
  return {
    acceptance: { type: "character-unlocked", character },
    newlyMasteredCharacters,
  };
}

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
  result: AdvancementEvidence,
  config: AdvancementConfig = DEFAULT_ADVANCEMENT_CONFIG,
  speedBands?: AdvancementSpeedBands,
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
    ...(speedBands ? { speedBands } : {}),
  };

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
  if (!nextCharacter) {
    return {
      ...base,
      eligible: state.characters.some(({ state }) => state !== "mastered"),
      reason: "COMPLETE",
    };
  }
  return { ...base, eligible: true, reason: "READY" };
}

/**
 * Advancement offers are bound to the speed bands where their readiness
 * evidence was collected. If settings change bands before acceptance, force a
 * new qualifying stream at the current band.
 */
export function requireCurrentBandReacquisition(
  assessment: AdvancementAssessment,
  currentBands: AdvancementSpeedBands,
): AdvancementAssessment {
  if (!assessment.eligible) {
    return assessment;
  }
  if (!assessment.speedBands) {
    return assessment;
  }
  if (
    assessment.speedBands.charWpmBand === currentBands.charWpmBand &&
    assessment.speedBands.effectiveWpmBand === currentBands.effectiveWpmBand
  ) {
    return assessment;
  }
  return {
    ...assessment,
    eligible: false,
    reason: "SPEED_REACQUISITION",
  };
}

export function acceptAdvancement(
  state: CurriculumState,
  result: ContinuousCopyResult,
  offeredAssessment: AdvancementAssessment,
  at?: string,
  config: AdvancementConfig = DEFAULT_ADVANCEMENT_CONFIG,
): AdvancementAcceptance | undefined {
  const currentAssessment = evaluateAdvancementEvidence(state, result, config);
  if (!currentAssessment.eligible || !offeredAssessment.eligible) {
    return undefined;
  }
  if (
    currentAssessment.nextCharacter !== offeredAssessment.nextCharacter ||
    currentAssessment.activeCharacters.length !==
      offeredAssessment.activeCharacters.length ||
    currentAssessment.activeCharacters.some(
      (character, index) =>
        character !== offeredAssessment.activeCharacters[index],
    )
  ) {
    return undefined;
  }
  if (currentAssessment.reason === "COMPLETE") {
    return applyAdvancementTransition(
      state,
      {
        activeCharacters: currentAssessment.activeCharacters,
        type: "curriculum-completed",
      },
      at,
    )?.acceptance;
  }
  return applyAdvancementTransition(
    state,
    {
      activeCharacters: currentAssessment.activeCharacters,
      type: "character-unlocked",
      unlockedCharacter: currentAssessment.nextCharacter!,
    },
    at,
  )?.acceptance;
}
