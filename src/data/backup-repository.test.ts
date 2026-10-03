import { IDBKeyRange, indexedDB } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import { OUTPUT_DEVICE_STORAGE_KEY } from "../ui/settings-context.ts";
import { DEFAULT_CURRICULUM_CONFIG } from "../content/curriculum-data.ts";
import { createInitialState } from "../core/curriculum.ts";
import { DEFAULT_SETTINGS } from "../core/settings.ts";
import { TrainerDatabase } from "./indexeddb.ts";
import { DexieTrainingRepository } from "./repository.ts";

function sessionRecord() {
  return {
    id: "session-1",
    schemaVersion: 1,
    updatedAt: "2026-10-03T10:00:00.000Z",
    source: "send-practice" as const,
    mode: "send" as const,
    status: "completed" as const,
    startedAt: {
      utc: "2026-10-03T09:59:00.000Z",
      localDate: "2026-10-03",
      utcOffsetMinutes: 0,
    },
    endedAt: {
      utc: "2026-10-03T10:00:00.000Z",
      localDate: "2026-10-03",
      utcOffsetMinutes: 0,
    },
    activeMs: 15000,
    activeDateBuckets: [
      {
        localDate: "2026-10-03",
        utcOffsetMinutes: 0,
        activeMs: 15000,
      },
    ],
    attemptCount: 1,
    finalizedAttemptCount: 1,
    completedCards: 1,
    valid: false,
    charWpm: 20,
    effectiveWpm: 12,
    toneHz: 600,
    noiseLevel: 0,
    unlockedAtStart: ["K", "M"],
    unlockedAtEnd: ["K", "M"],
    appVersion: "0.0.0",
    revision: 1,
    finalizationKey: "session-finalized-1",
  };
}

function attemptRecord() {
  return {
    id: "attempt-1",
    schemaVersion: 1,
    updatedAt: "2026-10-03T10:00:00.000Z",
    sessionId: "session-1",
    occurredAt: {
      utc: "2026-10-03T10:00:00.000Z",
      localDate: "2026-10-03",
      utcOffsetMinutes: 0,
    },
    source: "send-practice" as const,
    direction: "tx" as const,
    exerciseType: "send-character" as const,
    rawTarget: "T",
    rawResponse: "T",
    normalizedTarget: "T",
    normalizedResponse: "T",
    correct: true,
    assisted: false,
    replayed: false,
    abandoned: false,
    scoringAlgorithmVersion: "alignment-v1",
    observations: [
      {
        kind: "match" as const,
        correct: true,
        targetIndex: 0,
        target: "T",
        answerIndex: 0,
        answer: "T",
      },
    ],
    schedulerReason: "NEW_CHARACTER" as const,
    responseMs: 400,
    charWpm: 20,
    effectiveWpm: 12,
    toneHz: 600,
    noiseLevel: 0,
  };
}

async function seedPortableState(repository: DexieTrainingRepository) {
  await repository.savePortableSettings(DEFAULT_SETTINGS);
  await repository.saveCurriculumState(
    createInitialState(DEFAULT_CURRICULUM_CONFIG),
  );
  await repository.saveIntroductions(["K", "M"]);
}

