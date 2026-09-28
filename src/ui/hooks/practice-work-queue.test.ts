import { describe, expect, it, vi } from "vitest";
import type {
  PracticeAttemptEvidence,
  PracticePersistenceSnapshot,
  PracticeSessionPersistence,
} from "../../data/practice-persistence.ts";
import { PracticeWorkQueue } from "./practice-work-queue.ts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function persistence(): PracticeSessionPersistence {
  return {
    recordAttempt: vi.fn(() => Promise.resolve()),
    finish: vi.fn(() => Promise.resolve()),
    interrupt: vi.fn(() => Promise.resolve()),
    retry: vi.fn(() => Promise.resolve()),
  };
}

const evidence: PracticeAttemptEvidence = {
  exerciseType: "send-character",
  target: "T",
  response: "T",
  assisted: false,
  replayed: false,
};

const attemptSnapshot: PracticePersistenceSnapshot = {
  activeMs: 1000,
  activeDateBuckets: [
    { localDate: "2026-09-28", utcOffsetMinutes: 0, activeMs: 1000 },
  ],
  completedCards: 1,
};

const finalSnapshot: PracticePersistenceSnapshot = {
  activeMs: 2000,
  activeDateBuckets: [
    { localDate: "2026-09-28", utcOffsetMinutes: 0, activeMs: 2000 },
  ],
  completedCards: 1,
};

describe("PracticeWorkQueue", () => {
  it("retains the first Send attempt while session creation is pending", async () => {
    const pending = deferred<PracticeSessionPersistence>();
    const session = persistence();
    const queue = new PracticeWorkQueue(() => pending.promise);

    const attempt = queue.enqueueAttempt(evidence, attemptSnapshot);
    expect(queue.hasPendingAttempts).toBe(true);
    expect(session.recordAttempt).not.toHaveBeenCalled();
    pending.resolve(session);
    await attempt;

    expect(session.recordAttempt).toHaveBeenCalledOnce();
    expect(session.recordAttempt).toHaveBeenCalledWith(
      evidence,
      attemptSnapshot,
    );
    expect(queue.hasPendingAttempts).toBe(false);
  });

  it("retries initial creation and saves the retained attempt exactly once", async () => {
    const session = persistence();
    const createSession = vi
      .fn<() => Promise<PracticeSessionPersistence>>()
      .mockRejectedValueOnce(new Error("creation failed"))
      .mockResolvedValue(session);
    const queue = new PracticeWorkQueue(createSession);

    await expect(
      queue.enqueueAttempt(evidence, attemptSnapshot),
    ).rejects.toThrow("creation failed");
    expect(queue.hasPendingAttempts).toBe(true);
    await queue.retry();

    expect(createSession).toHaveBeenCalledTimes(2);
    expect(session.recordAttempt).toHaveBeenCalledOnce();
    expect(queue.hasPendingAttempts).toBe(false);
  });

  it("commits a pending-creation attempt before navigation finalization", async () => {
    const pending = deferred<PracticeSessionPersistence>();
    const order: string[] = [];
    const session = persistence();
    vi.mocked(session.recordAttempt).mockImplementation(async () => {
      order.push("attempt");
    });
    vi.mocked(session.finish).mockImplementation(async () => {
      order.push("finish");
    });
    const queue = new PracticeWorkQueue(() => pending.promise);

    const attempt = queue.enqueueAttempt(evidence, attemptSnapshot);
    const finish = queue.requestFinalization(finalSnapshot);
    pending.resolve(session);
    await Promise.all([attempt, finish]);

    expect(order).toEqual(["attempt", "finish"]);
    expect(session.finish).toHaveBeenCalledWith(finalSnapshot);
  });

  it("retains a failed attempt across navigation until retry succeeds", async () => {
    const session = persistence();
    vi.mocked(session.recordAttempt).mockRejectedValueOnce(
      new Error("write failed"),
    );
    vi.mocked(session.retry)
      .mockRejectedValueOnce(new Error("still unavailable"))
      .mockResolvedValueOnce();
    const queue = new PracticeWorkQueue(() => Promise.resolve(session));

    await expect(
      queue.enqueueAttempt(evidence, attemptSnapshot),
    ).rejects.toThrow("write failed");
    await expect(queue.requestFinalization(finalSnapshot)).rejects.toThrow(
      "still unavailable",
    );
    expect(session.finish).not.toHaveBeenCalled();
    await queue.retry();

    expect(session.retry).toHaveBeenCalledTimes(2);
    expect(session.finish).toHaveBeenCalledWith(finalSnapshot);
    expect(queue.hasPendingAttempts).toBe(false);
  });
});
