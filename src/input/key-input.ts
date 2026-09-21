// Framework-agnostic straight-key controller. Records raw key edges with
// monotonic timestamps, exposes a running decode, and fires sidetone callbacks.
// DOM input adapters (keyboard, pointer) translate device events into press()
// and release() calls so decode and timing stay device-independent.

import {
  decodeKeying,
  type DecodeResult,
  type KeyEdge,
  type KeyingThresholds,
} from "../core/keying.ts";

export type StraightKeyOptions = {
  thresholds: KeyingThresholds;
  /** Monotonic clock in ms. Default performance.now. */
  now?: () => number;
  /** Fired when a mark begins so a sidetone can start. */
  onMarkStart?: (t: number) => void;
  /** Fired when a mark ends so a sidetone can stop. */
  onMarkEnd?: (t: number) => void;
  /** Fired after each release with the updated running decode. */
  onDecodeChange?: (result: DecodeResult) => void;
};

/**
 * Tracks a single straight-key contact. press() and release() are idempotent
 * with respect to the current contact state, so repeated or out-of-order device
 * events (auto-repeat, lost focus) never produce a stuck mark or phantom edge.
 */
export class StraightKey {
  private readonly options: StraightKeyOptions;
  private readonly now: () => number;
  private readonly edges: KeyEdge[] = [];
  private down = false;

  constructor(options: StraightKeyOptions) {
    this.options = options;
    this.now =
      options.now ??
      (() =>
        typeof performance !== "undefined" ? performance.now() : Date.now());
  }

  get isDown(): boolean {
    return this.down;
  }

  press(time = this.now()): void {
    if (this.down) {
      return;
    }
    this.down = true;
    this.edges.push({ type: "down", t: time });
    this.options.onMarkStart?.(time);
  }

  release(time = this.now()): void {
    if (!this.down) {
      return;
    }
    this.down = false;
    this.edges.push({ type: "up", t: time });
    this.options.onMarkEnd?.(time);
    this.options.onDecodeChange?.(this.decode());
  }

  /** Current decode of everything keyed so far. */
  decode(): DecodeResult {
    return decodeKeying(this.edges, this.options.thresholds);
  }

  /** Snapshot of the raw edges for attempt data. */
  getEdges(): KeyEdge[] {
    return [...this.edges];
  }

  updateThresholds(thresholds: KeyingThresholds): void {
    this.options.thresholds = thresholds;
  }

  /** Clears all recorded input and lifts any held contact. */
  reset(): void {
    if (this.down) {
      this.down = false;
      this.options.onMarkEnd?.(this.now());
    }
    this.edges.length = 0;
  }
}
