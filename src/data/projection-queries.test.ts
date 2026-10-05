import { IDBKeyRange, indexedDB } from "fake-indexeddb";
import { TrainerDatabase } from "./indexeddb.ts";
import {
  DexieTrainingRepository,
  MAX_PROJECTION_QUERY_LIMIT,
} from "./repository.ts";

describe("DexieTrainingRepository projection queries", () => {
  it("returns daily projections with inclusive bounds in ascending local-date order", async () => {
    const { database, repository } = makeRepository();

    try {
      await repository.open();
      await database.dailyProjections.bulkPut([
        daily("2026-09-23", 1),
        daily("2026-09-24", 2),
        daily("2026-09-25", 3),
        daily("2026-09-26", 4),
      ]);

      const rows = await repository.listDailyProjections({
        fromLocalDate: "2026-09-24",
        toLocalDate: "2026-09-25",
        limit: 10,
      });

      expect(rows.map((row) => row.localDate)).toEqual([
        "2026-09-24",
        "2026-09-25",
      ]);
    } finally {
      repository.close();
      await database.delete();
    }
  });

  it("computes dashboard aggregate with all-time totals and long streaks", async () => {
    const { database, repository } = makeRepository();

    try {
      await repository.open();
      const rows = Array.from({ length: 40 }, (_, index) => {
        const date = new Date(Date.UTC(2026, 8, 1 + index));
        const localDate = date.toISOString().slice(0, 10);
        return {
          id: `daily:${localDate}`,
          schemaVersion: 1 as const,
          updatedAt: "2026-10-04T18:00:00.000Z",
          projectionVersion: 1 as const,
          localDate,
          activeMs: 60_000,
          sessionCount: 1,
          attemptCount: 2,
          rxCorrect: 1,
          rxTotal: 1,
          txCorrect: 1,
          txTotal: 1,
          effectiveWpmTotal: 12,
          effectiveWpmSamples: 1,
        };
      });

      await database.dailyProjections.bulkPut(rows);

      const trendRows = await repository.listDailyProjections({
        fromLocalDate: "2026-09-11",
        toLocalDate: "2026-10-10",
        limit: 30,
      });
      expect(trendRows).toHaveLength(30);

      const aggregate = await repository.getDashboardAggregate({
        toLocalDate: "2026-10-04",
      });

      expect(aggregate.totalSessions).toBe(34);
      expect(aggregate.totalAttempts).toBe(68);
      expect(aggregate.practiceDayCount).toBe(34);
      expect(aggregate.currentStreakDays).toBe(34);
      expect(aggregate.longestStreakDays).toBe(34);
      expect(aggregate.todaySessionCount).toBe(1);
      expect(aggregate.todayActiveMs).toBe(60_000);
    } finally {
      repository.close();
      await database.delete();
    }
  });

  it("enforces daily limits and rejects invalid date ranges", async () => {
    const { database, repository } = makeRepository();

    try {
      await repository.open();
      await database.dailyProjections.bulkPut([
        daily("2026-09-24", 1),
        daily("2026-09-25", 2),
      ]);

      await expect(
        repository.listDailyProjections({
          fromLocalDate: "2026-09-24",
          toLocalDate: "2026-09-25",
          limit: 1,
        }),
      ).resolves.toHaveLength(1);

      await expect(
        repository.listDailyProjections({
          fromLocalDate: "2026-09-26",
          toLocalDate: "2026-09-25",
          limit: 1,
        }),
      ).rejects.toThrow(
        /fromLocalDate must be less than or equal to toLocalDate/,
      );
    } finally {
      repository.close();
      await database.delete();
    }
  });

  it("separates character projections by direction and supports specific-character filtering", async () => {
    const { database, repository } = makeRepository();

    try {
      await repository.open();
      await database.characterProjections.bulkPut([
        character("K", "rx", "attempt-rx-k"),
        character("K", "tx", "attempt-tx-k"),
        character("M", "rx", "attempt-rx-m"),
      ]);

      const rxRows = await repository.listCharacterProjections({
        direction: "rx",
        limit: 10,
      });
      expect(rxRows.map((row) => `${row.character}:${row.direction}`)).toEqual([
        "K:rx",
        "M:rx",
      ]);

      const onlyK = await repository.listCharacterProjections({
        direction: "rx",
        character: "K",
        limit: 10,
      });
      expect(onlyK.map((row) => `${row.character}:${row.direction}`)).toEqual([
        "K:rx",
      ]);
    } finally {
      repository.close();
      await database.delete();
    }
  });

  it("orders confusion projections deterministically and applies limits", async () => {
    const { database, repository } = makeRepository();

    try {
      await repository.open();
      await database.confusionProjections.bulkPut([
        confusion("M", "K", 5),
        confusion("A", "B", 5),
        confusion("Z", "Y", 2),
      ]);

      const rows = await repository.listConfusionProjections({ limit: 2 });
      expect(
        rows.map((row) => `${row.target}:${row.answer}:${row.count}`),
      ).toEqual(["A:B:5", "M:K:5"]);
    } finally {
      repository.close();
      await database.delete();
    }
  });

  it("orders milestones by most recent occurrence and applies limits", async () => {
    const { database, repository } = makeRepository();

    try {
      await repository.open();
      await database.milestones.bulkPut([
        milestone("m1", "character-unlocked", "2026-09-24T10:00:00.000Z", "M"),
        milestone("m2", "character-mastered", "2026-09-24T11:00:00.000Z", "K"),
        milestone("m3", "curriculum-completed", "2026-09-24T11:00:00.000Z"),
      ]);

      const rows = await repository.listMilestones({ limit: 2 });
      expect(rows.map((row) => row.id)).toEqual(["m3", "m2"]);
    } finally {
      repository.close();
      await database.delete();
    }
  });

  it("derives current-band character speed proficiency from authoritative attempts", async () => {
    const { database, repository } = makeRepository();

    try {
      await repository.open();
      await database.attempts.bulkPut([
        speedAttempt({
          id: "k20-1",
          occurredAtUtc: "2026-09-24T09:00:00.000Z",
          direction: "rx",
          exerciseType: "copy-character",
          target: "K",
          answer: "K",
          correct: true,
          charWpmBand: 20,
        }),
        speedAttempt({
          id: "k25-1",
          occurredAtUtc: "2026-09-24T09:01:00.000Z",
          direction: "rx",
          exerciseType: "copy-group",
          source: "copy-practice",
          target: "K",
          answer: "M",
          correct: false,
          charWpmBand: 25,
        }),
        speedAttempt({
          id: "m20-1",
          occurredAtUtc: "2026-09-24T09:02:00.000Z",
          direction: "rx",
          exerciseType: "continuous-copy",
          source: "learn",
          target: "M",
          answer: "M",
          correct: true,
          charWpmBand: 20,
        }),
        speedAttempt({
          id: "tx-ignored",
          occurredAtUtc: "2026-09-24T09:03:00.000Z",
          direction: "tx",
          exerciseType: "send-character",
          target: "K",
          answer: "K",
          correct: true,
          charWpmBand: 20,
        }),
        speedAttempt({
          id: "assisted-ignored",
          occurredAtUtc: "2026-09-24T09:04:00.000Z",
          direction: "rx",
          exerciseType: "copy-character",
          target: "K",
          answer: "K",
          correct: true,
          assisted: true,
          charWpmBand: 20,
        }),
      ]);

      const rows = await repository.listCharacterSpeedProficiency({
        charWpmBand: 20,
        limit: 10,
      });

      expect(rows).toEqual([
        {
          character: "K",
          band: 20,
          attempts: 1,
          correct: 1,
          weightedAttempts: 1.5,
          weightedCorrect: 1,
        },
        {
          character: "M",
          band: 20,
          attempts: 1,
          correct: 1,
          weightedAttempts: 1,
          weightedCorrect: 1,
        },
      ]);

      const filtered = await repository.listCharacterSpeedProficiency({
        charWpmBand: 20,
        limit: 1,
        characters: ["M", "", "Z"],
      });
      expect(filtered).toEqual([
        {
          character: "M",
          band: 20,
          attempts: 1,
          correct: 1,
          weightedAttempts: 1,
          weightedCorrect: 1,
        },
      ]);
    } finally {
      repository.close();
      await database.delete();
    }
  });

  it("keeps bounded windows independent per character source speed band", async () => {
    const { database, repository } = makeRepository();

    try {
      await repository.open();

      await database.attempts.bulkPut([
        speedAttempt({
          id: "k20-old-1",
          occurredAtUtc: "2026-09-24T10:00:00.000Z",
          direction: "rx",
          exerciseType: "copy-character",
          target: "K",
          answer: "M",
          correct: false,
          charWpmBand: 20,
        }),
        speedAttempt({
          id: "k20-old-2",
          occurredAtUtc: "2026-09-24T10:01:00.000Z",
          direction: "rx",
          exerciseType: "copy-character",
          target: "K",
          answer: "K",
          correct: true,
          charWpmBand: 20,
        }),
        speedAttempt({
          id: "k40-1",
          occurredAtUtc: "2026-09-24T10:02:00.000Z",
          direction: "rx",
          exerciseType: "copy-character",
          target: "K",
          answer: "K",
          correct: true,
          charWpmBand: 40,
        }),
        speedAttempt({
          id: "k40-2",
          occurredAtUtc: "2026-09-24T10:03:00.000Z",
          direction: "rx",
          exerciseType: "copy-character",
          target: "K",
          answer: "K",
          correct: true,
          charWpmBand: 40,
        }),
        speedAttempt({
          id: "k40-3",
          occurredAtUtc: "2026-09-24T10:04:00.000Z",
          direction: "rx",
          exerciseType: "copy-character",
          target: "K",
          answer: "K",
          correct: true,
          charWpmBand: 40,
        }),
        speedAttempt({
          id: "k20-new-1",
          occurredAtUtc: "2026-09-24T10:05:00.000Z",
          direction: "rx",
          exerciseType: "copy-character",
          target: "K",
          answer: "K",
          correct: true,
          charWpmBand: 20,
        }),
        speedAttempt({
          id: "k20-new-2",
          occurredAtUtc: "2026-09-24T10:06:00.000Z",
          direction: "rx",
          exerciseType: "copy-character",
          target: "K",
          answer: "K",
          correct: true,
          charWpmBand: 20,
        }),
      ]);

      const rows = await repository.listCharacterSpeedProficiency({
        charWpmBand: 20,
        limit: 10,
        perCharacterWindow: 2,
      });

      expect(rows).toEqual([
        {
          character: "K",
          band: 20,
          attempts: 2,
          correct: 2,
          weightedAttempts: 2,
          weightedCorrect: 2,
        },
      ]);
    } finally {
      repository.close();
      await database.delete();
    }
  });

  it("rejects non-positive and oversized query limits", async () => {
    const { database, repository } = makeRepository();

    try {
      await repository.open();

      await expect(
        repository.listConfusionProjections({ limit: 0 }),
      ).rejects.toThrow(/positive integer/);

      await expect(repository.listMilestones({ limit: 0 })).rejects.toThrow(
        /positive integer/,
      );

      await expect(
        repository.listCharacterSpeedProficiency({
          charWpmBand: 20,
          limit: 0,
        }),
      ).rejects.toThrow(/positive integer/);

      await expect(
        repository.listCharacterSpeedProficiency({
          charWpmBand: 20,
          limit: 1,
          perCharacterWindow: 0,
        }),
      ).rejects.toThrow(/perCharacterWindow must be a positive integer/);

      await expect(
        repository.listConfusionProjections({
          limit: MAX_PROJECTION_QUERY_LIMIT + 1,
        }),
      ).rejects.toThrow(new RegExp(String(MAX_PROJECTION_QUERY_LIMIT)));

      await expect(
        repository.listMilestones({
          limit: MAX_PROJECTION_QUERY_LIMIT + 1,
        }),
      ).rejects.toThrow(new RegExp(String(MAX_PROJECTION_QUERY_LIMIT)));

      await expect(
        repository.listCharacterSpeedProficiency({
          charWpmBand: 20,
          limit: MAX_PROJECTION_QUERY_LIMIT + 1,
        }),
      ).rejects.toThrow(new RegExp(String(MAX_PROJECTION_QUERY_LIMIT)));
    } finally {
      repository.close();
      await database.delete();
    }
  });

  it("returns projection records that callers can mutate safely", async () => {
    const { database, repository } = makeRepository();

    try {
      await repository.open();
      await database.characterProjections.put(
        character("K", "rx", "attempt-original"),
      );

      const first = await repository.listCharacterProjections({
        direction: "rx",
        limit: 10,
      });
      first[0].character = "Z";
      first[0].recent[0].attemptId = "changed-by-caller";

      const second = await repository.listCharacterProjections({
        direction: "rx",
        limit: 10,
      });
      expect(second[0].character).toBe("K");
      expect(second[0].recent[0].attemptId).toBe("attempt-original");
    } finally {
      repository.close();
      await database.delete();
    }
  });

  it("returns empty results when no rows match", async () => {
    const { database, repository } = makeRepository();

    try {
      await repository.open();

      await expect(
        repository.listDailyProjections({
          fromLocalDate: "2026-09-24",
          toLocalDate: "2026-09-24",
          limit: 5,
        }),
      ).resolves.toEqual([]);

      await expect(
        repository.listCharacterProjections({ direction: "tx", limit: 5 }),
      ).resolves.toEqual([]);

      await expect(
        repository.listConfusionProjections({ limit: 5 }),
      ).resolves.toEqual([]);

      await expect(
        repository.listCharacterSpeedProficiency({
          charWpmBand: 20,
          limit: 5,
        }),
      ).resolves.toEqual([]);
    } finally {
      repository.close();
      await database.delete();
    }
  });
});

