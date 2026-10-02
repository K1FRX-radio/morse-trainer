import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildSchedule } from "../../core/timing.ts";
import type { ContinuousCopyResult } from "../../training/continuous-copy.ts";
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
const playback = {
  schedule,
  durationMs: schedule.totalMs,
};
const result: ContinuousCopyResult = {
  randomGroupTokens: 1,
  wordTokens: 0,
  totalTokens: 1,
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
    cancel: vi.fn(() => Promise.resolve()),
  } as unknown as LearnAudio;
  const onComplete = vi
    .fn<
      (
        typed: string,
        durationCompleted: number,
        abandoned: boolean,
      ) => ContinuousCopyResult
    >()
    .mockReturnValue(result);
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
    act(() => hook.result.current.start(playback));

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
    act(() => hook.result.current.start(playback));
    act(() => vi.advanceTimersByTime(500));
    act(() => hook.result.current.abandon());

    expect(hook.onComplete).toHaveBeenCalledWith("", 500, true);
    expect(hook.result.current.stage).toBe("idle");
    await act(async () => hook.playback.resolve());
    await act(async () => vi.advanceTimersByTime(CONTINUOUS_COPY_GRACE_MS));
    expect(hook.onComplete).toHaveBeenCalledTimes(1);
  });

  it("pauses promptly, freezes countdown, and resumes with preserved text", async () => {
    const firstPlayback = deferred();
    const secondPlayback = deferred();
    const audio = {
      playSchedule: vi
        .fn()
        .mockImplementationOnce(() => firstPlayback.promise)
        .mockImplementationOnce(() => secondPlayback.promise),
      cancel: vi.fn(() => Promise.resolve()),
    } as unknown as LearnAudio;
    const onComplete = vi
      .fn<
        (
          typed: string,
          durationCompleted: number,
          abandoned: boolean,
        ) => ContinuousCopyResult
      >()
      .mockReturnValue(result);
    const hook = renderHook(() =>
      useContinuousCopy({ audio, toneHz: 600, onComplete }),
    );

    act(() => hook.result.current.start(playback));
    act(() => vi.advanceTimersByTime(800));
    act(() => hook.result.current.setText("KM"));

    act(() => {
      expect(hook.result.current.pause()).toBe(true);
    });

    expect(audio.cancel).toHaveBeenCalledOnce();
    expect(hook.result.current.stage).toBe("paused");
    expect(hook.result.current.text).toBe("KM");
    const pausedRemaining = hook.result.current.remainingMs;
    expect(pausedRemaining).toBeGreaterThan(0);

    act(() => vi.advanceTimersByTime(5000));
    expect(hook.result.current.remainingMs).toBe(pausedRemaining);
    expect(hook.result.current.text).toBe("KM");

    act(() => {
      expect(hook.result.current.resume()).toBe(true);
    });
    expect(hook.result.current.stage).toBe("playing");
    expect(audio.playSchedule).toHaveBeenCalledTimes(2);

    await act(async () => secondPlayback.resolve());
    await act(async () => vi.advanceTimersByTime(CONTINUOUS_COPY_GRACE_MS));

    expect(onComplete).toHaveBeenCalledOnce();
    expect(onComplete.mock.calls.at(0)?.[0]).toBe("KM");
    expect(hook.result.current.stage).toBe("result");
  });

  it("excludes paused wall time when abandoning", () => {
    const hook = setup();
    act(() => hook.result.current.start(playback));
    act(() => vi.advanceTimersByTime(600));
    act(() => {
      expect(hook.result.current.pause()).toBe(true);
    });

    act(() => vi.advanceTimersByTime(30000));
    act(() => hook.result.current.abandon());

    const durationMs = hook.onComplete.mock.calls.at(0)?.[1] ?? 0;
    expect(durationMs).toBeGreaterThan(0);
    expect(durationMs).toBeLessThan(2000);
    expect(hook.result.current.stage).toBe("idle");
  });
});
