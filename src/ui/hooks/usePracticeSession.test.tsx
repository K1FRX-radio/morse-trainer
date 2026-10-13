import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type ReactNode } from "react";
import { DEFAULT_CURRICULUM_CONFIG } from "../../content/curriculum-data.ts";
import { createInitialState } from "../../core/curriculum.ts";
import { DEFAULT_SETTINGS } from "../../core/settings.ts";
import type { PracticeSessionPersistence } from "../../data/practice-persistence.ts";
import { PracticeSessionTimer } from "../../training/practice-session.ts";
import { NavigationGuardContext } from "../navigation-guard-context.ts";
import { ReloadSafetyContext } from "../reload-safety-context.ts";
import { TrainingDataContext } from "../training-data-context.ts";
import { usePracticeSession } from "./usePracticeSession.ts";

function persistence(): PracticeSessionPersistence {
  return {
    recordAttempt: vi.fn(() => Promise.resolve()),
    finish: vi.fn(() => Promise.resolve()),
    interrupt: vi.fn(() => Promise.resolve()),
    retry: vi.fn(() => Promise.resolve()),
  };
}

function setVisibilityState(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: state,
  });
}

type ReloadSafetyStore = {
  blocked: boolean;
  seq: number;
  tokens: Map<string, Set<number>>;
};

function createReloadSafetyStore(): ReloadSafetyStore {
  return {
    blocked: false,
    seq: 1,
    tokens: new Map<string, Set<number>>(),
  };
}

function renderUsePracticeSession(
  sessions: PracticeSessionPersistence[],
  reloadSafety = createReloadSafetyStore(),
) {
  const curriculum = createInitialState(DEFAULT_CURRICULUM_CONFIG);
  const setBlocked = vi.fn();
  let index = 0;
  const startPracticeSessionPersistence = vi.fn(() =>
    Promise.resolve(sessions[Math.min(index++, sessions.length - 1)]!),
  );

  const updateReloadBlocked = () => {
    let activeLeaseCount = 0;
    for (const tokens of reloadSafety.tokens.values()) {
      activeLeaseCount += tokens.size;
    }
    reloadSafety.blocked = activeLeaseCount > 0;
  };

  const acquireBlock = (source: string) => {
    const token = reloadSafety.seq++;
    const tokens = reloadSafety.tokens.get(source) ?? new Set<number>();
    tokens.add(token);
    reloadSafety.tokens.set(source, tokens);
    updateReloadBlocked();
    return token;
  };

  const releaseBlock = (source: string, token: number) => {
    const tokens = reloadSafety.tokens.get(source);
    if (!tokens || !tokens.has(token)) {
      return;
    }
    tokens.delete(token);
    if (tokens.size === 0) {
      reloadSafety.tokens.delete(source);
    }
    updateReloadBlocked();
  };

  const setReloadBlockedLegacy = (blocked: boolean) => {
    if (!blocked) {
      reloadSafety.tokens.delete("legacy");
      updateReloadBlocked();
      return;
    }
    const token = reloadSafety.seq++;
    const tokens = reloadSafety.tokens.get("legacy") ?? new Set<number>();
    tokens.add(token);
    reloadSafety.tokens.set("legacy", tokens);
    updateReloadBlocked();
  };

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <NavigationGuardContext.Provider value={{ blocked: false, setBlocked }}>
        <ReloadSafetyContext.Provider
          value={{
            blocked: reloadSafety.blocked,
            setBlocked: setReloadBlockedLegacy,
            acquireBlock,
            releaseBlock,
          }}
        >
          <TrainingDataContext.Provider
            value={{
              loadCurriculum: () => structuredClone(curriculum),
              saveCurriculum: vi.fn(),
              reconcileCurriculum: () => Promise.resolve(curriculum),
              loadIntroductions: () => [],
              saveIntroductions: vi.fn(),
              startLearnSessionPersistence: () =>
                Promise.reject(new Error("Learn persistence is not used here")),
              startPracticeSessionPersistence,
              getRetryClassification: () =>
                Promise.resolve({
                  consecutiveAccuracyMisses: 0,
                  shouldSuggestSpacing: false,
                }),
              listDailyProjections: () => Promise.resolve([]),
              listCharacterProjections: () => Promise.resolve([]),
              listCharacterSpeedProficiency: () => Promise.resolve([]),
              listConfusionProjections: () => Promise.resolve([]),
            }}
          >
            {children}
          </TrainingDataContext.Provider>
        </ReloadSafetyContext.Provider>
      </NavigationGuardContext.Provider>
    );
  }

  const hook = renderHook(
    () =>
      usePracticeSession(
        "imported-text-rx",
        { ...DEFAULT_SETTINGS },
        {
          unmountStatus: "interrupted",
        },
      ),
    { wrapper: Wrapper },
  );

  return {
    ...hook,
    startPracticeSessionPersistence,
    setBlocked,
    reloadSafety,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  setVisibilityState("visible");
});

