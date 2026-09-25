import { createContext, useContext } from "react";
import type { CurriculumState } from "../core/curriculum.ts";
import type { SpeedSuggestionAfterAttempts } from "../core/settings.ts";
import type {
  RetryClassification,
  RetryCounterIdentity,
} from "../data/retry-history.ts";

export type TrainingDataContextValue = {
  loadCurriculum: () => CurriculumState;
  saveCurriculum: (state: CurriculumState) => void;
  loadIntroductions: () => string[];
  saveIntroductions: (characters: string[]) => void;
  getRetryClassification: (
    identity: RetryCounterIdentity,
    threshold: SpeedSuggestionAfterAttempts,
  ) => Promise<RetryClassification>;
};

export const TrainingDataContext = createContext<
  TrainingDataContextValue | undefined
>(undefined);

export function useTrainingData(): TrainingDataContextValue {
  const value = useContext(TrainingDataContext);
  if (!value) {
    throw new Error(
      "useTrainingData must be used within a TrainingDataProvider",
    );
  }
  return value;
}
