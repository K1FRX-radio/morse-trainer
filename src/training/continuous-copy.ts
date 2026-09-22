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
import {
  wordSelectionWeight,
  type FocusedWordEligibility,
} from "./word-selection.ts";

export type ContinuousCopyConfig = {
  newestWeight: number;
  reviewWeight: number;
  weakWeight: number;
  maxIdenticalRun: number;
  minimumGroupLength: number;
  smallActiveGroupMaxLength: number;
  largeActiveGroupMaxLength: number;
  maxRepeatedGroupLength: number;
  continuousWordRatio: number;
  maxConsecutiveWordTokens: number;
};

export const DEFAULT_CONTINUOUS_COPY_CONFIG: ContinuousCopyConfig = {
  newestWeight: 2,
  reviewWeight: 3,
  weakWeight: 2,
  maxIdenticalRun: 2,
  minimumGroupLength: 2,
  smallActiveGroupMaxLength: 4,
  largeActiveGroupMaxLength: 5,
  maxRepeatedGroupLength: 2,
  continuousWordRatio: 0.35,
  maxConsecutiveWordTokens: 2,
};

export type ContinuousCopyToken = {
  kind: "random-group" | "word";
  text: string;
};

export type ContinuousCopyPlan = {
  tokens: ContinuousCopyToken[];
  audioText: string;
  gradingTarget: string;
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
  wordEligibility?: FocusedWordEligibility;
};

export type ContinuousCharacterResult = {
  character: string;
  correct: boolean;
};

