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
} from "../../data/models.ts";
import { SettingsContext } from "../settings-context.ts";
import { TrainingDataContext } from "../training-data-context.ts";
import { StatsHistoryScreen } from "./StatsHistoryScreen.tsx";

function trainingDataStub(
  overrides: {
    daily?: DailyProjectionRecord[];
    rx?: CharacterProjectionRecord[];
    tx?: CharacterProjectionRecord[];
    confusions?: ConfusionProjectionRecord[];
  } = {},
) {
  const curriculum = createInitialState(DEFAULT_CURRICULUM_CONFIG);
  const daily = overrides.daily ?? [];
  const rx = overrides.rx ?? [];
  const tx = overrides.tx ?? [];
  const confusions = overrides.confusions ?? [];

  return {
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
    listCharacterProjections: vi.fn(
      async (query: { direction: "rx" | "tx" }) =>
        query.direction === "rx" ? rx : tx,
    ),
    listConfusionProjections: vi.fn(async () => confusions),
  };
}

function renderStats(overrides: Parameters<typeof trainingDataStub>[0] = {}) {
  const context = trainingDataStub(overrides);
  render(
    <TrainingDataContext.Provider value={context}>
      <StatsHistoryScreen />
    </TrainingDataContext.Provider>,
  );
  return context;
}

describe("StatsHistoryScreen", () => {
  it("renders summary values, daily ordering, difficult characters, and confusions", async () => {
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
          observation("2026-09-25T10:00:00.000Z", false, 300),
          observation("2026-09-25T11:00:00.000Z", true),
        ]),
      ],
      tx: [
        character("M", "tx", [observation("2026-09-24T10:00:00.000Z", false)]),
      ],
      confusions: [confusion("M", "K", 3), confusion("A", "B", 3)],
    });

    await screen.findByRole("heading", { name: "History" });

    expect(screen.getByText("Sessions")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("Attempts")).toBeInTheDocument();
    expect(screen.getByText("7")).toBeInTheDocument();

    const dailyList = await screen.findByRole("list", {
      name: "Recent daily activity",
    });
    const dailyRows = dailyList.querySelectorAll("li");
    expect(dailyRows[0]).toHaveTextContent("2026-09-25");

    expect(
      screen.getByRole("list", { name: "Difficult characters" }),
    ).toHaveTextContent("M (TX)");
    expect(
      screen.getByRole("list", { name: "Difficult characters" }),
    ).toHaveTextContent("K (RX)");
    expect(
      screen.getByText("RX response 300ms avg (1 samples)"),
    ).toBeInTheDocument();

    const confusionList = screen.getByRole("list", {
      name: "Recent confusions",
    });
    expect(confusionList).toHaveTextContent("A -> B");
    expect(confusionList).toHaveTextContent("M -> K");
  });

  it("shows empty state and neutral placeholders for missing accuracies", async () => {
    renderStats({ daily: [] });

    await screen.findByText(/No training history yet/);
    expect(screen.getByText("RX accuracy")).toBeInTheDocument();
    expect(screen.getAllByText("N/A").length).toBeGreaterThan(0);
  });

  it("preserves key labels on narrow layout", async () => {
    renderStats({ daily: [daily("2026-09-25", { activeMs: 60000 })] });

    await screen.findByRole("list", { name: "Recent daily activity" });
    expect(screen.getByText("Recent daily activity")).toBeInTheDocument();
    expect(screen.getByText("Difficult characters")).toBeInTheDocument();
    expect(screen.getByText("Recent confusions")).toBeInTheDocument();
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
