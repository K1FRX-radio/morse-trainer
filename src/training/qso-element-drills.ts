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

// Boundary checks must consume complete neighboring fields rather than matching
// a label or expected-value substring inside an incorrect value.
function buildBoundaryChecks(
  response: string,
  fieldTokens: readonly FieldToken[],
) {
  const prefixMemo = new Map<number, boolean>();
  const suffixMemo = new Map<number, boolean>();
  const labels = Object.entries(FIELD_LABELS);

  function hasCompletePrefix(end: number): boolean {
    if (end === 0) return true;
    const cached = prefixMemo.get(end);
    if (cached !== undefined) return cached;
    const complete = [
      ...fieldTokens.map(({ token }) => token),
      OPTIONAL_CONNECTOR_TOKEN,
    ].some(
      (token) =>
        end >= token.length &&
        response.slice(end - token.length, end) === token &&
        hasCompletePrefix(end - token.length),
    );
    prefixMemo.set(end, complete);
    return complete;
  }

  function hasCompleteSuffix(start: number): boolean {
    if (start === response.length) return true;
    const cached = suffixMemo.get(start);
    if (cached !== undefined) return cached;
    let complete = fieldTokens.some(
      ({ token }) =>
        response.startsWith(token, start) &&
        hasCompleteSuffix(start + token.length),
    );
    if (!complete && response.startsWith(OPTIONAL_CONNECTOR_TOKEN, start)) {
      complete = hasCompleteSuffix(start + OPTIONAL_CONNECTOR_TOKEN.length);
    }
    // An incorrect labeled value can still delimit a correct preceding field
    // (for example DE LU2SL RST 1599). Require actual field content, and consume
    // all of it; RSTX and a bare label cannot delimit a callsign.
    if (!complete) {
      complete = labels.some(([field, label]) => {
        if (!response.startsWith(label, start)) return false;
        const valueStart = start + label.length;
        if (
          !fieldTokens.some(
            (token) => token.labeled && response.startsWith(token.token, start),
          ) &&
          [...Object.values(FIELD_LABELS), OPTIONAL_CONNECTOR_TOKEN].some(
            (nextLabel) => response.startsWith(nextLabel, valueStart),
          )
        )
          return false;
        for (let end = valueStart + 1; end <= response.length; end += 1) {
          const value = response.slice(valueStart, end);
          const validContent =
            field === "rst"
              ? /^\d+$/.test(value)
              : field === "callsign"
                ? /^[A-Z0-9/]+$/.test(value) && /\d/.test(value)
                : /^[A-Z]+$/.test(value);
          if (validContent && hasCompleteSuffix(end)) return true;
        }
        return false;
      });
    }
    suffixMemo.set(start, complete);
    return complete;
  }

  return { hasCompletePrefix, hasCompleteSuffix };
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
  const { hasCompletePrefix, hasCompleteSuffix } = buildBoundaryChecks(
    compactResponse,
    fieldTokens,
  );

  const results = drill.expectations.map((expectation) => {
    const value = normalizeCopyForExact(expectation.expected);
    const candidates = fieldTokens.filter(
      (token) => token.field === expectation.field && token.value === value,
    );

    const captured = candidates.some((candidate) => {
      let start = compactResponse.indexOf(candidate.token);
      while (start !== -1) {
        const end = start + candidate.token.length;
        const hasRightBoundary = hasCompleteSuffix(end);
        const hasLeftBoundary = hasCompletePrefix(start);

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
