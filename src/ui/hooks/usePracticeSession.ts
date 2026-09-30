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

type PracticeUnmountStatus = "completed" | "interrupted";

type UsePracticeSessionOptions = {
  unmountStatus?: PracticeUnmountStatus | (() => PracticeUnmountStatus);
};

export function usePracticeSession(
  source: "copy-practice" | "send-practice" | "imported-text-rx",
  settings: PracticeSettings,
  options: UsePracticeSessionOptions = {},
) {
  const unmountStatus = options.unmountStatus;
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
  const createWorkQueue = useCallback(
    () =>
      new PracticeWorkQueue(() => {
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
      }),
    [source],
  );
  const workQueueRef = useRef<PracticeWorkQueue | undefined>(undefined);
  if (!workQueueRef.current) {
    workQueueRef.current = createWorkQueue();
  }

  const restartIfTerminal = useCallback(() => {
    const currentQueue = workQueueRef.current;
    if (!currentQueue?.isTerminal) {
      return;
    }
    timerRef.current = new PracticeSessionTimer();
    completedCardsRef.current = 0;
    workQueueRef.current = createWorkQueue();
  }, [createWorkQueue]);

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
    restartIfTerminal();
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
  }, [restartIfTerminal]);

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

  const finish = useCallback(async (): Promise<void> => {
    setStatus("pending");
    setError(undefined);
    try {
      await workQueueRef.current!.requestFinalization(snapshot(), "completed");
      if (mountedRef.current) setStatus("ready");
    } catch (cause) {
      if (mountedRef.current) {
        setStatus("error");
        setError(
          cause instanceof Error
            ? cause.message
            : "Practice session could not be finalized.",
        );
      }
      throw cause;
    }
  }, [snapshot]);

  const interrupt = useCallback(async (): Promise<void> => {
    setStatus("pending");
    setError(undefined);
    try {
      await workQueueRef.current!.requestFinalization(
        snapshot(),
        "interrupted",
      );
      if (mountedRef.current) setStatus("ready");
    } catch (cause) {
      if (mountedRef.current) {
        setStatus("error");
        setError(
          cause instanceof Error
            ? cause.message
            : "Practice session could not be interrupted.",
        );
      }
      throw cause;
    }
  }, [snapshot]);

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
      const status =
        typeof unmountStatus === "function"
          ? unmountStatus()
          : (unmountStatus ?? "completed");
      void workQueue.requestFinalization(snapshot(), status).catch(() => {
        if (workQueue.hasPendingAttempts) setBlocked(true);
      });
    };
  }, [setBlocked, snapshot, unmountStatus]);

  return {
    start,
    recordActivity,
    recordAttempt,
    finish,
    interrupt,
    retry,
    status,
    error,
  };
}
