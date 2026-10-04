import { performance } from "node:perf_hooks";
import { IDBKeyRange, indexedDB } from "fake-indexeddb";
import { TrainerDatabase } from "./indexeddb.ts";
import type { TrainingAttemptRecord, TrainingSessionRecord } from "./models.ts";
import { DexieTrainingRepository } from "./repository.ts";

const ATTEMPT_COUNT = 100_000;
const SESSION_COUNT = 500;
const ATTEMPTS_PER_SESSION = ATTEMPT_COUNT / SESSION_COUNT;

type BenchmarkSample = {
  sourceBytes: number;
  projectionBytes: number;
  rebuildMs: number;
  dailyQueryMs: number;
  rxQueryMs: number;
  txQueryMs: number;
  confusionQueryMs: number;
};

function encodeBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function pointInTime(index: number): {
  utc: string;
  localDate: string;
  utcOffsetMinutes: number;
  timeZone: string;
} {
  const value = new Date(Date.UTC(2026, 8, 1, 0, index, 0, 0));
  const localDate = value.toISOString().slice(0, 10);
  return {
    utc: value.toISOString(),
    localDate,
    utcOffsetMinutes: 0,
    timeZone: "UTC",
  };
}

function buildDataset(): {
  sessions: TrainingSessionRecord[];
  attempts: TrainingAttemptRecord[];
} {
  const sessions: TrainingSessionRecord[] = [];
  const attempts: TrainingAttemptRecord[] = [];
  const chars = ["K", "M", "R", "S", "U", "A", "N", "T"];

  for (let sessionIndex = 0; sessionIndex < SESSION_COUNT; sessionIndex += 1) {
    const startedAt = pointInTime(sessionIndex);
    const endedAt = pointInTime(sessionIndex + 1);
    const id = `bench-session-${sessionIndex}`;
    const sessionSource =
      sessionIndex % 2 === 0 ? "copy-practice" : "send-practice";
    const sessionMode = sessionSource === "copy-practice" ? "copy" : "send";
    sessions.push({
      id,
      schemaVersion: 1,
      updatedAt: endedAt.utc,
      source: sessionSource,
      mode: sessionMode,
      status: "completed",
      startedAt,
      endedAt,
      activeMs: 120000,
      activeDateBuckets: [
        {
          localDate: startedAt.localDate,
          utcOffsetMinutes: 0,
          timeZone: "UTC",
          activeMs: 120000,
        },
      ],
      attemptCount: ATTEMPTS_PER_SESSION,
      finalizedAttemptCount: ATTEMPTS_PER_SESSION,
      completedCards: ATTEMPTS_PER_SESSION,
      valid: true,
      charWpm: 20,
      effectiveWpm: 14,
      toneHz: 600,
      noiseLevel: 0,
      unlockedAtStart: chars,
      unlockedAtEnd: chars,
      appVersion: "0.0.0",
      revision: 1,
    });

    for (
      let attemptOffset = 0;
      attemptOffset < ATTEMPTS_PER_SESSION;
      attemptOffset += 1
    ) {
      const globalAttemptIndex =
        sessionIndex * ATTEMPTS_PER_SESSION + attemptOffset;
      const occurredAt = pointInTime(globalAttemptIndex + 2);
      const direction: "rx" | "tx" =
        sessionSource === "copy-practice" ? "rx" : "tx";
      const target = chars[globalAttemptIndex % chars.length];
      const substitution = chars[(globalAttemptIndex + 1) % chars.length];
      const correct = globalAttemptIndex % 7 !== 0;
      const answer = correct ? target : substitution;
      const assisted = globalAttemptIndex % 37 === 0;
      const replayed = globalAttemptIndex % 53 === 0;

      attempts.push({
        id: `bench-attempt-${globalAttemptIndex}`,
        schemaVersion: 1,
        updatedAt: occurredAt.utc,
        sessionId: id,
        occurredAt,
        source: sessionSource,
        direction,
        exerciseType: direction === "rx" ? "copy-character" : "send-character",
        rawTarget: target,
        rawResponse: answer,
        normalizedTarget: target,
        normalizedResponse: answer,
        correct,
        assisted,
        replayed,
        abandoned: false,
        scoringAlgorithmVersion: "alignment-v1",
        observations: [
          {
            kind: correct ? "match" : "substitution",
            correct,
            targetIndex: 0,
            target,
            answerIndex: 0,
            answer,
          },
        ],
        ...(direction === "rx"
          ? { responseMs: 100 + (globalAttemptIndex % 400) }
          : {}),
        charWpm: 20,
        effectiveWpm: 14,
        toneHz: 600,
        noiseLevel: 0,
      });
    }
  }

  return { sessions, attempts };
}

async function runBenchmark(): Promise<BenchmarkSample> {
  const { sessions, attempts } = buildDataset();

  const database = new TrainerDatabase({
    name: crypto.randomUUID(),
    indexedDB,
    IDBKeyRange,
  });
  const repository = new DexieTrainingRepository(database, {
    now: () => new Date("2026-10-03T00:00:00.000Z"),
  });

  try {
    await repository.open();
    await database.sessions.bulkPut(sessions);
    await database.attempts.bulkPut(attempts);

    const rebuildStart = performance.now();
    await repository.rebuildProjections();
    const rebuildMs = performance.now() - rebuildStart;

    const dailyStart = performance.now();
    await repository.listDailyProjections({
      fromLocalDate: "2026-09-01",
      toLocalDate: "2026-09-30",
      limit: 30,
    });
    const dailyQueryMs = performance.now() - dailyStart;

    const rxStart = performance.now();
    await repository.listCharacterProjections({ direction: "rx", limit: 200 });
    const rxQueryMs = performance.now() - rxStart;

    const txStart = performance.now();
    await repository.listCharacterProjections({ direction: "tx", limit: 200 });
    const txQueryMs = performance.now() - txStart;

    const confusionStart = performance.now();
    await repository.listConfusionProjections({ limit: 50 });
    const confusionQueryMs = performance.now() - confusionStart;

    const sourceBytes =
      encodeBytes(await database.sessions.toArray()) +
      encodeBytes(await database.attempts.toArray());
    const projectionBytes =
      encodeBytes(await database.dailyProjections.toArray()) +
      encodeBytes(await database.characterProjections.toArray()) +
      encodeBytes(await database.confusionProjections.toArray());

    return {
      sourceBytes,
      projectionBytes,
      rebuildMs,
      dailyQueryMs,
      rxQueryMs,
      txQueryMs,
      confusionQueryMs,
    };
  } finally {
    repository.close();
    await database.delete();
  }
}

describe("100k history benchmark", () => {
  it("keeps projection rebuild and bounded dashboard queries within budget", async () => {
    const sample = await runBenchmark();
    // Logged for docs/metrics.md benchmark evidence.
    console.info("100k-benchmark", JSON.stringify(sample));

    const budget = {
      rebuildMs: 12_000,
      queryMs: 300,
    };

    expect(sample.rebuildMs).toBeLessThanOrEqual(budget.rebuildMs);
    expect(sample.dailyQueryMs).toBeLessThanOrEqual(budget.queryMs);
    expect(sample.rxQueryMs).toBeLessThanOrEqual(budget.queryMs);
    expect(sample.txQueryMs).toBeLessThanOrEqual(budget.queryMs);
    expect(sample.confusionQueryMs).toBeLessThanOrEqual(budget.queryMs);

    expect(sample.sourceBytes).toBeGreaterThan(0);
    expect(sample.projectionBytes).toBeGreaterThan(0);
  }, 60_000);
});