export type ContinuousCopyResult = {
  randomGroupTokens: number;
  wordTokens: number;
  totalTokens: number;
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

function chooseGroupLength(
  activeCount: number,
  previousLengths: readonly number[],
  config: ContinuousCopyConfig,
  rng: Rng,
): number {
  const maximum =
    activeCount >= 5
      ? config.largeActiveGroupMaxLength
      : config.smallActiveGroupMaxLength;
  const lengths = Array.from(
    { length: maximum - config.minimumGroupLength + 1 },
    (_, index) => config.minimumGroupLength + index,
  );
  const repeated = previousLengths.slice(-config.maxRepeatedGroupLength);
  const weights = lengths.map((length) =>
    lengths.length > 1 &&
    repeated.length === config.maxRepeatedGroupLength &&
    repeated.every((value) => value === length)
      ? 0
      : 1,
  );
  return lengths[weightedIndex(weights, rng)];
}

function characterWeight(
  character: string,
  newest: string,
  review: ReadonlySet<string>,
  weak: ReadonlySet<string>,
  config: ContinuousCopyConfig,
): number {
  return (
    1 +
    (character === newest ? config.newestWeight : 0) +
    (review.has(character) ? config.reviewWeight : 0) +
    (weak.has(character) ? config.weakWeight : 0)
  );
}

function buildRandomGroup(
  active: readonly string[],
  length: number,
  coverage: string[],
  previousToken: string | undefined,
  newest: string,
  review: ReadonlySet<string>,
  weak: ReadonlySet<string>,
  config: ContinuousCopyConfig,
  rng: Rng,
): string {
  const characters: string[] = [];
  for (let index = 0; index < length; index++) {
    let character = coverage.shift();
    if (!character) {
      const weights = active.map((candidate) => {
        const run = characters.slice(-config.maxIdenticalRun);
        if (
          active.length > 1 &&
          run.length === config.maxIdenticalRun &&
          run.every((value) => value === candidate)
        ) {
          return 0;
        }
        return characterWeight(candidate, newest, review, weak, config);
      });
      character = active[weightedIndex(weights, rng)];
    }
    characters.push(character);
  }

  let group = characters.join("");
  if (active.length > 1 && group === previousToken) {
    const finalIndex = characters.length - 1;
    const precedingRun = characters.slice(
      Math.max(0, finalIndex - config.maxIdenticalRun + 1),
      finalIndex,
    );
    const replacement = active.find((candidate) => {
      if (candidate === characters[finalIndex]) return false;
      return !(
        precedingRun.length === config.maxIdenticalRun - 1 &&
        precedingRun.every((value) => value === candidate)
      );
    });
    if (replacement) {
      characters[finalIndex] = replacement;
      group = characters.join("");
    }
  }
  return group;
}

function chooseWord(
  eligibility: FocusedWordEligibility,
  previousToken: string | undefined,
  newest: string,
  review: ReadonlySet<string>,
  weak: ReadonlySet<string>,
  rng: Rng,
): string {
  const withoutImmediateRepeat = eligibility.candidates.filter(
    (word) => word.text !== previousToken,
  );
  const candidates =
    withoutImmediateRepeat.length > 0
      ? withoutImmediateRepeat
      : eligibility.candidates;
  const weights = candidates.map((word) =>
    wordSelectionWeight(word.text, newest, review, weak),
  );
  return candidates[weightedIndex(weights, rng)].text;
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
  const sample = active[0];
  const sampleDuration = buildSchedule(sample, options.timing).totalMs;
  const boundaryGapMs =
    buildSchedule(`${sample} ${sample}`, options.timing).totalMs -
    2 * sampleDuration;
  const coverage = shuffled(active, options.rng);
  const tokens: ContinuousCopyToken[] = [];
  const groupLengths: number[] = [];
  let consecutiveWords = 0;
  let scheduledDurationMs = 0;

  while (scheduledDurationMs < options.durationMs) {
    const useWord =
      coverage.length === 0 &&
      options.wordEligibility?.eligible === true &&
      options.wordEligibility.candidates.length > 0 &&
      consecutiveWords < config.maxConsecutiveWordTokens &&
      options.rng() < config.continuousWordRatio;
    let token: ContinuousCopyToken;
    if (useWord && options.wordEligibility) {
      token = {
        kind: "word",
        text: chooseWord(
          options.wordEligibility,
          tokens.at(-1)?.text,
          options.newest,
          review,
          weak,
          options.rng,
        ),
      };
      consecutiveWords += 1;
    } else {
      const length = chooseGroupLength(
        active.length,
        groupLengths,
        config,
        options.rng,
      );
      token = {
        kind: "random-group",
        text: buildRandomGroup(
          active,
          length,
          coverage,
          tokens.at(-1)?.text,
          options.newest,
          review,
          weak,
          config,
          options.rng,
        ),
      };
      groupLengths.push(length);
      consecutiveWords = 0;
    }
    const text = token.text;
    const tokenDurationMs = buildSchedule(text, options.timing).totalMs;
    if (tokens.length > 0) scheduledDurationMs += boundaryGapMs;
    tokens.push(token);
    scheduledDurationMs += tokenDurationMs;
  }

  const audioText = tokens.map((token) => token.text).join(" ");
  const gradingTarget = tokens.map((token) => token.text).join("");
  const schedule = buildSchedule(audioText, options.timing);
  return {
    tokens,
    audioText,
    gradingTarget,
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
  const randomGroupTokens = plan.tokens.filter(
    (token) => token.kind === "random-group",
  ).length;
  const wordTokens = plan.tokens.length - randomGroupTokens;
  if (options.abandoned) {
    return {
      randomGroupTokens,
      wordTokens,
      totalTokens: plan.tokens.length,
      targetCharacters: plan.gradingTarget.length,
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

  const grade = gradeCopyDetailed(plan.gradingTarget, normalizedTyped);
  return {
    randomGroupTokens,
    wordTokens,
    totalTokens: plan.tokens.length,
    targetCharacters: grade.targetCharacters,
    typedCharacters: grade.typedCharacters,
    alignedCorrect: grade.alignedCorrect,
    accuracy:
      grade.targetCharacters === 0
        ? 0
        : grade.alignedCorrect / grade.targetCharacters,
    perCharacterResults: [...plan.gradingTarget].map((character, index) => ({
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
