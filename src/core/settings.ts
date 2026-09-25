// Pure practice settings model: named ranges, defaults, and clamping.
// Framework- and DOM-free; adapters and UI read these values to configure
// audio and timing.

export type PacingMode = "auto" | "manual";
export type ContinuousCopyDurationMs = 60000 | 180000 | 300000 | 600000;
export type SpeedSuggestionAfterAttempts = 3 | 4 | 5 | "off";

export const CONTINUOUS_COPY_DURATIONS = [
  60000, 180000, 300000, 600000,
] as const satisfies readonly ContinuousCopyDurationMs[];
export const SPEED_SUGGESTION_THRESHOLDS = [
  3,
  4,
  5,
  "off",
] as const satisfies readonly SpeedSuggestionAfterAttempts[];

export type PracticeSettings = {
  /** Character speed in WPM; sets element and intra-character timing. */
  charWpm: number;
  /** Effective (Farnsworth) speed in WPM; clamped to <= charWpm. */
  effectiveWpm: number;
  /** Sidetone frequency in Hz. */
  toneHz: number;
  /** Output volume in [0, 1]. */
  volume: number;
  /** Band-noise level in [0, 1]; 0 disables noise. */
  noiseLevel: number;
  /** Learn-mode flow: auto-advance, or wait for Enter between cards. */
  pacing: PacingMode;
  /** Requested duration of the continuous-copy portion of a Learn lesson. */
  continuousCopyDurationMs: ContinuousCopyDurationMs;
  /** Consecutive qualifying misses before suggesting more spacing. */
  speedSuggestionAfterAttempts: SpeedSuggestionAfterAttempts;
};

export type SettingRange = {
  min: number;
  max: number;
  default: number;
};

/** Inclusive ranges and defaults for each numeric setting. Tunable config. */
export const SETTING_RANGES = {
  charWpm: { min: 5, max: 40, default: 20 },
  effectiveWpm: { min: 5, max: 40, default: 12 },
  toneHz: { min: 300, max: 1000, default: 600 },
  volume: { min: 0, max: 1, default: 0.7 },
  noiseLevel: { min: 0, max: 1, default: 0 },
} as const satisfies Record<
  "charWpm" | "effectiveWpm" | "toneHz" | "volume" | "noiseLevel",
  SettingRange
>;

export const DEFAULT_SETTINGS: PracticeSettings = {
  charWpm: SETTING_RANGES.charWpm.default,
  effectiveWpm: SETTING_RANGES.effectiveWpm.default,
  toneHz: SETTING_RANGES.toneHz.default,
  volume: SETTING_RANGES.volume.default,
  noiseLevel: SETTING_RANGES.noiseLevel.default,
  pacing: "auto",
  continuousCopyDurationMs: 60000,
  speedSuggestionAfterAttempts: 3,
};

function clamp(value: number, range: SettingRange): number {
  if (Number.isNaN(value)) {
    return range.default;
  }
  return Math.min(range.max, Math.max(range.min, value));
}

/**
 * Clamps each field to its range and enforces effectiveWpm <= charWpm so
 * Farnsworth timing stays valid.
 */
export function normalizeSettings(
  settings: Partial<PracticeSettings>,
): PracticeSettings {
  const charWpm = clamp(
    settings.charWpm ?? DEFAULT_SETTINGS.charWpm,
    SETTING_RANGES.charWpm,
  );
  const effectiveWpm = Math.min(
    charWpm,
    clamp(
      settings.effectiveWpm ?? DEFAULT_SETTINGS.effectiveWpm,
      SETTING_RANGES.effectiveWpm,
    ),
  );
  return {
    charWpm,
    effectiveWpm,
    toneHz: clamp(
      settings.toneHz ?? DEFAULT_SETTINGS.toneHz,
      SETTING_RANGES.toneHz,
    ),
    volume: clamp(
      settings.volume ?? DEFAULT_SETTINGS.volume,
      SETTING_RANGES.volume,
    ),
    noiseLevel: clamp(
      settings.noiseLevel ?? DEFAULT_SETTINGS.noiseLevel,
      SETTING_RANGES.noiseLevel,
    ),
    pacing: settings.pacing === "manual" ? "manual" : "auto",
    continuousCopyDurationMs: CONTINUOUS_COPY_DURATIONS.includes(
      settings.continuousCopyDurationMs as ContinuousCopyDurationMs,
    )
      ? (settings.continuousCopyDurationMs as ContinuousCopyDurationMs)
      : DEFAULT_SETTINGS.continuousCopyDurationMs,
    speedSuggestionAfterAttempts: SPEED_SUGGESTION_THRESHOLDS.includes(
      settings.speedSuggestionAfterAttempts as SpeedSuggestionAfterAttempts,
    )
      ? (settings.speedSuggestionAfterAttempts as SpeedSuggestionAfterAttempts)
      : DEFAULT_SETTINGS.speedSuggestionAfterAttempts,
  };
}

export function recommendedContinuousCopyDurationMs(
  activeCharacters: number,
): ContinuousCopyDurationMs {
  if (activeCharacters <= 4) return 60000;
  if (activeCharacters <= 10) return 180000;
  return 300000;
}