describe("portable backup and reset", () => {
  it("exports portable authoritative records and excludes projection rows", async () => {
    const database = new TrainerDatabase({
      name: crypto.randomUUID(),
      indexedDB,
      IDBKeyRange,
    });
    const repository = new DexieTrainingRepository(database, {
      now: () => new Date("2026-10-03T10:00:00.000Z"),
      createId: () => "dataset-1",
    });

    try {
      await repository.open();
      await seedPortableState(repository);
      await database.sessions.put(sessionRecord());
      await database.attempts.put(attemptRecord());
      await database.dailyProjections.put({
        id: "daily:stale",
        schemaVersion: 1,
        updatedAt: "2026-10-03T10:00:00.000Z",
        projectionVersion: 1,
        localDate: "stale",
        activeMs: 1,
        sessionCount: 1,
        attemptCount: 1,
        rxCorrect: 0,
        rxTotal: 0,
        txCorrect: 0,
        txTotal: 0,
        effectiveWpmTotal: 0,
        effectiveWpmSamples: 0,
      });

      const backup = await repository.exportPortableBackup("1.2.3");
      const serialized = JSON.stringify(backup);

      expect(backup.counts).toEqual({
        sessions: 1,
        attempts: 1,
        progressionEvents: 0,
        milestones: 0,
        migrationLedgers: 0,
      });
      expect(serialized).not.toContain("audioOutput");
      expect(serialized).not.toContain("dailyProjections");
      expect(serialized).not.toContain("characterProjections");
      expect(serialized).not.toContain("confusionProjections");
    } finally {
      repository.close();
      await database.delete();
    }
  });

  it("round-trips export -> reset -> replace import with equivalent authoritative data", async () => {
    const database = new TrainerDatabase({
      name: crypto.randomUUID(),
      indexedDB,
      IDBKeyRange,
    });
    const repository = new DexieTrainingRepository(database, {
      now: () => new Date("2026-10-03T10:00:00.000Z"),
      createId: () => "dataset-2",
    });

    try {
      await repository.open();
      await seedPortableState(repository);
      await database.sessions.put(sessionRecord());
      await database.attempts.put(attemptRecord());
      await repository.rebuildProjections();
      const before = await repository.listDailyProjections({
        fromLocalDate: "2026-10-03",
        toLocalDate: "2026-10-03",
        limit: 10,
      });

      const backup = await repository.exportPortableBackup("1.2.3");
      const raw = JSON.stringify(backup);

      await repository.resetPortableData();
      expect(await database.sessions.count()).toBe(0);
      expect(await database.attempts.count()).toBe(0);

      await repository.replacePortableBackup(raw);
      expect(await database.sessions.count()).toBe(1);
      expect(await database.attempts.count()).toBe(1);
      expect(await repository.getPortableSettings()).toMatchObject({
        value: DEFAULT_SETTINGS,
      });

      const after = await repository.listDailyProjections({
        fromLocalDate: "2026-10-03",
        toLocalDate: "2026-10-03",
        limit: 10,
      });
      expect(after).toEqual(before);
    } finally {
      repository.close();
      await database.delete();
    }
  });

  it("rejects malformed, future-version, and bad-integrity imports without mutation", async () => {
    const database = new TrainerDatabase({
      name: crypto.randomUUID(),
      indexedDB,
      IDBKeyRange,
    });
    const repository = new DexieTrainingRepository(database, {
      now: () => new Date("2026-10-03T10:00:00.000Z"),
      createId: () => "dataset-3",
    });

    try {
      await repository.open();
      await seedPortableState(repository);
      await database.sessions.put(sessionRecord());
      await database.attempts.put(attemptRecord());

      const stableSettings = await repository.getPortableSettings();
      const stableSessionCount = await database.sessions.count();

      await expect(repository.replacePortableBackup("{")).rejects.toThrow(
        "backup JSON is malformed",
      );

      const future = await repository.exportPortableBackup("1.2.3");
      const futureRaw = JSON.stringify({ ...future, formatVersion: 999 });
      await expect(repository.replacePortableBackup(futureRaw)).rejects.toThrow(
        "backup format version is newer than supported",
      );

      const badIntegrity = await repository.exportPortableBackup("1.2.3");
      const badRaw = JSON.stringify({
        ...badIntegrity,
        integrity: {
          ...badIntegrity.integrity,
          digestHex: "0".repeat(64),
        },
      });
      await expect(repository.replacePortableBackup(badRaw)).rejects.toThrow(
        "backup integrity digest does not match payload",
      );

      expect(await repository.getPortableSettings()).toEqual(stableSettings);
      expect(await database.sessions.count()).toBe(stableSessionCount);
    } finally {
      repository.close();
      await database.delete();
    }
  });

  it("rolls back replace import fully if a write fails", async () => {
    const database = new TrainerDatabase({
      name: crypto.randomUUID(),
      indexedDB,
      IDBKeyRange,
    });
    const repository = new DexieTrainingRepository(database, {
      now: () => new Date("2026-10-03T10:00:00.000Z"),
      createId: () => "dataset-4",
    });

    try {
      await repository.open();
      await seedPortableState(repository);
      await database.sessions.put(sessionRecord());
      await database.attempts.put(attemptRecord());

      const backup = await repository.exportPortableBackup("1.2.3");
      const raw = JSON.stringify(backup);
      const originalSettings = await repository.getPortableSettings();

      const originalPut = database.curriculum.put.bind(database.curriculum);
      let failed = false;
      database.curriculum.put = ((...args: Parameters<typeof originalPut>) => {
        if (!failed) {
          failed = true;
          throw new Error("simulated write failure");
        }
        return originalPut(...args);
      }) as typeof database.curriculum.put;

      await expect(repository.replacePortableBackup(raw)).rejects.toThrow(
        "simulated write failure",
      );

      expect(await repository.getPortableSettings()).toEqual(originalSettings);
      expect(await database.sessions.count()).toBe(1);
      expect(await database.attempts.count()).toBe(1);
    } finally {
      repository.close();
      await database.delete();
    }
  });

  it("preserves audio output selection and migration ledger across reset", async () => {
    const database = new TrainerDatabase({
      name: crypto.randomUUID(),
      indexedDB,
      IDBKeyRange,
    });
    const repository = new DexieTrainingRepository(database, {
      now: () => new Date("2026-10-03T10:00:00.000Z"),
      createId: () => "dataset-5",
    });

    try {
      await repository.open();
      await seedPortableState(repository);
      await database.metadata.put({
        id: "migration:legacy-local-storage-v1",
        schemaVersion: 1,
        updatedAt: "2026-10-03T10:00:00.000Z",
        kind: "migration",
        migration: "legacy-local-storage-v1",
        completedAt: "2026-10-03T10:00:00.000Z",
      });

      localStorage.setItem(OUTPUT_DEVICE_STORAGE_KEY, "device-xyz");
      await repository.resetPortableData();

      expect(localStorage.getItem(OUTPUT_DEVICE_STORAGE_KEY)).toBe(
        "device-xyz",
      );
      expect(
        await database.metadata.get("migration:legacy-local-storage-v1"),
      ).toBeDefined();
      expect(await database.sessions.count()).toBe(0);
      expect(await database.attempts.count()).toBe(0);
    } finally {
      repository.close();
      await database.delete();
      localStorage.removeItem(OUTPUT_DEVICE_STORAGE_KEY);
    }
  });
});
