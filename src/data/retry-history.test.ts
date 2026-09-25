import { describe, expect, it } from "vitest";
import { IDBKeyRange, indexedDB } from "fake-indexeddb";
import type {
  ContinuousCopyReadinessReason,
  TrainingAttemptRecord,
  TrainingSessionRecord,
} from "./models.ts";
import { TrainerDatabase } from "./indexeddb.ts";
import { DexieTrainingRepository } from "./repository.ts";
import {
  classifyRetryHistory,
  type RetryCounterIdentity,
} from "./retry-history.ts";
import { parseTrainingAttempt } from "./validation.ts";

const identity: RetryCounterIdentity = {
  activeCharacters: ["K", "M"],
  charWpm: 20,
  effectiveWpm: 12,
};

function captured(utc: string) {
  return {
    utc,
    localDate: "2026-09-24",
    utcOffsetMinutes: 0,
  };
}

function session(
  id: string,
  startedAt: string,
  overrides: Partial<TrainingSessionRecord> = {},
): TrainingSessionRecord {
  const record: TrainingSessionRecord = {
    id,
    schemaVersion: 1,
    updatedAt: startedAt,
    source: "learn",
    mode: "review",
    status: "completed",
    startedAt: captured(startedAt),
    endedAt: captured(startedAt),
    activeMs: 60000,
    activeDateBuckets: [
      {
        localDate: "2026-09-24",
        utcOffsetMinutes: 0,
        activeMs: 60000,
      },
    ],
    attemptCount: 1,
    completedCards: 0,
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
  if (record.status === "active") delete record.endedAt;
  return record;
}

function attempt(
  id: string,
  sessionId: string,
  occurredAt: string,
  readinessReason: ContinuousCopyReadinessReason,
  overrides: Partial<TrainingAttemptRecord> = {},
): TrainingAttemptRecord {
  return {
    id,
    schemaVersion: 1,
    updatedAt: occurredAt,
    sessionId,
    occurredAt: captured(occurredAt),
    source: "learn",
    direction: "rx",
    exerciseType: "continuous-copy",
    rawTarget: "KM",
    rawResponse: "KK",
    normalizedTarget: "KM",
    normalizedResponse: "KK",
    correct: false,
    assisted: false,
    replayed: false,
    abandoned: false,
    scoringAlgorithmVersion: "alignment-v1",
    observations: [
      {
        kind: "match",
        correct: true,
        targetIndex: 0,
        target: "K",
        answerIndex: 0,
        answer: "K",
      },
      {
        kind: "substitution",
        correct: false,
        targetIndex: 1,
        target: "M",
        answerIndex: 1,
        answer: "K",
      },
    ],
    charWpm: 20,
    effectiveWpm: 12,
    toneHz: 600,
    noiseLevel: 0,
    readinessReason,
    ...overrides,
  };
}

describe("classifyRetryHistory", () => {
  it("accepts readiness only on Learn continuous-copy attempts", () => {
    const continuous = attempt(
      "continuous",
      "session",
      "2026-09-24T17:01:00.000Z",
      "LOW_OVERALL_ACCURACY",
    );
    expect(parseTrainingAttempt(continuous)).toEqual(continuous);
    expect(() =>
      parseTrainingAttempt({
        ...continuous,
        exerciseType: "copy-group",
      }),
    ).toThrow(/readiness outcomes require a Learn continuous-copy attempt/);
    expect(() =>
      parseTrainingAttempt({
        ...continuous,
        readinessReason: "ABANDONED",
      }),
    ).toThrow(/ABANDONED readiness must match/);
  });

  it("suggests spacing at exactly the configured miss threshold", () => {
    const sessions = [
      session("full", "2026-09-24T17:00:00.000Z", { mode: "learn" }),
      session("review-1", "2026-09-24T17:02:00.000Z"),
      session("review-2", "2026-09-24T17:04:00.000Z"),
    ];
    const attempts = [
      attempt(
        "attempt-1",
        "full",
        "2026-09-24T17:01:00.000Z",
        "LOW_OVERALL_ACCURACY",
      ),
      attempt(
        "attempt-2",
        "review-1",
        "2026-09-24T17:03:00.000Z",
        "LOW_NEWEST_ACCURACY",
      ),
      attempt(
        "attempt-3",
        "review-2",
        "2026-09-24T17:05:00.000Z",
        "LOW_OVERALL_ACCURACY",
      ),
    ];

    expect(classifyRetryHistory(sessions, attempts, identity, 3)).toEqual({
      consecutiveAccuracyMisses: 3,
      shouldSuggestSpacing: true,
    });
    expect(
      classifyRetryHistory(sessions, attempts.slice(0, 2), identity, 3),
    ).toEqual({
      consecutiveAccuracyMisses: 2,
      shouldSuggestSpacing: false,
    });
    expect(classifyRetryHistory(sessions, attempts, identity, "off")).toEqual({
      consecutiveAccuracyMisses: 3,
      shouldSuggestSpacing: false,
    });
  });

  it("ignores attempts that cannot establish continuous-copy difficulty", () => {
    const sessions = [
      session("full", "2026-09-24T17:00:00.000Z", { mode: "learn" }),
      session("review-1", "2026-09-24T17:02:00.000Z"),
      session("review-2", "2026-09-24T17:04:00.000Z"),
      session("review-3", "2026-09-24T17:06:00.000Z"),
      session("review-4", "2026-09-24T17:08:00.000Z"),
      session("review-5", "2026-09-24T17:10:00.000Z"),
    ];
    const attempts = [
      attempt(
        "attempt-1",
        "full",
        "2026-09-24T17:01:00.000Z",
        "LOW_OVERALL_ACCURACY",
      ),
      attempt(
        "attempt-2",
        "review-1",
        "2026-09-24T17:03:00.000Z",
        "ABANDONED",
        { abandoned: true, rawResponse: "", normalizedResponse: "" },
      ),
      attempt(
        "attempt-3",
        "review-2",
        "2026-09-24T17:05:00.000Z",
        "INCOMPLETE_ACTIVE_COVERAGE",
      ),
      attempt(
        "attempt-4",
        "review-3",
        "2026-09-24T17:07:00.000Z",
        "NEEDS_REVIEW",
      ),
      attempt(
        "attempt-5",
        "review-4",
        "2026-09-24T17:09:00.000Z",
        "LOW_NEWEST_ACCURACY",
        { assisted: true },
      ),
      attempt(
        "attempt-6",
        "review-5",
        "2026-09-24T17:11:00.000Z",
        "LOW_NEWEST_ACCURACY",
        { replayed: true },
      ),
    ];

    expect(classifyRetryHistory(sessions, attempts, identity, 3)).toEqual({
      consecutiveAccuracyMisses: 1,
      shouldSuggestSpacing: false,
    });
  });

  it("stops at readiness success", () => {
    const sessions = [
      session("full", "2026-09-24T17:00:00.000Z", { mode: "learn" }),
      session("ready", "2026-09-24T17:02:00.000Z"),
      session("latest", "2026-09-24T17:04:00.000Z"),
    ];
    const attempts = [
      attempt(
        "old-miss",
        "full",
        "2026-09-24T17:01:00.000Z",
        "LOW_OVERALL_ACCURACY",
      ),
      attempt("ready", "ready", "2026-09-24T17:03:00.000Z", "READY"),
      attempt(
        "new-miss",
        "latest",
        "2026-09-24T17:05:00.000Z",
        "LOW_NEWEST_ACCURACY",
      ),
    ];

    expect(classifyRetryHistory(sessions, attempts, identity, 3)).toEqual({
      consecutiveAccuracyMisses: 1,
      shouldSuggestSpacing: false,
    });
  });

  it("resets when a full lesson restarts", () => {
    const sessions = [
      session("old-full", "2026-09-24T17:00:00.000Z", { mode: "learn" }),
      session("old-review", "2026-09-24T17:02:00.000Z"),
      session("new-full", "2026-09-24T17:04:00.000Z", {
        mode: "learn",
        status: "active",
        activeMs: 0,
        activeDateBuckets: [],
        attemptCount: 0,
        valid: false,
        revision: 0,
      }),
    ];
    const attempts = [
      attempt(
        "attempt-1",
        "old-full",
        "2026-09-24T17:01:00.000Z",
        "LOW_OVERALL_ACCURACY",
      ),
      attempt(
        "attempt-2",
        "old-review",
        "2026-09-24T17:03:00.000Z",
        "LOW_OVERALL_ACCURACY",
      ),
    ];

    expect(classifyRetryHistory(sessions, attempts, identity, 3)).toEqual({
      consecutiveAccuracyMisses: 0,
      shouldSuggestSpacing: false,
    });
  });

  it.each([
    {
      name: "active set",
      session: { unlockedAtStart: ["K", "M", "U"] },
      attempt: {},
    },
    {
      name: "character speed",
      session: { charWpm: 18 },
      attempt: { charWpm: 18 },
    },
    {
      name: "effective speed",
      session: { effectiveWpm: 10 },
      attempt: { effectiveWpm: 10 },
    },
  ])(
    "stops when the $name changes",
    ({ session: changed, attempt: changedAttempt }) => {
      const sessions = [
        session("full", "2026-09-24T17:00:00.000Z", { mode: "learn" }),
        session("changed", "2026-09-24T17:02:00.000Z", changed),
        session("current", "2026-09-24T17:04:00.000Z"),
      ];
      const attempts = [
        attempt(
          "old-miss",
          "full",
          "2026-09-24T17:01:00.000Z",
          "LOW_OVERALL_ACCURACY",
        ),
        attempt(
          "changed-miss",
          "changed",
          "2026-09-24T17:03:00.000Z",
          "LOW_OVERALL_ACCURACY",
          changedAttempt,
        ),
        attempt(
          "current-miss",
          "current",
          "2026-09-24T17:05:00.000Z",
          "LOW_OVERALL_ACCURACY",
        ),
      ];

      expect(classifyRetryHistory(sessions, attempts, identity, 3)).toEqual({
        consecutiveAccuracyMisses: 1,
        shouldSuggestSpacing: false,
      });
    },
  );

  it("orders offset timestamps as instants", () => {
    const sessions = [
      session("full", "2026-09-24T17:00:00.000Z", { mode: "learn" }),
      session("ready", "2026-09-24T17:02:00.000Z"),
      session("miss", "2026-09-24T17:04:00.000Z"),
    ];
    const attempts = [
      attempt("ready", "ready", "2026-09-24T13:03:00.000-04:00", "READY"),
      attempt(
        "miss",
        "miss",
        "2026-09-24T17:05:00.000Z",
        "LOW_OVERALL_ACCURACY",
      ),
    ];

    expect(classifyRetryHistory(sessions, attempts, identity, 3)).toEqual({
      consecutiveAccuracyMisses: 1,
      shouldSuggestSpacing: false,
    });
  });

  it("reads and classifies a consistent repository snapshot", async () => {
    const database = new TrainerDatabase({
      name: crypto.randomUUID(),
      indexedDB,
      IDBKeyRange,
    });
    const repository = new DexieTrainingRepository(database, {
      createId: () => "dataset-generation-1",
    });
    await repository.open();
    const sessions = [
      session("full", "2026-09-24T17:00:00.000Z", { mode: "learn" }),
      session("review", "2026-09-24T17:02:00.000Z"),
    ];
    const attempts = [
      attempt(
        "attempt-1",
        "full",
        "2026-09-24T17:01:00.000Z",
        "LOW_OVERALL_ACCURACY",
      ),
      attempt(
        "attempt-2",
        "review",
        "2026-09-24T17:03:00.000Z",
        "LOW_NEWEST_ACCURACY",
      ),
    ];

    try {
      await database.sessions.bulkAdd(sessions);
      await database.attempts.bulkAdd(attempts);
      await expect(
        repository.getRetryClassification(identity, 3),
      ).resolves.toEqual({
        consecutiveAccuracyMisses: 2,
        shouldSuggestSpacing: false,
      });
    } finally {
      repository.close();
      await database.delete();
    }
  });
});
