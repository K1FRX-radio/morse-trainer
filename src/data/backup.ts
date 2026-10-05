import { z } from "zod";
import { DATABASE_VERSION } from "./indexeddb.ts";
import {
  RECORD_SCHEMA_VERSION,
  type CurriculumStateRecord,
  type IntroductionsRecord,
  type MigrationLedgerRecord,
  type MilestoneRecord,
  type PortableSettingsRecord,
  type ProgressionEventRecord,
  type SchemaMetadataRecord,
  type TrainingAttemptRecord,
  type TrainingSessionRecord,
} from "./models.ts";
import {
  parseCurriculumStateRecord,
  parseIntroductionsRecord,
  parseMigrationLedger,
  parseMilestoneRecord,
  parsePortableSettingsRecord,
  parseProgressionEventRecord,
  parseSchemaMetadata,
  parseTrainingAttempts,
  parseTrainingSessions,
} from "./validation.ts";

export const BACKUP_FORMAT_ID = "k1frx-portable-backup";
export const BACKUP_FORMAT_VERSION = 1;
export const BACKUP_INTEGRITY_ALGORITHM = "SHA-256";
export const BACKUP_CANONICALIZATION = "json-stable-v1";

export type PortableBackupPayload = {
  settings: PortableSettingsRecord;
  curriculum: CurriculumStateRecord;
  introductions: IntroductionsRecord;
  sessions: TrainingSessionRecord[];
  attempts: TrainingAttemptRecord[];
  progressionEvents: ProgressionEventRecord[];
  milestones: MilestoneRecord[];
  schemaMetadata: SchemaMetadataRecord;
  migrationLedgers: MigrationLedgerRecord[];
};

export type PortableBackupRecordCounts = {
  sessions: number;
  attempts: number;
  progressionEvents: number;
  milestones: number;
  migrationLedgers: number;
};

export type PortableBackupDocument = {
  format: typeof BACKUP_FORMAT_ID;
  formatVersion: typeof BACKUP_FORMAT_VERSION;
  recordSchemaVersion: typeof RECORD_SCHEMA_VERSION;
  databaseVersion: number;
  exportedAt: string;
  appVersion: string;
  counts: PortableBackupRecordCounts;
  payload: PortableBackupPayload;
  integrity: {
    algorithm: typeof BACKUP_INTEGRITY_ALGORITHM;
    canonicalization: typeof BACKUP_CANONICALIZATION;
    digestHex: string;
  };
};

export type PortableBackupPreview = {
  exportedAt: string;
  appVersion: string;
  counts: PortableBackupRecordCounts;
  unlockedCharacters: number;
  masteredCharacters: number;
  replaceConfirmation: PortableBackupReplaceConfirmation;
  sessionRange:
    | {
        firstStartedAt: string;
        lastStartedAt: string;
      }
    | undefined;
};

export type PortableBackupReplaceConfirmation = {
  targetDatasetGeneration: string;
  backupDigestHex: string;
  operationKey: string;
};

const documentHeaderSchema = z
  .object({
    format: z.string(),
    formatVersion: z.number().int().positive(),
    recordSchemaVersion: z.number().int().positive(),
    databaseVersion: z.number().int().positive(),
    exportedAt: z.string().datetime({ offset: true }),
    appVersion: z.string().min(1),
    counts: z
      .object({
        sessions: z.number().int().nonnegative(),
        attempts: z.number().int().nonnegative(),
        progressionEvents: z.number().int().nonnegative(),
        milestones: z.number().int().nonnegative(),
        migrationLedgers: z.number().int().nonnegative(),
      })
      .strict(),
    payload: z.unknown(),
    integrity: z
      .object({
        algorithm: z.string(),
        canonicalization: z.string(),
        digestHex: z.string().regex(/^[a-f0-9]{64}$/i),
      })
      .strict(),
  })
  .strict();

