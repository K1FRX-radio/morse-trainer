import { z } from "zod";
import { DEFAULT_CURRICULUM_CONFIG } from "../content/curriculum-data.ts";
import { createInitialState } from "../core/curriculum.ts";
import {
  DEFAULT_SETTINGS,
  normalizeSettings,
  type PracticeSettings,
} from "../core/settings.ts";
import type { CharacterProgress, SkillProgress } from "../core/types.ts";
import type { LegacyMigrationBundle } from "./models.ts";
import { RECORD_SCHEMA_VERSION } from "./models.ts";
import { captureDateTime } from "./time.ts";

export const LEGACY_SETTINGS_KEY = "k1frx.settings.v1";
export const LEGACY_CURRICULUM_V2_KEY = "k1frx.curriculum.v2";
export const LEGACY_CURRICULUM_V1_KEY = "k1frx.curriculum.v1";
export const LEGACY_INTRODUCTIONS_KEY = "k1frx.introduced.v1";
export const LEGACY_MIGRATION_MARKER_KEY = "k1frx.legacyMigration.v1";
export const LEGACY_ROLLBACK_KEY = "k1frx.legacyRollback.v1";
export const LEGACY_MIGRATION_ID = "legacy-local-storage-v1";

const LEGACY_KEYS = [
  LEGACY_SETTINGS_KEY,
  LEGACY_CURRICULUM_V2_KEY,
  LEGACY_CURRICULUM_V1_KEY,
  LEGACY_INTRODUCTIONS_KEY,
] as const;
const utcTimestampSchema = z.string().datetime({ offset: true });

export type LegacyStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export type LegacyMigrationRepository = {
  isMigrationComplete(): Promise<boolean>;
  commitLegacyMigration(bundle: LegacyMigrationBundle): Promise<boolean>;
};

export type LegacyMigrationDependencies = {
  now?: () => Date;
  createId?: () => string;
};

type LegacySnapshot = Record<(typeof LEGACY_KEYS)[number], string | null>;

function defaultId(): string {
  if (typeof crypto === "undefined" || !crypto.randomUUID) {
    throw new Error("secure UUID generation is unavailable");
  }
  return crypto.randomUUID();
}

function readSnapshot(storage: LegacyStorage): LegacySnapshot {
  return Object.fromEntries(
    LEGACY_KEYS.map((key) => [key, storage.getItem(key)]),
  ) as LegacySnapshot;
}

