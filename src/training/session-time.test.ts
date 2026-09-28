import { describe, expect, it } from "vitest";
import {
  ActiveTimeTracker,
  type ActiveTimeContext,
  type ActiveTimePoint,
} from "./session-time.ts";

type OffsetPeriod = {
  startsAt: string;
  offsetMinutes: number;
};

function captureInZone(timeZone: string, periods: OffsetPeriod[]) {
  const sorted = periods
    .map((period) => ({
      startsAt: Date.parse(period.startsAt),
      offsetMinutes: period.offsetMinutes,
    }))
    .sort((left, right) => left.startsAt - right.startsAt);

  return (date: Date): ActiveTimeContext => {
    const instant = date.getTime();
    let period: (typeof sorted)[number] | undefined;
    for (const candidate of sorted) {
      if (candidate.startsAt > instant) break;
      period = candidate;
    }
    if (!period) throw new Error("missing offset period");
    const local = new Date(instant + period.offsetMinutes * 60000);
    return {
      utc: date.toISOString(),
      localDate: local.toISOString().slice(0, 10),
      utcOffsetMinutes: period.offsetMinutes,
      timeZone,
    };
  };
}

function point(
  monotonicMs: number,
  utc: string,
  captureAt: (date: Date) => ActiveTimeContext,
): ActiveTimePoint {
  return { monotonicMs, wallTime: captureAt(new Date(utc)) };
}

const captureUtc = captureInZone("UTC", [
  { startsAt: "1970-01-01T00:00:00.000Z", offsetMinutes: 0 },
]);

