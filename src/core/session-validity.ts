export const MIN_VALID_SESSION_ACTIVE_MS = 30000;
export const MIN_VALID_SESSION_ATTEMPTS = 1;

export type SessionValidityEvidence = {
  activeMs: number;
  attemptCount: number;
};

export function isValidTrainingSession(
  evidence: SessionValidityEvidence,
  minActiveMs: number = MIN_VALID_SESSION_ACTIVE_MS,
): boolean {
  return (
    evidence.activeMs >= minActiveMs &&
    evidence.attemptCount >= MIN_VALID_SESSION_ATTEMPTS
  );
}
