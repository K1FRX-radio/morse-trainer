import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AudioSession } from "./audio-session.ts";

class FakeGain {
  gain = {
    value: 0,
    setValueAtTime: vi.fn((value: number) => {
      this.gain.value = value;
    }),
  };
  connect = vi.fn();
}

class FakeContext {
  state: AudioContextState = "running";
  currentTime = 4;
  destination = {};
  gain = new FakeGain();
  resume = vi.fn(async () => {
    this.state = "running";
  });
  suspend = vi.fn(async () => {
    this.state = "suspended";
  });
  close = vi.fn(async () => {
    this.state = "closed";
  });

  createGain(): GainNode {
    return this.gain as unknown as GainNode;
  }

  createMediaStreamDestination(): MediaStreamAudioDestinationNode {
    return {
      stream: {},
      disconnect: vi.fn(),
    } as unknown as MediaStreamAudioDestinationNode;
  }
}

let context: FakeContext;
let originalSetSinkId: PropertyDescriptor | undefined;

beforeEach(() => {
  context = new FakeContext();
  class TestAudioContext {
    constructor() {
      return context;
    }
  }
  vi.stubGlobal("AudioContext", TestAudioContext);
  originalSetSinkId = Object.getOwnPropertyDescriptor(
    HTMLMediaElement.prototype,
    "setSinkId",
  );
  Object.defineProperty(HTMLMediaElement.prototype, "setSinkId", {
    configurable: true,
    value: vi.fn(() => Promise.resolve()),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalSetSinkId) {
    Object.defineProperty(
      HTMLMediaElement.prototype,
      "setSinkId",
      originalSetSinkId,
    );
  } else {
    delete (HTMLMediaElement.prototype as { setSinkId?: unknown }).setSinkId;
  }
  vi.restoreAllMocks();
});

describe("AudioSession lifecycle", () => {
  it("pauses and resumes the Firefox media-element sink", async () => {
    const pause = vi
      .spyOn(HTMLMediaElement.prototype, "pause")
      .mockImplementation(() => {});
    const play = vi
      .spyOn(HTMLMediaElement.prototype, "play")
      .mockResolvedValue(undefined);
    const session = new AudioSession();
    session.ensureContext();

    await session.suspend();
    expect(pause).toHaveBeenCalledOnce();
    await session.resume();
    expect(context.resume).toHaveBeenCalledOnce();
    expect(play).toHaveBeenCalledOnce();
  });

  it("applies live volume changes including zero", () => {
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    const session = new AudioSession();
    session.ensureContext();

    session.setVolume(0.35);
    session.setVolume(0);

    expect(context.gain.gain.setValueAtTime).toHaveBeenNthCalledWith(
      1,
      0.35,
      4,
    );
    expect(context.gain.gain.setValueAtTime).toHaveBeenNthCalledWith(2, 0, 4);
    expect(context.gain.gain.value).toBe(0);
  });
});
