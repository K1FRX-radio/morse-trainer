import { IDBKeyRange, indexedDB } from "fake-indexeddb";
import {
  buildAnalyticsSummary,
  buildCharacterSummaries,
  buildConfusionSummaries,
  buildDailyTrend,
} from "./analytics.ts";
import { TrainerDatabase } from "./indexeddb.ts";
import type { TrainingAttemptRecord, TrainingSessionRecord } from "./models.ts";
import { buildProjectionRows } from "./projections.ts";
import { DexieTrainingRepository } from "./repository.ts";

type DateContext = {
  utc: string;
  localDate: string;
  utcOffsetMinutes: number;
  timeZone: string;
};

function session(
  id: string,
  date: DateContext,
  activeDateBuckets: TrainingSessionRecord["activeDateBuckets"],
  attemptCount: number,
  effectiveWpm: number,
): TrainingSessionRecord {
  return {
    id,
    schemaVersion: 1,
    updatedAt: date.utc,
    source: "copy-practice",
    mode: "copy",
    status: "completed",
    startedAt: date,
    endedAt: date,
    activeMs: activeDateBuckets.reduce(
      (sum, bucket) => sum + bucket.activeMs,
      0,
    ),
    activeDateBuckets,
    attemptCount,
    finalizedAttemptCount: attemptCount,
    completedCards: attemptCount,
    valid: true,
    charWpm: 20,
    effectiveWpm,
    toneHz: 600,
    noiseLevel: 0,
    unlockedAtStart: ["K", "M"],
    unlockedAtEnd: ["K", "M"],
    appVersion: "0.0.0",
    revision: 1,
  };
}

function attempt(
  id: string,
  sessionId: string,
  direction: "rx" | "tx",
  occurredAt: DateContext,
  options: {
    target: string;
    answer: string;
    assisted?: boolean;
    replayed?: boolean;
    abandoned?: boolean;
    responseMs?: number;
  },
): TrainingAttemptRecord {
  const correct = options.target === options.answer;
  const kind = correct ? "match" : "substitution";
  return {
    id,
    schemaVersion: 1,
    updatedAt: occurredAt.utc,
    sessionId,
    occurredAt,
    source: "copy-practice",
    direction,
    exerciseType: direction === "rx" ? "copy-character" : "send-character",
    rawTarget: options.target,
    rawResponse: options.answer,
    normalizedTarget: options.target,
    normalizedResponse: options.answer,
    correct,
    assisted: options.assisted ?? false,
    replayed: options.replayed ?? false,
    abandoned: options.abandoned ?? false,
    scoringAlgorithmVersion: "alignment-v1",
    observations: [
      {
        kind,
        correct,
        targetIndex: 0,
        target: options.target,
        answerIndex: 0,
        answer: options.answer,
      },
    ],
    ...(direction === "rx" && options.responseMs !== undefined
      ? { responseMs: options.responseMs }
      : {}),
    charWpm: 20,
    effectiveWpm: 12,
    toneHz: 600,
    noiseLevel: 0,
  };
}