function makeRepository(): {
  database: TrainerDatabase;
  repository: DexieTrainingRepository;
} {
  const database = new TrainerDatabase({
    name: crypto.randomUUID(),
    indexedDB,
    IDBKeyRange,
  });
  const repository = new DexieTrainingRepository(database, {
    now: () => new Date("2026-09-24T18:00:00.000Z"),
  });

  return { database, repository };
}

function daily(localDate: string, seed: number) {
  return {
    id: `daily:${localDate}`,
    schemaVersion: 1 as const,
    updatedAt: "2026-09-24T18:00:00.000Z",
    projectionVersion: 1 as const,
    localDate,
    activeMs: seed,
    sessionCount: seed,
    attemptCount: seed,
    rxCorrect: seed,
    rxTotal: seed,
    txCorrect: seed,
    txTotal: seed,
    effectiveWpmTotal: seed,
    effectiveWpmSamples: seed,
  };
}

function character(
  characterName: string,
  direction: "rx" | "tx",
  attemptId: string,
) {
  return {
    id: `character:${characterName}:${direction}`,
    schemaVersion: 1 as const,
    updatedAt: "2026-09-24T18:00:00.000Z",
    projectionVersion: 1 as const,
    character: characterName,
    direction,
    recent: [
      {
        attemptId,
        occurredAt: {
          utc: "2026-09-24T18:00:00.000Z",
          localDate: "2026-09-24",
          utcOffsetMinutes: 0,
          timeZone: "UTC",
        },
        correct: true,
        kind: "match" as const,
        answer: characterName,
        responseMs: 100,
      },
    ],
  };
}

