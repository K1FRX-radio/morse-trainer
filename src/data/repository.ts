import { DATABASE_VERSION, TrainerDatabase } from "./indexeddb.ts";
import { DEFAULT_CURRICULUM_CONFIG } from "../content/curriculum-data.ts";
import type {
  PracticeSettings,
  SpeedSuggestionAfterAttempts,
} from "../core/settings.ts";
import type { CurriculumState } from "../core/curriculum.ts";
import { createInitialState } from "../core/curriculum.ts";
import { DEFAULT_SETTINGS, normalizeSettings } from "../core/settings.ts";
import {
  applyAdvancementTransition,
  evaluateAdvancementEvidence,
} from "../training/advancement.ts";
import {
  LEGACY_MIGRATION_ID,
  type LegacyMigrationRepository,
} from "./legacy-migration.ts";
import {
  RECORD_SCHEMA_VERSION,
  type AttemptDirection,
  type CharacterProjectionRecord,
  type ConfusionProjectionRecord,
  type CurriculumStateRecord,
  type DailyProjectionRecord,
  type IntroductionsRecord,
  type LegacyMigrationBundle,
  type MigrationLedgerRecord,
  type MilestoneRecord,
  type OperationLedgerRecord,
  type PortableSettingsRecord,
  type ProgressionEventRecord,
  type SchemaMetadataRecord,
  type TrainingAttemptRecord,
  type TrainingSessionRecord,
} from "./models.ts";
import { buildProjectionRows } from "./projections.ts";
import { captureDateTime } from "./time.ts";
import {
  classifyRetryHistory,
  type RetryClassification,
  type RetryCounterIdentity,
} from "./retry-history.ts";
import {
  createReplaceImportConfirmation,
  createPortableBackupDocument,
  parsePortableBackupJson,
  summarizePortableBackup,
  type PortableBackupDocument,
  type PortableBackupReplaceConfirmation,
  type PortableBackupPreview,
} from "./backup.ts";
import {
  parseCurriculumStateRecord,
  parseCharacterProjectionRecord,
  parseConfusionProjectionRecord,
  parseDailyProjectionRecord,
  parseIntroductionsRecord,
  parseLegacyMigrationBundle,
  parseMigrationLedger,
  parseMilestoneRecord,
  parsePortableSettingsRecord,
  parseProgressionEventRecord,
  parseSchemaMetadata,
  parseTrainingAttempt,
  parseTrainingDataset,
  parseTrainingSession,
} from "./validation.ts";
import { isValidSessionRecord } from "./session-validity-policy.ts";

export type RepositoryDependencies = {
  now?: () => Date;
  createId?: () => string;
};

export type PersistenceResult<T extends object = object> = {
  committed: boolean;
  session: TrainingSessionRecord;
} & T;

type BaseAttemptCommit = {
  expectedSessionRevision: number;
  session: TrainingSessionRecord;
  attempt: TrainingAttemptRecord;
};

export type LearnAttemptCommit = BaseAttemptCommit & {
  curriculum?: CurriculumStateRecord;
  introductions?: IntroductionsRecord;
};

export type PracticeAttemptCommit = BaseAttemptCommit;

export type AdvancementCommit = {
  sessionId: string;
  evidenceAttemptId: string;
  idempotencyKey: string;
  activeCharacters: string[];
  type: "character-unlocked" | "curriculum-completed";
  unlockedCharacter?: string;
};

export type AdvancementResult = {
  committed: boolean;
  event: ProgressionEventRecord;
  curriculum: CurriculumStateRecord;
};

export type DailyProjectionQuery = {
  fromLocalDate: string;
  toLocalDate: string;
  limit: number;
};

export type DashboardAggregateQuery = {
  toLocalDate: string;
};

export type DashboardAggregateRecord = {
  totalActiveMs: number;
  totalSessions: number;
  totalAttempts: number;
  rxCorrect: number;
  rxTotal: number;
  txCorrect: number;
  txTotal: number;
  effectiveWpmTotal: number;
  effectiveWpmSamples: number;
  activeDayCount: number;
  todayActiveMs: number;
  todaySessionCount: number;
  thisWeekActiveMs: number;
  thisWeekSessionCount: number;
  practiceDayCount: number;
  currentStreakDays: number;
  longestStreakDays: number;
};

export type CharacterProjectionQuery = {
  direction: AttemptDirection;
  character?: string;
  limit: number;
};

export type ConfusionProjectionQuery = {
  limit: number;
};

export type MilestoneQuery = {
  limit: number;
};

type SharedAttemptCommit = BaseAttemptCommit & {
  curriculum?: CurriculumStateRecord;
  introductions?: IntroductionsRecord;
};

const PROHIBITED_PRACTICE_COMMIT_FIELDS = [
  "curriculum",
  "introductions",
  "progressionEvents",
  "milestones",
  "advancement",
  "mastery",
] as const;

const MAX_PROJECTION_QUERY_LIMIT = 500;
const LOCAL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export interface TrainingDataRepository extends LegacyMigrationRepository {
  open(): Promise<SchemaMetadataRecord>;
  close(): void;
  createSession(session: TrainingSessionRecord): Promise<PersistenceResult>;
  getPortableSettings(): Promise<PortableSettingsRecord | undefined>;
  savePortableSettings(
    settings: PracticeSettings,
  ): Promise<PortableSettingsRecord>;
  getCurriculumState(): Promise<CurriculumStateRecord | undefined>;
  saveCurriculumState(state: CurriculumState): Promise<CurriculumStateRecord>;
  getIntroductions(): Promise<IntroductionsRecord | undefined>;
  saveIntroductions(characters: string[]): Promise<IntroductionsRecord>;
  acceptAdvancement(commit: AdvancementCommit): Promise<AdvancementResult>;
  commitLearnAttempt(
    commit: LearnAttemptCommit,
  ): Promise<PersistenceResult<{ attempt: TrainingAttemptRecord }>>;
  commitPracticeAttempt(
    commit: PracticeAttemptCommit,
  ): Promise<PersistenceResult<{ attempt: TrainingAttemptRecord }>>;
  finalizeSession(
    session: TrainingSessionRecord,
    expectedRevision: number,
  ): Promise<PersistenceResult>;
  interruptSession(
    session: TrainingSessionRecord,
    expectedRevision: number,
  ): Promise<PersistenceResult>;
  renewSessionLease(
    sessionId: string,
    ownerTabId: string,
    expectedRevision: number,
    expiresAt: string,
  ): Promise<TrainingSessionRecord>;
  recoverInterruptedSessions(): Promise<TrainingSessionRecord[]>;
  getRetryClassification(
    identity: RetryCounterIdentity,
    threshold: SpeedSuggestionAfterAttempts,
  ): Promise<RetryClassification>;
  listDailyProjections(
    query: DailyProjectionQuery,
  ): Promise<DailyProjectionRecord[]>;
  getDashboardAggregate(
    query: DashboardAggregateQuery,
  ): Promise<DashboardAggregateRecord>;
  listCharacterProjections(
    query: CharacterProjectionQuery,
  ): Promise<CharacterProjectionRecord[]>;
  listConfusionProjections(
    query: ConfusionProjectionQuery,
  ): Promise<ConfusionProjectionRecord[]>;
  listMilestones(query: MilestoneQuery): Promise<MilestoneRecord[]>;
  rebuildProjections(): Promise<void>;
  exportPortableBackup(appVersion: string): Promise<PortableBackupDocument>;
  previewPortableBackup(rawJson: string): Promise<PortableBackupPreview>;
  replacePortableBackup(
    rawJson: string,
    confirmation: PortableBackupReplaceConfirmation,
  ): Promise<"applied" | "already-applied">;
  resetPortableData(): Promise<void>;
}

