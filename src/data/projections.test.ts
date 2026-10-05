import type { TrainingAttemptRecord, TrainingSessionRecord } from "./models.ts";
import {
  buildCharacterSpeedProficiency,
  buildProjectionRows,
} from "./projections.ts";

function session(
  overrides: Partial<TrainingSessionRecord>,
): TrainingSessionRecord {
  return {
    id: "session-1",
    schemaVersion: 1,
    updatedAt: "2026-09-24T17:05:00.000Z",
    source: "learn",
    mode: "learn",
    status: "completed",
    startedAt: {
      utc: "2026-09-24T17:00:00.000Z",
      localDate: "2026-09-24",
      utcOffsetMinutes: -240,
      timeZone: "America/New_York",
    },
    endedAt: {
      utc: "2026-09-24T17:05:00.000Z",
      localDate: "2026-09-24",
      utcOffsetMinutes: -240,
      timeZone: "America/New_York",
    },
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

describe("buildProjectionRows session eligibility", () => {
  it("does not trust a true valid flag for ineligible data", () => {
    const rows = buildProjectionRows(
      [
        session({
          activeMs: 0,
          activeDateBuckets: [],
          attemptCount: 0,
          valid: true,
        }),
      ],
      [],
      "2026-09-24T18:00:00.000Z",
    );

    expect(rows.daily).toEqual([]);
  });

  it("derives eligibility for qualifying data marked false", () => {
    const rows = buildProjectionRows(
      [session({ valid: false })],
      [],
      "2026-09-24T18:00:00.000Z",
    );

    expect(rows.daily).toMatchObject([
      { localDate: "2026-09-24", sessionCount: 1, activeMs: 45000 },
    ]);
  });

  it("counts imported-text sessions in daily time/session totals", () => {
    const rows = buildProjectionRows(
      [
        session({
          source: "imported-text-rx",
          mode: "imported-text-rx",
          attemptCount: 0,
          finalizedAttemptCount: 0,
          completedCards: 0,
          valid: true,
        }),
      ],
      [],
      "2026-09-24T18:00:00.000Z",
    );

    expect(rows.daily).toMatchObject([
      {
        localDate: "2026-09-24",
        sessionCount: 1,
        activeMs: 45000,
        attemptCount: 0,
        rxCorrect: 0,
        rxTotal: 0,
        txCorrect: 0,
        txTotal: 0,
      },
    ]);
    expect(rows.characters).toEqual([]);
    expect(rows.confusions).toEqual([]);
  });

  it("retains latest 20 isolated RX response samples independent of recent-50 window", () => {
    const attempts: TrainingAttemptRecord[] = [];
    for (let index = 0; index < 20; index += 1) {
      attempts.push(
        attempt({
          id: `isolated-${index}`,
          occurredAtUtc: `2026-09-24T${String(index).padStart(2, "0")}:00:00.000Z`,
          exerciseType: "copy-character",
          direction: "rx",
          responseMs: 100 + index,
          target: "K",
          answer: "K",
          correct: true,
        }),
      );
    }
    for (let index = 0; index < 55; index += 1) {
      attempts.push(
        attempt({
          id: `group-${index}`,
          occurredAtUtc: `2026-09-25T12:${String(index).padStart(2, "0")}:00.000Z`,
          exerciseType: "copy-group",
          direction: "rx",
          target: "K",
          answer: index % 5 === 0 ? "M" : "K",
          correct: index % 5 !== 0,
        }),
      );
    }

    const rows = buildProjectionRows(
      [session({ id: "session-1", attemptCount: attempts.length })],
      attempts,
      "2026-09-26T00:00:00.000Z",
    );

    const rxK = rows.characters.find(
      (row) => row.direction === "rx" && row.character === "K",
    );
    expect(rxK).toBeDefined();
    expect(rxK?.recent.length).toBe(50);
    expect(
      rxK?.recent.filter((observation) => observation.responseMs !== undefined)
        .length,
    ).toBe(0);
    expect(rxK?.recentIsolatedRxResponseMs).toEqual(
      Array.from({ length: 20 }, (_, index) => 100 + index),
    );
  });
});

function attempt(overrides: {
  id: string;
  occurredAtUtc: string;
  exerciseType: TrainingAttemptRecord["exerciseType"];
  direction: "rx" | "tx";
  target: string;
  answer: string;
  correct: boolean;
  responseMs?: number;
  charWpm?: number;
  effectiveWpm?: number;
  charWpmBand?: TrainingAttemptRecord["charWpmBand"];
  effectiveWpmBand?: TrainingAttemptRecord["effectiveWpmBand"];
}): TrainingAttemptRecord {
  return {
    id: overrides.id,
    schemaVersion: 1,
    updatedAt: overrides.occurredAtUtc,
    sessionId: "session-1",
    occurredAt: {
      utc: overrides.occurredAtUtc,
      localDate: overrides.occurredAtUtc.slice(0, 10),
      utcOffsetMinutes: 0,
      timeZone: "UTC",
    },
    source: "learn",
    direction: overrides.direction,
    exerciseType: overrides.exerciseType,
    rawTarget: overrides.target,
    rawResponse: overrides.answer,
    normalizedTarget: overrides.target,
    normalizedResponse: overrides.answer,
    correct: overrides.correct,
    assisted: false,
    replayed: false,
    abandoned: false,
    scoringAlgorithmVersion: "alignment-v1",
    observations: [
      {
        kind: overrides.correct ? "match" : "substitution",
        correct: overrides.correct,
        targetIndex: 0,
        target: overrides.target,
        answerIndex: 0,
        answer: overrides.answer,
      },
    ],
    ...(overrides.responseMs === undefined
      ? {}
      : { responseMs: overrides.responseMs }),
    charWpm: overrides.charWpm ?? 20,
    effectiveWpm: overrides.effectiveWpm ?? 12,
    ...(overrides.charWpmBand === undefined
      ? {}
      : { charWpmBand: overrides.charWpmBand }),
    ...(overrides.effectiveWpmBand === undefined
      ? {}
      : { effectiveWpmBand: overrides.effectiveWpmBand }),
    toneHz: 600,
    noiseLevel: 0,
  };
}

describe("buildCharacterSpeedProficiency", () => {
  it("computes same-band and transfer-weighted evidence per character band", () => {
    const attempts = [
      attempt({
        id: "a1",
        occurredAtUtc: "2026-09-24T10:00:00.000Z",
        exerciseType: "copy-character",
        direction: "rx",
        target: "K",
        answer: "K",
        correct: true,
        charWpmBand: 20,
        effectiveWpmBand: 12,
      }),
      attempt({
        id: "a2",
        occurredAtUtc: "2026-09-24T10:01:00.000Z",
        exerciseType: "copy-character",
        direction: "rx",
        target: "K",
        answer: "M",
        correct: false,
        charWpmBand: 20,
        effectiveWpmBand: 12,
      }),
      attempt({
        id: "a3",
        occurredAtUtc: "2026-09-24T10:02:00.000Z",
        exerciseType: "copy-character",
        direction: "rx",
        target: "K",
        answer: "K",
        correct: true,
        charWpmBand: 25,
        effectiveWpmBand: 15,
      }),
      attempt({
        id: "a4",
        occurredAtUtc: "2026-09-24T10:03:00.000Z",
        exerciseType: "copy-character",
        direction: "rx",
        target: "K",
        answer: "M",
        correct: false,
        charWpmBand: 30,
        effectiveWpmBand: 18,
      }),
      attempt({
        id: "a5",
        occurredAtUtc: "2026-09-24T10:04:00.000Z",
        exerciseType: "copy-character",
        direction: "rx",
        target: "K",
        answer: "K",
        correct: true,
        charWpmBand: 40,
        effectiveWpmBand: 20,
      }),
    ];

    const result = buildCharacterSpeedProficiency({ attempts });
    const k = result.find((row) => row.character === "K");
    expect(k).toBeDefined();

    const band20 = k?.bands.find((entry) => entry.band === 20);
    expect(band20).toMatchObject({
      attempts: 2,
      correct: 1,
      weightedAttempts: 2.75,
      weightedCorrect: 1.5,
    });

    const band40 = k?.bands.find((entry) => entry.band === 40);
    expect(band40).toMatchObject({
      attempts: 1,
      correct: 1,
      weightedAttempts: 1.25,
      weightedCorrect: 1,
    });
  });

  it("uses bounded per-character windows", () => {
    const attempts = [
      attempt({
        id: "w1",
        occurredAtUtc: "2026-09-24T10:00:00.000Z",
        exerciseType: "copy-character",
        direction: "rx",
        target: "K",
        answer: "K",
        correct: true,
        charWpmBand: 20,
        effectiveWpmBand: 12,
      }),
      attempt({
        id: "w2",
        occurredAtUtc: "2026-09-24T10:01:00.000Z",
        exerciseType: "copy-character",
        direction: "rx",
        target: "K",
        answer: "M",
        correct: false,
        charWpmBand: 20,
        effectiveWpmBand: 12,
      }),
      attempt({
        id: "w3",
        occurredAtUtc: "2026-09-24T10:02:00.000Z",
        exerciseType: "copy-character",
        direction: "rx",
        target: "K",
        answer: "K",
        correct: true,
        charWpmBand: 20,
        effectiveWpmBand: 12,
      }),
    ];

    const result = buildCharacterSpeedProficiency({
      attempts,
      perCharacterWindow: 2,
    });
    const band20 = result
      .find((row) => row.character === "K")
      ?.bands.find((entry) => entry.band === 20);
    expect(band20).toMatchObject({
      attempts: 2,
      correct: 1,
      weightedAttempts: 2,
      weightedCorrect: 1,
    });
  });

  it("derives character bands for legacy attempts that omit band fields", () => {
    const attempts = [
      attempt({
        id: "legacy-1",
        occurredAtUtc: "2026-09-24T10:00:00.000Z",
        exerciseType: "copy-character",
        direction: "rx",
        target: "K",
        answer: "K",
        correct: true,
        charWpm: 21,
        effectiveWpm: 12,
      }),
      attempt({
        id: "legacy-2",
        occurredAtUtc: "2026-09-24T10:01:00.000Z",
        exerciseType: "copy-character",
        direction: "rx",
        target: "K",
        answer: "K",
        correct: true,
        charWpm: 22,
        effectiveWpm: 12,
      }),
    ];

    attempts.forEach((entry) => {
      delete entry.charWpmBand;
      delete entry.effectiveWpmBand;
    });

    const result = buildCharacterSpeedProficiency({ attempts });
    const band20 = result
      .find((row) => row.character === "K")
      ?.bands.find((entry) => entry.band === 20);
    expect(band20).toMatchObject({ attempts: 2, correct: 2 });
  });
});
