import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { App } from "../../App.tsx";
import { DEFAULT_CURRICULUM_CONFIG } from "../../content/curriculum-data.ts";
import { createInitialState } from "../../core/curriculum.ts";
import { DEFAULT_SETTINGS } from "../../core/settings.ts";
import type {
  CharacterProjectionRecord,
  ConfusionProjectionRecord,
  DailyProjectionRecord,
  MilestoneRecord,
} from "../../data/models.ts";
import type { DashboardAggregateRecord } from "../../data/repository.ts";
import { SettingsContext } from "../settings-context.ts";
import { TrainingDataContext } from "../training-data-context.ts";
import { StatsHistoryScreen } from "./StatsHistoryScreen.tsx";

function trainingDataStub(
  overrides: {
    daily?: DailyProjectionRecord[];
    rx?: CharacterProjectionRecord[];
    tx?: CharacterProjectionRecord[];
    confusions?: ConfusionProjectionRecord[];
    milestones?: MilestoneRecord[];
    aggregate?: DashboardAggregateRecord;
    statsRevision?: number;
  } = {},
) {
  const curriculum = createInitialState(DEFAULT_CURRICULUM_CONFIG);
  const daily = overrides.daily ?? [];
  const rx = overrides.rx ?? [];
  const tx = overrides.tx ?? [];
  const confusions = overrides.confusions ?? [];
  const milestones = overrides.milestones ?? [];
  const aggregate =
    overrides.aggregate ??
    dashboardAggregate({
      totalSessions: daily.reduce((sum, row) => sum + row.sessionCount, 0),
      totalAttempts: daily.reduce((sum, row) => sum + row.attemptCount, 0),
    });

  return {
    statsRevision: overrides.statsRevision ?? 0,
    loadCurriculum: vi.fn(() => structuredClone(curriculum)),
    saveCurriculum: vi.fn(),
    reconcileCurriculum: vi.fn(async () => structuredClone(curriculum)),
    loadIntroductions: vi.fn(() => []),
    saveIntroductions: vi.fn(),
    startLearnSessionPersistence: vi.fn(async () => {
      throw new Error("not used");
    }),
    startPracticeSessionPersistence: vi.fn(async () => {
      throw new Error("not used");
    }),
    getRetryClassification: vi.fn(async () => ({
      consecutiveAccuracyMisses: 0,
      shouldSuggestSpacing: false,
    })),
    listDailyProjections: vi.fn(async () => daily),
    getDashboardAggregate: vi.fn(async () => aggregate),
    listCharacterProjections: vi.fn(
      async (query: { direction: "rx" | "tx" }) =>
        query.direction === "rx" ? rx : tx,
    ),
    listConfusionProjections: vi.fn(async () => confusions),
    listMilestones: vi.fn(async () => milestones),
  };
}

function renderStats(overrides: Parameters<typeof trainingDataStub>[0] = {}) {
  const context = trainingDataStub(overrides);
  render(
    <SettingsContext.Provider
      value={{
        settings: DEFAULT_SETTINGS,
        update: vi.fn(),
        outputDeviceId: "",
        setOutputDeviceId: vi.fn(),
      }}
    >
      <TrainingDataContext.Provider value={context}>
        <StatsHistoryScreen />
      </TrainingDataContext.Provider>
    </SettingsContext.Provider>,
  );
  return context;
}

