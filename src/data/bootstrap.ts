import { DEFAULT_CURRICULUM_CONFIG } from "../content/curriculum-data.ts";
import {
  createInitialState,
  type CurriculumState,
} from "../core/curriculum.ts";
import {
  DEFAULT_SETTINGS,
  normalizeSettings,
  type PracticeSettings,
} from "../core/settings.ts";
import { TrainerDatabase, type TrainerDatabaseOptions } from "./indexeddb.ts";
import {
  migrateLegacyStorage,
  type LegacyMigrationRepository,
  type LegacyStorage,
} from "./legacy-migration.ts";
import type {
  CurriculumStateRecord,
  IntroductionsRecord,
  PortableSettingsRecord,
} from "./models.ts";
import {
  DexieTrainingRepository,
  type TrainingDataRepository,
} from "./repository.ts";

type BootstrapRepository = LegacyMigrationRepository & {
  open(): Promise<unknown>;
  getPortableSettings(): Promise<PortableSettingsRecord | undefined>;
  savePortableSettings(
    settings: PracticeSettings,
  ): Promise<PortableSettingsRecord>;
  getCurriculumState(): Promise<CurriculumStateRecord | undefined>;
  saveCurriculumState(state: CurriculumState): Promise<CurriculumStateRecord>;
  getIntroductions(): Promise<IntroductionsRecord | undefined>;
  saveIntroductions(characters: string[]): Promise<IntroductionsRecord>;
  recoverInterruptedSessions(): Promise<unknown[]>;
};

export type TrainingDataBootstrap = {
  repository: TrainingDataRepository;
  settings: PracticeSettings;
  curriculum: CurriculumState;
  introductions: string[];
  recoveredSessionCount: number;
};

export type TrainingDataBootstrapOptions = {
  databaseOptions?: TrainerDatabaseOptions;
};

type BootstrapSnapshot = Omit<TrainingDataBootstrap, "repository">;

function settingsEqual(
  left: PracticeSettings,
  right: PracticeSettings,
): boolean {
  return (
    left.charWpm === right.charWpm &&
    left.effectiveWpm === right.effectiveWpm &&
    left.toneHz === right.toneHz &&
    left.volume === right.volume &&
    left.noiseLevel === right.noiseLevel &&
    left.pacing === right.pacing &&
    left.continuousCopyDurationMs === right.continuousCopyDurationMs &&
    left.speedSuggestionAfterAttempts === right.speedSuggestionAfterAttempts
  );
}

export function curriculumState(
  record: CurriculumStateRecord,
): CurriculumState {
  return {
    config: {
      order: record.order,
      startCount: record.startCount,
      windowSize: record.windowSize,
      minNewCharObservations: record.minNewCharObservations,
      reviewDecayAccuracy: record.reviewDecayAccuracy,
    },
    characters: record.characters,
  };
}

export async function bootstrapTrainingData(
  storage: LegacyStorage,
  repository: BootstrapRepository,
): Promise<BootstrapSnapshot> {
  await repository.open();
  await migrateLegacyStorage(storage, repository);
  const recovered = await repository.recoverInterruptedSessions();
  const storedSettings =
    (await repository.getPortableSettings()) ??
    (await repository.savePortableSettings(DEFAULT_SETTINGS));
  const canonicalSettings = normalizeSettings(storedSettings.value);
  const settingsRecord = settingsEqual(storedSettings.value, canonicalSettings)
    ? storedSettings
    : await repository.savePortableSettings(canonicalSettings);
  const curriculumRecord =
    (await repository.getCurriculumState()) ??
    (await repository.saveCurriculumState(
      createInitialState(DEFAULT_CURRICULUM_CONFIG),
    ));
  const introductionsRecord =
    (await repository.getIntroductions()) ??
    (await repository.saveIntroductions([]));
  return {
    settings: settingsRecord.value,
    curriculum: curriculumState(curriculumRecord),
    introductions: introductionsRecord.characters,
    recoveredSessionCount: recovered.length,
  };
}

export async function createTrainingDataBootstrap(
  storage: LegacyStorage,
  options: TrainingDataBootstrapOptions = {},
): Promise<TrainingDataBootstrap> {
  const repository = new DexieTrainingRepository(
    new TrainerDatabase(options.databaseOptions),
  );
  try {
    const bootstrap = await bootstrapTrainingData(storage, repository);
    return { repository, ...bootstrap };
  } catch (error) {
    repository.close();
    throw error;
  }
}
