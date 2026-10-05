import { gradeCopyDetailed, normalizeCopy } from "../core/scoring.ts";
import {
  type CharacterWpmBand,
  type EffectiveWpmBand,
  normalizeCharacterWpmBand,
  normalizeEffectiveWpmBand,
} from "../core/settings.ts";
import {
  RECORD_SCHEMA_VERSION,
  SCORING_ALGORITHM_VERSION,
  type AttemptExerciseType,
  type EncodedKeyingTiming,
  type TrainingAttemptRecord,
  type TrainingSessionRecord,
} from "./models.ts";
import type { SchedulerReason } from "../core/types.ts";
import type { TrainingDataRepository } from "./repository.ts";
import { isValidSessionForSource } from "./session-validity-policy.ts";
import { captureDateTime } from "./time.ts";

const DEFAULT_LEASE_DURATION_MS = 60000;
const DEFAULT_LEASE_RENEWAL_MS = 20000;

type PracticeSource = "copy-practice" | "send-practice" | "imported-text-rx";

export type PracticePersistenceSettings = {
  charWpm: number;
  effectiveWpm: number;
  toneHz: number;
  noiseLevel: number;
};

export type PracticePersistenceStart = {
  source: PracticeSource;
  activeCharacters: string[];
  settings: PracticePersistenceSettings;
};

export type PracticePersistenceSnapshot = {
  activeMs: number;
  activeDateBuckets: TrainingSessionRecord["activeDateBuckets"];
  completedCards: number;
};

export type PracticeAttemptEvidence = {
  exerciseType: Extract<
    AttemptExerciseType,
    | "copy-character"
    | "copy-group"
    | "copy-word"
    | "send-character"
    | "send-group"
    | "send-word"
  >;
  target: string;
  response: string;
  assisted: boolean;
  replayed: boolean;
  schedulerReason?: SchedulerReason;
  responseMs?: number;
  keying?: EncodedKeyingTiming;
};

export type PracticePersistenceDependencies = {
  now?: () => Date;
  createId?: () => string;
  appVersion?: string;
  scheduleLeaseRenewal?: (renew: () => void) => () => void;
};

export interface PracticeSessionPersistence {
  recordAttempt(
    evidence: PracticeAttemptEvidence,
    snapshot: PracticePersistenceSnapshot,
  ): Promise<void>;
  finish(snapshot: PracticePersistenceSnapshot): Promise<void>;
  interrupt(snapshot: PracticePersistenceSnapshot): Promise<void>;
  retry(): Promise<void>;
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

function modeForSource(
  source: PracticeSource,
): "copy" | "send" | "imported-text-rx" {
  switch (source) {
    case "copy-practice":
      return "copy";
    case "send-practice":
      return "send";
    case "imported-text-rx":
      return "imported-text-rx";
  }
}

function directionForSource(source: PracticeSource): "rx" | "tx" {
  switch (source) {
    case "copy-practice":
      return "rx";
    case "send-practice":
      return "tx";
    case "imported-text-rx":
      throw new Error("Imported text sessions do not persist attempts");
  }
}

function assertEvidenceMatchesSource(
  source: PracticeSource,
  evidence: PracticeAttemptEvidence,
): void {
  const isCopy = evidence.exerciseType.startsWith("copy-");
  if (source === "imported-text-rx") {
    throw new Error("Imported text sessions cannot record scored attempts");
  }
  if ((source === "copy-practice") !== isCopy) {
    throw new Error("Practice attempt type does not match its session source");
  }
  if (source === "copy-practice" && evidence.keying !== undefined) {
    throw new Error("Copy Practice attempts cannot contain keying timing");
  }
}

export class DurablePracticeSession implements PracticeSessionPersistence {
  private record: TrainingSessionRecord;
  private readonly queue: Array<() => Promise<void>> = [];
  private processing: Promise<void> | undefined;
  private closingStatus: "completed" | "interrupted" | undefined;
  private terminal = false;
  private leaseRenewalCanceled = false;
  private readonly cancelLeaseRenewal: () => void;
  private readonly charWpmBand: CharacterWpmBand;
  private readonly effectiveWpmBand: EffectiveWpmBand;