describe("StatsHistoryScreen", () => {
  it("renders dashboard windows, trends, character metrics, confusions, and milestones", async () => {
    renderStats({
      daily: [
        daily("2026-09-24", {
          activeMs: 60000,
          sessionCount: 1,
          attemptCount: 3,
          rxCorrect: 2,
          rxTotal: 2,
          effectiveWpmTotal: 12,
          effectiveWpmSamples: 1,
        }),
        daily("2026-09-25", {
          activeMs: 120000,
          sessionCount: 2,
          attemptCount: 4,
          txCorrect: 3,
          txTotal: 4,
          effectiveWpmTotal: 24,
          effectiveWpmSamples: 2,
        }),
      ],
      rx: [
        character("K", "rx", [
          observation("2026-09-25T10:00:00.000Z", false, 320),
          observation("2026-09-25T11:00:00.000Z", true, 180),
        ]),
      ],
      tx: [
        character("M", "tx", [observation("2026-09-24T10:00:00.000Z", false)]),
      ],
      confusions: [confusion("M", "K", 3), confusion("A", "B", 3)],
      milestones: [
        milestone("m1", "character-unlocked", "2026-09-25T10:00:00.000Z", "M"),
      ],
    });

    await screen.findByRole("heading", { name: "History" });

    expect(screen.getByText("Current character")).toBeInTheDocument();
    expect(screen.getByText("Current WPM")).toBeInTheDocument();
    expect(screen.getByText("Eligible sessions")).toBeInTheDocument();
    expect(screen.getByText("Practice days")).toBeInTheDocument();

    const trendList = await screen.findByRole("list", {
      name: "30-day trends",
    });
    expect(trendList).toHaveTextContent("2026-09-25");

    const characterList = screen.getByRole("list", {
      name: "Current character metrics",
    });
    expect(characterList).toHaveTextContent("K (RX)");
    expect(characterList).toHaveTextContent(
      "RX response median 250ms (2 samples)",
    );

    const confusionList = screen.getByRole("list", {
      name: "Recent confusions",
    });
    expect(confusionList).toHaveTextContent("A -> B");
    expect(confusionList).toHaveTextContent("M -> K");

    const milestones = screen.getByRole("list", { name: "Latest milestones" });
    expect(milestones).toHaveTextContent("character-unlocked");
    expect(milestones).toHaveTextContent("Character M");
  });

  it("shows empty state and neutral placeholders for missing accuracies", async () => {
    renderStats({ daily: [] });

    await screen.findByText(/No training history yet/);
    expect(screen.getByText("RX accuracy")).toBeInTheDocument();
    expect(screen.getAllByText("N/A").length).toBeGreaterThan(0);
  });

  it("refreshes dashboard data when stats revision changes", async () => {
    const first = trainingDataStub({
      statsRevision: 0,
      daily: [daily("2026-09-25", { attemptCount: 1 })],
      aggregate: dashboardAggregate({ totalAttempts: 1 }),
    });
    const second = trainingDataStub({
      statsRevision: 1,
      daily: [daily("2026-09-25", { attemptCount: 4 })],
      aggregate: dashboardAggregate({ totalAttempts: 4 }),
    });

    const { rerender } = render(
      <SettingsContext.Provider
        value={{
          settings: DEFAULT_SETTINGS,
          update: vi.fn(),
          outputDeviceId: "",
          setOutputDeviceId: vi.fn(),
        }}
      >
        <TrainingDataContext.Provider value={first}>
          <StatsHistoryScreen />
        </TrainingDataContext.Provider>
      </SettingsContext.Provider>,
    );

    await screen.findByText("1");

    rerender(
      <SettingsContext.Provider
        value={{
          settings: DEFAULT_SETTINGS,
          update: vi.fn(),
          outputDeviceId: "",
          setOutputDeviceId: vi.fn(),
        }}
      >
        <TrainingDataContext.Provider value={second}>
          <StatsHistoryScreen />
        </TrainingDataContext.Provider>
      </SettingsContext.Provider>,
    );

    await waitFor(() => {
      expect(screen.getByText("4")).toBeInTheDocument();
    });
  });

  it("uses aggregate all-time and streak metrics independently of 30-day trend rows", async () => {
    renderStats({
      daily: [
        daily("2026-10-04", {
          activeMs: 60000,
          sessionCount: 1,
          attemptCount: 2,
        }),
      ],
      aggregate: dashboardAggregate({
        totalActiveMs: 7_200_000,
        totalSessions: 45,
        totalAttempts: 300,
        todayActiveMs: 60_000,
        todaySessionCount: 1,
        thisWeekActiveMs: 420_000,
        thisWeekSessionCount: 7,
        practiceDayCount: 61,
        currentStreakDays: 35,
        longestStreakDays: 35,
      }),
    });

    await screen.findByRole("heading", { name: "History" });

    expect(screen.getByText("All-time active time")).toBeInTheDocument();
    expect(screen.getByText("2h 0m")).toBeInTheDocument();
    expect(screen.getByText("45")).toBeInTheDocument();
    expect(screen.getAllByText("35")).toHaveLength(2);

    const trendList = screen.getByRole("list", { name: "30-day trends" });
    expect(trendList).toHaveTextContent("2026-10-04");
  });

  it("is reachable from app navigation without direct Dexie access", async () => {
    const context = trainingDataStub();
    render(
      <MemoryRouter initialEntries={["/settings"]}>
        <SettingsContext.Provider
          value={{
            settings: DEFAULT_SETTINGS,
            update: vi.fn(),
            outputDeviceId: "",
            setOutputDeviceId: vi.fn(),
          }}
        >
          <TrainingDataContext.Provider value={context}>
            <App />
          </TrainingDataContext.Provider>
        </SettingsContext.Provider>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("link", { name: "History" }));
    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: "History" }),
      ).toBeInTheDocument();
    });
    expect(context.listDailyProjections).toHaveBeenCalled();
  });
});

