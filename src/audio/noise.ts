// Band-noise generator: a looped white-noise buffer through a bandpass filter
// centered on the tone frequency, scaled by a 0..1 noise level. Modeled on the
// legacy prototype's receiver noise.

import type { AudioSession } from "./audio-session.ts";

const BUFFER_SECONDS = 2;
const FILTER_Q = 1;

type NoiseGraph = {
  source: AudioBufferSourceNode;
  filter: BiquadFilterNode;
  gain: GainNode;
};

export class BandNoise {
  private readonly session: AudioSession;
  private graph: NoiseGraph | undefined;
  private level = 0;

  constructor(session: AudioSession) {
    this.session = session;
  }

  /** Starts looping band noise at the given tone center and level (0..1). */
  start(toneHz: number, level: number): void {
    const ctx = this.session.ensureContext();
    void this.session.resume();
    this.stop();
    this.level = clampLevel(level);

    const buffer = ctx.createBuffer(
      1,
      Math.floor(ctx.sampleRate * BUFFER_SECONDS),
      ctx.sampleRate,
    );
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;

    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = toneHz;
    filter.Q.value = FILTER_Q;

    const gain = ctx.createGain();
    gain.gain.value = this.level;

    source.connect(filter).connect(gain).connect(this.session.masterGain);
    source.start();

    this.graph = { source, filter, gain };
  }

  setLevel(level: number): void {
    this.level = clampLevel(level);
    if (this.graph) {
      const ctx = this.session.context;
      if (ctx) {
        this.graph.gain.gain.setValueAtTime(this.level, ctx.currentTime);
      }
    }
  }

  setTone(toneHz: number): void {
    if (this.graph) {
      const ctx = this.session.context;
      if (ctx) {
        this.graph.filter.frequency.setValueAtTime(toneHz, ctx.currentTime);
      }
    }
  }

  stop(): void {
    if (this.graph) {
      try {
        this.graph.source.stop();
        this.graph.source.disconnect();
        this.graph.filter.disconnect();
        this.graph.gain.disconnect();
      } catch {
        // Already stopped.
      }
      this.graph = undefined;
    }
  }
}

function clampLevel(level: number): number {
  if (Number.isNaN(level)) {
    return 0;
  }
  return Math.min(1, Math.max(0, level));
}
