import { describe, expect, it } from "vitest";
import { createRng } from "../core/rng.ts";
import {
  CALLSIGN_CURATED_EXAMPLES,
  CALLSIGN_STAGES,
  eligibleCallsigns,
  generateCallsignForStage,
  isPlausibleCallsignForStage,
  selectCallsign,
} from "./callsigns.ts";

describe("CALLSIGN_CURATED_EXAMPLES", () => {
  it("provides curated entries for each stage", () => {
    const byStage = new Map(
      CALLSIGN_STAGES.map((stage) => [
        stage,
        CALLSIGN_CURATED_EXAMPLES.filter((entry) =>
          entry.stages.includes(stage),
        ),
      ]),
    );
    for (const stage of CALLSIGN_STAGES) {
      expect(byStage.get(stage)?.length ?? 0).toBeGreaterThan(0);
    }
  });

  it("contains only uppercase A-Z, digits, and slash", () => {
    for (const entry of CALLSIGN_CURATED_EXAMPLES) {
      expect(entry.text).toMatch(/^[A-Z0-9/]+$/);
    }
  });
});

describe("generateCallsignForStage", () => {
  it("is deterministic for a given seed and stage", () => {
    const a = generateCallsignForStage("portable-identifiers", createRng(42));
    const b = generateCallsignForStage("portable-identifiers", createRng(42));
    expect(a).toBe(b);
  });

  it("generates stage-plausible callsigns", () => {
    for (const stage of CALLSIGN_STAGES) {
      const rng = createRng(100 + CALLSIGN_STAGES.indexOf(stage));
      for (let i = 0; i < 30; i++) {
        const text = generateCallsignForStage(stage, rng);
        expect(isPlausibleCallsignForStage(text, stage)).toBe(true);
      }
    }
  });
});

describe("eligibleCallsigns", () => {
  it("filters by stage", () => {
    const unlocked = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789/".split("");
    const entries = eligibleCallsigns(unlocked, "special-event");
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      expect(entry.stages).toContain("special-event");
    }
  });

  it("respects unlocked-character eligibility", () => {
    const unlocked = ["K", "1", "A", "B", "C"];
    const entries = eligibleCallsigns(unlocked, "basic-domestic");
    expect(entries.map((entry) => entry.text)).toEqual(["K1ABC"]);
  });
});

describe("selectCallsign", () => {
  it("returns deterministic callsigns for a seed", () => {
    const unlocked = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789/".split("");
    const a = selectCallsign(unlocked, createRng(7), "international");
    const b = selectCallsign(unlocked, createRng(7), "international");
    expect(a).toEqual(b);
  });

  it("returns undefined when neither curated nor generated callsigns are eligible", () => {
    const unlocked = ["K", "M", "U"];
    expect(
      selectCallsign(unlocked, createRng(2), "basic-domestic"),
    ).toBeUndefined();
  });

  it("can return generated callsigns when curated examples are ineligible", () => {
    const unlocked = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789/".split("");
    const value = selectCallsign(
      unlocked,
      createRng(1),
      "portable-identifiers",
    );
    expect(value).toBeDefined();
    expect(
      isPlausibleCallsignForStage(value!.text, "portable-identifiers"),
    ).toBe(true);
  });
});
