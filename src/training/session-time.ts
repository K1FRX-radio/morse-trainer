import {
  isValidTrainingSession,
  MIN_VALID_SESSION_ACTIVE_MS,
} from "../core/session-validity.ts";

export const DEFAULT_IDLE_THRESHOLD_MS = 60000;

export type ActiveTimeContext = {
  utc: string;
  localDate: string;
  utcOffsetMinutes: number;
  timeZone?: string;
};

export type ActiveTimePoint = {
  monotonicMs: number;
  wallTime: ActiveTimeContext;
};

export type ActiveDateBucket = {
  localDate: string;
  utcOffsetMinutes: number;
  timeZone?: string;
  activeMs: number;
};

export type ActiveTimeSnapshot = {
  activeMs: number;
  activeDateBuckets: ActiveDateBucket[];
};

export type ActiveTimeTrackerOptions = {
  idleThresholdMs?: number;
  minActiveMs?: number;
  captureAt?: (date: Date, timeZone?: string) => ActiveTimeContext;
};

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function currentTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

function zonedParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes): number => {
    const part = parts.find((candidate) => candidate.type === type)?.value;
    if (part === undefined) throw new RangeError(`missing ${type} date part`);
    return Number(part);
  };
  return {
    year: value("year"),
    month: value("month"),
    day: value("day"),
    hour: value("hour"),
    minute: value("minute"),
    second: value("second"),
  };
}

export function captureActiveTime(
  date: Date = new Date(),
  requestedTimeZone?: string,
): ActiveTimeContext {
  if (Number.isNaN(date.getTime())) {
    throw new RangeError("cannot capture an invalid date");
  }
  const timeZone = requestedTimeZone ?? currentTimeZone();
  if (!timeZone) {
    return {
      utc: date.toISOString(),
      localDate: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
      utcOffsetMinutes: -date.getTimezoneOffset(),
    };
  }
  const parts = zonedParts(date, timeZone);
  const utcOffsetMinutes = Math.round(
    (Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
    ) -
      Math.floor(date.getTime() / 1000) * 1000) /
      60000,
  );
  return {
    utc: date.toISOString(),
    localDate: `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`,
    utcOffsetMinutes,
    timeZone,
  };
}

function bucketKey(bucket: Omit<ActiveDateBucket, "activeMs">): string {
  return `${bucket.localDate}\u0000${bucket.utcOffsetMinutes}\u0000${bucket.timeZone ?? ""}`;
}

export class ActiveTimeTracker {
  private readonly idleThresholdMs: number;
  private readonly minActiveMs: number;
  private readonly captureAt: (
    date: Date,
    timeZone?: string,
  ) => ActiveTimeContext;
  private readonly buckets = new Map<string, ActiveDateBucket>();
  private lastActivity: ActiveTimePoint | undefined;
  private paused = false;
  private activeMs = 0;

  constructor(options: ActiveTimeTrackerOptions = {}) {
    this.idleThresholdMs = options.idleThresholdMs ?? DEFAULT_IDLE_THRESHOLD_MS;
    this.minActiveMs = options.minActiveMs ?? MIN_VALID_SESSION_ACTIVE_MS;
    this.captureAt = options.captureAt ?? captureActiveTime;
  }

  start(point: ActiveTimePoint): void {
    this.lastActivity = point;
    this.paused = false;
  }

  recordActivity(point: ActiveTimePoint): void {
    if (!this.paused && this.lastActivity) {
      const elapsedMs = point.monotonicMs - this.lastActivity.monotonicMs;
      if (elapsedMs > 0) {
        const accruedMs = Math.min(elapsedMs, this.idleThresholdMs);
        this.addInterval(this.lastActivity.wallTime, accruedMs);
        this.activeMs += accruedMs;
      }
    }
    this.lastActivity = point;
  }

  pause(point: ActiveTimePoint): void {
    if (this.paused) return;
    this.recordActivity(point);
    this.paused = true;
  }

  resume(point: ActiveTimePoint): void {
    if (!this.paused) return;
    this.paused = false;
    this.lastActivity = point;
  }

  snapshot(): ActiveTimeSnapshot {
    return {
      activeMs: this.activeMs,
      activeDateBuckets: [...this.buckets.values()].map((bucket) => ({
        ...bucket,
      })),
    };
  }

  isValid(attemptCount: number): boolean {
    return isValidTrainingSession(
      { activeMs: this.activeMs, attemptCount },
      this.minActiveMs,
    );
  }

  private addInterval(start: ActiveTimeContext, durationMs: number): void {
    const startMs = Date.parse(start.utc);
    if (!Number.isFinite(startMs)) {
      throw new RangeError("active-time point has an invalid UTC timestamp");
    }
    const endMs = startMs + durationMs;
    let cursorMs = startMs;

    while (cursorMs < endMs) {
      const context = this.contextAt(new Date(cursorMs), start);
      const identity = {
        localDate: context.localDate,
        utcOffsetMinutes: context.utcOffsetMinutes,
        ...(context.timeZone ? { timeZone: context.timeZone } : {}),
      };
      let boundaryMs = endMs;
      const finalContext = this.contextAt(new Date(endMs - 1), start);

      if (bucketKey(identity) !== bucketKey(finalContext)) {
        let low = cursorMs + 1;
        let high = endMs - 1;
        while (low < high) {
          const middle = Math.floor((low + high) / 2);
          const middleContext = this.contextAt(new Date(middle), start);
          if (bucketKey(middleContext) === bucketKey(identity)) {
            low = middle + 1;
          } else {
            high = middle;
          }
        }
        boundaryMs = low;
      }

      this.addBucket(identity, boundaryMs - cursorMs);
      cursorMs = boundaryMs;
    }
  }

  private contextAt(date: Date, start: ActiveTimeContext): ActiveTimeContext {
    if (start.timeZone) return this.captureAt(date, start.timeZone);
    const local = new Date(date.getTime() + start.utcOffsetMinutes * 60000);
    return {
      utc: date.toISOString(),
      localDate: local.toISOString().slice(0, 10),
      utcOffsetMinutes: start.utcOffsetMinutes,
    };
  }

  private addBucket(
    identity: Omit<ActiveDateBucket, "activeMs">,
    activeMs: number,
  ): void {
    const key = bucketKey(identity);
    const existing = this.buckets.get(key);
    if (existing) {
      existing.activeMs += activeMs;
      return;
    }
    this.buckets.set(key, { ...identity, activeMs });
  }
}
