import Dexie from "dexie";
import { IDBKeyRange, indexedDB } from "fake-indexeddb";
import { DATABASE_VERSION, SCHEMA_V1, TrainerDatabase } from "./indexeddb.ts";
import type {
  CapturedDateTime,
  TrainingAttemptRecord,
  TrainingSessionRecord,
} from "./models.ts";

const FIXED_NOW = new Date("2026-09-24T18:00:00.000Z");

function dateTime(
  utc = "2026-09-24T17:00:00.000Z",
  localDate = "2026-09-24",
): CapturedDateTime {
  return {
    utc,
    localDate,
    utcOffsetMinutes: -240,
    timeZone: "America/New_York",
  };
}

function session(
  overrides: Partial<TrainingSessionRecord> = {},
): TrainingSessionRecord {
  return {
    id: "session-1",
    schemaVersion: 1,
    updatedAt: "2026-09-24T17:05:00.000Z",
    source: "learn",
    mode: "learn",
    status: "completed",
    startedAt: dateTime(),
    endedAt: dateTime("2026-09-24T17:05:00.000Z"),
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
    revision: 2,
    ...overrides,
  };
}

function attempt(
  overrides: Partial<TrainingAttemptRecord> = {},
): TrainingAttemptRecord {
  return {
    id: "attempt-1",
    schemaVersion: 1,
    updatedAt: "2026-09-24T17:01:00.000Z",
    sessionId: "session-1",
    occurredAt: dateTime("2026-09-24T17:01:00.000Z"),
    source: "learn",
    direction: "rx",
    exerciseType: "copy-group",
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
    ...overrides,
  };
}

function options(name: string) {
  return {
    name,
    indexedDB,
    IDBKeyRange,
    now: () => FIXED_NOW,
  };
}

