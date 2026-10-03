import { useCallback, useEffect, useRef, useState } from "react";
import type { Schedule } from "../../core/timing.ts";
import type { ContinuousCopyResult } from "../../training/continuous-copy.ts";
import type { RxAudio } from "../learn-audio-context.ts";

export const CONTINUOUS_COPY_GRACE_MS = 2000;
const TIMER_INTERVAL_MS = 100;

export type ContinuousCopyStage =
  "idle" | "playing" | "paused" | "finishing" | "result";

type CompleteContinuousCopy = (
  typed: string,
  durationCompleted: number,
  abandoned: boolean,
) => ContinuousCopyResult;

type Options = {
  audio: RxAudio;
  toneHz: number;
  onComplete: CompleteContinuousCopy;
};

export type ContinuousCopyPlayback = {
  schedule: Schedule;
  durationMs: number;
};

type ResumePlan = {
  playback: ContinuousCopyPlayback;
  offsetWithinPlaybackMs: number;
};

function sumDuration(segments: Schedule["segments"]): number {
  return segments.reduce((total, segment) => total + segment.ms, 0);
}

// Safe deterministic resume point: restart from the beginning of the current
// token (bounded replay), so no unheard target material is ever skipped.
function currentTokenResumePlan(
  playback: ContinuousCopyPlayback,
  elapsedMs: number,
): ResumePlan {
  const clampedElapsed = Math.min(Math.max(0, elapsedMs), playback.durationMs);
  const segments = playback.schedule.segments;
  if (segments.length === 0) {
    return { playback, offsetWithinPlaybackMs: clampedElapsed };
  }

  let cumulative = 0;
  let elapsedIndex = segments.length;
  for (let index = 0; index < segments.length; index += 1) {
    cumulative += segments[index].ms;
    if (clampedElapsed < cumulative) {
      elapsedIndex = index;
      break;
    }
  }

  if (elapsedIndex >= segments.length) {
    return {
      playback: { schedule: { segments: [], totalMs: 0 }, durationMs: 0 },
      offsetWithinPlaybackMs: playback.durationMs,
    };
  }

  let startIndex: number;
  const elapsedSegment = segments[elapsedIndex];
  if (!elapsedSegment.tone && elapsedSegment.gap === "word") {
    startIndex = elapsedIndex + 1;
  } else {
    startIndex = 0;
    for (let index = elapsedIndex - 1; index >= 0; index -= 1) {
      const segment = segments[index];
      if (!segment.tone && segment.gap === "word") {
        startIndex = index + 1;
        break;
      }
    }
  }

  let offsetWithinPlaybackMs = 0;
  for (let index = 0; index < startIndex; index += 1) {
    offsetWithinPlaybackMs += segments[index].ms;
  }

  if (startIndex >= segments.length) {
    return {
      playback: { schedule: { segments: [], totalMs: 0 }, durationMs: 0 },
      offsetWithinPlaybackMs,
    };
  }

  const resumedSegments = segments.slice(startIndex);
  const resumedDurationMs = sumDuration(resumedSegments);
  return {
    playback: {
      schedule: {
        segments: resumedSegments,
        totalMs: resumedDurationMs,
      },
      durationMs: resumedDurationMs,
    },
    offsetWithinPlaybackMs,
  };
}

function progressWithinOriginalTimeline(
  runStartMs: number,
  runOffsetMs: number,
  floorMs: number,
  playbackDurationMs: number,
  totalMs: number,
): number {
  const elapsed = Math.min(
    playbackDurationMs,
    Math.max(0, performance.now() - runStartMs),
  );
  const candidate = runOffsetMs + elapsed;
  return Math.min(totalMs, Math.max(floorMs, candidate));
}

