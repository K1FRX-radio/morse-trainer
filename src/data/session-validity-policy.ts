import {
  MIN_VALID_SESSION_ACTIVE_MS,
  isValidTrainingSession,
} from "../core/session-validity.ts";
import type { SessionSource, TrainingSessionRecord } from "./models.ts";

type SessionValidityInput = {
  source: SessionSource;
  activeMs: number;
  attemptCount: number;
  finalizedAttemptCount?: number;
};

export function isValidSessionForSource(input: SessionValidityInput): boolean {
  const attemptCount = input.finalizedAttemptCount ?? input.attemptCount;
  if (input.source === "imported-text-rx") {
    return input.activeMs >= MIN_VALID_SESSION_ACTIVE_MS;
  }
  return isValidTrainingSession({
    activeMs: input.activeMs,
    attemptCount,
  });
}

export function isValidSessionRecord(
  session: Pick<
    TrainingSessionRecord,
    "source" | "activeMs" | "attemptCount" | "finalizedAttemptCount"
  >,
): boolean {
  return isValidSessionForSource({
    source: session.source,
    activeMs: session.activeMs,
    attemptCount: session.attemptCount,
    ...(session.finalizedAttemptCount === undefined
      ? {}
      : { finalizedAttemptCount: session.finalizedAttemptCount }),
  });
}
