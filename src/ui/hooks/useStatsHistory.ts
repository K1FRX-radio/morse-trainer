import { useEffect, useMemo, useState } from "react";
import {
  buildAnalyticsSummary,
  buildCharacterSummaries,
  buildConfusionSummaries,
  buildDailyTrend,
  buildMilestoneSummaries,
  buildPracticeStreakSummary,
  buildSessionWindowSummary,
  type CharacterSummary,
  type ConfusionSummary,
  type DailyTrendRow,
  type MilestoneSummary,
  type OverallAnalyticsSummary,
  type SessionWindowSummary,
  type StreakSummary,
} from "../../data/analytics.ts";
import { captureDateTime } from "../../data/time.ts";
import { useTrainingData } from "../training-data-context.ts";

const RECENT_DAY_WINDOW = 30;
const CHARACTER_LIMIT_PER_DIRECTION = 200;
const CONFUSION_LIMIT = 50;
const MILESTONE_LIMIT = 10;

type CurrentCurriculumSummary = {
  currentCharacter: string | null;
  activeCharacters: string[];
};

export type StatsHistoryState = {
  loading: boolean;
  error?: string;
  summary: OverallAnalyticsSummary;
  windows: SessionWindowSummary;
  streaks: StreakSummary;
  trends: DailyTrendRow[];
  currentCharacter: string | null;
  activeCharacters: CharacterSummary[];
  recentConfusions: ConfusionSummary[];
  milestones: MilestoneSummary[];
};

const EMPTY_SUMMARY: OverallAnalyticsSummary = {
  totalActiveMs: 0,
  totalSessions: 0,
  totalAttempts: 0,
  rx: { correct: 0, total: 0, accuracy: null },
  tx: { correct: 0, total: 0, accuracy: null },
  averageEffectiveWpm: null,
  activeDayCount: 0,
};

const EMPTY_WINDOWS: SessionWindowSummary = {
  today: { activeMs: 0, sessionCount: 0, averageSessionDurationMs: null },
  thisWeek: { activeMs: 0, sessionCount: 0, averageSessionDurationMs: null },
  allTime: { activeMs: 0, sessionCount: 0, averageSessionDurationMs: null },
};

const EMPTY_STREAKS: StreakSummary = {
  practiceDayCount: 0,
  currentStreakDays: 0,
  longestStreakDays: 0,
};

function localDateWindow(now: Date): {
  fromLocalDate: string;
  toLocalDate: string;
} {
  const toLocalDate = captureDateTime(now).localDate;
  const fromDate = new Date(now);
  fromDate.setDate(fromDate.getDate() - (RECENT_DAY_WINDOW - 1));
  const fromLocalDate = captureDateTime(fromDate).localDate;
  return { fromLocalDate, toLocalDate };
}

function summarizeCurrentCurriculum(
  trainingData: ReturnType<typeof useTrainingData>,
): CurrentCurriculumSummary {
  const curriculum = trainingData.loadCurriculum();
  const activeCharacters = curriculum.characters.map(
    (progress) => progress.character,
  );

  return {
    currentCharacter:
      activeCharacters.length === 0
        ? null
        : (activeCharacters[activeCharacters.length - 1] ?? null),
    activeCharacters,
  };
}

function buildActiveCharacterRows(
  summaries: readonly CharacterSummary[],
  activeCharacters: readonly string[],
): CharacterSummary[] {
  const byKey = new Map(
    summaries.map((row) => [`${row.direction}:${row.character}`, row]),
  );

  const rows: CharacterSummary[] = [];
  for (const character of activeCharacters) {
    for (const direction of ["rx", "tx"] as const) {
      const key = `${direction}:${character}`;
      const existing = byKey.get(key);
      if (existing) {
        rows.push(existing);
        continue;
      }
      rows.push({
        character,
        direction,
        recentObservationCount: 0,
        recentCorrectCount: 0,
        recentAccuracy: null,
      });
    }
  }

  return rows;
}

export function useStatsHistory(): StatsHistoryState {
  const trainingData = useTrainingData();
  const statsRevision = trainingData.statsRevision ?? 0;
  const [state, setState] = useState<StatsHistoryState>({
    loading: true,
    summary: EMPTY_SUMMARY,
    windows: EMPTY_WINDOWS,
    streaks: EMPTY_STREAKS,
    trends: [],
    currentCharacter: null,
    activeCharacters: [],
    recentConfusions: [],
    milestones: [],
  });

  useEffect(() => {
    let canceled = false;

    async function load(): Promise<void> {
      try {
        const now = new Date();
        const { fromLocalDate, toLocalDate } = localDateWindow(now);
        const [
          dailyRows,
          rxCharacters,
          txCharacters,
          confusionRows,
          milestones,
        ] = await Promise.all([
          trainingData.listDailyProjections({
            fromLocalDate,
            toLocalDate,
            limit: RECENT_DAY_WINDOW,
          }),
          trainingData.listCharacterProjections({
            direction: "rx",
            limit: CHARACTER_LIMIT_PER_DIRECTION,
          }),
          trainingData.listCharacterProjections({
            direction: "tx",
            limit: CHARACTER_LIMIT_PER_DIRECTION,
          }),
          trainingData.listConfusionProjections({
            limit: CONFUSION_LIMIT,
          }),
          trainingData.listMilestones
            ? trainingData.listMilestones({ limit: MILESTONE_LIMIT })
            : Promise.resolve([]),
        ]);

        if (canceled) return;

        const summary = buildAnalyticsSummary(dailyRows);
        const windows = buildSessionWindowSummary(dailyRows, toLocalDate);
        const streaks = buildPracticeStreakSummary(dailyRows, toLocalDate);
        const trends = buildDailyTrend(dailyRows);
        const characterSummaries = buildCharacterSummaries([
          ...rxCharacters,
          ...txCharacters,
        ]);
        const curriculum = summarizeCurrentCurriculum(trainingData);
        const activeCharacters = buildActiveCharacterRows(
          characterSummaries,
          curriculum.activeCharacters,
        );
        const recentConfusions = buildConfusionSummaries(confusionRows);
        const milestoneSummaries = buildMilestoneSummaries(milestones);

        setState({
          loading: false,
          summary,
          windows,
          streaks,
          trends,
          currentCharacter: curriculum.currentCharacter,
          activeCharacters,
          recentConfusions,
          milestones: milestoneSummaries,
        });
      } catch (error) {
        if (canceled) return;
        const message =
          error instanceof Error ? error.message : "Unknown error";
        setState((current) => ({
          ...current,
          loading: false,
          error: message,
        }));
      }
    }

    void load();
    return () => {
      canceled = true;
    };
  }, [trainingData, statsRevision]);

  return useMemo(() => state, [state]);
}
