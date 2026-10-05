import { DEFAULT_SETTINGS } from "../core/settings.ts";
import { DEFAULT_CURRICULUM_CONFIG } from "../content/curriculum-data.ts";
import { createInitialState } from "../core/curriculum.ts";
import { LEGACY_SETTINGS_KEY, type LegacyStorage } from "./legacy-migration.ts";
import type {
  LegacyMigrationBundle,
  CurriculumStateRecord,
  IntroductionsRecord,
  PortableSettingsRecord,
} from "./models.ts";
import { bootstrapTrainingData } from "./bootstrap.ts";

function memoryStorage(initial: Record<string, string> = {}): LegacyStorage {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

describe("bootstrapTrainingData", () => {
  it("opens, migrates, recovers, and loads portable settings in order", async () => {
    const calls: string[] = [];
    let settings: PortableSettingsRecord | undefined;
    let curriculum: CurriculumStateRecord | undefined;
    let introductions: IntroductionsRecord | undefined;
    const repository = {
      open: async () => {
        calls.push("open");
      },
      isMigrationComplete: async () => {
        calls.push("migration-check");
        return false;
      },
      commitLegacyMigration: async (bundle: LegacyMigrationBundle) => {
        calls.push("migration-commit");
        settings = bundle.settings;
        curriculum = bundle.curriculum;
        introductions = bundle.introductions;
        return true;
      },
      recoverInterruptedSessions: async () => {
        calls.push("recover");
        return [{ id: "recovered-session" }];
      },
      getPortableSettings: async () => {
        calls.push("settings-get");
        return settings;
      },
      savePortableSettings: async () => {
        calls.push("settings-save");
        throw new Error("migrated settings should already exist");
      },
      getCurriculumState: async () => curriculum,
      saveCurriculumState: async () => {
        throw new Error("migrated curriculum should already exist");
      },
      getIntroductions: async () => introductions,
      saveIntroductions: async () => {
        throw new Error("migrated introductions should already exist");
      },
    };
    const storage = memoryStorage({
      [LEGACY_SETTINGS_KEY]: JSON.stringify({ charWpm: 18 }),
    });

    await expect(bootstrapTrainingData(storage, repository)).resolves.toEqual({
      settings: { ...DEFAULT_SETTINGS, charWpm: 20 },
      curriculum: {
        config: DEFAULT_CURRICULUM_CONFIG,
        characters: expect.any(Array),
      },
      introductions: [],
      recoveredSessionCount: 1,
    });
    expect(calls).toEqual([
      "open",
      "migration-check",
      "migration-commit",
      "recover",
      "settings-get",
    ]);
    expect(storage.getItem(LEGACY_SETTINGS_KEY)).toBeNull();
  });

  it("creates defaults when a suppressed migration left no settings", async () => {
    const calls: string[] = [];
    const defaultRecord: PortableSettingsRecord = {
      id: "portable-settings",
      schemaVersion: 1,
      updatedAt: "2026-09-24T18:00:00.000Z",
      value: DEFAULT_SETTINGS,
    };
    const defaultCurriculum = createInitialState(DEFAULT_CURRICULUM_CONFIG);
    const curriculumRecord: CurriculumStateRecord = {
      id: "curriculum-state",
      schemaVersion: 1,
      updatedAt: "2026-09-24T18:00:00.000Z",
      ...defaultCurriculum.config,
      order: [...defaultCurriculum.config.order],
      characters: defaultCurriculum.characters,
    };
    const introductionsRecord: IntroductionsRecord = {
      id: "completed-introductions",
      schemaVersion: 1,
      updatedAt: "2026-09-24T18:00:00.000Z",
      characters: [],
    };
    const repository = {
      open: async () => undefined,
      isMigrationComplete: async () => false,
      commitLegacyMigration: async () => {
        throw new Error("suppressed migration must not commit");
      },
      recoverInterruptedSessions: async () => [],
      getPortableSettings: async () => undefined,
      savePortableSettings: async () => {
        calls.push("settings-save");
        return defaultRecord;
      },
      getCurriculumState: async () => undefined,
      saveCurriculumState: async () => {
        calls.push("curriculum-save");
        return curriculumRecord;
      },
      getIntroductions: async () => undefined,
      saveIntroductions: async () => {
        calls.push("introductions-save");
        return introductionsRecord;
      },
    };
    const storage = memoryStorage({
      "k1frx.legacyRollback.v1": "{}",
    });

    await expect(bootstrapTrainingData(storage, repository)).resolves.toEqual({
      settings: DEFAULT_SETTINGS,
      curriculum: defaultCurriculum,
      introductions: [],
      recoveredSessionCount: 0,
    });
    expect(calls).toEqual([
      "settings-save",
      "curriculum-save",
      "introductions-save",
    ]);
  });

  it("normalizes and persists existing non-canonical settings before use", async () => {
    const calls: string[] = [];
    const existingSettings: PortableSettingsRecord = {
      id: "portable-settings",
      schemaVersion: 1,
      updatedAt: "2026-09-24T18:00:00.000Z",
      value: { ...DEFAULT_SETTINGS, charWpm: 18, effectiveWpm: 11 },
    };
    const defaultCurriculum = createInitialState(DEFAULT_CURRICULUM_CONFIG);
    const curriculumRecord: CurriculumStateRecord = {
      id: "curriculum-state",
      schemaVersion: 1,
      updatedAt: "2026-09-24T18:00:00.000Z",
      ...defaultCurriculum.config,
      order: [...defaultCurriculum.config.order],
      characters: defaultCurriculum.characters,
    };
    const introductionsRecord: IntroductionsRecord = {
      id: "completed-introductions",
      schemaVersion: 1,
      updatedAt: "2026-09-24T18:00:00.000Z",
      characters: [],
    };
    const repository = {
      open: async () => undefined,
      isMigrationComplete: async () => true,
      commitLegacyMigration: async () => {
        throw new Error("completed migration must not run");
      },
      recoverInterruptedSessions: async () => [],
      getPortableSettings: async () => {
        calls.push("settings-get");
        return existingSettings;
      },
      savePortableSettings: async (
        settings: PortableSettingsRecord["value"],
      ) => {
        calls.push("settings-save");
        expect(settings).toEqual({
          ...DEFAULT_SETTINGS,
          charWpm: 20,
          effectiveWpm: 10,
        });
        return {
          ...existingSettings,
          updatedAt: "2026-09-24T18:01:00.000Z",
          value: settings,
        };
      },
      getCurriculumState: async () => curriculumRecord,
      saveCurriculumState: async () => {
        throw new Error("existing curriculum should be reused");
      },
      getIntroductions: async () => introductionsRecord,
      saveIntroductions: async () => {
        throw new Error("existing introductions should be reused");
      },
    };

    await expect(
      bootstrapTrainingData(memoryStorage(), repository),
    ).resolves.toEqual({
      settings: { ...DEFAULT_SETTINGS, charWpm: 20, effectiveWpm: 10 },
      curriculum: defaultCurriculum,
      introductions: [],
      recoveredSessionCount: 0,
    });
    expect(calls).toEqual(["settings-get", "settings-save"]);
  });
});
