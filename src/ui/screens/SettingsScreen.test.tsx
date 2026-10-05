import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CHARACTER_WPM_BANDS,
  DEFAULT_SETTINGS,
  EFFECTIVE_WPM_BANDS,
  normalizeSettings,
} from "../../core/settings.ts";
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

function mockStoragePersistenceApi(options: {
  persisted: () => Promise<boolean>;
  persist: () => Promise<boolean>;
}) {
  Object.defineProperty(navigator, "storage", {
    configurable: true,
    value: {
      persisted: options.persisted,
      persist: options.persist,
    },
  });
}

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

  it("shows exactly the canonical character speed options", () => {
    renderSettings();

    const characterSelect = screen.getByLabelText(
      "Character speed",
    ) as HTMLSelectElement;
    const options = Array.from(characterSelect.options).map((option) =>
      Number(option.value),
    );

    expect(options).toEqual(CHARACTER_WPM_BANDS);
  });

  it("filters effective speed options to values at or below character speed", () => {
    renderSettings({ ...DEFAULT_SETTINGS, charWpm: 15, effectiveWpm: 12 });

    const effectiveSelect = screen.getByLabelText(
      "Effective speed",
    ) as HTMLSelectElement;
    const options = Array.from(effectiveSelect.options).map((option) =>
      Number(option.value),
    );

    expect(options).toEqual(EFFECTIVE_WPM_BANDS.filter((wpm) => wpm <= 15));
  });

  it("clamps effective speed when character speed is lowered", () => {
    const persistSettings = vi.fn();
    renderSettings(DEFAULT_SETTINGS, persistSettings);

    fireEvent.change(screen.getByLabelText("Effective speed"), {
      target: { value: "20" },
    });
    fireEvent.change(screen.getByLabelText("Character speed"), {
      target: { value: "15" },
    });

    expect(screen.getByLabelText("Character speed")).toHaveValue("15");
    expect(screen.getByLabelText("Effective speed")).toHaveValue("15");
    expect(persistSettings).toHaveBeenLastCalledWith(
      expect.objectContaining({ charWpm: 15, effectiveWpm: 15 }),
    );
  });

  it("persists canonical speed bands after selector updates", () => {
    const persistSettings = vi.fn();
    renderSettings(DEFAULT_SETTINGS, persistSettings);

    fireEvent.change(screen.getByLabelText("Character speed"), {
      target: { value: "25" },
    });
    fireEvent.change(screen.getByLabelText("Effective speed"), {
      target: { value: "18" },
    });

    expect(persistSettings).toHaveBeenLastCalledWith(
      expect.objectContaining({ charWpm: 25, effectiveWpm: 18 }),
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

  it("requests persistent storage from a user gesture and shows granted status", async () => {
    const persisted = vi.fn().mockResolvedValue(false);
    const persist = vi.fn().mockResolvedValue(true);
    mockStoragePersistenceApi({ persisted, persist });

    renderSettings();

    await waitFor(() => {
      expect(
        screen.getByText(/Persistent storage is not granted/i),
      ).toBeInTheDocument();
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Request persistent storage" }),
    );

    await waitFor(() => {
      expect(
        screen.getByText(/Persistent storage is enabled/i),
      ).toBeInTheDocument();
    });
    expect(persisted).toHaveBeenCalledTimes(1);
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it("keeps a safe not-granted status when persistence is denied", async () => {
    const persisted = vi.fn().mockResolvedValue(false);
    const persist = vi.fn().mockResolvedValue(false);
    mockStoragePersistenceApi({ persisted, persist });

    renderSettings();

    fireEvent.click(
      await screen.findByRole("button", { name: "Request persistent storage" }),
    );

    await waitFor(() => {
      expect(
        screen.getByText(/Persistent storage is not granted/i),
      ).toBeInTheDocument();
    });
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it("shows an error message when persistence request throws", async () => {
    mockStoragePersistenceApi({
      persisted: vi.fn().mockResolvedValue(false),
      persist: vi.fn().mockRejectedValue(new Error("persist failed")),
    });

    renderSettings();

    fireEvent.click(
      await screen.findByRole("button", { name: "Request persistent storage" }),
    );

    await waitFor(() => {
      expect(
        screen.getByText(/Could not determine persistent-storage status/i),
      ).toBeInTheDocument();
    });
    expect(screen.getByRole("alert")).toHaveTextContent("persist failed");
  });

  it("reports when persistent storage controls are unsupported", async () => {
    Object.defineProperty(navigator, "storage", {
      configurable: true,
      value: undefined,
    });

    renderSettings();

    await waitFor(() => {
      expect(
        screen.getByText(/does not expose persistent-storage controls/i),
      ).toBeInTheDocument();
    });
    expect(
      screen.getByRole("button", { name: "Request persistent storage" }),
    ).toBeDisabled();
  });
});
