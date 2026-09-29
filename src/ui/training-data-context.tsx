import { useCallback, useMemo, useRef, type ReactNode } from "react";
import type { CurriculumState } from "../core/curriculum.ts";
import type { SpeedSuggestionAfterAttempts } from "../core/settings.ts";
import type {
  CharacterProjectionQuery,
  ConfusionProjectionQuery,
  DailyProjectionQuery,
} from "../data/repository.ts";
import type {
  RetryClassification,
  RetryCounterIdentity,
} from "../data/retry-history.ts";
import type {
  CharacterProjectionRecord,
  ConfusionProjectionRecord,
  DailyProjectionRecord,
} from "../data/models.ts";
import type {
  LearnPersistenceStart,
  LearnSessionPersistence,
} from "../data/learn-persistence.ts";
import type {
  PracticePersistenceStart,
  PracticeSessionPersistence,
} from "../data/practice-persistence.ts";
import { TrainingDataContext } from "./training-data-context.ts";

type TrainingDataProviderProps = {
  children: ReactNode;
  initialCurriculum: CurriculumState;
  initialIntroductions: string[];
  persistCurriculum?: (state: CurriculumState) => unknown;
  loadPersistedCurriculum: () => Promise<CurriculumState>;
  persistIntroductions?: (characters: string[]) => unknown;
  startLearnSessionPersistence: (
    options: LearnPersistenceStart,
  ) => Promise<LearnSessionPersistence>;
  startPracticeSessionPersistence: (
    options: PracticePersistenceStart,
  ) => Promise<PracticeSessionPersistence>;
  getRetryClassification: (
    identity: RetryCounterIdentity,
    threshold: SpeedSuggestionAfterAttempts,
  ) => Promise<RetryClassification>;
  listDailyProjections: (
    query: DailyProjectionQuery,
  ) => Promise<DailyProjectionRecord[]>;
  listCharacterProjections: (
    query: CharacterProjectionQuery,
  ) => Promise<CharacterProjectionRecord[]>;
  listConfusionProjections: (
    query: ConfusionProjectionQuery,
  ) => Promise<ConfusionProjectionRecord[]>;
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
  loadPersistedCurriculum,
  persistIntroductions,
  startLearnSessionPersistence,
  startPracticeSessionPersistence,
  getRetryClassification,
  listDailyProjections,
  listCharacterProjections,
  listConfusionProjections,
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
  const reconcileCurriculum = useCallback(async () => {
    const snapshot = structuredClone(await loadPersistedCurriculum());
    curriculum.current = snapshot;
    return structuredClone(snapshot);
  }, [loadPersistedCurriculum]);
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
      reconcileCurriculum,
      loadIntroductions,
      saveIntroductions,
      startLearnSessionPersistence,
      startPracticeSessionPersistence,
      getRetryClassification,
      listDailyProjections,
      listCharacterProjections,
      listConfusionProjections,
    }),
    [
      loadCurriculum,
      saveCurriculum,
      reconcileCurriculum,
      loadIntroductions,
      saveIntroductions,
      startLearnSessionPersistence,
      startPracticeSessionPersistence,
      getRetryClassification,
      listDailyProjections,
      listCharacterProjections,
      listConfusionProjections,
    ],
  );

  return (
    <TrainingDataContext.Provider value={value}>
      {children}
    </TrainingDataContext.Provider>
  );
}
