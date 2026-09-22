import { describe, expect, it, vi } from "vitest";
import type { AudioSession } from "../audio/audio-session.ts";
import type { CwEngine } from "../audio/cw-engine.ts";
import { buildSchedule } from "../core/timing.ts";
import { createLearnAudio } from "./learn-audio-controller.ts";

function deferred() {
  let resolve = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("Learn audio lifecycle", () => {
  it("waits for cancellation before suspending", async () => {
    const cancellation = deferred();
    const engine = {
      cancel: vi.fn(() => cancellation.promise),
      playText: vi.fn(() => Promise.resolve()),
    } as unknown as CwEngine;
    const session = {
      suspend: vi.fn(() => Promise.resolve()),
    } as unknown as AudioSession;
    const audio = createLearnAudio(engine, session, () => Promise.resolve());

    const stopping = audio.cancelAndSuspend();
    expect(session.suspend).not.toHaveBeenCalled();
    cancellation.resolve();
    await stopping;
    expect(session.suspend).toHaveBeenCalledOnce();
  });

  it("does not let stale cancellation suspend a newer playback", async () => {
    const cancellation = deferred();
    const engine = {
      cancel: vi.fn(() => cancellation.promise),
      playText: vi.fn(() => Promise.resolve()),
    } as unknown as CwEngine;
    const session = {
      suspend: vi.fn(() => Promise.resolve()),
    } as unknown as AudioSession;
    const audio = createLearnAudio(engine, session, () => Promise.resolve());

    const staleStop = audio.cancelAndSuspend();
    await audio.play("K", { charWpm: 20, effectiveWpm: 12 }, { toneHz: 600 });
    cancellation.resolve();
    await staleStop;

    expect(session.suspend).not.toHaveBeenCalled();
  });

  it("plays a preserved schedule through the engine", async () => {
    const schedule = buildSchedule("KM", { charWpm: 20, effectiveWpm: 12 });
    const engine = {
      playSchedule: vi.fn(() => Promise.resolve()),
    } as unknown as CwEngine;
    const audio = createLearnAudio(engine, {} as AudioSession, () =>
      Promise.resolve(),
    );

    await audio.playSchedule(schedule, { toneHz: 600 });

    expect(engine.playSchedule).toHaveBeenCalledWith(schedule, { toneHz: 600 });
  });
});
