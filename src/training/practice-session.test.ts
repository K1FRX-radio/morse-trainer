import { describe, expect, it } from "vitest";
import type { ActiveTimePoint } from "./session-time.ts";
import { PracticeSessionTimer } from "./practice-session.ts";

function point(monotonicMs: number): ActiveTimePoint {
  return {
    monotonicMs,
    wallTime: {
      utc: new Date(Date.UTC(2026, 8, 24, 10, 0, 0, monotonicMs)).toISOString(),
      localDate: "2026-09-24",
      utcOffsetMinutes: 0,
      timeZone: "UTC",
    },
  };
}

describe("PracticeSessionTimer", () => {
  it("starts lazily and uses the shared idle cutoff", () => {
    const timer = new PracticeSessionTimer();
    timer.recordActivity(point(0));
    timer.recordActivity(point(120000));

    expect(timer.snapshot().activeMs).toBe(60000);
  });

  it("shares pause and validity semantics with Learn", () => {
    const timer = new PracticeSessionTimer();
    timer.start(point(0));
    timer.pause(point(20000));
    timer.resume(point(80000));
    timer.finish(point(90000));

    expect(timer.snapshot().activeMs).toBe(30000);
    expect(timer.isValid(1)).toBe(true);
    expect(timer.isValid(0)).toBe(false);
  });
});
