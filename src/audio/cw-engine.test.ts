import { describe, expect, it, vi } from "vitest";
import { buildSchedule } from "../core/timing.ts";
import type { AudioSession } from "./audio-session.ts";
import { CwEngine } from "./cw-engine.ts";

class FakeAudioParam {
  value = 0;
  setValueAtTime = vi.fn((value: number) => {
    this.value = value;
  });
  linearRampToValueAtTime = vi.fn((value: number) => {
    this.value = value;
  });
  cancelScheduledValues = vi.fn();
}

class FakeGain {
  gain = new FakeAudioParam();
  disconnect = vi.fn();

  connect<T>(target: T): T {
    return target;
  }
}

class FakeOscillator {
  type = "sine";
  frequency = { value: 0 };
  onended: (() => void) | null = null;
  start = vi.fn();
  stop = vi.fn();
  disconnect = vi.fn();

  connect<T>(target: T): T {
    return target;
  }

  finish(): void {
    this.onended?.();
  }
}

class FakeAudioContext {
  currentTime = 1;
  state: AudioContextState = "running";
  readonly oscillators: FakeOscillator[] = [];

  createOscillator(): OscillatorNode {
    const oscillator = new FakeOscillator();
    this.oscillators.push(oscillator);
    return oscillator as unknown as OscillatorNode;
  }

  createGain(): GainNode {
    return new FakeGain() as unknown as GainNode;
  }
}

function makeEngine() {
  const context = new FakeAudioContext();
  const masterGain = new FakeGain() as unknown as GainNode;
  const session = {
    context,
    masterGain,
    ensureContext: () => context,
    resume: () => Promise.resolve(),
    applyPreferredSink: () => Promise.resolve(),
  } as unknown as AudioSession;
  return { context, engine: new CwEngine(session) };
}

async function finishSetup(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("CwEngine playback lifecycle", () => {
  it("settles cancellation and the playback promise after voice disposal", async () => {
    const { context, engine } = makeEngine();
    const playback = engine.playSchedule(buildSchedule("K", { charWpm: 20 }), {
      toneHz: 600,
    });
    await finishSetup();

    const oscillator = context.oscillators[0];
    let cancellationSettled = false;
    const cancellation = engine.cancel().then(() => {
      cancellationSettled = true;
    });
    const repeatedCancellation = engine.cancel();
    await Promise.resolve();
    expect(cancellationSettled).toBe(false);

    oscillator.finish();
    await cancellation;
    await repeatedCancellation;
    await playback;
    expect(cancellationSettled).toBe(true);
    expect(oscillator.disconnect).toHaveBeenCalledOnce();
  });

  it("waits for the old voice to stop before starting replacement audio", async () => {
    const { context, engine } = makeEngine();
    const first = engine.playSchedule(buildSchedule("K", { charWpm: 20 }), {
      toneHz: 600,
    });
    await finishSetup();

    const second = engine.playSchedule(buildSchedule("M", { charWpm: 20 }), {
      toneHz: 600,
    });
    await finishSetup();
    expect(context.oscillators).toHaveLength(1);

    context.oscillators[0].finish();
    await finishSetup();
    expect(context.oscillators).toHaveLength(2);
    await first;

    const cancellation = engine.cancel();
    context.oscillators[1].finish();
    await cancellation;
    await second;
  });

  it("settles immediately when cancellation occurs while suspended", async () => {
    const { context, engine } = makeEngine();
    const playback = engine.playSchedule(buildSchedule("K", { charWpm: 20 }), {
      toneHz: 600,
    });
    await finishSetup();
    context.state = "suspended";

    await engine.cancel();
    await playback;
    expect(context.oscillators[0].disconnect).toHaveBeenCalledOnce();
  });
});
