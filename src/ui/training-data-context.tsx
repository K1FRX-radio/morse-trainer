import { useCallback, useMemo, useRef, type ReactNode } from "react";
import type { CurriculumState } from "../core/curriculum.ts";
import { TrainingDataContext } from "./training-data-context.ts";

type TrainingDataProviderProps = {
  children: ReactNode;
  initialCurriculum: CurriculumState;
  initialIntroductions: string[];
  persistCurriculum?: (state: CurriculumState) => unknown;
  persistIntroductions?: (characters: string[]) => unknown;
};

function persistBestEffort(operation: () => unknown): void {
  try {
    void Promise.resolve(operation()).catch(() => undefined);
  } catch {
    // Training remains usable in memory if persistence is unavailable.
  }
}

export function TrainingDataProvider({
  children,
  initialCurriculum,
  initialIntroductions,
  persistCurriculum,
  persistIntroductions,
}: TrainingDataProviderProps) {
  const curriculum = useRef(structuredClone(initialCurriculum));
  const introductions = useRef([...initialIntroductions]);

  const loadCurriculum = useCallback(
    () => structuredClone(curriculum.current),
    [],
  );
  const saveCurriculum = useCallback(
    (state: CurriculumState) => {
      const snapshot = structuredClone(state);
      curriculum.current = snapshot;
      if (persistCurriculum) {
        persistBestEffort(() => persistCurriculum(structuredClone(snapshot)));
      }
    },
    [persistCurriculum],
  );
  const loadIntroductions = useCallback(() => [...introductions.current], []);
  const saveIntroductions = useCallback(
    (characters: string[]) => {
      const snapshot = [...new Set(characters)];
      introductions.current = snapshot;
      if (persistIntroductions) {
        persistBestEffort(() => persistIntroductions([...snapshot]));
      }
    },
    [persistIntroductions],
  );

  const value = useMemo(
    () => ({
      loadCurriculum,
      saveCurriculum,
      loadIntroductions,
      saveIntroductions,
    }),
    [loadCurriculum, saveCurriculum, loadIntroductions, saveIntroductions],
  );

  return (
    <TrainingDataContext.Provider value={value}>
      {children}
    </TrainingDataContext.Provider>
  );
}
