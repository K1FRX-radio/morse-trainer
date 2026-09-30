import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useState, type ReactNode } from "react";
import { DEFAULT_CURRICULUM_CONFIG } from "../../content/curriculum-data.ts";
import { createInitialState } from "../../core/curriculum.ts";
import { DEFAULT_SETTINGS } from "../../core/settings.ts";
import type { PracticeSessionPersistence } from "../../data/practice-persistence.ts";
import { NavigationGuardContext } from "../navigation-guard-context.ts";
import { SettingsContext } from "../settings-context.ts";
import { TrainingDataContext } from "../training-data-context.ts";
import { ImportedTextPractice } from "./ImportedTextPractice.tsx";

const audio = vi.hoisted(() => {
  const playText = vi.fn<
    (
      text: string,
      timing: { charWpm: number; effectiveWpm?: number },
      options: { toneHz: number },
    ) => Promise<void>
  >(() => Promise.resolve());
  return {
    playText,
    cancel: vi.fn(() => Promise.resolve()),
    unlock: vi.fn(() => Promise.resolve()),
    noiseStart: vi.fn(),
    noiseStop: vi.fn(),
  };
});

const audioEngine = {
  engine: {
    playText: audio.playText,
    cancel: audio.cancel,
  },
  unlock: audio.unlock,
  noise: {
    start: audio.noiseStart,
    stop: audio.noiseStop,
  },
};

vi.mock("../hooks/useAudioEngine.ts", () => ({
  useAudioEngine: () => audioEngine,
}));

afterEach(() => {
  vi.clearAllMocks();
});

function NavigationGuardHarness({ children }: { children: ReactNode }) {
  const [blocked, setBlocked] = useState(false);
  return (
    <NavigationGuardContext.Provider value={{ blocked, setBlocked }}>
      <p aria-label="Guard state">{blocked ? "blocked" : "unblocked"}</p>
      {children}
    </NavigationGuardContext.Provider>
  );
}

function persistence(): PracticeSessionPersistence {
  return {
    recordAttempt: vi.fn(() => Promise.resolve()),
    finish: vi.fn(() => Promise.resolve()),
    interrupt: vi.fn(() => Promise.resolve()),
    retry: vi.fn(() => Promise.resolve()),
  };
}

function renderImportedTextPractice(noiseLevel = DEFAULT_SETTINGS.noiseLevel) {
  const session = persistence();
  const curriculum = createInitialState(DEFAULT_CURRICULUM_CONFIG);
  const startPracticeSessionPersistence = vi.fn(() => Promise.resolve(session));

  const view = render(
    <SettingsContext.Provider
      value={{
        settings: { ...DEFAULT_SETTINGS, noiseLevel },
        update: vi.fn(),
        outputDeviceId: "",
        setOutputDeviceId: vi.fn(),
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
          listConfusionProjections: () => Promise.resolve([]),
        }}
      >
        <NavigationGuardHarness>
          <ImportedTextPractice />
        </NavigationGuardHarness>
      </TrainingDataContext.Provider>
    </SettingsContext.Provider>,
  );

  return { ...view, session, startPracticeSessionPersistence };
}

function renderImportedTextPracticeWithSessions(
  sessions: PracticeSessionPersistence[],
) {
  const curriculum = createInitialState(DEFAULT_CURRICULUM_CONFIG);
  let index = 0;
  const startPracticeSessionPersistence = vi.fn(() =>
    Promise.resolve(sessions[Math.min(index++, sessions.length - 1)]!),
  );

  const view = render(
    <SettingsContext.Provider
      value={{
        settings: { ...DEFAULT_SETTINGS },
        update: vi.fn(),
        outputDeviceId: "",
        setOutputDeviceId: vi.fn(),
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
          listConfusionProjections: () => Promise.resolve([]),
        }}
      >
        <NavigationGuardHarness>
          <ImportedTextPractice />
        </NavigationGuardHarness>
      </TrainingDataContext.Provider>
    </SettingsContext.Provider>,
  );

  return { ...view, startPracticeSessionPersistence };
}