describe("hand-calculated analytics fixtures", () => {
  it("matches exact daily/overall/character/confusion metrics and exclusions", () => {
    const day1: DateContext = {
      utc: "2026-10-01T23:58:00.000Z",
      localDate: "2026-10-01",
      utcOffsetMinutes: 0,
      timeZone: "UTC",
    };
    const day2: DateContext = {
      utc: "2026-10-02T00:02:00.000Z",
      localDate: "2026-10-02",
      utcOffsetMinutes: 0,
      timeZone: "UTC",
    };

    const sessions = [
      session(
        "session-1",
        day1,
        [
          {
            localDate: "2026-10-01",
            utcOffsetMinutes: 0,
            timeZone: "UTC",
            activeMs: 45000,
          },
          {
            localDate: "2026-10-02",
            utcOffsetMinutes: 0,
            timeZone: "UTC",
            activeMs: 15000,
          },
        ],
        4,
        12,
      ),
      session(
        "session-2",
        day2,
        [
          {
            localDate: "2026-10-02",
            utcOffsetMinutes: 0,
            timeZone: "UTC",
            activeMs: 60000,
          },
        ],
        4,
        18,
      ),
    ];

    const attempts = [
      attempt("a1", "session-1", "rx", day1, {
        target: "K",
        answer: "K",
        responseMs: 200,
      }),
      attempt("a2", "session-1", "rx", day1, {
        target: "M",
        answer: "K",
        responseMs: 300,
      }),
      attempt("a3", "session-1", "tx", day1, {
        target: "K",
        answer: "K",
      }),
      attempt("a4", "session-1", "tx", day1, {
        target: "M",
        answer: "K",
      }),
      attempt("a5", "session-2", "rx", day2, {
        target: "K",
        answer: "K",
        responseMs: 250,
      }),
      attempt("a6", "session-2", "rx", day2, {
        target: "M",
        answer: "M",
        assisted: true,
        responseMs: 220,
      }),
      attempt("a7", "session-2", "tx", day2, {
        target: "K",
        answer: "K",
      }),
      attempt("a8", "session-2", "tx", day2, {
        target: "M",
        answer: "M",
        replayed: true,
      }),
    ];

    const generatedAt = "2026-10-02T00:10:00.000Z";
    const projections = buildProjectionRows(sessions, attempts, generatedAt);

    expect(projections.daily).toMatchObject([
      {
        localDate: "2026-10-01",
        activeMs: 45000,
        sessionCount: 1,
        attemptCount: 4,
        rxCorrect: 1,
        rxTotal: 2,
        txCorrect: 1,
        txTotal: 2,
        effectiveWpmTotal: 12,
        effectiveWpmSamples: 1,
      },
      {
        localDate: "2026-10-02",
        activeMs: 75000,
        sessionCount: 1,
        attemptCount: 4,
        rxCorrect: 1,
        rxTotal: 1,
        txCorrect: 1,
        txTotal: 1,
        effectiveWpmTotal: 18,
        effectiveWpmSamples: 1,
      },
    ]);

    const summary = buildAnalyticsSummary(projections.daily);
    expect(summary).toMatchObject({
      totalActiveMs: 120000,
      totalSessions: 2,
      totalAttempts: 8,
      activeDayCount: 2,
      averageEffectiveWpm: 15,
    });
    expect(summary.rx).toEqual({ correct: 2, total: 3, accuracy: 2 / 3 });
    expect(summary.tx).toEqual({ correct: 2, total: 3, accuracy: 2 / 3 });

    const trend = buildDailyTrend(projections.daily);
    expect(trend.map((row) => row.localDate)).toEqual([
      "2026-10-01",
      "2026-10-02",
    ]);

    const characterSummaries = buildCharacterSummaries(projections.characters);
    const kRx = characterSummaries.find(
      (row) => row.character === "K" && row.direction === "rx",
    );
    const mRx = characterSummaries.find(
      (row) => row.character === "M" && row.direction === "rx",
    );

    expect(kRx).toMatchObject({
      recentObservationCount: 2,
      recentCorrectCount: 2,
      recentAccuracy: 1,
      rxResponseTime: {
        samples: 2,
        averageMs: 225,
        minimumMs: 200,
        maximumMs: 250,
      },
    });
    expect(mRx).toMatchObject({
      recentObservationCount: 1,
      recentCorrectCount: 0,
      recentAccuracy: 0,
      rxResponseTime: {
        samples: 1,
        averageMs: 300,
        minimumMs: 300,
        maximumMs: 300,
      },
    });

    const confusions = buildConfusionSummaries(projections.confusions);
    expect(confusions).toEqual([{ target: "M", answer: "K", count: 1 }]);
  });

  it("rebuilds repository projections equivalently from authoritative records", async () => {
    const database = new TrainerDatabase({
      name: crypto.randomUUID(),
      indexedDB,
      IDBKeyRange,
    });
    const repository = new DexieTrainingRepository(database, {
      now: () => new Date("2026-10-02T00:10:00.000Z"),
    });

    const when: DateContext = {
      utc: "2026-10-02T00:00:00.000Z",
      localDate: "2026-10-02",
      utcOffsetMinutes: 0,
      timeZone: "UTC",
    };
    const sessions = [
      session(
        "fixture-session",
        when,
        [
          {
            localDate: "2026-10-02",
            utcOffsetMinutes: 0,
            timeZone: "UTC",
            activeMs: 60000,
          },
        ],
        2,
        18,
      ),
    ];
    const attempts = [
      attempt("fixture-attempt-1", "fixture-session", "rx", when, {
        target: "K",
        answer: "K",
        responseMs: 210,
      }),
      attempt("fixture-attempt-2", "fixture-session", "rx", when, {
        target: "M",
        answer: "K",
        responseMs: 260,
      }),
    ];

    try {
      await repository.open();
      await database.sessions.bulkPut(sessions);
      await database.attempts.bulkPut(attempts);

      const expected = buildProjectionRows(
        sessions,
        attempts,
        "2026-10-02T00:10:00.000Z",
      );

      await repository.rebuildProjections();

      const actualDaily = await repository.listDailyProjections({
        fromLocalDate: "2026-10-02",
        toLocalDate: "2026-10-02",
        limit: 10,
      });
      const actualCharacters = await repository.listCharacterProjections({
        direction: "rx",
        limit: 20,
      });
      const actualConfusions = await repository.listConfusionProjections({
        limit: 20,
      });

      expect(actualDaily).toMatchObject(expected.daily);
      expect(actualCharacters).toMatchObject(expected.characters);
      expect(actualConfusions).toMatchObject(expected.confusions);
    } finally {
      repository.close();
      await database.delete();
    }
  });

  it("excludes non-qualifying sessions from activity-day metrics", () => {
    const when: DateContext = {
      utc: "2026-10-03T00:00:00.000Z",
      localDate: "2026-10-03",
      utcOffsetMinutes: 0,
      timeZone: "UTC",
    };

    const ineligible: TrainingSessionRecord = {
      ...session(
        "ineligible-session",
        when,
        [
          {
            localDate: "2026-10-03",
            utcOffsetMinutes: 0,
            timeZone: "UTC",
            activeMs: 10_000,
          },
        ],
        0,
        12,
      ),
      valid: false,
      finalizedAttemptCount: 0,
    };

    const rows = buildProjectionRows(
      [ineligible],
      [],
      "2026-10-03T00:10:00.000Z",
    );
    const summary = buildAnalyticsSummary(rows.daily);

    expect(rows.daily).toEqual([]);
    expect(summary.totalSessions).toBe(0);
    expect(summary.activeDayCount).toBe(0);
  });
});