describe("ActiveTimeTracker", () => {
  it("tracks an ordinary single-day session", () => {
    const tracker = new ActiveTimeTracker({ captureAt: captureUtc });
    tracker.start(point(0, "2026-09-24T10:00:00.000Z", captureUtc));
    tracker.recordActivity(
      point(45000, "2026-09-24T10:00:45.000Z", captureUtc),
    );

    expect(tracker.snapshot()).toEqual({
      activeMs: 45000,
      activeDateBuckets: [
        {
          localDate: "2026-09-24",
          utcOffsetMinutes: 0,
          timeZone: "UTC",
          activeMs: 45000,
        },
      ],
    });
  });

  it("splits active time across local midnight", () => {
    const tracker = new ActiveTimeTracker({ captureAt: captureUtc });
    tracker.start(point(0, "2026-09-24T23:59:40.000Z", captureUtc));
    tracker.recordActivity(
      point(40000, "2026-09-25T00:00:20.000Z", captureUtc),
    );

    expect(tracker.snapshot().activeDateBuckets).toEqual([
      {
        localDate: "2026-09-24",
        utcOffsetMinutes: 0,
        timeZone: "UTC",
        activeMs: 20000,
      },
      {
        localDate: "2026-09-25",
        utcOffsetMinutes: 0,
        timeZone: "UTC",
        activeMs: 20000,
      },
    ]);
  });

  it("splits spring-forward activity at the offset transition", () => {
    const captureNewYork = captureInZone("America/New_York", [
      { startsAt: "1970-01-01T00:00:00.000Z", offsetMinutes: -300 },
      { startsAt: "2026-03-08T07:00:00.000Z", offsetMinutes: -240 },
    ]);
    const tracker = new ActiveTimeTracker({ captureAt: captureNewYork });
    tracker.start(point(0, "2026-03-08T06:59:40.000Z", captureNewYork));
    tracker.recordActivity(
      point(40000, "2026-03-08T07:00:20.000Z", captureNewYork),
    );

    expect(tracker.snapshot().activeDateBuckets).toEqual([
      {
        localDate: "2026-03-08",
        utcOffsetMinutes: -300,
        timeZone: "America/New_York",
        activeMs: 20000,
      },
      {
        localDate: "2026-03-08",
        utcOffsetMinutes: -240,
        timeZone: "America/New_York",
        activeMs: 20000,
      },
    ]);
  });

  it("splits fall-back activity at the offset transition", () => {
    const captureNewYork = captureInZone("America/New_York", [
      { startsAt: "1970-01-01T00:00:00.000Z", offsetMinutes: -240 },
      { startsAt: "2026-11-01T06:00:00.000Z", offsetMinutes: -300 },
    ]);
    const tracker = new ActiveTimeTracker({ captureAt: captureNewYork });
    tracker.start(point(0, "2026-11-01T05:59:40.000Z", captureNewYork));
    tracker.recordActivity(
      point(40000, "2026-11-01T06:00:20.000Z", captureNewYork),
    );

    expect(tracker.snapshot().activeDateBuckets).toEqual([
      {
        localDate: "2026-11-01",
        utcOffsetMinutes: -240,
        timeZone: "America/New_York",
        activeMs: 20000,
      },
      {
        localDate: "2026-11-01",
        utcOffsetMinutes: -300,
        timeZone: "America/New_York",
        activeMs: 20000,
      },
    ]);
  });

  it("caps an idle period from its starting activity across midnight", () => {
    const tracker = new ActiveTimeTracker({ captureAt: captureUtc });
    tracker.start(point(0, "2026-09-24T23:59:30.000Z", captureUtc));
    tracker.recordActivity(
      point(120000, "2026-09-25T00:01:30.000Z", captureUtc),
    );

    expect(tracker.snapshot()).toEqual({
      activeMs: 60000,
      activeDateBuckets: [
        {
          localDate: "2026-09-24",
          utcOffsetMinutes: 0,
          timeZone: "UTC",
          activeMs: 30000,
        },
        {
          localDate: "2026-09-25",
          utcOffsetMinutes: 0,
          timeZone: "UTC",
          activeMs: 30000,
        },
      ],
    });
  });

  it("keeps capped idle time in the starting timezone after a device change", () => {
    const captureNewYork = captureInZone("America/New_York", [
      { startsAt: "1970-01-01T00:00:00.000Z", offsetMinutes: -240 },
    ]);
    const captureChicago = captureInZone("America/Chicago", [
      { startsAt: "1970-01-01T00:00:00.000Z", offsetMinutes: -300 },
    ]);
    let captureEnvironment = captureNewYork;
    const tracker = new ActiveTimeTracker({
      captureAt: (date, authorityTimeZone) =>
        authorityTimeZone === "America/New_York"
          ? captureNewYork(date)
          : captureEnvironment(date),
    });
    tracker.start(point(0, "2026-09-25T04:59:30.000Z", captureNewYork));
    captureEnvironment = captureChicago;
    tracker.recordActivity(
      point(120000, "2026-09-25T05:01:30.000Z", captureChicago),
    );

    expect(tracker.snapshot()).toEqual({
      activeMs: 60000,
      activeDateBuckets: [
        {
          localDate: "2026-09-25",
          utcOffsetMinutes: -240,
          timeZone: "America/New_York",
          activeMs: 60000,
        },
      ],
    });
  });

  it("excludes paused and hidden-tab time", () => {
    const tracker = new ActiveTimeTracker({ captureAt: captureUtc });
    tracker.start(point(0, "2026-09-24T10:00:00.000Z", captureUtc));
    tracker.pause(point(10000, "2026-09-24T10:00:10.000Z", captureUtc));
    tracker.resume(point(70000, "2026-09-24T10:01:10.000Z", captureUtc));
    tracker.recordActivity(
      point(85000, "2026-09-24T10:01:25.000Z", captureUtc),
    );

    expect(tracker.snapshot().activeMs).toBe(25000);
  });

  it("uses elapsed activity and finalized attempts for interrupted validity", () => {
    const valid = new ActiveTimeTracker({ captureAt: captureUtc });
    valid.start(point(0, "2026-09-24T10:00:00.000Z", captureUtc));
    valid.recordActivity(point(30000, "2026-09-24T10:00:30.000Z", captureUtc));

    const invalid = new ActiveTimeTracker({ captureAt: captureUtc });
    invalid.start(point(0, "2026-09-24T11:00:00.000Z", captureUtc));
    invalid.recordActivity(
      point(29999, "2026-09-24T11:00:29.999Z", captureUtc),
    );

    expect(valid.isValid(1)).toBe(true);
    expect(valid.isValid(0)).toBe(false);
    expect(invalid.isValid(1)).toBe(false);
  });
});
