import {
  MAX_KEYING_MARK_SAMPLES,
  MAX_KEYING_SPACE_SAMPLES,
  type EncodedKeyingTiming,
  type TrainingAttemptRecord,
  type TrainingSessionRecord,
} from "./models.ts";
import { encodeKeyingTiming } from "./keying-timing.ts";

export const BENCHMARK_ATTEMPT_COUNT = 100_000;
export const BENCHMARK_SESSION_COUNT = 500;

type BenchmarkDateTime = {
  utc: string;
  localDate: string;
  utcOffsetMinutes: number;
  timeZone: string;
};

export type BenchmarkFixture = {
  sessions: TrainingSessionRecord[];
  attempts: TrainingAttemptRecord[];
  txProfileCounts: {
    short: number;
    long: number;
    nearCap: number;
    truncated: number;
  };
};

type AttemptObservation = TrainingAttemptRecord["observations"][number];

function pointInTime(index: number): BenchmarkDateTime {
  const value = new Date(Date.UTC(2026, 8, 1, 0, index, 0, 0));
  const localDate = value.toISOString().slice(0, 10);
  return {
    utc: value.toISOString(),
    localDate,
    utcOffsetMinutes: 0,
    timeZone: "UTC",
  };
}

function makeTimingSamples(
  count: number,
  seed: number,
  baseMs: number,
): number[] {
  const values: number[] = [];
  for (let index = 0; index < count; index += 1) {
    values.push(baseMs + ((seed + index * 7) % 13));
  }
  return values;
}

function txProfileForIndex(
  txIndex: number,
): "short" | "long" | "near-cap" | "truncated" {
  if (txIndex % 100 === 0) return "truncated";
  if (txIndex % 100 === 1) return "near-cap";
  if (txIndex % 10 === 0) return "long";
  return "short";
}

function txPayload(txIndex: number): {
  exerciseType: "send-character" | "send-group" | "send-word";
  target: string;
  answer: string;
  keying: EncodedKeyingTiming;
  durationMs: number;
  profile: "short" | "long" | "nearCap" | "truncated";
} {
  const profile = txProfileForIndex(txIndex);
  const chars = ["K", "M", "R", "S", "U", "A", "N", "T"];

  if (profile === "short") {
    const marks = makeTimingSamples(32, txIndex, 40);
    const spaces = makeTimingSamples(31, txIndex + 3, 45);
    return {
      exerciseType: "send-character",
      target: chars[txIndex % chars.length],
      answer: chars[txIndex % chars.length],
      keying: encodeKeyingTiming(marks, spaces, 45),
      durationMs: [...marks, ...spaces].reduce((sum, value) => sum + value, 0),
      profile: "short",
    };
  }

  if (profile === "long") {
    const marks = makeTimingSamples(240, txIndex, 35);
    const spaces = makeTimingSamples(239, txIndex + 5, 42);
    return {
      exerciseType: "send-word",
      target: "MORSETRAINER",
      answer: "MORSETRAINER",
      keying: encodeKeyingTiming(marks, spaces, 40),
      durationMs: [...marks, ...spaces].reduce((sum, value) => sum + value, 0),
      profile: "long",
    };
  }

  if (profile === "near-cap") {
    const marks = makeTimingSamples(MAX_KEYING_MARK_SAMPLES - 1, txIndex, 30);
    const spaces = makeTimingSamples(
      MAX_KEYING_SPACE_SAMPLES - 1,
      txIndex + 7,
      34,
    );
    return {
      exerciseType: "send-group",
      target: "KMRSUANTKMRSUANT",
      answer: "KMRSUANTKMRSUANT",
      keying: encodeKeyingTiming(marks, spaces, 32),
      durationMs: [...marks, ...spaces].reduce((sum, value) => sum + value, 0),
      profile: "nearCap",
    };
  }

  const marks = makeTimingSamples(MAX_KEYING_MARK_SAMPLES + 80, txIndex, 28);
  const spaces = makeTimingSamples(
    MAX_KEYING_SPACE_SAMPLES + 60,
    txIndex + 11,
    32,
  );
  return {
    exerciseType: "send-group",
    target: "TRUNCATIONCASETRUNCATIONCASE",
    answer: "TRUNCATIONCASETRUNCATIONCASE",
    keying: encodeKeyingTiming(marks, spaces, 30),
    durationMs: [...marks, ...spaces].reduce((sum, value) => sum + value, 0),
    profile: "truncated",
  };
}

function mutateFirstCharacter(text: string, replacement: string): string {
  if (text.length === 0) {
    return replacement;
  }
  const first = text[0];
  const next =
    replacement === first ? (first === "K" ? "M" : "K") : replacement;
  return `${next}${text.slice(1)}`;
}

