// Deterministic seeded RNG (mulberry32) for reproducible scheduling in tests.

export type Rng = () => number;

/** Creates a seeded PRNG returning floats in [0, 1). */
export function createRng(seed: number): Rng {
  let state = seed >>> 0;
  return function next(): number {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Picks an index in [0, weights.length) proportional to the given weights. */
export function weightedIndex(weights: number[], rng: Rng): number {
  const total = weights.reduce((sum, w) => sum + Math.max(0, w), 0);
  if (total <= 0) {
    return Math.floor(rng() * weights.length);
  }
  let target = rng() * total;
  for (let i = 0; i < weights.length; i++) {
    target -= Math.max(0, weights[i]);
    if (target < 0) {
      return i;
    }
  }
  return weights.length - 1;
}
