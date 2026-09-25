import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, normalizeSettings } from "../../core/settings.ts";
import { SettingsProvider } from "../settings-provider.tsx";
import { SettingsScreen } from "./SettingsScreen.tsx";

function renderSettings(
  initialSettings = DEFAULT_SETTINGS,
  persistSettings = vi.fn(),
) {
  return render(
    <SettingsProvider
      initialSettings={initialSettings}
      persistSettings={persistSettings}
    >
      <SettingsScreen />
    </SettingsProvider>,
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
});
