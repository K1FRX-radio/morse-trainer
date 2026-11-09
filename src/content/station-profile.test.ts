import { describe, expect, it } from "vitest";
import { createRng } from "../core/rng.ts";
import {
  buildLearnerStationContent,
  normalizeLearnerStationProfile,
  resolveLearnerStationProfile,
  validateCallsign,
} from "./station-profile.ts";

describe("normalizeLearnerStationProfile", () => {
  it("normalizes callsign/name/qth to uppercase with compact spacing", () => {
    const profile = normalizeLearnerStationProfile({
      callsign: "  k1abc ",
      name: "  Chris  ",
      qth: " New   York ",
      rig: " ic7300 ",
      power: " 50w ",
    });

    expect(profile).toEqual({
      callsign: "K1ABC",
      name: "CHRIS",
      qth: "NEW YORK",
      rig: "IC7300",
      power: "50W",
    });
  });

  it("removes empty optional fields", () => {
    const profile = normalizeLearnerStationProfile({
      callsign: "",
      name: "",
      qth: "",
      rig: "",
      power: "",
    });

    expect(profile).toEqual({});
  });

  it("rejects invalid callsign formats", () => {
    expect(() =>
      normalizeLearnerStationProfile({ callsign: "INVALID@@" }),
    ).toThrow(/Callsign must use a plausible amateur-radio format/i);
  });
});

describe("validateCallsign", () => {
  it("accepts common plausible forms", () => {
    expect(validateCallsign("K1ABC")).toBeUndefined();
    expect(validateCallsign("EA8/K1ABC")).toBeUndefined();
    expect(validateCallsign("K1ABC/P")).toBeUndefined();
  });

  it("returns a validation message for malformed callsigns", () => {
    expect(validateCallsign("12")).toMatch(/plausible amateur-radio format/i);
  });
});

describe("resolveLearnerStationProfile", () => {
  it("uses deterministic generic fallbacks when fields are missing", () => {
    const a = resolveLearnerStationProfile(undefined, createRng(8));
    const b = resolveLearnerStationProfile(undefined, createRng(8));
    expect(a).toEqual(b);
    expect(a.usesFallback).toBe(true);
    expect(a.fallbackFields).toEqual(
      expect.arrayContaining(["callsign", "name", "qth"]),
    );
  });

  it("preserves learner-provided core fields while allowing optional fallbacks", () => {
    const profile = resolveLearnerStationProfile(
      {
        callsign: "K1ABC",
        name: "ALEX",
        qth: "BOSTON",
      },
      createRng(2),
    );

    expect(profile.callsign).toBe("K1ABC");
    expect(profile.name).toBe("ALEX");
    expect(profile.qth).toBe("BOSTON");
    expect(profile.usesFallback).toBe(true);
  });
});

describe("buildLearnerStationContent", () => {
  it("builds deterministic station content for the same seed", () => {
    const profile = {
      callsign: "K1ABC",
      name: "ALEX",
      qth: "BOSTON",
    };
    const a = buildLearnerStationContent(profile, createRng(10));
    const b = buildLearnerStationContent(profile, createRng(10));
    expect(a).toEqual(b);
  });

  it("supports empty profiles with explicit fallback markers", () => {
    const result = buildLearnerStationContent(undefined, createRng(11));
    expect(result.learner.usesFallback).toBe(true);
    expect(result.learner.fallbackFields.length).toBeGreaterThan(0);
    expect(result.counterpartCallsign).toMatch(/^[A-Z]{1,2}[0-9][A-Z]{1,3}$/);
  });
});
