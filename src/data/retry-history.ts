import type { SpeedSuggestionAfterAttempts } from "../core/settings.ts";
import type { TrainingAttemptRecord, TrainingSessionRecord } from "./models.ts";

export type RetryCounterIdentity = {
  activeCharacters: readonly string[];
  charWpm: number;
  effectiveWpm: number;
};

export type RetryClassification = {
  consecutiveAccuracyMisses: number;
  shouldSuggestSpacing: boolean;
};

function sameCharacters(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every((character, index) => character === right[index])
  );
}

function instant(value: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new RangeError("retry history requires valid timestamps");
  }
  return parsed;
}

function compareAttemptsDescending(
  left: TrainingAttemptRecord,
  right: TrainingAttemptRecord,
): number {
  return (
    instant(right.occurredAt.utc) - instant(left.occurredAt.utc) ||
    right.id.localeCompare(left.id)
  );
}

function matchesIdentity(
  session: TrainingSessionRecord,
  attempt: TrainingAttemptRecord,
  identity: RetryCounterIdentity,
): boolean {
  return (
    sameCharacters(session.unlockedAtStart, identity.activeCharacters) &&
    session.charWpm === identity.charWpm &&
    session.effectiveWpm === identity.effectiveWpm &&
    attempt.charWpm === identity.charWpm &&
    attempt.effectiveWpm === identity.effectiveWpm
  );
}

/** Derives spacing-suggestion state from authoritative session and attempt history. */
export function classifyRetryHistory(
  sessions: readonly TrainingSessionRecord[],
  attempts: readonly TrainingAttemptRecord[],
  identity: RetryCounterIdentity,
  threshold: SpeedSuggestionAfterAttempts,
): RetryClassification {
  const learnSessions = sessions.filter(
    (session) => session.source === "learn",
  );
  const sessionsById = new Map(
    learnSessions.map((session) => [session.id, session]),
  );
  const latestFullLesson = learnSessions
    .filter(
      (session) =>
        session.mode === "learn" &&
        sameCharacters(session.unlockedAtStart, identity.activeCharacters),
    )
    .sort(
      (left, right) =>
        instant(right.startedAt.utc) - instant(left.startedAt.utc) ||
        right.id.localeCompare(left.id),
    )[0];
  const boundary = latestFullLesson
    ? instant(latestFullLesson.startedAt.utc)
    : Number.NEGATIVE_INFINITY;

  let consecutiveAccuracyMisses = 0;
  const continuousAttempts = attempts
    .filter(
      (attempt) =>
        attempt.source === "learn" &&
        attempt.exerciseType === "continuous-copy" &&
        instant(attempt.occurredAt.utc) >= boundary,
    )
    .sort(compareAttemptsDescending);

  for (const attempt of continuousAttempts) {
    const session = sessionsById.get(attempt.sessionId);
    if (!session) continue;
    if (!matchesIdentity(session, attempt, identity)) break;
    if (attempt.assisted || attempt.replayed || attempt.abandoned) continue;

    if (
      attempt.readinessReason === "READY" ||
      attempt.readinessReason === "COMPLETE"
    ) {
      break;
    }
    if (
      attempt.readinessReason === "LOW_OVERALL_ACCURACY" ||
      attempt.readinessReason === "LOW_NEWEST_ACCURACY"
    ) {
      consecutiveAccuracyMisses += 1;
    }
  }

  return {
    consecutiveAccuracyMisses,
    shouldSuggestSpacing:
      threshold !== "off" && consecutiveAccuracyMisses >= threshold,
  };
}
