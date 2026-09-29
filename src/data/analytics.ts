import type {
  CharacterProjectionRecord,
  ConfusionProjectionRecord,
  DailyProjectionRecord,
  RecentCharacterObservation,
} from "./models.ts";

export type AccuracyValue = {
  correct: number;
  total: number;
  accuracy: number | null;
};

export type OverallAnalyticsSummary = {
  totalActiveMs: number;
  totalSessions: number;
  totalAttempts: number;
  rx: AccuracyValue;
  tx: AccuracyValue;
  averageEffectiveWpm: number | null;
  activeDayCount: number;
};

export type DailyTrendRow = {
  localDate: string;
  activeMs: number;
  sessionCount: number;
  attemptCount: number;
  rx: AccuracyValue;
  tx: AccuracyValue;
  averageEffectiveWpm: number | null;
};

export type ResponseTimeSummary = {
  samples: number;
  averageMs: number;
  minimumMs: number;
  maximumMs: number;
};

export type CharacterSummary = {
  character: string;
  direction: "rx" | "tx";
  recentObservationCount: number;
  recentCorrectCount: number;
  recentAccuracy: number | null;
  mostRecentObservationUtc?: string;
  rxResponseTime?: ResponseTimeSummary;
};

export type ConfusionSummary = {
  target: string;
  answer: string;
  count: number;
};

function ratio(correct: number, total: number): number | null {
  return total === 0 ? null : correct / total;
}

function toAccuracy(correct: number, total: number): AccuracyValue {
  return { correct, total, accuracy: ratio(correct, total) };
}

function compareLocalDateAsc(
  left: DailyProjectionRecord,
  right: DailyProjectionRecord,
): number {
  return left.localDate.localeCompare(right.localDate);
}

function compareConfusions(
  left: ConfusionProjectionRecord,
  right: ConfusionProjectionRecord,
): number {
  return (
    right.count - left.count ||
    left.target.localeCompare(right.target) ||
    left.answer.localeCompare(right.answer)
  );
}

function compareCharacterSummaryDifficulty(
  left: CharacterSummary,
  right: CharacterSummary,
): number {
  const leftAccuracy = left.recentAccuracy ?? 1;
  const rightAccuracy = right.recentAccuracy ?? 1;
  return (
    leftAccuracy - rightAccuracy ||
    right.recentObservationCount - left.recentObservationCount ||
    left.character.localeCompare(right.character) ||
    left.direction.localeCompare(right.direction)
  );
}

function mostRecentObservationUtc(
  observations: readonly RecentCharacterObservation[],
): string | undefined {
  let latest: string | undefined;
  for (const observation of observations) {
    const current = observation.occurredAt.utc;
    if (latest === undefined || current > latest) latest = current;
  }
  return latest;
}

function summarizeResponseTimes(
  observations: readonly RecentCharacterObservation[],
): ResponseTimeSummary | undefined {
  const values = observations
    .map((observation) => observation.responseMs)
    .filter((value): value is number => value !== undefined);
  if (values.length === 0) return undefined;

  const total = values.reduce((sum, value) => sum + value, 0);
  return {
    samples: values.length,
    averageMs: total / values.length,
    minimumMs: Math.min(...values),
    maximumMs: Math.max(...values),
  };
}

export function buildAnalyticsSummary(
  dailyRows: readonly DailyProjectionRecord[],
): OverallAnalyticsSummary {
  const totals = dailyRows.reduce(
    (accumulator, row) => {
      accumulator.activeMs += row.activeMs;
      accumulator.sessions += row.sessionCount;
      accumulator.attempts += row.attemptCount;
      accumulator.rxCorrect += row.rxCorrect;
      accumulator.rxTotal += row.rxTotal;
      accumulator.txCorrect += row.txCorrect;
      accumulator.txTotal += row.txTotal;
      accumulator.effectiveWpmTotal += row.effectiveWpmTotal;
      accumulator.effectiveWpmSamples += row.effectiveWpmSamples;
      if (row.activeMs > 0) accumulator.activeDays += 1;
      return accumulator;
    },
    {
      activeMs: 0,
      sessions: 0,
      attempts: 0,
      rxCorrect: 0,
      rxTotal: 0,
      txCorrect: 0,
      txTotal: 0,
      effectiveWpmTotal: 0,
      effectiveWpmSamples: 0,
      activeDays: 0,
    },
  );

  return {
    totalActiveMs: totals.activeMs,
    totalSessions: totals.sessions,
    totalAttempts: totals.attempts,
    rx: toAccuracy(totals.rxCorrect, totals.rxTotal),
    tx: toAccuracy(totals.txCorrect, totals.txTotal),
    averageEffectiveWpm:
      totals.effectiveWpmSamples === 0
        ? null
        : totals.effectiveWpmTotal / totals.effectiveWpmSamples,
    activeDayCount: totals.activeDays,
  };
}

export function buildDailyTrend(
  dailyRows: readonly DailyProjectionRecord[],
): DailyTrendRow[] {
  return [...dailyRows].sort(compareLocalDateAsc).map((row) => ({
    localDate: row.localDate,
    activeMs: row.activeMs,
    sessionCount: row.sessionCount,
    attemptCount: row.attemptCount,
    rx: toAccuracy(row.rxCorrect, row.rxTotal),
    tx: toAccuracy(row.txCorrect, row.txTotal),
    averageEffectiveWpm:
      row.effectiveWpmSamples === 0
        ? null
        : row.effectiveWpmTotal / row.effectiveWpmSamples,
  }));
}

export function buildCharacterSummaries(
  characterRows: readonly CharacterProjectionRecord[],
): CharacterSummary[] {
  const summaries = characterRows.map((row) => {
    const recentObservationCount = row.recent.length;
    const recentCorrectCount = row.recent.filter(
      (observation) => observation.correct,
    ).length;
    const latestObservationUtc = mostRecentObservationUtc(row.recent);
    const responseTime =
      row.direction === "rx" ? summarizeResponseTimes(row.recent) : undefined;

    const summary: CharacterSummary = {
      character: row.character,
      direction: row.direction,
      recentObservationCount,
      recentCorrectCount,
      recentAccuracy: ratio(recentCorrectCount, recentObservationCount),
      ...(latestObservationUtc === undefined
        ? {}
        : { mostRecentObservationUtc: latestObservationUtc }),
      ...(responseTime === undefined ? {} : { rxResponseTime: responseTime }),
    };

    return summary;
  });

  return summaries.sort(compareCharacterSummaryDifficulty);
}

export function buildConfusionSummaries(
  confusionRows: readonly ConfusionProjectionRecord[],
): ConfusionSummary[] {
  return [...confusionRows].sort(compareConfusions).map((row) => ({
    target: row.target,
    answer: row.answer,
    count: row.count,
  }));
}
