import { describe, expect, it } from "vitest";
import { createRng } from "../core/rng.ts";
import {
  ON_AIR_VOCABULARY_STAGES,
  WORD_CORPUS,
  eligibleOnAirVocabulary,
  eligibleWords,
  selectEligibleWord,
  selectOnAirVocabularyWord,
} from "./words.ts";

describe("eligibleWords", () => {
  it("returns only words made of unlocked characters", () => {
    const unlocked = ["A", "N", "E", "T"];
    const words = eligibleWords(unlocked);
    expect(words.length).toBeGreaterThan(0);
    for (const word of words) {
      for (const char of word.text) {
        expect(unlocked).toContain(char);
      }
    }
  });

  it("returns nothing when the unlocked set is too small", () => {
    expect(eligibleWords(["K"])).toEqual([]);
  });

  it("can require the newest character", () => {
    const unlocked = ["A", "N", "E", "T", "M"];
    const words = eligibleWords(unlocked, { requireNewest: true, newest: "M" });
    expect(words.length).toBeGreaterThan(0);
    for (const word of words) {
      expect(word.text).toContain("M");
    }
  });

  it("filters by tag", () => {
    const unlocked = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
    const words = eligibleWords(unlocked, { tags: ["qso"] });
    expect(words.length).toBeGreaterThan(0);
    for (const word of words) {
      expect(word.tags).toContain("qso");
    }
  });

  it("filters by staged on-air track", () => {
    const unlocked = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789".split("");
    const words = eligibleWords(unlocked, { stage: "contact-setup" });
    expect(words.length).toBeGreaterThan(0);
    for (const word of words) {
      expect(word.stages).toContain("contact-setup");
    }
  });
});

describe("eligibleOnAirVocabulary", () => {
  it("returns only terms for the requested stage", () => {
    const unlocked = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789".split("");
    const words = eligibleOnAirVocabulary(unlocked, "signal-report");
    expect(words.length).toBeGreaterThan(0);
    for (const word of words) {
      expect(word.stages).toContain("signal-report");
    }
  });

  it("respects unlocked-character filtering", () => {
    const unlocked = ["R", "S", "T", "5", "9"];
    const words = eligibleOnAirVocabulary(unlocked, "signal-report");
    expect(words.map((word) => word.text)).toEqual(["RST", "599", "559"]);
  });

  it("excludes joined prosigns by default", () => {
    const unlocked = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789".split("");
    const words = eligibleOnAirVocabulary(unlocked, "courtesy-flow");
    expect(words.some((word) => word.joinedProsign)).toBe(false);
  });

  it("can include joined prosigns when explicitly requested", () => {
    const unlocked = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789".split("");
    const words = eligibleWords(unlocked, {
      stage: "wrap-up",
      includeJoinedProsigns: true,
    });
    const joined = words.filter((word) => word.joinedProsign);
    expect(joined.map((word) => word.text)).toEqual(
      expect.arrayContaining(["AR", "SK"]),
    );
  });
});

describe("selectEligibleWord", () => {
  it("is deterministic for a seed", () => {
    const unlocked = ["A", "N", "E", "T", "R", "S"];
    const a = selectEligibleWord(unlocked, createRng(5));
    const b = selectEligibleWord(unlocked, createRng(5));
    expect(a).toEqual(b);
  });

  it("returns undefined when no word qualifies", () => {
    expect(selectEligibleWord(["K"], createRng(1))).toBeUndefined();
  });

  it("only draws words containing the newest when required", () => {
    const unlocked = ["A", "N", "E", "T", "M"];
    const rng = createRng(2);
    for (let i = 0; i < 30; i++) {
      const word = selectEligibleWord(unlocked, rng, {
        requireNewest: true,
        newest: "M",
      });
      if (word) {
        expect(word.text).toContain("M");
      }
    }
  });

  it("every corpus word is uppercase A-Z", () => {
    for (const word of WORD_CORPUS) {
      expect(word.text).toMatch(/^[A-Z0-9]+$/);
    }
  });

  it("supports deterministic staged on-air selection", () => {
    const unlocked = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789".split("");
    const a = selectOnAirVocabularyWord(
      unlocked,
      createRng(42),
      "courtesy-flow",
    );
    const b = selectOnAirVocabularyWord(
      unlocked,
      createRng(42),
      "courtesy-flow",
    );
    expect(a).toEqual(b);
  });

  it("returns undefined for staged selection when nothing qualifies", () => {
    expect(
      selectOnAirVocabularyWord(["K", "M"], createRng(1), "contact-setup"),
    ).toBeUndefined();
  });
});

describe("on-air vocabulary stage coverage", () => {
  const ALL = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789".split("");

  it("defines all expected stage names", () => {
    expect(ON_AIR_VOCABULARY_STAGES).toEqual([
      "contact-setup",
      "signal-report",
      "courtesy-flow",
      "wrap-up",
    ]);
  });

  it("includes required first-contact terms across stages", () => {
    const byStage = new Map(
      ON_AIR_VOCABULARY_STAGES.map((stage) => [
        stage,
        eligibleOnAirVocabulary(ALL, stage).map((word) => word.text),
      ]),
    );
    const contactSetup = byStage.get("contact-setup") ?? [];
    expect(contactSetup).toEqual(expect.arrayContaining(["CQ", "DE", "QRZ"]));
    const signalReport = byStage.get("signal-report") ?? [];
    expect(signalReport).toEqual(
      expect.arrayContaining(["RST", "599", "QRM", "QRN", "QSB"]),
    );
    const courtesy = byStage.get("courtesy-flow") ?? [];
    expect(courtesy).toEqual(
      expect.arrayContaining(["PSE", "AGN", "TNX", "BK", "KN"]),
    );
    const wrapUp = byStage.get("wrap-up") ?? [];
    expect(wrapUp).toEqual(expect.arrayContaining(["73", "88", "SK", "QRT"]));
  });
});
