import { IDBKeyRange, indexedDB } from "fake-indexeddb";
import { describe, expect, it, vi } from "vitest";
import { OUTPUT_DEVICE_STORAGE_KEY } from "../ui/settings-context.ts";
import { DEFAULT_CURRICULUM_CONFIG } from "../content/curriculum-data.ts";
import { createInitialState } from "../core/curriculum.ts";
import { DEFAULT_SETTINGS } from "../core/settings.ts";
import {
  LEGACY_MIGRATION_MARKER_KEY,
  LEGACY_ROLLBACK_KEY,
} from "./legacy-migration.ts";
import { createPortableBackupDocument } from "./backup.ts";
import { bootstrapTrainingData } from "./bootstrap.ts";
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

async function importConfirmation(
  repository: DexieTrainingRepository,
  rawJson: string,
) {
  const preview = await repository.previewPortableBackup(rawJson);
  return preview.replaceConfirmation;
}

const DUMMY_CONFIRMATION = {
  targetDatasetGeneration: "dataset-dummy",
  backupDigestHex: "0".repeat(64),
  operationKey: "1".repeat(64),
};

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
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
      expect(serialized).not.toContain("charWpmBand");
      expect(serialized).not.toContain("effectiveWpmBand");
    } finally {
      repository.close();
      await database.delete();
    }
  });

  it("reads export snapshot in one readonly transaction", async () => {
    const database = new TrainerDatabase({
      name: crypto.randomUUID(),
      indexedDB,
      IDBKeyRange,
    });
    const repository = new DexieTrainingRepository(database, {
      now: () => new Date("2026-10-03T10:00:00.000Z"),
      createId: () => "dataset-1b",
    });

    try {
      await repository.open();
      await seedPortableState(repository);
      await database.sessions.put(sessionRecord());
      await database.attempts.put(attemptRecord());

      const spy = vi.spyOn(database, "transaction");

      await repository.exportPortableBackup("1.2.3");

      expect(spy).toHaveBeenCalled();
      expect(spy.mock.calls[0]?.[0]).toBe("r");
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

      await repository.replacePortableBackup(
        raw,
        await importConfirmation(repository, raw),
      );
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
      const stableAttemptCount = await database.attempts.count();

      await expect(
        repository.replacePortableBackup("{", DUMMY_CONFIRMATION),
      ).rejects.toThrow("backup JSON is malformed");

      const fresh = await repository.exportPortableBackup("1.2.3");
      const freshRaw = JSON.stringify(fresh);
      const confirmation = await importConfirmation(repository, freshRaw);

      const future = await repository.exportPortableBackup("1.2.3");
      const futureRaw = JSON.stringify({ ...future, formatVersion: 999 });
      await expect(
        repository.replacePortableBackup(futureRaw, confirmation),
      ).rejects.toThrow("backup format version is newer than supported");

      const badIntegrity = await repository.exportPortableBackup("1.2.3");
      const badRaw = JSON.stringify({
        ...badIntegrity,
        integrity: {
          ...badIntegrity.integrity,
          digestHex: "0".repeat(64),
        },
      });
      await expect(
        repository.replacePortableBackup(badRaw, confirmation),
      ).rejects.toThrow("backup integrity digest does not match payload");

      const invalidCrossRecord = await createPortableBackupDocument({
        ...fresh,
        payload: {
          ...fresh.payload,
          progressionEvents: [
            {
              id: "event-1",
              schemaVersion: 1,
              updatedAt: "2026-10-03T10:00:00.000Z",
              idempotencyKey: "event:1",
              type: "advancement-accepted",
              occurredAt: {
                utc: "2026-10-03T10:00:00.000Z",
                localDate: "2026-10-03",
                utcOffsetMinutes: 0,
              },
              activeCharacters: ["K", "M"],
              masteredCharacters: [],
              migrationDerived: false,
            },
          ],
          milestones: [
            {
              id: "milestone-1",
              schemaVersion: 1,
              updatedAt: "2026-10-03T10:00:00.000Z",
              idempotencyKey: "milestone:1",
              eventId: "missing-event",
              type: "character-unlocked",
              occurredAt: {
                utc: "2026-10-03T10:00:00.000Z",
                localDate: "2026-10-03",
                utcOffsetMinutes: 0,
              },
              character: "U",
              migrationDerived: false,
            },
          ],
        },
      });
      const invalidRaw = JSON.stringify(invalidCrossRecord);
      await expect(
        repository.replacePortableBackup(invalidRaw, DUMMY_CONFIRMATION),
      ).rejects.toThrow("milestone references unknown event missing-event");

      expect(await repository.getPortableSettings()).toEqual(stableSettings);
      expect(await database.sessions.count()).toBe(stableSessionCount);
      expect(await database.attempts.count()).toBe(stableAttemptCount);
    } finally {
      repository.close();
      await database.delete();
    }
  });

  it("previews and imports prior-format backups with legacy 5 WPM settings", async () => {
    const database = new TrainerDatabase({
      name: crypto.randomUUID(),
      indexedDB,
      IDBKeyRange,
    });
    const repository = new DexieTrainingRepository(database, {
      now: () => new Date("2026-10-03T10:00:00.000Z"),
      createId: () => "dataset-legacy-5",
    });

    try {
      await repository.open();
      await seedPortableState(repository);

      const baseline = await repository.exportPortableBackup("1.2.3");
      const legacyFive = await createPortableBackupDocument({
        appVersion: baseline.appVersion,
        databaseVersion: baseline.databaseVersion,
        exportedAt: baseline.exportedAt,
        payload: {
          ...baseline.payload,
          settings: {
            ...baseline.payload.settings,
            value: {
              ...baseline.payload.settings.value,
              charWpm: 5,
              effectiveWpm: 5,
            },
          },
        },
      });
      const raw = JSON.stringify(legacyFive);

      const preview = await repository.previewPortableBackup(raw);
      expect(preview.counts).toEqual(baseline.counts);

      const confirmation = preview.replaceConfirmation;
      await expect(
        repository.replacePortableBackup(raw, confirmation),
      ).resolves.toBe("applied");
      expect((await repository.getPortableSettings())?.value).toMatchObject({
        charWpm: 5,
        effectiveWpm: 5,
      });
    } finally {
      repository.close();
      await database.delete();
    }
  });

  it("accepts a true pre-band backup digest and derives speed bands after import", async () => {
    const database = new TrainerDatabase({
      name: crypto.randomUUID(),
      indexedDB,
      IDBKeyRange,
    });
    const repository = new DexieTrainingRepository(database, {
      now: () => new Date("2026-10-03T10:00:00.000Z"),
      createId: () => "dataset-pre-band-digest",
    });

    try {
      await repository.open();
      await seedPortableState(repository);
      await database.sessions.put({
        ...sessionRecord(),
        charWpm: 18,
        effectiveWpm: 11,
        charWpmBand: 20,
        effectiveWpmBand: 10,
      });
      await database.attempts.put({
        ...attemptRecord(),
        charWpm: 18,
        effectiveWpm: 11,
        charWpmBand: 20,
        effectiveWpmBand: 10,
      });

      const baseline = await repository.exportPortableBackup("1.2.3");
      const preBandPayload = {
        ...baseline.payload,
        sessions: baseline.payload.sessions.map((session) => {
          const legacy = structuredClone(session);
          delete legacy.charWpmBand;
          delete legacy.effectiveWpmBand;
          return legacy;
        }),
        attempts: baseline.payload.attempts.map((attempt) => {
          const legacy = structuredClone(attempt);
          delete legacy.charWpmBand;
          delete legacy.effectiveWpmBand;
          return legacy;
        }),
      };
      const preBandBackup = await createPortableBackupDocument({
        appVersion: baseline.appVersion,
        databaseVersion: baseline.databaseVersion,
        exportedAt: baseline.exportedAt,
        payload: preBandPayload,
      });
      const raw = JSON.stringify(preBandBackup);

      const preview = await repository.previewPortableBackup(raw);
      expect(preview.counts).toEqual({
        sessions: 1,
        attempts: 1,
        progressionEvents: 0,
        milestones: 0,
        migrationLedgers: 0,
      });

      const confirmation = preview.replaceConfirmation;
      await expect(
        repository.replacePortableBackup(raw, confirmation),
      ).resolves.toBe("applied");

      const importedSession = await database.sessions.get("session-1");
      expect(importedSession).toMatchObject({
        charWpm: 18,
        effectiveWpm: 11,
        charWpmBand: 20,
        effectiveWpmBand: 10,
      });
      const importedAttempt = await database.attempts.get("attempt-1");
      expect(importedAttempt).toMatchObject({
        charWpm: 18,
        effectiveWpm: 11,
        charWpmBand: 20,
        effectiveWpmBand: 10,
      });
    } finally {
      repository.close();
      await database.delete();
    }
  });

  it("canonicalizes stored settings during bootstrap so immediate export matches runtime bands", async () => {
    const database = new TrainerDatabase({
      name: crypto.randomUUID(),
      indexedDB,
      IDBKeyRange,
    });
    const repository = new DexieTrainingRepository(database, {
      now: () => new Date("2026-10-03T10:00:00.000Z"),
      createId: () => "dataset-bootstrap-canonical",
    });

    try {
      await repository.open();
      await seedPortableState(repository);
      await database.settings.put({
        id: "portable-settings",
        schemaVersion: 1,
        updatedAt: "2026-10-03T10:00:00.000Z",
        value: {
          ...DEFAULT_SETTINGS,
          charWpm: 18,
          effectiveWpm: 11,
        },
      });

      const bootstrap = await bootstrapTrainingData(
        memoryStorage({ [LEGACY_ROLLBACK_KEY]: "{}" }),
        repository,
      );
      expect(bootstrap.settings).toMatchObject({
        charWpm: 20,
        effectiveWpm: 10,
      });

      const persisted = await repository.getPortableSettings();
      expect(persisted?.value).toMatchObject({ charWpm: 20, effectiveWpm: 10 });

      const exported = await repository.exportPortableBackup("1.2.3");
      expect(exported.payload.settings.value).toMatchObject({
        charWpm: 20,
        effectiveWpm: 10,
      });
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
      const confirmation = await importConfirmation(repository, raw);

      const originalPut = database.curriculum.put.bind(database.curriculum);
      let failed = false;
      database.curriculum.put = ((...args: Parameters<typeof originalPut>) => {
        if (!failed) {
          failed = true;
          throw new Error("simulated write failure");
        }
        return originalPut(...args);
      }) as typeof database.curriculum.put;

      await expect(
        repository.replacePortableBackup(raw, confirmation),
      ).rejects.toThrow("simulated write failure");

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
      localStorage.setItem(LEGACY_MIGRATION_MARKER_KEY, '{"done":true}');
      localStorage.setItem(LEGACY_ROLLBACK_KEY, '{"rollback":true}');
      await repository.resetPortableData();

      expect(localStorage.getItem(OUTPUT_DEVICE_STORAGE_KEY)).toBe(
        "device-xyz",
      );
      expect(
        await database.metadata.get("migration:legacy-local-storage-v1"),
      ).toBeDefined();
      expect(localStorage.getItem(LEGACY_MIGRATION_MARKER_KEY)).toBe(
        '{"done":true}',
      );
      expect(localStorage.getItem(LEGACY_ROLLBACK_KEY)).toBe(
        '{"rollback":true}',
      );
      expect(await database.sessions.count()).toBe(0);
      expect(await database.attempts.count()).toBe(0);
    } finally {
      repository.close();
      await database.delete();
      localStorage.removeItem(OUTPUT_DEVICE_STORAGE_KEY);
      localStorage.removeItem(LEGACY_MIGRATION_MARKER_KEY);
      localStorage.removeItem(LEGACY_ROLLBACK_KEY);
    }
  });

  it("treats confirmed replace-import retries as idempotent", async () => {
    const database = new TrainerDatabase({
      name: crypto.randomUUID(),
      indexedDB,
      IDBKeyRange,
    });
    const repository = new DexieTrainingRepository(database, {
      now: () => new Date("2026-10-03T10:00:00.000Z"),
      createId: () => "dataset-6",
    });

    try {
      await repository.open();
      await seedPortableState(repository);
      await database.sessions.put(sessionRecord());
      await database.attempts.put(attemptRecord());

      const raw = JSON.stringify(
        await repository.exportPortableBackup("1.2.3"),
      );
      const confirmation = await importConfirmation(repository, raw);

      const firstResult = await repository.replacePortableBackup(
        raw,
        confirmation,
      );
      const metadataAfterFirst = await database.metadata
        .where("id")
        .startsWith("operation:replace-import:")
        .count();

      const secondResult = await repository.replacePortableBackup(
        raw,
        confirmation,
      );
      const metadataAfterSecond = await database.metadata
        .where("id")
        .startsWith("operation:replace-import:")
        .count();

      expect(firstResult).toBe("applied");
      expect(secondResult).toBe("already-applied");
      expect(metadataAfterFirst).toBe(1);
      expect(metadataAfterSecond).toBe(1);
    } finally {
      repository.close();
      await database.delete();
    }
  });

  it("requires a fresh confirmation after target dataset generation changes", async () => {
    let generationIndex = 0;
    const database = new TrainerDatabase({
      name: crypto.randomUUID(),
      indexedDB,
      IDBKeyRange,
    });
    const repository = new DexieTrainingRepository(database, {
      now: () => new Date("2026-10-03T10:00:00.000Z"),
      createId: () => `dataset-7-${generationIndex++}`,
    });

    try {
      await repository.open();
      await seedPortableState(repository);
      await database.sessions.put(sessionRecord());
      await database.attempts.put(attemptRecord());

      const raw = JSON.stringify(
        await repository.exportPortableBackup("1.2.3"),
      );
      const staleConfirmation = await importConfirmation(repository, raw);

      await repository.resetPortableData();
      await expect(
        repository.replacePortableBackup(raw, staleConfirmation),
      ).rejects.toThrow(
        "import confirmation is stale; preview the backup again",
      );

      const freshConfirmation = await importConfirmation(repository, raw);
      await expect(
        repository.replacePortableBackup(raw, freshConfirmation),
      ).resolves.toBe("applied");
    } finally {
      repository.close();
      await database.delete();
    }
  });
});