export { MAX_PROJECTION_QUERY_LIMIT };

function defaultId(): string {
  if (typeof crypto === "undefined" || !crypto.randomUUID) {
    throw new Error("secure UUID generation is unavailable");
  }
  return crypto.randomUUID();
}

function recordsEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function assertNoPracticeProgressionData(commit: PracticeAttemptCommit): void {
  const payload = commit as PracticeAttemptCommit & Record<string, unknown>;
  const prohibitedField = PROHIBITED_PRACTICE_COMMIT_FIELDS.find((field) =>
    Object.prototype.hasOwnProperty.call(payload, field),
  );
  if (prohibitedField !== undefined) {
    throw new Error(`practice commits cannot include ${prohibitedField}`);
  }
}

function instant(value: string, label: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new RangeError(`${label} must be a valid timestamp`);
  }
  return parsed;
}

function assertLocalDate(value: string, label: string): void {
  if (!LOCAL_DATE_PATTERN.test(value)) {
    throw new RangeError(`${label} must be in YYYY-MM-DD format`);
  }
}

function dateFromLocalDate(localDate: string): Date {
  const [year, month, day] = localDate.split("-").map((value) => Number(value));
  if (
    !Number.isFinite(year) ||
    !Number.isFinite(month) ||
    !Number.isFinite(day)
  ) {
    throw new RangeError(`invalid local date ${localDate}`);
  }
  return new Date(Date.UTC(year, month - 1, day));
}

function toLocalDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function previousLocalDate(localDate: string): string {
  const date = dateFromLocalDate(localDate);
  date.setUTCDate(date.getUTCDate() - 1);
  return toLocalDate(date);
}

function startOfWeekLocalDate(localDate: string): string {
  const date = dateFromLocalDate(localDate);
  const dayOfWeek = date.getUTCDay();
  const daysFromMonday = (dayOfWeek + 6) % 7;
  date.setUTCDate(date.getUTCDate() - daysFromMonday);
  return toLocalDate(date);
}

function isPracticeDay(row: DailyProjectionRecord): boolean {
  return row.activeMs >= 30_000 && row.attemptCount > 0;
}

function assertBoundedLimit(limit: number, label = "limit"): void {
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new RangeError(`${label} must be a positive integer`);
  }
  if (limit > MAX_PROJECTION_QUERY_LIMIT) {
    throw new RangeError(
      `${label} must be at most ${MAX_PROJECTION_QUERY_LIMIT}`,
    );
  }
}

function laterTimestamp(left: string, right: string): string {
  return instant(left, "timestamp") >= instant(right, "timestamp")
    ? left
    : right;
}

function hasExpiredLease(
  session: TrainingSessionRecord,
  nowMs: number,
): boolean {
  return (
    session.leaseExpiresAt === undefined ||
    instant(session.leaseExpiresAt, "lease expiration") <= nowMs
  );
}

function assertSessionIdentity(
  current: TrainingSessionRecord,
  next: TrainingSessionRecord,
): void {
  if (
    current.id !== next.id ||
    current.source !== next.source ||
    current.mode !== next.mode ||
    current.appVersion !== next.appVersion ||
    !recordsEqual(current.startedAt, next.startedAt) ||
    !recordsEqual(current.unlockedAtStart, next.unlockedAtStart)
  ) {
    throw new Error("session identity fields cannot change");
  }
  if (next.activeMs < current.activeMs) {
    throw new Error("session active time cannot decrease");
  }
  if (next.completedCards < current.completedCards) {
    throw new Error("session completed-card count cannot decrease");
  }
  if (next.updatedAt < current.updatedAt) {
    throw new Error("session updatedAt cannot move backward");
  }
}

function curriculumRecord(
  state: CurriculumState,
  updatedAt: string,
): CurriculumStateRecord {
  return parseCurriculumStateRecord({
    id: "curriculum-state",
    schemaVersion: RECORD_SCHEMA_VERSION,
    updatedAt,
    order: [...state.config.order],
    startCount: state.config.startCount,
    windowSize: state.config.windowSize,
    minNewCharObservations: state.config.minNewCharObservations,
    reviewDecayAccuracy: state.config.reviewDecayAccuracy,
    characters: structuredClone(state.characters),
  });
}

function curriculumState(record: CurriculumStateRecord): CurriculumState {
  return {
    config: {
      order: [...record.order],
      startCount: record.startCount,
      windowSize: record.windowSize,
      minNewCharObservations: record.minNewCharObservations,
      reviewDecayAccuracy: record.reviewDecayAccuracy,
    },
    characters: structuredClone(record.characters),
  };
}

export class DexieTrainingRepository implements TrainingDataRepository {
  private readonly now: () => Date;
  private readonly createId: () => string;

  constructor(
    readonly database: TrainerDatabase,
    dependencies: RepositoryDependencies = {},
  ) {
    this.now = dependencies.now ?? (() => new Date());
    this.createId = dependencies.createId ?? defaultId;
  }

  async open(): Promise<SchemaMetadataRecord> {
    await this.database.open();
    const metadata = await this.database.transaction(
      "rw",
      this.database.metadata,
      async () => {
        const existing = await this.database.metadata.get("schema-metadata");
        const updatedAt = this.now().toISOString();
        if (existing !== undefined) {
          const metadata = parseSchemaMetadata(existing);
          if (metadata.databaseVersion > DATABASE_VERSION) {
            throw new Error(
              `database metadata version ${metadata.databaseVersion} is newer than supported version ${DATABASE_VERSION}`,
            );
          }
          if (metadata.databaseVersion === DATABASE_VERSION) return metadata;

          const reconciled: SchemaMetadataRecord = {
            ...metadata,
            updatedAt,
            databaseVersion: DATABASE_VERSION,
          };
          await this.database.metadata.put(reconciled);
          return reconciled;
        }

        const metadata: SchemaMetadataRecord = {
          id: "schema-metadata",
          schemaVersion: RECORD_SCHEMA_VERSION,
          updatedAt,
          databaseVersion: DATABASE_VERSION,
          datasetGeneration: this.createId(),
        };
        await this.database.metadata.put(metadata);
        return metadata;
      },
    );

    await this.rebuildStaleCharacterProjections();
    return metadata;
  }

