import { isValidTrainingSession } from "../core/session-validity.ts";
import {
  PROJECTION_VERSION,
  type CharacterProjectionRecord,
  type ConfusionProjectionRecord,
  type DailyProjectionRecord,
  type RecentCharacterObservation,
  type TrainingAttemptRecord,
  type TrainingSessionRecord,
} from "./models.ts";

export const CHARACTER_RECENT_WINDOW = 50;

export type ProjectionRows = {
  daily: DailyProjectionRecord[];
  characters: CharacterProjectionRecord[];
  confusions: ConfusionProjectionRecord[];
};

function encoded(value: string): string {
  return encodeURIComponent(value);
}

function dailyId(localDate: string): string {
  return `daily:${localDate}`;
}

function characterId(direction: "rx" | "tx", character: string): string {
  return `character:${direction}:${encoded(character)}`;
}

function confusionId(target: string, answer: string): string {
  return `confusion:${encoded(target)}:${encoded(answer)}`;
}

function emptyDaily(
  localDate: string,
  generatedAt: string,
): DailyProjectionRecord {
  return {
    id: dailyId(localDate),
    schemaVersion: 1,
    updatedAt: generatedAt,
    projectionVersion: PROJECTION_VERSION,
    localDate,
    activeMs: 0,
    sessionCount: 0,
    attemptCount: 0,
    rxCorrect: 0,
    rxTotal: 0,
    txCorrect: 0,
    txTotal: 0,
    effectiveWpmTotal: 0,
    effectiveWpmSamples: 0,
  };
}

function accuracyEligible(attempt: TrainingAttemptRecord): boolean {
  return !attempt.assisted && !attempt.replayed && !attempt.abandoned;
}

function compareAttempts(
  left: TrainingAttemptRecord,
  right: TrainingAttemptRecord,
): number {
  return (
    left.occurredAt.utc.localeCompare(right.occurredAt.utc) ||
    left.id.localeCompare(right.id)
  );
}

/** Rebuilds all derived rows from authoritative sessions and attempts. */
export function buildProjectionRows(
  sessions: readonly TrainingSessionRecord[],
  attempts: readonly TrainingAttemptRecord[],
  generatedAt: string,
): ProjectionRows {
  const daily = new Map<string, DailyProjectionRecord>();
  const characters = new Map<string, CharacterProjectionRecord>();

  const getDaily = (localDate: string): DailyProjectionRecord => {
    const existing = daily.get(localDate);
    if (existing) return existing;
    const created = emptyDaily(localDate, generatedAt);
    daily.set(localDate, created);
    return created;
  };

  for (const session of sessions) {
    if (!isValidTrainingSession(session)) continue;
    const startDay = getDaily(session.startedAt.localDate);
    startDay.sessionCount += 1;
    startDay.effectiveWpmTotal += session.effectiveWpm;
    startDay.effectiveWpmSamples += 1;
    for (const bucket of session.activeDateBuckets) {
      getDaily(bucket.localDate).activeMs += bucket.activeMs;
    }
  }

  for (const attempt of [...attempts].sort(compareAttempts)) {
    const day = getDaily(attempt.occurredAt.localDate);
    day.attemptCount += 1;
    if (!accuracyEligible(attempt)) continue;

    for (const observation of attempt.observations) {
      if (
        observation.target === undefined ||
        observation.kind === "insertion"
      ) {
        continue;
      }
      if (attempt.direction === "rx") {
        day.rxTotal += 1;
        if (observation.correct) day.rxCorrect += 1;
      } else {
        day.txTotal += 1;
        if (observation.correct) day.txCorrect += 1;
      }

      const id = characterId(attempt.direction, observation.target);
      let row = characters.get(id);
      if (!row) {
        row = {
          id,
          schemaVersion: 1,
          updatedAt: generatedAt,
          projectionVersion: PROJECTION_VERSION,
          character: observation.target,
          direction: attempt.direction,
          recent: [],
        };
        characters.set(id, row);
      }
      const recent: RecentCharacterObservation = {
        attemptId: attempt.id,
        occurredAt: attempt.occurredAt,
        correct: observation.correct,
        kind: observation.kind,
        ...(observation.answer !== undefined
          ? { answer: observation.answer }
          : {}),
        ...(attempt.direction === "rx" &&
        attempt.exerciseType === "copy-character" &&
        attempt.responseMs !== undefined
          ? { responseMs: attempt.responseMs }
          : {}),
      };
      row.recent.push(recent);
      if (row.recent.length > CHARACTER_RECENT_WINDOW) {
        row.recent.splice(0, row.recent.length - CHARACTER_RECENT_WINDOW);
      }
    }
  }

  const confusionCounts = new Map<
    string,
    { target: string; answer: string; count: number }
  >();
  for (const row of characters.values()) {
    if (row.direction !== "rx") continue;
    for (const observation of row.recent) {
      if (
        observation.kind !== "substitution" ||
        observation.answer === undefined
      ) {
        continue;
      }
      const id = confusionId(row.character, observation.answer);
      const current = confusionCounts.get(id) ?? {
        target: row.character,
        answer: observation.answer,
        count: 0,
      };
      current.count += 1;
      confusionCounts.set(id, current);
    }
  }

  return {
    daily: [...daily.values()].sort((left, right) =>
      left.localDate.localeCompare(right.localDate),
    ),
    characters: [...characters.values()].sort((left, right) =>
      left.id.localeCompare(right.id),
    ),
    confusions: [...confusionCounts.entries()]
      .map(([id, value]) => ({
        id,
        schemaVersion: 1,
        updatedAt: generatedAt,
        projectionVersion: PROJECTION_VERSION,
        ...value,
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
  };
}
