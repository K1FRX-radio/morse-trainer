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
import { useTrainingData } from "../training-data-context.ts";

export type PracticePersistenceStatus = "ready" | "pending" | "error";

export function usePracticeSession(
  source: "copy-practice" | "send-practice",
  settings: PracticeSettings,
) {
  const { loadCurriculum, startPracticeSessionPersistence } = useTrainingData();
  const timerRef = useRef(new PracticeSessionTimer());
  const persistenceRef = useRef<PracticeSessionPersistence | undefined>(
    undefined,
  );
  const startPromiseRef = useRef<
    Promise<PracticeSessionPersistence> | undefined
  >(undefined);
  const completedCardsRef = useRef(0);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const mountedRef = useRef(true);
  const pendingWritesRef = useRef(0);
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
    if (persistenceRef.current) return persistenceRef.current;
    if (startPromiseRef.current) return startPromiseRef.current;

    const currentSettings = settingsRef.current;
    const promise = startPracticeSessionPersistence({
      source,
      activeCharacters: unlockedCharacters(loadCurriculum()),
      settings: {
        charWpm: currentSettings.charWpm,
        effectiveWpm: currentSettings.effectiveWpm,
        toneHz: currentSettings.toneHz,
        noiseLevel: currentSettings.noiseLevel,
      },
    });
    startPromiseRef.current = promise;
    setStatus("pending");
    setError(undefined);
    try {
      const persistence = await promise;
      persistenceRef.current = persistence;
      if (mountedRef.current) {
        setStatus("ready");
      } else {
        timerRef.current.finish(currentActiveTimePoint());
        await persistence.finish(snapshot());
      }
      return persistence;
    } catch (cause) {
      startPromiseRef.current = undefined;
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
  }, [loadCurriculum, snapshot, source, startPracticeSessionPersistence]);

  const recordActivity = useCallback(() => {
    timerRef.current.recordActivity(currentActiveTimePoint());
  }, []);

  const recordAttempt = useCallback(
    async (evidence: PracticeAttemptEvidence): Promise<void> => {
      const persistence = await start();
      completedCardsRef.current += 1;
      pendingWritesRef.current += 1;
      if (mountedRef.current) {
        setStatus("pending");
        setError(undefined);
      }
      let failed = false;
      try {
        await persistence.recordAttempt(evidence, snapshot());
      } catch (cause) {
        failed = true;
        if (mountedRef.current) {
          setStatus("error");
          setError(
            cause instanceof Error
              ? cause.message
              : "Practice attempt could not be saved.",
          );
        }
        throw cause;
      } finally {
        pendingWritesRef.current -= 1;
        if (mountedRef.current && pendingWritesRef.current === 0 && !failed) {
          setStatus("ready");
        }
      }
    },
    [snapshot, start],
  );

  const retry = useCallback(async (): Promise<void> => {
    const persistence = persistenceRef.current;
    if (!persistence) {
      await start();
      return;
    }
    setStatus("pending");
    setError(undefined);
    try {
      await persistence.retry();
      if (mountedRef.current) setStatus("ready");
    } catch (cause) {
      if (mountedRef.current) {
        setStatus("error");
        setError(cause instanceof Error ? cause.message : "Save retry failed.");
      }
    }
  }, [start]);

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
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      const persistence = persistenceRef.current;
      if (!persistence) return;
      timer.finish(currentActiveTimePoint());
      void persistence.finish(snapshot());
    };
  }, [snapshot]);

  return {
    start,
    recordActivity,
    recordAttempt,
    retry,
    status,
    error,
  };
}
