import { createContext, useContext } from "react";
import type { CurriculumState } from "../core/curriculum.ts";

export type TrainingDataContextValue = {
  loadCurriculum: () => CurriculumState;
  saveCurriculum: (state: CurriculumState) => void;
  loadIntroductions: () => string[];
  saveIntroductions: (characters: string[]) => void;
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
