import { useCallback, useEffect, useState } from "react";
import {
  CONTINUOUS_COPY_DURATIONS,
  SPEED_SUGGESTION_THRESHOLDS,
  SETTING_RANGES,
  type ContinuousCopyDurationMs,
  type PracticeSettings,
  type SpeedSuggestionAfterAttempts,
} from "../../core/settings.ts";
import type { PortableBackupReplaceConfirmation } from "../../data/backup.ts";
import {
  getOutputSupport,
  listOutputDevices,
  requestOutputAccess,
  type OutputDevice,
} from "../../audio/output-devices.ts";
import { useTrainingData } from "../training-data-context.ts";
import { useSettings } from "../settings-context.ts";

type NumericField = "charWpm" | "effectiveWpm" | "toneHz";

type PersistenceStatus =
  | "checking"
  | "unsupported"
  | "granted"
  | "not-granted"
  | "requesting"
  | "error";

function hasPersistenceApi(): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.storage?.persisted === "function" &&
    typeof navigator.storage?.persist === "function"
  );
}

function RangeField({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="field">
      <span className="field__label">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

export function SettingsScreen() {
  const { settings, update, outputDeviceId, setOutputDeviceId } = useSettings();
  const {
    exportPortableBackup,
    previewPortableBackup,
    replacePortableBackup,
    resetPortableData,
  } = useTrainingData();
  const [devices, setDevices] = useState<OutputDevice[]>([]);
  const [access, setAccess] = useState<"idle" | "denied" | "ready">("idle");
  const [backupStatus, setBackupStatus] = useState<string | undefined>(
    undefined,
  );
  const [pendingBackupJson, setPendingBackupJson] = useState<
    string | undefined
  >(undefined);
  const [pendingReplaceConfirmation, setPendingReplaceConfirmation] = useState<
    PortableBackupReplaceConfirmation | undefined
  >(undefined);
  const [importPreview, setImportPreview] = useState<string | undefined>(
    undefined,
  );
  const [importError, setImportError] = useState<string | undefined>(undefined);
  const [resetConfirmText, setResetConfirmText] = useState("");
  const [persistenceStatus, setPersistenceStatus] =
    useState<PersistenceStatus>("checking");
  const [persistenceError, setPersistenceError] = useState<string | undefined>(
    undefined,
  );
  const outputSupport = getOutputSupport();

  const refreshPersistenceStatus = useCallback(async (): Promise<void> => {
    if (!hasPersistenceApi()) {
      setPersistenceStatus("unsupported");
      setPersistenceError(undefined);
      return;
    }
    try {
      const granted = await navigator.storage.persisted();
      setPersistenceStatus(granted ? "granted" : "not-granted");
      setPersistenceError(undefined);
    } catch (error) {
      setPersistenceStatus("error");
      setPersistenceError(
        error instanceof Error
          ? error.message
          : "Could not read persistence status.",
      );
    }
  }, []);

  async function requestPersistentStorage(): Promise<void> {
    if (!hasPersistenceApi()) {
      setPersistenceStatus("unsupported");
      setPersistenceError(undefined);
      return;
    }
    setPersistenceStatus("requesting");
    setPersistenceError(undefined);
    try {
      const granted = await navigator.storage.persist();
      setPersistenceStatus(granted ? "granted" : "not-granted");
    } catch (error) {
      setPersistenceStatus("error");
      setPersistenceError(
        error instanceof Error
          ? error.message
          : "Persistent-storage request failed.",
      );
    }
  }

  useEffect(() => {
    void refreshPersistenceStatus();
  }, [refreshPersistenceStatus]);

  async function enableOutputSelection(): Promise<void> {
    const granted = await requestOutputAccess();
    if (!granted) {
      setAccess("denied");
      return;
    }
    setDevices(await listOutputDevices());
    setAccess("ready");
  }

  async function exportBackup(): Promise<void> {
    if (!exportPortableBackup) {
      setBackupStatus("Backup export is unavailable in this build.");
      return;
    }
    try {
      const appVersion = import.meta.env.VITE_APP_VERSION ?? "0.0.0";
      const backup = await exportPortableBackup(appVersion);
      const text = JSON.stringify(backup, null, 2);
      const blob = new Blob([text], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `k1frx-backup-${backup.exportedAt.replace(/[:.]/g, "-")}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      setBackupStatus("Backup exported.");
    } catch (error) {
      setBackupStatus(
        error instanceof Error ? error.message : "Backup export failed.",
      );
    }
  }

  async function loadImport(file: File): Promise<void> {
    const text = await file.text();
    setPendingBackupJson(text);
    setPendingReplaceConfirmation(undefined);
    if (!previewPortableBackup) {
      setImportPreview(undefined);
      setImportError("Backup import is unavailable in this build.");
      return;
    }
    try {
      const preview = await previewPortableBackup(text);
      const range = preview.sessionRange
        ? `${preview.sessionRange.firstStartedAt} to ${preview.sessionRange.lastStartedAt}`
        : "no sessions";
      setImportError(undefined);
      setPendingReplaceConfirmation(preview.replaceConfirmation);
      setImportPreview(
        `Backup from ${preview.exportedAt} (${preview.appVersion}). Sessions: ${preview.counts.sessions}, attempts: ${preview.counts.attempts}, unlocked: ${preview.unlockedCharacters}, mastered: ${preview.masteredCharacters}, range: ${range}.`,
      );
    } catch (error) {
      setPendingReplaceConfirmation(undefined);
      setImportPreview(undefined);
      setImportError(
        error instanceof Error ? error.message : "Backup preview failed.",
      );
    }
  }

  async function confirmReplaceImport(): Promise<void> {
    if (!replacePortableBackup || !pendingBackupJson) {
      return;
    }
    if (!pendingReplaceConfirmation) {
      setImportError("Preview the backup again before replacing data.");
      return;
    }
    if (
      !window.confirm("Replace all portable learner data with this backup?")
    ) {
      return;
    }
    try {
      await replacePortableBackup(
        pendingBackupJson,
        pendingReplaceConfirmation,
      );
      window.location.reload();
    } catch (error) {
      setImportError(
        error instanceof Error ? error.message : "Backup import failed.",
      );
    }
  }

  async function confirmReset(): Promise<void> {
    if (!resetPortableData) {
      setBackupStatus("Data reset is unavailable in this build.");
      return;
    }
    if (resetConfirmText !== "RESET") {
      setBackupStatus("Type RESET to confirm data reset.");
      return;
    }
    if (
      !window.confirm("Reset all portable learner data to first-run defaults?")
    ) {
      return;
    }
    try {
      await resetPortableData();
      window.location.reload();
    } catch (error) {
      setBackupStatus(error instanceof Error ? error.message : "Reset failed.");
    }
  }

  const numberField = (
    field: NumericField,
    label: string,
    unit: string,
    step = 1,
  ) => {
    const range = SETTING_RANGES[field];
    return (
      <RangeField
        label={`${label}: ${settings[field]}${unit}`}
        value={settings[field]}
        min={range.min}
        max={range.max}
        step={step}
        onChange={(value) =>
          update({ [field]: value } as Partial<PracticeSettings>)
        }
      />
    );
  };

  const volumePct = Math.round(settings.volume * 100);
  const noisePct = Math.round(settings.noiseLevel * 100);

  return (
    <section>
      <h2>Settings</h2>

      {numberField("charWpm", "Character speed", " WPM")}
      {numberField("effectiveWpm", "Effective speed", " WPM")}
      {numberField("toneHz", "Tone", " Hz", 10)}

      <RangeField
        label={`Volume: ${volumePct}%`}
        value={volumePct}
        min={0}
        max={100}
        step={1}
        onChange={(value) => update({ volume: value / 100 })}
      />
      <RangeField
        label={`Band noise: ${noisePct}%`}
        value={noisePct}
        min={0}
        max={100}
        step={1}
        onChange={(value) => update({ noiseLevel: value / 100 })}
      />

      <label className="field">
        <span className="field__label">Learn pacing</span>
        <select
          value={settings.pacing}
          onChange={(event) =>
            update({
              pacing: event.target.value === "manual" ? "manual" : "auto",
            })
          }
        >
          <option value="auto">Automatic</option>
          <option value="manual">Press Continue between cards</option>
        </select>
      </label>

      <label className="field">
        <span className="field__label">Continuous copy duration</span>
        <select
          value={settings.continuousCopyDurationMs}
          onChange={(event) =>
            update({
              continuousCopyDurationMs: Number(
                event.target.value,
              ) as ContinuousCopyDurationMs,
            })
          }
        >
          {CONTINUOUS_COPY_DURATIONS.map((durationMs) => {
            const minutes = durationMs / 60000;
            return (
              <option key={durationMs} value={durationMs}>
                {minutes} {minutes === 1 ? "minute" : "minutes"}
              </option>
            );
          })}
        </select>
      </label>

      <label className="field">
        <span className="field__label">Suggest more spacing after</span>
        <select
          value={settings.speedSuggestionAfterAttempts}
          onChange={(event) =>
            update({
              speedSuggestionAfterAttempts:
                event.target.value === "off"
                  ? "off"
                  : (Number(
                      event.target.value,
                    ) as SpeedSuggestionAfterAttempts),
            })
          }
        >
          {SPEED_SUGGESTION_THRESHOLDS.map((threshold) => (
            <option key={threshold} value={threshold}>
              {threshold === "off"
                ? "Off"
                : `${threshold} continuous-copy attempts`}
            </option>
          ))}
        </select>
      </label>

      <p className="settings__note">
        Effective speed is capped at the character speed (Farnsworth spacing).
        Learn recommends a continuous-copy duration for your active character
        set without changing this choice.
      </p>

      <h3>Audio output</h3>
      {!outputSupport.supported && (
        <p className="settings__note">
          {outputSupport.reason === "insecure-context"
            ? "Device selection needs a secure context. Open the app at http://localhost (not a LAN IP) or over HTTPS."
            : outputSupport.reason === "no-setsinkid"
              ? "This browser cannot redirect Web Audio output. Use a Chromium browser (Chrome or Edge); audio otherwise follows the system default."
              : "Media devices are unavailable here, so audio follows the system default."}
        </p>
      )}
      {outputSupport.supported && access !== "ready" && (
        <div className="field">
          <button type="button" onClick={() => void enableOutputSelection()}>
            Choose output device
          </button>
          <span className="field__label">
            {access === "denied"
              ? "Permission denied. Reset this site's microphone permission in Chrome, then try again."
              : "Chrome asks for microphone permission; it is only used to reveal device names, and no audio is recorded."}
          </span>
        </div>
      )}
      {outputSupport.supported && access === "ready" && (
        <label className="field">
          <span className="field__label">Output device</span>
          <select
            value={outputDeviceId}
            onChange={(event) => setOutputDeviceId(event.target.value)}
          >
            <option value="">System default</option>
            {devices.map((device) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label}
              </option>
            ))}
          </select>
        </label>
      )}

      <h3>Data management</h3>

      <div className="field">
        <button
          type="button"
          onClick={() => void requestPersistentStorage()}
          disabled={
            persistenceStatus === "requesting" ||
            persistenceStatus === "unsupported"
          }
        >
          {persistenceStatus === "requesting"
            ? "Requesting persistent storage..."
            : "Request persistent storage"}
        </button>
        <span className="field__label" role="status">
          {persistenceStatus === "granted"
            ? "Persistent storage is enabled for this browser profile."
            : persistenceStatus === "not-granted"
              ? "Persistent storage is not granted. Training still works, but the browser may evict data under pressure."
              : persistenceStatus === "unsupported"
                ? "This browser does not expose persistent-storage controls."
                : persistenceStatus === "error"
                  ? "Could not determine persistent-storage status."
                  : "Checking persistent-storage status..."}
        </span>
        {persistenceError && (
          <span className="field__label" role="alert">
            {persistenceError}
          </span>
        )}
      </div>

      <div className="field">
        <button type="button" onClick={() => void exportBackup()}>
          Export backup
        </button>
      </div>

      <label className="field">
        <span className="field__label">Replace import</span>
        <input
          type="file"
          accept="application/json,.json"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            void loadImport(file);
          }}
        />
      </label>
      {importPreview && <p role="status">{importPreview}</p>}
      {importError && (
        <p className="feedback feedback--bad" role="alert">
          {importError}
        </p>
      )}
      <div className="field">
        <button
          type="button"
          onClick={() => void confirmReplaceImport()}
          disabled={
            !pendingBackupJson ||
            !pendingReplaceConfirmation ||
            Boolean(importError)
          }
        >
          Replace with import
        </button>
      </div>

      <label className="field">
        <span className="field__label">Type RESET to confirm reset</span>
        <input
          aria-label="Reset confirmation"
          type="text"
          value={resetConfirmText}
          onChange={(event) => setResetConfirmText(event.target.value)}
        />
      </label>
      <div className="field">
        <button type="button" onClick={() => void confirmReset()}>
          Reset learner data
        </button>
      </div>
      {backupStatus && <p role="status">{backupStatus}</p>}
    </section>
  );
}
