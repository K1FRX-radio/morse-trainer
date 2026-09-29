import { DEFAULT_SETTINGS } from "../core/settings.ts";
import type { TrainingAttemptRecord, TrainingSessionRecord } from "./models.ts";
import {
  parsePortableSettingsRecord,
  parseTrainingAttempts,
  parseTrainingDataset,
  parseTrainingSessions,
} from "./validation.ts";

const captured = {
  utc: "2026-09-24T17:00:00.000Z",
  localDate: "2026-09-24",
  utcOffsetMinutes: -240,
  timeZone: "America/New_York",
} as const;

function validSession(
  overrides: Partial<TrainingSessionRecord> = {},
): TrainingSessionRecord {
  return {
    id: "session-1",
    schemaVersion: 1,
    updatedAt: "2026-09-24T17:05:00.000Z",
    source: "learn",
    mode: "learn",
    status: "completed",
    startedAt: captured,
    endedAt: { ...captured, utc: "2026-09-24T17:05:00.000Z" },
    activeMs: 45000,
    activeDateBuckets: [
      {
        localDate: "2026-09-24",
        utcOffsetMinutes: -240,
        timeZone: "America/New_York",
        activeMs: 45000,
      },
    ],
    attemptCount: 1,
    completedCards: 1,
    valid: true,
    charWpm: 20,
    effectiveWpm: 12,
    toneHz: 600,
    noiseLevel: 0,
    unlockedAtStart: ["K", "M"],
    unlockedAtEnd: ["K", "M"],
    appVersion: "0.0.0",
    revision: 1,
    ...overrides,
  };
}

function validAttempt(
  overrides: Partial<TrainingAttemptRecord> = {},
): TrainingAttemptRecord {
  return {
    id: "attempt-1",
    schemaVersion: 1,
    updatedAt: "2026-09-24T17:01:00.000Z",
    sessionId: "session-1",
    occurredAt: captured,
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
    responseMs: 250,
    charWpm: 20,
    effectiveWpm: 12,
    toneHz: 600,
    noiseLevel: 0,
    ...overrides,
  };
}

describe("persisted record semantics", () => {
  it("defaults the speed-suggestion threshold in old portable settings", () => {
    const oldSettings: Record<string, unknown> = { ...DEFAULT_SETTINGS };
    delete oldSettings.speedSuggestionAfterAttempts;
    expect(
      parsePortableSettingsRecord({
        id: "portable-settings",
        schemaVersion: 1,
        updatedAt: "2026-09-24T17:05:00.000Z",
        value: oldSettings,
      }).value.speedSuggestionAfterAttempts,
    ).toBe(3);
  });

  it("accepts Learn-sourced review sessions", () => {
    expect(parseTrainingSessions([validSession({ mode: "review" })])).toEqual([
      validSession({ mode: "review" }),
    ]);
  });

  it("accepts imported-text sessions as valid without attempts", () => {
    const imported = validSession({
      source: "imported-text-rx",
      mode: "imported-text-rx",
      attemptCount: 0,
      finalizedAttemptCount: 0,
      completedCards: 0,
      valid: true,
    });
    expect(parseTrainingSessions([imported])).toEqual([imported]);
  });

  it("preserves compatibility with existing v2 source/mode pairs", () => {
    const copy = validSession({ source: "copy-practice", mode: "copy" });
    const send = validSession({ source: "send-practice", mode: "send" });
    expect(parseTrainingSessions([copy, send])).toEqual([copy, send]);
  });

  it.each([
    {
      name: "match marked incorrect",
      observation: {
        kind: "match",
        correct: false,
        targetIndex: 0,
        target: "K",
        answerIndex: 0,
        answer: "K",
      },
    },
    {
      name: "substitution marked correct",
      observation: {
        kind: "substitution",
        correct: true,
        targetIndex: 0,
        target: "K",
        answerIndex: 0,
        answer: "M",
      },
    },
    {
      name: "substitution missing answer",
      observation: {
        kind: "substitution",
        correct: false,
        targetIndex: 0,
        target: "K",
        answerIndex: 0,
      },
    },
    {
      name: "insertion containing target",
      observation: {
        kind: "insertion",
        correct: false,
        targetIndex: 0,
        target: "K",
        answerIndex: 0,
        answer: "M",
      },
    },
  ])("rejects $name", ({ observation }) => {
    expect(() =>
      parseTrainingAttempts([
        validAttempt({
          observations: [observation] as TrainingAttemptRecord["observations"],
        }),
      ]),
    ).toThrow();
  });

  it("rejects future record and scoring versions", () => {
    expect(() =>
      parseTrainingAttempts([validAttempt({ schemaVersion: 2 })]),
    ).toThrow();
    expect(() =>
      parseTrainingAttempts([
        validAttempt({ scoringAlgorithmVersion: "alignment-v2" }),
      ]),
    ).toThrow();
  });

  it.each([
    {
      name: "source and mode disagree",
      session: validSession({ source: "copy-practice", mode: "learn" }),
    },
    {
      name: "effective speed exceeds character speed",
      session: validSession({ charWpm: 12, effectiveWpm: 20 }),
    },
    {
      name: "active duration disagrees with date buckets",
      session: validSession({ activeMs: 30000 }),
    },
    {
      name: "completed session has no end time",
      session: { ...validSession(), endedAt: undefined },
    },
  ])("rejects session when $name", ({ session }) => {
    expect(() => parseTrainingSessions([session])).toThrow();
  });

  it.each([
    {
      name: "valid below 30 seconds",
      session: validSession({
        activeMs: 29999,
        activeDateBuckets: [
          {
            localDate: "2026-09-24",
            utcOffsetMinutes: -240,
            timeZone: "America/New_York",
            activeMs: 29999,
          },
        ],
      }),
    },
    {
      name: "valid with zero attempts",
      session: validSession({ attemptCount: 0 }),
    },
    {
      name: "qualifying work marked invalid",
      session: validSession({ valid: false }),
    },
  ])("rejects $name", ({ session }) => {
    expect(() => parseTrainingSessions([session])).toThrow();
  });

  it.each(["completed", "interrupted"] as const)(
    "accepts a qualifying %s session",
    (status) => {
      expect(parseTrainingSessions([validSession({ status })])).toEqual([
        validSession({ status }),
      ]);
    },
  );

  it("rejects session attempt counts that disagree with stored attempts", () => {
    expect(() =>
      parseTrainingDataset(
        [validSession({ attemptCount: 2 })],
        [validAttempt()],
      ),
    ).toThrow(/attemptCount 2 does not match 1 stored attempts/);
  });
});
