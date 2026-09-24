import type { CapturedDateTime } from "./models.ts";

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function localDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function currentTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

/** Captures UTC and local-date context without making later timezone guesses. */
export function captureDateTime(date: Date = new Date()): CapturedDateTime {
  if (Number.isNaN(date.getTime())) {
    throw new RangeError("cannot capture an invalid date");
  }
  const timeZone = currentTimeZone();
  return {
    utc: date.toISOString(),
    localDate: localDate(date),
    utcOffsetMinutes: -date.getTimezoneOffset(),
    ...(timeZone ? { timeZone } : {}),
  };
}
