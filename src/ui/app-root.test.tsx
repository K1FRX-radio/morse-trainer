import { render, screen, waitFor } from "@testing-library/react";
import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import type {
  TrainingDataBootstrap,
  TrainingDataBootstrapOptions,
} from "../data/bootstrap.ts";
import type { LegacyStorage } from "../data/legacy-migration.ts";
import type { StorageLifecycleEvent } from "../data/storage-lifecycle.ts";
import { AppRoot } from "./app-root.tsx";

function memoryStorage(): LegacyStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
}

function bootstrapFixture(): TrainingDataBootstrap {
  const repository = {
    close: vi.fn(),
    savePortableSettings: vi.fn(async () => undefined),
    saveCurriculumState: vi.fn(async () => undefined),
    getCurriculumState: vi.fn(async () => undefined),
    saveIntroductions: vi.fn(async () => undefined),
    getRetryClassification: vi.fn(async () => ({
      retryCount: 0,
      threshold: 3,
      reachedThreshold: false,
      eligible: false,
      recommendation: undefined,
      lastAttemptAt: undefined,
    })),
    listDailyProjections: vi.fn(async () => []),
    getDashboardAggregate: vi.fn(async () => ({
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
    })),
    listCharacterProjections: vi.fn(async () => []),
    listConfusionProjections: vi.fn(async () => []),
    listMilestones: vi.fn(async () => []),
    exportPortableBackup: vi.fn(async () => ({})),
    previewPortableBackup: vi.fn(async () => ({})),
    replacePortableBackup: vi.fn(async () => "applied"),
    resetPortableData: vi.fn(async () => undefined),
  };

  return {
    repository: repository as never,
    settings: {
      charWpm: 20,
      effectiveWpm: 12,
      toneHz: 600,
      volume: 0.7,
      noiseLevel: 0,
      pacing: "auto",
      continuousCopyDurationMs: 60000,
      speedSuggestionAfterAttempts: 3,
    },
    curriculum: {
      config: {
        order: ["K", "M", "U"],
        startCount: 2,
        windowSize: 12,
        minNewCharObservations: 8,
        reviewDecayAccuracy: 0.85,
      },
      characters: [
        {
          character: "K",
          state: "learning",
          needsReview: false,
          reviewStreak: 0,
          rx: { totalAttempts: 0, recentResults: [] },
          tx: { totalAttempts: 0, recentResults: [] },
        },
        {
          character: "M",
          state: "learning",
          needsReview: false,
          reviewStreak: 0,
          rx: { totalAttempts: 0, recentResults: [] },
          tx: { totalAttempts: 0, recentResults: [] },
        },
      ],
    },
    introductions: [],
    recoveredSessionCount: 0,
  };
}

