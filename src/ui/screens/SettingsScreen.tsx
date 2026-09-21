import { SETTING_RANGES, type PracticeSettings } from "../../core/settings.ts";
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
  const { settings, update } = useSettings();

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
    </section>
  );
}
