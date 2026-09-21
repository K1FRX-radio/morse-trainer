// Pure Learn-mode exercise generator. Composes the curriculum scheduler and the
// word corpus into a typed next exercise. Every target is built only from
// unlocked characters, so locked characters can never appear. Deterministic
// given a seeded RNG.

import { newestCharacter, unlockedCharacters } from "./curriculum.ts";
import type { CurriculumState } from "./curriculum.ts";
import type { Rng } from "./rng.ts";
import { selectExercise } from "./scheduler.ts";
import type { SchedulerWeights } from "./scheduler.ts";
import type { Direction, SchedulerReason } from "./types.ts";
import { selectEligibleWord } from "../content/words.ts";

export type LearnExerciseType =
  | "introduce"
  | "copy-character"
  | "send-character"
  | "copy-group"
  | "copy-word";

export type LearnExercise = {
  type: LearnExerciseType;
  /** The character, random group, or word the learner must copy or send. */
  target: string;
  direction: Direction;
  reason: SchedulerReason;
  /** Whether this exercise features the newest unlocked character. */
  newestCharacter: boolean;
};

export type ExerciseOptions = {
  weights?: SchedulerWeights;
  /** Probability an exercise is a sending (TX) drill. Default 0.25. */
  txShare?: number;
  /** Probability an RX exercise is an eligible word. Default 0.35. */
  wordShare?: number;
  /** Probability an RX exercise is a random group. Default 0.35. */
  groupShare?: number;
  /** Length of a random group. Default 5. */
  groupSize?: number;
  /** Characters already introduced this session; introduction is skipped. */
  introduced?: ReadonlySet<string>;
};

function randomGroup(
  pool: readonly string[],
  size: number,
  mustInclude: string,
  rng: Rng,
): string {
  const chars: string[] = [];
  for (let i = 0; i < size; i++) {
    chars.push(pool[Math.floor(rng() * pool.length)]);
  }
  // Guarantee the featured character is present at least once.
  if (!chars.includes(mustInclude)) {
    chars[Math.floor(rng() * size)] = mustInclude;
  }
  return chars.join("");
}

/**
 * Picks the next Learn exercise. Introduces the newest character once, then
 * mixes RX identification, group copy, word copy, and occasional TX sending,
 * weighted toward the newest and weakest characters via the scheduler.
 */
export function nextExercise(
  state: CurriculumState,
  rng: Rng,
  options: ExerciseOptions = {},
): LearnExercise {
  const txShare = options.txShare ?? 0.25;
  const wordShare = options.wordShare ?? 0.35;
  const groupShare = options.groupShare ?? 0.35;
  const groupSize = options.groupSize ?? 5;
  const introduced = options.introduced ?? new Set<string>();

  const selection = selectExercise(state, rng, options.weights);
  const character = selection.character;
  const newest = newestCharacter(state);
  const isNewest = newest?.character === character;

  // Introduce the newest character the first time it is featured.
  if (
    isNewest &&
    newest !== undefined &&
    !introduced.has(character) &&
    newest.rx.recentResults.length === 0
  ) {
    return {
      type: "introduce",
      target: character,
      direction: "rx",
      reason: "NEW_CHARACTER",
      newestCharacter: true,
    };
  }

  const base = {
    reason: selection.reason,
    newestCharacter: isNewest,
  } as const;

  if (rng() < txShare) {
    return { type: "send-character", target: character, direction: "tx", ...base };
  }

  const pool = unlockedCharacters(state);
  const roll = rng();

  if (roll < wordShare) {
    const word = selectEligibleWord(pool, rng, {
      requireNewest: isNewest,
      ...(newest ? { newest: newest.character } : {}),
    });
    if (word) {
      return { type: "copy-word", target: word.text, direction: "rx", ...base };
    }
  }

  if (roll < wordShare + groupShare && pool.length > 1) {
    const group = randomGroup(pool, groupSize, character, rng);
    return { type: "copy-group", target: group, direction: "rx", ...base };
  }

  return { type: "copy-character", target: character, direction: "rx", ...base };
}