describe("AppRoot lifecycle integration", () => {
  it("renders blocked-upgrade guidance while startup is pending", async () => {
    let lifecycleEventHandler:
      ((event: "upgrade-blocked" | "reload-required") => void) | undefined;

    const createBootstrap = vi.fn(
      async (
        _storage: LegacyStorage,
        options?: TrainingDataBootstrapOptions,
      ) => {
        lifecycleEventHandler = options?.databaseOptions?.onLifecycleEvent;
        await new Promise(() => undefined);
        return bootstrapFixture();
      },
    );

    render(
      <AppRoot
        dependencies={{
          createBootstrap,
          subscribeLifecycle: () => () => undefined,
          reloadPage: vi.fn(),
          storage: memoryStorage(),
          tabId: "tab-self",
        }}
      />,
    );

    expect(screen.getByText("Opening training data...")).toBeInTheDocument();

    act(() => {
      lifecycleEventHandler?.("upgrade-blocked");
    });

    await waitFor(() => {
      expect(
        screen.getByText(/database upgrade is blocked by another open tab/i),
      ).toBeInTheDocument();
    });
  });

  it("shows potential-blocker guidance for other-tab upgrade-blocked broadcasts", async () => {
    let subscribeHandler: ((event: StorageLifecycleEvent) => void) | undefined;

    render(
      <AppRoot
        dependencies={{
          createBootstrap: vi.fn(async () => {
            await new Promise(() => undefined);
            return bootstrapFixture();
          }),
          subscribeLifecycle: (subscriber) => {
            subscribeHandler = subscriber;
            return () => undefined;
          },
          reloadPage: vi.fn(),
          storage: memoryStorage(),
          tabId: "tab-self",
        }}
      />,
    );

    act(() => {
      subscribeHandler?.({
        type: "upgrade-blocked",
        databaseName: "k1frx-morse-trainer",
        emittedAt: "2026-10-04T22:00:00.000Z",
        sourceTabId: "tab-other",
      });
    });

    await waitFor(() => {
      expect(
        screen.getByText(/this tab may be blocking it/i),
      ).toBeInTheDocument();
    });
  });

  it("ignores lifecycle broadcasts emitted by this tab", async () => {
    let subscribeHandler: ((event: StorageLifecycleEvent) => void) | undefined;

    render(
      <AppRoot
        dependencies={{
          createBootstrap: vi.fn(async () => {
            await new Promise(() => undefined);
            return bootstrapFixture();
          }),
          subscribeLifecycle: (subscriber) => {
            subscribeHandler = subscriber;
            return () => undefined;
          },
          reloadPage: vi.fn(),
          storage: memoryStorage(),
          tabId: "tab-self",
        }}
      />,
    );

    act(() => {
      subscribeHandler?.({
        type: "upgrade-blocked",
        databaseName: "k1frx-morse-trainer",
        emittedAt: "2026-10-04T22:00:00.000Z",
        sourceTabId: "tab-self",
      });
    });

    expect(screen.queryByText(/this tab may be blocking it/i)).toBeNull();
  });

  it("clears startup blocked guidance after a connection-released broadcast", async () => {
    let lifecycleEventHandler:
      ((event: "upgrade-blocked" | "reload-required") => void) | undefined;
    let subscribeHandler: ((event: StorageLifecycleEvent) => void) | undefined;

    render(
      <AppRoot
        dependencies={{
          createBootstrap: vi.fn(
            async (
              _storage: LegacyStorage,
              options?: TrainingDataBootstrapOptions,
            ) => {
              lifecycleEventHandler =
                options?.databaseOptions?.onLifecycleEvent;
              await new Promise(() => undefined);
              return bootstrapFixture();
            },
          ),
          subscribeLifecycle: (subscriber) => {
            subscribeHandler = subscriber;
            return () => undefined;
          },
          reloadPage: vi.fn(),
          storage: memoryStorage(),
          tabId: "tab-self",
        }}
      />,
    );

    act(() => {
      lifecycleEventHandler?.("upgrade-blocked");
    });

    await waitFor(() => {
      expect(
        screen.getByText(/database upgrade is blocked by another open tab/i),
      ).toBeInTheDocument();
    });

    act(() => {
      subscribeHandler?.({
        type: "connection-closed-for-upgrade",
        databaseName: "k1frx-morse-trainer",
        emittedAt: "2026-10-04T22:00:10.000Z",
        sourceTabId: "tab-other",
      });
    });

    await waitFor(() => {
      expect(
        screen.queryByText(/database upgrade is blocked by another open tab/i),
      ).toBeNull();
    });
  });

  it("blocks interaction and requires reload after local versionchange", async () => {
    let lifecycleEventHandler:
      ((event: "upgrade-blocked" | "reload-required") => void) | undefined;
    const reloadPage = vi.fn();

    render(
      <AppRoot
        dependencies={{
          createBootstrap: vi.fn(
            async (
              _storage: LegacyStorage,
              options?: TrainingDataBootstrapOptions,
            ) => {
              lifecycleEventHandler =
                options?.databaseOptions?.onLifecycleEvent;
              return bootstrapFixture();
            },
          ),
          subscribeLifecycle: () => () => undefined,
          reloadPage,
          storage: memoryStorage(),
          tabId: "tab-self",
        }}
      />,
    );

    await screen.findByRole("heading", { name: "Learn" });

    act(() => {
      lifecycleEventHandler?.("reload-required");
    });

    await waitFor(() => {
      expect(
        screen.getByText(/training-data connection is stale/i),
      ).toBeInTheDocument();
    });
    expect(screen.queryByRole("link", { name: "Practice" })).toBeNull();

    screen.getByRole("button", { name: "Reload now" }).click();
    expect(reloadPage).toHaveBeenCalledTimes(1);
  });

  it("renders indexeddb-unavailable guidance and retry affordance", async () => {
    render(
      <AppRoot
        dependencies={{
          createBootstrap: vi.fn(async () => {
            throw new Error("IndexedDB unavailable in this context");
          }),
          subscribeLifecycle: () => () => undefined,
          reloadPage: vi.fn(),
          storage: memoryStorage(),
          tabId: "tab-self",
        }}
      />,
    );

    await waitFor(() => {
      expect(
        screen.getByText(/Storage is unavailable in this browser context/i),
      ).toBeInTheDocument();
    });
    expect(
      screen.getByRole("button", { name: "Retry opening data" }),
    ).toBeEnabled();
  });
});
