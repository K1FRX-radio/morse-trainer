import { IDBKeyRange, indexedDB } from "fake-indexeddb";
import { DEFAULT_SETTINGS } from "../core/settings.ts";
import { TrainerDatabase } from "./indexeddb.ts";
import {
  LEGACY_CURRICULUM_V1_KEY,
  LEGACY_CURRICULUM_V2_KEY,
  LEGACY_INTRODUCTIONS_KEY,
  LEGACY_MIGRATION_MARKER_KEY,
  LEGACY_ROLLBACK_KEY,
  LEGACY_SETTINGS_KEY,
  migrateLegacyStorage,
  type LegacyStorage,
} from "./legacy-migration.ts";
import { DexieTrainingRepository } from "./repository.ts";

class MemoryStorage implements LegacyStorage {
  readonly values = new Map<string, string>();
  failNextMarkerWrite = false;

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    if (key === LEGACY_MIGRATION_MARKER_KEY && this.failNextMarkerWrite) {
      this.failNextMarkerWrite = false;
      throw new Error("marker write failed");
    }
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

const now = new Date("2026-09-24T18:00:00.000Z");
const unlockedAt = "2026-09-20T12:00:00.000Z";

function compatibleCharacter(character: string, overrides = {}) {
  return {
    character,
    state: "learning",
    needsReview: false,
    reviewStreak: 0,
    rx: { totalAttempts: 0, recentResults: [] },
    tx: { totalAttempts: 0, recentResults: [] },
    unlockedAt,
    ...overrides,
  };
}

async function createRepository() {
  const database = new TrainerDatabase({
    name: crypto.randomUUID(),
    indexedDB,
    IDBKeyRange,
  });
  const repository = new DexieTrainingRepository(database, {
    now: () => now,
    createId: () => "dataset-generation-1",
  });
  await repository.open();
  return { database, repository };
}

describe("legacy localStorage migration", () => {
  it("writes current defaults when legacy storage is missing", async () => {
    const { database, repository } = await createRepository();
    const storage = new MemoryStorage();

    try {
      await expect(
        migrateLegacyStorage(storage, repository, {
          now: () => now,
          createId: () => crypto.randomUUID(),
        }),
      ).resolves.toEqual({ status: "migrated" });
      expect(await database.settings.get("portable-settings")).toMatchObject({
        value: DEFAULT_SETTINGS,
      });
      expect(
        (await database.curriculum.get("curriculum-state"))?.characters.map(
          ({ character, state }) => [character, state],
        ),
      ).toEqual([
        ["K", "learning"],
        ["M", "learning"],
      ]);
      expect(await database.progressionEvents.count()).toBe(0);
      expect(await database.milestones.count()).toBe(0);
    } finally {
      repository.close();
      await database.delete();
    }
  });

  it("defaults wholly malformed portable values without migrating false progress", async () => {
    const { database, repository } = await createRepository();
    const storage = new MemoryStorage();
    storage.values.set(LEGACY_SETTINGS_KEY, "not-json");
    storage.values.set(
      LEGACY_CURRICULUM_V2_KEY,
      JSON.stringify([compatibleCharacter("M"), compatibleCharacter("K")]),
    );
    storage.values.set(LEGACY_INTRODUCTIONS_KEY, JSON.stringify({ K: true }));

    try {
      await migrateLegacyStorage(storage, repository, {
        now: () => now,
        createId: () => crypto.randomUUID(),
      });

      expect(await database.settings.get("portable-settings")).toMatchObject({
        value: DEFAULT_SETTINGS,
      });
      expect(
        (await database.curriculum.get("curriculum-state"))?.characters.map(
          (progress) => progress.state,
        ),
      ).toEqual(["learning", "learning"]);
      expect(
        await database.introductions.get("completed-introductions"),
      ).toMatchObject({ characters: [] });
      expect(await database.progressionEvents.count()).toBe(0);
    } finally {
      repository.close();
      await database.delete();
    }
  });

  it("normalizes compatible data, infers mastery, and preserves the audio key", async () => {
    const { database, repository } = await createRepository();
    const storage = new MemoryStorage();
    storage.values.set(
      LEGACY_SETTINGS_KEY,
      JSON.stringify({
        charWpm: 99,
        effectiveWpm: 30,
        toneHz: "invalid",
        pacing: "manual",
      }),
    );
    storage.values.set(
      LEGACY_CURRICULUM_V2_KEY,
      JSON.stringify([
        compatibleCharacter("K", {
          needsReview: true,
          reviewStreak: 2,
          rx: { totalAttempts: 4, recentResults: [true, false] },
        }),
        compatibleCharacter("M"),
        compatibleCharacter("U"),
      ]),
    );
    storage.values.set(
      LEGACY_INTRODUCTIONS_KEY,
      JSON.stringify(["K", "K", "U", "X", 7]),
    );
    storage.values.set("k1frx.audioOutput.v1", "device-7");
    let id = 0;

    try {
      const result = await migrateLegacyStorage(storage, repository, {
        now: () => now,
        createId: () => `migration-id-${++id}`,
      });

      expect(result).toEqual({ status: "migrated" });
      expect(await database.settings.get("portable-settings")).toMatchObject({
        value: {
          ...DEFAULT_SETTINGS,
          charWpm: 40,
          effectiveWpm: 30,
          pacing: "manual",
        },
      });
      const curriculum = await database.curriculum.get("curriculum-state");
      expect(
        curriculum?.characters.map(({ character, state }) => [
          character,
          state,
        ]),
      ).toEqual([
        ["K", "mastered"],
        ["M", "mastered"],
        ["U", "learning"],
      ]);
      expect(curriculum?.characters[0]).toMatchObject({
        needsReview: true,
        reviewStreak: 2,
        rx: { totalAttempts: 4, recentResults: [true, false] },
        unlockedAt,
        masteredAt: now.toISOString(),
      });
      expect(
        await database.introductions.get("completed-introductions"),
      ).toMatchObject({ characters: ["K", "U"] });
      expect(await database.progressionEvents.count()).toBe(1);
      expect((await database.progressionEvents.toArray())[0]).toMatchObject({
        type: "mastery-recorded",
        activeCharacters: ["K", "M", "U"],
        masteredCharacters: ["K", "M"],
        migrationDerived: true,
      });
      expect(
        (await database.milestones.toArray()).map((row) => row.character),
      ).toEqual(["K", "M"]);
      expect(storage.getItem(LEGACY_MIGRATION_MARKER_KEY)).not.toBeNull();
      expect(storage.getItem(LEGACY_ROLLBACK_KEY)).not.toBeNull();
      expect(storage.getItem(LEGACY_SETTINGS_KEY)).toBeNull();
      expect(storage.getItem(LEGACY_CURRICULUM_V2_KEY)).toBeNull();
      expect(storage.getItem(LEGACY_INTRODUCTIONS_KEY)).toBeNull();
      expect(storage.getItem("k1frx.audioOutput.v1")).toBe("device-7");
    } finally {
      repository.close();
      await database.delete();
    }
  });

  it("uses compatible curriculum v1 when v2 is malformed", async () => {
    const { database, repository } = await createRepository();
    const storage = new MemoryStorage();
    storage.values.set(LEGACY_CURRICULUM_V2_KEY, "not-json");
    storage.values.set(
      LEGACY_CURRICULUM_V1_KEY,
      JSON.stringify([compatibleCharacter("K"), compatibleCharacter("M")]),
    );

    try {
      await migrateLegacyStorage(storage, repository, {
        now: () => now,
        createId: () => crypto.randomUUID(),
      });

      expect(
        (await database.curriculum.get("curriculum-state"))?.characters.map(
          (progress) => progress.state,
        ),
      ).toEqual(["mastered", "learning"]);
    } finally {
      repository.close();
      await database.delete();
    }
  });

  it("suppresses migration when an external rollback snapshot already exists", async () => {
    const { database, repository } = await createRepository();
    const storage = new MemoryStorage();
    storage.values.set(LEGACY_ROLLBACK_KEY, "existing-snapshot");
    storage.values.set(LEGACY_SETTINGS_KEY, JSON.stringify({ charWpm: 35 }));

    try {
      await expect(
        migrateLegacyStorage(storage, repository, {
          now: () => now,
          createId: () => crypto.randomUUID(),
        }),
      ).resolves.toEqual({ status: "suppressed" });
      expect(await database.settings.count()).toBe(0);
      expect(storage.getItem(LEGACY_SETTINGS_KEY)).not.toBeNull();
    } finally {
      repository.close();
      await database.delete();
    }
  });

  it("retries post-commit marker and cleanup without duplicating records", async () => {
    const { database, repository } = await createRepository();
    const storage = new MemoryStorage();
    storage.values.set(
      LEGACY_CURRICULUM_V2_KEY,
      JSON.stringify([
        compatibleCharacter("K"),
        compatibleCharacter("M"),
        compatibleCharacter("U"),
      ]),
    );
    storage.failNextMarkerWrite = true;
    let id = 0;
    const dependencies = {
      now: () => now,
      createId: () => `migration-id-${++id}`,
    };

    try {
      await expect(
        migrateLegacyStorage(storage, repository, dependencies),
      ).rejects.toThrow("marker write failed");
      expect(await repository.isMigrationComplete()).toBe(true);
      expect(storage.getItem(LEGACY_ROLLBACK_KEY)).not.toBeNull();
      expect(storage.getItem(LEGACY_CURRICULUM_V2_KEY)).not.toBeNull();

      await expect(
        migrateLegacyStorage(storage, repository, dependencies),
      ).resolves.toEqual({ status: "finalized" });
      expect(await database.progressionEvents.count()).toBe(1);
      expect(await database.milestones.count()).toBe(2);
      expect(storage.getItem(LEGACY_CURRICULUM_V2_KEY)).toBeNull();
      expect(storage.getItem(LEGACY_MIGRATION_MARKER_KEY)).not.toBeNull();
    } finally {
      repository.close();
      await database.delete();
    }
  });
});
