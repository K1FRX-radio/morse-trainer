import { captureDateTime } from "./time.ts";

describe("captureDateTime", () => {
  it("stores UTC and the local calendar context at capture time", () => {
    const date = new Date(2026, 8, 24, 10, 5, 6);

    expect(captureDateTime(date)).toMatchObject({
      utc: date.toISOString(),
      localDate: "2026-09-24",
      utcOffsetMinutes: -date.getTimezoneOffset(),
    });
  });

  it("rejects invalid dates", () => {
    expect(() => captureDateTime(new Date(Number.NaN))).toThrow(RangeError);
  });
});
