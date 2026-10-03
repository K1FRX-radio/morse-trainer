import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, normalizeSettings } from "../../core/settings.ts";
import { SettingsProvider } from "../settings-provider.tsx";
import { TrainingDataContext } from "../training-data-context.ts";
import { SettingsScreen } from "./SettingsScreen.tsx";

function renderSettings(
  initialSettings = DEFAULT_SETTINGS,
  persistSettings = vi.fn(),
) {
  return render(
    <TrainingDataContext.Provider
      value={{
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
      }}
    >
      <SettingsProvider
        initialSettings={initialSettings}
        persistSettings={persistSettings}
      >
        <SettingsScreen />
      </SettingsProvider>
    </TrainingDataContext.Provider>,
  );
}

beforeEach(() => localStorage.clear());
afterEach(cleanup);

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
});
