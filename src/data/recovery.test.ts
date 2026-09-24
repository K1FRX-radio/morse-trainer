import { IDBKeyRange, indexedDB } from "fake-indexeddb";
import type { TrainingAttemptRecord, TrainingSessionRecord } from "./models.ts";
import { TrainerDatabase } from "./indexeddb.ts";
import { DexieTrainingRepository } from "./repository.ts";

const startedAt = {
  utc: "2026-09-24T17:00:00.000Z",
  localDate: "2026-09-24",
  utcOffsetMinutes: -240,
  timeZone: "America/New_York",
};

function activeSession(
  overrides: Partial<TrainingSessionRecord> = {},
): TrainingSessionRecord {
  return {
    id: "session-1",
    schemaVersion: 1,
    updatedAt: "2026-09-24T17:01:00.000Z",
    source: "learn",
    mode: "learn",
    status: "active",
    startedAt,
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
    appVersion: "0.0.0",
    revision: 3,
    ownerTabId: "tab-1",
    leaseExpiresAt: "2026-09-24T17:02:00.000Z",
    ...overrides,
  };
}

function attempt(): TrainingAttemptRecord {
  return {
    id: "attempt-1",
    schemaVersion: 1,
    updatedAt: "2026-09-24T17:00:30.000Z",
    sessionId: "session-1",
    occurredAt: {
      utc: "2026-09-24T17:00:30.000Z",
      localDate: "2026-09-24",
      utcOffsetMinutes: -240,
      timeZone: "America/New_York",
    },
    source: "learn",
    direction: "rx",
    exerciseType: "copy-character",
    rawTarget: "K",
    rawResponse: "K",
    normalizedTarget: "K",
    normalizedResponse: "K",
    correct: true,
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
    ],
    charWpm: 20,
    effectiveWpm: 12,
    toneHz: 600,
    noiseLevel: 0,
  };
}

async function setupRepository() {
  const database = new TrainerDatabase({
    name: crypto.randomUUID(),
    indexedDB,
    IDBKeyRange,
  });
  const repository = new DexieTrainingRepository(database, {
    createId: () => "dataset-generation-1",
    now: () => new Date("2026-09-24T18:00:00.000Z"),
  });
  await repository.open();
  return { database, repository };
}

describe("interrupted-session recovery", () => {
  it("finalizes active sessions and updates projections exactly once", async () => {
    const { database, repository } = await setupRepository();

    try {
      await database.sessions.add(activeSession());
      await database.attempts.add(attempt());

      const recovered = await repository.recoverInterruptedSessions();

      expect(recovered).toHaveLength(1);
      expect(recovered[0]).toMatchObject({
        id: "session-1",
        status: "interrupted",
        endedAt: {
          utc: "2026-09-24T18:00:00.000Z",
          localDate: "2026-09-24",
        },
        valid: true,
        revision: 4,
        finalizationKey: "recovery:session-1:3",
      });
      expect(recovered[0]).not.toHaveProperty("ownerTabId");
      expect(recovered[0]).not.toHaveProperty("leaseExpiresAt");
      expect(await database.attempts.count()).toBe(1);
      expect(
        await database.metadata.get("operation:recovery:session-1:3"),
      ).toMatchObject({
        kind: "operation",
        operation: "recover-interrupted-session",
        idempotencyKey: "recovery:session-1:3",
        resultRecordId: "session-1",
      });
      expect(await database.dailyProjections.toArray()).toMatchObject([
        {
          localDate: "2026-09-24",
          activeMs: 45000,
          sessionCount: 1,
          attemptCount: 1,
        },
      ]);

      await expect(repository.recoverInterruptedSessions()).resolves.toEqual(
        [],
      );
      expect(
        await database.metadata
          .where("operation")
          .equals("recover-interrupted-session")
          .count(),
      ).toBe(1);
    } finally {
      repository.close();
      await database.delete();
    }
  });

  it("rolls back when an active session disagrees with stored attempts", async () => {
    const { database, repository } = await setupRepository();

    try {
      await database.sessions.add(activeSession());

      await expect(repository.recoverInterruptedSessions()).rejects.toThrow(
        /attemptCount 1 does not match 0 stored attempts/,
      );
      expect(await database.sessions.get("session-1")).toMatchObject({
        status: "active",
        revision: 3,
      });
      expect(
        await database.metadata
          .where("operation")
          .equals("recover-interrupted-session")
          .count(),
      ).toBe(0);
    } finally {
      repository.close();
      await database.delete();
    }
  });

  it("uses the session start boundary when the wall clock moved backward", async () => {
    const { database } = await setupRepository();
    const rollbackRepository = new DexieTrainingRepository(database, {
      now: () => new Date("2026-09-24T16:00:00.000Z"),
    });

    try {
      await database.sessions.add(
        activeSession({
          activeMs: 0,
          activeDateBuckets: [],
          attemptCount: 0,
          completedCards: 0,
          valid: false,
        }),
      );

      const [recovered] = await rollbackRepository.recoverInterruptedSessions();
      expect(recovered.endedAt).toEqual(startedAt);
      expect(recovered.updatedAt).toBe("2026-09-24T17:01:00.000Z");
      expect(recovered.valid).toBe(false);
    } finally {
      rollbackRepository.close();
      await database.delete();
    }
  });
});
