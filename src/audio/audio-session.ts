// Web Audio session: owns a single AudioContext and master gain, performs the
// one-time silent unlock required by iOS/Safari, and exposes resume/volume.
// This is the only place that constructs the AudioContext so lifecycle stays
// centralized. Output routing uses AudioContext.setSinkId on Chromium and a
// MediaStream + <audio> element on Firefox.

import { detectOutputMethod, type OutputMethod } from "./output-devices.ts";

type SinkAudioElement = HTMLAudioElement & {
  setSinkId?: (id: string) => Promise<void>;
  sinkId?: string;
};

type SinkAudioContext = AudioContext & {
  setSinkId?: (id: string) => Promise<void>;
  sinkId?: string;
};

export class AudioSession {
  private ctx: AudioContext | undefined;
  private master: GainNode | undefined;
  private unlocked = false;
  private volume = 0.7;
  private preferredSinkId = "";
  private readonly method: OutputMethod = detectOutputMethod();
  private streamNode: MediaStreamAudioDestinationNode | undefined;
  private sinkElement: SinkAudioElement | undefined;

  /** Lazily creates the AudioContext and master gain on first use. */
  ensureContext(): AudioContext {
    if (!this.ctx) {
      const Ctor: typeof AudioContext =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;

      if (this.method === "media-element") {
        // Firefox cannot retarget an AudioContext, so capture its output into a
        // MediaStream played by an <audio> element that supports setSinkId.
        this.streamNode = this.ctx.createMediaStreamDestination();
        this.master.connect(this.streamNode);
        const element = new Audio() as SinkAudioElement;
        element.srcObject = this.streamNode.stream;
        element.autoplay = true;
        element.volume = 1;
        this.sinkElement = element;
      } else {
        this.master.connect(this.ctx.destination);
      }
    }
    return this.ctx;
  }

  get context(): AudioContext | undefined {
    return this.ctx;
  }

  /** Node that all sound sources connect to; scaled by the master volume. */
  get masterGain(): GainNode {
    this.ensureContext();
    return this.master as GainNode;
  }

  async resume(): Promise<void> {
    const ctx = this.ensureContext();
    if (ctx.state === "suspended") {
      await ctx.resume();
    }
    await this.ensureSinkPlaying();
  }

  /**
   * One-time silent unlock on a user gesture: resume the context and play a
   * zero-gain, single-sample buffer so mobile browsers reliably start the clock.
   */
  async unlock(): Promise<void> {
    const ctx = this.ensureContext();
    await this.resume();
    if (this.unlocked) {
      return;
    }
    const buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.start(0);
    this.unlocked = true;
  }

  setVolume(volume: number): void {
    this.volume = Math.min(1, Math.max(0, volume));
    if (this.master && this.ctx) {
      this.master.gain.setValueAtTime(this.volume, this.ctx.currentTime);
    }
  }

  /**
   * Selects the output device by id ("" = system default). Applied immediately
   * if a context exists and reapplied whenever applyPreferredSink runs before
   * playback. No-op where output redirection is unsupported.
   */
  setPreferredSinkId(deviceId: string): void {
    this.preferredSinkId = deviceId;
    void this.applyPreferredSink();
  }

  get sinkId(): string {
    return this.preferredSinkId;
  }

  async applyPreferredSink(): Promise<void> {
    if (this.method === "audiocontext") {
      const ctx = this.ctx as SinkAudioContext | undefined;
      if (
        typeof ctx?.setSinkId !== "function" ||
        ctx.sinkId === this.preferredSinkId
      ) {
        return;
      }
      try {
        await ctx.setSinkId(this.preferredSinkId);
      } catch {
        // Fall back to the default sink if the device is unavailable.
      }
    } else if (this.method === "media-element") {
      const element = this.sinkElement;
      if (
        typeof element?.setSinkId !== "function" ||
        element.sinkId === this.preferredSinkId
      ) {
        return;
      }
      // setSinkId on a media element requires it to be playing.
      await this.ensureSinkPlaying();
      try {
        await element.setSinkId(this.preferredSinkId);
      } catch {
        // Fall back to the default sink if the device is unavailable.
      }
    }
  }

  private async ensureSinkPlaying(): Promise<void> {
    if (this.method === "media-element" && this.sinkElement?.paused) {
      try {
        await this.sinkElement.play();
      } catch {
        // Autoplay may need a user gesture; retried on the next resume.
      }
    }
  }

  async close(): Promise<void> {
    if (this.sinkElement) {
      this.sinkElement.pause();
      this.sinkElement.srcObject = null;
      this.sinkElement = undefined;
    }
    if (this.streamNode) {
      try {
        this.streamNode.disconnect();
      } catch {
        // Already disconnected.
      }
      this.streamNode = undefined;
    }
    if (this.ctx) {
      await this.ctx.close();
      this.ctx = undefined;
      this.master = undefined;
      this.unlocked = false;
    }
  }
}
