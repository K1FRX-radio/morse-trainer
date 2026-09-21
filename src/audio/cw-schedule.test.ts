import { describe, expect, it } from "vitest";
import { buildSchedule } from "../core/timing.ts";
import { scheduleToGainEvents } from "./cw-schedule.ts";

const opts = { charWpm: 20, effectiveWpm: 20 };

describe("scheduleToGainEvents", () => {
  it("wraps a single dit in attack and release ramps", () => {
    const { events, durationSec } = scheduleToGainEvents(
      buildSchedule("E", opts),
      { attackMs: 5, releaseMs: 5, peak: 1 },
    );
    // dit = 60 ms: set 0, ramp up at 5 ms, hold until 55 ms, ramp to 0 at 60 ms.
    expect(events).toEqual([
      { atSec: 0, value: 0, ramp: "set" },
      { atSec: 0.005, value: 1, ramp: "linear" },
      { atSec: 0.055, value: 1, ramp: "set" },
      { atSec: 0.06, value: 0, ramp: "linear" },
    ]);
    expect(durationSec).toBeCloseTo(0.06, 6);
  });

  it("emits no events during gaps and rests at zero", () => {
    // "A" = dit, intra gap, dah. Only the two marks produce events (8 total).
    const { events } = scheduleToGainEvents(buildSchedule("A", opts));
    expect(events).toHaveLength(8);
    // The dah starts after dit (60) + intra gap (60) = 120 ms.
    expect(events[4]).toEqual({ atSec: 0.12, value: 0, ramp: "set" });
  });

  it("scales ramps so they never exceed a short mark", () => {
    const shortSchedule = {
      segments: [{ tone: true as const, ms: 6, element: "dit" as const }],
      totalMs: 6,
    };
    const { events } = scheduleToGainEvents(shortSchedule, {
      attackMs: 5,
      releaseMs: 5,
    });
    // attack + release (10) > 6, scaled by 6/10 -> 3 ms each.
    expect(events[1].atSec).toBeCloseTo(0.003, 6);
    expect(events[2].atSec).toBeCloseTo(0.003, 6);
    expect(events[3].atSec).toBeCloseTo(0.006, 6);
  });

  it("carries the peak gain through", () => {
    const { events } = scheduleToGainEvents(buildSchedule("E", opts), {
      peak: 0.5,
    });
    expect(events[1].value).toBe(0.5);
  });
});
