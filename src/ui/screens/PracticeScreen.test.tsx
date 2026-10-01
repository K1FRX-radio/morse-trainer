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
import {
  createInitialState,
  type CurriculumState,
} from "../../core/curriculum.ts";
import { DEFAULT_SETTINGS } from "../../core/settings.ts";
import type { CharacterProjectionRecord } from "../../data/models.ts";
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

type RenderPracticeOptions = {
  curriculum?: CurriculumState;
  characterProjections?: CharacterProjectionRecord[];
};

function renderPractice(
  child: ReactNode,
  session: PracticeSessionPersistence,
  options: RenderPracticeOptions = {},
) {
  const startPracticeSessionPersistence = vi.fn(() => Promise.resolve(session));
  const saveCurriculum = vi.fn();
  const curriculum =
    options.curriculum ?? createInitialState(DEFAULT_CURRICULUM_CONFIG);
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
          saveCurriculum,
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
          listCharacterProjections: () =>
            Promise.resolve(options.characterProjections ?? []),
          listConfusionProjections: () => Promise.resolve([]),
        }}
      >
        <NavigationGuardHarness>{child}</NavigationGuardHarness>
      </TrainingDataContext.Provider>
    </SettingsContext.Provider>,
  );
  return { ...view, startPracticeSessionPersistence, saveCurriculum };
}

function sendCurriculum(order: string[]): CurriculumState {
  return createInitialState({
    ...DEFAULT_CURRICULUM_CONFIG,
    order,
    startCount: order.length,
  });
}

function selectSendLength(length: 1 | 2 | 3) {
  fireEvent.change(screen.getByLabelText("Length"), {
    target: { value: String(length) },
  });
}