  private async rebuildStaleCharacterProjections(): Promise<void> {
    const rxRows = await this.database.characterProjections
      .where("direction")
      .equals("rx")
      .toArray();

    if (rxRows.length === 0) return;

    const stale = rxRows.some(
      (row) =>
        parseCharacterProjectionRecord(structuredClone(row))
          .recentIsolatedRxResponseMs === undefined,
    );

    if (stale) {
      await this.rebuildProjections();
    }
  }

  close(): void {
    this.database.close();
  }

  async createSession(
    value: TrainingSessionRecord,
  ): Promise<PersistenceResult> {
    const session = parseTrainingSession(value);
    if (
      session.status !== "active" ||
      session.revision !== 0 ||
      session.attemptCount !== 0
    ) {
      throw new Error(
        "new sessions must be active at revision zero with no attempts",
      );
    }
    return this.database.transaction("rw", this.database.sessions, async () => {
      const existing = await this.database.sessions.get(session.id);
      if (existing !== undefined) {
        if (!recordsEqual(existing, session)) {
          throw new Error("session ID already exists with different data");
        }
        return { session: parseTrainingSession(existing), committed: false };
      }
      await this.database.sessions.add(session);
      return { session, committed: true };
    });
  }

  async getPortableSettings(): Promise<PortableSettingsRecord | undefined> {
    const record = await this.database.settings.get("portable-settings");
    return record === undefined
      ? undefined
      : parsePortableSettingsRecord(record);
  }

  async savePortableSettings(
    settings: PracticeSettings,
  ): Promise<PortableSettingsRecord> {
    const canonicalSettings = normalizeSettings(settings);
    return this.database.transaction("rw", this.database.settings, async () => {
      const existing = await this.database.settings.get("portable-settings");
      const record = parsePortableSettingsRecord({
        id: "portable-settings",
        schemaVersion: RECORD_SCHEMA_VERSION,
        updatedAt:
          existing === undefined
            ? this.now().toISOString()
            : laterTimestamp(
                parsePortableSettingsRecord(existing).updatedAt,
                this.now().toISOString(),
              ),
        value: canonicalSettings,
      });
      await this.database.settings.put(record);
      return record;
    });
  }

  async getCurriculumState(): Promise<CurriculumStateRecord | undefined> {
    const record = await this.database.curriculum.get("curriculum-state");
    return record === undefined
      ? undefined
      : parseCurriculumStateRecord(record);
  }

  async saveCurriculumState(
    state: CurriculumState,
  ): Promise<CurriculumStateRecord> {
    return this.database.transaction(
      "rw",
      this.database.curriculum,
      async () => {
        const existing = await this.database.curriculum.get("curriculum-state");
        const record = parseCurriculumStateRecord({
          id: "curriculum-state",
          schemaVersion: RECORD_SCHEMA_VERSION,
          updatedAt:
            existing === undefined
              ? this.now().toISOString()
              : laterTimestamp(
                  parseCurriculumStateRecord(existing).updatedAt,
                  this.now().toISOString(),
                ),
          order: [...state.config.order],
          startCount: state.config.startCount,
          windowSize: state.config.windowSize,
          minNewCharObservations: state.config.minNewCharObservations,
          reviewDecayAccuracy: state.config.reviewDecayAccuracy,
          characters: state.characters,
        });
        await this.database.curriculum.put(record);
        return record;
      },
    );
  }

