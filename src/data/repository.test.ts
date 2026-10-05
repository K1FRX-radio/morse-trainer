import Dexie from "dexie";
import { IDBKeyRange, indexedDB } from "fake-indexeddb";
import { DEFAULT_SETTINGS } from "../core/settings.ts";
import { DEFAULT_CURRICULUM_CONFIG } from "../content/curriculum-data.ts";
import { createInitialState } from "../core/curriculum.ts";
import { SCHEMA_V1, SCHEMA_V2, TrainerDatabase } from "./indexeddb.ts";
import { PROJECTION_VERSION } from "./models.ts";
import { DexieTrainingRepository } from "./repository.ts";

describe("DexieTrainingRepository", () => {
  it("creates and updates portable settings through validated records", async () => {
    const database = new TrainerDatabase({
      name: crypto.randomUUID(),
      indexedDB,
      IDBKeyRange,
    });
    const repository = new DexieTrainingRepository(database, {
      now: () => new Date("2026-09-24T18:00:00.000Z"),
    });

    try {
      await repository.open();
      await expect(repository.getPortableSettings()).resolves.toBeUndefined();
      await expect(
        repository.savePortableSettings(DEFAULT_SETTINGS),
      ).resolves.toMatchObject({
        id: "portable-settings",
        updatedAt: "2026-09-24T18:00:00.000Z",
        value: DEFAULT_SETTINGS,
      });
      await expect(
        repository.savePortableSettings({
          ...DEFAULT_SETTINGS,
          effectiveWpm: 10,
        }),
      ).resolves.toMatchObject({ value: { effectiveWpm: 10 } });
      await expect(repository.getPortableSettings()).resolves.toMatchObject({
        value: { effectiveWpm: 10 },
      });
    } finally {
      repository.close();
      await database.delete();
    }
  });

  it("creates and updates curriculum and introduction snapshots", async () => {
    const database = new TrainerDatabase({
      name: crypto.randomUUID(),
      indexedDB,
      IDBKeyRange,
    });
    const repository = new DexieTrainingRepository(database, {
      now: () => new Date("2026-09-24T18:00:00.000Z"),
    });
    const state = createInitialState(DEFAULT_CURRICULUM_CONFIG);

    try {
      await repository.open();
      await expect(repository.getCurriculumState()).resolves.toBeUndefined();
      await expect(repository.getIntroductions()).resolves.toBeUndefined();
      await expect(
        repository.saveCurriculumState(state),
      ).resolves.toMatchObject({
        id: "curriculum-state",
        characters: state.characters,
      });
      await expect(
        repository.saveIntroductions(["K", "K", "M"]),
      ).resolves.toMatchObject({ characters: ["K", "M"] });
      await expect(repository.getCurriculumState()).resolves.toMatchObject({
        characters: state.characters,
      });
      await expect(repository.getIntroductions()).resolves.toMatchObject({
        characters: ["K", "M"],
      });
    } finally {
      repository.close();
      await database.delete();
    }
  });

  it("creates stable schema metadata once during bootstrap", async () => {
    const database = new TrainerDatabase({
      name: crypto.randomUUID(),
      indexedDB,
      IDBKeyRange,
      now: () => new Date("2026-09-24T18:00:00.000Z"),
    });
    let idCalls = 0;
    const repository = new DexieTrainingRepository(database, {
      now: () => new Date("2026-09-24T18:00:00.000Z"),
      createId: () => {
        idCalls += 1;
        return "dataset-generation-1";
      },
    });

    try {
      const first = await repository.open();
      const second = await repository.open();

      expect(first).toEqual({
        id: "schema-metadata",
        schemaVersion: 1,
        updatedAt: "2026-09-24T18:00:00.000Z",
        databaseVersion: 2,
        datasetGeneration: "dataset-generation-1",
      });
      expect(second).toEqual(first);
      expect(idCalls).toBe(1);
      expect(await database.metadata.count()).toBe(1);
    } finally {
      repository.close();
      await database.delete();
    }
  });

  it("reconciles version 1 metadata while preserving its dataset generation", async () => {
    const name = crypto.randomUUID();
    const version1 = new Dexie(name, { indexedDB, IDBKeyRange });
    version1.version(1).stores(SCHEMA_V1);
    await version1.open();
    await version1.table("metadata").add({
      id: "schema-metadata",
      schemaVersion: 1,
      updatedAt: "2026-09-23T18:00:00.000Z",
      databaseVersion: 1,
      datasetGeneration: "existing-generation",
    });
    version1.close();

    const database = new TrainerDatabase({
      name,
      indexedDB,
      IDBKeyRange,
    });
    let idCalls = 0;
    const repository = new DexieTrainingRepository(database, {
      now: () => new Date("2026-09-24T18:00:00.000Z"),
      createId: () => {
        idCalls += 1;
        return "replacement-generation";
      },
    });

    try {
      const metadata = await repository.open();

      expect(metadata).toEqual({
        id: "schema-metadata",
        schemaVersion: 1,
        updatedAt: "2026-09-24T18:00:00.000Z",
        databaseVersion: 2,
        datasetGeneration: "existing-generation",
      });
      expect(await database.metadata.get("schema-metadata")).toEqual(metadata);
      expect(idCalls).toBe(0);
    } finally {
      repository.close();
      await database.delete();
    }
  });

  it("rebuilds projection tables instead of trusting existing rows", async () => {
    const database = new TrainerDatabase({
      name: crypto.randomUUID(),
      indexedDB,
      IDBKeyRange,
    });
    const repository = new DexieTrainingRepository(database, {
      createId: () => "dataset-generation-1",
      now: () => new Date("2026-09-24T18:00:00.000Z"),
    });

    try {
      await repository.open();
      await database.dailyProjections.put({
        id: "daily:stale",
        schemaVersion: 1,
        updatedAt: "2026-09-24T18:00:00.000Z",
        projectionVersion: 1,
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

      await repository.rebuildProjections();

      expect(await database.dailyProjections.count()).toBe(0);
    } finally {
      repository.close();
      await database.delete();
    }
  });

  it("rebuilds stale v2 character projections on open", async () => {
    const name = crypto.randomUUID();
    const legacy = new Dexie(name, { indexedDB, IDBKeyRange });
    legacy.version(1).stores(SCHEMA_V1);
    legacy.version(2).stores(SCHEMA_V2);
    await legacy.open();

    const attempts = [
      ...Array.from({ length: 20 }, (_, index) =>
        learnAttempt({
          id: `isolated-${index}`,
          occurredAtUtc: `2026-09-24T${String(index).padStart(2, "0")}:00:00.000Z`,
          exerciseType: "copy-character",
          responseMs: 100 + index,
          answer: "K",
          correct: true,
        }),
      ),
      ...Array.from({ length: 55 }, (_, index) =>
        learnAttempt({
          id: `group-${index}`,
          occurredAtUtc: `2026-09-25T12:${String(index).padStart(2, "0")}:00.000Z`,
          exerciseType: "copy-group",
          answer: index % 4 === 0 ? "M" : "K",
          correct: index % 4 !== 0,
        }),
      ),
    ];

    const sourceSession = {
      id: "session-1",
      schemaVersion: 1 as const,
      updatedAt: "2026-09-25T13:00:00.000Z",
      source: "learn" as const,
      mode: "learn" as const,
      status: "completed" as const,
      startedAt: {
        utc: "2026-09-24T00:00:00.000Z",
        localDate: "2026-09-24",
        utcOffsetMinutes: 0,
        timeZone: "UTC",
      },
      endedAt: {
        utc: "2026-09-25T13:00:00.000Z",
        localDate: "2026-09-25",
        utcOffsetMinutes: 0,
        timeZone: "UTC",
      },
      activeMs: 90_000,
      activeDateBuckets: [
        {
          localDate: "2026-09-24",
          utcOffsetMinutes: 0,
          timeZone: "UTC",
          activeMs: 45_000,
        },
        {
          localDate: "2026-09-25",
          utcOffsetMinutes: 0,
          timeZone: "UTC",
          activeMs: 45_000,
        },
      ],
      attemptCount: attempts.length,
      completedCards: attempts.length,
      valid: true,
      charWpm: 20,
      effectiveWpm: 12,
      toneHz: 600,
      noiseLevel: 0,
      unlockedAtStart: ["K", "M"],
      unlockedAtEnd: ["K", "M"],
      appVersion: "0.0.0",
      revision: 1,
    };

    await legacy.table("metadata").put({
      id: "schema-metadata",
      schemaVersion: 1,
      updatedAt: "2026-09-25T13:00:00.000Z",
      databaseVersion: 2,
      datasetGeneration: "legacy-v2",
    });
    await legacy.table("sessions").put(sourceSession);
    await legacy.table("attempts").bulkPut(attempts);
    await legacy.table("characterProjections").put({
      id: "character:rx:K",
      schemaVersion: 1,
      updatedAt: "2026-09-25T13:00:00.000Z",
      projectionVersion: PROJECTION_VERSION - 1,
      character: "K",
      direction: "rx",
      recent: Array.from({ length: 50 }, (_, index) => ({
        attemptId: `group-${index}`,
        occurredAt: {
          utc: `2026-09-25T12:${String(index).padStart(2, "0")}:00.000Z`,
          localDate: "2026-09-25",
          utcOffsetMinutes: 0,
          timeZone: "UTC",
        },
        correct: true,
        kind: "match" as const,
        answer: "K",
      })),
    });
    legacy.close();

    const database = new TrainerDatabase({ name, indexedDB, IDBKeyRange });
    const repository = new DexieTrainingRepository(database, {
      now: () => new Date("2026-09-26T00:00:00.000Z"),
    });

    try {
      await repository.open();

      expect(await database.sessions.get("session-1")).toEqual(sourceSession);
      expect(await database.attempts.count()).toBe(attempts.length);

      const rows = await repository.listCharacterProjections({
        direction: "rx",
        character: "K",
        limit: 1,
      });
      expect(rows[0]?.recentIsolatedRxResponseMs).toEqual(
        Array.from({ length: 20 }, (_, index) => 100 + index),
      );
    } finally {
      repository.close();
      await database.delete();
    }
  });

  it("rebuilds stale TX-only/daily projection rows on open", async () => {
    const name = crypto.randomUUID();
    const legacy = new Dexie(name, { indexedDB, IDBKeyRange });
    legacy.version(1).stores(SCHEMA_V1);
    legacy.version(2).stores(SCHEMA_V2);
    await legacy.open();

    await legacy.table("metadata").put({
      id: "schema-metadata",
      schemaVersion: 1,
      updatedAt: "2026-09-25T13:00:00.000Z",
      databaseVersion: 2,
      datasetGeneration: "legacy-v2",
    });
    await legacy.table("dailyProjections").put({
      id: "daily:2026-09-25",
      schemaVersion: 1,
      updatedAt: "2026-09-25T13:00:00.000Z",
      projectionVersion: PROJECTION_VERSION - 1,
      localDate: "2026-09-25",
      activeMs: 60_000,
      sessionCount: 1,
      attemptCount: 1,
      rxCorrect: 0,
      rxTotal: 0,
      txCorrect: 1,
      txTotal: 1,
      effectiveWpmTotal: 12,
      effectiveWpmSamples: 1,
    });
    await legacy.table("characterProjections").put({
      id: "character:tx:T",
      schemaVersion: 1,
      updatedAt: "2026-09-25T13:00:00.000Z",
      projectionVersion: PROJECTION_VERSION - 1,
      character: "T",
      direction: "tx",
      recent: [
        {
          attemptId: "attempt-1",
          occurredAt: {
            utc: "2026-09-25T13:00:00.000Z",
            localDate: "2026-09-25",
            utcOffsetMinutes: 0,
            timeZone: "UTC",
          },
          correct: true,
          kind: "match" as const,
          answer: "T",
        },
      ],
    });
    legacy.close();

    const database = new TrainerDatabase({ name, indexedDB, IDBKeyRange });
    const repository = new DexieTrainingRepository(database, {
      now: () => new Date("2026-09-26T00:00:00.000Z"),
    });

    try {
      await repository.open();

      await expect(
        repository.listDailyProjections({
          fromLocalDate: "2026-09-25",
          toLocalDate: "2026-09-25",
          limit: 10,
        }),
      ).resolves.toEqual([]);
      await expect(
        repository.listCharacterProjections({ direction: "tx", limit: 10 }),
      ).resolves.toEqual([]);
    } finally {
      repository.close();
      await database.delete();
    }
  });

  it("rolls back a rebuild when session attemptCount disagrees with attempts", async () => {
    const database = new TrainerDatabase({
      name: crypto.randomUUID(),
      indexedDB,
      IDBKeyRange,
    });
    const repository = new DexieTrainingRepository(database, {
      createId: () => "dataset-generation-1",
      now: () => new Date("2026-09-24T18:00:00.000Z"),
    });

    try {
      await repository.open();
      await database.sessions.put({
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
      });
      await database.dailyProjections.put({
        id: "daily:stale",
        schemaVersion: 1,
        updatedAt: "2026-09-24T18:00:00.000Z",
        projectionVersion: 1,
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

      await expect(repository.rebuildProjections()).rejects.toThrow(
        /attemptCount 1 does not match 0 stored attempts/,
      );
      expect(await database.dailyProjections.get("daily:stale")).toBeDefined();
    } finally {
      repository.close();
      await database.delete();
    }
  });
});

function learnAttempt(overrides: {
  id: string;
  occurredAtUtc: string;
  exerciseType: "copy-character" | "copy-group";
  answer: string;
  correct: boolean;
  responseMs?: number;
}) {
  return {
    id: overrides.id,
    schemaVersion: 1 as const,
    updatedAt: overrides.occurredAtUtc,
    sessionId: "session-1",
    occurredAt: {
      utc: overrides.occurredAtUtc,
      localDate: overrides.occurredAtUtc.slice(0, 10),
      utcOffsetMinutes: 0,
      timeZone: "UTC",
    },
    source: "learn" as const,
    direction: "rx" as const,
    exerciseType: overrides.exerciseType,
    rawTarget: "K",
    rawResponse: overrides.answer,
    normalizedTarget: "K",
    normalizedResponse: overrides.answer,
    correct: overrides.correct,
    assisted: false,
    replayed: false,
    abandoned: false,
    scoringAlgorithmVersion: "alignment-v1",
    observations: [
      {
        kind: overrides.correct
          ? ("match" as const)
          : ("substitution" as const),
        correct: overrides.correct,
        targetIndex: 0,
        target: "K",
        answerIndex: 0,
        answer: overrides.answer,
      },
    ],
    ...(overrides.responseMs === undefined
      ? {}
      : { responseMs: overrides.responseMs }),
    charWpm: 20,
    effectiveWpm: 12,
    toneHz: 600,
    noiseLevel: 0,
  };
}
