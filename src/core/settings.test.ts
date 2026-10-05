import { describe, expect, it } from "vitest";
import {
  CHARACTER_WPM_BANDS,
  DEFAULT_SETTINGS,
  EFFECTIVE_WPM_BANDS,
  SETTING_RANGES,
  normalizeCharacterWpmBand,
  normalizeEffectiveWpmBand,
  normalizeSettings,
  recommendedContinuousCopyDurationMs,
} from "./settings.ts";

describe("normalizeSettings", () => {
  it("returns defaults for an empty input", () => {
    expect(normalizeSettings({})).toEqual(DEFAULT_SETTINGS);
  });

  it("clamps each field to its range", () => {
    const result = normalizeSettings({
      charWpm: 999,
      toneHz: 10,
      volume: 5,
      noiseLevel: -1,
    });
    expect(result.charWpm).toBe(SETTING_RANGES.charWpm.max);
    expect(result.toneHz).toBe(SETTING_RANGES.toneHz.min);
    expect(result.volume).toBe(SETTING_RANGES.volume.max);
    expect(result.noiseLevel).toBe(SETTING_RANGES.noiseLevel.min);
  });

  it("keeps effectiveWpm at or below charWpm", () => {
    const result = normalizeSettings({ charWpm: 15, effectiveWpm: 30 });
    expect(result.effectiveWpm).toBe(15);
  });

  it("snaps speeds to canonical discrete ladders", () => {
    const result = normalizeSettings({ charWpm: 24, effectiveWpm: 11.1 });
    expect(result.charWpm).toBe(25);
    expect(result.effectiveWpm).toBe(12);
  });

  it("allows effectiveWpm below charWpm unchanged", () => {
    const result = normalizeSettings({ charWpm: 20, effectiveWpm: 10 });
    expect(result.effectiveWpm).toBe(10);
  });

  it("falls back to defaults for NaN", () => {
    const result = normalizeSettings({ charWpm: Number.NaN });
    expect(result.charWpm).toBe(DEFAULT_SETTINGS.charWpm);
  });

  it("defaults old stored settings to one minute of continuous copy", () => {
    expect(normalizeSettings({ charWpm: 18 }).continuousCopyDurationMs).toBe(
      60000,
    );
  });

  it("accepts only named continuous-copy durations", () => {
    expect(
      normalizeSettings({ continuousCopyDurationMs: 300000 })
        .continuousCopyDurationMs,
    ).toBe(300000);
    expect(
      normalizeSettings({ continuousCopyDurationMs: 90000 as 60000 })
        .continuousCopyDurationMs,
    ).toBe(60000);
  });

  it("defaults old settings to three attempts before a speed suggestion", () => {
    expect(normalizeSettings({}).speedSuggestionAfterAttempts).toBe(3);
  });

  it.each([3, 4, 5, "off"] as const)(
    "accepts %s as the speed-suggestion threshold",
    (speedSuggestionAfterAttempts) => {
      expect(
        normalizeSettings({ speedSuggestionAfterAttempts })
          .speedSuggestionAfterAttempts,
      ).toBe(speedSuggestionAfterAttempts);
    },
  );

  it("rejects unsupported speed-suggestion thresholds", () => {
    expect(
      normalizeSettings({ speedSuggestionAfterAttempts: 2 as 3 })
        .speedSuggestionAfterAttempts,
    ).toBe(3);
  });
});

describe("speed-band normalization", () => {
  it("exposes canonical character and effective speed ladders", () => {
    expect(CHARACTER_WPM_BANDS).toEqual([10, 15, 20, 25, 30, 35, 40]);
    expect(EFFECTIVE_WPM_BANDS).toEqual([
      5, 8, 10, 12, 15, 18, 20, 25, 30, 35, 40,
    ]);
  });

  it("maps character speeds to nearest band with lower tie break", () => {
    expect(normalizeCharacterWpmBand(19)).toBe(20);
    expect(normalizeCharacterWpmBand(22.5)).toBe(20);
    expect(normalizeCharacterWpmBand(37.5)).toBe(35);
  });

  it("maps effective speed then clamps to character band", () => {
    expect(normalizeEffectiveWpmBand(11.9, 20)).toBe(12);
    expect(normalizeEffectiveWpmBand(29, 20)).toBe(20);
  });
});

describe("recommendedContinuousCopyDurationMs", () => {
  it.each([
    [2, 60000],
    [4, 60000],
    [5, 180000],
    [10, 180000],
    [11, 300000],
    [21, 300000],
  ])("recommends by active-set size (%i)", (active, expected) => {
    expect(recommendedContinuousCopyDurationMs(active)).toBe(expected);
  });
});
