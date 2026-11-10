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

const FIELD_LABELS: Record<QsoFieldId, string> = {
  callsign: "DE",
  rst: "RST",
  name: "NAME",
  qth: "QTH",
  wx: "WX",
};

const OPTIONAL_CONNECTOR_TOKEN = "UR";

function normalizeCopyForExact(value: string): string {
  return value.toUpperCase().replace(/\s+/g, "").trim();
}

function pick<T>(options: readonly T[], rng: Rng): T {
  return options[Math.floor(rng() * options.length)];
}

type FieldToken = {
  field: QsoFieldId;
  value: string;
  token: string;
  labeled: boolean;
};

function buildFieldTokens(
  expectations: readonly StructuredFieldExpectation[],
): FieldToken[] {
  const seen = new Set<string>();
  const tokens: FieldToken[] = [];

  for (const expectation of expectations) {
    const value = normalizeCopyForExact(expectation.expected);
    for (const candidate of [
      { token: value, labeled: false },
      { token: `${FIELD_LABELS[expectation.field]}${value}`, labeled: true },
    ] as const) {
      const key = `${expectation.field}:${candidate.token}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      tokens.push({
        field: expectation.field,
        value,
        token: candidate.token,
        labeled: candidate.labeled,
      });
    }
  }

  return tokens;
}

function endsWithAnyTokenAt(
  response: string,
  index: number,
  tokens: readonly string[],
): boolean {
  return tokens.some(
    (token) =>
      token.length > 0 &&
      index >= token.length &&
      response.startsWith(token, index - token.length),
  );
}

function startsWithAnyTokenAt(
  response: string,
  index: number,
  tokens: readonly string[],
): boolean {
  return tokens.some(
    (token) => token.length > 0 && response.startsWith(token, index),
  );
}

// A label is a boundary only when it introduces a value. In compact copy,
// adjacent labels (for example ALEXDEQTHBOSTON) cannot delimit a complete
// value: the first label is an extension, not a field with content.
function startsWithFieldAt(
  response: string,
  index: number,
  fieldTokens: readonly FieldToken[],
): boolean {
  const labels = Object.values(FIELD_LABELS);
  return labels.some((label) => {
    if (!response.startsWith(label, index)) {
      return false;
    }
    const valueStart = index + label.length;
    const expectedValue = fieldTokens.some(
      (token) => token.labeled && response.startsWith(token.token, index),
    );
    return (
      expectedValue ||
      (valueStart < response.length &&
        !startsWithAnyTokenAt(response, valueStart, [
          ...labels,
          OPTIONAL_CONNECTOR_TOKEN,
        ]))
    );
  });
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
  const compactResponse = normalizeCopyForExact(response);
  const fieldTokens = buildFieldTokens(drill.expectations);
  const expectedValues = Array.from(
    new Set(
      drill.expectations.map((expectation) =>
        normalizeCopyForExact(expectation.expected),
      ),
    ),
  );
  const leftBoundaryTokens = [OPTIONAL_CONNECTOR_TOKEN, ...expectedValues];

  const results = drill.expectations.map((expectation) => {
    const value = normalizeCopyForExact(expectation.expected);
    const candidates = fieldTokens.filter(
      (token) => token.field === expectation.field && token.value === value,
    );

    const captured = candidates.some((candidate) => {
      let start = compactResponse.indexOf(candidate.token);
      while (start !== -1) {
        const end = start + candidate.token.length;
        const hasRightBoundary =
          end === compactResponse.length ||
          startsWithAnyTokenAt(compactResponse, end, expectedValues) ||
          startsWithFieldAt(compactResponse, end, fieldTokens) ||
          (compactResponse.startsWith(OPTIONAL_CONNECTOR_TOKEN, end) &&
            startsWithFieldAt(
              compactResponse,
              end + OPTIONAL_CONNECTOR_TOKEN.length,
              fieldTokens,
            ));
        const hasLeftBoundary =
          start === 0 ||
          endsWithAnyTokenAt(compactResponse, start, leftBoundaryTokens);

        // Callsign and label-free values require complete boundaries on both
        // sides to reject substring captures. Other labeled fields can still
        // be captured when earlier neighboring text is malformed.
        const boundaryAccepted = candidate.labeled
          ? expectation.field === "callsign"
            ? hasLeftBoundary && hasRightBoundary
            : hasRightBoundary
          : hasLeftBoundary && hasRightBoundary;

        if (boundaryAccepted) {
          return true;
        }

        start = compactResponse.indexOf(candidate.token, start + 1);
      }
      return false;
    });

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
