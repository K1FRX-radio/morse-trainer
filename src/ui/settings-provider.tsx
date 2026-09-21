import { useCallback, useMemo, useState, type ReactNode } from "react";
import {
  normalizeSettings,
  type PracticeSettings,
} from "../core/settings.ts";
import {
  OUTPUT_DEVICE_STORAGE_KEY,
  SETTINGS_STORAGE_KEY,
  SettingsContext,
  loadOutputDeviceId,
  loadSettings,
} from "./settings-context.ts";

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<PracticeSettings>(loadSettings);
  const [outputDeviceId, setOutputDeviceIdState] =
    useState<string>(loadOutputDeviceId);

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

  const setOutputDeviceId = useCallback((deviceId: string) => {
    setOutputDeviceIdState(deviceId);
    try {
      localStorage.setItem(OUTPUT_DEVICE_STORAGE_KEY, deviceId);
    } catch {
      // Persisting the device choice is best-effort.
    }
  }, []);

  const value = useMemo(
    () => ({ settings, update, outputDeviceId, setOutputDeviceId }),
    [settings, update, outputDeviceId, setOutputDeviceId],
  );

  return (
    <SettingsContext.Provider value={value}>
      {children}
    </SettingsContext.Provider>
  );
}
