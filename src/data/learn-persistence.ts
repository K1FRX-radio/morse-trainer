import type { CurriculumState } from "../core/curriculum.ts";
import { gradeCopyDetailed, normalizeCopy } from "../core/scoring.ts";
import { isValidTrainingSession } from "../core/session-validity.ts";
import type { LearnSessionMode } from "../training/learn-session.ts";
import {
  RECORD_SCHEMA_VERSION,
  SCORING_ALGORITHM_VERSION,
  type AttemptExerciseType,
  type ContinuousCopyReadinessReason,
  type CurriculumStateRecord,
  type IntroductionsRecord,
  type TrainingAttemptRecord,
  type TrainingSessionRecord,
} from "./models.ts";
import type { TrainingDataRepository } from "./repository.ts";
import { captureDateTime } from "./time.ts";

const DEFAULT_LEASE_DURATION_MS = 60000;
const DEFAULT_LEASE_RENEWAL_MS = 20000;

export type LearnPersistenceSettings = {
  charWpm: number;
  effectiveWpm: number;
  toneHz: number;
  noiseLevel: number;
};

export type LearnPersistenceStart = {
  mode: LearnSessionMode;
  activeCharacters: string[];
  settings: LearnPersistenceSettings;
};

export type LearnPersistenceSnapshot = {
  activeMs: number;
  completedCards: number;
  curriculum: CurriculumState;
  introductions: string[];
};

export type LearnAttemptEvidence = {
  exerciseType: Extract<
    AttemptExerciseType,
    "copy-character" | "copy-group" | "copy-word" | "continuous-copy"
  >;
  target: string;
  response: string;
  assisted: boolean;
  replayed: boolean;
  abandoned: boolean;
  durationMs?: number;
  readinessReason?: ContinuousCopyReadinessReason;
};

export type LearnPersistenceDependencies = {
  now?: () => Date;
  createId?: () => string;
  appVersion?: string;
  scheduleLeaseRenewal?: (renew: () => void) => () => void;
};

export interface LearnSessionPersistence {
  recordAttempt(
    evidence: LearnAttemptEvidence,
    snapshot: LearnPersistenceSnapshot,
  ): Promise<void>;
  finish(snapshot: LearnPersistenceSnapshot): Promise<void>;
}

function defaultId(): string {
  if (typeof crypto === "undefined" || !crypto.randomUUID) {
    throw new Error("secure UUID generation is unavailable");
  }
  return crypto.randomUUID();
}

function defaultLeaseRenewal(renew: () => void): () => void {
  const handle = globalThis.setInterval(renew, DEFAULT_LEASE_RENEWAL_MS);
  return () => globalThis.clearInterval(handle);
}

function curriculumRecord(
  state: CurriculumState,
  updatedAt: string,
): CurriculumStateRecord {
  return {
    id: "curriculum-state",
    schemaVersion: RECORD_SCHEMA_VERSION,
    updatedAt,
    order: [...state.config.order],
    startCount: state.config.startCount,
    windowSize: state.config.windowSize,
    minNewCharObservations: state.config.minNewCharObservations,
    reviewDecayAccuracy: state.config.reviewDecayAccuracy,
    characters: structuredClone(state.characters),
  };
}

function introductionsRecord(
  characters: readonly string[],
  updatedAt: string,
): IntroductionsRecord {
  return {
    id: "completed-introductions",
    schemaVersion: RECORD_SCHEMA_VERSION,
    updatedAt,
    characters: [...new Set(characters)],
  };
}

function activeDateBuckets(
  activeMs: number,
  at: ReturnType<typeof captureDateTime>,
): TrainingSessionRecord["activeDateBuckets"] {
  if (activeMs === 0) return [];
  return [
    {
      localDate: at.localDate,
      utcOffsetMinutes: at.utcOffsetMinutes,
      ...(at.timeZone ? { timeZone: at.timeZone } : {}),
      activeMs,
    },
  ];
}

export class DurableLearnSession implements LearnSessionPersistence {
  private record: TrainingSessionRecord;
  private pending: Promise<void> = Promise.resolve();
  private failure: unknown;
  private closing = false;
  private qualifyingAttemptCount = 0;
  private readonly cancelLeaseRenewal: () => void;

  private constructor(
    private readonly repository: TrainingDataRepository,
    record: TrainingSessionRecord,
    private readonly settings: LearnPersistenceSettings,
    private readonly now: () => Date,
    private readonly createId: () => string,
    scheduleLeaseRenewal: (renew: () => void) => () => void,
  ) {
    this.record = record;
    this.cancelLeaseRenewal = scheduleLeaseRenewal(() => {
      if (this.closing) return;
      void this.enqueue(async () => {
        const expiresAt = new Date(
          this.now().getTime() + DEFAULT_LEASE_DURATION_MS,
        ).toISOString();
        this.record = await this.repository.renewSessionLease(
          this.record.id,
          this.record.ownerTabId!,
          this.record.revision,
          expiresAt,
        );
      }).catch(() => undefined);
    });
  }

