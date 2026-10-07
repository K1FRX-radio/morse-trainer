import { IDBKeyRange, indexedDB } from "fake-indexeddb";
import { DEFAULT_CURRICULUM_CONFIG } from "../content/curriculum-data.ts";
import { createInitialState, forceUnlockNext } from "../core/curriculum.ts";
import {
  DEFAULT_SETTINGS,
  normalizeCharacterWpmBand,
  normalizeEffectiveWpmBand,
} from "../core/settings.ts";
import {
  evaluateAdvancementEvidence,
  minimumAdvancementObservations,
} from "../training/advancement.ts";
import type {
  CurriculumStateRecord,
  TrainingAttemptRecord,
  TrainingSessionRecord,
} from "./models.ts";
import { TrainerDatabase } from "./indexeddb.ts";
import { DexieTrainingRepository } from "./repository.ts";

const startedAt = {
  utc: "2026-09-24T17:00:00.000Z",
  localDate: "2026-09-24",
  utcOffsetMinutes: -240,
  timeZone: "America/New_York",
};

function session(
  overrides: Partial<TrainingSessionRecord> = {},
): TrainingSessionRecord {
  const base: TrainingSessionRecord = {
    id: "session-1",
    schemaVersion: 1,
    updatedAt: startedAt.utc,
    source: "learn",
    mode: "learn",
    status: "active",
    startedAt,
    activeMs: 0,
    activeDateBuckets: [],
    attemptCount: 0,
    completedCards: 0,
    valid: false,
    charWpm: 20,
    effectiveWpm: 12,
    toneHz: 600,
    noiseLevel: 0,
    unlockedAtStart: ["K", "M"],
    appVersion: "0.0.0",
    revision: 0,
    ownerTabId: "tab-1",
    leaseExpiresAt: "2026-09-24T17:01:00.000Z",
  };
  const record: TrainingSessionRecord = { ...base, ...overrides };
  const charWpmBand =
    overrides.charWpmBand ?? normalizeCharacterWpmBand(record.charWpm);
  const effectiveWpmBand =
    overrides.effectiveWpmBand ??
    normalizeEffectiveWpmBand(record.effectiveWpm, charWpmBand);
  return {
    ...record,
    charWpmBand,
    effectiveWpmBand,
  };
}

function attempt(
  overrides: Partial<TrainingAttemptRecord> = {},
): TrainingAttemptRecord {
  const base: TrainingAttemptRecord = {
    id: "attempt-1",
    schemaVersion: 1,
    updatedAt: "2026-09-24T17:00:10.000Z",
    sessionId: "session-1",
    occurredAt: {
      utc: "2026-09-24T17:00:10.000Z",
      localDate: "2026-09-24",
      utcOffsetMinutes: -240,
      timeZone: "America/New_York",
    },
    source: "learn",
    direction: "rx",
    exerciseType: "copy-character",
    rawTarget: "K",
    rawResponse: "K",
    normalizedTarget: "K",
    normalizedResponse: "K",
    correct: true,
    assisted: false,
    replayed: false,
    abandoned: false,
    scoringAlgorithmVersion: "alignment-v1",
    observations: [
      {
        kind: "match",
        correct: true,
        targetIndex: 0,
        target: "K",
        answerIndex: 0,
        answer: "K",
      },
    ],
    charWpm: 20,
    effectiveWpm: 12,
    toneHz: 600,
    noiseLevel: 0,
  };
  const record: TrainingAttemptRecord = { ...base, ...overrides };
  const charWpmBand =
    overrides.charWpmBand ?? normalizeCharacterWpmBand(record.charWpm);
  const effectiveWpmBand =
    overrides.effectiveWpmBand ??
    normalizeEffectiveWpmBand(record.effectiveWpm, charWpmBand);
  return {
    ...record,
    charWpmBand,
    effectiveWpmBand,
  };
}

