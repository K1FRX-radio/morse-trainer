import { IDBKeyRange, indexedDB } from "fake-indexeddb";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_CURRICULUM_CONFIG } from "../content/curriculum-data.ts";
import { createInitialState } from "../core/curriculum.ts";
import { createRng } from "../core/rng.ts";
import { evaluateAdvancementEvidence } from "../training/advancement.ts";
import { LearnSession } from "../training/learn-session.ts";
import type { ActiveTimeContext } from "../training/session-time.ts";
import { TrainerDatabase } from "./indexeddb.ts";
import { DurableLearnSession } from "./learn-persistence.ts";
import { DexieTrainingRepository } from "./repository.ts";

function clock(...values: string[]) {
  let index = 0;
  return () => new Date(values[Math.min(index++, values.length - 1)]);
}

function activeDateBuckets(activeMs: number) {
  return activeMs === 0
    ? []
    : [
        {
          localDate: "2026-09-25",
          utcOffsetMinutes: 0,
          timeZone: "UTC",
          activeMs,
        },
      ];
}

async function setup() {
  const database = new TrainerDatabase({
    name: crypto.randomUUID(),
    indexedDB,
    IDBKeyRange,
  });
  let id = 0;
  const repository = new DexieTrainingRepository(database, {
    createId: () => `repository-id-${++id}`,
  });
  await repository.open();
  return { database, repository };
}

