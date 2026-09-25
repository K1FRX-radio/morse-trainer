import { IDBKeyRange, indexedDB } from "fake-indexeddb";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_CURRICULUM_CONFIG } from "../content/curriculum-data.ts";
import { createInitialState } from "../core/curriculum.ts";
import { TrainerDatabase } from "./indexeddb.ts";
import { DurableLearnSession } from "./learn-persistence.ts";
import { DexieTrainingRepository } from "./repository.ts";

function clock(...values: string[]) {
  let index = 0;
  return () => new Date(values[Math.min(index++, values.length - 1)]);
}

async function setup() {
  const database = new TrainerDatabase({
    name: crypto.randomUUID(),
    indexedDB,
    IDBKeyRange,
  });
  const repository = new DexieTrainingRepository(database, {
    createId: () => "dataset-generation",
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
          completedCards: 2,
          curriculum: state,
          introductions: ["K", "M"],
        },
      );
      await session.finish({
        activeMs: 40000,
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
        activeMs: 20000,
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
        revision: 2,
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
});
