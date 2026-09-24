import Dexie, { type Table, type Transaction } from "dexie";
import type {
  CharacterProjectionRecord,
  ConfusionProjectionRecord,
  CurriculumStateRecord,
  DailyProjectionRecord,
  IntroductionsRecord,
  MetadataRecord,
  MilestoneRecord,
  PortableSettingsRecord,
  ProgressionEventRecord,
  TrainingAttemptRecord,
  TrainingSessionRecord,
} from "./models.ts";
import { buildProjectionRows } from "./projections.ts";
import { parseTrainingAttempts, parseTrainingSessions } from "./validation.ts";

export const DATABASE_NAME = "k1frx-morse-trainer";
export const DATABASE_VERSION = 2;

export const SCHEMA_V1 = {
  metadata: "&id, schemaVersion, updatedAt, kind, migration, operation",
  settings: "&id, schemaVersion, updatedAt",
  curriculum: "&id, schemaVersion, updatedAt",
  introductions: "&id, schemaVersion, updatedAt",
  sessions:
    "&id, status, startedAt.utc, startedAt.localDate, mode, source, updatedAt, [status+updatedAt]",
  attempts:
    "&id, sessionId, occurredAt.utc, occurredAt.localDate, direction, source, updatedAt, [sessionId+occurredAt.utc], [direction+occurredAt.utc], [source+occurredAt.utc]",
  progressionEvents:
    "&id, &idempotencyKey, type, occurredAt.utc, sessionId, updatedAt",
  milestones: "&id, &idempotencyKey, type, occurredAt.utc, eventId, updatedAt",
} as const;

export const SCHEMA_V2 = {
  ...SCHEMA_V1,
  dailyProjections: "&id, &localDate, projectionVersion, updatedAt",
  characterProjections:
    "&id, [character+direction], character, direction, projectionVersion, updatedAt",
  confusionProjections:
    "&id, [target+answer], target, answer, count, projectionVersion, updatedAt",
} as const;

export type TrainerDatabaseOptions = {
  name?: string;
  indexedDB?: IDBFactory;
  IDBKeyRange?: typeof IDBKeyRange;
  now?: () => Date;
};

export class TrainerDatabase extends Dexie {
  metadata!: Table<MetadataRecord, string>;
  settings!: Table<PortableSettingsRecord, string>;
  curriculum!: Table<CurriculumStateRecord, string>;
  introductions!: Table<IntroductionsRecord, string>;
  sessions!: Table<TrainingSessionRecord, string>;
  attempts!: Table<TrainingAttemptRecord, string>;
  progressionEvents!: Table<ProgressionEventRecord, string>;
  milestones!: Table<MilestoneRecord, string>;
  dailyProjections!: Table<DailyProjectionRecord, string>;
  characterProjections!: Table<CharacterProjectionRecord, string>;
  confusionProjections!: Table<ConfusionProjectionRecord, string>;

  private readonly clock: () => Date;

  constructor(options: TrainerDatabaseOptions = {}) {
    const dependencies =
      options.indexedDB && options.IDBKeyRange
        ? {
            indexedDB: options.indexedDB,
            IDBKeyRange: options.IDBKeyRange,
          }
        : undefined;
    super(options.name ?? DATABASE_NAME, dependencies);
    this.clock = options.now ?? (() => new Date());

    this.version(1).stores(SCHEMA_V1);
    this.version(2)
      .stores(SCHEMA_V2)
      .upgrade((transaction) => this.upgradeToVersion2(transaction));
  }

  private async upgradeToVersion2(transaction: Transaction): Promise<void> {
    const sessions = parseTrainingSessions(
      await transaction
        .table<TrainingSessionRecord, string>("sessions")
        .toArray(),
    );
    const attempts = parseTrainingAttempts(
      await transaction
        .table<TrainingAttemptRecord, string>("attempts")
        .toArray(),
    );
    const rows = buildProjectionRows(
      sessions,
      attempts,
      this.clock().toISOString(),
    );

    await transaction
      .table<DailyProjectionRecord, string>("dailyProjections")
      .bulkPut(rows.daily);
    await transaction
      .table<CharacterProjectionRecord, string>("characterProjections")
      .bulkPut(rows.characters);
    await transaction
      .table<ConfusionProjectionRecord, string>("confusionProjections")
      .bulkPut(rows.confusions);
  }
}
