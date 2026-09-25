import { DATABASE_VERSION, TrainerDatabase } from "./indexeddb.ts";
import { isValidTrainingSession } from "../core/session-validity.ts";
import type {
  PracticeSettings,
  SpeedSuggestionAfterAttempts,
} from "../core/settings.ts";
import type { CurriculumState } from "../core/curriculum.ts";
import {
  LEGACY_MIGRATION_ID,
  type LegacyMigrationRepository,
} from "./legacy-migration.ts";
import {
  RECORD_SCHEMA_VERSION,
  type CurriculumStateRecord,
  type IntroductionsRecord,
  type LegacyMigrationBundle,
  type OperationLedgerRecord,
  type PortableSettingsRecord,
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
  parseCurriculumStateRecord,
  parseIntroductionsRecord,
  parseLegacyMigrationBundle,
  parseMigrationLedger,
  parsePortableSettingsRecord,
  parseSchemaMetadata,
  parseTrainingAttempt,
  parseTrainingDataset,
  parseTrainingSession,
} from "./validation.ts";

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
  rebuildProjections(): Promise<void>;
}

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
    return this.database.transaction("rw", this.database.metadata, async () => {
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
    });
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
        value: settings,
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
            valid: isValidTrainingSession(session),
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
