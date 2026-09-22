// Koch-style curriculum state and unlock rules. RX performance drives unlocks;
// TX performance is tracked separately and never blocks progression.

import {
  DEFAULT_READINESS_CONFIG,
  type CurriculumConfig,
  type ReadinessConfig,
} from "../content/curriculum-data.ts";
import type { CharacterProgress, Direction, SkillProgress } from "./types.ts";

export type CurriculumState = {
  config: CurriculumConfig;
  /** Unlocked characters in curriculum order. Never shrinks. */
  characters: CharacterProgress[];
};

function emptySkill(): SkillProgress {
  return { totalAttempts: 0, recentResults: [] };
}

function unlockedProgress(character: string, at?: string): CharacterProgress {
  return {
    character,
    state: "learning",
    needsReview: false,
    reviewStreak: 0,
    rx: emptySkill(),
    tx: emptySkill(),
    ...(at !== undefined ? { unlockedAt: at } : {}),
  };
}

export function createInitialState(
  config: CurriculumConfig,
  at?: string,
): CurriculumState {
  const count = Math.min(config.startCount, config.order.length);
  const characters: CharacterProgress[] = [];
  for (let i = 0; i < count; i++) {
    characters.push(unlockedProgress(config.order[i], at));
  }
  return { config, characters };
}

/** Recent accuracy over the rolling window; 0 when there are no observations. */
export function recentAccuracy(skill: SkillProgress): number {
  if (skill.recentResults.length === 0) {
    return 0;
  }
  const correct = skill.recentResults.filter(Boolean).length;
  return correct / skill.recentResults.length;
}

function findCharacter(
  state: CurriculumState,
  character: string,
): CharacterProgress | undefined {
  return state.characters.find((c) => c.character === character);
}

/** The most recently unlocked (newest) character, if any. */
export function newestCharacter(
  state: CurriculumState,
): CharacterProgress | undefined {
  return state.characters[state.characters.length - 1];
}

/**
 * Records one attempt result for a character/direction. Mutates and returns the
 * character's progress. Unknown or locked characters are ignored.
 */
export function recordAttempt(
  state: CurriculumState,
  character: string,
  direction: Direction,
  correct: boolean,
  at?: string,
): CharacterProgress | undefined {
  const progress = findCharacter(state, character);
  if (!progress) {
    return undefined;
  }
  const skill = direction === "rx" ? progress.rx : progress.tx;
  skill.totalAttempts += 1;
  skill.recentResults.push(correct);
  if (skill.recentResults.length > state.config.windowSize) {
    skill.recentResults.splice(
      0,
      skill.recentResults.length - state.config.windowSize,
    );
  }
  if (at !== undefined) {
    progress.lastPracticedAt = at;
  }

  // A previously strong character whose recent RX accuracy decays is flagged.
  // needsReview is only cleared by remediation (see recordReviewOutcome), never
  // by a high rolling average alone.
  if (
    direction === "rx" &&
    skill.recentResults.length >= state.config.minNewCharObservations &&
    recentAccuracy(skill) < state.config.reviewDecayAccuracy
  ) {
    progress.needsReview = true;
  }

  return progress;
}

/** The next locked character in curriculum order, or undefined if all unlocked. */
export function nextLockedCharacter(
  state: CurriculumState,
): string | undefined {
  return state.config.order[state.characters.length];
}

/**
 * Whether the newest character has met the RX unlock criteria: enough
 * observations and sufficient recent RX accuracy. TX is never consulted.
 */
export function canUnlockNext(state: CurriculumState): boolean {
  if (nextLockedCharacter(state) === undefined) {
    return false;
  }
  const newest = newestCharacter(state);
  if (!newest) {
    return false;
  }
  if (newest.rx.recentResults.length < state.config.minNewCharObservations) {
    return false;
  }
  return recentAccuracy(newest.rx) >= state.config.unlockAccuracy;
}

/**
 * Unlocks the next character when criteria are met. Returns the newly unlocked
 * character, or undefined if nothing was unlocked. Never relocks characters.
 */
export function unlockNext(
  state: CurriculumState,
  at?: string,
): string | undefined {
  if (!canUnlockNext(state)) {
    return undefined;
  }
  const next = nextLockedCharacter(state);
  if (next === undefined) {
    return undefined;
  }
  state.characters.push(unlockedProgress(next, at));
  return next;
}

/** Characters currently unlocked, in curriculum order. */
export function unlockedCharacters(state: CurriculumState): string[] {
  return state.characters.map((c) => c.character);
}

/** Default consecutive clean correct responses needed to clear needsReview. */
export const DEFAULT_REMEDIATION_STREAK = 3;

/**
 * Records an isolated, unassisted RX outcome toward clearing needsReview. A miss
 * resets the streak; needsReview clears only after streakToClear consecutive
 * clean correct responses. Assisted and replayed responses must not call this.
 */
export function recordReviewOutcome(
  state: CurriculumState,
  character: string,
  correct: boolean,
  streakToClear: number = DEFAULT_REMEDIATION_STREAK,
): void {
  const progress = findCharacter(state, character);
  if (!progress) {
    return;
  }
  if (!correct) {
    progress.reviewStreak = 0;
    return;
  }
  progress.reviewStreak = (progress.reviewStreak ?? 0) + 1;
  if (progress.needsReview && progress.reviewStreak >= streakToClear) {
    progress.needsReview = false;
    progress.reviewStreak = 0;
  }
}

/** Characters currently flagged for review, in curriculum order. */
export function reviewCharacters(state: CurriculumState): string[] {
  return state.characters
    .filter((c) => c.needsReview)
    .map((c) => c.character);
}

/**
 * Unlocks the next locked character unconditionally. Advancement is gated by a
 * passed checkpoint (see training/checkpoint), not by practice history.
 */
export function forceUnlockNext(
  state: CurriculumState,
  at?: string,
): string | undefined {
  const next = nextLockedCharacter(state);
  if (next === undefined) {
    return undefined;
  }
  state.characters.push(unlockedProgress(next, at));
  return next;
}

export type ReadinessReason =
  | "READY"
  | "NEEDS_PRACTICE"
  | "NEEDS_REVIEW"
  | "COMPLETE";

export type Readiness = {
  ready: boolean;
  reason: ReadinessReason;
  /** The older character that must be reviewed before a checkpoint, if any. */
  weakCharacter?: string;
};

/**
 * Whether the learner is ready to attempt a checkpoint, based on clean practice
 * history. A well-sampled but clearly weak older character vetoes readiness so a
 * forgotten character is not carried indefinitely.
 */
export function checkpointReadiness(
  state: CurriculumState,
  config: ReadinessConfig = DEFAULT_READINESS_CONFIG,
): Readiness {
  if (nextLockedCharacter(state) === undefined) {
    return { ready: false, reason: "COMPLETE" };
  }
  const newest = newestCharacter(state);
  if (!newest) {
    return { ready: false, reason: "NEEDS_PRACTICE" };
  }
  for (const progress of state.characters) {
    if (progress.character === newest.character) {
      continue;
    }
    if (
      progress.rx.recentResults.length >= config.vetoMinObservations &&
      recentAccuracy(progress.rx) < config.vetoAccuracy
    ) {
      return {
        ready: false,
        reason: "NEEDS_REVIEW",
        weakCharacter: progress.character,
      };
    }
  }
  if (
    newest.rx.recentResults.length < config.minNewestObservations ||
    recentAccuracy(newest.rx) < config.minNewestAccuracy
  ) {
    return { ready: false, reason: "NEEDS_PRACTICE" };
  }
  return { ready: true, reason: "READY" };
}
