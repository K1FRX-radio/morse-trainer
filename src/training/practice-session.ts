import {
  ActiveTimeTracker,
  captureActiveTime,
  type ActiveTimePoint,
  type ActiveTimeSnapshot,
  type ActiveTimeTrackerOptions,
} from "./session-time.ts";

export function currentActiveTimePoint(): ActiveTimePoint {
  return {
    monotonicMs:
      typeof performance !== "undefined" ? performance.now() : Date.now(),
    wallTime: captureActiveTime(),
  };
}

export class PracticeSessionTimer {
  private readonly tracker: ActiveTimeTracker;
  private started = false;

  constructor(options: ActiveTimeTrackerOptions = {}) {
    this.tracker = new ActiveTimeTracker(options);
  }

  start(point: ActiveTimePoint): void {
    if (this.started) {
      this.tracker.recordActivity(point);
      return;
    }
    this.started = true;
    this.tracker.start(point);
  }

  recordActivity(point: ActiveTimePoint): void {
    this.start(point);
  }

  pause(point: ActiveTimePoint): void {
    if (this.started) this.tracker.pause(point);
  }

  resume(point: ActiveTimePoint): void {
    if (this.started) this.tracker.resume(point);
  }

  finish(point: ActiveTimePoint): ActiveTimeSnapshot {
    if (this.started) this.tracker.recordActivity(point);
    return this.snapshot();
  }

  snapshot(): ActiveTimeSnapshot {
    return this.tracker.snapshot();
  }

  isValid(finalizedAttemptCount: number): boolean {
    return this.tracker.isValid(finalizedAttemptCount);
  }
}