  private constructor(
    private readonly repository: TrainingDataRepository,
    record: TrainingSessionRecord,
    private readonly source: PracticeSource,
    private readonly settings: PracticePersistenceSettings,
    private readonly now: () => Date,
    private readonly createId: () => string,
    scheduleLeaseRenewal: (renew: () => void) => () => void,
  ) {
    this.record = record;
    this.charWpmBand = normalizeCharacterWpmBand(settings.charWpm);
    this.effectiveWpmBand = normalizeEffectiveWpmBand(
      settings.effectiveWpm,
      this.charWpmBand,
    );
    this.cancelLeaseRenewal = scheduleLeaseRenewal(() => {
      if (this.closingStatus) return;
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
    options: PracticePersistenceStart,
    dependencies: PracticePersistenceDependencies = {},
  ): Promise<DurablePracticeSession> {
    const now = dependencies.now ?? (() => new Date());
    const createId = dependencies.createId ?? defaultId;
    const startedAt = captureDateTime(now());
    const ownerTabId = createId();
    const charWpmBand = normalizeCharacterWpmBand(options.settings.charWpm);
    const record: TrainingSessionRecord = {
      id: createId(),
      schemaVersion: RECORD_SCHEMA_VERSION,
      updatedAt: startedAt.utc,
      source: options.source,
      mode: modeForSource(options.source),
      status: "active",
      startedAt,
      activeMs: 0,
      activeDateBuckets: [],
      attemptCount: 0,
      finalizedAttemptCount: 0,
      completedCards: 0,
      valid: false,
      ...options.settings,
      charWpmBand,
      effectiveWpmBand: normalizeEffectiveWpmBand(
        options.settings.effectiveWpm,
        charWpmBand,
      ),
      unlockedAtStart: [...options.activeCharacters],
      appVersion: dependencies.appVersion ?? "0.0.0",
      revision: 0,
      ownerTabId,
      leaseExpiresAt: new Date(
        Date.parse(startedAt.utc) + DEFAULT_LEASE_DURATION_MS,
      ).toISOString(),
    };
    const created = await repository.createSession(record);
    return new DurablePracticeSession(
      repository,
      created.session,
      options.source,
      options.settings,
      now,
      createId,
      dependencies.scheduleLeaseRenewal ?? defaultLeaseRenewal,
    );
  }

  recordAttempt(
    evidence: PracticeAttemptEvidence,
    snapshot: PracticePersistenceSnapshot,
  ): Promise<void> {
    if (this.closingStatus) {
      return Promise.reject(new Error("Practice session is already closing"));
    }
    try {
      assertEvidenceMatchesSource(this.source, evidence);
    } catch (error) {
      return Promise.reject(error);
    }
    const occurredAt = captureDateTime(this.now());
    const target = normalizeCopy(evidence.target);
    const response = normalizeCopy(evidence.response);
    const attempt: TrainingAttemptRecord = {
      id: this.createId(),
      schemaVersion: RECORD_SCHEMA_VERSION,
      updatedAt: occurredAt.utc,
      sessionId: this.record.id,
      occurredAt,
      source: this.source,
      direction: directionForSource(this.source),
      exerciseType: evidence.exerciseType,
      rawTarget: evidence.target,
      rawResponse: evidence.response,
      normalizedTarget: target,
      normalizedResponse: response,
      correct: target === response,
      assisted: evidence.assisted,
      replayed: evidence.replayed,
      abandoned: false,
      scoringAlgorithmVersion: SCORING_ALGORITHM_VERSION,
      observations: gradeCopyDetailed(target, response).alignment,
      ...(evidence.responseMs === undefined
        ? {}
        : { responseMs: evidence.responseMs }),
      ...(evidence.keying === undefined
        ? {}
        : { keying: structuredClone(evidence.keying) }),
      ...(evidence.schedulerReason === undefined
        ? {}
        : { schedulerReason: evidence.schedulerReason }),
      ...this.settings,
      charWpmBand: this.charWpmBand,
      effectiveWpmBand: this.effectiveWpmBand,
    };
    const frozenSnapshot = structuredClone(snapshot);

    return this.enqueue(async () => {
      const nextAttemptCount = this.record.attemptCount + 1;
      const nextSession = this.activeSnapshot(
        frozenSnapshot,
        occurredAt,
        nextAttemptCount,
      );
      const result = await this.repository.commitPracticeAttempt({
        expectedSessionRevision: this.record.revision,
        session: nextSession,
        attempt,
      });
      this.record = result.session;
    });
  }

  async finish(snapshot: PracticePersistenceSnapshot): Promise<void> {
    await this.close("completed", snapshot);
  }

  async interrupt(snapshot: PracticePersistenceSnapshot): Promise<void> {
    await this.close("interrupted", snapshot);
  }

  async retry(): Promise<void> {
    await this.retryPending();
  }

  private async close(
    status: "completed" | "interrupted",
    snapshot: PracticePersistenceSnapshot,
  ): Promise<void> {
    if (this.terminal) return;
    if (this.closingStatus) {
      await this.retryPending();
      return;
    }
    this.closingStatus = status;
    this.cancelRenewal();
    const endedAt = captureDateTime(this.now());
    const frozenSnapshot = structuredClone(snapshot);
    await this.enqueue(async () => {
      const current = { ...this.record };
      delete current.ownerTabId;
      delete current.leaseExpiresAt;
      const completed: TrainingSessionRecord = {
        ...current,
        updatedAt: endedAt.utc,
        status,
        endedAt,
        activeMs: frozenSnapshot.activeMs,
        activeDateBuckets: frozenSnapshot.activeDateBuckets,
        completedCards: frozenSnapshot.completedCards,
        valid: isValidSessionForSource({
          source: current.source,
          activeMs: frozenSnapshot.activeMs,
          attemptCount: current.attemptCount,
          ...(current.finalizedAttemptCount === undefined
            ? {}
            : { finalizedAttemptCount: current.finalizedAttemptCount }),
        }),
        revision: current.revision + 1,
        finalizationKey: `${current.source}-${status}:${current.id}`,
      };
      const result =
        status === "completed"
          ? await this.repository.finalizeSession(
              completed,
              this.record.revision,
            )
          : await this.repository.interruptSession(
              completed,
              this.record.revision,
            );
      this.record = result.session;
      this.terminal = true;
    });
  }

  private activeSnapshot(
    snapshot: PracticePersistenceSnapshot,
    at: ReturnType<typeof captureDateTime>,
    attemptCount: number,
  ): TrainingSessionRecord {
    return {
      ...this.record,
      updatedAt: at.utc,
      activeMs: snapshot.activeMs,
      activeDateBuckets: snapshot.activeDateBuckets,
      attemptCount,
      finalizedAttemptCount: attemptCount,
      completedCards: snapshot.completedCards,
      valid: isValidSessionForSource({
        source: this.source,
        activeMs: snapshot.activeMs,
        attemptCount,
        finalizedAttemptCount: attemptCount,
      }),
      leaseExpiresAt: new Date(
        Date.parse(at.utc) + DEFAULT_LEASE_DURATION_MS,
      ).toISOString(),
      revision: this.record.revision + 1,
    };
  }

  private cancelRenewal(): void {
    if (this.leaseRenewalCanceled) return;
    this.leaseRenewalCanceled = true;
    this.cancelLeaseRenewal();
  }

  private enqueue(operation: () => Promise<void>): Promise<void> {
    this.queue.push(operation);
    return this.drain();
  }

  private drain(): Promise<void> {
    if (this.processing) return this.processing;
    const processing = (async () => {
      while (this.queue.length > 0) {
        await this.queue[0]!();
        this.queue.shift();
      }
    })();
    this.processing = processing;
    void processing
      .finally(() => {
        if (this.processing === processing) this.processing = undefined;
      })
      .catch(() => undefined);
    return processing;
  }

  private async retryPending(): Promise<void> {
    if (this.processing) {
      try {
        await this.processing;
      } catch {
        // The failed operation remains at the head of the queue for retry.
      }
    }
    await this.drain();
  }
}
