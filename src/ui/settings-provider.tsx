import { useCallback, useMemo, useState, type ReactNode } from "react";
import {
  normalizeSettings,
  type PracticeSettings,
} from "../core/settings.ts";
import {
  SETTINGS_STORAGE_KEY,
  SettingsContext,
  loadSettings,
} from "./settings-context.ts";

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<PracticeSettings>(loadSettings);

  const update = useCallback((patch: Partial<PracticeSettings>) => {
    setSettings((current) => {
      const next = normalizeSettings({ ...current, ...patch });
      try {
        localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Persisting settings is best-effort.
      }
      return next;
    });
  }, []);

  const value = useMemo(() => ({ settings, update }), [settings, update]);

  return (
    <SettingsContext.Provider value={value}>
      {children}
    </SettingsContext.Provider>
  );
}
