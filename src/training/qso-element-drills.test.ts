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
  it("scores required fields independently from exact full-copy matches", () => {
    const [callsignReport] = buildStructuredQsoDrills({
      profile: {
        callsign: "K1FRX",
        name: "ALEX",
        qth: "BOSTON",
      },
      rng: createRng(1),
    });

    const exact = gradeStructuredQsoDrill(
      callsignReport,
      callsignReport.prompt,
    );
    expect(exact.requiredScore).toBe(1);
    expect(exact.exactCopyMatched).toBe(true);

    const fieldOnly = gradeStructuredQsoDrill(
      callsignReport,
      `${callsignReport.expectations[1].expected} DE ${callsignReport.expectations[0].expected}`,
    );
    expect(fieldOnly.requiredScore).toBe(1);
    expect(fieldOnly.exactCopyMatched).toBe(false);
  });

  it("counts missing required fields as uncaptured", () => {
    const [, nameQth] = buildStructuredQsoDrills({
      profile: {
        callsign: "K1FRX",
        name: "ALEX",
        qth: "BOSTON",
      },
      rng: createRng(5),
    });

    const graded = gradeStructuredQsoDrill(nameQth, "NAME ALEX");
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
        expected: "BOSTON",
        required: true,
        captured: false,
      },
    ]);
  });
});

describe("complete structured field values", () => {
  const drill = {
    templateId: "regression",
    label: "Exchange",
    prompt: "DE K1ABC RST 579 NAME ALEX QTH NEW YORK",
    expectations: [
      { field: "callsign", expected: "K1ABC", required: true },
      { field: "rst", expected: "579", required: true },
      { field: "name", expected: "ALEX", required: true },
      { field: "qth", expected: "NEW YORK", required: true },
    ],
  } as const;

  it.each(["K1ABCD 1579", "DEK1ABCDRST1579NAMEALEXQTHNEWYORK"])(
    "rejects extended callsigns and incorrect reports: %s",
    (response) => {
      const result = gradeStructuredQsoDrill(
        { ...drill, expectations: [...drill.expectations] },
        response,
      );
      expect(
        result.results.slice(0, 2).map(({ captured }) => captured),
      ).toEqual([false, false]);
    },
  );

  it.each(["dek1abcrst579namealexqthnewyork", "K1ABC 579 ALEX NEWYORK"])(
    "captures complete multiword values without spaces: %s",
    (response) => {
      expect(
        gradeStructuredQsoDrill(
          { ...drill, expectations: [...drill.expectations] },
          response,
        ).requiredScore,
      ).toBe(1);
    },
  );
});