function advancementEvidence(
  activeCharacters: string[],
  readinessReason: "READY" | "COMPLETE",
): TrainingAttemptRecord {
  const newest = activeCharacters.at(-1)!;
  const targets = [
    ...activeCharacters,
    ...Array.from({ length: 7 }, () => newest),
  ];
  while (
    targets.length < minimumAdvancementObservations(activeCharacters.length)
  ) {
    targets.push(activeCharacters[0]!);
  }
  const text = targets.join("");
  return attempt({
    exerciseType: "continuous-copy",
    readinessReason,
    rawTarget: text,
    rawResponse: text,
    normalizedTarget: text,
    normalizedResponse: text,
    observations: targets.map((character, index) => ({
      kind: "match",
      correct: true,
      targetIndex: index,
      target: character,
      answerIndex: index,
      answer: character,
    })),
  });
}

function offeredAssessmentFor(
  state: ReturnType<typeof createInitialState>,
  evidence: TrainingAttemptRecord,
) {
  const charWpmBand =
    evidence.charWpmBand ?? normalizeCharacterWpmBand(evidence.charWpm);
  const effectiveWpmBand =
    evidence.effectiveWpmBand ??
    normalizeEffectiveWpmBand(evidence.effectiveWpm, charWpmBand);
  return evaluateAdvancementEvidence(
    structuredClone(state),
    {
      abandoned: evidence.abandoned,
      perCharacterResults: evidence.observations.flatMap((observation) =>
        observation.target === undefined
          ? []
          : [
              {
                character: observation.target,
                correct: observation.correct,
              },
            ],
      ),
    },
    undefined,
    {
      charWpmBand,
      effectiveWpmBand,
    },
  );
}

function curriculum(): CurriculumStateRecord {
  return {
    id: "curriculum-state",
    schemaVersion: 1,
    updatedAt: "2026-09-24T17:00:10.000Z",
    order: [
      "K",
      "M",
      "U",
      "R",
      "E",
      "S",
      "N",
      "A",
      "P",
      "T",
      "L",
      "W",
      "I",
      ".",
      "J",
      "Z",
      "=",
      "F",
      "O",
      "Y",
      ",",
      "V",
      "G",
      "5",
      "/",
      "Q",
      "9",
      "2",
      "H",
      "3",
      "8",
      "B",
      "?",
      "4",
      "7",
      "C",
      "1",
      "D",
      "6",
      "0",
      "X",
    ],
    startCount: 2,
    windowSize: 50,
    minNewCharObservations: 20,
    reviewDecayAccuracy: 0.7,
    characters: [
      {
        character: "K",
        state: "learning",
        needsReview: false,
        reviewStreak: 0,
        rx: { totalAttempts: 1, recentResults: [true] },
        tx: { totalAttempts: 0, recentResults: [] },
      },
      {
        character: "M",
        state: "learning",
        needsReview: false,
        reviewStreak: 0,
        rx: { totalAttempts: 0, recentResults: [] },
        tx: { totalAttempts: 0, recentResults: [] },
      },
    ],
  };
}

async function setupRepository() {
  const database = new TrainerDatabase({
    name: crypto.randomUUID(),
    indexedDB,
    IDBKeyRange,
  });
  let id = 0;
  const repository = new DexieTrainingRepository(database, {
    createId: () => `repository-id-${++id}`,
    now: () => new Date("2026-09-24T18:00:00.000Z"),
  });
  await repository.open();
  return { database, repository };
}

