import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useState, type ReactNode } from "react";
import { DEFAULT_CURRICULUM_CONFIG } from "../../content/curriculum-data.ts";
import { createInitialState } from "../../core/curriculum.ts";
import { DEFAULT_SETTINGS } from "../../core/settings.ts";
import type { PracticeSessionPersistence } from "../../data/practice-persistence.ts";
import { NavigationGuardContext } from "../navigation-guard-context.ts";
import { SettingsContext } from "../settings-context.ts";
import { TrainingDataContext } from "../training-data-context.ts";
import { CopyPractice } from "./CopyPractice.tsx";
import { PracticeScreen } from "./PracticeScreen.tsx";
import { SendPractice } from "./SendPractice.tsx";

const audio = vi.hoisted(() => ({
  playText: vi.fn(() => Promise.resolve()),
  cancel: vi.fn(),
  startTone: vi.fn(),
  stopTone: vi.fn(),
  noiseStart: vi.fn(),
  noiseStop: vi.fn(),
  unlock: vi.fn(() => Promise.resolve()),
}));

vi.mock("../hooks/useAudioEngine.ts", () => ({
  useAudioEngine: () => ({
    engine: {
      playText: audio.playText,
      cancel: audio.cancel,
      startTone: audio.startTone,
      stopTone: audio.stopTone,
    },
    noise: { start: audio.noiseStart, stop: audio.noiseStop },
    unlock: audio.unlock,
  }),
}));

function persistence(): PracticeSessionPersistence {
  return {
    recordAttempt: vi.fn(() => Promise.resolve()),
    finish: vi.fn(() => Promise.resolve()),
    interrupt: vi.fn(() => Promise.resolve()),
    retry: vi.fn(() => Promise.resolve()),
  };
}

function NavigationGuardHarness({ children }: { children: ReactNode }) {
  const [blocked, setBlocked] = useState(false);
  return (
    <NavigationGuardContext.Provider value={{ blocked, setBlocked }}>
      {children}
    </NavigationGuardContext.Provider>
  );
}

function renderPractice(child: ReactNode, session: PracticeSessionPersistence) {
  const startPracticeSessionPersistence = vi.fn(() => Promise.resolve(session));
  const curriculum = createInitialState(DEFAULT_CURRICULUM_CONFIG);
  const view = render(
    <SettingsContext.Provider
      value={{
        settings: DEFAULT_SETTINGS,
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
        <NavigationGuardHarness>{child}</NavigationGuardHarness>
      </TrainingDataContext.Provider>
    </SettingsContext.Provider>,
  );
  return { ...view, startPracticeSessionPersistence };
}

beforeEach(() => {
  vi.spyOn(performance, "now").mockImplementation(() => 1000);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("CopyPractice persistence", () => {
  it("starts on Start and commits one assisted attempt on Check", async () => {
    const session = persistence();
    const { startPracticeSessionPersistence, unmount } = renderPractice(
      <CopyPractice />,
      session,
    );

    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    await screen.findByLabelText("Your copy");
    fireEvent.click(screen.getByRole("button", { name: "Replay" }));
    fireEvent.change(screen.getByLabelText("Your copy"), {
      target: { value: "WRONG" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Check" }));
    fireEvent.click(screen.getByRole("button", { name: "Check" }));

    await waitFor(() => expect(session.recordAttempt).toHaveBeenCalledOnce());
    expect(startPracticeSessionPersistence).toHaveBeenCalledWith(
      expect.objectContaining({ source: "copy-practice" }),
    );
    expect(session.recordAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        exerciseType: "copy-group",
        response: "WRONG",
        assisted: true,
        replayed: true,
      }),
      expect.objectContaining({ completedCards: 1 }),
    );
    unmount();
    await waitFor(() => expect(session.finish).toHaveBeenCalledOnce());
  });
});

describe("SendPractice persistence", () => {
  it("shows Imported Text RX from the Practice tabs", () => {
    const session = persistence();
    renderPractice(<PracticeScreen />, session);

    fireEvent.click(screen.getByRole("tab", { name: "Text RX" }));

    expect(
      screen.getByRole("heading", { name: "Imported Text RX" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Imported text")).toBeInTheDocument();
  });

  it("starts on first contact and commits an exact decode once", async () => {
    vi.spyOn(Math, "random").mockReturnValue(19 / 36);
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => (now += 200));
    const session = persistence();
    const { startPracticeSessionPersistence } = renderPractice(
      <SendPractice />,
      session,
    );
    expect(screen.getByLabelText("Send this character")).toHaveTextContent("T");

    fireEvent.keyDown(window, { key: " " });
    fireEvent.keyUp(window, { key: " " });

    await waitFor(() => expect(session.recordAttempt).toHaveBeenCalledOnce());
    expect(startPracticeSessionPersistence).toHaveBeenCalledWith(
      expect.objectContaining({ source: "send-practice" }),
    );
    expect(session.recordAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        exerciseType: "send-character",
        target: "T",
        response: "T",
        keying: expect.objectContaining({ encoding: "u32-ms-le-v1" }),
      }),
      expect.objectContaining({ completedCards: 1 }),
    );
  });

  it("commits a non-empty miss before advancing to a new target", async () => {
    vi.spyOn(Math, "random").mockReturnValue(4 / 36);
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => (now += 200));
    const session = persistence();
    renderPractice(<SendPractice />, session);
    expect(screen.getByLabelText("Send this character")).toHaveTextContent("E");

    fireEvent.keyDown(window, { key: " " });
    fireEvent.keyUp(window, { key: " " });
    expect(session.recordAttempt).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "New target" }));

    await waitFor(() => expect(session.recordAttempt).toHaveBeenCalledOnce());
    expect(session.recordAttempt).toHaveBeenCalledWith(
      expect.objectContaining({ target: "E", response: "T" }),
      expect.objectContaining({ completedCards: 1 }),
    );
  });

  it("blocks tab navigation after a failed attempt until retry succeeds", async () => {
    vi.spyOn(Math, "random").mockReturnValue(19 / 36);
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => (now += 200));
    const session = persistence();
    vi.mocked(session.recordAttempt).mockRejectedValueOnce(
      new Error("write failed"),
    );
    renderPractice(<PracticeScreen />, session);
    fireEvent.click(screen.getByRole("tab", { name: "Send" }));

    fireEvent.keyDown(window, { key: " " });
    fireEvent.keyUp(window, { key: " " });

    await screen.findByRole("alert");
    const copyTab = screen.getByRole("tab", { name: "Copy" });
    expect(copyTab).toBeDisabled();
    fireEvent.click(copyTab);
    expect(screen.getByLabelText("Send this character")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Retry save" }));
    await waitFor(() => expect(copyTab).toBeEnabled());
    expect(session.retry).toHaveBeenCalledOnce();
    fireEvent.click(copyTab);
    expect(screen.getByRole("button", { name: "Start" })).toBeInTheDocument();
  });
});
