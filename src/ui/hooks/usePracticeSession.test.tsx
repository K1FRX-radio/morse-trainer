import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type ReactNode } from "react";
import { DEFAULT_CURRICULUM_CONFIG } from "../../content/curriculum-data.ts";
import { createInitialState } from "../../core/curriculum.ts";
import { DEFAULT_SETTINGS } from "../../core/settings.ts";
import type { PracticeSessionPersistence } from "../../data/practice-persistence.ts";
import { PracticeSessionTimer } from "../../training/practice-session.ts";
import { NavigationGuardContext } from "../navigation-guard-context.ts";
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

function renderUsePracticeSession(sessions: PracticeSessionPersistence[]) {
  const curriculum = createInitialState(DEFAULT_CURRICULUM_CONFIG);
  const setBlocked = vi.fn();
  let index = 0;
  const startPracticeSessionPersistence = vi.fn(() =>
    Promise.resolve(sessions[Math.min(index++, sessions.length - 1)]!),
  );

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <NavigationGuardContext.Provider value={{ blocked: false, setBlocked }}>
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
            listConfusionProjections: () => Promise.resolve([]),
          }}
        >
          {children}
        </TrainingDataContext.Provider>
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

  return { ...hook, startPracticeSessionPersistence, setBlocked };
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
});
