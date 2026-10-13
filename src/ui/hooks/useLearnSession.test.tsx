import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_CURRICULUM_CONFIG } from "../../content/curriculum-data.ts";
import { createInitialState } from "../../core/curriculum.ts";
import { DEFAULT_SETTINGS } from "../../core/settings.ts";
import type { LearnSessionPersistence } from "../../data/learn-persistence.ts";
import type { CharacterSpeedProficiencyRecord } from "../../data/repository.ts";
import { LearnAudioContext, type LearnAudio } from "../learn-audio-context.ts";
import { ReloadSafetyContext } from "../reload-safety-context.ts";
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

type ReloadSafetyStore = {
  blocked: boolean;
  seq: number;
  tokens: Map<string, Set<number>>;
};

function createReloadSafetyStore(): ReloadSafetyStore {
  return {
    blocked: false,
    seq: 1,
    tokens: new Map(),
  };
}

function buildReloadSafetyContextValue(store: ReloadSafetyStore) {
  const updateBlocked = () => {
    let activeLeaseCount = 0;
    for (const tokens of store.tokens.values()) {
      activeLeaseCount += tokens.size;
    }
    store.blocked = activeLeaseCount > 0;
  };

  return {
    blocked: store.blocked,
    setBlocked: (blocked: boolean) => {
      if (!blocked) {
        store.tokens.delete("legacy");
      } else {
        const token = store.seq++;
        const tokens = store.tokens.get("legacy") ?? new Set<number>();
        tokens.add(token);
        store.tokens.set("legacy", tokens);
      }
      updateBlocked();
    },
    acquireBlock: (source: string) => {
      const token = store.seq++;
      const tokens = store.tokens.get(source) ?? new Set<number>();
      tokens.add(token);
      store.tokens.set(source, tokens);
      updateBlocked();
      return token;
    },
    releaseBlock: (source: string, token: number) => {
      const tokens = store.tokens.get(source);
      if (!tokens || !tokens.has(token)) {
        return;
      }
      tokens.delete(token);
      if (tokens.size === 0) {
        store.tokens.delete(source);
      }
      updateBlocked();
    },
  };
}

describe("useLearnSession speed-aware query races", () => {
  it("ignores stale start work when an older proficiency query rejects", async () => {
    const curriculum = createInitialState(DEFAULT_CURRICULUM_CONFIG);
    const firstQuery = deferred<CharacterSpeedProficiencyRecord[]>();
    const listCharacterSpeedProficiency = vi
      .fn()
      .mockImplementationOnce(() => firstQuery.promise)
      .mockResolvedValueOnce([]);
    const startLearnSessionPersistence = vi.fn(async () => persistence());
    const reloadSafety = createReloadSafetyStore();
    const reloadSafetyContextValue =
      buildReloadSafetyContextValue(reloadSafety);

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
          <ReloadSafetyContext.Provider value={reloadSafetyContextValue}>
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
          </ReloadSafetyContext.Provider>
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

  it("keeps reload safety blocked until the older pending interrupt settles when newer learn session finalizes first", async () => {
    const curriculum = createInitialState(DEFAULT_CURRICULUM_CONFIG);
    const firstInterrupt = deferred<void>();
    const firstPersistence: LearnSessionPersistence = {
      recordAttempt: vi.fn(async () => undefined),
      finish: vi.fn(async () => undefined),
      interrupt: vi.fn(() => firstInterrupt.promise),
      acceptAdvancement: vi.fn(async () =>
        createInitialState(DEFAULT_CURRICULUM_CONFIG),
      ),
      retry: vi.fn(async () => undefined),
    };
    const secondPersistence = persistence();
    let startCount = 0;
    const startLearnSessionPersistence = vi.fn(async () => {
      startCount += 1;
      return startCount === 1 ? firstPersistence : secondPersistence;
    });
    const reloadSafety = createReloadSafetyStore();

    function wrapperFactory({ children }: { children: ReactNode }) {
      const reloadSafetyContextValue =
        buildReloadSafetyContextValue(reloadSafety);
      return (
        <SettingsContext.Provider
          value={{
            settings: DEFAULT_SETTINGS,
            update: vi.fn(),
            outputDeviceId: "",
            setOutputDeviceId: vi.fn(),
          }}
        >
          <ReloadSafetyContext.Provider value={reloadSafetyContextValue}>
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
                  listCharacterSpeedProficiency: vi.fn(async () => []),
                  listConfusionProjections: vi.fn(async () => []),
                }}
              >
                {children}
              </TrainingDataContext.Provider>
            </LearnAudioContext.Provider>
          </ReloadSafetyContext.Provider>
        </SettingsContext.Provider>
      );
    }

    const firstHook = renderHook(() => useLearnSession(), {
      wrapper: wrapperFactory,
    });

    await act(async () => {
      firstHook.result.current.actions.begin();
    });

    await waitFor(() => {
      expect(firstHook.result.current.phase).toBe("exercise");
    });
    expect(reloadSafety.blocked).toBe(true);

    firstHook.unmount();
    await waitFor(() => {
      expect(firstPersistence.interrupt).toHaveBeenCalledOnce();
    });

    const secondHook = renderHook(() => useLearnSession(), {
      wrapper: wrapperFactory,
    });

    await act(async () => {
      secondHook.result.current.actions.begin();
    });

    await waitFor(() => {
      expect(secondHook.result.current.phase).toBe("exercise");
    });

    await act(async () => {
      secondHook.result.current.actions.endSession();
    });

    await waitFor(() => {
      expect(secondPersistence.finish).toHaveBeenCalledOnce();
    });

    expect(reloadSafety.blocked).toBe(true);

    firstInterrupt.resolve();
    await waitFor(() => {
      expect(reloadSafety.blocked).toBe(false);
    });
    secondHook.unmount();
  });
});