function buildObservations(
  target: string,
  answer: string,
): TrainingAttemptRecord["observations"] {
  const observations: AttemptObservation[] = [];
  const span = Math.max(target.length, answer.length);

  for (let index = 0; index < span; index += 1) {
    const targetChar = target[index];
    const answerChar = answer[index];

    if (targetChar !== undefined && answerChar !== undefined) {
      observations.push({
        kind: targetChar === answerChar ? "match" : "substitution",
        correct: targetChar === answerChar,
        targetIndex: index,
        target: targetChar,
        answerIndex: index,
        answer: answerChar,
      });
      continue;
    }

    if (targetChar !== undefined) {
      observations.push({
        kind: "deletion",
        correct: false,
        targetIndex: index,
        target: targetChar,
      });
      continue;
    }

    if (answerChar !== undefined) {
      observations.push({
        kind: "insertion",
        correct: false,
        answerIndex: index,
        answer: answerChar,
      });
    }
  }

  return observations;
}

export function buildBenchmarkFixture(options?: {
  sessionCount?: number;
  attemptCount?: number;
}): BenchmarkFixture {
  const sessionCount = options?.sessionCount ?? BENCHMARK_SESSION_COUNT;
  const attemptCount = options?.attemptCount ?? BENCHMARK_ATTEMPT_COUNT;
  if (attemptCount % sessionCount !== 0) {
    throw new RangeError("attemptCount must be divisible by sessionCount");
  }
  const attemptsPerSession = attemptCount / sessionCount;

  const sessions: TrainingSessionRecord[] = [];
  const attempts: TrainingAttemptRecord[] = [];

  const txProfileCounts = {
    short: 0,
    long: 0,
    nearCap: 0,
    truncated: 0,
  };
  let txAttemptIndex = 0;

  for (let sessionIndex = 0; sessionIndex < sessionCount; sessionIndex += 1) {
    const startedAt = pointInTime(sessionIndex * (attemptsPerSession + 2));
    const endedAt = pointInTime(sessionIndex * (attemptsPerSession + 2) + 1);
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
      attemptCount: attemptsPerSession,
      finalizedAttemptCount: attemptsPerSession,
      completedCards: attemptsPerSession,
      valid: true,
      charWpm: 20,
      effectiveWpm: 14,
      toneHz: 600,
      noiseLevel: 0,
      unlockedAtStart: ["K", "M", "R", "S", "U", "A", "N", "T"],
      unlockedAtEnd: ["K", "M", "R", "S", "U", "A", "N", "T"],
      appVersion: "0.0.0",
      revision: 1,
    });

    for (
      let attemptOffset = 0;
      attemptOffset < attemptsPerSession;
      attemptOffset += 1
    ) {
      const globalAttemptIndex =
        sessionIndex * attemptsPerSession + attemptOffset;
      const occurredAt = pointInTime(
        sessionIndex * (attemptsPerSession + 2) + 2 + attemptOffset,
      );
      const targetCharacter = ["K", "M", "R", "S", "U", "A", "N", "T"][
        globalAttemptIndex % 8
      ];
      const substitution = ["M", "R", "S", "U", "A", "N", "T", "K"][
        globalAttemptIndex % 8
      ];
      const correct = globalAttemptIndex % 7 !== 0;
      const assisted = globalAttemptIndex % 37 === 0;
      const replayed = globalAttemptIndex % 53 === 0;

      if (sessionSource === "copy-practice") {
        const answer = correct ? targetCharacter : substitution;
        attempts.push({
          id: `bench-attempt-${globalAttemptIndex}`,
          schemaVersion: 1,
          updatedAt: occurredAt.utc,
          sessionId: id,
          occurredAt,
          source: sessionSource,
          direction: "rx",
          exerciseType: "copy-character",
          rawTarget: targetCharacter,
          rawResponse: answer,
          normalizedTarget: targetCharacter,
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
              target: targetCharacter,
              answerIndex: 0,
              answer,
            },
          ],
          responseMs: 100 + (globalAttemptIndex % 400),
          charWpm: 20,
          effectiveWpm: 14,
          toneHz: 600,
          noiseLevel: 0,
        });
      } else {
        const payload = txPayload(txAttemptIndex);
        txProfileCounts[payload.profile] += 1;
        txAttemptIndex += 1;
        const answer = correct
          ? payload.answer
          : mutateFirstCharacter(payload.answer, substitution);

        attempts.push({
          id: `bench-attempt-${globalAttemptIndex}`,
          schemaVersion: 1,
          updatedAt: occurredAt.utc,
          sessionId: id,
          occurredAt,
          source: sessionSource,
          direction: "tx",
          exerciseType: payload.exerciseType,
          rawTarget: payload.target,
          rawResponse: answer,
          normalizedTarget: payload.target,
          normalizedResponse: answer,
          correct,
          assisted,
          replayed,
          abandoned: false,
          scoringAlgorithmVersion: "alignment-v1",
          observations: buildObservations(payload.target, answer),
          durationMs: payload.durationMs,
          keying: payload.keying,
          charWpm: 20,
          effectiveWpm: 14,
          toneHz: 600,
          noiseLevel: 0,
        });
      }
    }
  }

  return { sessions, attempts, txProfileCounts };
}
