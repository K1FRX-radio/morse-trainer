// Web Audio session: owns a single AudioContext and master gain, performs the
// one-time silent unlock required by iOS/Safari, and exposes resume/volume.
// This is the only place that constructs the AudioContext so lifecycle stays
// centralized.

export class AudioSession {
  private ctx: AudioContext | undefined;
  private master: GainNode | undefined;
  private unlocked = false;
  private volume = 0.7;

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
      this.master.connect(this.ctx.destination);
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

  async close(): Promise<void> {
    if (this.ctx) {
      await this.ctx.close();
      this.ctx = undefined;
      this.master = undefined;
      this.unlocked = false;
    }
  }
}