function daily(
  localDate: string,
  overrides: Partial<DailyProjectionRecord> = {},
): DailyProjectionRecord {
  return {
    id: `daily:${localDate}`,
    schemaVersion: 1,
    updatedAt: "2026-09-25T12:00:00.000Z",
    projectionVersion: 1,
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
    ...overrides,
  };
}

function character(
  symbol: string,
  direction: "rx" | "tx",
  recent: CharacterProjectionRecord["recent"],
): CharacterProjectionRecord {
  return {
    id: `character:${direction}:${symbol}`,
    schemaVersion: 1,
    updatedAt: "2026-09-25T12:00:00.000Z",
    projectionVersion: 1,
    character: symbol,
    direction,
    recent,
  };
}

function observation(
  utc: string,
  correct: boolean,
  responseMs?: number,
): CharacterProjectionRecord["recent"][number] {
  return {
    attemptId: `attempt:${utc}`,
    occurredAt: {
      utc,
      localDate: "2026-09-25",
      utcOffsetMinutes: 0,
      timeZone: "UTC",
    },
    correct,
    kind: correct ? "match" : "substitution",
    answer: correct ? "K" : "M",
    ...(responseMs === undefined ? {} : { responseMs }),
  };
}

function confusion(
  target: string,
  answer: string,
  count: number,
): ConfusionProjectionRecord {
  return {
    id: `confusion:${target}:${answer}`,
    schemaVersion: 1,
    updatedAt: "2026-09-25T12:00:00.000Z",
    projectionVersion: 1,
    target,
    answer,
    count,
  };
}

function milestone(
  id: string,
  type: MilestoneRecord["type"],
  utc: string,
  character?: string,
): MilestoneRecord {
  return {
    id,
    schemaVersion: 1,
    updatedAt: utc,
    idempotencyKey: `key:${id}`,
    eventId: `event:${id}`,
    type,
    occurredAt: {
      utc,
      localDate: "2026-09-25",
      utcOffsetMinutes: 0,
      timeZone: "UTC",
    },
    migrationDerived: false,
    ...(character === undefined ? {} : { character }),
  };
}

function dashboardAggregate(
  overrides: Partial<DashboardAggregateRecord> = {},
): DashboardAggregateRecord {
  return {
    totalActiveMs: 0,
    totalSessions: 0,
    totalAttempts: 0,
    rxCorrect: 0,
    rxTotal: 0,
    txCorrect: 0,
    txTotal: 0,
    effectiveWpmTotal: 0,
    effectiveWpmSamples: 0,
    activeDayCount: 0,
    todayActiveMs: 0,
    todaySessionCount: 0,
    thisWeekActiveMs: 0,
    thisWeekSessionCount: 0,
    practiceDayCount: 0,
    currentStreakDays: 0,
    longestStreakDays: 0,
    ...overrides,
  };
}
