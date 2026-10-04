import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import type { CurriculumState } from "../core/curriculum.ts";
import type { SpeedSuggestionAfterAttempts } from "../core/settings.ts";
import type {
  CharacterProjectionQuery,
  ConfusionProjectionQuery,
  DailyProjectionQuery,
  MilestoneQuery,
} from "../data/repository.ts";
import type {
  RetryClassification,
  RetryCounterIdentity,
} from "../data/retry-history.ts";
import type {
  CharacterProjectionRecord,
  ConfusionProjectionRecord,
  DailyProjectionRecord,
  MilestoneRecord,
} from "../data/models.ts";
import type {
  PortableBackupDocument,
  PortableBackupReplaceConfirmation,
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
  listMilestones?: (query: MilestoneQuery) => Promise<MilestoneRecord[]>;
  exportPortableBackup?: (
    appVersion: string,
  ) => Promise<PortableBackupDocument>;
  previewPortableBackup?: (rawJson: string) => Promise<PortableBackupPreview>;
  replacePortableBackup?: (
    rawJson: string,
    confirmation: PortableBackupReplaceConfirmation,
  ) => Promise<"applied" | "already-applied">;
  resetPortableData?: () => Promise<void>;
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
  listMilestones,
  exportPortableBackup,
  previewPortableBackup,
  replacePortableBackup,
  resetPortableData,
}: TrainingDataProviderProps) {
  const curriculum = useRef(structuredClone(initialCurriculum));
  const introductions = useRef([...initialIntroductions]);
  const [statsRevision, setStatsRevision] = useState(0);

  const bumpStatsRevision = useCallback(() => {
    setStatsRevision((current) => current + 1);
  }, []);

  const startLearnSessionPersistenceWithRefresh = useCallback(
    async (
      options: LearnPersistenceStart,
    ): Promise<LearnSessionPersistence> => {
      const persistence = await startLearnSessionPersistence(options);
      return {
        ...persistence,
        async recordAttempt(evidence, snapshot) {
          await persistence.recordAttempt(evidence, snapshot);
          bumpStatsRevision();
        },
        async finish(snapshot) {
          await persistence.finish(snapshot);
          bumpStatsRevision();
        },
        async interrupt(snapshot) {
          await persistence.interrupt(snapshot);
          bumpStatsRevision();
        },
        async acceptAdvancement(acceptance) {
          const next = await persistence.acceptAdvancement(acceptance);
          bumpStatsRevision();
          return next;
        },
      };
    },
    [startLearnSessionPersistence, bumpStatsRevision],
  );

  const startPracticeSessionPersistenceWithRefresh = useCallback(
    async (
      options: PracticePersistenceStart,
    ): Promise<PracticeSessionPersistence> => {
      const persistence = await startPracticeSessionPersistence(options);
      return {
        ...persistence,
        async recordAttempt(evidence, snapshot) {
          await persistence.recordAttempt(evidence, snapshot);
          bumpStatsRevision();
        },
        async finish(snapshot) {
          await persistence.finish(snapshot);
          bumpStatsRevision();
        },
        async interrupt(snapshot) {
          await persistence.interrupt(snapshot);
          bumpStatsRevision();
        },
      };
    },
    [startPracticeSessionPersistence, bumpStatsRevision],
  );

  const replacePortableBackupWithRefresh = useCallback(
    async (
      rawJson: string,
      confirmation: PortableBackupReplaceConfirmation,
    ): Promise<"applied" | "already-applied"> => {
      if (!replacePortableBackup) {
        throw new Error("replacePortableBackup is unavailable");
      }
      const result = await replacePortableBackup(rawJson, confirmation);
      if (result === "applied") bumpStatsRevision();
      return result;
    },
    [replacePortableBackup, bumpStatsRevision],
  );

  const resetPortableDataWithRefresh = useCallback(async (): Promise<void> => {
    if (!resetPortableData) {
      throw new Error("resetPortableData is unavailable");
    }
    await resetPortableData();
    bumpStatsRevision();
  }, [resetPortableData, bumpStatsRevision]);

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
      statsRevision,
      loadCurriculum,
      saveCurriculum,
      reconcileCurriculum,
      loadIntroductions,
      saveIntroductions,
      startLearnSessionPersistence: startLearnSessionPersistenceWithRefresh,
      startPracticeSessionPersistence:
        startPracticeSessionPersistenceWithRefresh,
      getRetryClassification,
      listDailyProjections,
      listCharacterProjections,
      listConfusionProjections,
      ...(listMilestones ? { listMilestones } : {}),
      ...(exportPortableBackup ? { exportPortableBackup } : {}),
      ...(previewPortableBackup ? { previewPortableBackup } : {}),
      ...(replacePortableBackup
        ? { replacePortableBackup: replacePortableBackupWithRefresh }
        : {}),
      ...(resetPortableData
        ? { resetPortableData: resetPortableDataWithRefresh }
        : {}),
    }),
    [
      statsRevision,
      loadCurriculum,
      saveCurriculum,
      reconcileCurriculum,
      loadIntroductions,
      saveIntroductions,
      startLearnSessionPersistenceWithRefresh,
      startPracticeSessionPersistenceWithRefresh,
      getRetryClassification,
      listDailyProjections,
      listCharacterProjections,
      listConfusionProjections,
      listMilestones,
      exportPortableBackup,
      previewPortableBackup,
      replacePortableBackup,
      replacePortableBackupWithRefresh,
      resetPortableData,
      resetPortableDataWithRefresh,
    ],
  );

  return (
    <TrainingDataContext.Provider value={value}>
      {children}
    </TrainingDataContext.Provider>
  );
}
