import { describe, expect, it } from "vitest";
import { parseTrainingDataset } from "./validation.ts";
import { buildBenchmarkFixture } from "./benchmark-100k-fixture.ts";

describe("100k fixture correctness", () => {
  it("builds a valid deterministic mixed RX/TX fixture with required TX timing profiles", () => {
    const fixture = buildBenchmarkFixture({
      sessionCount: 50,
      attemptCount: 10_000,
    });

    expect(fixture.sessions).toHaveLength(50);
    expect(fixture.attempts).toHaveLength(10_000);

    const txAttempts = fixture.attempts.filter(
      (attempt) => attempt.direction === "tx",
    );
    expect(txAttempts.length / fixture.attempts.length).toBeGreaterThanOrEqual(
      0.25,
    );

    expect(fixture.txProfileCounts.short).toBeGreaterThan(0);
    expect(fixture.txProfileCounts.long).toBeGreaterThan(0);
    expect(fixture.txProfileCounts.nearCap).toBeGreaterThan(0);
    expect(fixture.txProfileCounts.truncated).toBeGreaterThan(0);

    const withKeying = txAttempts.filter(
      (attempt) => attempt.keying !== undefined,
    );
    expect(withKeying.length).toBe(txAttempts.length);

    const truncated = withKeying.filter(
      (attempt) => attempt.keying?.timingTruncated,
    );
    expect(truncated.length).toBeGreaterThan(0);

    const nearCap = withKeying.filter(
      (attempt) =>
        attempt.keying?.originalMarkCount === 511 &&
        attempt.keying?.originalSpaceCount === 510,
    );
    expect(nearCap.length).toBeGreaterThan(0);

    expect(() =>
      parseTrainingDataset(fixture.sessions, fixture.attempts),
    ).not.toThrow();
  });
});
