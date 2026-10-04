import { act, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_CURRICULUM_CONFIG } from "../content/curriculum-data.ts";
import { createInitialState } from "../core/curriculum.ts";
import type {
  LearnPersistenceSnapshot,
  LearnSessionPersistence,
} from "../data/learn-persistence.ts";
import type {
  PracticePersistenceSnapshot,
  PracticeSessionPersistence,
} from "../data/practice-persistence.ts";
import type { TrainingDataContextValue } from "./training-data-context.ts";
import { useTrainingData } from "./training-data-context.ts";
import { TrainingDataProvider } from "./training-data-context.tsx";

function noOpLearnPersistence(): LearnSessionPersistence {
  return {
    recordAttempt: vi.fn(async () => undefined),
    finish: vi.fn(async () => undefined),
    interrupt: vi.fn(async () => undefined),
    acceptAdvancement: vi.fn(async () =>
      createInitialState(DEFAULT_CURRICULUM_CONFIG),
    ),
    retry: vi.fn(async () => undefined),
  };
}

function noOpPracticePersistence(): PracticeSessionPersistence {
  return {
    recordAttempt: vi.fn(async () => undefined),
    finish: vi.fn(async () => undefined),
    interrupt: vi.fn(async () => undefined),
    retry: vi.fn(async () => undefined),
  };
}

class PrototypeLearnPersistence implements LearnSessionPersistence {
  readonly recordAttemptSpy = vi.fn(async (...args: unknown[]) => {
    void args;
  });
  readonly finishSpy = vi.fn(async (...args: unknown[]) => {
    void args;
  });
  readonly interruptSpy = vi.fn(async (...args: unknown[]) => {
    void args;
  });
  readonly acceptAdvancementSpy = vi.fn(async (...args: unknown[]) => {
    void args;
    return createInitialState(DEFAULT_CURRICULUM_CONFIG);
  });
  readonly retrySpy = vi.fn(async (...args: unknown[]) => {
    void args;
  });

  async recordAttempt(
    ...args: Parameters<LearnSessionPersistence["recordAttempt"]>
  ) {
    await this.recordAttemptSpy(...args);
  }

  async finish(...args: Parameters<LearnSessionPersistence["finish"]>) {
    await this.finishSpy(...args);
  }

  async interrupt(...args: Parameters<LearnSessionPersistence["interrupt"]>) {
    await this.interruptSpy(...args);
  }

  async acceptAdvancement(
    ...args: Parameters<LearnSessionPersistence["acceptAdvancement"]>
  ) {
    return this.acceptAdvancementSpy(...args);
  }

  async retry() {
    await this.retrySpy();
  }
}

class PrototypePracticePersistence implements PracticeSessionPersistence {
  readonly recordAttemptSpy = vi.fn(async (...args: unknown[]) => {
    void args;
  });
  readonly finishSpy = vi.fn(async (...args: unknown[]) => {
    void args;
  });
  readonly interruptSpy = vi.fn(async (...args: unknown[]) => {
    void args;
  });
  readonly retrySpy = vi.fn(async (...args: unknown[]) => {
    void args;
  });

  async recordAttempt(
    ...args: Parameters<PracticeSessionPersistence["recordAttempt"]>
  ) {
    await this.recordAttemptSpy(...args);
  }

  async finish(...args: Parameters<PracticeSessionPersistence["finish"]>) {
    await this.finishSpy(...args);
  }

  async interrupt(
    ...args: Parameters<PracticeSessionPersistence["interrupt"]>
  ) {
    await this.interruptSpy(...args);
  }

  async retry() {
    await this.retrySpy();
  }
}

