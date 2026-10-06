import { IDBKeyRange, indexedDB } from "fake-indexeddb";
import {
  PROJECTION_VERSION,
  type TrainingAttemptRecord,
  type TrainingSessionRecord,
} from "./models.ts";
import { TrainerDatabase } from "./indexeddb.ts";
import { DexieTrainingRepository } from "./repository.ts";

const startedAt = {
  utc: "2026-09-24T17:00:00.000Z",
  localDate: "2026-09-24",
  utcOffsetMinutes: -240,
  timeZone: "America/New_York",
};

type ActiveSessionOverrides = Partial<TrainingSessionRecord> & {
  withoutLease?: boolean;
};

function activeSession({
  withoutLease = false,
  ...overrides
}: ActiveSessionOverrides = {}): TrainingSessionRecord {
  const session: TrainingSessionRecord = {
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
  if (withoutLease) {
    delete session.ownerTabId;
    delete session.leaseExpiresAt;
  }
  return session;
}

function attempt(
  overrides: Partial<TrainingAttemptRecord> = {},
): TrainingAttemptRecord {
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
    ...overrides,
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
  it("recovers an active session without a lease", async () => {
    const { database, repository } = await setupRepository();

    try {
      await database.sessions.add(activeSession({ withoutLease: true }));
      await database.attempts.add(attempt());

      await expect(
        repository.recoverInterruptedSessions(),
      ).resolves.toHaveLength(1);
      expect(await database.sessions.get("session-1")).toMatchObject({
        status: "interrupted",
      });
    } finally {
      repository.close();
      await database.delete();
    }
  });

  it("recovers an expired lease but leaves an unexpired offset lease untouched", async () => {
    const { database, repository } = await setupRepository();

    try {
      await database.sessions.bulkAdd([
        activeSession({
          id: "expired-session",
          leaseExpiresAt: "2026-09-24T17:59:59.999Z",
        }),
        activeSession({
          id: "leased-session",
          leaseExpiresAt: "2026-09-24T14:30:00.000-04:00",
        }),
      ]);
      await database.attempts.bulkAdd([
        attempt({ id: "expired-attempt", sessionId: "expired-session" }),
        attempt({ id: "leased-attempt", sessionId: "leased-session" }),
      ]);

      const recovered = await repository.recoverInterruptedSessions();

      expect(recovered.map((session) => session.id)).toEqual([
        "expired-session",
      ]);
      expect(await database.sessions.get("expired-session")).toMatchObject({
        status: "interrupted",
      });
      expect(await database.sessions.get("leased-session")).toMatchObject({
        status: "active",
        revision: 3,
        ownerTabId: "tab-1",
        leaseExpiresAt: "2026-09-24T14:30:00.000-04:00",
      });
    } finally {
      repository.close();
      await database.delete();
    }
  });

  it("renews a lease only for its current owner and revision", async () => {
    const { database, repository } = await setupRepository();

    try {
      await database.sessions.add(activeSession());

      await expect(
        repository.renewSessionLease(
          "session-1",
          "tab-1",
          3,
          "2026-09-24T18:05:00.000Z",
        ),
      ).resolves.toMatchObject({
        revision: 4,
        ownerTabId: "tab-1",
        leaseExpiresAt: "2026-09-24T18:05:00.000Z",
        updatedAt: "2026-09-24T18:00:00.000Z",
      });
      await expect(
        repository.renewSessionLease(
          "session-1",
          "tab-2",
          4,
          "2026-09-24T18:10:00.000Z",
        ),
      ).rejects.toThrow(/session owner changed/);
      await expect(
        repository.renewSessionLease(
          "session-1",
          "tab-1",
          3,
          "2026-09-24T18:10:00.000Z",
        ),
      ).rejects.toThrow(/session revision changed/);
    } finally {
      repository.close();
      await database.delete();
    }
  });

  it("skips recovery when renewal commits first", async () => {
    const { database, repository } = await setupRepository();

    try {
      await database.sessions.add(activeSession());
      await database.attempts.add(attempt());
      await repository.renewSessionLease(
        "session-1",
        "tab-1",
        3,
        "2026-09-24T18:05:00.000Z",
      );

      await expect(repository.recoverInterruptedSessions()).resolves.toEqual(
        [],
      );
      expect(await database.sessions.get("session-1")).toMatchObject({
        status: "active",
        revision: 4,
        leaseExpiresAt: "2026-09-24T18:05:00.000Z",
      });
    } finally {
      repository.close();
      await database.delete();
    }
  });

  it("rejects renewal when recovery commits first", async () => {
    const { database, repository } = await setupRepository();

    try {
      await database.sessions.add(activeSession());
      await database.attempts.add(attempt());
      await repository.recoverInterruptedSessions();

      await expect(
        repository.renewSessionLease(
          "session-1",
          "tab-1",
          3,
          "2026-09-24T18:05:00.000Z",
        ),
      ).rejects.toThrow(/cannot renew a finalized session/);
    } finally {
      repository.close();
      await database.delete();
    }
  });

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

  it("recovers multiple expired sessions atomically", async () => {
    const { database, repository } = await setupRepository();

    try {
      await database.sessions.bulkAdd([
        activeSession({ id: "session-1" }),
        activeSession({ id: "session-2" }),
      ]);
      await database.attempts.bulkAdd([
        attempt({ id: "attempt-1", sessionId: "session-1" }),
        attempt({ id: "attempt-2", sessionId: "session-2" }),
      ]);

      const recovered = await repository.recoverInterruptedSessions();

      expect(recovered.map((session) => session.id).sort()).toEqual([
        "session-1",
        "session-2",
      ]);
      expect(
        await database.sessions.where("status").equals("interrupted").count(),
      ).toBe(2);
      expect(
        await database.metadata
          .where("operation")
          .equals("recover-interrupted-session")
          .count(),
      ).toBe(2);
      expect(await database.dailyProjections.toArray()).toMatchObject([
        { activeMs: 90000, sessionCount: 2, attemptCount: 2 },
      ]);
    } finally {
      repository.close();
      await database.delete();
    }
  });

  it("does not double-finalize when recovery callers overlap", async () => {
    const { database, repository } = await setupRepository();

    try {
      await database.sessions.add(activeSession());
      await database.attempts.add(attempt());

      const results = await Promise.all([
        repository.recoverInterruptedSessions(),
        repository.recoverInterruptedSessions(),
      ]);

      expect(results.map((result) => result.length).sort()).toEqual([0, 1]);
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

  it("rolls back session, projection, and ledger writes on a ledger conflict", async () => {
    const { database, repository } = await setupRepository();

    try {
      await database.sessions.add(activeSession());
      await database.attempts.add(attempt());
      await database.dailyProjections.add({
        id: "daily:stale",
        schemaVersion: 1,
        updatedAt: "2026-09-24T17:30:00.000Z",
        projectionVersion: PROJECTION_VERSION,
        localDate: "stale",
        activeMs: 1,
        sessionCount: 1,
        attemptCount: 1,
        rxCorrect: 1,
        rxTotal: 1,
        txCorrect: 0,
        txTotal: 0,
        effectiveWpmTotal: 12,
        effectiveWpmSamples: 1,
      });
      await database.metadata.add({
        id: "operation:recovery:session-1:3",
        schemaVersion: 1,
        updatedAt: "2026-09-24T17:30:00.000Z",
        kind: "operation",
        operation: "conflicting-operation",
        idempotencyKey: "conflict",
        completedAt: "2026-09-24T17:30:00.000Z",
      });

      await expect(repository.recoverInterruptedSessions()).rejects.toThrow();
      expect(await database.sessions.get("session-1")).toMatchObject({
        status: "active",
        revision: 3,
      });
      expect(await database.dailyProjections.toArray()).toMatchObject([
        { id: "daily:stale", activeMs: 1 },
      ]);
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
          withoutLease: true,
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
