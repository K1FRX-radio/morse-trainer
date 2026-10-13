import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_CURRICULUM_CONFIG } from "../../content/curriculum-data.ts";
import { createInitialState } from "../../core/curriculum.ts";
import { DEFAULT_SETTINGS } from "../../core/settings.ts";
import type { LearnSessionPersistence } from "../../data/learn-persistence.ts";
import type { CharacterSpeedProficiencyRecord } from "../../data/repository.ts";
import { LearnAudioContext, type LearnAudio } from "../learn-audio-context.ts";
import { SettingsContext } from "../settings-context.ts";
import { TrainingDataContext } from "../training-data-context.ts";
import { useLearnSession } from "./useLearnSession.ts";

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function persistence(): LearnSessionPersistence {
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

function audio(): LearnAudio {
  return {
    unlock: vi.fn(async () => undefined),
    play: vi.fn(async () => undefined),
    playSchedule: vi.fn(async () => undefined),
    cancel: vi.fn(async () => undefined),
    suspend: vi.fn(async () => undefined),
    cancelAndSuspend: vi.fn(async () => undefined),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("useLearnSession speed-aware query races", () => {
  it("ignores stale start work when an older proficiency query rejects", async () => {
    const curriculum = createInitialState(DEFAULT_CURRICULUM_CONFIG);
    const firstQuery = deferred<CharacterSpeedProficiencyRecord[]>();
    const listCharacterSpeedProficiency = vi
      .fn()
      .mockImplementationOnce(() => firstQuery.promise)
      .mockResolvedValueOnce([]);
    const startLearnSessionPersistence = vi.fn(async () => persistence());

    function Wrapper({ children }: { children: ReactNode }) {
      return (
        <SettingsContext.Provider
          value={{
            settings: DEFAULT_SETTINGS,
            update: vi.fn(),
            outputDeviceId: "",
            setOutputDeviceId: vi.fn(),
          }}
        >
          <LearnAudioContext.Provider value={audio()}>
            <TrainingDataContext.Provider
              value={{
                loadCurriculum: () => structuredClone(curriculum),
                saveCurriculum: vi.fn(),
                reconcileCurriculum: vi.fn(async () =>
                  structuredClone(curriculum),
                ),
                loadIntroductions: vi.fn(() => []),
                saveIntroductions: vi.fn(),
                startLearnSessionPersistence,
                startPracticeSessionPersistence: vi.fn(async () => {
                  throw new Error("practice persistence is not used here");
                }),
                getRetryClassification: vi.fn(async () => ({
                  consecutiveAccuracyMisses: 0,
                  shouldSuggestSpacing: false,
                })),
                listDailyProjections: vi.fn(async () => []),
                listCharacterProjections: vi.fn(async () => []),
                listCharacterSpeedProficiency,
                listConfusionProjections: vi.fn(async () => []),
              }}
            >
              {children}
            </TrainingDataContext.Provider>
          </LearnAudioContext.Provider>
        </SettingsContext.Provider>
      );
    }

    const hook = renderHook(() => useLearnSession(), { wrapper: Wrapper });

    await act(async () => {
      hook.result.current.actions.begin();
    });

    await waitFor(() => {
      expect(listCharacterSpeedProficiency).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      hook.result.current.actions.begin();
    });

    firstQuery.reject(new Error("projection read failed"));

    await waitFor(() => {
      expect(listCharacterSpeedProficiency).toHaveBeenCalledTimes(2);
      expect(startLearnSessionPersistence).toHaveBeenCalledTimes(1);
    });

    expect(listCharacterSpeedProficiency).toHaveBeenNthCalledWith(1, {
      charWpmBand: 20,
      characters: ["K", "M"],
      limit: 2,
    });
  });
});
