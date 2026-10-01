import { describe, expect, it } from "vitest";
import { isValidSessionForSource } from "./session-validity-policy.ts";

describe("isValidSessionForSource", () => {
  it("keeps attempt-based validity for existing learn/copy/send sources", () => {
    expect(
      isValidSessionForSource({
        source: "learn",
        activeMs: 45000,
        attemptCount: 0,
      }),
    ).toBe(false);
    expect(
      isValidSessionForSource({
        source: "copy-practice",
        activeMs: 45000,
        attemptCount: 1,
      }),
    ).toBe(true);
  });

  it("uses active-time-only validity for imported-text sessions", () => {
    expect(
      isValidSessionForSource({
        source: "imported-text-rx",
        activeMs: 29999,
        attemptCount: 0,
      }),
    ).toBe(false);
    expect(
      isValidSessionForSource({
        source: "imported-text-rx",
        activeMs: 30000,
        attemptCount: 0,
      }),
    ).toBe(true);
  });
});