const rawPayloadSchema = z
  .object({
    settings: z.unknown(),
    curriculum: z.unknown(),
    introductions: z.unknown(),
    sessions: z.array(z.unknown()),
    attempts: z.array(z.unknown()),
    progressionEvents: z.array(z.unknown()),
    milestones: z.array(z.unknown()),
    schemaMetadata: z.unknown(),
    migrationLedgers: z.array(z.unknown()),
  })
  .strict();

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalize(entry)).join(",")}]`;
  }
  const object = value as Record<string, unknown>;
  const keys = Object.keys(object).sort();
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${canonicalize(object[key])}`)
    .join(",")}}`;
}

async function sha256Hex(value: string): Promise<string> {
  if (typeof crypto === "undefined" || !crypto.subtle) {
    throw new Error("crypto.subtle is unavailable for backup integrity");
  }
  const bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function parsePayload(value: unknown): PortableBackupPayload {
  const payload = value as Record<string, unknown>;
  const parsed: PortableBackupPayload = {
    settings: parsePortableSettingsRecord(payload.settings),
    curriculum: parseCurriculumStateRecord(payload.curriculum),
    introductions: parseIntroductionsRecord(payload.introductions),
    sessions: parseTrainingSessions(payload.sessions),
    attempts: parseTrainingAttempts(payload.attempts),
    progressionEvents: z
      .array(z.unknown())
      .parse(payload.progressionEvents)
      .map((row) => parseProgressionEventRecord(row)),
    milestones: z
      .array(z.unknown())
      .parse(payload.milestones)
      .map((row) => parseMilestoneRecord(row)),
    schemaMetadata: parseSchemaMetadata(payload.schemaMetadata),
    migrationLedgers: z
      .array(z.unknown())
      .parse(payload.migrationLedgers)
      .map((row) => parseMigrationLedger(row)),
  };

  const progressionIds = new Set<string>();
  const progressionKeys = new Set<string>();
  for (const event of parsed.progressionEvents) {
    if (progressionIds.has(event.id)) {
      throw new Error(`duplicate progression event id ${event.id}`);
    }
    if (progressionKeys.has(event.idempotencyKey)) {
      throw new Error(
        `duplicate progression event key ${event.idempotencyKey}`,
      );
    }
    progressionIds.add(event.id);
    progressionKeys.add(event.idempotencyKey);
  }

  const milestoneIds = new Set<string>();
  const milestoneKeys = new Set<string>();
  for (const milestone of parsed.milestones) {
    if (milestoneIds.has(milestone.id)) {
      throw new Error(`duplicate milestone id ${milestone.id}`);
    }
    if (milestoneKeys.has(milestone.idempotencyKey)) {
      throw new Error(`duplicate milestone key ${milestone.idempotencyKey}`);
    }
    if (!progressionIds.has(milestone.eventId)) {
      throw new Error(
        `milestone references unknown event ${milestone.eventId}`,
      );
    }
    milestoneIds.add(milestone.id);
    milestoneKeys.add(milestone.idempotencyKey);
  }

  return parsed;
}

function rawPayloadRecordCounts(payload: unknown): PortableBackupRecordCounts {
  const parsed = rawPayloadSchema.parse(payload);
  return {
    sessions: parsed.sessions.length,
    attempts: parsed.attempts.length,
    progressionEvents: parsed.progressionEvents.length,
    milestones: parsed.milestones.length,
    migrationLedgers: parsed.migrationLedgers.length,
  };
}

export function countPortableBackupRecords(
  payload: PortableBackupPayload,
): PortableBackupRecordCounts {
  return {
    sessions: payload.sessions.length,
    attempts: payload.attempts.length,
    progressionEvents: payload.progressionEvents.length,
    milestones: payload.milestones.length,
    migrationLedgers: payload.migrationLedgers.length,
  };
}

export async function createPortableBackupDocument(options: {
  appVersion: string;
  databaseVersion: number;
  exportedAt: string;
  payload: PortableBackupPayload;
}): Promise<PortableBackupDocument> {
  const counts = countPortableBackupRecords(options.payload);
  const digestHex = await sha256Hex(canonicalize(options.payload));
  return {
    format: BACKUP_FORMAT_ID,
    formatVersion: BACKUP_FORMAT_VERSION,
    recordSchemaVersion: RECORD_SCHEMA_VERSION,
    databaseVersion: options.databaseVersion,
    exportedAt: options.exportedAt,
    appVersion: options.appVersion,
    counts,
    payload: options.payload,
    integrity: {
      algorithm: BACKUP_INTEGRITY_ALGORITHM,
      canonicalization: BACKUP_CANONICALIZATION,
      digestHex,
    },
  };
}

export async function parsePortableBackupDocument(
  raw: unknown,
): Promise<PortableBackupDocument> {
  const header = documentHeaderSchema.parse(raw);
  if (header.format !== BACKUP_FORMAT_ID) {
    throw new Error("unsupported backup format identifier");
  }
  if (header.formatVersion > BACKUP_FORMAT_VERSION) {
    throw new Error("backup format version is newer than supported");
  }
  if (header.formatVersion !== BACKUP_FORMAT_VERSION) {
    throw new Error("backup format version is unsupported");
  }
  if (header.recordSchemaVersion > RECORD_SCHEMA_VERSION) {
    throw new Error("backup record schema version is newer than supported");
  }
  if (header.recordSchemaVersion !== RECORD_SCHEMA_VERSION) {
    throw new Error("backup record schema version is unsupported");
  }
  if (header.databaseVersion > DATABASE_VERSION) {
    throw new Error("backup database version is newer than supported");
  }
  if (header.integrity.algorithm !== BACKUP_INTEGRITY_ALGORITHM) {
    throw new Error("backup integrity algorithm is unsupported");
  }
  if (header.integrity.canonicalization !== BACKUP_CANONICALIZATION) {
    throw new Error("backup canonicalization is unsupported");
  }

  const counts = rawPayloadRecordCounts(header.payload);
  if (JSON.stringify(counts) !== JSON.stringify(header.counts)) {
    throw new Error("backup record counts do not match payload");
  }

  const expectedDigest = await sha256Hex(canonicalize(header.payload));
  if (
    expectedDigest.toLowerCase() !== header.integrity.digestHex.toLowerCase()
  ) {
    throw new Error("backup integrity digest does not match payload");
  }

  const payload = parsePayload(header.payload);

  return {
    format: BACKUP_FORMAT_ID,
    formatVersion: BACKUP_FORMAT_VERSION,
    recordSchemaVersion: RECORD_SCHEMA_VERSION,
    databaseVersion: header.databaseVersion,
    exportedAt: header.exportedAt,
    appVersion: header.appVersion,
    counts,
    payload,
    integrity: {
      algorithm: BACKUP_INTEGRITY_ALGORITHM,
      canonicalization: BACKUP_CANONICALIZATION,
      digestHex: header.integrity.digestHex.toLowerCase(),
    },
  };
}

export async function parsePortableBackupJson(
  json: string,
): Promise<PortableBackupDocument> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json) as unknown;
  } catch {
    throw new Error("backup JSON is malformed");
  }
  return parsePortableBackupDocument(parsed);
}

export async function createReplaceImportConfirmation(options: {
  backupDigestHex: string;
  targetDatasetGeneration: string;
}): Promise<PortableBackupReplaceConfirmation> {
  const operationKey = await sha256Hex(
    `${options.backupDigestHex}:${options.targetDatasetGeneration}`,
  );
  return {
    targetDatasetGeneration: options.targetDatasetGeneration,
    backupDigestHex: options.backupDigestHex,
    operationKey,
  };
}

export function summarizePortableBackup(
  backup: PortableBackupDocument,
  replaceConfirmation: PortableBackupReplaceConfirmation,
): PortableBackupPreview {
  const startedAtValues = backup.payload.sessions
    .map((session) => session.startedAt.utc)
    .sort((left, right) => left.localeCompare(right));
  const mastered = backup.payload.curriculum.characters.filter(
    (character) => character.state === "mastered",
  ).length;

  return {
    exportedAt: backup.exportedAt,
    appVersion: backup.appVersion,
    counts: backup.counts,
    unlockedCharacters: backup.payload.curriculum.characters.length,
    masteredCharacters: mastered,
    replaceConfirmation,
    sessionRange:
      startedAtValues.length === 0
        ? undefined
        : {
            firstStartedAt: startedAtValues[0],
            lastStartedAt: startedAtValues[startedAtValues.length - 1],
          },
  };
}