function confusion(target: string, answer: string, count: number) {
  return {
    id: `confusion:${target}:${answer}`,
    schemaVersion: 1 as const,
    updatedAt: "2026-09-24T18:00:00.000Z",
    projectionVersion: 1 as const,
    target,
    answer,
    count,
  };
}

function milestone(
  id: string,
  type: "character-mastered" | "character-unlocked" | "curriculum-completed",
  occurredAtUtc: string,
  character?: string,
) {
  return {
    id,
    schemaVersion: 1 as const,
    updatedAt: occurredAtUtc,
    idempotencyKey: `key:${id}`,
    eventId: `event:${id}`,
    type,
    occurredAt: {
      utc: occurredAtUtc,
      localDate: "2026-09-24",
      utcOffsetMinutes: 0,
      timeZone: "UTC",
    },
    ...(character === undefined ? {} : { character }),
    migrationDerived: false,
  };
}

function speedAttempt(overrides: {
  id: string;
  occurredAtUtc: string;
  direction: "rx" | "tx";
  exerciseType:
    | "copy-character"
    | "copy-group"
    | "copy-word"
    | "continuous-copy"
    | "send-character"
    | "send-group"
    | "send-word";
  target: string;
  answer: string;
  correct: boolean;
  source?: "learn" | "copy-practice" | "send-practice";
  assisted?: boolean;
  replayed?: boolean;
  abandoned?: boolean;
  charWpmBand?: 10 | 15 | 20 | 25 | 30 | 35 | 40;
}) {
  return {
    id: overrides.id,
    schemaVersion: 1 as const,
    updatedAt: overrides.occurredAtUtc,
    sessionId: "session-1",
    occurredAt: {
      utc: overrides.occurredAtUtc,
      localDate: overrides.occurredAtUtc.slice(0, 10),
      utcOffsetMinutes: 0,
      timeZone: "UTC",
    },
    source: overrides.source ?? "learn",
    direction: overrides.direction,
    exerciseType: overrides.exerciseType,
    rawTarget: overrides.target,
    rawResponse: overrides.answer,
    normalizedTarget: overrides.target,
    normalizedResponse: overrides.answer,
    correct: overrides.correct,
    assisted: overrides.assisted ?? false,
    replayed: overrides.replayed ?? false,
    abandoned: overrides.abandoned ?? false,
    scoringAlgorithmVersion: "alignment-v1",
    observations: [
      {
        kind: overrides.correct
          ? ("match" as const)
          : ("substitution" as const),
        correct: overrides.correct,
        targetIndex: 0,
        target: overrides.target,
        answerIndex: 0,
        answer: overrides.answer,
      },
    ],
    charWpm: overrides.charWpmBand ?? 20,
    effectiveWpm: 12,
    ...(overrides.charWpmBand === undefined
      ? {}
      : { charWpmBand: overrides.charWpmBand }),
    toneHz: 600,
    noiseLevel: 0,
  };
}