describe("DurableLearnSession", () => {
  it("persists and finalizes a valid review stream for retry history", async () => {
    const { database, repository } = await setup();
    const state = createInitialState(DEFAULT_CURRICULUM_CONFIG);
    const ids = ["owner-1", "session-1", "attempt-1"];
    const now = clock(
      "2026-09-25T17:00:00.000Z",
      "2026-09-25T17:01:00.000Z",
      "2026-09-25T17:01:01.000Z",
    );

    try {
      const session = await DurableLearnSession.create(
        repository,
        {
          mode: "review",
          activeCharacters: ["K", "M"],
          settings: {
            charWpm: 20,
            effectiveWpm: 12,
            toneHz: 600,
            noiseLevel: 0,
          },
        },
        {
          now,
          createId: () => ids.shift()!,
          scheduleLeaseRenewal: () => () => undefined,
        },
      );
      const snapshot = {
        activeMs: 60000,
        activeDateBuckets: [
          {
            localDate: "2026-09-24",
            utcOffsetMinutes: 0,
            timeZone: "UTC",
            activeMs: 20000,
          },
          {
            localDate: "2026-09-25",
            utcOffsetMinutes: 0,
            timeZone: "UTC",
            activeMs: 40000,
          },
        ],
        completedCards: 0,
        curriculum: state,
        introductions: ["K", "M"],
      };
      await session.recordAttempt(
        {
          exerciseType: "continuous-copy",
          target: "KMKMKMKMKMKMKMKMKMKMKMKMKMKMKM",
          response: "KKKMKMKMKMKMKMKMKMKMKMKMKMKMKM",
          assisted: false,
          replayed: false,
          abandoned: false,
          durationMs: 60000,
          readinessReason: "LOW_OVERALL_ACCURACY",
        },
        snapshot,
      );
      await session.finish(snapshot);

      expect(await database.sessions.get("session-1")).toMatchObject({
        mode: "review",
        status: "completed",
        attemptCount: 1,
        completedCards: 0,
        activeMs: 60000,
        activeDateBuckets: snapshot.activeDateBuckets,
        valid: true,
        revision: 2,
        unlockedAtStart: ["K", "M"],
        unlockedAtEnd: ["K", "M"],
      });
      expect(await database.attempts.get("attempt-1")).toMatchObject({
        sessionId: "session-1",
        exerciseType: "continuous-copy",
        readinessReason: "LOW_OVERALL_ACCURACY",
        durationMs: 60000,
        charWpm: 20,
        effectiveWpm: 12,
      });
      await expect(
        repository.getRetryClassification(
          {
            activeCharacters: ["K", "M"],
            charWpm: 20,
            effectiveWpm: 12,
          },
          3,
        ),
      ).resolves.toMatchObject({ consecutiveAccuracyMisses: 1 });
    } finally {
      repository.close();
      await database.delete();
    }
  });

  it("accepts advancement with the finalized session evidence idempotently", async () => {
    const { database, repository } = await setup();
    const state = createInitialState(DEFAULT_CURRICULUM_CONFIG);
    const ids = [
      "owner-advancement",
      "session-advancement",
      "attempt-evidence",
    ];

    try {
      const session = await DurableLearnSession.create(
        repository,
        {
          mode: "learn",
          activeCharacters: ["K", "M"],
          settings: {
            charWpm: 20,
            effectiveWpm: 12,
            toneHz: 600,
            noiseLevel: 0,
          },
        },
        {
          now: clock(
            "2026-09-25T17:00:00.000Z",
            "2026-09-25T17:01:00.000Z",
            "2026-09-25T17:02:00.000Z",
          ),
          createId: () => ids.shift()!,
          scheduleLeaseRenewal: () => () => undefined,
        },
      );
      const snapshot = {
        activeMs: 60000,
        activeDateBuckets: activeDateBuckets(60000),
        completedCards: 1,
        curriculum: state,
        introductions: ["K", "M"],
      };
      const qualifyingTarget = `${"K".repeat(16)}${"M".repeat(8)}`;
      await session.recordAttempt(
        {
          exerciseType: "continuous-copy",
          target: qualifyingTarget,
          response: qualifyingTarget,
          assisted: false,
          replayed: false,
          abandoned: false,
          durationMs: 60000,
          readinessReason: "READY",
        },
        snapshot,
      );
      await session.finish(snapshot);
      const offeredAssessment = evaluateAdvancementEvidence(
        state,
        {
          abandoned: false,
          perCharacterResults: [
            ...Array.from({ length: 16 }, () => ({
              character: "K",
              correct: true,
            })),
            ...Array.from({ length: 8 }, () => ({
              character: "M",
              correct: true,
            })),
          ],
        },
        undefined,
        {
          charWpmBand: 20,
          effectiveWpmBand: 12,
        },
      );

      const accepted = await session.acceptAdvancement(
        {
          type: "character-unlocked",
          character: "U",
        },
        offeredAssessment,
      );
      const retried = await session.acceptAdvancement(
        {
          type: "character-unlocked",
          character: "U",
        },
        offeredAssessment,
      );

      expect(accepted.characters).toMatchObject([
        { character: "K", state: "mastered" },
        { character: "M", state: "mastered" },
        { character: "U", state: "learning" },
      ]);
      expect(retried).toEqual(accepted);
      expect(await database.progressionEvents.toArray()).toMatchObject([
        {
          idempotencyKey:
            "learn-advancement:session-advancement:attempt-evidence",
          sessionId: "session-advancement",
          evidenceAttemptId: "attempt-evidence",
          unlockedCharacter: "U",
        },
      ]);
      expect(await database.milestones.count()).toBe(3);
      expect(
        (await database.curriculum.get("curriculum-state"))?.characters.map(
          ({ character }) => character,
        ),
      ).toEqual(["K", "M", "U"]);
    } finally {
      repository.close();
      await database.delete();
    }
  });

  it("serializes ordinary card commits before finalization", async () => {
    const { database, repository } = await setup();
    const state = createInitialState(DEFAULT_CURRICULUM_CONFIG);
    const ids = ["owner-2", "session-2", "attempt-2", "attempt-3"];
    const now = clock(
      "2026-09-25T18:00:00.000Z",
      "2026-09-25T18:00:10.000Z",
      "2026-09-25T18:00:20.000Z",
      "2026-09-25T18:00:40.000Z",
    );

    try {
      const session = await DurableLearnSession.create(
        repository,
        {
          mode: "learn",
          activeCharacters: ["K", "M"],
          settings: {
            charWpm: 20,
            effectiveWpm: 12,
            toneHz: 600,
            noiseLevel: 0,
          },
        },
        {
          now,
          createId: () => ids.shift()!,
          scheduleLeaseRenewal: () => () => undefined,
        },
      );
      const first = session.recordAttempt(
        {
          exerciseType: "copy-character",
          target: "K",
          response: "K",
          assisted: false,
          replayed: false,
          abandoned: false,
        },
        {
          activeMs: 10000,
          activeDateBuckets: activeDateBuckets(10000),
          completedCards: 1,
          curriculum: state,
          introductions: ["K", "M"],
        },
      );
      const second = session.recordAttempt(
        {
          exerciseType: "copy-character",
          target: "M",
          response: "K",
          assisted: false,
          replayed: false,
          abandoned: false,
        },
        {
          activeMs: 20000,
          activeDateBuckets: activeDateBuckets(20000),
          completedCards: 2,
          curriculum: state,
          introductions: ["K", "M"],
        },
      );
      await session.finish({
        activeMs: 40000,
        activeDateBuckets: activeDateBuckets(40000),
        completedCards: 2,
        curriculum: state,
        introductions: ["K", "M"],
      });
      await Promise.all([first, second]);

      expect(await database.attempts.count()).toBe(2);
      expect(await database.sessions.get("session-2")).toMatchObject({
        status: "completed",
        attemptCount: 2,
        valid: true,
        revision: 3,
      });
      await expect(
        repository.getRetryClassification(
          {
            activeCharacters: ["K", "M"],
            charWpm: 20,
            effectiveWpm: 12,
          },
          3,
        ),
      ).resolves.toMatchObject({
        isolatedPerformance: {
          eligibleObservations: 2,
          eligibleCorrect: 1,
          accuracy: 0.5,
        },
      });
    } finally {
      repository.close();
      await database.delete();
    }
  });

  it("persists isolated responseMs and projects it into RX latency samples", async () => {
    const { database, repository } = await setup();
    const state = createInitialState(DEFAULT_CURRICULUM_CONFIG);
    const ids = ["owner-latency", "session-latency", "attempt-latency"];

    try {
      const session = await DurableLearnSession.create(
        repository,
        {
          mode: "learn",
          activeCharacters: ["K", "M"],
          settings: {
            charWpm: 20,
            effectiveWpm: 12,
            toneHz: 600,
            noiseLevel: 0,
          },
        },
        {
          now: clock(
            "2026-09-25T20:00:00.000Z",
            "2026-09-25T20:00:10.000Z",
            "2026-09-25T20:00:20.000Z",
          ),
          createId: () => ids.shift()!,
          scheduleLeaseRenewal: () => () => undefined,
        },
      );

      await session.recordAttempt(
        {
          exerciseType: "copy-character",
          target: "K",
          response: "K",
          assisted: false,
          replayed: false,
          abandoned: false,
          responseMs: 137,
        },
        {
          activeMs: 40_000,
          activeDateBuckets: activeDateBuckets(40_000),
          completedCards: 1,
          curriculum: state,
          introductions: ["K", "M"],
        },
      );

      const storedAttempt = await database.attempts.get("attempt-latency");
      expect(storedAttempt?.responseMs).toBe(137);

      await repository.rebuildProjections();
      const rows = await repository.listCharacterProjections({
        direction: "rx",
        character: "K",
        limit: 1,
      });
      expect(rows[0]?.recentIsolatedRxResponseMs).toEqual([137]);
    } finally {
      repository.close();
      await database.delete();
    }
  });

  it("retains an abandoned stream without making the session valid", async () => {
    const { database, repository } = await setup();
    const state = createInitialState(DEFAULT_CURRICULUM_CONFIG);
    const ids = ["owner-3", "session-3", "attempt-4"];
    const now = clock(
      "2026-09-25T19:00:00.000Z",
      "2026-09-25T19:01:00.000Z",
      "2026-09-25T19:01:01.000Z",
    );

    try {
      const session = await DurableLearnSession.create(
        repository,
        {
          mode: "review",
          activeCharacters: ["K", "M"],
          settings: {
            charWpm: 20,
            effectiveWpm: 12,
            toneHz: 600,
            noiseLevel: 0,
          },
        },
        {
          now,
          createId: () => ids.shift()!,
          scheduleLeaseRenewal: () => () => undefined,
        },
      );
      const snapshot = {
        activeMs: 60000,
        activeDateBuckets: activeDateBuckets(60000),
        completedCards: 0,
        curriculum: state,
        introductions: ["K", "M"],
      };
      await session.recordAttempt(
        {
          exerciseType: "continuous-copy",
          target: "KMKM",
          response: "K",
          assisted: false,
          replayed: false,
          abandoned: true,
          durationMs: 60000,
          readinessReason: "ABANDONED",
        },
        snapshot,
      );
      await session.finish(snapshot);

      expect(await database.attempts.get("attempt-4")).toMatchObject({
        abandoned: true,
        observations: [],
      });
      expect(await database.sessions.get("session-3")).toMatchObject({
        status: "completed",
        attemptCount: 1,
        finalizedAttemptCount: 0,
        valid: false,
      });
    } finally {
      repository.close();
      await database.delete();
    }
  });

  it("interrupts an active session after draining pending writes", async () => {
    const { database, repository } = await setup();
    const state = createInitialState(DEFAULT_CURRICULUM_CONFIG);
    const ids = ["owner-4", "session-4", "attempt-5"];
    const cancelRenewal = vi.fn();

    try {
      const session = await DurableLearnSession.create(
        repository,
        {
          mode: "learn",
          activeCharacters: ["K", "M"],
          settings: {
            charWpm: 20,
            effectiveWpm: 12,
            toneHz: 600,
            noiseLevel: 0,
          },
        },
        {
          now: clock(
            "2026-09-25T20:00:00.000Z",
            "2026-09-25T20:00:10.000Z",
            "2026-09-25T20:00:20.000Z",
          ),
          createId: () => ids.shift()!,
          scheduleLeaseRenewal: () => cancelRenewal,
        },
      );
      const snapshot = {
        activeMs: 30000,
        activeDateBuckets: activeDateBuckets(30000),
        completedCards: 1,
        curriculum: state,
        introductions: ["K", "M"],
      };
      void session.recordAttempt(
        {
          exerciseType: "copy-character",
          target: "K",
          response: "K",
          assisted: false,
          replayed: false,
          abandoned: false,
        },
        snapshot,
      );
      await session.interrupt(snapshot);

      expect(cancelRenewal).toHaveBeenCalledOnce();
      expect(await database.attempts.count()).toBe(1);
      expect(await database.sessions.get("session-4")).toMatchObject({
        status: "interrupted",
        attemptCount: 1,
        finalizedAttemptCount: 1,
        activeMs: 30000,
        valid: true,
        revision: 2,
      });
    } finally {
      repository.close();
      await database.delete();
    }
  });

  it("interrupts elapsed activity without inventing an attempt", async () => {
    const { database, repository } = await setup();
    const state = createInitialState(DEFAULT_CURRICULUM_CONFIG);
    const ids = ["owner-invalid", "session-invalid"];

    try {
      const session = await DurableLearnSession.create(
        repository,
        {
          mode: "learn",
          activeCharacters: ["K", "M"],
          settings: {
            charWpm: 20,
            effectiveWpm: 12,
            toneHz: 600,
            noiseLevel: 0,
          },
        },
        {
          now: clock("2026-09-25T20:00:00.000Z", "2026-09-25T20:00:40.000Z"),
          createId: () => ids.shift()!,
          scheduleLeaseRenewal: () => () => undefined,
        },
      );
      await session.interrupt({
        activeMs: 40000,
        activeDateBuckets: activeDateBuckets(40000),
        completedCards: 0,
        curriculum: state,
        introductions: ["K", "M"],
      });

      expect(await database.attempts.count()).toBe(0);
      expect(await database.sessions.get("session-invalid")).toMatchObject({
        status: "interrupted",
        activeMs: 40000,
        attemptCount: 0,
        finalizedAttemptCount: 0,
        valid: false,
      });
    } finally {
      repository.close();
      await database.delete();
    }
  });

  it("retries a failed finalization with the same operation", async () => {
    const { database, repository } = await setup();
    const state = createInitialState(DEFAULT_CURRICULUM_CONFIG);
    const ids = ["owner-5", "session-5"];
    const finalize = vi.spyOn(repository, "finalizeSession");
    finalize.mockRejectedValueOnce(new Error("storage unavailable"));

    try {
      const session = await DurableLearnSession.create(
        repository,
        {
          mode: "review",
          activeCharacters: ["K", "M"],
          settings: {
            charWpm: 20,
            effectiveWpm: 12,
            toneHz: 600,
            noiseLevel: 0,
          },
        },
        {
          now: clock("2026-09-25T21:00:00.000Z", "2026-09-25T21:01:00.000Z"),
          createId: () => ids.shift()!,
          scheduleLeaseRenewal: () => () => undefined,
        },
      );
      const snapshot = {
        activeMs: 60000,
        activeDateBuckets: activeDateBuckets(60000),
        completedCards: 0,
        curriculum: state,
        introductions: ["K", "M"],
      };

      await expect(session.finish(snapshot)).rejects.toThrow(
        "storage unavailable",
      );
      await expect(session.finish(snapshot)).resolves.toBeUndefined();
      expect(finalize).toHaveBeenCalledTimes(2);
      expect(await database.sessions.get("session-5")).toMatchObject({
        status: "completed",
        revision: 1,
      });
    } finally {
      repository.close();
      await database.delete();
    }
  });

  it("keeps a failed attempt retryable and drains it exactly once on success", async () => {
    const { database, repository } = await setup();
    const state = createInitialState(DEFAULT_CURRICULUM_CONFIG);
    const ids = ["owner-6", "session-6", "attempt-6"];
    const commit = vi.spyOn(repository, "commitLearnAttempt");
    commit.mockRejectedValueOnce(new Error("storage unavailable"));

    try {
      const session = await DurableLearnSession.create(
        repository,
        {
          mode: "learn",
          activeCharacters: ["K", "M"],
          settings: {
            charWpm: 20,
            effectiveWpm: 12,
            toneHz: 600,
            noiseLevel: 0,
          },
        },
        {
          now: clock("2026-09-25T22:00:00.000Z", "2026-09-25T22:00:10.000Z"),
          createId: () => ids.shift()!,
          scheduleLeaseRenewal: () => () => undefined,
        },
      );

      const failed = session.recordAttempt(
        {
          exerciseType: "copy-character",
          target: "K",
          response: "K",
          assisted: false,
          replayed: false,
          abandoned: false,
        },
        {
          activeMs: 10000,
          activeDateBuckets: activeDateBuckets(10000),
          completedCards: 1,
          curriculum: state,
          introductions: ["K", "M"],
        },
      );

      await expect(failed).rejects.toThrow("storage unavailable");
      await expect(session.retry()).resolves.toBeUndefined();

      expect(commit).toHaveBeenCalledTimes(2);
      expect(commit.mock.calls[0]?.[0].attempt.id).toBe("attempt-6");
      expect(commit.mock.calls[1]?.[0].attempt.id).toBe("attempt-6");
      expect(await database.attempts.count()).toBe(1);
    } finally {
      repository.close();
      await database.delete();
    }
  });

  it("keeps a deterministically failing attempt queued across repeated retries", async () => {
    const { database, repository } = await setup();
    const state = createInitialState(DEFAULT_CURRICULUM_CONFIG);
    const ids = ["owner-7", "session-7", "attempt-7"];
    const commit = vi.spyOn(repository, "commitLearnAttempt");
    commit.mockRejectedValueOnce(new Error("storage unavailable"));
    commit.mockRejectedValueOnce(new Error("storage unavailable"));
    commit.mockRejectedValueOnce(new Error("storage unavailable"));

    try {
      const session = await DurableLearnSession.create(
        repository,
        {
          mode: "learn",
          activeCharacters: ["K", "M"],
          settings: {
            charWpm: 20,
            effectiveWpm: 12,
            toneHz: 600,
            noiseLevel: 0,
          },
        },
        {
          now: clock("2026-09-25T23:00:00.000Z", "2026-09-25T23:00:10.000Z"),
          createId: () => ids.shift()!,
          scheduleLeaseRenewal: () => () => undefined,
        },
      );

      const failed = session.recordAttempt(
        {
          exerciseType: "copy-character",
          target: "K",
          response: "K",
          assisted: false,
          replayed: false,
          abandoned: false,
        },
        {
          activeMs: 10000,
          activeDateBuckets: activeDateBuckets(10000),
          completedCards: 1,
          curriculum: state,
          introductions: ["K", "M"],
        },
      );

      await expect(failed).rejects.toThrow("storage unavailable");
      await expect(session.retry()).rejects.toThrow("storage unavailable");
      await expect(session.retry()).rejects.toThrow("storage unavailable");

      expect(commit).toHaveBeenCalledTimes(3);

      commit.mockRestore();
      await expect(session.retry()).resolves.toBeUndefined();
      expect(await database.attempts.count()).toBe(1);
    } finally {
      repository.close();
      await database.delete();
    }
  });

  it("preserves queued operations behind a failed head in order", async () => {
    const { database, repository } = await setup();
    const state = createInitialState(DEFAULT_CURRICULUM_CONFIG);
    const ids = ["owner-8", "session-8", "attempt-8a", "attempt-8b"];
    let rejectHead: ((error: Error) => void) | undefined;
    const commit = vi.spyOn(repository, "commitLearnAttempt");
    commit.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectHead = reject;
        }),
    );

    try {
      const session = await DurableLearnSession.create(
        repository,
        {
          mode: "learn",
          activeCharacters: ["K", "M"],
          settings: {
            charWpm: 20,
            effectiveWpm: 12,
            toneHz: 600,
            noiseLevel: 0,
          },
        },
        {
          now: clock(
            "2026-09-26T00:00:00.000Z",
            "2026-09-26T00:00:10.000Z",
            "2026-09-26T00:00:20.000Z",
          ),
          createId: () => ids.shift()!,
          scheduleLeaseRenewal: () => () => undefined,
        },
      );

      const first = session.recordAttempt(
        {
          exerciseType: "copy-character",
          target: "K",
          response: "K",
          assisted: false,
          replayed: false,
          abandoned: false,
        },
        {
          activeMs: 10000,
          activeDateBuckets: activeDateBuckets(10000),
          completedCards: 1,
          curriculum: state,
          introductions: ["K", "M"],
        },
      );
      const second = session.recordAttempt(
        {
          exerciseType: "copy-character",
          target: "M",
          response: "M",
          assisted: false,
          replayed: false,
          abandoned: false,
        },
        {
          activeMs: 20000,
          activeDateBuckets: activeDateBuckets(20000),
          completedCards: 2,
          curriculum: state,
          introductions: ["K", "M"],
        },
      );

      rejectHead?.(new Error("storage unavailable"));
      await expect(first).rejects.toThrow("storage unavailable");
      await expect(second).rejects.toThrow("storage unavailable");

      await expect(session.retry()).resolves.toBeUndefined();

      expect(commit).toHaveBeenCalledTimes(3);
      expect(commit.mock.calls[0]?.[0].attempt.id).toBe("attempt-8a");
      expect(commit.mock.calls[1]?.[0].attempt.id).toBe("attempt-8a");
      expect(commit.mock.calls[2]?.[0].attempt.id).toBe("attempt-8b");
      expect(await database.attempts.count()).toBe(2);
    } finally {
      repository.close();
      await database.delete();
    }
  });

  it("rejects malformed active-time snapshots before enqueue and does not wedge later attempts", async () => {
    const { database, repository } = await setup();
    const state = createInitialState(DEFAULT_CURRICULUM_CONFIG);
    const ids = ["owner-9", "session-9", "attempt-9"];

    try {
      const session = await DurableLearnSession.create(
        repository,
        {
          mode: "learn",
          activeCharacters: ["K", "M"],
          settings: {
            charWpm: 20,
            effectiveWpm: 12,
            toneHz: 600,
            noiseLevel: 0,
          },
        },
        {
          now: clock("2026-09-26T01:00:00.000Z", "2026-09-26T01:00:10.000Z"),
          createId: () => ids.shift()!,
          scheduleLeaseRenewal: () => () => undefined,
        },
      );

      await expect(
        session.recordAttempt(
          {
            exerciseType: "copy-character",
            target: "K",
            response: "K",
            assisted: false,
            replayed: false,
            abandoned: false,
          },
          {
            activeMs: 10000,
            activeDateBuckets: activeDateBuckets(9000),
            completedCards: 1,
            curriculum: state,
            introductions: ["K", "M"],
          },
        ),
      ).rejects.toThrow("activeDateBuckets sum");

      await expect(session.retry()).rejects.toThrow("activeDateBuckets sum");
      expect(await database.attempts.count()).toBe(0);

      await session.recordAttempt(
        {
          exerciseType: "copy-character",
          target: "K",
          response: "K",
          assisted: false,
          replayed: false,
          abandoned: false,
        },
        {
          activeMs: 11000,
          activeDateBuckets: activeDateBuckets(11000),
          completedCards: 2,
          curriculum: state,
          introductions: ["K", "M"],
        },
      );

      expect(await database.attempts.count()).toBe(1);
      expect(await database.attempts.get("attempt-9")).toMatchObject({
        normalizedTarget: "K",
        normalizedResponse: "K",
      });
    } finally {
      repository.close();
      await database.delete();
    }
  });

  it("keeps malformed finalization preflight non-retryable and leaves session active", async () => {
    const { database, repository } = await setup();
    const state = createInitialState(DEFAULT_CURRICULUM_CONFIG);
    const ids = ["owner-11", "session-11"];
    const cancelRenewal = vi.fn();

    try {
      const session = await DurableLearnSession.create(
        repository,
        {
          mode: "learn",
          activeCharacters: ["K", "M"],
          settings: {
            charWpm: 20,
            effectiveWpm: 12,
            toneHz: 600,
            noiseLevel: 0,
          },
        },
        {
          now: clock("2026-09-26T03:00:00.000Z", "2026-09-26T03:00:10.000Z"),
          createId: () => ids.shift()!,
          scheduleLeaseRenewal: () => cancelRenewal,
        },
      );

      await expect(
        session.finish({
          activeMs: 10000,
          activeDateBuckets: activeDateBuckets(9000),
          completedCards: 0,
          curriculum: state,
          introductions: ["K", "M"],
        }),
      ).rejects.toThrow("activeDateBuckets sum");

      await expect(session.retry()).rejects.toThrow("activeDateBuckets sum");

      expect(cancelRenewal).not.toHaveBeenCalled();
      const persistedSession = await database.sessions.get("session-11");
      expect(persistedSession).toMatchObject({
        status: "active",
        attemptCount: 0,
        finalizedAttemptCount: 0,
        revision: 0,
      });
      expect(await database.attempts.count()).toBe(0);
    } finally {
      repository.close();
      await database.delete();
    }
  });

  it("persists ordinary Learn attempts with consistent active-time totals", async () => {
    const { database, repository } = await setup();
    const state = createInitialState(DEFAULT_CURRICULUM_CONFIG);
    const ids = ["owner-10", "session-10", "attempt-10"];
    const startUtc = Date.parse("2026-11-01T05:59:59.400Z");
    let monotonic = 0;
    const now = () => monotonic;
    const wallNow = () => new Date(startUtc + monotonic);
    const captureAt = (date: Date): ActiveTimeContext => {
      const instant = date.getTime();
      const offsetMinutes =
        instant >= Date.parse("2026-11-01T06:00:00.000Z") ? -300 : -240;
      const local = new Date(instant + offsetMinutes * 60000);
      return {
        utc: date.toISOString(),
        localDate: local.toISOString().slice(0, 10),
        utcOffsetMinutes: offsetMinutes,
        timeZone: "America/New_York",
      };
    };

    try {
      const durable = await DurableLearnSession.create(
        repository,
        {
          mode: "learn",
          activeCharacters: ["K", "M"],
          settings: {
            charWpm: 20,
            effectiveWpm: 12,
            toneHz: 600,
            noiseLevel: 0,
          },
        },
        {
          now: clock(
            "2026-09-26T02:00:00.000Z",
            "2026-09-26T02:00:10.000Z",
            "2026-09-26T02:00:20.000Z",
          ),
          createId: () => ids.shift()!,
          scheduleLeaseRenewal: () => () => undefined,
        },
      );

      const learn = new LearnSession({
        state,
        rng: createRng(42),
        now,
        wallNow,
        captureAt,
      });
      learn.start();

      monotonic += 2.25;
      const event = learn.next();
      if (event?.type !== "introduce") {
        throw new Error("expected first Learn event to be introduce");
      }
      learn.submit("");
      monotonic += 8.5;

      await durable.recordAttempt(
        {
          exerciseType: "copy-character",
          target: "K",
          response: "K",
          assisted: false,
          replayed: false,
          abandoned: false,
        },
        {
          ...learn.activeTimeSnapshot,
          completedCards: learn.completedCards,
          curriculum: state,
          introductions: learn.completedIntroductions,
        },
      );

      const persisted = await database.sessions.get("session-10");
      const bucketTotal = persisted?.activeDateBuckets.reduce(
        (total, bucket) => total + bucket.activeMs,
        0,
      );
      expect(bucketTotal).toBeDefined();
      expect(
        Math.abs((bucketTotal ?? 0) - (persisted?.activeMs ?? 0)),
      ).toBeLessThanOrEqual(0.001);
    } finally {
      repository.close();
      await database.delete();
    }
  });
});
