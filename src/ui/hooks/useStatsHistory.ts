import { useEffect, useMemo, useState } from "react";
import {
  buildAnalyticsSummary,
  buildCharacterSummaries,
  buildConfusionSummaries,
  buildDailyTrend,
  type CharacterSummary,
  type ConfusionSummary,
  type DailyTrendRow,
  type OverallAnalyticsSummary,
} from "../../data/analytics.ts";
import { captureDateTime } from "../../data/time.ts";
import { useTrainingData } from "../training-data-context.ts";

const RECENT_DAY_WINDOW = 30;
const CHARACTER_LIMIT_PER_DIRECTION = 200;
const CONFUSION_LIMIT = 50;
const DIFFICULT_CHARACTER_LIMIT = 12;

export type StatsHistoryState = {
  loading: boolean;
  error?: string;
  summary: OverallAnalyticsSummary;
  recentDailyRows: DailyTrendRow[];
  difficultCharacters: CharacterSummary[];
  recentConfusions: ConfusionSummary[];
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

export function useStatsHistory(): StatsHistoryState {
  const trainingData = useTrainingData();
  const [state, setState] = useState<StatsHistoryState>({
    loading: true,
    summary: EMPTY_SUMMARY,
    recentDailyRows: [],
    difficultCharacters: [],
    recentConfusions: [],
  });

  useEffect(() => {
    let canceled = false;

    async function load(): Promise<void> {
      try {
        const now = new Date();
        const { fromLocalDate, toLocalDate } = localDateWindow(now);
        const [dailyRows, rxCharacters, txCharacters, confusionRows] =
          await Promise.all([
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
          ]);

        if (canceled) return;

        const summary = buildAnalyticsSummary(dailyRows);
        const recentDailyRows = [...buildDailyTrend(dailyRows)].reverse();
        const difficultCharacters = buildCharacterSummaries([
          ...rxCharacters,
          ...txCharacters,
        ]).slice(0, DIFFICULT_CHARACTER_LIMIT);
        const recentConfusions = buildConfusionSummaries(confusionRows);

        setState({
          loading: false,
          summary,
          recentDailyRows,
          difficultCharacters,
          recentConfusions,
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
  }, [trainingData]);

  return useMemo(() => state, [state]);
}
