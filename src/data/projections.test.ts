import type { TrainingSessionRecord } from "./models.ts";
import { buildProjectionRows } from "./projections.ts";

function session(
  overrides: Partial<TrainingSessionRecord>,
): TrainingSessionRecord {
  return {
    id: "session-1",
    schemaVersion: 1,
    updatedAt: "2026-09-24T17:05:00.000Z",
    source: "learn",
    mode: "learn",
    status: "completed",
    startedAt: {
      utc: "2026-09-24T17:00:00.000Z",
      localDate: "2026-09-24",
      utcOffsetMinutes: -240,
      timeZone: "America/New_York",
    },
    endedAt: {
      utc: "2026-09-24T17:05:00.000Z",
      localDate: "2026-09-24",
      utcOffsetMinutes: -240,
      timeZone: "America/New_York",
    },
    activeMs: 45000,
    activeDateBuckets: [
      {
        localDate: "2026-09-24",
        utcOffsetMinutes: -240,
        timeZone: "America/New_York",
        activeMs: 45000,
      },
    ],
    attemptCount: 1,
    completedCards: 1,
    valid: true,
    charWpm: 20,
    effectiveWpm: 12,
    toneHz: 600,
    noiseLevel: 0,
    unlockedAtStart: ["K", "M"],
    unlockedAtEnd: ["K", "M"],
    appVersion: "0.0.0",
    revision: 1,
    ...overrides,
  };
}

describe("buildProjectionRows session eligibility", () => {
  it("does not trust a true valid flag for ineligible data", () => {
    const rows = buildProjectionRows(
      [
        session({
          activeMs: 0,
          activeDateBuckets: [],
          attemptCount: 0,
          valid: true,
        }),
      ],
      [],
      "2026-09-24T18:00:00.000Z",
    );

    expect(rows.daily).toEqual([]);
  });

  it("derives eligibility for qualifying data marked false", () => {
    const rows = buildProjectionRows(
      [session({ valid: false })],
      [],
      "2026-09-24T18:00:00.000Z",
    );

    expect(rows.daily).toMatchObject([
      { localDate: "2026-09-24", sessionCount: 1, activeMs: 45000 },
    ]);
  });
});
