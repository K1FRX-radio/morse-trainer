// Shared domain types for the pure core layer.

export type CharacterState = "locked" | "learning" | "mastered";

export type SkillProgress = {
  /** Total attempts ever recorded for this skill. */
  totalAttempts: number;
  /** Most recent results, oldest first, capped to the curriculum window. */
  recentResults: boolean[];
};

export type CharacterProgress = {
  character: string;
  state: CharacterState;
  needsReview: boolean;
  /** Consecutive clean (unassisted, unreplayed) correct isolated responses,
   * counted toward clearing needsReview. */
  reviewStreak?: number;
  rx: SkillProgress;
  tx: SkillProgress;
  unlockedAt?: string;
  masteredAt?: string;
  lastPracticedAt?: string;
};

export type Direction = "rx" | "tx";

/** Explains why the scheduler chose a given exercise. */
export type SchedulerReason =
  | "NEW_CHARACTER"
  | "WEAK_RX"
  | "WEAK_TX"
  | "CONFUSION_REVIEW"
  | "SPACED_REVIEW"
  | "BALANCED_PRACTICE";

export type ExerciseSelection = {
  character: string;
  reason: SchedulerReason;
};
