import { useCallback, useEffect, useRef, useState } from "react";
import type { Schedule } from "../../core/timing.ts";
import type { ContinuousCopyResult } from "../../training/continuous-copy.ts";
import type { RxAudio } from "../learn-audio-context.ts";

export const CONTINUOUS_COPY_GRACE_MS = 2000;
const TIMER_INTERVAL_MS = 100;

export type ContinuousCopyStage = "idle" | "playing" | "finishing" | "result";

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

export function useContinuousCopy({ audio, toneHz, onComplete }: Options) {
  const generationRef = useRef(0);
  const playbackRef = useRef<ContinuousCopyPlayback | undefined>(undefined);
  const textRef = useRef("");
  const startedAtRef = useRef(0);
  const completedRef = useRef(false);
  const intervalRef = useRef<number | undefined>(undefined);
  const graceRef = useRef<number | undefined>(undefined);
  const onCompleteRef = useRef(onComplete);
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

  const completeCurrent = useCallback(
    (abandoned: boolean): ContinuousCopyResult | undefined => {
      const playback = playbackRef.current;
      if (!playback || completedRef.current) return undefined;
      completedRef.current = true;
      generationRef.current += 1;
      clearTimers();
      const durationCompleted = abandoned
        ? Math.min(
            playback.durationMs,
            Math.max(0, performance.now() - startedAtRef.current),
          )
        : playback.durationMs;
      const completed = onCompleteRef.current(
        textRef.current,
        durationCompleted,
        abandoned,
      );
      playbackRef.current = undefined;
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

  const start = useCallback(
    (playback: ContinuousCopyPlayback) => {
      clearTimers();
      const generation = ++generationRef.current;
      playbackRef.current = playback;
      completedRef.current = false;
      textRef.current = "";
      startedAtRef.current = performance.now();
      setTextState("");
      setResult(undefined);
      setRemainingMs(playback.durationMs);
      setTotalMs(playback.durationMs);
      setStage("playing");

      intervalRef.current = window.setInterval(() => {
        if (generation !== generationRef.current) return;
        const elapsed = performance.now() - startedAtRef.current;
        setRemainingMs(Math.max(0, playback.durationMs - elapsed));
      }, TIMER_INTERVAL_MS);

      void audio.playSchedule(playback.schedule, { toneHz }).then(() => {
        if (generation !== generationRef.current) return;
        if (intervalRef.current !== undefined) {
          window.clearInterval(intervalRef.current);
          intervalRef.current = undefined;
        }
        setRemainingMs(0);
        setStage("finishing");
        graceRef.current = window.setTimeout(
          () => completeCurrent(false),
          CONTINUOUS_COPY_GRACE_MS,
        );
      });
    },
    [audio, toneHz, clearTimers, completeCurrent],
  );

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
    completedRef.current = false;
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
    setText,
    finish,
    abandon,
    reset,
  };
}
