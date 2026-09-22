import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildSchedule } from "../../core/timing.ts";
import type { ContinuousCopyResult } from "../../training/continuous-copy.ts";
import type { ContinuousCopyEvent } from "../../training/learn-session.ts";
import type { LearnAudio } from "../learn-audio-context.ts";
import {
  CONTINUOUS_COPY_GRACE_MS,
  useContinuousCopy,
} from "./useContinuousCopy.ts";

function deferred() {
  let resolve = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const schedule = buildSchedule("KMKM", {
  charWpm: 20,
  effectiveWpm: 12,
});
const event: ContinuousCopyEvent = {
  type: "continuous-copy",
  id: "continuous-copy",
  plan: {
    target: "KMKM",
    schedule,
    requestedDurationMs: schedule.totalMs,
    scheduledDurationMs: schedule.totalMs,
  },
};
const result: ContinuousCopyResult = {
  targetCharacters: 4,
  typedCharacters: 4,
  alignedCorrect: 4,
  accuracy: 1,
  perCharacterResults: [],
  insertions: 0,
  deletions: 0,
  substitutions: 0,
  durationCompleted: schedule.totalMs,
  abandoned: false,
};

function setup() {
  const playback = deferred();
  const audio = {
    playSchedule: vi.fn(() => playback.promise),
  } as unknown as LearnAudio;
  const onComplete = vi.fn(() => result);
  const hook = renderHook(() =>
    useContinuousCopy({ audio, toneHz: 600, onComplete }),
  );
  return { ...hook, audio, playback, onComplete };
}

beforeEach(() => vi.useFakeTimers());

afterEach(() => vi.useRealTimers());

describe("useContinuousCopy", () => {
  it("keeps input active during playback and completes after the grace period", async () => {
    const hook = setup();
    act(() => hook.result.current.start(event));

    expect(hook.result.current.stage).toBe("playing");
    expect(hook.result.current.active).toBe(true);
    expect(hook.audio.playSchedule).toHaveBeenCalledWith(schedule, {
      toneHz: 600,
    });
    act(() => hook.result.current.setText("K MKM"));
    await act(async () => hook.playback.resolve());

    expect(hook.result.current.stage).toBe("finishing");
    expect(hook.result.current.active).toBe(true);
    await act(async () => vi.advanceTimersByTime(CONTINUOUS_COPY_GRACE_MS));

    expect(hook.onComplete).toHaveBeenCalledWith(
      "K MKM",
      schedule.totalMs,
      false,
    );
    expect(hook.result.current.stage).toBe("result");
    expect(hook.result.current.result).toBe(result);
  });

  it("abandons only elapsed playback and ignores stale completion", async () => {
    const hook = setup();
    act(() => hook.result.current.start(event));
    act(() => vi.advanceTimersByTime(500));
    act(() => hook.result.current.abandon());

    expect(hook.onComplete).toHaveBeenCalledWith("", 500, true);
    expect(hook.result.current.stage).toBe("idle");
    await act(async () => hook.playback.resolve());
    await act(async () => vi.advanceTimersByTime(CONTINUOUS_COPY_GRACE_MS));
    expect(hook.onComplete).toHaveBeenCalledTimes(1);
  });
});
