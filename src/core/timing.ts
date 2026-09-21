// Pure CW timing: standard and Farnsworth schedule generation.
// No DOM, no Web Audio; consumers turn a Schedule into sound or test vectors.

import { encodeText } from "./morse.ts";

export type Element = "dit" | "dah";
export type GapKind = "intra" | "inter-char" | "word";

export type ToneSegment = {
  tone: true;
  ms: number;
  element: Element;
};

export type GapSegment = {
  tone: false;
  ms: number;
  gap: GapKind;
};

export type Segment = ToneSegment | GapSegment;

export type Schedule = {
  segments: Segment[];
  totalMs: number;
};

export type TimingOptions = {
  /** Character speed in WPM; sets element and intra-character timing. */
  charWpm: number;
  /**
   * Effective (Farnsworth) speed in WPM. Must be <= charWpm. When equal to
   * charWpm the schedule collapses to standard timing.
   */
  effectiveWpm?: number;
};

/** Dit duration in milliseconds at a given character speed. */
export function ditMs(charWpm: number): number {
  return 1200 / charWpm;
}

/**
 * Farnsworth spacing unit in milliseconds, per the standard PARIS-based ARRL
 * distribution: the 31 character units stay at charWpm while the 19 spacing
 * units stretch to hit the effective speed.
 */
export function farnsworthUnitMs(
  charWpm: number,
  effectiveWpm: number,
): number {
  return (60000 / effectiveWpm - 37200 / charWpm) / 19;
}

function resolveEffective(options: TimingOptions): number {
  const effective = options.effectiveWpm ?? options.charWpm;
  if (effective > options.charWpm) {
    throw new RangeError(
      `effectiveWpm (${effective}) must be <= charWpm (${options.charWpm})`,
    );
  }
  return effective;
}

function elementSegment(element: Element, unit: number): ToneSegment {
  return {
    tone: true,
    ms: Math.round(element === "dah" ? unit * 3 : unit),
    element,
  };
}

/**
 * Builds a timing schedule for text. Word boundaries emit exactly one 7-unit
 * word gap (never a character gap plus a word gap), so multiword totals are
 * correct.
 */
export function buildSchedule(text: string, options: TimingOptions): Schedule {
  const effectiveWpm = resolveEffective(options);
  const unitChar = ditMs(options.charWpm);
  const unitFarns = farnsworthUnitMs(options.charWpm, effectiveWpm);

  const intraGapMs = Math.round(unitChar);
  const interCharGapMs = Math.round(3 * unitFarns);
  const wordGapMs = Math.round(7 * unitFarns);

  const segments: Segment[] = [];
  const encoded = encodeText(text);

  let previousWasCharacter = false;
  for (const { character, pattern } of encoded) {
    if (character === " ") {
      if (previousWasCharacter) {
        // Replace any pending character gap with a single word gap.
        segments.push({ tone: false, ms: wordGapMs, gap: "word" });
        previousWasCharacter = false;
      }
      continue;
    }

    if (previousWasCharacter) {
      segments.push({ tone: false, ms: interCharGapMs, gap: "inter-char" });
    }

    for (let i = 0; i < pattern.length; i++) {
      if (i > 0) {
        segments.push({ tone: false, ms: intraGapMs, gap: "intra" });
      }
      const element: Element = pattern[i] === "-" ? "dah" : "dit";
      segments.push(elementSegment(element, unitChar));
    }
    previousWasCharacter = true;
  }

  const totalMs = segments.reduce((sum, segment) => sum + segment.ms, 0);
  return { segments, totalMs };
}
