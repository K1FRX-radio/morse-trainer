// Web Audio CW engine. Plays a pure timing Schedule by scheduling gain
// automation against the AudioContext clock, and drives a live sidetone for
// keying. A fresh oscillator/gain pair is created per playback and discarded on
// completion or cancellation so suspend/resume on mobile cannot strand a tone.

import {
  buildSchedule,
  type Schedule,
  type TimingOptions,
} from "../core/timing.ts";
import type { AudioSession } from "./audio-session.ts";
import { scheduleToGainEvents } from "./cw-schedule.ts";

export type PlayOptions = {
  toneHz: number;
  /** Peak gain for marks in [0, 1]. Default 1. */
  peak?: number;
};

type Voice = {
  osc: OscillatorNode;
  gain: GainNode;
};

type PlaybackVoice = Voice & {
  completion: Promise<void>;
  resolve: () => void;
  settled: boolean;
  cancelling: boolean;
};

/** Short lead so the first scheduled event is comfortably in the future. */
const START_LEAD_SEC = 0.05;
/** Ramp used to silence a voice on cancellation without a click. */
const CANCEL_RAMP_SEC = 0.005;

export class CwEngine {
  private readonly session: AudioSession;
  private playback: PlaybackVoice | undefined;
  private sidetone: Voice | undefined;
  private playbackGeneration = 0;

  constructor(session: AudioSession) {
    this.session = session;
  }

  /** Plays text at the given timing and tone. Resolves when playback ends. */
  async playText(
    text: string,
    timing: TimingOptions,
    options: PlayOptions,
  ): Promise<void> {
    return this.playSchedule(buildSchedule(text, timing), options);
  }

  /**
   * Plays a prebuilt schedule. Any in-progress playback is cancelled first so
   * only one exercise sounds at a time.
   */
  async playSchedule(schedule: Schedule, options: PlayOptions): Promise<void> {
    const generation = ++this.playbackGeneration;
    await this.cancelPlayback();
    const ctx = this.session.ensureContext();
    await this.session.resume();
    await this.session.applyPreferredSink();
    if (generation !== this.playbackGeneration) {
      return;
    }

    const { events, durationSec } = scheduleToGainEvents(schedule, {
      peak: options.peak ?? 1,
    });

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = options.toneHz;
    gain.gain.value = 0;
    osc.connect(gain).connect(this.session.masterGain);

    const start = ctx.currentTime + START_LEAD_SEC;
    for (const event of events) {
      const at = start + event.atSec;
      if (event.ramp === "set") {
        gain.gain.setValueAtTime(event.value, at);
      } else {
        gain.gain.linearRampToValueAtTime(event.value, at);
      }
    }

    osc.start(start);
    osc.stop(start + durationSec + CANCEL_RAMP_SEC);

    let resolveCompletion = () => {};
    const completion = new Promise<void>((resolve) => {
      resolveCompletion = resolve;
    });
    const voice: PlaybackVoice = {
      osc,
      gain,
      completion,
      resolve: resolveCompletion,
      settled: false,
      cancelling: false,
    };
    this.playback = voice;

    osc.onended = () => this.finishVoice(voice);
    return completion;
  }

  /** Stops any current playback immediately without leaving a tone sounding. */
  cancel(): Promise<void> {
    this.playbackGeneration += 1;
    return this.cancelPlayback();
  }

  private cancelPlayback(): Promise<void> {
    const voice = this.playback;
    if (!voice) {
      return Promise.resolve();
    }
    if (voice.cancelling) {
      return voice.completion;
    }
    voice.cancelling = true;
    const ctx = this.session.context;
    if (!ctx || ctx.state !== "running") {
      try {
        voice.osc.stop();
      } catch {
        // Already stopped.
      }
      this.finishVoice(voice);
      return voice.completion;
    }
    // Reschedule the stop to now; the oscillator's onended then resolves the
    // pending play promise and disposes the voice (no leak, no stuck tone).
    const now = ctx.currentTime;
    voice.gain.gain.cancelScheduledValues(now);
    voice.gain.gain.setValueAtTime(voice.gain.gain.value, now);
    voice.gain.gain.linearRampToValueAtTime(0, now + CANCEL_RAMP_SEC);
    try {
      voice.osc.stop(now + CANCEL_RAMP_SEC);
    } catch {
      this.finishVoice(voice);
    }
    return voice.completion;
  }

  /** Starts a continuous sidetone for live keying. */
  startTone(toneHz: number, peak = 1): void {
    const ctx = this.session.ensureContext();
    void this.session.resume();
    void this.session.applyPreferredSink();
    this.stopTone();

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = toneHz;
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(peak, ctx.currentTime + CANCEL_RAMP_SEC);
    osc.connect(gain).connect(this.session.masterGain);
    osc.start();
    this.sidetone = { osc, gain };
  }

  /** Stops the live sidetone with a short release ramp. */
  stopTone(): void {
    if (this.sidetone) {
      this.stopVoice(this.sidetone);
      this.sidetone = undefined;
    }
  }

  /** Cancels playback and sidetone; call on teardown/unmount. */
  async dispose(): Promise<void> {
    await this.cancel();
    this.stopTone();
  }

  private stopVoice(voice: Voice): void {
    const ctx = this.session.context;
    if (ctx) {
      const now = ctx.currentTime;
      voice.gain.gain.cancelScheduledValues(now);
      voice.gain.gain.setValueAtTime(voice.gain.gain.value, now);
      voice.gain.gain.linearRampToValueAtTime(0, now + CANCEL_RAMP_SEC);
      voice.osc.onended = null;
      try {
        voice.osc.stop(now + CANCEL_RAMP_SEC);
      } catch {
        // Already stopped.
      }
    }
    this.disposeVoice(voice);
  }

  private disposeVoice(voice: Voice): void {
    try {
      voice.osc.disconnect();
      voice.gain.disconnect();
    } catch {
      // Already disconnected.
    }
  }

  private finishVoice(voice: PlaybackVoice): void {
    if (voice.settled) {
      return;
    }
    voice.settled = true;
    voice.osc.onended = null;
    this.disposeVoice(voice);
    if (this.playback === voice) {
      this.playback = undefined;
    }
    voice.resolve();
  }
}
