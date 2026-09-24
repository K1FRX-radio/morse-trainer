import { IDBKeyRange, indexedDB } from "fake-indexeddb";
import type {
  CurriculumStateRecord,
  TrainingAttemptRecord,
  TrainingSessionRecord,
} from "./models.ts";
import { TrainerDatabase } from "./indexeddb.ts";
import { DexieTrainingRepository } from "./repository.ts";

const startedAt = {
  utc: "2026-09-24T17:00:00.000Z",
  localDate: "2026-09-24",
  utcOffsetMinutes: -240,
  timeZone: "America/New_York",
};

function session(
  overrides: Partial<TrainingSessionRecord> = {},
): TrainingSessionRecord {
  return {
    id: "session-1",
    schemaVersion: 1,
    updatedAt: startedAt.utc,
    source: "learn",
    mode: "learn",
    status: "active",
    startedAt,
    activeMs: 0,
    activeDateBuckets: [],
    attemptCount: 0,
    completedCards: 0,
    valid: false,
    charWpm: 20,
    effectiveWpm: 12,
    toneHz: 600,
    noiseLevel: 0,
    unlockedAtStart: ["K", "M"],
    appVersion: "0.0.0",
    revision: 0,
    ownerTabId: "tab-1",
    leaseExpiresAt: "2026-09-24T17:01:00.000Z",
    ...overrides,
  };
}

function attempt(
  overrides: Partial<TrainingAttemptRecord> = {},
): TrainingAttemptRecord {
  return {
    id: "attempt-1",
    schemaVersion: 1,
    updatedAt: "2026-09-24T17:00:10.000Z",
    sessionId: "session-1",
    occurredAt: {
      utc: "2026-09-24T17:00:10.000Z",
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

function curriculum(): CurriculumStateRecord {
  return {
    id: "curriculum-state",
    schemaVersion: 1,
    updatedAt: "2026-09-24T17:00:10.000Z",
    order: [
      "K",
      "M",
      "U",
      "R",
      "E",
      "S",
      "N",
      "A",
      "P",
      "T",
      "L",
      "W",
      "I",
      ".",
      "J",
      "Z",
      "=",
      "F",
      "O",
      "Y",
      ",",
      "V",
      "G",
      "5",
      "/",
      "Q",
      "9",
      "2",
      "H",
      "3",
      "8",
      "B",
      "?",
      "4",
      "7",
      "C",
      "1",
      "D",
      "6",
      "0",
      "X",
    ],
    startCount: 2,
    windowSize: 50,
    minNewCharObservations: 20,
    reviewDecayAccuracy: 0.7,
    characters: [
      {
        character: "K",
        state: "learning",
        needsReview: false,
        reviewStreak: 0,
        rx: { totalAttempts: 1, recentResults: [true] },
        tx: { totalAttempts: 0, recentResults: [] },
      },
      {
        character: "M",
        state: "learning",
        needsReview: false,
        reviewStreak: 0,
        rx: { totalAttempts: 0, recentResults: [] },
        tx: { totalAttempts: 0, recentResults: [] },
      },
    ],
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

describe("session persistence", () => {
  it("creates an active session idempotently and rejects ID reuse", async () => {
    const { database, repository } = await setupRepository();
    const record = session();

    try {
      await expect(repository.createSession(record)).resolves.toEqual({
        session: record,
        committed: true,
      });
      await expect(repository.createSession(record)).resolves.toEqual({
        session: record,
        committed: false,
      });
      await expect(
        repository.createSession(session({ charWpm: 25 })),
      ).rejects.toThrow(/session ID already exists with different data/);
      expect(await database.sessions.count()).toBe(1);
    } finally {
      repository.close();
      await database.delete();
    }
  });

  it("atomically commits an attempt, session snapshot, and curriculum", async () => {
    const { database, repository } = await setupRepository();
    const record = session();
    const nextSession = session({
      updatedAt: "2026-09-24T17:00:10.000Z",
      activeMs: 10000,
      activeDateBuckets: [
        {
          localDate: "2026-09-24",
          utcOffsetMinutes: -240,
          timeZone: "America/New_York",
          activeMs: 10000,
        },
      ],
      attemptCount: 1,
      completedCards: 1,
      revision: 1,
    });
    const firstAttempt = attempt();
    const nextCurriculum = curriculum();

    try {
      await repository.createSession(record);
      await expect(
        repository.commitAttempt({
          expectedSessionRevision: 0,
          session: nextSession,
          attempt: firstAttempt,
          curriculum: nextCurriculum,
        }),
      ).resolves.toEqual({
        session: nextSession,
        attempt: firstAttempt,
        committed: true,
      });
      await expect(
        repository.commitAttempt({
          expectedSessionRevision: 0,
          session: nextSession,
          attempt: firstAttempt,
          curriculum: nextCurriculum,
        }),
      ).resolves.toMatchObject({ committed: false });
      expect(await database.sessions.get("session-1")).toEqual(nextSession);
      expect(await database.attempts.toArray()).toEqual([firstAttempt]);
      expect(await database.curriculum.get("curriculum-state")).toEqual(
        nextCurriculum,
      );
    } finally {
      repository.close();
      await database.delete();
    }
  });

  it("rolls back an attempt when the expected session revision is stale", async () => {
    const { database, repository } = await setupRepository();

    try {
      await database.sessions.add(session({ revision: 1 }));
      await expect(
        repository.commitAttempt({
          expectedSessionRevision: 0,
          session: session({ attemptCount: 1, revision: 1 }),
          attempt: attempt(),
        }),
      ).rejects.toThrow(/session revision changed/);
      expect(await database.attempts.count()).toBe(0);
    } finally {
      repository.close();
      await database.delete();
    }
  });

  it("finalizes by compare-and-set and returns the committed result on retry", async () => {
    const { database, repository } = await setupRepository();
    const endedAt = {
      utc: "2026-09-24T17:01:00.000Z",
      localDate: "2026-09-24",
      utcOffsetMinutes: -240,
      timeZone: "America/New_York",
    };
    const completed = session({
      status: "completed",
      endedAt,
      updatedAt: endedAt.utc,
      revision: 1,
      finalizationKey: "finalize:session-1",
      unlockedAtEnd: ["K", "M"],
    });

    try {
      await repository.createSession(session());
      await expect(repository.finalizeSession(completed, 0)).resolves.toEqual({
        session: completed,
        committed: true,
      });
      await expect(repository.finalizeSession(completed, 0)).resolves.toEqual({
        session: completed,
        committed: false,
      });
      await expect(
        repository.finalizeSession(
          { ...completed, finalizationKey: "finalize:other" },
          0,
        ),
      ).rejects.toThrow(/session was already finalized/);
      expect(
        await database.metadata
          .where("operation")
          .equals("finalize-session")
          .count(),
      ).toBe(1);
    } finally {
      repository.close();
      await database.delete();
    }
  });
});
