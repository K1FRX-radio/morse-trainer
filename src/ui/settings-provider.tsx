import { useCallback, useMemo, useState, type ReactNode } from "react";
import {
  DEFAULT_SETTINGS,
  normalizeSettings,
  type PracticeSettings,
} from "../core/settings.ts";
import {
  OUTPUT_DEVICE_STORAGE_KEY,
  SettingsContext,
  loadOutputDeviceId,
} from "./settings-context.ts";

type SettingsProviderProps = {
  children: ReactNode;
  initialSettings?: PracticeSettings;
  persistSettings?: (settings: PracticeSettings) => void | Promise<void>;
};

export function SettingsProvider({
  children,
  initialSettings = DEFAULT_SETTINGS,
  persistSettings,
}: SettingsProviderProps) {
  const [settings, setSettings] = useState<PracticeSettings>(() =>
    normalizeSettings(initialSettings),
  );
  const [outputDeviceId, setOutputDeviceIdState] =
    useState<string>(loadOutputDeviceId);

  const update = useCallback(
    (patch: Partial<PracticeSettings>) => {
      setSettings((current) => {
        const next = normalizeSettings({ ...current, ...patch });
        try {
          void Promise.resolve(persistSettings?.(next)).catch(() => undefined);
        } catch {
          // Settings remain usable in memory if persistence is unavailable.
        }
        return next;
      });
    },
    [persistSettings],
  );

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
