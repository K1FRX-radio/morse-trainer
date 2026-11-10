import { buildLearnerStationContent } from "../content/station-profile.ts";
import type { Rng } from "../core/rng.ts";

export type QsoFieldId = "callsign" | "rst" | "name" | "qth" | "wx";

export type StructuredFieldExpectation = {
  field: QsoFieldId;
  expected: string;
  required: boolean;
};

export type StructuredFieldResult = StructuredFieldExpectation & {
  captured: boolean;
};

export type StructuredFieldCapture = {
  templateId: string;
  requiredFieldCount: number;
  capturedRequiredFieldCount: number;
  requiredScore: number;
  exactCopyMatched: boolean;
  results: StructuredFieldResult[];
};

export type StructuredQsoDrill = {
  templateId: string;
  label: string;
  prompt: string;
  expectations: StructuredFieldExpectation[];
};

const RST_CHOICES = ["559", "579", "599"] as const;
const WX_CHOICES = ["SUNNY", "CLOUDY", "RAIN", "WINDY"] as const;

function normalizeCopyForExact(value: string): string {
  return value.toUpperCase().replace(/\s+/g, "").trim();
}

function pick<T>(options: readonly T[], rng: Rng): T {
  return options[Math.floor(rng() * options.length)];
}

export function buildStructuredQsoDrills(options: {
  profile: {
    callsign?: string;
    name?: string;
    qth?: string;
  };
  rng: Rng;
}): StructuredQsoDrill[] {
  const station = buildLearnerStationContent(options.profile, options.rng);
  const rst = pick(RST_CHOICES, options.rng);
  const wx = pick(WX_CHOICES, options.rng);

  return [
    {
      templateId: "op3-callsign-rst",
      label: "Callsign + report",
      prompt: `DE ${station.counterpartCallsign} UR RST ${rst}`,
      expectations: [
        {
          field: "callsign",
          expected: station.counterpartCallsign,
          required: true,
        },
        { field: "rst", expected: rst, required: true },
      ],
    },
    {
      templateId: "op3-name-qth",
      label: "Name + QTH",
      prompt: `NAME ${station.learner.name} QTH ${station.learner.qth}`,
      expectations: [
        { field: "name", expected: station.learner.name, required: true },
        { field: "qth", expected: station.learner.qth, required: true },
      ],
    },
    {
      templateId: "op3-structured-exchange",
      label: "Structured exchange",
      prompt: `DE ${station.counterpartCallsign} RST ${rst} NAME ${station.learner.name} QTH ${station.learner.qth} WX ${wx}`,
      expectations: [
        {
          field: "callsign",
          expected: station.counterpartCallsign,
          required: true,
        },
        { field: "rst", expected: rst, required: true },
        { field: "name", expected: station.learner.name, required: true },
        { field: "qth", expected: station.learner.qth, required: true },
        { field: "wx", expected: wx, required: false },
      ],
    },
  ];
}

export function gradeStructuredQsoDrill(
  drill: StructuredQsoDrill,
  response: string,
): StructuredFieldCapture {
  const escapePattern = (value: string) =>
    value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const values = drill.expectations.map((expectation) =>
    escapePattern(normalizeCopyForExact(expectation.expected)),
  );
  const labels = "DE|UR|RST|NAME|QTH|WX";
  const adjacentValues = `(?:${values.join("|")})*`;
  const compactResponse = normalizeCopyForExact(response);
  const results = drill.expectations.map((expectation, index) => {
    // A value can follow a label or other complete values, including in a
    // reordered, label-free response. Require the rest of its value sequence
    // to end at a label or the response end to reject extended values.
    const captured = new RegExp(
      `(?:^|${labels})${adjacentValues}${values[index]}(?=${adjacentValues}(?:${labels}|$))`,
    ).test(compactResponse);
    return { ...expectation, captured };
  });

  const requiredFieldCount = results.filter((result) => result.required).length;
  const capturedRequiredFieldCount = results.filter(
    (result) => result.required && result.captured,
  ).length;

  return {
    templateId: drill.templateId,
    requiredFieldCount,
    capturedRequiredFieldCount,
    requiredScore:
      requiredFieldCount === 0
        ? 1
        : capturedRequiredFieldCount / requiredFieldCount,
    exactCopyMatched:
      normalizeCopyForExact(drill.prompt) === normalizeCopyForExact(response),
    results,
  };
}