  static async create(
    repository: TrainingDataRepository,
    options: LearnPersistenceStart,
    dependencies: LearnPersistenceDependencies = {},
  ): Promise<DurableLearnSession> {
    const now = dependencies.now ?? (() => new Date());
    const createId = dependencies.createId ?? defaultId;
    const startedAt = captureDateTime(now());
    const ownerTabId = createId();
    const record: TrainingSessionRecord = {
      id: createId(),
      schemaVersion: RECORD_SCHEMA_VERSION,
      updatedAt: startedAt.utc,
      source: "learn",
      mode: options.mode,
      status: "active",
      startedAt,
      activeMs: 0,
      activeDateBuckets: [],
      attemptCount: 0,
      finalizedAttemptCount: 0,
      completedCards: 0,
      valid: false,
      ...options.settings,
      unlockedAtStart: [...options.activeCharacters],
      appVersion: dependencies.appVersion ?? "0.0.0",
      revision: 0,
      ownerTabId,
      leaseExpiresAt: new Date(
        Date.parse(startedAt.utc) + DEFAULT_LEASE_DURATION_MS,
      ).toISOString(),
    };
    const created = await repository.createSession(record);
    return new DurableLearnSession(
      repository,
      created.session,
      options.settings,
      now,
      createId,
      dependencies.scheduleLeaseRenewal ?? defaultLeaseRenewal,
    );
  }

  recordAttempt(
    evidence: LearnAttemptEvidence,
    snapshot: LearnPersistenceSnapshot,
  ): Promise<void> {
    const occurredAt = captureDateTime(this.now());
    const id = this.createId();
    const target = normalizeCopy(evidence.target);
    const response = normalizeCopy(evidence.response);
    const observations = evidence.abandoned
      ? []
      : gradeCopyDetailed(target, response).alignment;
    const attempt: TrainingAttemptRecord = {
      id,
      schemaVersion: RECORD_SCHEMA_VERSION,
      updatedAt: occurredAt.utc,
      sessionId: this.record.id,
      occurredAt,
      source: "learn",
      direction: "rx",
      exerciseType: evidence.exerciseType,
      rawTarget: evidence.target,
      rawResponse: evidence.response,
      normalizedTarget: target,
      normalizedResponse: response,
      correct: !evidence.abandoned && target === response,
      assisted: evidence.assisted,
      replayed: evidence.replayed,
      abandoned: evidence.abandoned,
      ...(evidence.readinessReason
        ? { readinessReason: evidence.readinessReason }
        : {}),
      scoringAlgorithmVersion: SCORING_ALGORITHM_VERSION,
      observations,
      ...(evidence.durationMs === undefined
        ? {}
        : { durationMs: evidence.durationMs }),
      ...this.settings,
    };
    const frozenSnapshot = structuredClone(snapshot);

    return this.enqueue(async () => {
      const nextQualifyingAttemptCount =
        this.qualifyingAttemptCount + (evidence.abandoned ? 0 : 1);
      const nextSession = this.activeSnapshot(
        frozenSnapshot,
        occurredAt,
        this.record.attemptCount + 1,
        nextQualifyingAttemptCount,
      );
      const result = await this.repository.commitLearnAttempt({
        expectedSessionRevision: this.record.revision,
        session: nextSession,
        attempt,
        curriculum: curriculumRecord(frozenSnapshot.curriculum, occurredAt.utc),
        introductions: introductionsRecord(
          frozenSnapshot.introductions,
          occurredAt.utc,
        ),
      });
      this.record = result.session;
      this.qualifyingAttemptCount = nextQualifyingAttemptCount;
    });
  }

  async finish(snapshot: LearnPersistenceSnapshot): Promise<void> {
    if (this.closing) {
      await this.pending;
      if (this.failure) throw this.failure;
      return;
    }
    this.closing = true;
    this.cancelLeaseRenewal();
    const endedAt = captureDateTime(this.now());
    const frozenSnapshot = structuredClone(snapshot);
    await this.enqueue(async () => {
      const current = { ...this.record };
      delete current.ownerTabId;
      delete current.leaseExpiresAt;
      const completed: TrainingSessionRecord = {
        ...current,
        updatedAt: endedAt.utc,
        status: "completed",
        endedAt,
        activeMs: frozenSnapshot.activeMs,
        activeDateBuckets: activeDateBuckets(frozenSnapshot.activeMs, endedAt),
        completedCards: frozenSnapshot.completedCards,
        valid: isValidTrainingSession({
          activeMs: frozenSnapshot.activeMs,
          attemptCount: this.qualifyingAttemptCount,
        }),
        unlockedAtEnd: frozenSnapshot.curriculum.characters.map(
          ({ character }) => character,
        ),
        revision: current.revision + 1,
        finalizationKey: `learn-session:${current.id}`,
      };
      const result = await this.repository.finalizeSession(
        completed,
        this.record.revision,
      );
      this.record = result.session;
    });
    if (this.failure) throw this.failure;
  }

  private activeSnapshot(
    snapshot: LearnPersistenceSnapshot,
    at: ReturnType<typeof captureDateTime>,
    attemptCount: number,
    qualifyingAttemptCount: number,
  ): TrainingSessionRecord {
    return {
      ...this.record,
      updatedAt: at.utc,
      activeMs: snapshot.activeMs,
      activeDateBuckets: activeDateBuckets(snapshot.activeMs, at),
      attemptCount,
      finalizedAttemptCount: qualifyingAttemptCount,
      completedCards: snapshot.completedCards,
      valid: isValidTrainingSession({
        activeMs: snapshot.activeMs,
        attemptCount: qualifyingAttemptCount,
      }),
      unlockedAtEnd: snapshot.curriculum.characters.map(
        ({ character }) => character,
      ),
      leaseExpiresAt: new Date(
        Date.parse(at.utc) + DEFAULT_LEASE_DURATION_MS,
      ).toISOString(),
      revision: this.record.revision + 1,
    };
  }

  private enqueue(operation: () => Promise<void>): Promise<void> {
    const result = this.pending.then(async () => {
      if (this.failure) throw this.failure;
      await operation();
    });
    this.pending = result.catch((error: unknown) => {
      this.failure ??= error;
    });
    return result;
  }
}