  async acceptAdvancement(
    commit: AdvancementCommit,
  ): Promise<AdvancementResult> {
    if (commit.idempotencyKey.length === 0) {
      throw new Error("advancement idempotency key cannot be empty");
    }
    const operationId = `operation:${commit.idempotencyKey}`;

    return this.database.transaction(
      "rw",
      [
        this.database.metadata,
        this.database.curriculum,
        this.database.sessions,
        this.database.attempts,
        this.database.progressionEvents,
        this.database.milestones,
      ],
      async () => {
        const existingOperation = await this.database.metadata.get(operationId);
        if (existingOperation !== undefined) {
          if (
            !("operation" in existingOperation) ||
            existingOperation.operation !== "accept-advancement" ||
            existingOperation.idempotencyKey !== commit.idempotencyKey ||
            existingOperation.resultRecordId === undefined
          ) {
            throw new Error("advancement idempotency key is already in use");
          }
          const existingEvent = await this.database.progressionEvents.get(
            existingOperation.resultRecordId,
          );
          if (existingEvent === undefined) {
            throw new Error("advancement ledger references a missing event");
          }
          const expectedEventType =
            commit.type === "curriculum-completed"
              ? "curriculum-completed"
              : "advancement-accepted";
          if (
            existingEvent.idempotencyKey !== commit.idempotencyKey ||
            existingEvent.type !== expectedEventType ||
            existingEvent.sessionId !== commit.sessionId ||
            existingEvent.evidenceAttemptId !== commit.evidenceAttemptId ||
            !recordsEqual(
              existingEvent.activeCharacters,
              commit.activeCharacters,
            ) ||
            existingEvent.unlockedCharacter !== commit.unlockedCharacter
          ) {
            throw new Error(
              "advancement idempotency key was reused with different data",
            );
          }
          const currentCurriculum =
            await this.database.curriculum.get("curriculum-state");
          if (currentCurriculum === undefined) {
            throw new Error("curriculum does not exist");
          }
          return {
            committed: false,
            event: existingEvent,
            curriculum: parseCurriculumStateRecord(currentCurriculum),
          };
        }

        const storedSession = await this.database.sessions.get(
          commit.sessionId,
        );
        if (
          storedSession === undefined ||
          storedSession.source !== "learn" ||
          storedSession.status !== "completed" ||
          !storedSession.valid
        ) {
          throw new Error("advancement requires a completed Learn session");
        }
        const evidenceAttempt = await this.database.attempts.get(
          commit.evidenceAttemptId,
        );
        if (
          evidenceAttempt === undefined ||
          evidenceAttempt.sessionId !== storedSession.id ||
          evidenceAttempt.exerciseType !== "continuous-copy" ||
          evidenceAttempt.abandoned ||
          evidenceAttempt.assisted ||
          evidenceAttempt.replayed ||
          (commit.type === "character-unlocked" &&
            evidenceAttempt.readinessReason !== "READY") ||
          (commit.type === "curriculum-completed" &&
            evidenceAttempt.readinessReason !== "COMPLETE")
        ) {
          throw new Error(
            "advancement requires continuous-copy evidence from the completed session",
          );
        }
        if (
          !recordsEqual(storedSession.unlockedAtEnd, commit.activeCharacters)
        ) {
          throw new Error(
            "advancement active characters do not match the session",
          );
        }

        const storedCurriculumValue =
          await this.database.curriculum.get("curriculum-state");
        if (storedCurriculumValue === undefined) {
          throw new Error("curriculum does not exist");
        }
        const storedCurriculum = parseCurriculumStateRecord(
          storedCurriculumValue,
        );
        const storedCharacters = storedCurriculum.characters.map(
          ({ character }) => character,
        );
        if (!recordsEqual(storedCharacters, commit.activeCharacters)) {
          throw new Error("advancement curriculum is stale");
        }

        const occurredAt = captureDateTime(this.now());
        const nextState = curriculumState(storedCurriculum);
        const currentAssessment = evaluateAdvancementEvidence(nextState, {
          abandoned: evidenceAttempt.abandoned,
          perCharacterResults: evidenceAttempt.observations.flatMap(
            (observation) =>
              observation.target === undefined
                ? []
                : [
                    {
                      character: observation.target,
                      correct: observation.correct,
                    },
                  ],
          ),
        });
        const expectedReason =
          commit.type === "curriculum-completed" ? "COMPLETE" : "READY";
        if (
          !currentAssessment.eligible ||
          currentAssessment.reason !== expectedReason
        ) {
          throw new Error("advancement offer is stale or invalidated");
        }
        const transition = applyAdvancementTransition(
          nextState,
          {
            activeCharacters: commit.activeCharacters,
            type: commit.type,
            ...(commit.unlockedCharacter === undefined
              ? {}
              : { unlockedCharacter: commit.unlockedCharacter }),
          },
          occurredAt.utc,
        );
        if (transition === undefined) {
          throw new Error("advancement offer is stale or invalidated");
        }
        const nextCurriculum = curriculumRecord(
          nextState,
          laterTimestamp(storedCurriculum.updatedAt, occurredAt.utc),
        );
        const masteredCharacters = nextCurriculum.characters
          .filter(({ state }) => state === "mastered")
          .map(({ character }) => character);
        const eventId = this.createId();
        const event: ProgressionEventRecord = {
          id: eventId,
          schemaVersion: RECORD_SCHEMA_VERSION,
          updatedAt: occurredAt.utc,
          idempotencyKey: commit.idempotencyKey,
          type:
            commit.type === "curriculum-completed"
              ? "curriculum-completed"
              : "advancement-accepted",
          occurredAt,
          sessionId: storedSession.id,
          evidenceAttemptId: evidenceAttempt.id,
          activeCharacters: [...commit.activeCharacters],
          masteredCharacters,
          ...(commit.unlockedCharacter === undefined
            ? {}
            : { unlockedCharacter: commit.unlockedCharacter }),
          migrationDerived: false,
        };
        const milestones: MilestoneRecord[] =
          transition.newlyMasteredCharacters.map((character) => ({
            id: this.createId(),
            schemaVersion: RECORD_SCHEMA_VERSION,
            updatedAt: occurredAt.utc,
            idempotencyKey: `${commit.idempotencyKey}:mastered:${character}`,
            eventId,
            type: "character-mastered",
            occurredAt,
            character,
            migrationDerived: false,
          }));
        if (commit.type === "character-unlocked") {
          milestones.push({
            id: this.createId(),
            schemaVersion: RECORD_SCHEMA_VERSION,
            updatedAt: occurredAt.utc,
            idempotencyKey: `${commit.idempotencyKey}:unlocked:${commit.unlockedCharacter!}`,
            eventId,
            type: "character-unlocked",
            occurredAt,
            character: commit.unlockedCharacter!,
            migrationDerived: false,
          });
        } else {
          milestones.push({
            id: this.createId(),
            schemaVersion: RECORD_SCHEMA_VERSION,
            updatedAt: occurredAt.utc,
            idempotencyKey: `${commit.idempotencyKey}:completed`,
            eventId,
            type: "curriculum-completed",
            occurredAt,
            migrationDerived: false,
          });
        }
        const operation: OperationLedgerRecord = {
          id: operationId,
          schemaVersion: RECORD_SCHEMA_VERSION,
          updatedAt: occurredAt.utc,
          kind: "operation",
          operation: "accept-advancement",
          idempotencyKey: commit.idempotencyKey,
          completedAt: occurredAt.utc,
          resultRecordId: eventId,
        };

        await this.database.curriculum.put(nextCurriculum);
        await this.database.progressionEvents.add(event);
        await this.database.milestones.bulkAdd(milestones);
        await this.database.metadata.add(operation);
        return { committed: true, event, curriculum: nextCurriculum };
      },
    );
  }

  async getIntroductions(): Promise<IntroductionsRecord | undefined> {
    const record = await this.database.introductions.get(
      "completed-introductions",
    );
    return record === undefined ? undefined : parseIntroductionsRecord(record);
  }

  async saveIntroductions(characters: string[]): Promise<IntroductionsRecord> {
    return this.database.transaction(
      "rw",
      this.database.introductions,
      async () => {
        const existing = await this.database.introductions.get(
          "completed-introductions",
        );
        const record = parseIntroductionsRecord({
          id: "completed-introductions",
          schemaVersion: RECORD_SCHEMA_VERSION,
          updatedAt:
            existing === undefined
              ? this.now().toISOString()
              : laterTimestamp(
                  parseIntroductionsRecord(existing).updatedAt,
                  this.now().toISOString(),
                ),
          characters: [...new Set(characters)],
        });
        await this.database.introductions.put(record);
        return record;
      },
    );
  }

  async commitLearnAttempt(
    commit: LearnAttemptCommit,
  ): Promise<PersistenceResult<{ attempt: TrainingAttemptRecord }>> {
    if (
      commit.session.source !== "learn" ||
      commit.attempt.source !== "learn"
    ) {
      throw new Error("Learn attempt commits require Learn source records");
    }
    return this.commitAttempt(commit);
  }

  async commitPracticeAttempt(
    commit: PracticeAttemptCommit,
  ): Promise<PersistenceResult<{ attempt: TrainingAttemptRecord }>> {
    assertNoPracticeProgressionData(commit);
    if (
      commit.session.source === "learn" ||
      commit.attempt.source === "learn"
    ) {
      throw new Error(
        "Practice attempt commits require Practice source records",
      );
    }
    return this.commitAttempt(commit);
  }