describe("TrainingDataProvider stats revision", () => {
  it("bumps stats revision after Learn/Practice commits", async () => {
    const curriculum = createInitialState(DEFAULT_CURRICULUM_CONFIG);
    const learn = noOpLearnPersistence();
    const practice = noOpPracticePersistence();
    let latest: TrainingDataContextValue | undefined;

    function Reader() {
      latest = useTrainingData();
      return null;
    }

    render(
      <TrainingDataProvider
        initialCurriculum={curriculum}
        initialIntroductions={[]}
        loadPersistedCurriculum={async () => structuredClone(curriculum)}
        startLearnSessionPersistence={async () => learn}
        startPracticeSessionPersistence={async () => practice}
        getRetryClassification={async () => ({
          consecutiveAccuracyMisses: 0,
          shouldSuggestSpacing: false,
        })}
        listDailyProjections={async () => []}
        listCharacterProjections={async () => []}
        listConfusionProjections={async () => []}
      >
        <Reader />
      </TrainingDataProvider>,
    );

    expect(latest?.statsRevision).toBe(0);

    const learnPersistence = await latest!.startLearnSessionPersistence({
      mode: "learn",
      activeCharacters: ["K", "M"],
      settings: { charWpm: 20, effectiveWpm: 12, toneHz: 600, noiseLevel: 0 },
    });

    await act(async () => {
      await learnPersistence.recordAttempt(
        {
          exerciseType: "copy-character",
          target: "K",
          response: "K",
          assisted: false,
          replayed: false,
          abandoned: false,
        },
        {
          activeMs: 60_000,
          activeDateBuckets: [],
          completedCards: 1,
          curriculum,
          introductions: [],
        } as LearnPersistenceSnapshot,
      );
    });

    expect(latest?.statsRevision).toBe(1);

    const practicePersistence = await latest!.startPracticeSessionPersistence({
      source: "copy-practice",
      activeCharacters: ["K", "M"],
      settings: { charWpm: 20, effectiveWpm: 12, toneHz: 600, noiseLevel: 0 },
    });

    await act(async () => {
      await practicePersistence.recordAttempt(
        {
          exerciseType: "copy-character",
          target: "K",
          response: "K",
          assisted: false,
          replayed: false,
        },
        {
          activeMs: 60_000,
          activeDateBuckets: [],
          completedCards: 1,
        } as PracticePersistenceSnapshot,
      );
    });

    expect(latest?.statsRevision).toBe(2);
  });

  it("bumps stats revision after replace import and reset", async () => {
    const curriculum = createInitialState(DEFAULT_CURRICULUM_CONFIG);
    let latest: TrainingDataContextValue | undefined;

    function Reader() {
      latest = useTrainingData();
      return null;
    }

    render(
      <TrainingDataProvider
        initialCurriculum={curriculum}
        initialIntroductions={[]}
        loadPersistedCurriculum={async () => structuredClone(curriculum)}
        startLearnSessionPersistence={async () => noOpLearnPersistence()}
        startPracticeSessionPersistence={async () => noOpPracticePersistence()}
        getRetryClassification={async () => ({
          consecutiveAccuracyMisses: 0,
          shouldSuggestSpacing: false,
        })}
        listDailyProjections={async () => []}
        listCharacterProjections={async () => []}
        listConfusionProjections={async () => []}
        replacePortableBackup={async () => "applied"}
        resetPortableData={async () => undefined}
      >
        <Reader />
      </TrainingDataProvider>,
    );

    expect(latest?.statsRevision).toBe(0);

    await act(async () => {
      await latest!.replacePortableBackup!("{}", {
        targetDatasetGeneration: "g",
        backupDigestHex: "d",
        operationKey: "k",
      });
    });

    expect(latest?.statsRevision).toBe(1);

    await act(async () => {
      await latest!.resetPortableData!();
    });

    expect(latest?.statsRevision).toBe(2);
  });

  it("preserves retry on wrapped class-based persistence instances", async () => {
    const curriculum = createInitialState(DEFAULT_CURRICULUM_CONFIG);
    const learn = new PrototypeLearnPersistence();
    const practice = new PrototypePracticePersistence();
    let latest: TrainingDataContextValue | undefined;

    function Reader() {
      latest = useTrainingData();
      return null;
    }

    render(
      <TrainingDataProvider
        initialCurriculum={curriculum}
        initialIntroductions={[]}
        loadPersistedCurriculum={async () => structuredClone(curriculum)}
        startLearnSessionPersistence={async () => learn}
        startPracticeSessionPersistence={async () => practice}
        getRetryClassification={async () => ({
          consecutiveAccuracyMisses: 0,
          shouldSuggestSpacing: false,
        })}
        listDailyProjections={async () => []}
        listCharacterProjections={async () => []}
        listConfusionProjections={async () => []}
      >
        <Reader />
      </TrainingDataProvider>,
    );

    const learnPersistence = await latest!.startLearnSessionPersistence({
      mode: "learn",
      activeCharacters: ["K"],
      settings: { charWpm: 20, effectiveWpm: 12, toneHz: 600, noiseLevel: 0 },
    });
    const practicePersistence = await latest!.startPracticeSessionPersistence({
      source: "copy-practice",
      activeCharacters: ["K"],
      settings: { charWpm: 20, effectiveWpm: 12, toneHz: 600, noiseLevel: 0 },
    });

    await act(async () => {
      await learnPersistence.retry();
      await practicePersistence.retry();
    });

    expect(learn.retrySpy).toHaveBeenCalledTimes(1);
    expect(practice.retrySpy).toHaveBeenCalledTimes(1);
  });
});