export function useContinuousCopy({ audio, toneHz, onComplete }: Options) {
  const generationRef = useRef(0);
  const playbackRef = useRef<ContinuousCopyPlayback | undefined>(undefined);
  const resumeRef = useRef<ResumePlan | undefined>(undefined);
  const textRef = useRef("");
  const runStartedAtRef = useRef(0);
  const runOffsetMsRef = useRef(0);
  const runFloorMsRef = useRef(0);
  const progressMsRef = useRef(0);
  const totalMsRef = useRef(0);
  const completedRef = useRef(false);
  const intervalRef = useRef<number | undefined>(undefined);
  const graceRef = useRef<number | undefined>(undefined);
  const onCompleteRef = useRef(onComplete);
  const completeCurrentRef = useRef<
    (abandoned: boolean) => ContinuousCopyResult | undefined
  >(() => undefined);
  onCompleteRef.current = onComplete;

  const [stage, setStage] = useState<ContinuousCopyStage>("idle");
  const [text, setTextState] = useState("");
  const [remainingMs, setRemainingMs] = useState(0);
  const [totalMs, setTotalMs] = useState(0);
  const [result, setResult] = useState<ContinuousCopyResult | undefined>(
    undefined,
  );

  const clearTimers = useCallback(() => {
    if (intervalRef.current !== undefined) {
      window.clearInterval(intervalRef.current);
      intervalRef.current = undefined;
    }
    if (graceRef.current !== undefined) {
      window.clearTimeout(graceRef.current);
      graceRef.current = undefined;
    }
  }, []);

  const updateRemaining = useCallback(() => {
    const total = totalMsRef.current;
    const playback = playbackRef.current;
    if (!playback) {
      setRemainingMs(Math.max(0, total - progressMsRef.current));
      return;
    }
    const progress = progressWithinOriginalTimeline(
      runStartedAtRef.current,
      runOffsetMsRef.current,
      runFloorMsRef.current,
      playback.durationMs,
      total,
    );
    setRemainingMs(Math.max(0, total - progress));
  }, []);

  const completeCurrent = useCallback(
    (abandoned: boolean): ContinuousCopyResult | undefined => {
      const playback = playbackRef.current;
      const canComplete =
        playback !== undefined ||
        resumeRef.current !== undefined ||
        graceRef.current !== undefined;
      if (!canComplete || completedRef.current) {
        return undefined;
      }

      completedRef.current = true;
      generationRef.current += 1;
      clearTimers();

      const durationCompleted = abandoned
        ? playback
          ? progressWithinOriginalTimeline(
              runStartedAtRef.current,
              runOffsetMsRef.current,
              runFloorMsRef.current,
              playback.durationMs,
              totalMsRef.current,
            )
          : progressMsRef.current
        : playback
          ? totalMsRef.current
          : progressMsRef.current;

      const completed = onCompleteRef.current(
        textRef.current,
        durationCompleted,
        abandoned,
      );

      playbackRef.current = undefined;
      resumeRef.current = undefined;
      setRemainingMs(0);

      if (abandoned) {
        setStage("idle");
        setTextState("");
        textRef.current = "";
        setResult(undefined);
      } else {
        setStage("result");
        setResult(completed);
      }
      return completed;
    },
    [clearTimers],
  );
  completeCurrentRef.current = completeCurrent;

  const startPlayback = useCallback(
    (playback: ContinuousCopyPlayback) => {
      clearTimers();
      const generation = ++generationRef.current;
      playbackRef.current = playback;
      runStartedAtRef.current = performance.now();
      setStage("playing");
      updateRemaining();

      intervalRef.current = window.setInterval(() => {
        if (generation !== generationRef.current) return;
        updateRemaining();
      }, TIMER_INTERVAL_MS);

      void audio.playSchedule(playback.schedule, { toneHz }).then(() => {
        if (generation !== generationRef.current) return;
        if (intervalRef.current !== undefined) {
          window.clearInterval(intervalRef.current);
          intervalRef.current = undefined;
        }
        progressMsRef.current = Math.min(
          totalMsRef.current,
          Math.max(
            runFloorMsRef.current,
            runOffsetMsRef.current + playback.durationMs,
          ),
        );
        playbackRef.current = undefined;
        resumeRef.current = undefined;
        setRemainingMs(0);
        setStage("finishing");
        graceRef.current = window.setTimeout(
          () => completeCurrentRef.current(false),
          CONTINUOUS_COPY_GRACE_MS,
        );
      });
    },
    [audio, toneHz, clearTimers, updateRemaining],
  );

  const start = useCallback(
    (playback: ContinuousCopyPlayback) => {
      clearTimers();
      completedRef.current = false;
      textRef.current = "";
      progressMsRef.current = 0;
      runOffsetMsRef.current = 0;
      runFloorMsRef.current = 0;
      resumeRef.current = undefined;
      setTextState("");
      setResult(undefined);
      totalMsRef.current = playback.durationMs;
      setTotalMs(playback.durationMs);
      setRemainingMs(playback.durationMs);
      startPlayback(playback);
    },
    [clearTimers, startPlayback],
  );

  const pause = useCallback(() => {
    const playback = playbackRef.current;
    if (!playback || stage !== "playing") return false;

    const elapsed = Math.min(
      playback.durationMs,
      Math.max(0, performance.now() - runStartedAtRef.current),
    );
    const progress = progressWithinOriginalTimeline(
      runStartedAtRef.current,
      runOffsetMsRef.current,
      runFloorMsRef.current,
      playback.durationMs,
      totalMsRef.current,
    );

    const resumePlan = currentTokenResumePlan(playback, elapsed);
    progressMsRef.current = progress;
    resumeRef.current = resumePlan;

    generationRef.current += 1;
    clearTimers();
    playbackRef.current = undefined;
    setRemainingMs(Math.max(0, totalMsRef.current - progressMsRef.current));
    setStage("paused");
    void audio.cancel();
    return true;
  }, [audio, clearTimers, stage]);

  const resume = useCallback(() => {
    if (stage !== "paused") return false;
    const resumePlan = resumeRef.current;
    if (!resumePlan || resumePlan.playback.durationMs <= 0) {
      completeCurrent(false);
      return true;
    }

    // Keep absolute timeline mapping across repeated pause/resume cycles by
    // composing the new resume boundary (relative to current playback) onto the
    // current absolute offset.
    runOffsetMsRef.current = Math.min(
      totalMsRef.current,
      runOffsetMsRef.current + resumePlan.offsetWithinPlaybackMs,
    );
    runFloorMsRef.current = progressMsRef.current;
    startPlayback(resumePlan.playback);
    return true;
  }, [completeCurrent, stage, startPlayback]);

  const setText = useCallback((value: string) => {
    textRef.current = value;
    setTextState(value);
  }, []);

  const finish = useCallback(() => completeCurrent(false), [completeCurrent]);

  const abandon = useCallback(() => completeCurrent(true), [completeCurrent]);

  const reset = useCallback(() => {
    generationRef.current += 1;
    clearTimers();
    playbackRef.current = undefined;
    resumeRef.current = undefined;
    completedRef.current = false;
    progressMsRef.current = 0;
    runOffsetMsRef.current = 0;
    runFloorMsRef.current = 0;
    totalMsRef.current = 0;
    textRef.current = "";
    setTextState("");
    setRemainingMs(0);
    setTotalMs(0);
    setResult(undefined);
    setStage("idle");
  }, [clearTimers]);

  useEffect(
    () => () => {
      generationRef.current += 1;
      clearTimers();
      playbackRef.current = undefined;
    },
    [clearTimers],
  );

  return {
    stage,
    text,
    remainingMs,
    totalMs,
    result,
    active: stage === "playing" || stage === "finishing",
    start,
    pause,
    resume,
    setText,
    finish,
    abandon,
    reset,
  };
}