  private async commitAttempt(
    commit: SharedAttemptCommit,
  ): Promise<PersistenceResult<{ attempt: TrainingAttemptRecord }>> {
    const nextSession = parseTrainingSession(commit.session);
    const attempt = parseTrainingAttempt(commit.attempt);
    const curriculum =
      commit.curriculum === undefined
        ? undefined
        : parseCurriculumStateRecord(commit.curriculum);
    const introductions =
      commit.introductions === undefined
        ? undefined
        : parseIntroductionsRecord(commit.introductions);

    return this.database.transaction(
      "rw",
      this.database.sessions,
      this.database.attempts,
      this.database.curriculum,
      this.database.introductions,
      async () => {
        const current = await this.database.sessions.get(nextSession.id);
        if (current === undefined) throw new Error("session does not exist");

        const existingAttempt = await this.database.attempts.get(attempt.id);
        if (existingAttempt !== undefined) {
          if (!recordsEqual(existingAttempt, attempt)) {
            throw new Error("attempt ID already exists with different data");
          }
          return {
            session: parseTrainingSession(current),
            attempt: parseTrainingAttempt(existingAttempt),
            committed: false,
          };
        }
        if (current.status !== "active") {
          throw new Error("cannot commit an attempt to a finalized session");
        }
        if (current.revision !== commit.expectedSessionRevision) {
          throw new Error("session revision changed before attempt commit");
        }
        assertSessionIdentity(current, nextSession);
        if (
          nextSession.status !== "active" ||
          nextSession.revision !== current.revision + 1 ||
          nextSession.attemptCount !== current.attemptCount + 1
        ) {
          throw new Error(
            "attempt commit requires the next active session revision",
          );
        }
        if (
          attempt.sessionId !== current.id ||
          attempt.source !== current.source
        ) {
          throw new Error("attempt does not belong to the active session");
        }
        const storedAttemptCount = await this.database.attempts
          .where("sessionId")
          .equals(current.id)
          .count();
        if (storedAttemptCount !== current.attemptCount) {
          throw new Error(
            `attemptCount ${current.attemptCount} does not match ${storedAttemptCount} stored attempts`,
          );
        }

        await this.database.attempts.add(attempt);
        await this.database.sessions.put(nextSession);
        if (curriculum !== undefined) {
          await this.database.curriculum.put(curriculum);
        }
        if (introductions !== undefined) {
          await this.database.introductions.put(introductions);
        }
        return { session: nextSession, attempt, committed: true };
      },
    );
  }

  async finalizeSession(
    value: TrainingSessionRecord,
    expectedRevision: number,
  ): Promise<PersistenceResult> {
    return this.finalizeTerminalSession(
      value,
      expectedRevision,
      "completed",
      "finalize-session",
    );
  }

  async interruptSession(
    value: TrainingSessionRecord,
    expectedRevision: number,
  ): Promise<PersistenceResult> {
    return this.finalizeTerminalSession(
      value,
      expectedRevision,
      "interrupted",
      "interrupt-session",
    );
  }

  private async finalizeTerminalSession(
    value: TrainingSessionRecord,
    expectedRevision: number,
    status: "completed" | "interrupted",
    operationName: string,
  ): Promise<PersistenceResult> {
    const nextSession = parseTrainingSession(value);
    if (
      nextSession.status !== status ||
      nextSession.finalizationKey === undefined
    ) {
      throw new Error(
        `${status} finalization requires a matching status and key`,
      );
    }
    const finalizationKey = nextSession.finalizationKey;

    return this.database.transaction(
      "rw",
      [
        this.database.metadata,
        this.database.sessions,
        this.database.attempts,
        this.database.dailyProjections,
        this.database.characterProjections,
        this.database.confusionProjections,
      ],
      async () => {
        const current = await this.database.sessions.get(nextSession.id);
        if (current === undefined) throw new Error("session does not exist");
        if (current.status !== "active") {
          if (current.finalizationKey === finalizationKey) {
            return { session: parseTrainingSession(current), committed: false };
          }
          throw new Error("session was already finalized by another operation");
        }
        if (current.revision !== expectedRevision) {
          throw new Error("session revision changed before finalization");
        }
        assertSessionIdentity(current, nextSession);
        if (
          nextSession.revision !== current.revision + 1 ||
          nextSession.attemptCount !== current.attemptCount
        ) {
          throw new Error("finalization requires the next session revision");
        }

        const sessions = await this.database.sessions.toArray();
        const attempts = await this.database.attempts.toArray();
        const validated = parseTrainingDataset(
          sessions.map((session) =>
            session.id === nextSession.id ? nextSession : session,
          ),
          attempts,
        );
        const rows = buildProjectionRows(
          validated.sessions,
          validated.attempts,
          nextSession.updatedAt,
        );
        const operation: OperationLedgerRecord = {
          id: `operation:${finalizationKey}`,
          schemaVersion: RECORD_SCHEMA_VERSION,
          updatedAt: nextSession.updatedAt,
          kind: "operation",
          operation: operationName,
          idempotencyKey: finalizationKey,
          completedAt: nextSession.updatedAt,
          resultRecordId: nextSession.id,
        };

        await this.database.sessions.put(nextSession);
        await this.database.metadata.add(operation);
        await this.database.dailyProjections.clear();
        await this.database.characterProjections.clear();
        await this.database.confusionProjections.clear();
        await this.database.dailyProjections.bulkPut(rows.daily);
        await this.database.characterProjections.bulkPut(rows.characters);
        await this.database.confusionProjections.bulkPut(rows.confusions);
        return { session: nextSession, committed: true };
      },
    );
  }

  async renewSessionLease(
    sessionId: string,
    ownerTabId: string,
    expectedRevision: number,
    expiresAt: string,
  ): Promise<TrainingSessionRecord> {
    if (ownerTabId.length === 0) {
      throw new Error("session owner cannot be empty");
    }
    const canonicalExpiresAt = new Date(
      instant(expiresAt, "lease expiration"),
    ).toISOString();

    return this.database.transaction("rw", this.database.sessions, async () => {
      const stored = await this.database.sessions.get(sessionId);
      if (stored === undefined) throw new Error("session does not exist");
      const current = parseTrainingSession(stored);
      if (current.status !== "active") {
        throw new Error("cannot renew a finalized session");
      }
      if (current.ownerTabId !== ownerTabId) {
        throw new Error("session owner changed before lease renewal");
      }
      if (current.revision !== expectedRevision) {
        throw new Error("session revision changed before lease renewal");
      }

      const renewed = parseTrainingSession({
        ...current,
        updatedAt: laterTimestamp(current.updatedAt, this.now().toISOString()),
        leaseExpiresAt: canonicalExpiresAt,
        revision: current.revision + 1,
      });
      await this.database.sessions.put(renewed);
      return renewed;
    });
  }

  async getRetryClassification(
    identity: RetryCounterIdentity,
    threshold: SpeedSuggestionAfterAttempts,
  ): Promise<RetryClassification> {
    return this.database.transaction(
      "r",
      [this.database.sessions, this.database.attempts],
      async () => {
        const dataset = parseTrainingDataset(
          await this.database.sessions.toArray(),
          await this.database.attempts.toArray(),
        );
        return classifyRetryHistory(
          dataset.sessions,
          dataset.attempts,
          identity,
          threshold,
        );
      },
    );
  }

