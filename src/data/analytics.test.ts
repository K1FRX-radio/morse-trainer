import {
  buildAnalyticsSummary,
  buildCharacterSummaries,
  buildConfusionSummaries,
  buildDailyTrend,
  buildMilestoneSummaries,
  buildPracticeStreakSummary,
  buildSessionWindowSummary,
  isPracticeDay,
  RECURRING_CONFUSION_MINIMUM,
} from "./analytics.ts";
import type {
  CharacterProjectionRecord,
  ConfusionProjectionRecord,
  DailyProjectionRecord,
  MilestoneRecord,
} from "./models.ts";
import { PROJECTION_VERSION } from "./models.ts";

describe("analytics presentation models", () => {
  it("builds totals over multiple daily rows with weighted effective WPM", () => {
    const summary = buildAnalyticsSummary([
      daily({
        localDate: "2026-09-24",
        activeMs: 60000,
        sessionCount: 1,
        attemptCount: 5,
        rxCorrect: 6,
        rxTotal: 8,
        txCorrect: 1,
        txTotal: 2,
        effectiveWpmTotal: 24,
        effectiveWpmSamples: 2,
      }),
      daily({
        localDate: "2026-09-25",
        activeMs: 30000,
        sessionCount: 2,
        attemptCount: 7,
        rxCorrect: 3,
        rxTotal: 6,
        txCorrect: 4,
        txTotal: 5,
        effectiveWpmTotal: 36,
        effectiveWpmSamples: 3,
      }),
    ]);

    expect(summary).toMatchObject({
      totalActiveMs: 90000,
      totalSessions: 3,
      totalAttempts: 12,
      activeDayCount: 2,
      averageEffectiveWpm: 12,
    });
    expect(summary.rx).toEqual({ correct: 9, total: 14, accuracy: 9 / 14 });
    expect(summary.tx).toEqual({ correct: 5, total: 7, accuracy: 5 / 7 });
  });

  it("handles empty input and zero-denominator accuracies explicitly", () => {
    const summary = buildAnalyticsSummary([]);

    expect(summary).toEqual({
      totalActiveMs: 0,
      totalSessions: 0,
      totalAttempts: 0,
      rx: { correct: 0, total: 0, accuracy: null },
      tx: { correct: 0, total: 0, accuracy: null },
      averageEffectiveWpm: null,
      activeDayCount: 0,
    });
  });

  it("builds deterministic daily trend rows in ascending date order", () => {
    const trend = buildDailyTrend([
      daily({ localDate: "2026-09-26", rxTotal: 0, txTotal: 0 }),
      daily({ localDate: "2026-09-24", rxCorrect: 3, rxTotal: 4 }),
      daily({ localDate: "2026-09-25", txCorrect: 1, txTotal: 2 }),
    ]);

    expect(trend.map((row) => row.localDate)).toEqual([
      "2026-09-24",
      "2026-09-25",
      "2026-09-26",
    ]);
    expect(trend[2].rx.accuracy).toBeNull();
    expect(trend[2].tx.accuracy).toBeNull();
  });

  it("builds direction-aware character summaries with median latest-20 RX latency", () => {
    const summaries = buildCharacterSummaries([
      character({
        character: "M",
        direction: "tx",
        recent: [
          observation("2026-09-24T10:00:00.000Z", true),
          observation("2026-09-24T11:00:00.000Z", false),
        ],
      }),
      character({
        character: "K",
        direction: "rx",
        recent: Array.from({ length: 22 }, (_, index) =>
          observation(
            `2026-09-24T${String(index).padStart(2, "0")}:00:00.000Z`,
            index % 3 !== 0,
            index + 100,
          ),
        ),
      }),
    ]);

    expect(summaries.map((row) => `${row.character}:${row.direction}`)).toEqual(
      ["M:tx", "K:rx"],
    );

    const tx = summaries[0];
    expect(tx.recentObservationCount).toBe(2);
    expect(tx.recentCorrectCount).toBe(1);
    expect(tx.recentAccuracy).toBe(0.5);
    expect(tx.mostRecentObservationUtc).toBe("2026-09-24T11:00:00.000Z");
    expect(tx.rxResponseTime).toBeUndefined();

    const rx = summaries[1];
    expect(rx.recentObservationCount).toBe(22);
    expect(rx.recentCorrectCount).toBe(14);
    expect(rx.recentAccuracy).toBe(14 / 22);
    expect(rx.mostRecentObservationUtc).toBe("2026-09-24T21:00:00.000Z");
    expect(rx.rxResponseTime).toEqual({
      samples: 20,
      medianMs: 111.5,
    });
  });

  it("handles character rows with no recent observations", () => {
    const summaries = buildCharacterSummaries([
      character({ character: "Q", direction: "rx", recent: [] }),
    ]);

    expect(summaries[0]).toMatchObject({
      recentObservationCount: 0,
      recentCorrectCount: 0,
      recentAccuracy: null,
    });
    expect("mostRecentObservationUtc" in summaries[0]).toBe(false);
    expect("rxResponseTime" in summaries[0]).toBe(false);
  });

  it("builds recurring confusion summaries with deterministic ordering", () => {
    const summaries = buildConfusionSummaries([
      confusion("M", "K", 5),
      confusion("A", "B", 5),
      confusion("Z", "Y", RECURRING_CONFUSION_MINIMUM - 1),
    ]);

    expect(summaries).toEqual([
      { target: "A", answer: "B", count: 5 },
      { target: "M", answer: "K", count: 5 },
    ]);
  });

  it("builds latest milestone summaries in reverse chronological order", () => {
    const summaries = buildMilestoneSummaries([
      milestone("m-1", "character-unlocked", "2026-09-24T10:00:00.000Z", "M"),
      milestone("m-2", "character-mastered", "2026-09-24T11:00:00.000Z", "K"),
      milestone("m-3", "curriculum-completed", "2026-09-24T11:00:00.000Z"),
    ]);

    expect(summaries).toEqual([
      {
        id: "m-3",
        type: "curriculum-completed",
        occurredAtUtc: "2026-09-24T11:00:00.000Z",
      },
      {
        id: "m-2",
        type: "character-mastered",
        occurredAtUtc: "2026-09-24T11:00:00.000Z",
        character: "K",
      },
      {
        id: "m-1",
        type: "character-unlocked",
        occurredAtUtc: "2026-09-24T10:00:00.000Z",
        character: "M",
      },
    ]);
  });

  it("does not mutate caller input", () => {
    const dailyRows = [
      daily({ localDate: "2026-09-25", activeMs: 5 }),
      daily({ localDate: "2026-09-24", activeMs: 10 }),
    ];
    const characters: CharacterProjectionRecord[] = [
      character({
        character: "M",
        direction: "rx",
        recent: [observation("2026-09-24T10:00:00.000Z", true, 150)],
      }),
      character({
        character: "K",
        direction: "rx",
        recent: [observation("2026-09-24T09:00:00.000Z", false, 200)],
      }),
    ];
    const confusions = [
      confusion("Z", "Y", 1),
      confusion("A", "B", RECURRING_CONFUSION_MINIMUM),
    ];

    const before = structuredClone({ dailyRows, characters, confusions });

    buildAnalyticsSummary(dailyRows);
    buildDailyTrend(dailyRows);
    buildCharacterSummaries(characters);
    buildConfusionSummaries(confusions);

    expect({ dailyRows, characters, confusions }).toEqual(before);
  });

  it("builds today/week/all-time session and duration windows", () => {
    const rows = [
      daily({ localDate: "2026-09-29", activeMs: 45000, sessionCount: 1 }),
      daily({ localDate: "2026-09-30", activeMs: 30000, sessionCount: 1 }),
      daily({ localDate: "2026-10-01", activeMs: 60000, sessionCount: 2 }),
      daily({ localDate: "2026-10-03", activeMs: 30000, sessionCount: 1 }),
      daily({ localDate: "2026-10-04", activeMs: 0, sessionCount: 0 }),
      daily({ localDate: "2026-10-05", activeMs: 90000, sessionCount: 3 }),
    ];

    const windows = buildSessionWindowSummary(rows, "2026-10-04");

    expect(windows.today).toEqual({
      activeMs: 0,
      sessionCount: 0,
      averageSessionDurationMs: null,
    });
    expect(windows.thisWeek).toEqual({
      activeMs: 165000,
      sessionCount: 5,
      averageSessionDurationMs: 33000,
    });
    expect(windows.allTime).toEqual({
      activeMs: 255000,
      sessionCount: 8,
      averageSessionDurationMs: 31875,
    });
  });

  it("builds current and longest practice streaks with yesterday carry", () => {
    const rows = [
      daily({ localDate: "2026-09-29", activeMs: 45000, attemptCount: 2 }),
      daily({ localDate: "2026-09-30", activeMs: 30000, attemptCount: 1 }),
      daily({ localDate: "2026-10-01", activeMs: 60000, attemptCount: 3 }),
      daily({ localDate: "2026-10-03", activeMs: 30000, attemptCount: 1 }),
      daily({ localDate: "2026-10-04", activeMs: 0, attemptCount: 0 }),
      daily({ localDate: "2026-10-05", activeMs: 90000, attemptCount: 4 }),
      daily({ localDate: "2026-10-06", activeMs: 15000, attemptCount: 2 }),
    ];

    const streak = buildPracticeStreakSummary(rows, "2026-10-04");

    expect(streak).toEqual({
      practiceDayCount: 5,
      currentStreakDays: 1,
      longestStreakDays: 3,
    });
    expect(isPracticeDay(rows[6])).toBe(false);
  });
});

