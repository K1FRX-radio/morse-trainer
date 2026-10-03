import { createContext, useContext } from "react";
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
  PortableBackupDocument,
  PortableBackupPreview,
} from "../data/backup.ts";
import type {
  LearnPersistenceStart,
  LearnSessionPersistence,
} from "../data/learn-persistence.ts";
import type {
  PracticePersistenceStart,
  PracticeSessionPersistence,
} from "../data/practice-persistence.ts";

export type TrainingDataContextValue = {
  loadCurriculum: () => CurriculumState;
  saveCurriculum: (state: CurriculumState) => void;
  reconcileCurriculum: () => Promise<CurriculumState>;
  loadIntroductions: () => string[];
  saveIntroductions: (characters: string[]) => void;
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
  exportPortableBackup?: (
    appVersion: string,
  ) => Promise<PortableBackupDocument>;
  previewPortableBackup?: (rawJson: string) => Promise<PortableBackupPreview>;
  replacePortableBackup?: (rawJson: string) => Promise<void>;
  resetPortableData?: () => Promise<void>;
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