describe("usePracticeSession", () => {
  it("applies visibility pause/resume to the current timer after restart", async () => {
    const pauseTimers: PracticeSessionTimer[] = [];
    const resumeTimers: PracticeSessionTimer[] = [];
    vi.spyOn(PracticeSessionTimer.prototype, "pause").mockImplementation(
      function mockPause(this: PracticeSessionTimer) {
        pauseTimers.push(this);
      },
    );
    vi.spyOn(PracticeSessionTimer.prototype, "resume").mockImplementation(
      function mockResume(this: PracticeSessionTimer) {
        resumeTimers.push(this);
      },
    );

    const first = persistence();
    const second = persistence();
    const hook = renderUsePracticeSession([first, second]);

    await act(async () => {
      await hook.result.current.start();
    });

    setVisibilityState("hidden");
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    setVisibilityState("visible");
    act(() => document.dispatchEvent(new Event("visibilitychange")));

    await act(async () => {
      await hook.result.current.finish();
    });
    await act(async () => {
      await hook.result.current.start();
    });

    setVisibilityState("hidden");
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    setVisibilityState("visible");
    act(() => document.dispatchEvent(new Event("visibilitychange")));

    expect(pauseTimers).toHaveLength(2);
    expect(resumeTimers).toHaveLength(2);

    const firstRunTimer = pauseTimers[0];
    const secondRunTimer = pauseTimers[1];

    expect(secondRunTimer).not.toBe(firstRunTimer);
    expect(resumeTimers[1]).toBe(secondRunTimer);
    expect(hook.startPracticeSessionPersistence).toHaveBeenCalledTimes(2);
  });

  it("keeps reload safety blocked until unmount finalization settles", async () => {
    let resolveInterrupt: (() => void) | undefined;
    const session: PracticeSessionPersistence = {
      recordAttempt: vi.fn(() => Promise.resolve()),
      finish: vi.fn(() => Promise.resolve()),
      interrupt: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            resolveInterrupt = resolve;
          }),
      ),
      retry: vi.fn(() => Promise.resolve()),
    };

    const hook = renderUsePracticeSession([session]);

    await act(async () => {
      await hook.result.current.start();
    });
    expect(hook.reloadSafety.blocked).toBe(true);

    hook.unmount();
    expect(hook.reloadSafety.blocked).toBe(true);

    await waitFor(() => expect(session.interrupt).toHaveBeenCalledOnce());

    resolveInterrupt?.();
    await waitFor(() => expect(hook.reloadSafety.blocked).toBe(false));
  });

  it("does not let stale finalization clear a newer session block", async () => {
    let resolveFirstInterrupt: (() => void) | undefined;
    const first: PracticeSessionPersistence = {
      recordAttempt: vi.fn(() => Promise.resolve()),
      finish: vi.fn(() => Promise.resolve()),
      interrupt: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            resolveFirstInterrupt = resolve;
          }),
      ),
      retry: vi.fn(() => Promise.resolve()),
    };
    const second = persistence();
    const sharedReloadSafety = createReloadSafetyStore();

    const firstHook = renderUsePracticeSession([first], sharedReloadSafety);
    await act(async () => {
      await firstHook.result.current.start();
    });
    expect(firstHook.reloadSafety.blocked).toBe(true);

    firstHook.unmount();
    await waitFor(() => expect(first.interrupt).toHaveBeenCalledOnce());

    const secondHook = renderUsePracticeSession([second], sharedReloadSafety);
    await act(async () => {
      await secondHook.result.current.start();
    });
    expect(secondHook.reloadSafety.blocked).toBe(true);

    resolveFirstInterrupt?.();
    await waitFor(() => expect(secondHook.reloadSafety.blocked).toBe(true));
    await act(async () => {
      await secondHook.result.current.interrupt();
    });
    expect(secondHook.reloadSafety.blocked).toBe(false);
    secondHook.unmount();
  });

  it("keeps reload safety blocked when a newer session settles before an older pending finalization", async () => {
    let resolveFirstInterrupt: (() => void) | undefined;
    const first: PracticeSessionPersistence = {
      recordAttempt: vi.fn(() => Promise.resolve()),
      finish: vi.fn(() => Promise.resolve()),
      interrupt: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            resolveFirstInterrupt = resolve;
          }),
      ),
      retry: vi.fn(() => Promise.resolve()),
    };
    const second = persistence();
    const sharedReloadSafety = createReloadSafetyStore();

    const firstHook = renderUsePracticeSession([first], sharedReloadSafety);
    await act(async () => {
      await firstHook.result.current.start();
    });
    firstHook.unmount();
    await waitFor(() => expect(first.interrupt).toHaveBeenCalledOnce());

    const secondHook = renderUsePracticeSession([second], sharedReloadSafety);
    await act(async () => {
      await secondHook.result.current.start();
      await secondHook.result.current.interrupt();
    });

    expect(secondHook.reloadSafety.blocked).toBe(true);

    resolveFirstInterrupt?.();
    await waitFor(() => expect(secondHook.reloadSafety.blocked).toBe(false));
    secondHook.unmount();
  });
});
