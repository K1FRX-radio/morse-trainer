import { useState } from "react";
import { SETTING_RANGES, type PracticeSettings } from "../../core/settings.ts";
import {
  getOutputSupport,
  listOutputDevices,
  requestOutputAccess,
  type OutputDevice,
} from "../../audio/output-devices.ts";
import { useSettings } from "../settings-context.ts";

type NumericField = "charWpm" | "effectiveWpm" | "toneHz";

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
  const [devices, setDevices] = useState<OutputDevice[]>([]);
  const [access, setAccess] = useState<"idle" | "denied" | "ready">("idle");
  const outputSupport = getOutputSupport();

  async function enableOutputSelection(): Promise<void> {
    const granted = await requestOutputAccess();
    if (!granted) {
      setAccess("denied");
      return;
    }
    setDevices(await listOutputDevices());
    setAccess("ready");
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

      <p className="settings__note">
        Effective speed is capped at the character speed (Farnsworth spacing).
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
    </section>
  );
}
