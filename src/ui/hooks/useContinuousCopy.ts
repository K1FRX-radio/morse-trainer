import { useCallback, useEffect, useRef, useState } from "react";
import type { ContinuousCopyResult } from "../../training/continuous-copy.ts";
import type { ContinuousCopyEvent } from "../../training/learn-session.ts";
import type { LearnAudio } from "../learn-audio-context.ts";

export const CONTINUOUS_COPY_GRACE_MS = 2000;
const TIMER_INTERVAL_MS = 100;

export type ContinuousCopyStage = "idle" | "playing" | "finishing" | "result";

type CompleteContinuousCopy = (
  typed: string,
  durationCompleted: number,
  abandoned: boolean,
) => ContinuousCopyResult;

type Options = {
  audio: LearnAudio;
  toneHz: number;
  onComplete: CompleteContinuousCopy;
};

export function useContinuousCopy({ audio, toneHz, onComplete }: Options) {
  const generationRef = useRef(0);
  const eventRef = useRef<ContinuousCopyEvent | undefined>(undefined);
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
      const event = eventRef.current;
      if (!event || completedRef.current) return undefined;
      completedRef.current = true;
      generationRef.current += 1;
      clearTimers();
      const durationCompleted = abandoned
        ? Math.min(
            event.plan.scheduledDurationMs,
            Math.max(0, performance.now() - startedAtRef.current),
          )
        : event.plan.scheduledDurationMs;
      const completed = onCompleteRef.current(
        textRef.current,
        durationCompleted,
        abandoned,
      );
      eventRef.current = undefined;
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
    (event: ContinuousCopyEvent) => {
      clearTimers();
      const generation = ++generationRef.current;
      eventRef.current = event;
      completedRef.current = false;
      textRef.current = "";
      startedAtRef.current = performance.now();
      setTextState("");
      setResult(undefined);
      setRemainingMs(event.plan.scheduledDurationMs);
      setTotalMs(event.plan.scheduledDurationMs);
      setStage("playing");

      intervalRef.current = window.setInterval(() => {
        if (generation !== generationRef.current) return;
        const elapsed = performance.now() - startedAtRef.current;
        setRemainingMs(Math.max(0, event.plan.scheduledDurationMs - elapsed));
      }, TIMER_INTERVAL_MS);

      void audio.playSchedule(event.plan.schedule, { toneHz }).then(() => {
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
    eventRef.current = undefined;
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
      eventRef.current = undefined;
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
