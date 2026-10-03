import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, normalizeSettings } from "../../core/settings.ts";
import { SettingsProvider } from "../settings-provider.tsx";
import {
  TrainingDataContext,
  type TrainingDataContextValue,
} from "../training-data-context.ts";
import { SettingsScreen } from "./SettingsScreen.tsx";

function renderSettings(
  initialSettings = DEFAULT_SETTINGS,
  persistSettings = vi.fn(),
  dataOverrides: Partial<TrainingDataContextValue> = {},
) {
  const baseData: TrainingDataContextValue = {
    loadCurriculum: vi.fn(),
    saveCurriculum: vi.fn(),
    reconcileCurriculum: vi.fn(),
    loadIntroductions: vi.fn(),
    saveIntroductions: vi.fn(),
    startLearnSessionPersistence: vi.fn(),
    startPracticeSessionPersistence: vi.fn(),
    getRetryClassification: vi.fn(),
    listDailyProjections: vi.fn(),
    listCharacterProjections: vi.fn(),
    listConfusionProjections: vi.fn(),
    exportPortableBackup: vi.fn(),
    previewPortableBackup: vi.fn(),
    replacePortableBackup: vi.fn(),
    resetPortableData: vi.fn(),
  };

  return render(
    <TrainingDataContext.Provider value={{ ...baseData, ...dataOverrides }}>
      <SettingsProvider
        initialSettings={initialSettings}
        persistSettings={persistSettings}
      >
        <SettingsScreen />
      </SettingsProvider>
    </TrainingDataContext.Provider>,
  );
}

function uploadBackupJson(contents = "{}") {
  const fileInput = screen.getByLabelText("Replace import") as HTMLInputElement;
  const file = new File([contents], "backup.json", {
    type: "application/json",
  });
  Object.defineProperty(file, "text", {
    value: async () => contents,
  });
  Object.defineProperty(fileInput, "files", {
    value: [file],
    configurable: true,
  });
  fireEvent.change(fileInput);
}

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("SettingsScreen continuous copy", () => {
  it("applies the one-minute default to migrated partial settings", () => {
    renderSettings(normalizeSettings({ charWpm: 18 }));

    expect(screen.getByLabelText("Continuous copy duration")).toHaveValue(
      "60000",
    );
  });

  it("persists an explicit duration choice through the portable store", () => {
    const persistSettings = vi.fn();
    renderSettings(DEFAULT_SETTINGS, persistSettings);
    fireEvent.change(screen.getByLabelText("Continuous copy duration"), {
      target: { value: "180000" },
    });

    expect(screen.getByLabelText("Continuous copy duration")).toHaveValue(
      "180000",
    );
    expect(persistSettings).toHaveBeenCalledWith(
      expect.objectContaining({ continuousCopyDurationMs: 180000 }),
    );
    expect(localStorage.getItem("k1frx.settings.v1")).toBeNull();
  });

  it("persists the speed-suggestion threshold and supports Off", () => {
    const persistSettings = vi.fn();
    renderSettings(DEFAULT_SETTINGS, persistSettings);

    fireEvent.change(screen.getByLabelText("Suggest more spacing after"), {
      target: { value: "off" },
    });

    expect(screen.getByLabelText("Suggest more spacing after")).toHaveValue(
      "off",
    );
    expect(persistSettings).toHaveBeenCalledWith(
      expect.objectContaining({ speedSuggestionAfterAttempts: "off" }),
    );
  });

  it("replaces data only after a valid preview and explicit confirmation", async () => {
    const previewPortableBackup = vi.fn().mockResolvedValue({
      exportedAt: "2026-10-03T10:00:00.000Z",
      appVersion: "1.2.3",
      counts: {
        sessions: 1,
        attempts: 1,
        progressionEvents: 0,
        milestones: 0,
        migrationLedgers: 0,
      },
      unlockedCharacters: 2,
      masteredCharacters: 0,
      replaceConfirmation: {
        targetDatasetGeneration: "dataset-live",
        backupDigestHex: "a".repeat(64),
        operationKey: "b".repeat(64),
      },
      sessionRange: {
        firstStartedAt: "2026-10-03T09:59:00.000Z",
        lastStartedAt: "2026-10-03T10:00:00.000Z",
      },
    });
    const replacePortableBackup = vi.fn().mockResolvedValue("applied");
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);

    renderSettings(DEFAULT_SETTINGS, vi.fn(), {
      previewPortableBackup,
      replacePortableBackup,
    });

    uploadBackupJson("{}");

    await waitFor(() => expect(previewPortableBackup).toHaveBeenCalledTimes(1));
    const replaceButton = screen.getByRole("button", {
      name: "Replace with import",
    });
    await waitFor(() => expect(replaceButton).toBeEnabled());

    fireEvent.click(replaceButton);
    await Promise.resolve();

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(replacePortableBackup).toHaveBeenCalledWith(
      "{}",
      expect.objectContaining({
        targetDatasetGeneration: "dataset-live",
      }),
    );
  });

  it("disables replace import when preview fails", async () => {
    const previewPortableBackup = vi
      .fn()
      .mockRejectedValue(
        new Error("backup integrity digest does not match payload"),
      );
    renderSettings(DEFAULT_SETTINGS, vi.fn(), {
      previewPortableBackup,
    });

    uploadBackupJson("{}");

    await waitFor(() => expect(previewPortableBackup).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "backup integrity digest does not match payload",
      ),
    );
    expect(
      screen.getByRole("button", { name: "Replace with import" }),
    ).toBeDisabled();
  });

  it("does not mutate data when replace confirmation is canceled", async () => {
    const previewPortableBackup = vi.fn().mockResolvedValue({
      exportedAt: "2026-10-03T10:00:00.000Z",
      appVersion: "1.2.3",
      counts: {
        sessions: 1,
        attempts: 1,
        progressionEvents: 0,
        milestones: 0,
        migrationLedgers: 0,
      },
      unlockedCharacters: 2,
      masteredCharacters: 0,
      replaceConfirmation: {
        targetDatasetGeneration: "dataset-live",
        backupDigestHex: "a".repeat(64),
        operationKey: "b".repeat(64),
      },
      sessionRange: {
        firstStartedAt: "2026-10-03T09:59:00.000Z",
        lastStartedAt: "2026-10-03T10:00:00.000Z",
      },
    });
    const replacePortableBackup = vi.fn();
    vi.spyOn(window, "confirm").mockReturnValue(false);

    renderSettings(DEFAULT_SETTINGS, vi.fn(), {
      previewPortableBackup,
      replacePortableBackup,
    });

    uploadBackupJson("{}");

    fireEvent.click(
      await screen.findByRole("button", { name: "Replace with import" }),
    );
    await Promise.resolve();
    expect(replacePortableBackup).not.toHaveBeenCalled();
  });

  it("requires typed RESET and explicit confirmation before reset", async () => {
    const resetPortableData = vi.fn().mockResolvedValue(undefined);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);

    renderSettings(DEFAULT_SETTINGS, vi.fn(), {
      resetPortableData,
    });

    fireEvent.click(screen.getByRole("button", { name: "Reset learner data" }));
    expect(
      await screen.findByText("Type RESET to confirm data reset."),
    ).toBeInTheDocument();
    expect(resetPortableData).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Reset confirmation"), {
      target: { value: "RESET" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Reset learner data" }));
    await Promise.resolve();

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(resetPortableData).not.toHaveBeenCalled();
  });
});
