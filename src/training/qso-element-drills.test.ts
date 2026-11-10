import { describe, expect, it } from "vitest";
import { createRng } from "../core/rng.ts";
import {
  buildStructuredQsoDrills,
  gradeStructuredQsoDrill,
} from "./qso-element-drills.ts";

describe("buildStructuredQsoDrills", () => {
  it("builds deterministic OP-3 drill templates for the same seed", () => {
    const first = buildStructuredQsoDrills({
      profile: {
        callsign: "K1FRX",
        name: "ALEX",
        qth: "BOSTON",
      },
      rng: createRng(7),
    });
    const second = buildStructuredQsoDrills({
      profile: {
        callsign: "K1FRX",
        name: "ALEX",
        qth: "BOSTON",
      },
      rng: createRng(7),
    });

    expect(first).toEqual(second);
    expect(first.map((drill) => drill.templateId)).toEqual([
      "op3-callsign-rst",
      "op3-name-qth",
      "op3-structured-exchange",
    ]);
  });
});

describe("gradeStructuredQsoDrill", () => {
  it("grades explicit field answers while preserving exact-copy from full transcription", () => {
    const [callsignReport] = buildStructuredQsoDrills({
      profile: {
        callsign: "K1FRX",
        name: "ALEX",
        qth: "BOSTON",
      },
      rng: createRng(1),
    });

    const rstExpected =
      callsignReport.expectations.find((item) => item.field === "rst")
        ?.expected ?? "";
    const callsignExpected =
      callsignReport.expectations.find((item) => item.field === "callsign")
        ?.expected ?? "";

    const fieldOnly = gradeStructuredQsoDrill(callsignReport, "noise", {
      callsign: callsignExpected,
      rst: rstExpected,
    });
    expect(fieldOnly.requiredScore).toBe(1);
    expect(fieldOnly.exactCopyMatched).toBe(false);

    const exactOnly = gradeStructuredQsoDrill(callsignReport, callsignReport.prompt, {
      callsign: "WRONG",
      rst: "000",
    });
    expect(exactOnly.exactCopyMatched).toBe(true);
    expect(exactOnly.requiredScore).toBe(0);
  });

  it("captures and misses individual fields correctly", () => {
    const [, nameQth] = buildStructuredQsoDrills({
      profile: {
        callsign: "K1FRX",
        name: "ALEX",
        qth: "NEW YORK",
      },
      rng: createRng(5),
    });

    const graded = gradeStructuredQsoDrill(nameQth, "", {
      name: "ALEX",
      qth: "DENVER",
    });

    expect(graded.requiredFieldCount).toBe(2);
    expect(graded.capturedRequiredFieldCount).toBe(1);
    expect(graded.requiredScore).toBe(0.5);
    expect(graded.results).toEqual([
      {
        field: "name",
        expected: "ALEX",
        required: true,
        captured: true,
      },
      {
        field: "qth",
        expected: "NEW YORK",
        required: true,
        captured: false,
      },
    ]);
  });

  it("rejects callsign and report extensions", () => {
    const [callsignReport] = buildStructuredQsoDrills({
      profile: {
        callsign: "K1ABC",
        name: "ALEX",
        qth: "BOSTON",
      },
      rng: createRng(3),
    });

    const rstExpected =
      callsignReport.expectations.find((item) => item.field === "rst")
        ?.expected ?? "";

    const graded = gradeStructuredQsoDrill(callsignReport, "", {
      callsign: "K1ABCX",
      rst: `${rstExpected}9`,
    });

    expect(graded.results.map(({ captured }) => captured)).toEqual([
      false,
      false,
    ]);
  });

  it("normalizes case and whitespace within fields, including multiword QTH", () => {
    const [, nameQth] = buildStructuredQsoDrills({
      profile: {
        callsign: "K1FRX",
        name: "Alex",
        qth: "New York",
      },
      rng: createRng(4),
    });

    const graded = gradeStructuredQsoDrill(nameQth, "", {
      name: "  alex  ",
      qth: " new   york ",
    });

    expect(graded.requiredScore).toBe(1);
    expect(graded.results.every((result) => result.captured)).toBe(true);
  });

  it("does not penalize missing optional fields", () => {
    const [, , exchange] = buildStructuredQsoDrills({
      profile: {
        callsign: "K1FRX",
        name: "ALEX",
        qth: "BOSTON",
      },
      rng: createRng(9),
    });

    const callsignExpected =
      exchange.expectations.find((item) => item.field === "callsign")
        ?.expected ?? "";
    const rstExpected =
      exchange.expectations.find((item) => item.field === "rst")?.expected ??
      "";

    const graded = gradeStructuredQsoDrill(exchange, "", {
      callsign: callsignExpected,
      rst: rstExpected,
      name: "ALEX",
      qth: "BOSTON",
    });

    const optionalWx = graded.results.find((result) => result.field === "wx");
    expect(optionalWx?.captured).toBe(false);
    expect(graded.requiredScore).toBe(1);
    expect(graded.capturedRequiredFieldCount).toBe(4);
  });

  it("counts missing required fields as uncaptured", () => {
    const [, nameQth] = buildStructuredQsoDrills({
      profile: {
        callsign: "K1FRX",
        name: "ALEX",
        qth: "BOSTON",
      },
      rng: createRng(10),
    });

    const graded = gradeStructuredQsoDrill(nameQth, "", { name: "ALEX" });
    expect(graded.requiredFieldCount).toBe(2);
    expect(graded.capturedRequiredFieldCount).toBe(1);
    expect(graded.requiredScore).toBe(0.5);
  });
});
