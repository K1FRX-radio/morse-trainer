import { IDBKeyRange, indexedDB } from "fake-indexeddb";
import { TrainerDatabase } from "./indexeddb.ts";
import { encodeKeyingTiming } from "./keying-timing.ts";
import { DurablePracticeSession } from "./practice-persistence.ts";
import { DexieTrainingRepository } from "./repository.ts";

function clock(...values: string[]) {
  let index = 0;
  return () => new Date(values[Math.min(index++, values.length - 1)]);
}

function snapshot(activeMs: number, completedCards: number) {
  return {
    activeMs,
    activeDateBuckets:
      activeMs === 0
        ? []
        : [
            {
              localDate: "2026-09-28",
              utcOffsetMinutes: 0,
              timeZone: "UTC",
              activeMs,
            },
          ],
    completedCards,
  };
}

async function setup() {
  const database = new TrainerDatabase({
    name: crypto.randomUUID(),
    indexedDB,
    IDBKeyRange,
  });
  const repository = new DexieTrainingRepository(database);
  await repository.open();
  return { database, repository };
}

const settings = {
  charWpm: 20,
  effectiveWpm: 12,
  toneHz: 600,
  noiseLevel: 0,
};

describe("DurablePracticeSession", () => {
  it("persists a completed imported-text session without attempts", async () => {
    const { database, repository } = await setup();
    const ids = ["imported-owner", "imported-session"];

    try {
      const session = await DurablePracticeSession.create(
        repository,
        {
          source: "imported-text-rx",
          activeCharacters: ["K", "M"],
          settings,
        },
        {
          now: clock("2026-09-28T11:00:00.000Z", "2026-09-28T11:00:45.000Z"),
          createId: () => ids.shift()!,
          scheduleLeaseRenewal: () => () => undefined,
        },
      );

      await session.finish(snapshot(45000, 0));

      expect(await database.sessions.get("imported-session")).toMatchObject({
        source: "imported-text-rx",
        mode: "imported-text-rx",
        status: "completed",
        activeMs: 45000,
        attemptCount: 0,
        finalizedAttemptCount: 0,
        completedCards: 0,
        valid: true,
      });
      expect(await database.attempts.count()).toBe(0);
      expect(await database.progressionEvents.count()).toBe(0);
    } finally {
      repository.close();
      await database.delete();
    }
  });

  it("persists interrupted imported-text sessions on interruption", async () => {
    const { database, repository } = await setup();
    const ids = ["imported-owner", "imported-session"];

    try {
      const session = await DurablePracticeSession.create(
        repository,
        {
          source: "imported-text-rx",
          activeCharacters: ["K", "M"],
          settings,
        },
        {
          now: clock("2026-09-28T11:30:00.000Z", "2026-09-28T11:30:10.000Z"),
          createId: () => ids.shift()!,
          scheduleLeaseRenewal: () => () => undefined,
        },
      );

      await session.interrupt(snapshot(10000, 0));

      expect(await database.sessions.get("imported-session")).toMatchObject({
        source: "imported-text-rx",
        mode: "imported-text-rx",
        status: "interrupted",
        activeMs: 10000,
        attemptCount: 0,
        finalizedAttemptCount: 0,
        valid: false,
      });
      expect(await database.attempts.count()).toBe(0);
      expect(await database.progressionEvents.count()).toBe(0);
    } finally {
      repository.close();
      await database.delete();
    }
  });

  it("persists a finalized Copy Practice attempt and session", async () => {
    const { database, repository } = await setup();
    const ids = ["copy-owner", "copy-session", "copy-attempt"];

    try {
      const session = await DurablePracticeSession.create(
        repository,
        {
          source: "copy-practice",
          activeCharacters: ["K", "M"],
          settings,
        },
        {
          now: clock(
            "2026-09-28T12:00:00.000Z",
            "2026-09-28T12:00:30.000Z",
            "2026-09-28T12:00:31.000Z",
          ),
          createId: () => ids.shift()!,
          scheduleLeaseRenewal: () => () => undefined,
        },
      );
      await session.recordAttempt(
        {
          exerciseType: "copy-group",
          target: "KMK",
          response: "KMM",
          assisted: true,
          replayed: true,
          responseMs: 2400,
        },
        snapshot(30000, 1),
      );
      await session.finish(snapshot(31000, 1));

      expect(await database.sessions.get("copy-session")).toMatchObject({
        source: "copy-practice",
        mode: "copy",
        status: "completed",
        activeMs: 31000,
        attemptCount: 1,
        finalizedAttemptCount: 1,
        completedCards: 1,
        valid: true,
        charWpmBand: 20,
        effectiveWpmBand: 12,
      });
      expect(await database.attempts.get("copy-attempt")).toMatchObject({
        source: "copy-practice",
        direction: "rx",
        exerciseType: "copy-group",
        normalizedTarget: "KMK",
        normalizedResponse: "KMM",
        correct: false,
        assisted: true,
        replayed: true,
        responseMs: 2400,
        charWpmBand: 20,
        effectiveWpmBand: 12,
      });
      expect(await database.curriculum.count()).toBe(0);
      expect(await database.introductions.count()).toBe(0);
    } finally {
      repository.close();
      await database.delete();
    }
  });

  it("persists bounded Send Practice timing as TX analytics", async () => {
    const { database, repository } = await setup();
    const ids = ["send-owner", "send-session", "send-attempt"];
    const keying = encodeKeyingTiming([60, 180], [60], 60);

    try {
      const session = await DurablePracticeSession.create(
        repository,
        {
          source: "send-practice",
          activeCharacters: ["K", "M"],
          settings,
        },
        {
          now: clock(
            "2026-09-28T13:00:00.000Z",
            "2026-09-28T13:00:10.000Z",
            "2026-09-28T13:00:11.000Z",
          ),
          createId: () => ids.shift()!,
          scheduleLeaseRenewal: () => () => undefined,
        },
      );
      await session.recordAttempt(
        {
          exerciseType: "send-character",
          target: "A",
          response: "A",
          assisted: false,
          replayed: false,
          schedulerReason: "WEAK_TX",
          keying,
        },
        snapshot(10000, 1),
      );
      await session.finish(snapshot(11000, 1));

      expect(await database.sessions.get("send-session")).toMatchObject({
        source: "send-practice",
        mode: "send",
        status: "completed",
        attemptCount: 1,
        valid: false,
      });
      expect(await database.attempts.get("send-attempt")).toMatchObject({
        source: "send-practice",
        direction: "tx",
        exerciseType: "send-character",
        correct: true,
        schedulerReason: "WEAK_TX",
        keying,
        charWpmBand: 20,
        effectiveWpmBand: 12,
      });
    } finally {
      repository.close();
      await database.delete();
    }
  });

  it("rejects attempt evidence for the other Practice source", async () => {
    const { database, repository } = await setup();
    const ids = ["owner", "session"];

    try {
      const session = await DurablePracticeSession.create(
        repository,
        {
          source: "copy-practice",
          activeCharacters: ["K", "M"],
          settings,
        },
        {
          now: clock("2026-09-28T14:00:00.000Z"),
          createId: () => ids.shift()!,
          scheduleLeaseRenewal: () => () => undefined,
        },
      );

      await expect(
        session.recordAttempt(
          {
            exerciseType: "send-character",
            target: "K",
            response: "K",
            assisted: false,
            replayed: false,
          },
          snapshot(1000, 1),
        ),
      ).rejects.toThrow(/does not match/);
      expect(await database.attempts.count()).toBe(0);
    } finally {
      repository.close();
      await database.delete();
    }
  });

  it("retries a failed attempt with the same stable identity", async () => {
    const { database, repository } = await setup();
    const ids = ["retry-owner", "retry-session", "retry-attempt"];
    const commit = vi.spyOn(repository, "commitPracticeAttempt");
    commit.mockRejectedValueOnce(new Error("storage unavailable"));

    try {
      const session = await DurablePracticeSession.create(
        repository,
        {
          source: "copy-practice",
          activeCharacters: ["K", "M"],
          settings,
        },
        {
          now: clock("2026-09-28T15:00:00.000Z", "2026-09-28T15:00:10.000Z"),
          createId: () => ids.shift()!,
          scheduleLeaseRenewal: () => () => undefined,
        },
      );
      const pending = session.recordAttempt(
        {
          exerciseType: "copy-character",
          target: "K",
          response: "K",
          assisted: false,
          replayed: false,
        },
        snapshot(10000, 1),
      );

      await expect(pending).rejects.toThrow("storage unavailable");
      await expect(session.retry()).resolves.toBeUndefined();
      expect(commit).toHaveBeenCalledTimes(2);
      expect(commit.mock.calls[0]?.[0].attempt.id).toBe("retry-attempt");
      expect(commit.mock.calls[1]?.[0].attempt.id).toBe("retry-attempt");
      expect(await database.attempts.count()).toBe(1);
    } finally {
      repository.close();
      await database.delete();
    }
  });
});