describe("TrainerDatabase", () => {
  it("creates a fresh version 2 database with source and projection tables", async () => {
    const database = new TrainerDatabase(options(crypto.randomUUID()));
    try {
      await database.open();

      expect(database.verno).toBe(DATABASE_VERSION);
      expect(database.tables.map(({ name }) => name).sort()).toEqual([
        "attempts",
        "characterProjections",
        "confusionProjections",
        "curriculum",
        "dailyProjections",
        "introductions",
        "metadata",
        "milestones",
        "progressionEvents",
        "sessions",
        "settings",
      ]);
    } finally {
      await database.delete();
    }
  });

  it("upgrades a version 1 fixture without changing source records", async () => {
    const name = crypto.randomUUID();
    const originalSession = session();
    const originalAttempt = attempt();
    const version1 = new Dexie(name, { indexedDB, IDBKeyRange });
    version1.version(1).stores(SCHEMA_V1);
    await version1.open();
    await version1.table("sessions").add(originalSession);
    await version1.table("attempts").add(originalAttempt);
    version1.close();

    const upgraded = new TrainerDatabase(options(name));
    try {
      await upgraded.open();

      expect(upgraded.verno).toBe(DATABASE_VERSION);
      expect(await upgraded.sessions.get(originalSession.id)).toEqual(
        originalSession,
      );
      expect(await upgraded.attempts.get(originalAttempt.id)).toEqual(
        originalAttempt,
      );
      expect(
        await upgraded.dailyProjections.get("daily:2026-09-24"),
      ).toMatchObject({
        activeMs: 45000,
        sessionCount: 1,
        attemptCount: 1,
        rxCorrect: 1,
        rxTotal: 2,
        txCorrect: 0,
        txTotal: 0,
        effectiveWpmTotal: 12,
        effectiveWpmSamples: 1,
      });
      expect(await upgraded.characterProjections.count()).toBe(2);
      expect(
        await upgraded.confusionProjections.get("confusion:M:K"),
      ).toMatchObject({ target: "M", answer: "K", count: 1 });
    } finally {
      await upgraded.delete();
    }
  });

  it("counts eligible attempt accuracy even when its session is not valid", async () => {
    const name = crypto.randomUUID();
    const version1 = new Dexie(name, { indexedDB, IDBKeyRange });
    version1.version(1).stores(SCHEMA_V1);
    await version1.open();
    await version1.table("sessions").add(
      session({
        activeMs: 5000,
        activeDateBuckets: [
          {
            localDate: "2026-09-24",
            utcOffsetMinutes: -240,
            timeZone: "America/New_York",
            activeMs: 5000,
          },
        ],
        valid: false,
      }),
    );
    await version1.table("attempts").add(attempt());
    version1.close();

    const upgraded = new TrainerDatabase(options(name));
    try {
      await upgraded.open();

      expect(
        await upgraded.dailyProjections.get("daily:2026-09-24"),
      ).toMatchObject({
        activeMs: 0,
        sessionCount: 0,
        attemptCount: 1,
        rxCorrect: 1,
        rxTotal: 2,
      });
    } finally {
      await upgraded.delete();
    }
  });

  it("rejects malformed version 1 records without completing the upgrade", async () => {
    const name = crypto.randomUUID();
    const version1 = new Dexie(name, { indexedDB, IDBKeyRange });
    version1.version(1).stores(SCHEMA_V1);
    await version1.open();
    await version1.table("sessions").add({
      ...session(),
      startedAt: { ...dateTime(), localDate: "09/24/2026" },
    });
    version1.close();

    const upgraded = new TrainerDatabase(options(name));
    await expect(upgraded.open()).rejects.toThrow();
    upgraded.close();

    const cleanup = new Dexie(name, { indexedDB, IDBKeyRange });
    await cleanup.delete();
  });

  it.each([
    {
      name: "a future record version",
      malformed: attempt({ schemaVersion: 2 }),
    },
    {
      name: "contradictory alignment evidence",
      malformed: attempt({
        observations: [
          {
            kind: "substitution",
            correct: true,
            targetIndex: 0,
            target: "K",
            answerIndex: 0,
            answer: "M",
          },
        ],
      }),
    },
  ])("rolls back upgrade for $name", async ({ malformed }) => {
    const name = crypto.randomUUID();
    const version1 = new Dexie(name, { indexedDB, IDBKeyRange });
    version1.version(1).stores(SCHEMA_V1);
    await version1.open();
    await version1.table("sessions").add(session());
    await version1.table("attempts").add(malformed);
    version1.close();

    const upgraded = new TrainerDatabase(options(name));
    await expect(upgraded.open()).rejects.toThrow();
    upgraded.close();

    const stillVersion1 = new Dexie(name, { indexedDB, IDBKeyRange });
    stillVersion1.version(1).stores(SCHEMA_V1);
    await stillVersion1.open();
    expect(stillVersion1.verno).toBe(1);
    expect(await stillVersion1.table("attempts").count()).toBe(1);
    expect(stillVersion1.tables.map(({ name: table }) => table)).not.toContain(
      "dailyProjections",
    );
    stillVersion1.close();
    await stillVersion1.delete();
  });

  it("closes the stale connection and notifies reload-required on versionchange", async () => {
    const name = crypto.randomUUID();
    const lifecycleEvents: string[] = [];
    const database = new TrainerDatabase({
      ...options(name),
      tabId: "tab-under-test",
      onLifecycleEvent: (event) => lifecycleEvents.push(event),
    });

    try {
      await database.open();
      expect(database.isOpen()).toBe(true);

      const upgrade = indexedDB.open(name, 99);
      await new Promise<void>((resolve, reject) => {
        upgrade.onerror = () =>
          reject(upgrade.error ?? new Error("upgrade failed"));
        upgrade.onupgradeneeded = () => undefined;
        upgrade.onsuccess = () => {
          upgrade.result.close();
          resolve();
        };
      });

      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(database.isOpen()).toBe(false);
      expect(lifecycleEvents).toContain("reload-required");
    } finally {
      database.close();
      await new Promise<void>((resolve) => {
        const request = indexedDB.deleteDatabase(name);
        request.onsuccess = () => resolve();
        request.onerror = () => resolve();
        request.onblocked = () => resolve();
      });
    }
  });
});
