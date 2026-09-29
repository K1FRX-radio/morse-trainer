import type { SchedulerReason } from "../core/types.ts";
import type { CharacterProgress } from "../core/types.ts";
import type { PracticeSettings } from "../core/settings.ts";

export const RECORD_SCHEMA_VERSION = 1;
export const PROJECTION_VERSION = 1;
export const SCORING_ALGORITHM_VERSION = "alignment-v1";
export const KEYING_TIMING_ENCODING = "u32-ms-le-v1";
export const MAX_KEYING_MARK_SAMPLES = 512;
export const MAX_KEYING_SPACE_SAMPLES = 511;

export type PersistedRecord = {
  id: string;
  schemaVersion: number;
  updatedAt: string;
};

/** Wall-clock context captured when an event occurs. */
export type CapturedDateTime = {
  utc: string;
  localDate: string;
  utcOffsetMinutes: number;
  timeZone?: string;
};

export type SessionSource =
  "learn" | "copy-practice" | "send-practice" | "imported-text-rx";
export type SessionMode =
  "learn" | "copy" | "send" | "review" | "imported-text-rx";
export type SessionStatus = "active" | "completed" | "interrupted";
export type AttemptDirection = "rx" | "tx";

export type ActiveDateBucket = {
  localDate: string;
  utcOffsetMinutes: number;
  timeZone?: string;
  activeMs: number;
};

export type TrainingSessionRecord = PersistedRecord & {
  source: SessionSource;
  mode: SessionMode;
  status: SessionStatus;
  startedAt: CapturedDateTime;
  endedAt?: CapturedDateTime;
  activeMs: number;
  activeDateBuckets: ActiveDateBucket[];
  attemptCount: number;
  /** Non-abandoned attempts eligible to satisfy session validity. */
  finalizedAttemptCount?: number;
  completedCards: number;
  valid: boolean;
  charWpm: number;
  effectiveWpm: number;
  toneHz: number;
  noiseLevel: number;
  unlockedAtStart: string[];
  unlockedAtEnd?: string[];
  appVersion: string;
  revision: number;
  ownerTabId?: string;
  leaseExpiresAt?: string;
  finalizationKey?: string;
};

export type AlignmentKind = "match" | "substitution" | "deletion" | "insertion";

export type AlignmentObservation = {
  kind: AlignmentKind;
  correct: boolean;
  targetIndex?: number;
  target?: string;
  answerIndex?: number;
  answer?: string;
};

export type EncodedKeyingTiming = {
  encoding: typeof KEYING_TIMING_ENCODING;
  /** Base64-encoded little-endian Uint32 millisecond samples. */
  marks: string;
  /** Base64-encoded little-endian Uint32 millisecond samples. */
  spaces: string;
  originalMarkCount: number;
  originalSpaceCount: number;
  timingTruncated: boolean;
  timingOverflowed: boolean;
  ditEstimateMs?: number;
};

export type AttemptExerciseType =
  | "copy-character"
  | "copy-group"
  | "copy-word"
  | "continuous-copy"
  | "send-character"
  | "send-word";

export type ContinuousCopyReadinessReason =
  | "READY"
  | "ABANDONED"
  | "INSUFFICIENT_TOTAL_EVIDENCE"
  | "INCOMPLETE_ACTIVE_COVERAGE"
  | "INSUFFICIENT_NEWEST_COVERAGE"
  | "LOW_OVERALL_ACCURACY"
  | "LOW_NEWEST_ACCURACY"
  | "NEEDS_REVIEW"
  | "COMPLETE";

export type TrainingAttemptRecord = PersistedRecord & {
  sessionId: string;
  occurredAt: CapturedDateTime;
  source: SessionSource;
  direction: AttemptDirection;
  exerciseType: AttemptExerciseType;
  rawTarget: string;
  rawResponse: string;
  normalizedTarget: string;
  normalizedResponse: string;
  correct: boolean;
  assisted: boolean;
  replayed: boolean;
  abandoned: boolean;
  readinessReason?: ContinuousCopyReadinessReason;
  scoringAlgorithmVersion: string;
  observations: AlignmentObservation[];
  schedulerReason?: SchedulerReason;
  responseMs?: number;
  durationMs?: number;
  keying?: EncodedKeyingTiming;
  charWpm: number;
  effectiveWpm: number;
  toneHz: number;
  noiseLevel: number;
};

export type PortableSettingsRecord = PersistedRecord & {
  id: "portable-settings";
  value: PracticeSettings;
};

export type CurriculumStateRecord = PersistedRecord & {
  id: "curriculum-state";
  order: string[];
  startCount: number;
  windowSize: number;
  minNewCharObservations: number;
  reviewDecayAccuracy: number;
  characters: CharacterProgress[];
};

export type IntroductionsRecord = PersistedRecord & {
  id: "completed-introductions";
  characters: string[];
};

export type ProgressionEventType =
  "advancement-accepted" | "mastery-recorded" | "curriculum-completed";

export type ProgressionEventRecord = PersistedRecord & {
  idempotencyKey: string;
  type: ProgressionEventType;
  occurredAt: CapturedDateTime;
  sessionId?: string;
  evidenceAttemptId?: string;
  activeCharacters: string[];
  masteredCharacters: string[];
  unlockedCharacter?: string;
  migrationDerived: boolean;
};

export type MilestoneType =
  "character-mastered" | "character-unlocked" | "curriculum-completed";

export type MilestoneRecord = PersistedRecord & {
  idempotencyKey: string;
  eventId: string;
  type: MilestoneType;
  occurredAt: CapturedDateTime;
  character?: string;
  migrationDerived: boolean;
};

export type SchemaMetadataRecord = PersistedRecord & {
  id: "schema-metadata";
  databaseVersion: number;
  datasetGeneration: string;
};

export type MigrationLedgerRecord = PersistedRecord & {
  kind: "migration";
  migration: string;
  completedAt: string;
};

export type OperationLedgerRecord = PersistedRecord & {
  kind: "operation";
  operation: string;
  idempotencyKey: string;
  completedAt: string;
  resultRecordId?: string;
};

export type MetadataRecord =
  SchemaMetadataRecord | MigrationLedgerRecord | OperationLedgerRecord;

export type LegacyMigrationBundle = {
  settings: PortableSettingsRecord;
  curriculum: CurriculumStateRecord;
  introductions: IntroductionsRecord;
  progressionEvents: ProgressionEventRecord[];
  milestones: MilestoneRecord[];
  ledger: MigrationLedgerRecord;
};

export type DailyProjectionRecord = PersistedRecord & {
  projectionVersion: number;
  localDate: string;
  activeMs: number;
  sessionCount: number;
  attemptCount: number;
  rxCorrect: number;
  rxTotal: number;
  txCorrect: number;
  txTotal: number;
  effectiveWpmTotal: number;
  effectiveWpmSamples: number;
};

export type RecentCharacterObservation = {
  attemptId: string;
  occurredAt: CapturedDateTime;
  correct: boolean;
  answer?: string;
  kind: AlignmentKind;
  responseMs?: number;
};

export type CharacterProjectionRecord = PersistedRecord & {
  projectionVersion: number;
  character: string;
  direction: AttemptDirection;
  recent: RecentCharacterObservation[];
};

export type ConfusionProjectionRecord = PersistedRecord & {
  projectionVersion: number;
  target: string;
  answer: string;
  count: number;
};
