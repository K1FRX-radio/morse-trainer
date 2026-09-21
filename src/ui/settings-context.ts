import { createContext, useContext } from "react";
import {
  DEFAULT_SETTINGS,
  normalizeSettings,
  type PracticeSettings,
} from "../core/settings.ts";

export const SETTINGS_STORAGE_KEY = "k1frx.settings.v1";

export type SettingsContextValue = {
  settings: PracticeSettings;
  update: (patch: Partial<PracticeSettings>) => void;
};

export const SettingsContext = createContext<SettingsContextValue | undefined>(
  undefined,
);

export function loadSettings(): PracticeSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (raw) {
      return normalizeSettings(JSON.parse(raw) as Partial<PracticeSettings>);
    }
  } catch {
    // Ignore malformed or unavailable storage; fall back to defaults.
  }
  return DEFAULT_SETTINGS;
}

export function useSettings(): SettingsContextValue {
  const value = useContext(SettingsContext);
  if (!value) {
    throw new Error("useSettings must be used within a SettingsProvider");
  }
  return value;
}
