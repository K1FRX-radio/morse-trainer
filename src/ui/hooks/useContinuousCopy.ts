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
  coveredDurationMs: number;
};

function sumDuration(segments: Schedule["segments"]): number {
  return segments.reduce((total, segment) => total + segment.ms, 0);
}

// Resume from a deterministic safe boundary: the start of the next token.
function nextTokenResumePlan(
  playback: ContinuousCopyPlayback,
  elapsedMs: number,
): ResumePlan {
  const clampedElapsed = Math.min(Math.max(0, elapsedMs), playback.durationMs);
  const segments = playback.schedule.segments;
  if (segments.length === 0) {
    return { playback, coveredDurationMs: clampedElapsed };
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
      coveredDurationMs: playback.durationMs,
    };
  }

  let startIndex = elapsedIndex;
  for (let index = elapsedIndex; index < segments.length; index += 1) {
    const segment = segments[index];
    if (!segment.tone && segment.gap === "word") {
      startIndex = index + 1;
      break;
    }
  }

  const resumedSegments = segments.slice(startIndex);
  const resumedDurationMs = sumDuration(resumedSegments);
  const coveredDurationMs = playback.durationMs - resumedDurationMs;
  return {
    playback: {
      schedule: {
        segments: resumedSegments,
        totalMs: resumedDurationMs,
      },
      durationMs: resumedDurationMs,
    },
    coveredDurationMs,
  };
}

export function useContinuousCopy({ audio, toneHz, onComplete }: Options) {
  const generationRef = useRef(0);
  const playbackRef = useRef<ContinuousCopyPlayback | undefined>(undefined);
  const resumeRef = useRef<ResumePlan | undefined>(undefined);
  const textRef = useRef("");
  const startedAtRef = useRef(0);
  const elapsedMsRef = useRef(0);
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

  const elapsedInCurrentPlayback = useCallback((): number => {
    const playback = playbackRef.current;
    if (!playback) return elapsedMsRef.current;
    const elapsedSegment = Math.max(
      0,
      performance.now() - startedAtRef.current,
    );
    return Math.min(playback.durationMs, elapsedMsRef.current + elapsedSegment);
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
        ? elapsedInCurrentPlayback()
        : playback
          ? elapsedMsRef.current + playback.durationMs
          : elapsedMsRef.current;
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
    [clearTimers, elapsedInCurrentPlayback],
  );
  completeCurrentRef.current = completeCurrent;

  const startPlayback = useCallback(
    (playback: ContinuousCopyPlayback) => {
      clearTimers();
      const generation = ++generationRef.current;
      playbackRef.current = playback;
      startedAtRef.current = performance.now();
      setStage("playing");
      setRemainingMs(playback.durationMs);

      intervalRef.current = window.setInterval(() => {
        if (generation !== generationRef.current) return;
        const elapsed = Math.max(0, performance.now() - startedAtRef.current);
        setRemainingMs(Math.max(0, playback.durationMs - elapsed));
      }, TIMER_INTERVAL_MS);

      void audio.playSchedule(playback.schedule, { toneHz }).then(() => {
        if (generation !== generationRef.current) return;
        if (intervalRef.current !== undefined) {
          window.clearInterval(intervalRef.current);
          intervalRef.current = undefined;
        }
        elapsedMsRef.current += playback.durationMs;
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
    [audio, toneHz, clearTimers],
  );

  const start = useCallback(
    (playback: ContinuousCopyPlayback) => {
      clearTimers();
      completedRef.current = false;
      textRef.current = "";
      elapsedMsRef.current = 0;
      resumeRef.current = undefined;
      setTextState("");
      setResult(undefined);
      setTotalMs(playback.durationMs);
      startPlayback(playback);
    },
    [clearTimers, startPlayback],
  );

  const pause = useCallback(() => {
    const playback = playbackRef.current;
    if (!playback || stage !== "playing") return false;
    const elapsed = Math.min(
      playback.durationMs,
      Math.max(0, performance.now() - startedAtRef.current),
    );
    const resumePlan = nextTokenResumePlan(playback, elapsed);
    elapsedMsRef.current += resumePlan.coveredDurationMs;
    resumeRef.current = resumePlan;
    generationRef.current += 1;
    clearTimers();
    playbackRef.current = undefined;
    setRemainingMs(resumePlan.playback.durationMs);
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
    elapsedMsRef.current = 0;
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