function daily(
  overrides: Partial<DailyProjectionRecord> & { localDate: string },
): DailyProjectionRecord {
  return {
    id: `daily:${overrides.localDate}`,
    schemaVersion: 1,
    updatedAt: "2026-09-24T18:00:00.000Z",
    projectionVersion: PROJECTION_VERSION,
    localDate: overrides.localDate,
    activeMs: overrides.activeMs ?? 0,
    sessionCount: overrides.sessionCount ?? 0,
    attemptCount: overrides.attemptCount ?? 0,
    rxCorrect: overrides.rxCorrect ?? 0,
    rxTotal: overrides.rxTotal ?? 0,
    txCorrect: overrides.txCorrect ?? 0,
    txTotal: overrides.txTotal ?? 0,
    effectiveWpmTotal: overrides.effectiveWpmTotal ?? 0,
    effectiveWpmSamples: overrides.effectiveWpmSamples ?? 0,
  };
}

function character(
  overrides: Pick<
    CharacterProjectionRecord,
    "character" | "direction" | "recent"
  >,
): CharacterProjectionRecord {
  return {
    id: `character:${overrides.direction}:${overrides.character}`,
    schemaVersion: 1,
    updatedAt: "2026-09-24T18:00:00.000Z",
    projectionVersion: PROJECTION_VERSION,
    character: overrides.character,
    direction: overrides.direction,
    recent: overrides.recent,
  };
}

