import type {
  PracticeAttemptEvidence,
  PracticePersistenceSnapshot,
  PracticeSessionPersistence,
} from "../../data/practice-persistence.ts";

type FinalizationStatus = "completed" | "interrupted";

type AttemptWork = {
  evidence: PracticeAttemptEvidence;
  snapshot: PracticePersistenceSnapshot;
  submitted: boolean;
};

export class PracticeWorkQueue {
  private persistence: PracticeSessionPersistence | undefined;
  private startPromise: Promise<PracticeSessionPersistence> | undefined;
  private readonly attempts: AttemptWork[] = [];
  private processing: Promise<void> | undefined;
  private finalSnapshot: PracticePersistenceSnapshot | undefined;
  private finalStatus: FinalizationStatus = "completed";
  private terminal = false;

  constructor(
    private readonly createSession: () => Promise<PracticeSessionPersistence>,
  ) {}

  get hasPendingAttempts(): boolean {
    return this.attempts.length > 0;
  }

  get hasStarted(): boolean {
    return this.persistence !== undefined || this.startPromise !== undefined;
  }

  async start(): Promise<PracticeSessionPersistence> {
    if (this.persistence) return this.persistence;
    if (this.startPromise) return this.startPromise;

    const promise = this.createSession();
    this.startPromise = promise;
    try {
      const persistence = await promise;
      this.persistence = persistence;
      return persistence;
    } catch (error) {
      this.startPromise = undefined;
      throw error;
    }
  }

  enqueueAttempt(
    evidence: PracticeAttemptEvidence,
    snapshot: PracticePersistenceSnapshot,
  ): Promise<void> {
    this.attempts.push({
      evidence: structuredClone(evidence),
      snapshot: structuredClone(snapshot),
      submitted: false,
    });
    return this.drain();
  }

  requestFinalization(
    snapshot: PracticePersistenceSnapshot,
    status: FinalizationStatus = "completed",
  ): Promise<void> {
    if (this.terminal) return Promise.resolve();
    this.finalSnapshot = structuredClone(snapshot);
    this.finalStatus = status;
    return this.drain();
  }

  retry(): Promise<void> {
    if (this.attempts.length === 0 && this.finalSnapshot === undefined) {
      return this.start().then(() => undefined);
    }
    return this.drain();
  }

  private drain(): Promise<void> {
    if (this.processing) return this.processing;
    const processing = this.process();
    this.processing = processing;
    void processing
      .finally(() => {
        if (this.processing === processing) this.processing = undefined;
      })
      .catch(() => undefined);
    return processing;
  }

  private async process(): Promise<void> {
    while (this.attempts.length > 0) {
      const work = this.attempts[0]!;
      const persistence = await this.start();
      if (work.submitted) {
        await persistence.retry();
      } else {
        work.submitted = true;
        await persistence.recordAttempt(work.evidence, work.snapshot);
      }
      this.attempts.shift();
    }

    if (this.finalSnapshot !== undefined && !this.terminal) {
      const persistence = await this.start();
      if (this.finalStatus === "interrupted") {
        await persistence.interrupt(this.finalSnapshot);
      } else {
        await persistence.finish(this.finalSnapshot);
      }
      this.terminal = true;
    }
  }
}