  async listDailyProjections(
    query: DailyProjectionQuery,
  ): Promise<DailyProjectionRecord[]> {
    assertLocalDate(query.fromLocalDate, "fromLocalDate");
    assertLocalDate(query.toLocalDate, "toLocalDate");
    if (query.fromLocalDate > query.toLocalDate) {
      throw new RangeError(
        "fromLocalDate must be less than or equal to toLocalDate",
      );
    }
    assertBoundedLimit(query.limit);

    const rows = await this.database.dailyProjections
      .where("localDate")
      .between(query.fromLocalDate, query.toLocalDate, true, true)
      .limit(query.limit)
      .toArray();

    return rows.map((row) =>
      structuredClone(parseDailyProjectionRecord(structuredClone(row))),
    );
  }

  async getDashboardAggregate(
    query: DashboardAggregateQuery,
  ): Promise<DashboardAggregateRecord> {
    assertLocalDate(query.toLocalDate, "toLocalDate");

    const rows = await this.database.dailyProjections
      .where("localDate")
      .belowOrEqual(query.toLocalDate)
      .toArray();

    const parsedRows = rows
      .map((row) => parseDailyProjectionRecord(structuredClone(row)))
      .sort((left, right) => left.localDate.localeCompare(right.localDate));

    const weekStart = startOfWeekLocalDate(query.toLocalDate);
    const practiceDays = new Set<string>();

    let totalActiveMs = 0;
    let totalSessions = 0;
    let totalAttempts = 0;
    let rxCorrect = 0;
    let rxTotal = 0;
    let txCorrect = 0;
    let txTotal = 0;
    let effectiveWpmTotal = 0;
    let effectiveWpmSamples = 0;
    let activeDayCount = 0;
    let todayActiveMs = 0;
    let todaySessionCount = 0;
    let thisWeekActiveMs = 0;
    let thisWeekSessionCount = 0;

    for (const row of parsedRows) {
      totalActiveMs += row.activeMs;
      totalSessions += row.sessionCount;
      totalAttempts += row.attemptCount;
      rxCorrect += row.rxCorrect;
      rxTotal += row.rxTotal;
      txCorrect += row.txCorrect;
      txTotal += row.txTotal;
      effectiveWpmTotal += row.effectiveWpmTotal;
      effectiveWpmSamples += row.effectiveWpmSamples;

      if (row.activeMs > 0) activeDayCount += 1;
      if (isPracticeDay(row)) practiceDays.add(row.localDate);

      if (row.localDate === query.toLocalDate) {
        todayActiveMs += row.activeMs;
        todaySessionCount += row.sessionCount;
      }
      if (row.localDate >= weekStart && row.localDate <= query.toLocalDate) {
        thisWeekActiveMs += row.activeMs;
        thisWeekSessionCount += row.sessionCount;
      }
    }

    const orderedPracticeDays = [...practiceDays].sort((left, right) =>
      left.localeCompare(right),
    );
    let longestStreakDays = 0;
    let running = 0;
    let previous: string | undefined;
    for (const localDate of orderedPracticeDays) {
      if (previous !== undefined && previousLocalDate(localDate) === previous) {
        running += 1;
      } else {
        running = 1;
      }
      if (running > longestStreakDays) longestStreakDays = running;
      previous = localDate;
    }

    let currentStreakDays = 0;
    let anchor = query.toLocalDate;
    if (!practiceDays.has(anchor)) {
      const yesterday = previousLocalDate(query.toLocalDate);
      if (practiceDays.has(yesterday)) {
        anchor = yesterday;
      }
    }
    if (practiceDays.has(anchor)) {
      let cursor = anchor;
      while (practiceDays.has(cursor)) {
        currentStreakDays += 1;
        cursor = previousLocalDate(cursor);
      }
    }

    return {
      totalActiveMs,
      totalSessions,
      totalAttempts,
      rxCorrect,
      rxTotal,
      txCorrect,
      txTotal,
      effectiveWpmTotal,
      effectiveWpmSamples,
      activeDayCount,
      todayActiveMs,
      todaySessionCount,
      thisWeekActiveMs,
      thisWeekSessionCount,
      practiceDayCount: practiceDays.size,
      currentStreakDays,
      longestStreakDays,
    };
  }

  async listCharacterProjections(
    query: CharacterProjectionQuery,
  ): Promise<CharacterProjectionRecord[]> {
    assertBoundedLimit(query.limit);
    if (query.character !== undefined && query.character.length === 0) {
      throw new RangeError("character cannot be empty when provided");
    }

    const rows =
      query.character === undefined
        ? await this.database.characterProjections
            .where("direction")
            .equals(query.direction)
            .limit(query.limit)
            .toArray()
        : await this.database.characterProjections
            .where("[character+direction]")
            .equals([query.character, query.direction])
            .limit(query.limit)
            .toArray();

    const ordered = rows.sort(
      (left, right) =>
        left.character.localeCompare(right.character) ||
        left.id.localeCompare(right.id),
    );

    return ordered.map((row) =>
      structuredClone(parseCharacterProjectionRecord(structuredClone(row))),
    );
  }

  async listConfusionProjections(
    query: ConfusionProjectionQuery,
  ): Promise<ConfusionProjectionRecord[]> {
    assertBoundedLimit(query.limit);

    const rows = await this.database.confusionProjections
      .orderBy("count")
      .reverse()
      .limit(query.limit)
      .toArray();

    const ordered = rows.sort(
      (left, right) =>
        right.count - left.count ||
        left.target.localeCompare(right.target) ||
        left.answer.localeCompare(right.answer),
    );

    return ordered.map((row) =>
      structuredClone(parseConfusionProjectionRecord(structuredClone(row))),
    );
  }

  async listMilestones(query: MilestoneQuery): Promise<MilestoneRecord[]> {
    assertBoundedLimit(query.limit);

    const rows = await this.database.milestones
      .orderBy("occurredAt.utc")
      .reverse()
      .limit(query.limit)
      .toArray();

    const ordered = rows.sort(
      (left, right) =>
        right.occurredAt.utc.localeCompare(left.occurredAt.utc) ||
        right.id.localeCompare(left.id),
    );

    return ordered.map((row) =>
      structuredClone(parseMilestoneRecord(structuredClone(row))),
    );
  }

