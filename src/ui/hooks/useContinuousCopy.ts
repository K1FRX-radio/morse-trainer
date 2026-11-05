import { useCallback, useEffect, useRef, useState } from "react";
import type { Schedule } from "../../core/timing.ts";
import type { ContinuousCopyResult } from "../../training/continuous-copy.ts";
import type { RxAudio } from "../learn-audio-context.ts";

const TIMER_INTERVAL_MS = 100;

export type ContinuousCopyStage =
  | "idle"
  | "countdown"
  | "playing"
  | "paused"
  | "awaiting-submission"
  | "result";

type CompleteContinuousCopy = (
  typed: string,
  durationCompleted: number,
  abandoned: boolean,
) => ContinuousCopyResult;

type Options = {
  audio: RxAudio;
  toneHz: number;
  onComplete: CompleteContinuousCopy;
  onPlaybackStart?: () => void;
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

export function useContinuousCopy({
  audio,
  toneHz,
  onComplete,
  onPlaybackStart,
}: Options) {
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
  const countdownTimerRef = useRef<number | undefined>(undefined);
  const pendingCountdownRef = useRef<ContinuousCopyPlayback | undefined>(
    undefined,
  );
  const awaitingSubmissionRef = useRef(false);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;
  const onPlaybackStartRef = useRef(onPlaybackStart);
  onPlaybackStartRef.current = onPlaybackStart;

  const [stage, setStage] = useState<ContinuousCopyStage>("idle");
  const [countdown, setCountdown] = useState<number | undefined>(undefined);
  const [text, setTextState] = useState("");
  const [remainingMs, setRemainingMs] = useState(0);
  const [totalMs, setTotalMs] = useState(0);
  const [result, setResult] = useState<ContinuousCopyResult | undefined>(
    undefined,
  );

  const clearTimers = useCallback(() => {
    if (countdownTimerRef.current !== undefined) {
      window.clearTimeout(countdownTimerRef.current);
      countdownTimerRef.current = undefined;
    }
    if (intervalRef.current !== undefined) {
      window.clearInterval(intervalRef.current);
      intervalRef.current = undefined;
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
        awaitingSubmissionRef.current;
      if (
        !canComplete ||
        completedRef.current ||
        (!abandoned && !awaitingSubmissionRef.current)
      ) {
        return undefined;
      }

      completedRef.current = true;
      awaitingSubmissionRef.current = false;
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

  const startPlayback = useCallback(
    (playback: ContinuousCopyPlayback) => {
      clearTimers();
      pendingCountdownRef.current = undefined;
      const generation = ++generationRef.current;
      playbackRef.current = playback;
      runStartedAtRef.current = performance.now();
      setCountdown(undefined);
      setStage("playing");
      onPlaybackStartRef.current?.();
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
        awaitingSubmissionRef.current = true;
        setStage("awaiting-submission");
      });
    },
    [audio, toneHz, clearTimers, updateRemaining],
  );

  const start = useCallback(
    (playback: ContinuousCopyPlayback, withCountdown = false) => {
      clearTimers();
      const generation = ++generationRef.current;
      playbackRef.current = undefined;
      pendingCountdownRef.current = undefined;
      completedRef.current = false;
      awaitingSubmissionRef.current = false;
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
      if (!withCountdown) {
        startPlayback(playback);
        return;
      }
      pendingCountdownRef.current = playback;
      setStage("countdown");
      let remaining = 3;
      setCountdown(remaining);
      const advanceCountdown = () => {
        if (generation !== generationRef.current) return;
        remaining -= 1;
        if (remaining === 0) {
          startPlayback(playback);
          return;
        }
        setCountdown(remaining);
        countdownTimerRef.current = window.setTimeout(advanceCountdown, 1000);
      };
      countdownTimerRef.current = window.setTimeout(advanceCountdown, 1000);
    },
    [clearTimers, startPlayback],
  );

  const pause = useCallback(() => {
    if (pendingCountdownRef.current && stage === "countdown") {
      generationRef.current += 1;
      clearTimers();
      setStage("paused");
      return true;
    }
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
    if (pendingCountdownRef.current) {
      start(pendingCountdownRef.current, true);
      return true;
    }
    const resumePlan = resumeRef.current;
    if (!resumePlan) return false;
    if (resumePlan.playback.durationMs <= 0) {
      resumeRef.current = undefined;
      progressMsRef.current = totalMsRef.current;
      awaitingSubmissionRef.current = true;
      setRemainingMs(0);
      setStage("awaiting-submission");
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
  }, [stage, start, startPlayback]);

  const setText = useCallback((value: string) => {
    textRef.current = value;
    setTextState(value);
  }, []);

  const finish = useCallback(() => completeCurrent(false), [completeCurrent]);

  const reset = useCallback(() => {
    generationRef.current += 1;
    clearTimers();
    pendingCountdownRef.current = undefined;
    playbackRef.current = undefined;
    resumeRef.current = undefined;
    completedRef.current = false;
    awaitingSubmissionRef.current = false;
    progressMsRef.current = 0;
    runOffsetMsRef.current = 0;
    runFloorMsRef.current = 0;
    totalMsRef.current = 0;
    textRef.current = "";
    setTextState("");
    setRemainingMs(0);
    setTotalMs(0);
    setResult(undefined);
    setCountdown(undefined);
    setStage("idle");
  }, [clearTimers]);

  const abandon = useCallback(() => {
    if (pendingCountdownRef.current) {
      reset();
      return undefined;
    }
    return completeCurrent(true);
  }, [completeCurrent, reset]);

  useEffect(
    () => () => {
      generationRef.current += 1;
      clearTimers();
      pendingCountdownRef.current = undefined;
      playbackRef.current = undefined;
      awaitingSubmissionRef.current = false;
    },
    [clearTimers],
  );

  return {
    stage,
    countdown,
    text,
    remainingMs,
    totalMs,
    result,
    active:
      stage === "countdown" ||
      stage === "playing" ||
      stage === "awaiting-submission",
    start,
    pause,
    resume,
    setText,
    finish,
    abandon,
    reset,
  };
}