function sendTargetText(): string {
  const target = screen
    .getByLabelText("Send this character")
    .querySelector(".send__target-char")?.textContent;
  return target ?? "";
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
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => (now += 200));
    const session = persistence();
    const { startPracticeSessionPersistence, saveCurriculum } = renderPractice(
      <SendPractice />,
      session,
      { curriculum: sendCurriculum(["T"]) },
    );
    await waitFor(() =>
      expect(screen.getByLabelText("Send this character")).toHaveTextContent(
        "T",
      ),
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
        schedulerReason: "NEW_CHARACTER",
        keying: expect.objectContaining({ encoding: "u32-ms-le-v1" }),
      }),
      expect.objectContaining({ completedCards: 1 }),
    );
    expect(saveCurriculum).not.toHaveBeenCalled();
  });

  it("commits a non-empty miss before advancing to a new target", async () => {
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => (now += 200));
    const session = persistence();
    renderPractice(<SendPractice />, session, {
      curriculum: sendCurriculum(["E"]),
    });
    await waitFor(() =>
      expect(screen.getByLabelText("Send this character")).toHaveTextContent(
        "E",
      ),
    );
    expect(screen.getByLabelText("Send this character")).toHaveTextContent("E");

    fireEvent.keyDown(window, { key: " " });
    fireEvent.keyUp(window, { key: " " });
    expect(session.recordAttempt).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "New target" }));

    await waitFor(() => expect(session.recordAttempt).toHaveBeenCalledOnce());
    expect(session.recordAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        target: "E",
        response: "T",
        schedulerReason: "NEW_CHARACTER",
      }),
      expect.objectContaining({ completedCards: 1 }),
    );
  });

  it("uses only unlocked curriculum characters and avoids Math.random pool selection", async () => {
    const randomSpy = vi.spyOn(Math, "random");
    const session = persistence();
    renderPractice(<SendPractice />, session, {
      curriculum: sendCurriculum(["K", "M"]),
    });

    const seen = new Set<string>();
    for (let i = 0; i < 10; i++) {
      await waitFor(() => {
        const shown =
          screen
            .getByLabelText("Send this character")
            .textContent?.replace("Send", "")
            .trim() ?? "";
        expect(shown).not.toBe("");
        seen.add(shown);
        expect(["K", "M"]).toContain(shown);
      });
      if (i < 9) {
        fireEvent.click(screen.getByRole("button", { name: "New target" }));
      }
    }

    expect(seen.size).toBeGreaterThan(0);
    expect(randomSpy).not.toHaveBeenCalled();
  });

  it("fails safely when no characters are unlocked", async () => {
    const session = persistence();
    renderPractice(<SendPractice />, session, {
      curriculum: sendCurriculum([]),
    });

    await screen.findByRole("alert");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "No unlocked characters are available for Send Practice.",
    );
    expect(screen.getByLabelText("Send this character")).toHaveTextContent("-");
    expect(
      screen.getByRole("button", { name: "Straight key (hold to send)" }),
    ).toBeDisabled();
  });

  it("blocks tab navigation after a failed attempt until retry succeeds", async () => {
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => (now += 200));
    const session = persistence();
    vi.mocked(session.recordAttempt).mockRejectedValueOnce(
      new Error("write failed"),
    );
    renderPractice(<PracticeScreen />, session, {
      curriculum: sendCurriculum(["T"]),
    });
    fireEvent.click(screen.getByRole("tab", { name: "Send" }));
    await waitFor(() =>
      expect(screen.getByLabelText("Send this character")).toHaveTextContent(
        "T",
      ),
    );

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

  it("commits an exact two-character decode once", async () => {
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => (now += 200));
    const session = persistence();
    renderPractice(<SendPractice />, session, {
      curriculum: sendCurriculum(["T"]),
    });

    await waitFor(() =>
      expect(screen.getByLabelText("Send this character")).toHaveTextContent(
        "T",
      ),
    );
    selectSendLength(2);
    await waitFor(() =>
      expect(screen.getByLabelText("Send this character")).toHaveTextContent(
        "TT",
      ),
    );

    fireEvent.keyDown(window, { key: " " });
    fireEvent.keyUp(window, { key: " " });
    fireEvent.keyDown(window, { key: " " });
    fireEvent.keyUp(window, { key: " " });

    await waitFor(() => expect(session.recordAttempt).toHaveBeenCalledOnce());
    expect(session.recordAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        exerciseType: "send-group",
        target: "TT",
        response: "T T",
        schedulerReason: "NEW_CHARACTER",
        keying: expect.objectContaining({ encoding: "u32-ms-le-v1" }),
      }),
      expect.objectContaining({ completedCards: 1 }),
    );
  });

  it("commits a non-empty group miss once on New target", async () => {
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => (now += 200));
    const session = persistence();
    renderPractice(<SendPractice />, session, {
      curriculum: sendCurriculum(["T"]),
    });

    await waitFor(() =>
      expect(screen.getByLabelText("Send this character")).toHaveTextContent(
        "T",
      ),
    );
    selectSendLength(3);
    await waitFor(() =>
      expect(screen.getByLabelText("Send this character")).toHaveTextContent(
        "TTT",
      ),
    );

    fireEvent.keyDown(window, { key: " " });
    fireEvent.keyUp(window, { key: " " });
    fireEvent.click(screen.getByRole("button", { name: "New target" }));

    await waitFor(() => expect(session.recordAttempt).toHaveBeenCalledOnce());
    expect(session.recordAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        exerciseType: "send-group",
        target: "TTT",
        response: "T",
        schedulerReason: "NEW_CHARACTER",
        keying: expect.objectContaining({ encoding: "u32-ms-le-v1" }),
      }),
      expect.objectContaining({ completedCards: 1 }),
    );
  });

  it("changing exercise length does not save an empty attempt", async () => {
    const session = persistence();
    renderPractice(<SendPractice />, session, {
      curriculum: sendCurriculum(["T", "M"]),
    });

    await waitFor(() =>
      expect(screen.getByLabelText("Send this character")).toHaveTextContent(
        /[TM]/,
      ),
    );
    selectSendLength(2);
    await waitFor(() => expect(sendTargetText()).toMatch(/^[TM]{2}$/));
    selectSendLength(3);
    await waitFor(() => expect(sendTargetText()).toMatch(/^[TM]{3}$/));
    selectSendLength(1);
    await waitFor(() => expect(sendTargetText()).toMatch(/^[TM]$/));

    expect(session.recordAttempt).not.toHaveBeenCalled();
  });

  it("persists scheduler reason for grouped targets", async () => {
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => (now += 200));
    const session = persistence();
    renderPractice(<SendPractice />, session, {
      curriculum: sendCurriculum(["K", "M"]),
      characterProjections: [
        {
          id: "character:tx:K",
          schemaVersion: 1,
          updatedAt: "2026-10-01T00:00:00.000Z",
          projectionVersion: 1,
          character: "K",
          direction: "tx",
          recent: [
            {
              attemptId: "a",
              occurredAt: {
                utc: "2026-10-01T00:00:00.000Z",
                localDate: "2026-10-01",
                utcOffsetMinutes: 0,
              },
              correct: false,
              kind: "substitution",
              answer: "M",
            },
          ],
        },
      ],
    });

    await waitFor(() =>
      expect(screen.getByLabelText("Send this character")).toHaveTextContent(
        /[KM]/,
      ),
    );
    selectSendLength(2);
    await waitFor(() =>
      expect(screen.getByLabelText("Send this character")).toHaveTextContent(
        /[KM]{2}/,
      ),
    );

    fireEvent.keyDown(window, { key: " " });
    fireEvent.keyUp(window, { key: " " });
    fireEvent.click(screen.getByRole("button", { name: "New target" }));

    await waitFor(() => expect(session.recordAttempt).toHaveBeenCalledOnce());
    const firstCall = vi.mocked(session.recordAttempt).mock.calls[0]?.[0];
    expect(firstCall?.schedulerReason).toBeDefined();
  });
});