  async exportPortableBackup(
    appVersion: string,
  ): Promise<PortableBackupDocument> {
    const exportedAt = this.now().toISOString();
    const snapshot = await this.database.transaction(
      "r",
      [
        this.database.metadata,
        this.database.settings,
        this.database.curriculum,
        this.database.introductions,
        this.database.sessions,
        this.database.attempts,
        this.database.progressionEvents,
        this.database.milestones,
      ],
      async () => ({
        settings: await this.database.settings.get("portable-settings"),
        curriculum: await this.database.curriculum.get("curriculum-state"),
        introductions: await this.database.introductions.get(
          "completed-introductions",
        ),
        sessions: await this.database.sessions.toArray(),
        attempts: await this.database.attempts.toArray(),
        progressionEvents: await this.database.progressionEvents.toArray(),
        milestones: await this.database.milestones.toArray(),
        metadata: await this.database.metadata.toArray(),
      }),
    );
    const {
      settings,
      curriculum,
      introductions,
      sessions,
      attempts,
      progressionEvents,
      milestones,
      metadata,
    } = snapshot;
    const dataset = parseTrainingDataset(sessions, attempts);

    if (!settings || !curriculum || !introductions) {
      throw new Error("portable data is incomplete and cannot be exported");
    }

    const schemaMetadataRaw = metadata.find(
      (record) => record.id === "schema-metadata",
    );
    if (!schemaMetadataRaw) {
      throw new Error("schema metadata is missing and cannot be exported");
    }

    const migrationLedgers = metadata
      .filter(
        (record): record is MigrationLedgerRecord =>
          "kind" in record && record.kind === "migration",
      )
      .map((record) => parseMigrationLedger(structuredClone(record)));

    return createPortableBackupDocument({
      appVersion,
      databaseVersion: DATABASE_VERSION,
      exportedAt,
      payload: {
        settings: parsePortableSettingsRecord(structuredClone(settings)),
        curriculum: parseCurriculumStateRecord(structuredClone(curriculum)),
        introductions: parseIntroductionsRecord(structuredClone(introductions)),
        sessions: dataset.sessions,
        attempts: dataset.attempts,
        progressionEvents: progressionEvents.map((record) =>
          parseProgressionEventRecord(structuredClone(record)),
        ),
        milestones: milestones.map((record) =>
          parseMilestoneRecord(structuredClone(record)),
        ),
        schemaMetadata: parseSchemaMetadata(structuredClone(schemaMetadataRaw)),
        migrationLedgers,
      },
    });
  }

  async previewPortableBackup(rawJson: string): Promise<PortableBackupPreview> {
    const backup = await parsePortableBackupJson(rawJson);
    const schemaMetadata = parseSchemaMetadata(
      await this.database.metadata.get("schema-metadata"),
    );
    const confirmation = await createReplaceImportConfirmation({
      backupDigestHex: backup.integrity.digestHex,
      targetDatasetGeneration: schemaMetadata.datasetGeneration,
    });
    return summarizePortableBackup(backup, confirmation);
  }

  async replacePortableBackup(
    rawJson: string,
    confirmation: PortableBackupReplaceConfirmation,
  ): Promise<"applied" | "already-applied"> {
    const backup = await parsePortableBackupJson(rawJson);
    if (
      confirmation.backupDigestHex.toLowerCase() !==
      backup.integrity.digestHex.toLowerCase()
    ) {
      throw new Error("import confirmation does not match backup digest");
    }
    const expectedConfirmation = await createReplaceImportConfirmation({
      backupDigestHex: backup.integrity.digestHex,
      targetDatasetGeneration: confirmation.targetDatasetGeneration,
    });
    if (expectedConfirmation.operationKey !== confirmation.operationKey) {
      throw new Error("import confirmation key is invalid");
    }

    const dataset = parseTrainingDataset(
      backup.payload.sessions,
      backup.payload.attempts,
    );
    const generatedAt = this.now().toISOString();
    const rows = buildProjectionRows(
      dataset.sessions,
      dataset.attempts,
      generatedAt,
    );

    return this.database.transaction(
      "rw",
      [
        this.database.metadata,
        this.database.settings,
        this.database.curriculum,
        this.database.introductions,
        this.database.sessions,
        this.database.attempts,
        this.database.progressionEvents,
        this.database.milestones,
        this.database.dailyProjections,
        this.database.characterProjections,
        this.database.confusionProjections,
      ],
      async () => {
        const operationId = `operation:replace-import:${confirmation.operationKey}`;
        const existingOperation = await this.database.metadata.get(operationId);
        if (existingOperation !== undefined) {
          return "already-applied";
        }

        const currentSchemaMetadata = parseSchemaMetadata(
          await this.database.metadata.get("schema-metadata"),
        );
        if (
          currentSchemaMetadata.datasetGeneration !==
          confirmation.targetDatasetGeneration
        ) {
          throw new Error(
            "import confirmation is stale; preview the backup again",
          );
        }

        const operationRecord: OperationLedgerRecord = {
          id: operationId,
          schemaVersion: RECORD_SCHEMA_VERSION,
          updatedAt: generatedAt,
          kind: "operation",
          operation: "replace-portable-backup",
          idempotencyKey: confirmation.operationKey,
          completedAt: generatedAt,
          resultRecordId: backup.payload.schemaMetadata.datasetGeneration,
        };

        await this.database.settings.clear();
        await this.database.curriculum.clear();
        await this.database.introductions.clear();
        await this.database.sessions.clear();
        await this.database.attempts.clear();
        await this.database.progressionEvents.clear();
        await this.database.milestones.clear();
        await this.database.dailyProjections.clear();
        await this.database.characterProjections.clear();
        await this.database.confusionProjections.clear();
        await this.database.metadata.clear();

        await this.database.settings.put(backup.payload.settings);
        await this.database.curriculum.put(backup.payload.curriculum);
        await this.database.introductions.put(backup.payload.introductions);
        if (backup.payload.sessions.length > 0) {
          await this.database.sessions.bulkPut(backup.payload.sessions);
        }
        if (backup.payload.attempts.length > 0) {
          await this.database.attempts.bulkPut(backup.payload.attempts);
        }
        if (backup.payload.progressionEvents.length > 0) {
          await this.database.progressionEvents.bulkPut(
            backup.payload.progressionEvents,
          );
        }
        if (backup.payload.milestones.length > 0) {
          await this.database.milestones.bulkPut(backup.payload.milestones);
        }
        await this.database.metadata.put(backup.payload.schemaMetadata);
        if (backup.payload.migrationLedgers.length > 0) {
          await this.database.metadata.bulkPut(backup.payload.migrationLedgers);
        }
        await this.database.metadata.put(operationRecord);

        if (rows.daily.length > 0) {
          await this.database.dailyProjections.bulkPut(rows.daily);
        }
        if (rows.characters.length > 0) {
          await this.database.characterProjections.bulkPut(rows.characters);
        }
        if (rows.confusions.length > 0) {
          await this.database.confusionProjections.bulkPut(rows.confusions);
        }

        return "applied";
      },
    );
  }

