import {
  MIN_VALID_SESSION_ACTIVE_MS,
  isValidTrainingSession,
} from "./session-validity.ts";

describe("isValidTrainingSession", () => {
  it("requires exactly the named active-time and attempt minimums", () => {
    expect(
      isValidTrainingSession({
        activeMs: MIN_VALID_SESSION_ACTIVE_MS - 1,
        attemptCount: 1,
      }),
    ).toBe(false);
    expect(
      isValidTrainingSession({
        activeMs: MIN_VALID_SESSION_ACTIVE_MS,
        attemptCount: 0,
      }),
    ).toBe(false);
    expect(
      isValidTrainingSession({
        activeMs: MIN_VALID_SESSION_ACTIVE_MS,
        attemptCount: 1,
      }),
    ).toBe(true);
  });

  it("supports an explicit active-time threshold for session tests", () => {
    expect(
      isValidTrainingSession({ activeMs: 1000, attemptCount: 1 }, 1000),
    ).toBe(true);
  });
});
