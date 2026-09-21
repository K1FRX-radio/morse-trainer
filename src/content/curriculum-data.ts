// Static curriculum data. Swapping this sequence (e.g. to an LICW order) is a
// data-only change; a user-selectable order is deferred.

/**
 * Classic Koch order as popularized by G4FON. The deliberately-contrasting
 * K/M pair leads so learners distinguish sound shapes from the start.
 */
export const KOCH_ORDER: readonly string[] = [
  "K",
  "M",
  "U",
  "R",
  "E",
  "S",
  "N",
  "A",
  "P",
  "T",
  "L",
  "W",
  "I",
  ".",
  "J",
  "Z",
  "=",
  "F",
  "O",
  "Y",
  ",",
  "V",
  "G",
  "5",
  "/",
  "Q",
  "9",
  "2",
  "H",
  "3",
  "8",
  "B",
  "?",
  "4",
  "7",
  "C",
  "1",
  "D",
  "6",
  "0",
  "X",
];

export type CurriculumConfig = {
  /** Ordered character sequence to unlock through. */
  order: readonly string[];
  /** Number of characters unlocked at the start. */
  startCount: number;
  /** Rolling window size (most recent RX attempts) used for accuracy. */
  windowSize: number;
  /** Minimum RX accuracy over the window required to unlock the next char. */
  unlockAccuracy: number;
  /** Minimum RX observations on the newest char before it can unlock the next. */
  minNewCharObservations: number;
  /** Recent RX accuracy below this marks a previously strong char needsReview. */
  reviewDecayAccuracy: number;
};

// Initial defaults. All are tunable and covered by tests (see plan §4.1).
export const DEFAULT_CURRICULUM_CONFIG: CurriculumConfig = {
  order: KOCH_ORDER,
  startCount: 2,
  windowSize: 50,
  unlockAccuracy: 0.9,
  minNewCharObservations: 20,
  reviewDecayAccuracy: 0.7,
};
