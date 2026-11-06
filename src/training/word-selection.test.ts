import { describe, expect, it } from "vitest";
import {
  evaluateOnAirVocabularyEligibility,
  evaluateWordEligibility,
} from "./word-selection.ts";

describe("evaluateOnAirVocabularyEligibility", () => {
  it("filters candidates by stage and length", () => {
    const active = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789".split("");
    const result = evaluateOnAirVocabularyEligibility({
      active,
      stage: "contact-setup",
      minimumLength: 2,
      maximumLength: 3,
      minimumPoolSize: 3,
    });

    expect(result.eligible).toBe(true);
    expect(result.candidates.length).toBeGreaterThanOrEqual(3);
    for (const word of result.candidates) {
      expect(word.stages).toContain("contact-setup");
      expect(word.text.length).toBeGreaterThanOrEqual(2);
      expect(word.text.length).toBeLessThanOrEqual(3);
    }
  });

  it("respects unlocked-character constraints", () => {
    const active = ["R", "S", "T", "5", "9"];
    const result = evaluateOnAirVocabularyEligibility({
      active,
      stage: "signal-report",
      minimumLength: 3,
      maximumLength: 3,
      minimumPoolSize: 1,
    });

    expect(result.eligible).toBe(true);
    expect(result.candidates.map((word) => word.text)).toEqual([
      "RST",
      "599",
      "559",
    ]);
  });

  it("reports ineligible when stage pool is below threshold", () => {
    const active = ["C", "Q", "D", "E"];
    const result = evaluateOnAirVocabularyEligibility({
      active,
      stage: "contact-setup",
      minimumLength: 2,
      maximumLength: 3,
      minimumPoolSize: 3,
    });

    expect(result.eligible).toBe(false);
    expect(result.candidates.map((word) => word.text)).toEqual(["CQ", "DE"]);
  });
});

describe("evaluateWordEligibility regression", () => {
  it("retains general focused-word eligibility behavior", () => {
    const active = ["K", "M", "U", "R", "E", "S", "N", "A"];
    const result = evaluateWordEligibility({
      active,
      minimumLength: 2,
      maximumLength: 4,
      minimumPoolSize: 10,
    });

    expect(result.eligible).toBe(true);
    expect(result.candidates.length).toBeGreaterThanOrEqual(10);
  });
});
