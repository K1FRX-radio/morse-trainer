import { captureActiveTime } from "../training/session-time.ts";
import type { CapturedDateTime } from "./models.ts";

/** Captures UTC and local-date context without making later timezone guesses. */
export function captureDateTime(date: Date = new Date()): CapturedDateTime {
  return captureActiveTime(date);
}
