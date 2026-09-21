// Pure CW keying decode: raw key edges -> mark/space durations -> text.
// Framework- and DOM-free. Browser input adapters feed monotonic timestamps
// here so decode logic stays testable and shared across input devices.

import { decodePattern } from "./morse.ts";

/** A single key transition with a monotonic timestamp in milliseconds. */
export type KeyEdge = {
  type: "down" | "up";
  /** Monotonic time in ms (e.g. performance.now()). */
  t: number;
};

export type KeyingThresholds = {
  /** Reference dit duration in ms; all other thresholds scale from it. */
  ditMs: number;
  /** A mark of at least this many dits decodes as a dah. Default 2. */
  dahThresholdDits: number;
  /** A gap of at least this many dits ends the current character. Default 3. */
  charGapDits: number;
  /** A gap of at least this many dits inserts a word space. Default 7. */
  wordGapDits: number;
};

/** Standard decode thresholds derived from a character speed in WPM. */
export function thresholdsForWpm(
  charWpm: number,
  overrides: Partial<Omit<KeyingThresholds, "ditMs">> = {},
): KeyingThresholds {
  return {
    ditMs: 1200 / charWpm,
    dahThresholdDits: overrides.dahThresholdDits ?? 2,
    charGapDits: overrides.charGapDits ?? 3,
    wordGapDits: overrides.wordGapDits ?? 7,
  };
}

/** Classifies a single mark duration as a dit or a dah. */
export function markToElement(
  markMs: number,
  thresholds: KeyingThresholds,
): "." | "-" {
  return markMs >= thresholds.dahThresholdDits * thresholds.ditMs ? "-" : ".";
}

export type KeyingGapKind = "intra" | "char" | "word";

/** Classifies a gap between two marks as intra-character, character, or word. */
export function classifyGap(
  gapMs: number,
  thresholds: KeyingThresholds,
): KeyingGapKind {
  if (gapMs >= thresholds.wordGapDits * thresholds.ditMs) {
    return "word";
  }
  if (gapMs >= thresholds.charGapDits * thresholds.ditMs) {
    return "char";
  }
  return "intra";
}

export type DecodeResult = {
  /** Decoded text; unknown patterns become "?". */
  text: string;
  /** Mark (tone-on) durations in ms, in order. */
  marksMs: number[];
  /** Gap (silence) durations in ms between consecutive marks, in order. */
  spacesMs: number[];
};

/**
 * Decodes a completed sequence of key edges into text plus the raw mark/space
 * durations. Edges must alternate down/up starting with a down; a trailing
 * unmatched down is ignored. The final in-progress character is flushed.
 */
export function decodeKeying(
  edges: readonly KeyEdge[],
  thresholds: KeyingThresholds,
): DecodeResult {
  const marksMs: number[] = [];
  const spacesMs: number[] = [];

  // Pair down/up edges into marks, recording the gap that precedes each mark.
  let previousUp: number | undefined;
  let pendingDown: number | undefined;
  const marks: Array<{ durationMs: number; gapBeforeMs: number | undefined }> =
    [];

  for (const edge of edges) {
    if (edge.type === "down") {
      pendingDown = edge.t;
    } else if (pendingDown !== undefined) {
      const durationMs = edge.t - pendingDown;
      const gapBeforeMs =
        previousUp === undefined ? undefined : pendingDown - previousUp;
      marks.push({ durationMs, gapBeforeMs });
      previousUp = edge.t;
      pendingDown = undefined;
    }
  }

  let pattern = "";
  let text = "";

  const flush = (): void => {
    if (pattern.length === 0) {
      return;
    }
    text += decodePattern(pattern) ?? "?";
    pattern = "";
  };

  marks.forEach((mark, index) => {
    if (index > 0 && mark.gapBeforeMs !== undefined) {
      spacesMs.push(mark.gapBeforeMs);
      const gap = classifyGap(mark.gapBeforeMs, thresholds);
      if (gap !== "intra") {
        flush();
      }
      if (gap === "word") {
        text += " ";
      }
    }
    marksMs.push(mark.durationMs);
    pattern += markToElement(mark.durationMs, thresholds);
  });

  flush();
  return { text, marksMs, spacesMs };
}
