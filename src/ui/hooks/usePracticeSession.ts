import { useCallback, useEffect, useRef, useState } from "react";
import { unlockedCharacters } from "../../core/curriculum.ts";
import type { PracticeSettings } from "../../core/settings.ts";
import type {
  PracticeAttemptEvidence,
  PracticePersistenceSnapshot,
  PracticeSessionPersistence,
} from "../../data/practice-persistence.ts";
import {
  currentActiveTimePoint,
  PracticeSessionTimer,
} from "../../training/practice-session.ts";
import { useNavigationGuard } from "../navigation-guard-context.ts";
import { useTrainingData } from "../training-data-context.ts";
import { PracticeWorkQueue } from "./practice-work-queue.ts";

export type PracticePersistenceStatus = "ready" | "pending" | "error";

export function usePracticeSession(
  source: "copy-practice" | "send-practice",
  settings: PracticeSettings,
) {
  const { loadCurriculum, startPracticeSessionPersistence } = useTrainingData();
  const { setBlocked } = useNavigationGuard();
  const timerRef = useRef(new PracticeSessionTimer());
  const completedCardsRef = useRef(0);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const dependenciesRef = useRef({
    loadCurriculum,
    startPracticeSessionPersistence,
  });
  dependenciesRef.current = { loadCurriculum, startPracticeSessionPersistence };
  const workQueueRef = useRef<PracticeWorkQueue | undefined>(undefined);
  if (!workQueueRef.current) {
    workQueueRef.current = new PracticeWorkQueue(() => {
      const dependencies = dependenciesRef.current;
      const currentSettings = settingsRef.current;
      return dependencies.startPracticeSessionPersistence({
        source,
        activeCharacters: unlockedCharacters(dependencies.loadCurriculum()),
        settings: {
          charWpm: currentSettings.charWpm,
          effectiveWpm: currentSettings.effectiveWpm,
          toneHz: currentSettings.toneHz,
          noiseLevel: currentSettings.noiseLevel,
        },
      });
    });
  }
  const mountedRef = useRef(true);
  const [status, setStatus] = useState<PracticePersistenceStatus>("ready");
  const [error, setError] = useState<string | undefined>(undefined);

  const snapshot = useCallback((): PracticePersistenceSnapshot => {
    const activeTime = timerRef.current.snapshot();
    return {
      ...activeTime,
      completedCards: completedCardsRef.current,
    };
  }, []);

  const start = useCallback(async (): Promise<PracticeSessionPersistence> => {
    timerRef.current.recordActivity(currentActiveTimePoint());
    setStatus("pending");
    setError(undefined);
    try {
      const persistence = await workQueueRef.current!.start();
      if (mountedRef.current) setStatus("ready");
      return persistence;
    } catch (cause) {
      if (mountedRef.current) {
        setStatus("error");
        setError(
          cause instanceof Error
            ? cause.message
            : "Practice session could not be saved.",
        );
      }
      throw cause;
    }
  }, []);

  const recordActivity = useCallback(() => {
    timerRef.current.recordActivity(currentActiveTimePoint());
  }, []);

  const recordAttempt = useCallback(
    async (evidence: PracticeAttemptEvidence): Promise<void> => {
      completedCardsRef.current += 1;
      if (mountedRef.current) {
        setStatus("pending");
        setError(undefined);
      }
      try {
        await workQueueRef.current!.enqueueAttempt(evidence, snapshot());
        setBlocked(false);
        if (mountedRef.current) setStatus("ready");
      } catch (cause) {
        if (workQueueRef.current!.hasPendingAttempts) setBlocked(true);
        if (mountedRef.current) {
          setStatus("error");
          setError(
            cause instanceof Error
              ? cause.message
              : "Practice attempt could not be saved.",
          );
        }
        throw cause;
      }
    },
    [setBlocked, snapshot],
  );

  const retry = useCallback(async (): Promise<void> => {
    setStatus("pending");
    setError(undefined);
    try {
      await workQueueRef.current!.retry();
      setBlocked(false);
      if (mountedRef.current) setStatus("ready");
    } catch (cause) {
      if (workQueueRef.current!.hasPendingAttempts) setBlocked(true);
      if (mountedRef.current) {
        setStatus("error");
        setError(cause instanceof Error ? cause.message : "Save retry failed.");
      }
    }
  }, [setBlocked]);

  useEffect(() => {
    const timer = timerRef.current;
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        timer.pause(currentActiveTimePoint());
      } else {
        timer.resume(currentActiveTimePoint());
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  useEffect(() => {
    const timer = timerRef.current;
    const workQueue = workQueueRef.current!;
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (!workQueue.hasStarted) return;
      timer.finish(currentActiveTimePoint());
      void workQueue.requestFinalization(snapshot()).catch(() => {
        if (workQueue.hasPendingAttempts) setBlocked(true);
      });
    };
  }, [setBlocked, snapshot]);

  return {
    start,
    recordActivity,
    recordAttempt,
    retry,
    status,
    error,
  };
}
