import { describe, expect, it } from "vitest";
import {
  buildSchedule,
  ditMs,
  farnsworthUnitMs,
  type Segment,
} from "./timing.ts";

// Compact view of a schedule for readable golden assertions.
function shape(segments: Segment[]): Array<[string, number]> {
  return segments.map((s) => (s.tone ? [s.element, s.ms] : [s.gap, s.ms]));
}

function totalGapBetweenMarks(segments: Segment[]): number[] {
  // Sum of consecutive gap ms runs (the silence between tone marks).
  const gaps: number[] = [];
  let run = 0;
  let sawMark = false;
  for (const s of segments) {
    if (s.tone) {
      if (sawMark) gaps.push(run);
      run = 0;
      sawMark = true;
    } else {
      run += s.ms;
    }
  }
  return gaps;
}

describe("standard timing at 20 WPM", () => {
  const opts = { charWpm: 20, effectiveWpm: 20 };

  it("dit is 60 ms and dah is 180 ms", () => {
    expect(ditMs(20)).toBe(60);
    expect(shape(buildSchedule("E", opts).segments)).toEqual([["dit", 60]]);
    expect(shape(buildSchedule("T", opts).segments)).toEqual([["dah", 180]]);
  });

  it("A = dit, intra gap, dah", () => {
    expect(shape(buildSchedule("A", opts).segments)).toEqual([
      ["dit", 60],
      ["intra", 60],
      ["dah", 180],
    ]);
  });

  it("AN uses a single 3-unit inter-character gap", () => {
    expect(shape(buildSchedule("AN", opts).segments)).toEqual([
      ["dit", 60],
      ["intra", 60],
      ["dah", 180],
      ["inter-char", 180],
      ["dah", 180],
      ["intra", 60],
      ["dit", 60],
    ]);
  });

  it("word gap totals 7 units (420 ms), not character gap plus word gap", () => {
    const schedule = buildSchedule("A B", opts);
    const gaps = totalGapBetweenMarks(schedule.segments);
    // The only inter-word silence must be exactly 420 ms.
    expect(gaps).toContain(420);
    expect(gaps).not.toContain(600);
    // Exactly one word gap segment exists.
    const wordGaps = schedule.segments.filter(
      (s) => !s.tone && s.gap === "word",
    );
    expect(wordGaps).toHaveLength(1);
    expect(wordGaps[0].ms).toBe(420);
  });
});

describe("farnsworth timing", () => {
  it("collapses to standard when effective equals character speed", () => {
    expect(farnsworthUnitMs(20, 20)).toBeCloseTo(ditMs(20), 6);
  });

  it("keeps element timing at character speed while stretching gaps", () => {
    const opts = { charWpm: 20, effectiveWpm: 10 };
    const schedule = buildSchedule("AN", opts);
    const marks = schedule.segments.filter((s) => s.tone);
    // Elements unchanged at 20 WPM.
    expect(marks.map((s) => s.ms)).toEqual([60, 180, 180, 60]);
    // Inter-character gap stretched via Farnsworth unit (~217.9 ms * 3).
    const unit = farnsworthUnitMs(20, 10);
    const interChar = schedule.segments.find(
      (s) => !s.tone && s.gap === "inter-char",
    );
    expect(interChar?.ms).toBe(Math.round(3 * unit));
    expect(interChar?.ms).toBeGreaterThan(600);
  });

  it("word gap is 7 Farnsworth units", () => {
    const opts = { charWpm: 20, effectiveWpm: 10 };
    const unit = farnsworthUnitMs(20, 10);
    const schedule = buildSchedule("A B", opts);
    const wordGap = schedule.segments.find((s) => !s.tone && s.gap === "word");
    expect(wordGap?.ms).toBe(Math.round(7 * unit));
  });

  it("rejects effective speed faster than character speed", () => {
    expect(() => buildSchedule("A", { charWpm: 20, effectiveWpm: 25 })).toThrow(
      RangeError,
    );
  });
});
