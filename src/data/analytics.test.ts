import {
  buildAnalyticsSummary,
  buildCharacterSummaries,
  buildConfusionSummaries,
  buildDailyTrend,
} from "./analytics.ts";
import type {
  CharacterProjectionRecord,
  ConfusionProjectionRecord,
  DailyProjectionRecord,
} from "./models.ts";

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

  it("builds direction-aware character summaries with recent accuracy and timestamps", () => {
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
        recent: [
          observation("2026-09-24T09:00:00.000Z", false, 300),
          observation("2026-09-24T12:00:00.000Z", true),
          observation("2026-09-24T13:00:00.000Z", true, 150),
        ],
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
    expect(rx.recentObservationCount).toBe(3);
    expect(rx.recentCorrectCount).toBe(2);
    expect(rx.recentAccuracy).toBe(2 / 3);
    expect(rx.mostRecentObservationUtc).toBe("2026-09-24T13:00:00.000Z");
    expect(rx.rxResponseTime).toEqual({
      samples: 2,
      averageMs: 225,
      minimumMs: 150,
      maximumMs: 300,
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

  it("builds confusion summaries with deterministic repository-aligned ordering", () => {
    const summaries = buildConfusionSummaries([
      confusion("M", "K", 5),
      confusion("A", "B", 5),
      confusion("Z", "Y", 1),
    ]);

    expect(summaries).toEqual([
      { target: "A", answer: "B", count: 5 },
      { target: "M", answer: "K", count: 5 },
      { target: "Z", answer: "Y", count: 1 },
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
    const confusions = [confusion("Z", "Y", 1), confusion("A", "B", 5)];

    const before = structuredClone({ dailyRows, characters, confusions });

    buildAnalyticsSummary(dailyRows);
    buildDailyTrend(dailyRows);
    buildCharacterSummaries(characters);
    buildConfusionSummaries(confusions);

    expect({ dailyRows, characters, confusions }).toEqual(before);
  });
});

function daily(
  overrides: Partial<DailyProjectionRecord> & { localDate: string },
): DailyProjectionRecord {
  return {
    id: `daily:${overrides.localDate}`,
    schemaVersion: 1,
    updatedAt: "2026-09-24T18:00:00.000Z",
    projectionVersion: 1,
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
    projectionVersion: 1,
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
    projectionVersion: 1,
    target,
    answer,
    count,
  };
}