function observation(
  utc: string,
  correct: boolean,
  responseMs?: number,
): CharacterProjectionRecord["recent"][number] {
  return {
    attemptId: `attempt:${utc}`,
    occurredAt: {
      utc,
      localDate: "2026-09-24",
      utcOffsetMinutes: 0,
      timeZone: "UTC",
    },
    correct,
    kind: correct ? "match" : "substitution",
    answer: correct ? "K" : "M",
    ...(responseMs === undefined ? {} : { responseMs }),
  };
}

function confusion(
  target: string,
  answer: string,
  count: number,
): ConfusionProjectionRecord {
  return {
    id: `confusion:${target}:${answer}`,
    schemaVersion: 1,
    updatedAt: "2026-09-24T18:00:00.000Z",
    projectionVersion: PROJECTION_VERSION,
    target,
    answer,
    count,
  };
}

function milestone(
  id: string,
  type: MilestoneRecord["type"],
  utc: string,
  character?: string,
): MilestoneRecord {
  return {
    id,
    schemaVersion: 1,
    updatedAt: utc,
    idempotencyKey: `key:${id}`,
    eventId: `event:${id}`,
    type,
    occurredAt: {
      utc,
      localDate: "2026-09-24",
      utcOffsetMinutes: 0,
      timeZone: "UTC",
    },
    migrationDerived: false,
    ...(character === undefined ? {} : { character }),
  };
}
