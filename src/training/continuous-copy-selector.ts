import type { Rng } from "../core/rng.ts";
import { weightedIndex } from "../core/rng.ts";

export type GroupCharacterSelectionOptions = {
  active: readonly string[];
  prefix: readonly string[];
  tokenLength: number;
  previousToken: string | undefined;
  remainingCoverage: ReadonlyMap<string, number>;
  maxIdenticalRun: number;
  weight: (character: string) => number;
  rng: Rng;
};

export function selectGroupCharacter(
  options: GroupCharacterSelectionOptions,
): string {
  const satisfiesRunLimit = (candidate: string) => {
    if (options.active.length <= 1) return true;
    const run = options.prefix.slice(-options.maxIdenticalRun);
    return !(
      run.length === options.maxIdenticalRun &&
      run.every((character) => character === candidate)
    );
  };
  const avoidsRepeatedToken = (candidate: string) =>
    !(
      options.active.length > 1 &&
      options.previousToken?.length === options.tokenLength &&
      options.prefix.length === options.tokenLength - 1 &&
      options.prefix.every(
        (character, index) => character === options.previousToken?.[index],
      ) &&
      candidate === options.previousToken[options.prefix.length]
    );

  const tiers = [
    { requireCoverage: true, requireUniqueToken: true },
    { requireCoverage: true, requireUniqueToken: false },
    { requireCoverage: false, requireUniqueToken: true },
    { requireCoverage: false, requireUniqueToken: false },
  ];

  for (const tier of tiers) {
    const candidates = options.active
      .filter(
        (candidate) =>
          satisfiesRunLimit(candidate) &&
          (!tier.requireUniqueToken || avoidsRepeatedToken(candidate)) &&
          (!tier.requireCoverage ||
            (options.remainingCoverage.get(candidate) ?? 0) > 0),
      )
      .map((candidate) => ({
        character: candidate,
        weight:
          options.weight(candidate) *
          (tier.requireCoverage
            ? (options.remainingCoverage.get(candidate) ?? 0)
            : 1),
      }))
      .filter(({ weight }) => Number.isFinite(weight) && weight > 0);

    if (candidates.length > 0) {
      return candidates[
        weightedIndex(
          candidates.map(({ weight }) => weight),
          options.rng,
        )
      ].character;
    }
  }

  throw new Error("continuous copy character selection invariant failed");
}
