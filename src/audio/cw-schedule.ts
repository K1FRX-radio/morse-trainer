// Pure mapping from a CW timing Schedule to gain-automation events.
// This is the testable core of the Web Audio engine: it decides the anti-click
// envelope and event timing without touching Web Audio itself.

import type { Schedule } from "../core/timing.ts";

export type GainRamp = "set" | "linear";

export type GainEvent = {
  /** Offset from playback start in seconds. */
  atSec: number;
  /** Target gain value in [0, 1]. */
  value: number;
  ramp: GainRamp;
};

export type EnvelopeOptions = {
  /** Attack ramp length in ms. Default 5. */
  attackMs?: number;
  /** Release ramp length in ms. Default 5. */
  releaseMs?: number;
  /** Peak gain for a tone mark in [0, 1]. Default 1. */
  peak?: number;
};

export type GainSchedule = {
  events: GainEvent[];
  /** Total playback duration in seconds. */
  durationSec: number;
};

/**
 * Converts a timing Schedule into gain automation events with short attack and
 * release ramps so tone edges do not click. Gaps produce no events; gain simply
 * rests at 0 between marks. Ramps are shortened if a mark is briefer than the
 * combined attack and release so they never overlap.
 */
export function scheduleToGainEvents(
  schedule: Schedule,
  options: EnvelopeOptions = {},
): GainSchedule {
  const attackMs = options.attackMs ?? 5;
  const releaseMs = options.releaseMs ?? 5;
  const peak = options.peak ?? 1;

  const events: GainEvent[] = [];
  let cursorMs = 0;

  for (const segment of schedule.segments) {
    if (segment.tone) {
      const startMs = cursorMs;
      const endMs = cursorMs + segment.ms;

      // Keep attack + release within the mark duration.
      let attack = attackMs;
      let release = releaseMs;
      if (attack + release > segment.ms) {
        const scale = segment.ms / (attack + release);
        attack *= scale;
        release *= scale;
      }

      events.push({ atSec: startMs / 1000, value: 0, ramp: "set" });
      events.push({ atSec: (startMs + attack) / 1000, value: peak, ramp: "linear" });
      events.push({
        atSec: (endMs - release) / 1000,
        value: peak,
        ramp: "set",
      });
      events.push({ atSec: endMs / 1000, value: 0, ramp: "linear" });
    }
    cursorMs += segment.ms;
  }

  return { events, durationSec: cursorMs / 1000 };
}
