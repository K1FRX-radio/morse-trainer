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
  captureAt?: (date: Date) => ActiveTimeContext;
};

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

export function captureActiveTime(date: Date = new Date()): ActiveTimeContext {
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

function bucketKey(bucket: Omit<ActiveDateBucket, "activeMs">): string {
  return `${bucket.localDate}\u0000${bucket.utcOffsetMinutes}\u0000${bucket.timeZone ?? ""}`;
}

export class ActiveTimeTracker {
  private readonly idleThresholdMs: number;
  private readonly minActiveMs: number;
  private readonly captureAt: (date: Date) => ActiveTimeContext;
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
        this.addInterval(this.lastActivity.wallTime.utc, accruedMs);
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

  private addInterval(startUtc: string, durationMs: number): void {
    const startMs = Date.parse(startUtc);
    if (!Number.isFinite(startMs)) {
      throw new RangeError("active-time point has an invalid UTC timestamp");
    }
    const endMs = startMs + durationMs;
    let cursorMs = startMs;

    while (cursorMs < endMs) {
      const context = this.captureAt(new Date(cursorMs));
      const identity = {
        localDate: context.localDate,
        utcOffsetMinutes: context.utcOffsetMinutes,
        ...(context.timeZone ? { timeZone: context.timeZone } : {}),
      };
      let boundaryMs = endMs;
      const finalContext = this.captureAt(new Date(endMs - 1));

      if (bucketKey(identity) !== bucketKey(finalContext)) {
        let low = cursorMs + 1;
        let high = endMs - 1;
        while (low < high) {
          const middle = Math.floor((low + high) / 2);
          const middleContext = this.captureAt(new Date(middle));
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