  async resetPortableData(): Promise<void> {
    const now = this.now().toISOString();
    const freshCurriculum = createInitialState(DEFAULT_CURRICULUM_CONFIG, now);
    const schemaMetadata = parseSchemaMetadata({
      id: "schema-metadata",
      schemaVersion: RECORD_SCHEMA_VERSION,
      updatedAt: now,
      databaseVersion: DATABASE_VERSION,
      datasetGeneration: this.createId(),
    });
    const settings = parsePortableSettingsRecord({
      id: "portable-settings",
      schemaVersion: RECORD_SCHEMA_VERSION,
      updatedAt: now,
      value: DEFAULT_SETTINGS,
    });
    const curriculum = curriculumRecord(freshCurriculum, now);
    const introductions = parseIntroductionsRecord({
      id: "completed-introductions",
      schemaVersion: RECORD_SCHEMA_VERSION,
      updatedAt: now,
      characters: [],
    });

    await this.database.transaction(
      "rw",
      [
        this.database.metadata,
        this.database.settings,
        this.database.curriculum,
        this.database.introductions,
        this.database.sessions,
        this.database.attempts,
        this.database.progressionEvents,
        this.database.milestones,
        this.database.dailyProjections,
        this.database.characterProjections,
        this.database.confusionProjections,
      ],
      async () => {
        const metadata = await this.database.metadata.toArray();
        const migrationLedgers = metadata
          .filter(
            (record): record is MigrationLedgerRecord =>
              "kind" in record && record.kind === "migration",
          )
          .map((record) => parseMigrationLedger(structuredClone(record)));

        await this.database.settings.clear();
        await this.database.curriculum.clear();
        await this.database.introductions.clear();
        await this.database.sessions.clear();
        await this.database.attempts.clear();
        await this.database.progressionEvents.clear();
        await this.database.milestones.clear();
        await this.database.dailyProjections.clear();
        await this.database.characterProjections.clear();
        await this.database.confusionProjections.clear();
        await this.database.metadata.clear();

        await this.database.metadata.put(schemaMetadata);
        if (migrationLedgers.length > 0) {
          await this.database.metadata.bulkPut(migrationLedgers);
        }
        await this.database.settings.put(settings);
        await this.database.curriculum.put(curriculum);
        await this.database.introductions.put(introductions);
      },
    );
  }

  async isMigrationComplete(): Promise<boolean> {
    const record = await this.database.metadata.get(
      `migration:${LEGACY_MIGRATION_ID}`,
    );
    if (record === undefined) return false;
    const ledger = parseMigrationLedger(record);
    if (ledger.migration !== LEGACY_MIGRATION_ID) {
      throw new Error("legacy migration ledger has an unexpected migration ID");
    }
    return true;
  }

  async commitLegacyMigration(bundle: LegacyMigrationBundle): Promise<boolean> {
    const records = parseLegacyMigrationBundle(bundle);
    return this.database.transaction(
      "rw",
      [
        this.database.metadata,
        this.database.settings,
        this.database.curriculum,
        this.database.introductions,
        this.database.progressionEvents,
        this.database.milestones,
      ],
      async () => {
        if (await this.database.metadata.get(records.ledger.id)) return false;

        await this.database.settings.put(records.settings);
        await this.database.curriculum.put(records.curriculum);
        await this.database.introductions.put(records.introductions);
        await this.database.progressionEvents.bulkAdd(
          records.progressionEvents,
        );
        await this.database.milestones.bulkAdd(records.milestones);
        await this.database.metadata.add(records.ledger);
        return true;
      },
    );
  }

  async recoverInterruptedSessions(): Promise<TrainingSessionRecord[]> {
    const now = this.now();
    const nowMs = now.getTime();
    const capturedNow = captureDateTime(now);
    return this.database.transaction(
      "rw",
      [
        this.database.metadata,
        this.database.sessions,
        this.database.attempts,
        this.database.dailyProjections,
        this.database.characterProjections,
        this.database.confusionProjections,
      ],
      async () => {
        const dataset = parseTrainingDataset(
          await this.database.sessions.toArray(),
          await this.database.attempts.toArray(),
        );
        const recoverableSessions = dataset.sessions.filter(
          (session) =>
            session.status === "active" && hasExpiredLease(session, nowMs),
        );
        if (recoverableSessions.length === 0) return [];

        const recovered = recoverableSessions.map((session) => {
          const endedAt =
            nowMs < instant(session.startedAt.utc, "session start")
              ? session.startedAt
              : capturedNow;
          const finalizationKey = `recovery:${session.id}:${session.revision}`;
          const record: TrainingSessionRecord = {
            ...session,
            status: "interrupted",
            endedAt,
            updatedAt: laterTimestamp(session.updatedAt, endedAt.utc),
            valid: isValidSessionRecord(session),
            revision: session.revision + 1,
            finalizationKey,
          };
          delete record.ownerTabId;
          delete record.leaseExpiresAt;
          return record;
        });
        const recoveredById = new Map(
          recovered.map((session) => [session.id, session]),
        );
        const sessions = dataset.sessions.map(
          (session) => recoveredById.get(session.id) ?? session,
        );
        const validated = parseTrainingDataset(sessions, dataset.attempts);
        const generatedAt = now.toISOString();
        const rows = buildProjectionRows(
          validated.sessions,
          validated.attempts,
          generatedAt,
        );
        const operations: OperationLedgerRecord[] = recovered.map(
          (session) => ({
            id: `operation:${session.finalizationKey}`,
            schemaVersion: RECORD_SCHEMA_VERSION,
            updatedAt: session.updatedAt,
            kind: "operation",
            operation: "recover-interrupted-session",
            idempotencyKey: session.finalizationKey!,
            completedAt: session.updatedAt,
            resultRecordId: session.id,
          }),
        );

        await this.database.sessions.bulkPut(recovered);
        await this.database.metadata.bulkAdd(operations);
        await this.database.dailyProjections.clear();
        await this.database.characterProjections.clear();
        await this.database.confusionProjections.clear();
        await this.database.dailyProjections.bulkPut(rows.daily);
        await this.database.characterProjections.bulkPut(rows.characters);
        await this.database.confusionProjections.bulkPut(rows.confusions);
        return recovered;
      },
    );
  }

  async rebuildProjections(): Promise<void> {
    const generatedAt = this.now().toISOString();
    await this.database.transaction(
      "rw",
      this.database.sessions,
      this.database.attempts,
      this.database.dailyProjections,
      this.database.characterProjections,
      this.database.confusionProjections,
      async () => {
        const dataset = parseTrainingDataset(
          await this.database.sessions.toArray(),
          await this.database.attempts.toArray(),
        );
        const rows = buildProjectionRows(
          dataset.sessions,
          dataset.attempts,
          generatedAt,
        );

        await this.database.dailyProjections.clear();
        await this.database.characterProjections.clear();
        await this.database.confusionProjections.clear();
        await this.database.dailyProjections.bulkPut(rows.daily);
        await this.database.characterProjections.bulkPut(rows.characters);
        await this.database.confusionProjections.bulkPut(rows.confusions);
      },
    );
  }
}
