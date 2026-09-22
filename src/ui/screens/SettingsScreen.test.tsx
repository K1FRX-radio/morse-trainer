import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SETTINGS_STORAGE_KEY } from "../settings-context.ts";
import { SettingsProvider } from "../settings-provider.tsx";
import { SettingsScreen } from "./SettingsScreen.tsx";

function renderSettings() {
  return render(
    <SettingsProvider>
      <SettingsScreen />
    </SettingsProvider>,
  );
}

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe("SettingsScreen continuous copy", () => {
  it("applies the one-minute default to old stored settings", () => {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ charWpm: 18 }));
    renderSettings();

    expect(screen.getByLabelText("Continuous copy duration")).toHaveValue(
      "60000",
    );
  });

  it("persists an explicit duration choice", () => {
    renderSettings();
    fireEvent.change(screen.getByLabelText("Continuous copy duration"), {
      target: { value: "180000" },
    });

    expect(screen.getByLabelText("Continuous copy duration")).toHaveValue(
      "180000",
    );
    expect(
      JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) ?? "{}"),
    ).toMatchObject({ continuousCopyDurationMs: 180000 });
  });
});