describe("session persistence", () => {
  it("creates an active session idempotently and rejects ID reuse", async () => {
    const { database, repository } = await setupRepository();
    const record = session();

    try {
      await expect(repository.createSession(record)).resolves.toEqual({
        session: record,
        committed: true,
      });
      await expect(repository.createSession(record)).resolves.toEqual({
        session: record,
        committed: false,
      });
      await expect(
        repository.createSession(session({ charWpm: 25 })),
      ).rejects.toThrow(/session ID already exists with different data/);
      expect(await database.sessions.count()).toBe(1);
    } finally {
      repository.close();
      await database.delete();
    }
  });

  it("atomically commits an attempt, session snapshot, and curriculum", async () => {
    const { database, repository } = await setupRepository();
    const record = session();
    const nextSession = session({
      updatedAt: "2026-09-24T17:00:10.000Z",
      activeMs: 10000,
      activeDateBuckets: [
        {
          localDate: "2026-09-24",
          utcOffsetMinutes: -240,
          timeZone: "America/New_York",
          activeMs: 10000,
        },
      ],
      attemptCount: 1,
      completedCards: 1,
      revision: 1,
    });
    const firstAttempt = attempt();
    const nextCurriculum = curriculum();

    try {
      await repository.createSession(record);
      await expect(
        repository.commitLearnAttempt({
          expectedSessionRevision: 0,
          session: nextSession,
          attempt: firstAttempt,
          curriculum: nextCurriculum,
        }),
      ).resolves.toEqual({
        session: nextSession,
        attempt: firstAttempt,
        committed: true,
      });
      await expect(
        repository.commitLearnAttempt({
          expectedSessionRevision: 0,
          session: nextSession,
          attempt: firstAttempt,
          curriculum: nextCurriculum,
        }),
      ).resolves.toMatchObject({ committed: false });
      expect(await database.sessions.get("session-1")).toEqual(nextSession);
      expect(await database.attempts.toArray()).toEqual([firstAttempt]);
      expect(await database.curriculum.get("curriculum-state")).toEqual(
        nextCurriculum,
      );
    } finally {
      repository.close();
      await database.delete();
    }
  });

  it("rolls back an attempt when the expected session revision is stale", async () => {
    const { database, repository } = await setupRepository();

    try {
      await database.sessions.add(session({ revision: 1 }));
      await expect(
        repository.commitLearnAttempt({
          expectedSessionRevision: 0,
          session: session({ attemptCount: 1, revision: 1 }),
          attempt: attempt(),
        }),
      ).rejects.toThrow(/session revision changed/);
      expect(await database.attempts.count()).toBe(0);
    } finally {
      repository.close();
      await database.delete();
    }
  });

  it.each([
    {
      source: "copy-practice" as const,
      mode: "copy" as const,
      direction: "rx" as const,
      exerciseType: "copy-character" as const,
    },
    {
      source: "send-practice" as const,
      mode: "send" as const,
      direction: "tx" as const,
      exerciseType: "send-character" as const,
    },
  ])("persists $source attempt analytics", async (practice) => {
    const { database, repository } = await setupRepository();
    const current = session({ source: practice.source, mode: practice.mode });
    const next = session({
      source: practice.source,
      mode: practice.mode,
      updatedAt: "2026-09-24T17:00:10.000Z",
      activeMs: 10000,
      activeDateBuckets: [
        {
          localDate: "2026-09-24",
          utcOffsetMinutes: -240,
          timeZone: "America/New_York",
          activeMs: 10000,
        },
      ],
      attemptCount: 1,
      completedCards: 1,
      revision: 1,
    });
    const practiceAttempt = attempt({
      source: practice.source,
      direction: practice.direction,
      exerciseType: practice.exerciseType,
    });

    try {
      await repository.createSession(current);
      await expect(
        repository.commitPracticeAttempt({
          expectedSessionRevision: 0,
          session: next,
          attempt: practiceAttempt,
        }),
      ).resolves.toEqual({
        session: next,
        attempt: practiceAttempt,
        committed: true,
      });
      expect(await database.curriculum.count()).toBe(0);
      expect(await database.introductions.count()).toBe(0);
    } finally {
      repository.close();
      await database.delete();
    }
  });

  it.each([
    ["copy-practice", "copy", "rx", "copy-character"],
    ["send-practice", "send", "tx", "send-character"],
  ] as const)(
    "rejects prohibited progression data for %s and rolls back",
    async (source, mode, direction, exerciseType) => {
      const prohibitedFields = [
        ["curriculum", curriculum()],
        [
          "introductions",
          {
            id: "completed-introductions",
            schemaVersion: 1,
            updatedAt: "2026-09-24T17:00:10.000Z",
            characters: ["K"],
          },
        ],
        ["progressionEvents", []],
        ["milestones", []],
        ["advancement", {}],
        ["mastery", {}],
      ] as const;

      for (const [field, value] of prohibitedFields) {
        const { database, repository } = await setupRepository();
        const current = session({ source, mode });
        const next = session({
          source,
          mode,
          updatedAt: "2026-09-24T17:00:10.000Z",
          activeMs: 10000,
          activeDateBuckets: [
            {
              localDate: "2026-09-24",
              utcOffsetMinutes: -240,
              timeZone: "America/New_York",
              activeMs: 10000,
            },
          ],
          attemptCount: 1,
          completedCards: 1,
          revision: 1,
        });
        const practiceAttempt = attempt({
          source,
          direction,
          exerciseType,
        });

        try {
          await repository.createSession(current);
          await expect(
            repository.commitPracticeAttempt({
              expectedSessionRevision: 0,
              session: next,
              attempt: practiceAttempt,
              [field]: value,
            }),
          ).rejects.toThrow(/practice commits cannot include/);
          expect(await database.sessions.get("session-1")).toEqual(current);
          expect(await database.attempts.count()).toBe(0);
          expect(await database.curriculum.count()).toBe(0);
          expect(await database.introductions.count()).toBe(0);
        } finally {
          repository.close();
          await database.delete();
        }
      }
    },
  );

  it("finalizes by compare-and-set and returns the committed result on retry", async () => {
    const { database, repository } = await setupRepository();
    const endedAt = {
      utc: "2026-09-24T17:01:00.000Z",
      localDate: "2026-09-24",
      utcOffsetMinutes: -240,
      timeZone: "America/New_York",
    };
    const completed = session({
      status: "completed",
      endedAt,
      updatedAt: endedAt.utc,
      revision: 1,
      finalizationKey: "finalize:session-1",
      unlockedAtEnd: ["K", "M"],
    });

    try {
      await repository.createSession(session());
      await expect(repository.finalizeSession(completed, 0)).resolves.toEqual({
        session: completed,
        committed: true,
      });
      await expect(repository.finalizeSession(completed, 0)).resolves.toEqual({
        session: completed,
        committed: false,
      });
      await expect(
        repository.finalizeSession(
          { ...completed, finalizationKey: "finalize:other" },
          0,
        ),
      ).rejects.toThrow(/session was already finalized/);
      expect(
        await database.metadata
          .where("operation")
          .equals("finalize-session")
          .count(),
      ).toBe(1);
    } finally {
      repository.close();
      await database.delete();
    }
  });

  it("atomically accepts advancement and returns the recorded event on retry", async () => {
    const { database, repository } = await setupRepository();
    const acceptedAt = "2026-09-24T18:00:00.000Z";
    const before = createInitialState(DEFAULT_CURRICULUM_CONFIG);
    before.characters[0].rx.totalAttempts = 7;
    before.characters[0].rx.recentResults = [true, false, true];
    const completed = session({
      status: "completed",
      endedAt: {
        utc: acceptedAt,
        localDate: "2026-09-24",
        utcOffsetMinutes: -240,
        timeZone: "America/New_York",
      },
      updatedAt: acceptedAt,
      attemptCount: 1,
      finalizedAttemptCount: 1,
      valid: true,
      revision: 1,
      finalizationKey: "learn-completed:session-1",
      unlockedAtEnd: ["K", "M"],
    });
    const evidence = advancementEvidence(["K", "M"], "READY");
    const offeredAssessment = offeredAssessmentFor(before, evidence);
    const command = {
      sessionId: completed.id,
      evidenceAttemptId: evidence.id,
      idempotencyKey: "advancement:session-1:attempt-1",
      activeCharacters: ["K", "M"],
      offeredAssessment,
      type: "character-unlocked" as const,
      unlockedCharacter: "U",
    };

    try {
      await database.sessions.add(completed);
      await database.attempts.add(evidence);
      await repository.saveCurriculumState(before);

      const first = await repository.acceptAdvancement(command);
      const retry = await repository.acceptAdvancement(command);

      expect(first).toMatchObject({
        committed: true,
        event: {
          idempotencyKey: command.idempotencyKey,
          type: "advancement-accepted",
          sessionId: completed.id,
          evidenceAttemptId: evidence.id,
          activeCharacters: ["K", "M"],
          masteredCharacters: ["K", "M"],
          unlockedCharacter: "U",
        },
      });
      expect(retry).toEqual({
        committed: false,
        event: first.event,
        curriculum: first.curriculum,
      });
      expect(first.curriculum.characters).toMatchObject([
        {
          character: "K",
          state: "mastered",
          rx: { totalAttempts: 7, recentResults: [true, false, true] },
        },
        { character: "M", state: "mastered" },
        { character: "U", state: "learning" },
      ]);
      expect(await database.progressionEvents.toArray()).toEqual([first.event]);
      expect(
        (await database.milestones.toArray())
          .map(({ type, character }) => `${type}:${character ?? ""}`)
          .sort(),
      ).toEqual([
        "character-mastered:K",
        "character-mastered:M",
        "character-unlocked:U",
      ]);
      expect(
        await database.metadata
          .where("operation")
          .equals("accept-advancement")
          .count(),
      ).toBe(1);
      await expect(
        repository.acceptAdvancement({
          ...command,
          unlockedCharacter: "R",
        }),
      ).rejects.toThrow(/idempotency key was reused with different data/);
      await expect(
        repository.acceptAdvancement({
          ...command,
          sessionId: "different-session",
        }),
      ).rejects.toThrow(/idempotency key was reused with different data/);
      await expect(
        repository.acceptAdvancement({
          ...command,
          evidenceAttemptId: "different-attempt",
        }),
      ).rejects.toThrow(/idempotency key was reused with different data/);
      await expect(
        repository.acceptAdvancement({
          ...command,
          activeCharacters: ["K"],
        }),
      ).rejects.toThrow(/idempotency key was reused with different data/);
      await expect(
        repository.acceptAdvancement({
          sessionId: command.sessionId,
          evidenceAttemptId: command.evidenceAttemptId,
          idempotencyKey: command.idempotencyKey,
          activeCharacters: command.activeCharacters,
          offeredAssessment: command.offeredAssessment,
          type: "curriculum-completed",
        }),
      ).rejects.toThrow(/idempotency key was reused with different data/);
    } finally {
      repository.close();
      await database.delete();
    }
  });

  it("records mastery and completion milestones atomically", async () => {
    const { database, repository } = await setupRepository();
    const before = createInitialState(DEFAULT_CURRICULUM_CONFIG);
    while (before.characters.length < before.config.order.length) {
      forceUnlockNext(before);
    }
    const activeCharacters = before.characters.map(
      ({ character }) => character,
    );
    const completed = session({
      status: "completed",
      updatedAt: "2026-09-24T18:00:00.000Z",
      attemptCount: 1,
      finalizedAttemptCount: 1,
      valid: true,
      revision: 1,
      finalizationKey: "learn-completed:session-1",
      unlockedAtEnd: activeCharacters,
    });
    const evidence = advancementEvidence(activeCharacters, "COMPLETE");
    const offeredAssessment = offeredAssessmentFor(before, evidence);

    try {
      await database.sessions.add(completed);
      await database.attempts.add(evidence);
      await repository.saveCurriculumState(before);

      const result = await repository.acceptAdvancement({
        sessionId: completed.id,
        evidenceAttemptId: evidence.id,
        idempotencyKey: "advancement:session-1:complete",
        activeCharacters,
        offeredAssessment,
        type: "curriculum-completed",
      });

      expect(result.event).toMatchObject({
        type: "curriculum-completed",
        masteredCharacters: activeCharacters,
      });
      const milestones = await database.milestones.toArray();
      expect(milestones).toHaveLength(activeCharacters.length + 1);
      expect(
        milestones
          .filter(({ type }) => type === "character-mastered")
          .map(({ character }) => character)
          .sort(),
      ).toEqual([...activeCharacters].sort());
      expect(
        milestones.find(({ type }) => type === "curriculum-completed"),
      ).toMatchObject({
        type: "curriculum-completed",
      });
    } finally {
      repository.close();
      await database.delete();
    }
  });

  it("rejects advancement when intervening review state invalidates the offer", async () => {
    const { database, repository } = await setupRepository();
    const before = createInitialState(DEFAULT_CURRICULUM_CONFIG);
    const completed = session({
      status: "completed",
      updatedAt: "2026-09-24T18:00:00.000Z",
      attemptCount: 1,
      finalizedAttemptCount: 1,
      valid: true,
      revision: 1,
      finalizationKey: "learn-completed:session-1",
      unlockedAtEnd: ["K", "M"],
    });
    const evidence = advancementEvidence(["K", "M"], "READY");
    const offeredAssessment = offeredAssessmentFor(before, evidence);

    try {
      await database.sessions.add(completed);
      await database.attempts.add(evidence);
      await repository.saveCurriculumState(before);
      const intervening = await database.curriculum.get("curriculum-state");
      intervening!.characters[0]!.needsReview = true;
      intervening!.characters[0]!.reviewStreak = 2;
      await database.curriculum.put(intervening!);

      await expect(
        repository.acceptAdvancement({
          sessionId: completed.id,
          evidenceAttemptId: evidence.id,
          idempotencyKey: "advancement:session-1:attempt-1",
          activeCharacters: ["K", "M"],
          offeredAssessment,
          type: "character-unlocked",
          unlockedCharacter: "U",
        }),
      ).rejects.toThrow(/stale or invalidated/);
      expect(await database.progressionEvents.count()).toBe(0);
      expect(await database.milestones.count()).toBe(0);
      expect(
        (await database.curriculum.get("curriculum-state"))?.characters[0],
      ).toMatchObject({ needsReview: true, reviewStreak: 2 });
    } finally {
      repository.close();
      await database.delete();
    }
  });

  it("rejects advancement when persisted current character speed band differs", async () => {
    const { database, repository } = await setupRepository();
    const before = createInitialState(DEFAULT_CURRICULUM_CONFIG);
    const completed = session({
      status: "completed",
      updatedAt: "2026-09-24T18:00:00.000Z",
      attemptCount: 1,
      finalizedAttemptCount: 1,
      valid: true,
      revision: 1,
      finalizationKey: "learn-completed:session-1",
      unlockedAtEnd: ["K", "M"],
      charWpm: 20,
      effectiveWpm: 12,
    });
    const evidence = advancementEvidence(["K", "M"], "READY");
    const offeredAssessment = offeredAssessmentFor(before, evidence);

    try {
      await database.sessions.add(completed);
      await database.attempts.add(evidence);
      await repository.saveCurriculumState(before);
      await repository.savePortableSettings({
        ...DEFAULT_SETTINGS,
        charWpm: 25,
        effectiveWpm: 18,
      });

      await expect(
        repository.acceptAdvancement({
          sessionId: completed.id,
          evidenceAttemptId: evidence.id,
          idempotencyKey: "advancement:session-1:char-band-mismatch",
          activeCharacters: ["K", "M"],
          offeredAssessment,
          type: "character-unlocked",
          unlockedCharacter: "U",
        }),
      ).rejects.toThrow(/stale or invalidated/);
      expect(await database.progressionEvents.count()).toBe(0);
      expect(await database.milestones.count()).toBe(0);
    } finally {
      repository.close();
      await database.delete();
    }
  });

  it("accepts advancement for a fresh qualifying stream at 25 WPM", async () => {
    const { database, repository } = await setupRepository();
    const before = createInitialState(DEFAULT_CURRICULUM_CONFIG);
    const completed = session({
      status: "completed",
      updatedAt: "2026-09-24T18:00:00.000Z",
      attemptCount: 1,
      finalizedAttemptCount: 1,
      valid: true,
      revision: 1,
      finalizationKey: "learn-completed:session-1",
      unlockedAtEnd: ["K", "M"],
      charWpm: 25,
      effectiveWpm: 18,
    });
    const evidence: TrainingAttemptRecord = {
      ...advancementEvidence(["K", "M"], "READY"),
      charWpm: 25,
      effectiveWpm: 18,
      charWpmBand: 25 as const,
      effectiveWpmBand: 18 as const,
    };
    const offeredAssessment = offeredAssessmentFor(before, evidence);

    try {
      await database.sessions.add(completed);
      await database.attempts.add(evidence);
      await repository.saveCurriculumState(before);
      await repository.savePortableSettings({
        ...DEFAULT_SETTINGS,
        charWpm: 25,
        effectiveWpm: 18,
      });

      const result = await repository.acceptAdvancement({
        sessionId: completed.id,
        evidenceAttemptId: evidence.id,
        idempotencyKey: "advancement:session-1:ready-25",
        activeCharacters: ["K", "M"],
        offeredAssessment,
        type: "character-unlocked",
        unlockedCharacter: "U",
      });

      expect(result).toMatchObject({
        committed: true,
        event: {
          type: "advancement-accepted",
          sessionId: completed.id,
          evidenceAttemptId: evidence.id,
          unlockedCharacter: "U",
        },
      });
    } finally {
      repository.close();
      await database.delete();
    }
  });

  it.each([
    ["READY", "assisted"],
    ["READY", "replayed"],
    ["COMPLETE", "assisted"],
    ["COMPLETE", "replayed"],
  ] as const)(
    "rejects %s advancement when evidence is %s",
    async (readinessReason, excludedFlag) => {
      const { database, repository } = await setupRepository();
      const state = createInitialState(DEFAULT_CURRICULUM_CONFIG);
      if (readinessReason === "COMPLETE") {
        while (state.characters.length < state.config.order.length) {
          forceUnlockNext(state);
        }
      }
      const activeCharacters = state.characters.map(
        ({ character }) => character,
      );
      const completed = session({
        status: "completed",
        updatedAt: "2026-09-24T18:00:00.000Z",
        attemptCount: 1,
        finalizedAttemptCount: 1,
        valid: true,
        revision: 1,
        finalizationKey: "learn-completed:session-1",
        unlockedAtEnd: activeCharacters,
      });
      const evidence = advancementEvidence(activeCharacters, readinessReason);
      const offeredAssessment = offeredAssessmentFor(state, evidence);
      evidence[excludedFlag] = true;

      try {
        await database.sessions.add(completed);
        await database.attempts.add(evidence);
        await repository.saveCurriculumState(state);

        await expect(
          repository.acceptAdvancement({
            sessionId: completed.id,
            evidenceAttemptId: evidence.id,
            idempotencyKey: `advancement:${readinessReason}:${excludedFlag}`,
            activeCharacters,
            offeredAssessment,
            type:
              readinessReason === "COMPLETE"
                ? "curriculum-completed"
                : "character-unlocked",
            ...(readinessReason === "READY" ? { unlockedCharacter: "U" } : {}),
          }),
        ).rejects.toThrow(/continuous-copy evidence/);
        expect(await database.progressionEvents.count()).toBe(0);
        expect(await database.milestones.count()).toBe(0);
      } finally {
        repository.close();
        await database.delete();
      }
    },
  );

  it("rolls back all advancement writes when a milestone write fails", async () => {
    const { database, repository } = await setupRepository();
    const before = createInitialState(DEFAULT_CURRICULUM_CONFIG);
    const completed = session({
      status: "completed",
      updatedAt: "2026-09-24T18:00:00.000Z",
      attemptCount: 1,
      finalizedAttemptCount: 1,
      valid: true,
      revision: 1,
      finalizationKey: "learn-completed:session-1",
      unlockedAtEnd: ["K", "M"],
    });
    const evidence = advancementEvidence(["K", "M"], "READY");
    const offeredAssessment = offeredAssessmentFor(before, evidence);

    try {
      await database.sessions.add(completed);
      await database.attempts.add(evidence);
      await repository.saveCurriculumState(before);
      await database.milestones.add({
        id: "repository-id-3",
        schemaVersion: 1,
        updatedAt: "2026-09-24T17:00:00.000Z",
        idempotencyKey: "existing-milestone",
        eventId: "existing-event",
        type: "character-unlocked",
        occurredAt: startedAt,
        character: "U",
        migrationDerived: false,
      });

      await expect(
        repository.acceptAdvancement({
          sessionId: completed.id,
          evidenceAttemptId: evidence.id,
          idempotencyKey: "advancement:session-1:attempt-1",
          activeCharacters: ["K", "M"],
          offeredAssessment,
          type: "character-unlocked",
          unlockedCharacter: "U",
        }),
      ).rejects.toThrow();

      expect(
        (await database.curriculum.get("curriculum-state"))?.characters.map(
          ({ character }) => character,
        ),
      ).toEqual(["K", "M"]);
      expect(await database.progressionEvents.count()).toBe(0);
      expect(
        await database.metadata
          .where("operation")
          .equals("accept-advancement")
          .count(),
      ).toBe(0);
    } finally {
      repository.close();
      await database.delete();
    }
  });
});