function renderWithSwitchHarness() {
  const session = persistence();
  const curriculum = createInitialState(DEFAULT_CURRICULUM_CONFIG);
  const startPracticeSessionPersistence = vi.fn(() => Promise.resolve(session));

  function SwitchHarness() {
    const [showImported, setShowImported] = useState(true);
    return (
      <>
        <button type="button" onClick={() => setShowImported(false)}>
          Switch away
        </button>
        {showImported ? <ImportedTextPractice /> : <p>Other practice</p>}
      </>
    );
  }

  const view = render(
    <SettingsContext.Provider
      value={{
        settings: { ...DEFAULT_SETTINGS, noiseLevel: 0.3 },
        update: vi.fn(),
        outputDeviceId: "",
        setOutputDeviceId: vi.fn(),
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
          listConfusionProjections: () => Promise.resolve([]),
        }}
      >
        <NavigationGuardHarness>
          <SwitchHarness />
        </NavigationGuardHarness>
      </TrainingDataContext.Provider>
    </SettingsContext.Provider>,
  );

  return { ...view, session, startPracticeSessionPersistence };
}

describe("ImportedTextPractice", () => {
  it("normalizes input and passes settings through to playback", async () => {
    renderImportedTextPractice();

    fireEvent.change(screen.getByLabelText("Imported text"), {
      target: { value: "cq test" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Start" }));

    await waitFor(() => expect(audio.playText).toHaveBeenCalled());
    expect(audio.playText.mock.calls[0][0]).toBe("CQ ");
    expect(audio.playText.mock.calls[0][1]).toEqual({
      charWpm: DEFAULT_SETTINGS.charWpm,
      effectiveWpm: DEFAULT_SETTINGS.effectiveWpm,
    });
    expect(audio.playText.mock.calls[0][2]).toEqual({
      toneHz: DEFAULT_SETTINGS.toneHz,
    });
  });

  it("supports pause, resume, stop, and replay", async () => {
    let resolvePlay: (() => void) | undefined;
    audio.playText.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolvePlay = resolve;
        }),
    );

    renderImportedTextPractice();

    fireEvent.change(screen.getByLabelText("Imported text"), {
      target: { value: "a b" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Start" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Pause" })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    await waitFor(() => expect(audio.cancel).toHaveBeenCalled());

    resolvePlay?.();

    fireEvent.click(screen.getByRole("button", { name: "Resume" }));
    await waitFor(() =>
      expect(audio.playText.mock.calls.length).toBeGreaterThanOrEqual(2),
    );

    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    await waitFor(() =>
      expect(audio.cancel.mock.calls.length).toBeGreaterThanOrEqual(2),
    );

    const beforeReplay = audio.playText.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "Replay" }));
    await waitFor(() => {
      expect(audio.playText.mock.calls.length).toBeGreaterThan(beforeReplay);
    });
    expect(audio.playText.mock.calls[beforeReplay][0]).toBe("A ");
  });

  it("switching away during playback cancels audio and stops noise", async () => {
    let resolvePlay: (() => void) | undefined;
    audio.playText.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolvePlay = resolve;
        }),
    );

    const { session } = renderWithSwitchHarness();

    fireEvent.change(screen.getByLabelText("Imported text"), {
      target: { value: "A B" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Start" }));

    await waitFor(() =>
      expect(screen.getByLabelText("Guard state")).toHaveTextContent("blocked"),
    );
    fireEvent.click(screen.getByRole("button", { name: "Switch away" }));
    resolvePlay?.();

    await waitFor(() => expect(audio.cancel).toHaveBeenCalled());
    await waitFor(() => expect(audio.noiseStop).toHaveBeenCalled());
    await waitFor(() => expect(session.interrupt).toHaveBeenCalledOnce());
  });

  it("unmount during playback cancels audio and stops noise", async () => {
    let resolvePlay: (() => void) | undefined;
    audio.playText.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolvePlay = resolve;
        }),
    );

    const view = renderImportedTextPractice(0.3);

    fireEvent.change(screen.getByLabelText("Imported text"), {
      target: { value: "A B" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Start" }));

    await waitFor(() =>
      expect(screen.getByLabelText("Guard state")).toHaveTextContent("blocked"),
    );
    view.unmount();
    resolvePlay?.();

    await waitFor(() => expect(audio.cancel).toHaveBeenCalled());
    await waitFor(() => expect(audio.noiseStop).toHaveBeenCalled());
    await waitFor(() => expect(view.session.interrupt).toHaveBeenCalledOnce());
  });

  it("finalizes completed playback while component remains mounted", async () => {
    const view = renderImportedTextPractice();

    fireEvent.change(screen.getByLabelText("Imported text"), {
      target: { value: "A" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Start" }));

    await waitFor(() => expect(audio.playText).toHaveBeenCalled());
    await waitFor(() => expect(view.session.finish).toHaveBeenCalledOnce());
    expect(view.session.interrupt).not.toHaveBeenCalled();

    view.unmount();
    await waitFor(() => expect(view.session.finish).toHaveBeenCalledTimes(1));
  });

  it("stop finalizes interrupted playback while component remains mounted", async () => {
    let resolvePlay: (() => void) | undefined;
    audio.playText.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolvePlay = resolve;
        }),
    );

    const view = renderImportedTextPractice();

    fireEvent.change(screen.getByLabelText("Imported text"), {
      target: { value: "A B" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Start" }));

    await waitFor(() =>
      expect(screen.getByLabelText("Guard state")).toHaveTextContent("blocked"),
    );
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    resolvePlay?.();

    await waitFor(() => expect(view.session.interrupt).toHaveBeenCalledOnce());
    expect(view.session.finish).not.toHaveBeenCalled();

    view.unmount();
    await waitFor(() =>
      expect(view.session.interrupt).toHaveBeenCalledTimes(1),
    );
  });

  it("starts a new persistence session after a completed run", async () => {
    const first = persistence();
    const second = persistence();
    const view = renderImportedTextPracticeWithSessions([first, second]);

    fireEvent.change(screen.getByLabelText("Imported text"), {
      target: { value: "A" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Start" }));

    await waitFor(() => expect(first.finish).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole("button", { name: "Replay" }));
    await waitFor(() => expect(second.finish).toHaveBeenCalledOnce());

    expect(view.startPracticeSessionPersistence).toHaveBeenCalledTimes(2);
  });

  it("normal stop returns the navigation guard to unblocked", async () => {
    let resolvePlay: (() => void) | undefined;
    audio.playText.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolvePlay = resolve;
        }),
    );

    renderImportedTextPractice();

    fireEvent.change(screen.getByLabelText("Imported text"), {
      target: { value: "A B" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Start" }));

    await waitFor(() =>
      expect(screen.getByLabelText("Guard state")).toHaveTextContent("blocked"),
    );
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    resolvePlay?.();

    await waitFor(() =>
      expect(screen.getByLabelText("Guard state")).toHaveTextContent(
        "unblocked",
      ),
    );
  });

  it("reports unsupported characters and enforces input bounds", async () => {
    renderImportedTextPractice();

    fireEvent.change(screen.getByLabelText("Imported text"), {
      target: { value: "A @ B" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Start" }));

    await screen.findByText(/Unsupported characters were ignored/);

    fireEvent.change(screen.getByLabelText("Imported text"), {
      target: { value: "A".repeat(10001) },
    });
    fireEvent.click(screen.getByRole("button", { name: "Start" }));

    await screen.findByRole("alert");
    expect(screen.getByRole("alert")).toHaveTextContent(/cannot exceed 10000/);
  });

  it("loads text from file", async () => {
    renderImportedTextPractice();

    const file = new File(["cq de k1frx"], "sample.txt", {
      type: "text/plain",
    });
    fireEvent.change(screen.getByLabelText("Load text file"), {
      target: { files: [file] },
    });

    await waitFor(() => {
      expect(screen.getByLabelText("Imported text")).toHaveValue("cq de k1frx");
    });
  });
});
