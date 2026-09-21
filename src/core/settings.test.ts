import { describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS,
  SETTING_RANGES,
  normalizeSettings,
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

  it("allows effectiveWpm below charWpm unchanged", () => {
    const result = normalizeSettings({ charWpm: 20, effectiveWpm: 10 });
    expect(result.effectiveWpm).toBe(10);
  });

  it("falls back to defaults for NaN", () => {
    const result = normalizeSettings({ charWpm: Number.NaN });
    expect(result.charWpm).toBe(DEFAULT_SETTINGS.charWpm);
  });
});
