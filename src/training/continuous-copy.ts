import {
  nextLockedCharacter,
  recordAttempt,
  type CurriculumState,
} from "../core/curriculum.ts";
import { isSupportedCharacter } from "../core/morse.ts";
import type { Rng } from "../core/rng.ts";
import { weightedIndex } from "../core/rng.ts";
import { gradeCopyDetailed, normalizeCopy } from "../core/scoring.ts";
import {
  buildSchedule,
  type Schedule,
  type TimingOptions,
} from "../core/timing.ts";

export type ContinuousCopyConfig = {
  newestWeight: number;
  reviewWeight: number;
  weakWeight: number;
  maxIdenticalRun: number;
};

export const DEFAULT_CONTINUOUS_COPY_CONFIG: ContinuousCopyConfig = {
  newestWeight: 2,
  reviewWeight: 3,
  weakWeight: 2,
  maxIdenticalRun: 2,
};

export type ContinuousCopyPlan = {
  target: string;
  schedule: Schedule;
  requestedDurationMs: number;
  scheduledDurationMs: number;
};

export type ContinuousCopyOptions = {
  active: readonly string[];
  newest: string;
  review?: Iterable<string>;
  weak?: Iterable<string>;
  durationMs: number;
  timing: TimingOptions;
  rng: Rng;
  config?: ContinuousCopyConfig;
};

export type ContinuousCharacterResult = {
  character: string;
  correct: boolean;
};

export type ContinuousCopyResult = {
  targetCharacters: number;
  typedCharacters: number;
  alignedCorrect: number;
  accuracy: number | null;
  perCharacterResults: ContinuousCharacterResult[];
  insertions: number;
  deletions: number;
  substitutions: number;
  durationCompleted: number;
  abandoned: boolean;
};

function shuffled(items: readonly string[], rng: Rng): string[] {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index--) {
    const swap = Math.floor(rng() * (index + 1));
    [copy[index], copy[swap]] = [copy[swap], copy[index]];
  }
  return copy;
}

function validatedActive(active: readonly string[]): string[] {
  const unique = [
    ...new Set(active.map((character) => character.toUpperCase())),
  ];
  if (unique.length === 0) {
    throw new RangeError("continuous copy requires active characters");
  }
  if (
    unique.some(
      (character) =>
        [...character].length !== 1 || !isSupportedCharacter(character),
    )
  ) {
    throw new RangeError("continuous copy requires supported characters");
  }
  return unique;
}

export function buildContinuousCopyPlan(
  options: ContinuousCopyOptions,
): ContinuousCopyPlan {
  if (!Number.isFinite(options.durationMs) || options.durationMs <= 0) {
    throw new RangeError("continuous-copy duration must be positive");
  }
  const active = validatedActive(options.active);
  const config = options.config ?? DEFAULT_CONTINUOUS_COPY_CONFIG;
  const review = new Set(options.review ?? []);
  const weak = new Set(options.weak ?? []);
  const characterDurations = new Map(
    active.map((character) => [
      character,
      buildSchedule(character, options.timing).totalMs,
    ]),
  );
  const sample = active[0];
  const interCharacterMs =
    buildSchedule(`${sample}${sample}`, options.timing).totalMs -
    2 * (characterDurations.get(sample) ?? 0);
  const coverage = shuffled(active, options.rng);
  const target: string[] = [];
  let scheduledDurationMs = 0;

  while (scheduledDurationMs < options.durationMs) {
    let character: string;
    if (coverage.length > 0) {
      character = coverage.shift() as string;
    } else {
      const weights = active.map((candidate) => {
        const run = target.slice(-config.maxIdenticalRun);
        if (
          active.length > 1 &&
          run.length === config.maxIdenticalRun &&
          run.every((value) => value === candidate)
        ) {
          return 0;
        }
        return (
          1 +
          (candidate === options.newest ? config.newestWeight : 0) +
          (review.has(candidate) ? config.reviewWeight : 0) +
          (weak.has(candidate) ? config.weakWeight : 0)
        );
      });
      character = active[weightedIndex(weights, options.rng)];
    }
    if (target.length > 0) scheduledDurationMs += interCharacterMs;
    target.push(character);
    scheduledDurationMs += characterDurations.get(character) ?? 0;
  }

  const targetText = target.join("");
  const schedule = buildSchedule(targetText, options.timing);
  return {
    target: targetText,
    schedule,
    requestedDurationMs: options.durationMs,
    scheduledDurationMs: schedule.totalMs,
  };
}

export function gradeContinuousCopy(
  plan: ContinuousCopyPlan,
  typed: string,
  options: { durationCompleted: number; abandoned?: boolean },
): ContinuousCopyResult {
  const normalizedTyped = normalizeCopy(typed);
  if (options.abandoned) {
    return {
      targetCharacters: plan.target.length,
      typedCharacters: normalizedTyped.length,
      alignedCorrect: 0,
      accuracy: null,
      perCharacterResults: [],
      insertions: 0,
      deletions: 0,
      substitutions: 0,
      durationCompleted: options.durationCompleted,
      abandoned: true,
    };
  }

  const grade = gradeCopyDetailed(plan.target, normalizedTyped);
  return {
    targetCharacters: grade.targetCharacters,
    typedCharacters: grade.typedCharacters,
    alignedCorrect: grade.alignedCorrect,
    accuracy:
      grade.targetCharacters === 0
        ? 0
        : grade.alignedCorrect / grade.targetCharacters,
    perCharacterResults: [...plan.target].map((character, index) => ({
      character,
      correct: grade.perChar[index] ?? false,
    })),
    insertions: grade.insertions,
    deletions: grade.deletions,
    substitutions: grade.substitutions,
    durationCompleted: options.durationCompleted,
    abandoned: false,
  };
}

/** Applies clean stream observations only. It never unlocks or clears review. */
export function applyContinuousCopyResult(
  state: CurriculumState,
  result: ContinuousCopyResult,
): number {
  if (result.abandoned) return 0;
  const lockedBefore = nextLockedCharacter(state);
  for (const observation of result.perCharacterResults) {
    recordAttempt(state, observation.character, "rx", observation.correct);
  }
  if (nextLockedCharacter(state) !== lockedBefore) {
    throw new Error("continuous-copy practice changed curriculum progression");
  }
  return result.perCharacterResults.length;
}