function parseJson(raw: string | null): unknown {
  if (raw === null) return undefined;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function normalizeLegacySettings(raw: string | null): PracticeSettings {
  const value = objectValue(parseJson(raw));
  if (!value) return DEFAULT_SETTINGS;

  const settings: Partial<PracticeSettings> = {};
  for (const field of [
    "charWpm",
    "effectiveWpm",
    "toneHz",
    "volume",
    "noiseLevel",
  ] as const) {
    if (typeof value[field] === "number" && Number.isFinite(value[field])) {
      settings[field] = value[field];
    }
  }
  if (value.pacing === "auto" || value.pacing === "manual") {
    settings.pacing = value.pacing;
  }
  if (typeof value.continuousCopyDurationMs === "number") {
    settings.continuousCopyDurationMs = value.continuousCopyDurationMs as never;
  }
  return normalizeSettings(settings);
}

function normalizeSkill(value: unknown): SkillProgress {
  const candidate = objectValue(value);
  const recentResults = Array.isArray(candidate?.recentResults)
    ? candidate.recentResults
        .filter((result): result is boolean => typeof result === "boolean")
        .slice(-DEFAULT_CURRICULUM_CONFIG.windowSize)
    : [];
  const totalAttempts =
    typeof candidate?.totalAttempts === "number" &&
    Number.isInteger(candidate.totalAttempts) &&
    candidate.totalAttempts >= 0
      ? candidate.totalAttempts
      : 0;
  return {
    totalAttempts: Math.max(totalAttempts, recentResults.length),
    recentResults,
  };
}

function optionalTimestamp(value: unknown): string | undefined {
  return utcTimestampSchema.safeParse(value).success
    ? (value as string)
    : undefined;
}

function normalizeCurriculumCharacters(
  raw: string | null,
  migratedAt: string,
): CharacterProgress[] | undefined {
  const value = parseJson(raw);
  if (
    !Array.isArray(value) ||
    value.length < DEFAULT_CURRICULUM_CONFIG.startCount ||
    value.length > DEFAULT_CURRICULUM_CONFIG.order.length
  ) {
    return undefined;
  }

  const candidates = value.map(objectValue);
  if (
    candidates.some(
      (candidate, index) =>
        candidate?.character !== DEFAULT_CURRICULUM_CONFIG.order[index],
    )
  ) {
    return undefined;
  }

  return candidates.map((candidate, index) => {
    const mastered = index < candidates.length - 1;
    const needsReview =
      typeof candidate?.needsReview === "boolean"
        ? candidate.needsReview
        : false;
    const reviewStreak =
      needsReview &&
      typeof candidate?.reviewStreak === "number" &&
      Number.isInteger(candidate.reviewStreak) &&
      candidate.reviewStreak >= 0
        ? candidate.reviewStreak
        : 0;
    const unlockedAt = optionalTimestamp(candidate?.unlockedAt);
    const lastPracticedAt = optionalTimestamp(candidate?.lastPracticedAt);
    const existingMasteredAt = optionalTimestamp(candidate?.masteredAt);
    return {
      character: candidate?.character as string,
      state: mastered ? "mastered" : "learning",
      needsReview,
      reviewStreak,
      rx: normalizeSkill(candidate?.rx),
      tx: normalizeSkill(candidate?.tx),
      ...(unlockedAt ? { unlockedAt } : {}),
      ...(mastered ? { masteredAt: existingMasteredAt ?? migratedAt } : {}),
      ...(lastPracticedAt ? { lastPracticedAt } : {}),
    };
  });
}

function buildBundle(
  snapshot: LegacySnapshot,
  now: Date,
  createId: () => string,
): LegacyMigrationBundle {
  const updatedAt = now.toISOString();
  const occurredAt = captureDateTime(now);
  const migratedCharacters =
    normalizeCurriculumCharacters(
      snapshot[LEGACY_CURRICULUM_V2_KEY],
      updatedAt,
    ) ??
    normalizeCurriculumCharacters(
      snapshot[LEGACY_CURRICULUM_V1_KEY],
      updatedAt,
    );
  const characters =
    migratedCharacters ??
    createInitialState(DEFAULT_CURRICULUM_CONFIG, updatedAt).characters;
  const activeCharacters = characters.map((progress) => progress.character);
  const masteredCharacters = characters
    .filter((progress) => progress.state === "mastered")
    .map((progress) => progress.character);
  const introducedValue = parseJson(snapshot[LEGACY_INTRODUCTIONS_KEY]);
  const introduced = Array.isArray(introducedValue)
    ? [
        ...new Set(
          introducedValue.filter(
            (character): character is string =>
              typeof character === "string" &&
              activeCharacters.includes(character),
          ),
        ),
      ]
    : [];
  const progressionEventId =
    masteredCharacters.length > 0 ? createId() : undefined;

  return {
    settings: {
      id: "portable-settings",
      schemaVersion: RECORD_SCHEMA_VERSION,
      updatedAt,
      value: normalizeLegacySettings(snapshot[LEGACY_SETTINGS_KEY]),
    },
    curriculum: {
      id: "curriculum-state",
      schemaVersion: RECORD_SCHEMA_VERSION,
      updatedAt,
      order: [...DEFAULT_CURRICULUM_CONFIG.order],
      startCount: DEFAULT_CURRICULUM_CONFIG.startCount,
      windowSize: DEFAULT_CURRICULUM_CONFIG.windowSize,
      minNewCharObservations: DEFAULT_CURRICULUM_CONFIG.minNewCharObservations,
      reviewDecayAccuracy: DEFAULT_CURRICULUM_CONFIG.reviewDecayAccuracy,
      characters,
    },
    introductions: {
      id: "completed-introductions",
      schemaVersion: RECORD_SCHEMA_VERSION,
      updatedAt,
      characters: introduced,
    },
    progressionEvents:
      progressionEventId === undefined
        ? []
        : [
            {
              id: progressionEventId,
              schemaVersion: RECORD_SCHEMA_VERSION,
              updatedAt,
              idempotencyKey: `${LEGACY_MIGRATION_ID}:mastery`,
              type: "mastery-recorded",
              occurredAt,
              activeCharacters,
              masteredCharacters,
              migrationDerived: true,
            },
          ],
    milestones:
      progressionEventId === undefined
        ? []
        : masteredCharacters.map((character) => ({
            id: createId(),
            schemaVersion: RECORD_SCHEMA_VERSION,
            updatedAt,
            idempotencyKey: `${LEGACY_MIGRATION_ID}:mastery:${character}`,
            eventId: progressionEventId,
            type: "character-mastered" as const,
            occurredAt,
            character,
            migrationDerived: true,
          })),
    ledger: {
      id: `migration:${LEGACY_MIGRATION_ID}`,
      schemaVersion: RECORD_SCHEMA_VERSION,
      updatedAt,
      kind: "migration",
      migration: LEGACY_MIGRATION_ID,
      completedAt: updatedAt,
    },
  };
}

function finalizeLegacyStorage(
  storage: LegacyStorage,
  snapshot: LegacySnapshot,
  completedAt: string,
): void {
  if (storage.getItem(LEGACY_ROLLBACK_KEY) === null) {
    storage.setItem(
      LEGACY_ROLLBACK_KEY,
      JSON.stringify({
        format: "k1frx-legacy-rollback",
        version: 1,
        capturedAt: completedAt,
        values: Object.fromEntries(
          Object.entries(snapshot).filter(([, value]) => value !== null),
        ),
      }),
    );
  }
  storage.setItem(
    LEGACY_MIGRATION_MARKER_KEY,
    JSON.stringify({ migration: LEGACY_MIGRATION_ID, completedAt }),
  );
  for (const key of LEGACY_KEYS) storage.removeItem(key);
}

export async function migrateLegacyStorage(
  storage: LegacyStorage,
  repository: LegacyMigrationRepository,
  dependencies: LegacyMigrationDependencies = {},
): Promise<{ status: "migrated" | "finalized" | "suppressed" }> {
  const now = dependencies.now?.() ?? new Date();
  const createId = dependencies.createId ?? defaultId;
  const snapshot = readSnapshot(storage);
  const complete = await repository.isMigrationComplete();

  if (complete) {
    finalizeLegacyStorage(storage, snapshot, now.toISOString());
    return { status: "finalized" };
  }
  if (
    storage.getItem(LEGACY_MIGRATION_MARKER_KEY) !== null ||
    storage.getItem(LEGACY_ROLLBACK_KEY) !== null
  ) {
    return { status: "suppressed" };
  }

  const bundle = buildBundle(snapshot, now, createId);
  const committed = await repository.commitLegacyMigration(bundle);
  finalizeLegacyStorage(storage, snapshot, bundle.ledger.completedAt);
  return { status: committed ? "migrated" : "finalized" };
}
