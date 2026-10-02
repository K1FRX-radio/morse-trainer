import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { useRef, type ReactNode } from "react";
import { App } from "../../App.tsx";
import { DEFAULT_CURRICULUM_CONFIG } from "../../content/curriculum-data.ts";
import { createInitialState, forceUnlockNext } from "../../core/curriculum.ts";
import { decodePattern } from "../../core/morse.ts";
import {
  normalizeSettings,
  type PracticeSettings,
} from "../../core/settings.ts";
import type { Schedule } from "../../core/timing.ts";
import type { RetryClassification } from "../../data/retry-history.ts";
import type {
  LearnPersistenceStart,
  LearnSessionPersistence,
} from "../../data/learn-persistence.ts";
import {
  applyAdvancementTransition,
  type AdvancementAcceptance,
} from "../../training/advancement.ts";
import { DEFAULT_LESSON_CONFIG } from "../../training/lesson-plan.ts";
import { sanitizeCopyInput } from "../copy-input.ts";
import { LearnAudioContext, type LearnAudio } from "../learn-audio-context.ts";
import { SettingsProvider } from "../settings-provider.tsx";
import { TrainingDataContext } from "../training-data-context.ts";
import { createLearnTestDriver } from "../test/learn-test-driver.ts";
import { LearnScreen } from "./LearnScreen.tsx";

type PendingPlay = {
  text?: string;
  schedule?: Schedule;
  resolve: () => void;
};

function makeFakeAudio() {
  const pending: PendingPlay[] = [];
  const played: string[] = [];
  const audio: LearnAudio = {
    unlock: () => Promise.resolve(),
    play: (text) => {
      played.push(text);
      return new Promise<void>((resolve) => {
        pending.push({ text, resolve });
      });
    },
    playSchedule: (schedule) =>
      new Promise<void>((resolve) => {
        pending.push({ text: decodeSchedule(schedule), schedule, resolve });
      }),
    // Cancellation resolves in-flight playback, mirroring the real engine.
    cancel: async () => {
      while (pending.length) pending.shift()?.resolve();
    },
    suspend: () => Promise.resolve(),
    cancelAndSuspend: async () => {
      while (pending.length) pending.shift()?.resolve();
    },
  };
  return {
    audio,
    pending,
    played,
    playCount: () => pending.length,
    resolveNext: () => pending.shift()?.resolve(),
    resolveAt: (index: number) => pending.splice(index, 1)[0]?.resolve(),
  };
}

function activeTimeSeconds(): number {
  const item = screen.getByText(/Active time:/).textContent ?? "";
  const matched = item.match(/Active time: (\d+) s/);
  if (!matched) {
    throw new Error(`could not parse active time: ${item}`);
  }
  return Number(matched[1]);
}

function decodeSchedule(schedule: Schedule): string {
  const characters: string[] = [];
  let pattern = "";
  for (const segment of schedule.segments) {
    if (segment.tone) {
      pattern += segment.element === "dit" ? "." : "-";
    } else if (segment.gap !== "intra") {
      const character = decodePattern(pattern);
      if (character) characters.push(character);
      pattern = "";
    }
  }
  const finalCharacter = decodePattern(pattern);
  if (finalCharacter) characters.push(finalCharacter);
  return characters.join("");
}

function testCurriculum() {
  const state = createInitialState(DEFAULT_CURRICULUM_CONFIG);
  const raw = localStorage.getItem("k1frx.curriculum.v2");
  if (raw) state.characters = JSON.parse(raw) as typeof state.characters;
  return state;
}

function testIntroductions(): string[] {
  return JSON.parse(
    localStorage.getItem("k1frx.introduced.v1") ?? "[]",
  ) as string[];
}

function seedUnlockedCharacters(count: number): string[] {
  const state = createInitialState({
    ...DEFAULT_CURRICULUM_CONFIG,
    startCount: Math.max(1, count),
  });
  while (state.characters.length < count) {
    forceUnlockNext(state);
  }
  state.characters = state.characters.slice(0, count);
  localStorage.setItem("k1frx.curriculum.v2", JSON.stringify(state.characters));
  return state.characters.map((character) => character.character);
}

function acceptedCurriculum(acceptance: AdvancementAcceptance) {
  const state = testCurriculum();
  const activeCharacters = state.characters.map(({ character }) => character);
  const transition = applyAdvancementTransition(state, {
    activeCharacters,
    type: acceptance.type,
    ...(acceptance.type === "character-unlocked"
      ? { unlockedCharacter: acceptance.character }
      : {}),
  });
  if (transition === undefined) {
    throw new Error("test advancement transition was rejected");
  }
  localStorage.setItem("k1frx.curriculum.v2", JSON.stringify(state.characters));
  return state;
}

function TrainingDataFixture({
  children,
  retryClassification = {
    consecutiveAccuracyMisses: 0,
    shouldSuggestSpacing: false,
  },
  startLearnSessionPersistence,
  getRetryClassification,
  acceptAdvancement,
  onSaveCurriculum,
  onReconcileCurriculum,
}: {
  children: ReactNode;
  retryClassification?: RetryClassification;
  startLearnSessionPersistence?: (
    options: LearnPersistenceStart,
  ) => Promise<LearnSessionPersistence>;
  getRetryClassification?: () => Promise<RetryClassification>;
  acceptAdvancement?: LearnSessionPersistence["acceptAdvancement"];
  onSaveCurriculum?: () => void;
  onReconcileCurriculum?: () => void;
}) {
  const curriculum = useRef(testCurriculum());
  const persistence: LearnSessionPersistence = {
    recordAttempt: () => Promise.resolve(),
    finish: () => Promise.resolve(),
    interrupt: () => Promise.resolve(),
    acceptAdvancement:
      acceptAdvancement ??
      ((acceptance) => Promise.resolve(acceptedCurriculum(acceptance))),
    retry: () => Promise.resolve(),
  };
  return (
    <TrainingDataContext.Provider
      value={{
        loadCurriculum: () => structuredClone(curriculum.current),
        saveCurriculum: (state) => {
          curriculum.current = structuredClone(state);
          onSaveCurriculum?.();
          localStorage.setItem(
            "k1frx.curriculum.v2",
            JSON.stringify(state.characters),
          );
        },
        reconcileCurriculum: () => {
          const state = testCurriculum();
          curriculum.current = structuredClone(state);
          onReconcileCurriculum?.();
          return Promise.resolve(structuredClone(state));
        },
        loadIntroductions: testIntroductions,
        saveIntroductions: (characters) =>
          localStorage.setItem(
            "k1frx.introduced.v1",
            JSON.stringify(characters),
          ),
        startLearnSessionPersistence:
          startLearnSessionPersistence ?? (() => Promise.resolve(persistence)),
        startPracticeSessionPersistence: () =>
          Promise.reject(new Error("Practice persistence is not used here")),
        getRetryClassification:
          getRetryClassification ??
          (() => Promise.resolve(retryClassification)),
        listDailyProjections: () => Promise.resolve([]),
        listCharacterProjections: () => Promise.resolve([]),
        listConfusionProjections: () => Promise.resolve([]),
      }}
    >
      {children}
    </TrainingDataContext.Provider>
  );
}

function renderLearn(
  audio: LearnAudio,
  settings: Partial<PracticeSettings> = {},
  options: {
    retryClassification?: RetryClassification;
    persistSettings?: (settings: PracticeSettings) => void;
    startLearnSessionPersistence?: (
      options: LearnPersistenceStart,
    ) => Promise<LearnSessionPersistence>;
    getRetryClassification?: () => Promise<RetryClassification>;
    acceptAdvancement?: LearnSessionPersistence["acceptAdvancement"];
    onSaveCurriculum?: () => void;
    onReconcileCurriculum?: () => void;
  } = {},
) {
  return render(
    <SettingsProvider
      initialSettings={normalizeSettings(settings)}
      {...(options.persistSettings
        ? { persistSettings: options.persistSettings }
        : {})}
    >
      <TrainingDataFixture
        {...(options.retryClassification
          ? { retryClassification: options.retryClassification }
          : {})}
        {...(options.startLearnSessionPersistence
          ? {
              startLearnSessionPersistence:
                options.startLearnSessionPersistence,
            }
          : {})}
        {...(options.getRetryClassification
          ? { getRetryClassification: options.getRetryClassification }
          : {})}
        {...(options.onSaveCurriculum
          ? { onSaveCurriculum: options.onSaveCurriculum }
          : {})}
        {...(options.onReconcileCurriculum
          ? { onReconcileCurriculum: options.onReconcileCurriculum }
          : {})}
        {...(options.acceptAdvancement
          ? { acceptAdvancement: options.acceptAdvancement }
          : {})}
      >
        <LearnAudioContext.Provider value={audio}>
          <LearnScreen />
        </LearnAudioContext.Provider>
      </TrainingDataFixture>
    </SettingsProvider>,
  );
}

function renderApp(
  audio: LearnAudio,
  options: {
    startLearnSessionPersistence?: (
      options: LearnPersistenceStart,
    ) => Promise<LearnSessionPersistence>;
    onReconcileCurriculum?: () => void;
  } = {},
) {
  return render(
    <MemoryRouter initialEntries={["/learn"]}>
      <SettingsProvider>
        <TrainingDataFixture
          {...(options.startLearnSessionPersistence
            ? {
                startLearnSessionPersistence:
                  options.startLearnSessionPersistence,
              }
            : {})}
          {...(options.onReconcileCurriculum
            ? { onReconcileCurriculum: options.onReconcileCurriculum }
            : {})}
        >
          <LearnAudioContext.Provider value={audio}>
            <App />
          </LearnAudioContext.Provider>
        </TrainingDataFixture>
      </SettingsProvider>
    </MemoryRouter>,
  );
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function resolvePlay(fake: ReturnType<typeof makeFakeAudio>) {
  await act(async () => {
    fake.resolveNext();
    await Promise.resolve();
  });
  await flush();
}

async function tick(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
    await Promise.resolve();
  });
  await flush();
}

function learnDriver(fake: ReturnType<typeof makeFakeAudio>) {
  return createLearnTestDriver({
    audio: {
      currentText: () => fake.pending[0]?.text,
      resolveNext: () => resolvePlay(fake),
    },
    flush,
    advanceTime: tick,
  });
}

/** Drives from onboarding to the first isolated copy card (acquire of K). */
async function toFirstCopy(fake: ReturnType<typeof makeFakeAudio>) {
  fireEvent.click(screen.getByRole("button", { name: "Start learning" }));
  await flush(); // begin: unlock + intro K present -> play #1
  await resolvePlay(fake); // intro play -> explicit ready state
  fireEvent.click(screen.getByRole("button", { name: "Start practice" }));
  await flush(); // acquire K present -> play #2
  await resolvePlay(fake); // acquire audio done -> input unlocked
}

async function answerIsolatedWithPhysicalKey(
  fake: ReturnType<typeof makeFakeAudio>,
  expected: string,
) {
  expect(fake.pending[0]?.text).toBe(expected);
  fireEvent.keyDown(window, {
    key: expected.toLowerCase(),
    code: `Key${expected}`,
  });
  fireEvent.keyUp(window, {
    key: expected.toLowerCase(),
    code: `Key${expected}`,
  });
  await resolvePlay(fake);
  expect(screen.getByRole("status")).toHaveTextContent("✓");
  await tick(450);
}

async function answerIsolatedWithMobileInput(
  fake: ReturnType<typeof makeFakeAudio>,
  expected: string,
  input: HTMLInputElement,
) {
  expect(fake.pending[0]?.text).toBe(expected);
  expect(screen.getByLabelText("Your copy")).toBe(input);
  expect(input).toBeEnabled();
  fireEvent.change(input, { target: { value: expected } });
  await flush();
  expect(input).toHaveValue("");
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
  await resolvePlay(fake);
  expect(screen.getByRole("status")).toHaveTextContent("✓");
  expect(screen.getByLabelText("Your copy")).toBe(input);
  expect(input).toBeEnabled();
  await tick(450);
}

async function toMultiCharacterTransition(
  fake: ReturnType<typeof makeFakeAudio>,
) {
  if (!localStorage.getItem("k1frx.introduced.v1")) {
    localStorage.setItem("k1frx.introduced.v1", JSON.stringify(["K", "M"]));
  }
  const driver = learnDriver(fake);
  await driver.start();
  await driver.advanceUntilPhase("groups-2");
}

async function toThreeCharacterNotice(fake: ReturnType<typeof makeFakeAudio>) {
  await toMultiCharacterTransition(fake);
  await learnDriver(fake).completePhaseCorrectly("groups-2");
}

async function toContinuousCopyTransition(
  fake: ReturnType<typeof makeFakeAudio>,
) {
  await toThreeCharacterNotice(fake);
  await learnDriver(fake).completePhaseCorrectly("groups-3");
}

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-28T12:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe("LearnScreen input gating", () => {
  it("hides Start long copy when fewer than two characters are unlocked", () => {
    seedUnlockedCharacters(1);
    const fake = makeFakeAudio();
    renderLearn(fake.audio);

    expect(
      screen.queryByRole("button", { name: "Start long copy" }),
    ).not.toBeInTheDocument();
  });

  it("shows Start long copy at two unlocked characters and starts continuous copy directly", async () => {
    const unlocked = seedUnlockedCharacters(2);
    const fake = makeFakeAudio();
    renderLearn(fake.audio);

    fireEvent.click(screen.getByRole("button", { name: "Start long copy" }));
    await flush();

    expect(screen.getByLabelText("Continuous copy")).toBeInTheDocument();
    expect(screen.queryByLabelText("Your copy")).not.toBeInTheDocument();

    const stream = fake.pending[0]?.text ?? "";
    expect(stream.length).toBeGreaterThan(0);
    for (const character of stream.replaceAll(" ", "")) {
      expect(unlocked).toContain(character);
    }
  });

  it("can assess advancement from onboarding long-copy shortcut without auto-unlock", async () => {
    seedUnlockedCharacters(2);
    const fake = makeFakeAudio();
    renderLearn(fake.audio);

    fireEvent.click(screen.getByRole("button", { name: "Start long copy" }));
    await flush();

    const driver = learnDriver(fake);
    await driver.completeContinuousCopy();

    expect(
      screen.getByRole("heading", {
        name: "Looks like you’re ready for a new character!",
      }),
    ).toBeInTheDocument();
    const saved = JSON.parse(
      localStorage.getItem("k1frx.curriculum.v2") ?? "[]",
    ) as Array<{ character: string }>;
    expect(saved.map(({ character }) => character)).toEqual(["K", "M"]);
    expect(screen.getByRole("button", { name: "Learn U" })).toBeInTheDocument();
  });

  it("preserves Restart full lesson after a missed onboarding long-copy run", async () => {
    seedUnlockedCharacters(2);
    const fake = makeFakeAudio();
    renderLearn(fake.audio);

    fireEvent.click(screen.getByRole("button", { name: "Start long copy" }));
    await flush();

    const driver = learnDriver(fake);
    await driver.completeContinuousCopy((target) => "U".repeat(target.length));

    const restart = screen.getByRole("button", { name: "Restart full lesson" });
    expect(restart).toBeInTheDocument();
    fireEvent.click(restart);
    await flush();

    expect(driver.phase()).toBe("introduce");
    expect(screen.queryByLabelText("Continuous copy")).not.toBeInTheDocument();
  });

  it("exposes phase identity without relying on display text", async () => {
    localStorage.setItem("k1frx.introduced.v1", JSON.stringify(["K", "M"]));
    const fake = makeFakeAudio();
    renderLearn(fake.audio);
    const driver = learnDriver(fake);

    expect(driver.phase()).toBe("onboarding");
    await driver.start();
    expect(driver.phase()).toBe("contrast");
    await driver.advanceUntilPhase("groups-2");
    expect(driver.phase()).toBe("groups-2");
  });

  it("preserves every supported punctuation character", () => {
    expect(sanitizeCopyInput("a .,-=/ ?~")).toBe("A.,-=/?");
  });

  it("keeps isolated input enabled and defers mobile input until playback completes", async () => {
    const fake = makeFakeAudio();
    renderLearn(fake.audio);
    fireEvent.click(screen.getByRole("button", { name: "Start learning" }));
    await flush();
    await resolvePlay(fake);
    fireEvent.click(screen.getByRole("button", { name: "Start practice" }));
    await flush(); // acquire card presented, audio still playing (play #2 pending)

    const input = screen.getByLabelText("Your copy") as HTMLInputElement;
    input.focus();
    expect(input).toBeEnabled();
    fireEvent.change(input, { target: { value: "K" } });
    fireEvent.change(input, { target: { value: "M" } });
    fireEvent.change(input, { target: { value: "K" } });
    await flush();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(input).toHaveValue("");

    await resolvePlay(fake); // finish acquire audio
    expect(screen.getByRole("status")).toHaveTextContent("✓");
    expect(screen.getByLabelText("Your copy")).toBe(input);
    expect(input).toBeEnabled();
    expect(input).toHaveFocus();
  });

  it("accepts only one answer despite repeated input events", async () => {
    const fake = makeFakeAudio();
    renderLearn(fake.audio);
    await toFirstCopy(fake);

    const counterBefore = screen.getByLabelText(
      "Lesson card progress",
    ).textContent;
    const input = screen.getByLabelText("Your copy") as HTMLInputElement;
    // Simulate a held key firing several input events for one prompt.
    fireEvent.change(input, { target: { value: "K" } });
    fireEvent.change(input, { target: { value: "K" } });
    fireEvent.change(input, { target: { value: "K" } });
    await flush();

    // Feedback for exactly one accepted answer.
    expect(screen.getByRole("status")).toBeInTheDocument();
    // The completed-card counter advanced by exactly one after the hold.
    await tick(500);
    await resolvePlay(fake); // next prompt audio
    const counterAfter = screen.getByLabelText(
      "Lesson card progress",
    ).textContent;
    expect(counterAfter).not.toBe(counterBefore);
  });

  it("accepts one fresh same-key press during the next identical prompt playback", async () => {
    const fake = makeFakeAudio();
    renderLearn(fake.audio);
    await toFirstCopy(fake);

    fireEvent.keyDown(window, { key: "k", code: "KeyK" });
    fireEvent.keyUp(window, { key: "k", code: "KeyK" });
    await flush();
    expect(screen.getByRole("status")).toHaveTextContent("✓");

    await tick(450);
    expect(fake.pending[0]?.text).toBe("K");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    fireEvent.keyDown(window, { key: "k", code: "KeyK" });
    fireEvent.keyUp(window, { key: "k", code: "KeyK" });
    await flush();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    await resolvePlay(fake);
    expect(screen.getByRole("status")).toHaveTextContent("✓");
  });

  it("accepts K K K and M M from one physical keypress per prompt", async () => {
    const fake = makeFakeAudio();
    renderLearn(fake.audio);
    fireEvent.click(screen.getByRole("button", { name: "Start learning" }));
    await flush();
    await resolvePlay(fake);
    fireEvent.click(screen.getByRole("button", { name: "Start practice" }));
    await flush();

    for (const expected of Array.from({ length: 8 }, () => "K")) {
      await answerIsolatedWithPhysicalKey(fake, expected);
    }

    expect(fake.pending[0]?.text).toBe("M");
    await resolvePlay(fake);
    fireEvent.click(screen.getByRole("button", { name: "Start practice" }));
    await flush();
    for (const expected of ["M", "M"]) {
      await answerIsolatedWithPhysicalKey(fake, expected);
    }
  });

  it("keeps one focused mobile input through K K K and M M", async () => {
    const fake = makeFakeAudio();
    renderLearn(fake.audio);
    fireEvent.click(screen.getByRole("button", { name: "Start learning" }));
    await flush();
    await resolvePlay(fake);
    fireEvent.click(screen.getByRole("button", { name: "Start practice" }));
    await flush();

    const kInput = screen.getByLabelText("Your copy") as HTMLInputElement;
    kInput.focus();
    for (let attempt = 0; attempt < 8; attempt++) {
      await answerIsolatedWithMobileInput(fake, "K", kInput);
      if (attempt < 7) expect(kInput).toHaveFocus();
    }

    expect(fake.pending[0]?.text).toBe("M");
    await resolvePlay(fake);
    fireEvent.click(screen.getByRole("button", { name: "Start practice" }));
    await flush();
    const mInput = screen.getByLabelText("Your copy") as HTMLInputElement;
    mInput.focus();
    for (const expected of ["M", "M"]) {
      await answerIsolatedWithMobileInput(fake, expected, mInput);
      expect(mInput).toHaveFocus();
    }
  });

  it.each(["physical", "mobile"])(
    "accepts seeded K M K contrast through %s events",
    async (inputMode) => {
      vi.setSystemTime(1);
      localStorage.setItem("k1frx.introduced.v1", JSON.stringify(["K", "M"]));
      const fake = makeFakeAudio();
      renderLearn(fake.audio);
      fireEvent.click(screen.getByRole("button", { name: "Start learning" }));
      await flush();

      const input = screen.getByLabelText("Your copy") as HTMLInputElement;
      input.focus();
      for (const expected of ["M", "K", "M", "K"]) {
        if (inputMode === "physical") {
          await answerIsolatedWithPhysicalKey(fake, expected);
        } else {
          await answerIsolatedWithMobileInput(fake, expected, input);
          expect(input).toHaveFocus();
        }
      }
    },
  );

  it("rejects held repeats until keyup, then accepts a fresh same-key press", async () => {
    const fake = makeFakeAudio();
    renderLearn(fake.audio);
    await toFirstCopy(fake);

    fireEvent.keyDown(window, { key: "k", code: "KeyK" });
    await flush();
    await tick(450);
    expect(fake.pending[0]?.text).toBe("K");
    await resolvePlay(fake);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    fireEvent.keyDown(window, { key: "k", code: "KeyK", repeat: true });
    await flush();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    fireEvent.keyDown(window, { key: "k", code: "KeyK" });
    await flush();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    fireEvent.keyUp(window, { key: "k", code: "KeyK" });
    fireEvent.keyDown(window, { key: "k", code: "KeyK" });
    fireEvent.keyUp(window, { key: "k", code: "KeyK" });
    await flush();
    expect(screen.getByRole("status")).toHaveTextContent("✓");
  });

  it("lets multiple physical events claim a prompt only once", async () => {
    const fake = makeFakeAudio();
    renderLearn(fake.audio);
    await toFirstCopy(fake);

    fireEvent.keyDown(window, { key: "k", code: "KeyK" });
    fireEvent.keyDown(window, { key: "m", code: "KeyM" });
    fireEvent.keyDown(window, { key: "k", code: "KeyK", repeat: true });
    await flush();

    fireEvent.keyUp(window, { key: "k", code: "KeyK" });
    expect(screen.getByRole("status")).toBeInTheDocument();
    fireEvent.keyUp(window, { key: "k", code: "KeyK" });
    await tick(450);
    expect(fake.playCount()).toBe(1);
    expect(fake.pending[0]?.text).toBe("K");
  });

  it("clears physical-key membership on blur", async () => {
    const fake = makeFakeAudio();
    renderLearn(fake.audio);
    fireEvent.click(screen.getByRole("button", { name: "Start learning" }));
    await flush();
    await resolvePlay(fake);
    fireEvent.click(screen.getByRole("button", { name: "Start practice" }));
    await flush();

    fireEvent.keyDown(window, { key: "k", code: "KeyK" });
    fireEvent.blur(window);
    await resolvePlay(fake);
    fireEvent.keyDown(window, { key: "k", code: "KeyK" });
    await flush();

    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("does not carry physical-key state across unmount", async () => {
    const firstFake = makeFakeAudio();
    const firstView = renderLearn(firstFake.audio);
    await toFirstCopy(firstFake);
    fireEvent.keyDown(window, { key: "k", code: "KeyK" });
    await flush();
    firstView.unmount();
    await tick(1000);
    expect(firstFake.playCount()).toBe(0);

    const secondFake = makeFakeAudio();
    renderLearn(secondFake.audio);
    await toFirstCopy(secondFake);
    fireEvent.keyDown(window, { key: "k", code: "KeyK" });
    await flush();

    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("interrupts durable persistence when the screen unmounts", async () => {
    const fake = makeFakeAudio();
    const interrupt = vi.fn<LearnSessionPersistence["interrupt"]>(() =>
      Promise.resolve(),
    );
    const persistence: LearnSessionPersistence = {
      recordAttempt: () => Promise.resolve(),
      finish: () => Promise.resolve(),
      interrupt,
      acceptAdvancement: () => Promise.resolve(testCurriculum()),
      retry: () => Promise.resolve(),
    };
    const view = renderLearn(
      fake.audio,
      {},
      {
        startLearnSessionPersistence: () => Promise.resolve(persistence),
      },
    );
    fireEvent.click(screen.getByRole("button", { name: "Start learning" }));
    await flush();

    view.unmount();
    await flush();

    expect(interrupt).toHaveBeenCalledOnce();
    expect(interrupt.mock.calls[0]?.[0]).toMatchObject({
      completedCards: 0,
    });
  });

  it("interrupts durable persistence created after the screen unmounts", async () => {
    const fake = makeFakeAudio();
    let resolvePersistence:
      ((persistence: LearnSessionPersistence) => void) | undefined;
    const interrupt = vi.fn<LearnSessionPersistence["interrupt"]>(() =>
      Promise.resolve(),
    );
    const persistence: LearnSessionPersistence = {
      recordAttempt: () => Promise.resolve(),
      finish: () => Promise.resolve(),
      interrupt,
      acceptAdvancement: () => Promise.resolve(testCurriculum()),
      retry: () => Promise.resolve(),
    };
    const view = renderLearn(
      fake.audio,
      {},
      {
        startLearnSessionPersistence: () =>
          new Promise((resolve) => {
            resolvePersistence = resolve;
          }),
      },
    );
    fireEvent.click(screen.getByRole("button", { name: "Start learning" }));
    await flush();

    view.unmount();
    await act(async () => resolvePersistence?.(persistence));
    await flush();

    expect(interrupt).toHaveBeenCalledOnce();
  });

  it("surfaces and retries an ordinary attempt persistence failure", async () => {
    const fake = makeFakeAudio();
    const quotaError = Object.assign(new Error("quota exceeded"), {
      name: "QuotaExceededError",
    });
    const retry = vi.fn(() => Promise.resolve());
    const persistence: LearnSessionPersistence = {
      recordAttempt: () => Promise.reject(quotaError),
      finish: () => Promise.resolve(),
      interrupt: () => Promise.resolve(),
      acceptAdvancement: () => Promise.resolve(testCurriculum()),
      retry,
    };
    renderLearn(
      fake.audio,
      {},
      {
        startLearnSessionPersistence: () => Promise.resolve(persistence),
      },
    );
    await toFirstCopy(fake);

    fireEvent.change(screen.getByLabelText("Your copy"), {
      target: { value: "K" },
    });
    await flush();

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Your session could not be saved",
    );
    expect(screen.getByText("Save details")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Save details"));
    expect(
      screen.getByText(
        "Save failed (attempt): QuotaExceededError - quota exceeded | retries: 0",
      ),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Retry saving" }));
    await flush();

    expect(retry).toHaveBeenCalledOnce();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows retry progress while retrying an ordinary persistence failure", async () => {
    const fake = makeFakeAudio();
    let resolveRetry: (() => void) | undefined;
    const retry = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveRetry = resolve;
        }),
    );
    const persistence: LearnSessionPersistence = {
      recordAttempt: () => Promise.reject(new Error("quota exceeded")),
      finish: () => Promise.resolve(),
      interrupt: () => Promise.resolve(),
      acceptAdvancement: () => Promise.resolve(testCurriculum()),
      retry,
    };
    renderLearn(
      fake.audio,
      {},
      {
        startLearnSessionPersistence: () => Promise.resolve(persistence),
      },
    );
    await toFirstCopy(fake);

    fireEvent.change(screen.getByLabelText("Your copy"), {
      target: { value: "K" },
    });
    await flush();

    fireEvent.click(screen.getByRole("button", { name: "Retry saving" }));
    await flush();

    expect(screen.getByText("Retrying save...")).toBeInTheDocument();
    expect(retry).toHaveBeenCalledOnce();

    await act(async () => resolveRetry?.());
    await flush();

    expect(screen.queryByText("Retrying save...")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows updated diagnostics when a retry fails again", async () => {
    const fake = makeFakeAudio();
    let rejectRetry: ((error: Error) => void) | undefined;
    const initialError = Object.assign(new Error("quota exceeded"), {
      name: "QuotaExceededError",
    });
    const retryError = Object.assign(new Error("transaction was aborted"), {
      name: "AbortError",
    });
    const retry = vi.fn(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectRetry = reject;
        }),
    );
    const persistence: LearnSessionPersistence = {
      recordAttempt: () => Promise.reject(initialError),
      finish: () => Promise.resolve(),
      interrupt: () => Promise.resolve(),
      acceptAdvancement: () => Promise.resolve(testCurriculum()),
      retry,
    };
    renderLearn(
      fake.audio,
      {},
      {
        startLearnSessionPersistence: () => Promise.resolve(persistence),
      },
    );
    await toFirstCopy(fake);

    fireEvent.change(screen.getByLabelText("Your copy"), {
      target: { value: "K" },
    });
    await flush();

    fireEvent.click(screen.getByRole("button", { name: "Retry saving" }));
    await flush();
    expect(screen.getByText("Retrying save...")).toBeInTheDocument();

    await act(async () => rejectRetry?.(retryError));
    await flush();

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Your session could not be saved",
    );
    fireEvent.click(screen.getByText("Save details"));
    expect(
      screen.getByText(
        "Save failed (attempt): AbortError - transaction was aborted | retries: 1",
      ),
    ).toBeInTheDocument();
  });

  it("shows Retrying save while onboarding session-start retry is pending", async () => {
    const fake = makeFakeAudio();
    let resolveRetryStart:
      ((persistence: LearnSessionPersistence) => void) | undefined;
    const firstError = Object.assign(new Error("quota exceeded"), {
      name: "QuotaExceededError",
    });
    const startLearnSessionPersistence = vi
      .fn<
        (options: LearnPersistenceStart) => Promise<LearnSessionPersistence>
      >()
      .mockRejectedValueOnce(firstError)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveRetryStart = resolve;
          }),
      );
    renderLearn(
      fake.audio,
      {},
      {
        startLearnSessionPersistence,
      },
    );

    fireEvent.click(screen.getByRole("button", { name: "Start learning" }));
    await flush();

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Your session could not be saved",
    );

    fireEvent.click(screen.getByRole("button", { name: "Retry saving" }));
    await flush();

    expect(screen.getByText("Retrying save...")).toBeInTheDocument();

    await act(async () =>
      resolveRetryStart?.({
        recordAttempt: () => Promise.resolve(),
        finish: () => Promise.resolve(),
        interrupt: () => Promise.resolve(),
        acceptAdvancement: () => Promise.resolve(testCurriculum()),
        retry: () => Promise.resolve(),
      }),
    );
    await flush();

    expect(screen.queryByText("Retrying save...")).not.toBeInTheDocument();
  });

  it("increments retry count for repeated session-start failures", async () => {
    const fake = makeFakeAudio();
    const firstError = Object.assign(new Error("quota exceeded"), {
      name: "QuotaExceededError",
    });
    const secondError = Object.assign(new Error("transaction was aborted"), {
      name: "AbortError",
    });
    const startLearnSessionPersistence = vi
      .fn<
        (options: LearnPersistenceStart) => Promise<LearnSessionPersistence>
      >()
      .mockRejectedValueOnce(firstError)
      .mockRejectedValueOnce(secondError);
    renderLearn(
      fake.audio,
      {},
      {
        startLearnSessionPersistence,
      },
    );

    fireEvent.click(screen.getByRole("button", { name: "Start learning" }));
    await flush();

    fireEvent.click(screen.getByRole("button", { name: "Retry saving" }));
    await flush();

    fireEvent.click(screen.getByText("Save details"));
    expect(
      screen.getByText(
        "Save failed (session-start): AbortError - transaction was aborted | retries: 1",
      ),
    ).toBeInTheDocument();
  });

  it("accepts mobile-style change events", async () => {
    const fake = makeFakeAudio();
    renderLearn(fake.audio);
    await toFirstCopy(fake);

    fireEvent.change(screen.getByLabelText("Your copy"), {
      target: { value: "K" },
    });
    await flush();
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("accepts composition input only after composition ends", async () => {
    const fake = makeFakeAudio();
    renderLearn(fake.audio);
    await toFirstCopy(fake);

    const input = screen.getByLabelText("Your copy") as HTMLInputElement;
    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: "K" } });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    fireEvent.compositionEnd(input, { data: "K" });
    await flush();
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("defers composition input during playback until composition and audio end", async () => {
    const fake = makeFakeAudio();
    renderLearn(fake.audio);
    fireEvent.click(screen.getByRole("button", { name: "Start learning" }));
    await flush();
    await resolvePlay(fake);
    fireEvent.click(screen.getByRole("button", { name: "Start practice" }));
    await flush();

    const input = screen.getByLabelText("Your copy") as HTMLInputElement;
    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: "K" } });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    fireEvent.compositionEnd(input, { data: "K" });
    await flush();
    expect(input).toHaveValue("");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    await resolvePlay(fake);
    expect(screen.getByRole("status")).toHaveTextContent("✓");
  });

  it("does not submit on a modifier-Enter", async () => {
    const fake = makeFakeAudio();
    renderLearn(fake.audio);
    await toFirstCopy(fake);
    const input = screen.getByLabelText("Your copy") as HTMLInputElement;
    fireEvent.keyDown(input, { key: "Enter", ctrlKey: true });
    await flush();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("does not submit printable modifier combinations", async () => {
    const fake = makeFakeAudio();
    renderLearn(fake.audio);
    await toFirstCopy(fake);

    fireEvent.keyDown(window, {
      key: "k",
      code: "KeyK",
      ctrlKey: true,
    });
    await flush();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("does not treat browser key names as printable answers", async () => {
    const fake = makeFakeAudio();
    renderLearn(fake.audio);
    await toFirstCopy(fake);

    fireEvent.keyDown(window, { key: "Dead", code: "Quote" });
    await flush();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("accepts at most the first supported character from a paste change", async () => {
    const fake = makeFakeAudio();
    renderLearn(fake.audio);
    await toFirstCopy(fake);

    fireEvent.change(screen.getByLabelText("Your copy"), {
      target: { value: "KM" },
    });
    await flush();
    expect(screen.getByRole("status")).toHaveTextContent("✓");
    expect(fake.playCount()).toBe(0);
  });
});

describe("LearnScreen audio sequencing", () => {
  it.each(["auto", "manual"])(
    "plays one introduction and waits indefinitely with %s pacing",
    async (pacing) => {
      const fake = makeFakeAudio();
      renderLearn(fake.audio, { pacing: pacing as "auto" | "manual" });

      fireEvent.click(screen.getByRole("button", { name: "Start learning" }));
      await flush();

      expect(fake.played).toEqual(["K"]);
      expect(screen.getByText("K")).toBeInTheDocument();
      expect(screen.getByText("-.-")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Replay" })).toBeDisabled();
      expect(
        screen.getByRole("button", { name: "Start practice" }),
      ).toBeDisabled();

      await tick(60000);
      expect(fake.played).toEqual(["K"]);
      expect(screen.queryByLabelText("Your copy")).not.toBeInTheDocument();

      await resolvePlay(fake);
      expect(
        screen.getByText(
          "Replay it as often as you like. Start practice when the sound feels familiar.",
        ),
      ).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Replay" })).toBeEnabled();
      expect(
        screen.getByRole("button", { name: "Start practice" }),
      ).toBeEnabled();

      await tick(60000);
      expect(fake.played).toEqual(["K"]);
      expect(screen.getByText("K")).toBeInTheDocument();
      expect(screen.getByText("-.-")).toBeInTheDocument();
      expect(screen.queryByLabelText("Your copy")).not.toBeInTheDocument();
    },
  );

  it("serializes unlimited introduction replays", async () => {
    const fake = makeFakeAudio();
    renderLearn(fake.audio);
    fireEvent.click(screen.getByRole("button", { name: "Start learning" }));
    await flush();
    await resolvePlay(fake);

    for (let replayNumber = 1; replayNumber <= 3; replayNumber++) {
      const replay = screen.getByRole("button", { name: "Replay" });
      const startPractice = screen.getByRole("button", {
        name: "Start practice",
      });
      fireEvent.click(replay);
      fireEvent.click(replay);
      await flush();
      expect(fake.played).toHaveLength(replayNumber + 1);
      expect(fake.playCount()).toBe(1);
      expect(replay).toBeDisabled();
      expect(startPractice).toBeDisabled();
      await tick(10000);
      expect(fake.played).toHaveLength(replayNumber + 1);
      await resolvePlay(fake);
      expect(screen.getByRole("button", { name: "Replay" })).toBeEnabled();
      expect(
        screen.getByRole("button", { name: "Start practice" }),
      ).toBeEnabled();
    }

    expect(fake.played).toEqual(["K", "K", "K", "K"]);
    expect(screen.queryByLabelText("Your copy")).not.toBeInTheDocument();
  });

  it("advances only through Start practice and plays acquisition once", async () => {
    const fake = makeFakeAudio();
    renderLearn(fake.audio);
    fireEvent.click(screen.getByRole("button", { name: "Start learning" }));
    await flush();
    await resolvePlay(fake);
    await tick(60000);

    expect(fake.played).toEqual(["K"]);
    fireEvent.click(screen.getByRole("button", { name: "Start practice" }));
    await flush();

    expect(screen.getByLabelText("Your copy")).toBeEnabled();
    expect(fake.played).toEqual(["K", "K"]);
    expect(fake.playCount()).toBe(1);
    await tick(60000);
    expect(fake.played).toEqual(["K", "K"]);
    await resolvePlay(fake);
    expect(screen.getByLabelText("Your copy")).toBeEnabled();
  });

  it.each(["initial play", "replay"])(
    "ending during an introduction %s prevents stale advancement",
    async (stage) => {
      const fake = makeFakeAudio();
      fake.audio.cancelAndSuspend = () => Promise.resolve();
      renderLearn(fake.audio);
      fireEvent.click(screen.getByRole("button", { name: "Start learning" }));
      await flush();
      if (stage === "replay") {
        await resolvePlay(fake);
        fireEvent.click(screen.getByRole("button", { name: "Replay" }));
        await flush();
      }
      const staleIndex = fake.pending.length - 1;

      fireEvent.click(screen.getByRole("button", { name: "End session" }));
      await flush();
      fake.resolveAt(staleIndex);
      await flush();
      await tick(60000);

      expect(
        screen.getByRole("heading", { name: "Session complete" }),
      ).toBeInTheDocument();
      expect(screen.queryByLabelText("Your copy")).not.toBeInTheDocument();
    },
  );

  it("does not persist an introduction until Start practice", async () => {
    const fake = makeFakeAudio();
    renderLearn(fake.audio);
    fireEvent.click(screen.getByRole("button", { name: "Start learning" }));
    await flush();
    await resolvePlay(fake);
    fireEvent.click(screen.getByRole("button", { name: "End session" }));
    await flush();
    expect(
      JSON.parse(localStorage.getItem("k1frx.introduced.v1") ?? "[]"),
    ).not.toContain("K");

    fireEvent.click(
      screen.getByRole("button", { name: "Restart full lesson" }),
    );
    await flush();
    expect(screen.getByText("K")).toBeInTheDocument();
    await resolvePlay(fake);
    fireEvent.click(screen.getByRole("button", { name: "Start practice" }));
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "End session" }));
    await flush();
    expect(
      JSON.parse(localStorage.getItem("k1frx.introduced.v1") ?? "[]"),
    ).toContain("K");
  });

  it.each(["initial play", "replay"])(
    "does not let stale %s completion affect a restarted lesson",
    async (stage) => {
      const fake = makeFakeAudio();
      fake.audio.cancel = () => Promise.resolve();
      fake.audio.cancelAndSuspend = () => Promise.resolve();
      renderLearn(fake.audio);
      fireEvent.click(screen.getByRole("button", { name: "Start learning" }));
      await flush();
      if (stage === "replay") {
        await resolvePlay(fake);
        fireEvent.click(screen.getByRole("button", { name: "Replay" }));
        await flush();
      }
      const staleIndex = fake.pending.length - 1;

      fireEvent.click(screen.getByRole("button", { name: "End session" }));
      await flush();
      fireEvent.click(
        screen.getByRole("button", {
          name: "Restart full lesson",
        }),
      );
      await flush();
      fake.resolveAt(staleIndex);
      await flush();

      expect(screen.getByRole("button", { name: "Replay" })).toBeDisabled();
      expect(
        screen.getByRole("button", { name: "Start practice" }),
      ).toBeDisabled();
      expect(screen.getByText("K")).toBeInTheDocument();
      expect(screen.queryByLabelText("Your copy")).not.toBeInTheDocument();
    },
  );

  it.each(["initial play", "replay"])(
    "prevents stale %s completion after navigating away",
    async (stage) => {
      const fake = makeFakeAudio();
      fake.audio.cancelAndSuspend = () => Promise.resolve();
      renderApp(fake.audio);
      fireEvent.click(screen.getByRole("button", { name: "Start learning" }));
      await flush();
      if (stage === "replay") {
        await resolvePlay(fake);
        fireEvent.click(screen.getByRole("button", { name: "Replay" }));
        await flush();
      }
      const staleIndex = fake.pending.length - 1;

      fireEvent.click(screen.getByRole("link", { name: "Practice" }));
      await flush();
      fake.resolveAt(staleIndex);
      await flush();
      await tick(60000);

      expect(
        screen.getByRole("heading", { name: "Practice" }),
      ).toBeInTheDocument();
      expect(screen.queryByLabelText("Your copy")).not.toBeInTheDocument();
    },
  );

  it.each(["initial play", "replay"])(
    "settles an active introduction %s when unmounted",
    async (stage) => {
      const fake = makeFakeAudio();
      const view = renderLearn(fake.audio);
      fireEvent.click(screen.getByRole("button", { name: "Start learning" }));
      await flush();
      if (stage === "replay") {
        await resolvePlay(fake);
        fireEvent.click(screen.getByRole("button", { name: "Replay" }));
        await flush();
      }

      view.unmount();
      await flush();
      expect(fake.playCount()).toBe(0);
    },
  );

  it("does not present the next card until corrective replay resolves", async () => {
    const fake = makeFakeAudio();
    renderLearn(fake.audio);
    await toFirstCopy(fake);

    const input = screen.getByLabelText("Your copy") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Z" } }); // wrong (Z not active)
    await flush();
    // A corrective replay is queued; only that one playback is pending.
    expect(fake.playCount()).toBe(1);
    // Advancing the hold timer must not skip the unresolved corrective playback.
    await tick(1000);
    expect(fake.playCount()).toBe(1);

    await resolvePlay(fake); // corrective replay completes
    await tick(500); // miss hold
    await resolvePlay(fake); // now the next prompt plays
    expect(screen.getByLabelText("Your copy")).toBeInTheDocument();
  });

  it("ending the session invalidates pending advancement", async () => {
    const fake = makeFakeAudio();
    renderLearn(fake.audio);
    await toFirstCopy(fake);

    const input = screen.getByLabelText("Your copy") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "K" } }); // correct
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "End session" }));
    await flush();
    await tick(1000); // any pending advance must be invalidated

    expect(
      screen.getByRole("heading", { name: "Session complete" }),
    ).toBeInTheDocument();
  });

  it("discards queued isolated input when the session ends", async () => {
    const fake = makeFakeAudio();
    renderLearn(fake.audio);
    fireEvent.click(screen.getByRole("button", { name: "Start learning" }));
    await flush();
    await resolvePlay(fake);
    fireEvent.click(screen.getByRole("button", { name: "Start practice" }));
    await flush();

    fireEvent.change(screen.getByLabelText("Your copy"), {
      target: { value: "K" },
    });
    fireEvent.click(screen.getByRole("button", { name: "End session" }));
    await flush();
    await tick(1000);

    expect(
      screen.getByRole("heading", { name: "Session complete" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(
      screen.getByText(/Cards: 1 · scored attempts: 0/),
    ).toBeInTheDocument();
  });

  it("discards queued isolated input after navigating away", async () => {
    const fake = makeFakeAudio();
    fake.audio.cancelAndSuspend = () => Promise.resolve();
    renderApp(fake.audio);
    fireEvent.click(screen.getByRole("button", { name: "Start learning" }));
    await flush();
    await resolvePlay(fake);
    fireEvent.click(screen.getByRole("button", { name: "Start practice" }));
    await flush();
    const staleIndex = fake.pending.length - 1;

    fireEvent.change(screen.getByLabelText("Your copy"), {
      target: { value: "K" },
    });
    fireEvent.click(screen.getByRole("link", { name: "Practice" }));
    await flush();
    fake.resolveAt(staleIndex);
    await flush();
    await tick(1000);

    expect(
      screen.getByRole("heading", { name: "Practice" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("discards queued isolated input when the screen unmounts", async () => {
    const fake = makeFakeAudio();
    const view = renderLearn(fake.audio);
    fireEvent.click(screen.getByRole("button", { name: "Start learning" }));
    await flush();
    await resolvePlay(fake);
    fireEvent.click(screen.getByRole("button", { name: "Start practice" }));
    await flush();

    fireEvent.change(screen.getByLabelText("Your copy"), {
      target: { value: "K" },
    });
    view.unmount();
    await flush();
    await tick(1000);

    expect(fake.playCount()).toBe(0);
  });

  it("plays a replay only once even with repeated clicks", async () => {
    const fake = makeFakeAudio();
    renderLearn(fake.audio);
    await toFirstCopy(fake);

    const replay = screen.getByRole("button", { name: "Replay" });
    fireEvent.click(replay);
    await flush();
    expect(fake.playCount()).toBe(1);
    fireEvent.click(replay); // disabled / guarded while playing
    fireEvent.click(replay);
    await flush();
    expect(fake.playCount()).toBe(1);
  });

  it("keeps isolated input enabled and defers its answer during Replay", async () => {
    const fake = makeFakeAudio();
    renderLearn(fake.audio);
    await toFirstCopy(fake);

    const input = screen.getByLabelText("Your copy") as HTMLInputElement;
    fireEvent.click(screen.getByRole("button", { name: "Replay" }));
    await flush();
    expect(input).toBeEnabled();
    fireEvent.change(input, { target: { value: "K" } });
    await flush();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(input).toHaveValue("");

    await resolvePlay(fake);
    expect(screen.getByRole("status")).toHaveTextContent("✓");
    expect(screen.getByLabelText("Your copy")).toBe(input);
    expect(input).toBeEnabled();
  });

  it("does not let stale Replay completion clear newer playback state", async () => {
    const fake = makeFakeAudio();
    fake.audio.cancel = () => Promise.resolve();
    fake.audio.cancelAndSuspend = () => Promise.resolve();
    renderLearn(fake.audio);
    await toFirstCopy(fake);

    fireEvent.click(screen.getByRole("button", { name: "Replay" }));
    await flush();
    fireEvent.change(screen.getByLabelText("Your copy"), {
      target: { value: "K" },
    });
    await flush();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "End session" }));
    await flush();
    fireEvent.click(
      screen.getByRole("button", { name: "Restart full lesson" }),
    );
    await flush();
    expect(fake.playCount()).toBe(2);

    await act(async () => {
      fake.resolveAt(0);
      await Promise.resolve();
    });
    expect(
      screen.getByRole("button", { name: "Start practice" }),
    ).toBeDisabled();
  });

  it("settles active playback when the screen unmounts", async () => {
    const fake = makeFakeAudio();
    const view = renderLearn(fake.audio);
    fireEvent.click(screen.getByRole("button", { name: "Start learning" }));
    await flush();
    expect(fake.playCount()).toBe(1);

    view.unmount();
    await flush();
    expect(fake.playCount()).toBe(0);
  });

  it("waits for Go before starting multi-character audio", async () => {
    const fake = makeFakeAudio();
    renderLearn(fake.audio);
    await toMultiCharacterTransition(fake);

    expect(
      screen.getByRole("heading", { name: "Ready for something longer?" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Single-character copy")).toBeInTheDocument();
    expect(fake.playCount()).toBe(0);

    fireEvent.click(screen.getByRole("button", { name: "Go" }));
    await flush();
    expect(screen.getByText("2-character groups")).toBeInTheDocument();
    expect(fake.pending[0]?.text).toHaveLength(2);
  });

  it("submits a short group early on Enter", async () => {
    const fake = makeFakeAudio();
    renderLearn(fake.audio);
    await toMultiCharacterTransition(fake);
    fireEvent.click(screen.getByRole("button", { name: "Go" }));
    await flush();
    const target = fake.pending[0]?.text ?? "KM";
    await resolvePlay(fake);

    const input = screen.getByLabelText("Your copy");
    fireEvent.change(input, { target: { value: target[0] } });
    fireEvent.keyDown(input, { key: "Enter" });
    await flush();
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("accepts group typing during playback without grading early", async () => {
    const fake = makeFakeAudio();
    renderLearn(fake.audio);
    await toMultiCharacterTransition(fake);
    fireEvent.click(screen.getByRole("button", { name: "Go" }));
    await flush();
    const target = fake.pending[0]?.text ?? "KM";
    const input = screen.getByLabelText("Your copy") as HTMLInputElement;

    expect(input).toBeEnabled();
    fireEvent.change(input, { target: { value: target } });
    await flush();
    expect(input).toHaveValue(target);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(fake.playCount()).toBe(1);

    await resolvePlay(fake);
    expect(screen.getByRole("status")).toHaveTextContent("✓");
  });

  it("cancels automatic group submission after backspacing during playback", async () => {
    const fake = makeFakeAudio();
    renderLearn(fake.audio);
    await toMultiCharacterTransition(fake);
    fireEvent.click(screen.getByRole("button", { name: "Go" }));
    await flush();
    const target = fake.pending[0]?.text ?? "KM";
    const input = screen.getByLabelText("Your copy");

    fireEvent.change(input, { target: { value: target } });
    fireEvent.change(input, { target: { value: target[0] } });
    await resolvePlay(fake);

    expect(input).toHaveValue(target[0]);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("uses the live field value for Enter queued during playback", async () => {
    const fake = makeFakeAudio();
    renderLearn(fake.audio);
    await toMultiCharacterTransition(fake);
    fireEvent.click(screen.getByRole("button", { name: "Go" }));
    await flush();
    const target = fake.pending[0]?.text ?? "KM";
    const input = screen.getByLabelText("Your copy");

    fireEvent.change(input, { target: { value: target[0] } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.change(input, { target: { value: target } });
    await flush();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    await resolvePlay(fake);
    expect(screen.getByRole("status")).toHaveTextContent("✓");
  });

  it("preserves and submits type-behind input during group replay", async () => {
    const fake = makeFakeAudio();
    renderLearn(fake.audio);
    await toMultiCharacterTransition(fake);
    fireEvent.click(screen.getByRole("button", { name: "Go" }));
    await flush();
    const target = fake.pending[0]?.text ?? "KM";
    await resolvePlay(fake);
    const input = screen.getByLabelText("Your copy") as HTMLInputElement;
    fireEvent.change(input, { target: { value: target[0] } });

    fireEvent.click(screen.getByRole("button", { name: "Replay" }));
    await flush();
    expect(input).toBeEnabled();
    expect(input).toHaveValue(target[0]);
    fireEvent.change(input, { target: { value: target } });
    await flush();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    await resolvePlay(fake);
    expect(screen.getByRole("status")).toHaveTextContent("✓");
  });

  it("discards queued group submission when the session ends", async () => {
    const fake = makeFakeAudio();
    renderLearn(fake.audio);
    await toMultiCharacterTransition(fake);
    fireEvent.click(screen.getByRole("button", { name: "Go" }));
    await flush();
    const target = fake.pending[0]?.text ?? "KM";
    fireEvent.change(screen.getByLabelText("Your copy"), {
      target: { value: target },
    });
    fireEvent.click(screen.getByRole("button", { name: "End session" }));
    await flush();

    expect(
      screen.getByRole("heading", { name: "Session complete" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("keeps manual pacing coherent after queued group submission", async () => {
    const fake = makeFakeAudio();
    renderLearn(fake.audio, { pacing: "manual" });
    await toMultiCharacterTransition(fake);
    fireEvent.click(screen.getByRole("button", { name: "Go" }));
    await flush();
    const target = fake.pending[0]?.text ?? "KM";
    fireEvent.change(screen.getByLabelText("Your copy"), {
      target: { value: target },
    });
    await resolvePlay(fake);

    expect(screen.getByRole("status")).toHaveTextContent("✓");
    expect(fake.playCount()).toBe(0);
    expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled();
  });

  it("waits for slow-setting audio before grading or corrective playback", async () => {
    const fake = makeFakeAudio();
    renderLearn(fake.audio, { charWpm: 8, effectiveWpm: 5 });
    await toMultiCharacterTransition(fake);
    fireEvent.click(screen.getByRole("button", { name: "Go" }));
    await flush();
    const target = fake.pending[0]?.text ?? "KM";
    const wrong = target === "KM" ? "MK" : "KM";
    fireEvent.change(screen.getByLabelText("Your copy"), {
      target: { value: wrong },
    });
    await flush();

    expect(fake.playCount()).toBe(1);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    await resolvePlay(fake);
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(fake.playCount()).toBe(1);
  });

  it("announces three-character groups and accepts any key to continue", async () => {
    const fake = makeFakeAudio();
    renderLearn(fake.audio);
    await toThreeCharacterNotice(fake);

    expect(
      screen.getByRole("heading", {
        name: "Now copying 3-character groups",
      }),
    ).toBeInTheDocument();
    expect(fake.playCount()).toBe(0);
    fireEvent.keyDown(window, { key: "x", code: "KeyX" });
    await flush();
    expect(fake.pending[0]?.text).toHaveLength(3);
    fireEvent.keyDown(window, { key: "x", code: "KeyX" });
    await flush();
    expect(fake.playCount()).toBe(1);
  });

  it("does not auto-continue the group notice after its named delay", async () => {
    const fake = makeFakeAudio();
    renderLearn(fake.audio);
    await toThreeCharacterNotice(fake);

    await tick(1800);
    expect(
      screen.getByRole("heading", {
        name: "Now copying 3-character groups",
      }),
    ).toBeInTheDocument();
    expect(fake.playCount()).toBe(0);
  });

  it("advances from the group notice only when the user clicks Go", async () => {
    const fake = makeFakeAudio();
    renderLearn(fake.audio);
    await toThreeCharacterNotice(fake);

    await tick(5000);
    expect(fake.playCount()).toBe(0);
    fireEvent.click(screen.getByRole("button", { name: "Go" }));
    await flush();
    expect(fake.pending[0]?.text).toHaveLength(3);
    expect(fake.playCount()).toBe(1);
  });

  it("starts one continuous schedule and keeps copy input active during playback", async () => {
    const fake = makeFakeAudio();
    renderLearn(fake.audio);
    await toContinuousCopyTransition(fake);

    expect(
      screen.getByRole("heading", { name: "Ready for continuous copy?" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Recommended for your active set: 1 minute/),
    ).toBeInTheDocument();
    expect(fake.playCount()).toBe(0);
    fireEvent.click(screen.getByRole("button", { name: "Go" }));
    await flush();

    expect(fake.playCount()).toBe(1);
    expect(fake.pending[0]?.schedule?.totalMs).toBeGreaterThanOrEqual(60000);
    expect(screen.getByRole("status")).toHaveTextContent("Listening…");
    const input = screen.getByLabelText(
      "Continuous copy",
    ) as HTMLTextAreaElement;
    expect(input).toBeEnabled();
    fireEvent.change(input, { target: { value: "KM KM" } });
    expect(input).toHaveValue("KM KM");
    expect(
      screen.queryByRole("button", { name: "Replay" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/characters$/)).not.toBeInTheDocument();
  });

  it("uses the learner's selected continuous-copy duration", async () => {
    const fake = makeFakeAudio();
    renderLearn(fake.audio, { continuousCopyDurationMs: 180000 });
    await toContinuousCopyTransition(fake);

    expect(screen.getByText(/Selected: 3 minutes/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Go" }));
    await flush();
    expect(fake.pending[0]?.schedule?.totalMs).toBeGreaterThanOrEqual(180000);
  });

  it("keeps input through the grace period and then shows aligned results", async () => {
    const fake = makeFakeAudio();
    renderLearn(fake.audio);
    await toContinuousCopyTransition(fake);
    fireEvent.click(screen.getByRole("button", { name: "Go" }));
    await flush();

    const input = screen.getByLabelText("Continuous copy");
    fireEvent.change(input, { target: { value: "KM" } });
    await resolvePlay(fake);
    expect(screen.getByRole("status")).toHaveTextContent("Finishing…");
    expect(input).toBeEnabled();
    expect(input).toHaveValue("KM");

    await tick(2000);
    expect(
      screen.getByRole("heading", { name: "Copy complete" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/aligned accuracy/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await flush();
    expect(
      screen.getByRole("heading", { name: "Session complete" }),
    ).toBeInTheDocument();
  });

  it("discards an intentionally ended stream from practice", async () => {
    const fake = makeFakeAudio();
    renderLearn(fake.audio);
    await toContinuousCopyTransition(fake);
    fireEvent.click(screen.getByRole("button", { name: "Go" }));
    await flush();
    fireEvent.change(screen.getByLabelText("Continuous copy"), {
      target: { value: "KM" },
    });
    await tick(500);

    fireEvent.click(screen.getByRole("button", { name: "End session" }));
    await flush();

    expect(
      screen.getByRole("heading", { name: "Session complete" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/ended early and was not counted/),
    ).toBeInTheDocument();
    expect(fake.playCount()).toBe(0);
  });

  it("runs type-behind word copy before eligible continuous copy", async () => {
    const state = createInitialState(DEFAULT_CURRICULUM_CONFIG);
    while (state.characters.length < 10) forceUnlockNext(state);
    const active = state.characters.map((character) => character.character);
    localStorage.setItem(
      "k1frx.curriculum.v2",
      JSON.stringify(state.characters),
    );
    localStorage.setItem("k1frx.introduced.v1", JSON.stringify(active));
    const fake = makeFakeAudio();
    renderLearn(fake.audio);
    await toContinuousCopyTransition(fake);

    expect(
      screen.getByRole("heading", { name: "Ready to copy words?" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/complete word rhythms/)).toBeInTheDocument();
    expect(fake.playCount()).toBe(0);
    fireEvent.click(screen.getByRole("button", { name: "Go" }));
    await flush();
    const driver = learnDriver(fake);
    let completedWords = 0;
    while (driver.phase() === "words") {
      const target = fake.pending[0]?.text ?? "";
      expect(target.length).toBeGreaterThanOrEqual(2);
      expect([...target].every((character) => active.includes(character))).toBe(
        true,
      );
      expect(screen.queryByText(/characters/)).not.toBeInTheDocument();
      const input = screen.getByLabelText("Your copy") as HTMLInputElement;
      expect(input).toBeEnabled();
      await driver.answerCurrentPrompt(target);
      completedWords += 1;
    }
    expect(completedWords).toBe(DEFAULT_LESSON_CONFIG.wordCopyCount);

    expect(
      screen.getByRole("heading", { name: "Ready for continuous copy?" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Go" }));
    await flush();
    expect(fake.pending[0]?.schedule?.totalMs).toBeGreaterThanOrEqual(60000);
  });
});

describe("LearnScreen advancement", () => {
  async function completeContinuousCopy(
    fake: ReturnType<typeof makeFakeAudio>,
    answer?: (target: string) => string,
  ) {
    await toContinuousCopyTransition(fake);
    const driver = learnDriver(fake);
    const target = await driver.completeContinuousCopy(
      answer ? (currentTarget) => answer(currentTarget) : undefined,
    );
    expect(target.length).toBeGreaterThanOrEqual(24);
    return target;
  }

  it("offers actual metrics and unlocks only U into its introduction", async () => {
    const fake = makeFakeAudio();
    const acceptAdvancement = vi.fn((acceptance: AdvancementAcceptance) =>
      Promise.resolve(acceptedCurriculum(acceptance)),
    );
    const onSaveCurriculum = vi.fn();
    const onReconcileCurriculum = vi.fn();
    renderLearn(
      fake.audio,
      {},
      {
        acceptAdvancement,
        onSaveCurriculum,
        onReconcileCurriculum,
      },
    );
    await completeContinuousCopy(fake);
    const savesBeforeAcceptance = onSaveCurriculum.mock.calls.length;

    expect(
      screen.getByRole("heading", {
        name: "Looks like you’re ready for a new character!",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("You copied 100% overall and 100% of M."),
    ).toBeInTheDocument();
    const learnNext = screen.getByRole("button", { name: "Learn U" });
    fireEvent.click(learnNext);
    fireEvent.click(learnNext);
    await flush();

    expect(acceptAdvancement).toHaveBeenCalledOnce();
    expect(onSaveCurriculum).toHaveBeenCalledTimes(savesBeforeAcceptance);
    expect(onReconcileCurriculum).toHaveBeenCalledOnce();
    const saved = JSON.parse(
      localStorage.getItem("k1frx.curriculum.v2") ?? "[]",
    ) as Array<{ character: string }>;
    expect(saved.map(({ character }) => character)).toEqual(["K", "M", "U"]);
    expect(fake.pending[0]?.text).toBe("U");
    expect(screen.getByText("U")).toBeInTheDocument();
    await resolvePlay(fake);
    await tick(60000);
    expect(screen.getByText("U")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Start practice" }),
    ).toBeEnabled();
  });

  it("retains the advancement offer and retries before starting the next lesson", async () => {
    const fake = makeFakeAudio();
    let rejectAcceptance: ((error: Error) => void) | undefined;
    const acceptAdvancement = vi
      .fn<LearnSessionPersistence["acceptAdvancement"]>()
      .mockImplementationOnce(
        () =>
          new Promise<ReturnType<typeof testCurriculum>>((_resolve, reject) => {
            rejectAcceptance = reject;
          }),
      )
      .mockImplementation((acceptance) =>
        Promise.resolve(acceptedCurriculum(acceptance)),
      );
    const persistence: LearnSessionPersistence = {
      recordAttempt: () => Promise.resolve(),
      finish: () => Promise.resolve(),
      interrupt: () => Promise.resolve(),
      acceptAdvancement,
      retry: () => Promise.resolve(),
    };
    const startLearnSessionPersistence = vi.fn(() =>
      Promise.resolve(persistence),
    );
    renderLearn(
      fake.audio,
      {},
      {
        startLearnSessionPersistence,
      },
    );
    await completeContinuousCopy(fake);

    fireEvent.click(screen.getByRole("button", { name: "Learn U" }));
    expect(screen.getByRole("status")).toHaveTextContent("Saving session");
    expect(screen.getByRole("button", { name: "Learn U" })).toBeDisabled();
    expect(fake.pending[0]).toBeUndefined();
    expect(startLearnSessionPersistence).toHaveBeenCalledOnce();

    await act(async () => rejectAcceptance?.(new Error("quota exceeded")));
    await flush();

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Your session could not be saved",
    );
    expect(screen.getByRole("button", { name: "Learn U" })).toBeDisabled();
    expect(
      JSON.parse(localStorage.getItem("k1frx.curriculum.v2") ?? "[]") as Array<{
        character: string;
      }>,
    ).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: "Retry saving" }));
    await flush();
    await flush();

    expect(acceptAdvancement).toHaveBeenCalledTimes(2);
    expect(startLearnSessionPersistence).toHaveBeenCalledTimes(2);
    expect(acceptAdvancement.mock.calls[0]?.[0]).toEqual({
      type: "character-unlocked",
      character: "U",
    });
    const saved = JSON.parse(
      localStorage.getItem("k1frx.curriculum.v2") ?? "[]",
    ) as Array<{ character: string }>;
    expect(saved.map(({ character }) => character)).toEqual(["K", "M", "U"]);
  });

  it("reconciles advancement that commits after navigating away", async () => {
    const fake = makeFakeAudio();
    let resolveAcceptance: (() => void) | undefined;
    const acceptAdvancement = vi.fn(
      (acceptance: AdvancementAcceptance) =>
        new Promise<ReturnType<typeof testCurriculum>>((resolve) => {
          resolveAcceptance = () => resolve(acceptedCurriculum(acceptance));
        }),
    );
    const persistence: LearnSessionPersistence = {
      recordAttempt: () => Promise.resolve(),
      finish: () => Promise.resolve(),
      interrupt: () => Promise.resolve(),
      acceptAdvancement,
      retry: () => Promise.resolve(),
    };
    const startLearnSessionPersistence = vi.fn(() =>
      Promise.resolve(persistence),
    );
    const onReconcileCurriculum = vi.fn();
    renderApp(fake.audio, {
      startLearnSessionPersistence,
      onReconcileCurriculum,
    });
    await completeContinuousCopy(fake);

    fireEvent.click(screen.getByRole("button", { name: "Learn U" }));
    fireEvent.click(screen.getByRole("link", { name: "Practice" }));
    await flush();
    expect(
      screen.getByRole("heading", { name: "Practice" }),
    ).toBeInTheDocument();

    await act(async () => resolveAcceptance?.());
    await flush();

    expect(onReconcileCurriculum).toHaveBeenCalledOnce();
    expect(startLearnSessionPersistence).toHaveBeenCalledOnce();
    expect(
      screen.getByRole("heading", { name: "Practice" }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("link", { name: "Learn" }));
    fireEvent.click(screen.getByRole("button", { name: "Start learning" }));
    await flush();

    expect(startLearnSessionPersistence).toHaveBeenCalledTimes(2);
    expect(fake.pending[0]?.text).toBe("U");
    expect(screen.getByText("U")).toBeInTheDocument();
  });

  it("finalizes durable Learn evidence before reading retry history", async () => {
    const fake = makeFakeAudio();
    const events: string[] = [];
    const persistence: LearnSessionPersistence = {
      recordAttempt: async (evidence) => {
        if (evidence.exerciseType === "continuous-copy") {
          events.push("continuous-copy");
        }
      },
      finish: async () => {
        events.push("finalize");
      },
      interrupt: () => Promise.resolve(),
      acceptAdvancement: () => Promise.resolve(testCurriculum()),
      retry: () => Promise.resolve(),
    };
    renderLearn(
      fake.audio,
      {},
      {
        startLearnSessionPersistence: async () => {
          events.push("create");
          return persistence;
        },
        getRetryClassification: async () => {
          events.push("classify");
          return {
            consecutiveAccuracyMisses: 1,
            shouldSuggestSpacing: false,
          };
        },
      },
    );

    await completeContinuousCopy(fake, (target) =>
      [...target]
        .map((character, index) => (index < 11 ? "U" : character))
        .join(""),
    );
    await flush();

    expect(events[0]).toBe("create");
    expect(events.slice(-3)).toEqual([
      "continuous-copy",
      "finalize",
      "classify",
    ]);
  });

  it("blocks summary actions and retries failed finalization", async () => {
    const fake = makeFakeAudio();
    let rejectFirstFinish: ((error: Error) => void) | undefined;
    const finish = vi
      .fn<LearnSessionPersistence["finish"]>()
      .mockImplementationOnce(
        () =>
          new Promise<void>((_resolve, reject) => {
            rejectFirstFinish = reject;
          }),
      )
      .mockResolvedValue(undefined);
    const getRetryClassification = vi.fn(() =>
      Promise.resolve({
        consecutiveAccuracyMisses: 0,
        shouldSuggestSpacing: false,
      }),
    );
    const persistence: LearnSessionPersistence = {
      recordAttempt: () => Promise.resolve(),
      finish,
      interrupt: () => Promise.resolve(),
      acceptAdvancement: () => Promise.resolve(testCurriculum()),
      retry: () => Promise.resolve(),
    };
    renderLearn(
      fake.audio,
      {},
      {
        startLearnSessionPersistence: () => Promise.resolve(persistence),
        getRetryClassification,
      },
    );

    await completeContinuousCopy(fake);

    expect(screen.getByRole("status")).toHaveTextContent("Saving session");
    expect(screen.getByRole("button", { name: "Learn U" })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Practice long copy" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Restart full lesson" }),
    ).toBeDisabled();
    expect(getRetryClassification).not.toHaveBeenCalled();

    await act(async () => rejectFirstFinish?.(new Error("quota exceeded")));
    await flush();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Your session could not be saved",
    );
    expect(screen.getByRole("button", { name: "Learn U" })).toBeDisabled();
    expect(getRetryClassification).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Retry saving" }));
    await flush();

    expect(finish).toHaveBeenCalledTimes(2);
    expect(getRetryClassification).toHaveBeenCalledOnce();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Learn U" })).toBeEnabled();
  });

  it("retries session-start failure from summary using the same start mode", async () => {
    const fake = makeFakeAudio();
    const sessionStartError = Object.assign(new Error("quota exceeded"), {
      name: "QuotaExceededError",
    });
    const startLearnSessionPersistence = vi
      .fn<
        (options: LearnPersistenceStart) => Promise<LearnSessionPersistence>
      >()
      .mockResolvedValueOnce({
        recordAttempt: () => Promise.resolve(),
        finish: () => Promise.resolve(),
        interrupt: () => Promise.resolve(),
        acceptAdvancement: () => Promise.resolve(testCurriculum()),
        retry: () => Promise.resolve(),
      })
      .mockRejectedValueOnce(sessionStartError)
      .mockResolvedValue({
        recordAttempt: () => Promise.resolve(),
        finish: () => Promise.resolve(),
        interrupt: () => Promise.resolve(),
        acceptAdvancement: () => Promise.resolve(testCurriculum()),
        retry: () => Promise.resolve(),
      });
    renderLearn(
      fake.audio,
      {},
      {
        startLearnSessionPersistence,
      },
    );
    await completeContinuousCopy(fake);

    fireEvent.click(
      screen.getByRole("button", { name: "Restart full lesson" }),
    );
    await flush();

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Your session could not be saved",
    );
    fireEvent.click(screen.getByText("Save details"));
    expect(
      screen.getByText(
        "Save failed (session-start): QuotaExceededError - quota exceeded | retries: 0",
      ),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Retry saving" }));
    await flush();

    expect(startLearnSessionPersistence).toHaveBeenCalledTimes(3);
    expect(startLearnSessionPersistence.mock.calls[1]?.[0].mode).toBe("learn");
    expect(startLearnSessionPersistence.mock.calls[2]?.[0].mode).toBe("learn");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("retries failed Practice long copy start as review mode", async () => {
    const fake = makeFakeAudio();
    const sessionStartError = Object.assign(new Error("quota exceeded"), {
      name: "QuotaExceededError",
    });
    const startLearnSessionPersistence = vi
      .fn<
        (options: LearnPersistenceStart) => Promise<LearnSessionPersistence>
      >()
      .mockResolvedValueOnce({
        recordAttempt: () => Promise.resolve(),
        finish: () => Promise.resolve(),
        interrupt: () => Promise.resolve(),
        acceptAdvancement: () => Promise.resolve(testCurriculum()),
        retry: () => Promise.resolve(),
      })
      .mockRejectedValueOnce(sessionStartError)
      .mockResolvedValue({
        recordAttempt: () => Promise.resolve(),
        finish: () => Promise.resolve(),
        interrupt: () => Promise.resolve(),
        acceptAdvancement: () => Promise.resolve(testCurriculum()),
        retry: () => Promise.resolve(),
      });
    renderLearn(
      fake.audio,
      {},
      {
        startLearnSessionPersistence,
      },
    );
    await completeContinuousCopy(fake);

    fireEvent.click(screen.getByRole("button", { name: "Practice long copy" }));
    await flush();

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Your session could not be saved",
    );

    fireEvent.click(screen.getByRole("button", { name: "Retry saving" }));
    await flush();

    expect(startLearnSessionPersistence).toHaveBeenCalledTimes(3);
    expect(startLearnSessionPersistence.mock.calls[1]?.[0].mode).toBe("review");
    expect(startLearnSessionPersistence.mock.calls[2]?.[0].mode).toBe("review");
  });

  it("retries a pre-start interrupt failure and resumes requested review start", async () => {
    const fake = makeFakeAudio();
    const interruptError = Object.assign(new Error("transaction was aborted"), {
      name: "AbortError",
    });
    const interrupt = vi
      .fn<LearnSessionPersistence["interrupt"]>()
      .mockRejectedValueOnce(interruptError)
      .mockResolvedValue(undefined);
    const initialPersistence: LearnSessionPersistence = {
      recordAttempt: () => Promise.resolve(),
      finish: () => Promise.resolve(),
      interrupt,
      acceptAdvancement: () => Promise.resolve(testCurriculum()),
      retry: () => Promise.resolve(),
    };
    const reviewPersistence: LearnSessionPersistence = {
      recordAttempt: () => Promise.resolve(),
      finish: () => Promise.resolve(),
      interrupt: () => Promise.resolve(),
      acceptAdvancement: () => Promise.resolve(testCurriculum()),
      retry: () => Promise.resolve(),
    };
    const startLearnSessionPersistence = vi
      .fn<
        (options: LearnPersistenceStart) => Promise<LearnSessionPersistence>
      >()
      .mockResolvedValueOnce(initialPersistence)
      .mockResolvedValueOnce(reviewPersistence);

    renderLearn(
      fake.audio,
      {},
      {
        startLearnSessionPersistence,
      },
    );
    await completeContinuousCopy(fake);

    fireEvent.click(screen.getByRole("button", { name: "Practice long copy" }));
    await flush();

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Your session could not be saved",
    );
    fireEvent.click(screen.getByText("Save details"));
    expect(
      screen.getByText(
        "Save failed (session-start): AbortError - transaction was aborted | retries: 0",
      ),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Retry saving" }));
    await flush();

    expect(interrupt).toHaveBeenCalledTimes(2);
    expect(startLearnSessionPersistence).toHaveBeenCalledTimes(2);
    expect(startLearnSessionPersistence.mock.calls[1]?.[0].mode).toBe("review");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Continuous copy")).toHaveFocus();
    expect(fake.pending[0]?.schedule).toBeDefined();
  });

  it("pauses continuous copy, preserves typed text, and resumes same run", async () => {
    const fake = makeFakeAudio();
    renderLearn(fake.audio);
    await toContinuousCopyTransition(fake);
    fireEvent.click(screen.getByRole("button", { name: "Go" }));
    await flush();

    const input = screen.getByLabelText(
      "Continuous copy",
    ) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "KM" } });
    const remainingBeforePause =
      screen.getByLabelText("Time remaining").textContent;

    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    await flush();

    expect(screen.getByRole("status")).toHaveTextContent("Paused");
    expect(screen.getByText(/Paused with/)).toBeInTheDocument();
    expect(input).toHaveValue("KM");
    expect(fake.playCount()).toBe(0);
    const pausedRemaining = screen.getByLabelText("Time remaining").textContent;
    expect(pausedRemaining).not.toBeNull();
    expect(pausedRemaining).not.toBe("0:00");

    await tick(5000);
    expect(screen.getByLabelText("Time remaining").textContent).toBe(
      pausedRemaining,
    );
    expect(pausedRemaining).not.toBe(remainingBeforePause);

    fireEvent.click(screen.getByRole("button", { name: "Resume" }));
    await flush();

    expect(screen.getByRole("status")).toHaveTextContent("Listening");
    expect(input).toHaveValue("KM");
    expect(fake.playCount()).toBe(1);
  });

  it("can end session while continuous copy is paused", async () => {
    const fake = makeFakeAudio();
    renderLearn(fake.audio);
    await toContinuousCopyTransition(fake);
    fireEvent.click(screen.getByRole("button", { name: "Go" }));
    await flush();
    fireEvent.change(screen.getByLabelText("Continuous copy"), {
      target: { value: "KM" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    await flush();

    fireEvent.click(screen.getByRole("button", { name: "End session" }));
    await flush();

    expect(
      screen.getByRole("heading", { name: "Session complete" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/ended early and was not counted/),
    ).toBeInTheDocument();
  });

  it("excludes paused wall time from active practice", async () => {
    seedUnlockedCharacters(2);
    const fake = makeFakeAudio();
    renderLearn(fake.audio);

    fireEvent.click(screen.getByRole("button", { name: "Start long copy" }));
    await flush();
    await tick(1500);
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    await flush();

    await tick(65000);
    fireEvent.click(screen.getByRole("button", { name: "End session" }));
    await flush();

    expect(activeTimeSeconds()).toBeLessThan(10);
  });

  it("persists one continuous-copy attempt across pause and resume", async () => {
    seedUnlockedCharacters(2);
    const fake = makeFakeAudio();
    const recordAttempt = vi
      .fn<LearnSessionPersistence["recordAttempt"]>()
      .mockResolvedValue(undefined);
    const persistence: LearnSessionPersistence = {
      recordAttempt,
      finish: () => Promise.resolve(),
      interrupt: () => Promise.resolve(),
      acceptAdvancement: () => Promise.resolve(testCurriculum()),
      retry: () => Promise.resolve(),
    };
    renderLearn(
      fake.audio,
      {},
      {
        startLearnSessionPersistence: () => Promise.resolve(persistence),
      },
    );

    fireEvent.click(screen.getByRole("button", { name: "Start long copy" }));
    await flush();
    fireEvent.change(screen.getByLabelText("Continuous copy"), {
      target: { value: "KM" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Resume" }));
    await flush();

    await resolvePlay(fake);
    await tick(2000);
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await flush();

    const continuousCalls = recordAttempt.mock.calls.filter(
      ([evidence]) => evidence.exerciseType === "continuous-copy",
    );
    expect(continuousCalls).toHaveLength(1);
  });

  it("keeps session-start retry state through interrupt success until creation failure", async () => {
    const fake = makeFakeAudio();
    const interruptError = Object.assign(new Error("transaction was aborted"), {
      name: "AbortError",
    });
    let rejectRetryCreation: ((error: Error) => void) | undefined;
    const interrupt = vi
      .fn<LearnSessionPersistence["interrupt"]>()
      .mockRejectedValueOnce(interruptError)
      .mockResolvedValue(undefined);
    const initialPersistence: LearnSessionPersistence = {
      recordAttempt: () => Promise.resolve(),
      finish: () => Promise.resolve(),
      interrupt,
      acceptAdvancement: () => Promise.resolve(testCurriculum()),
      retry: () => Promise.resolve(),
    };
    const startLearnSessionPersistence = vi
      .fn<
        (options: LearnPersistenceStart) => Promise<LearnSessionPersistence>
      >()
      .mockResolvedValueOnce(initialPersistence)
      .mockImplementationOnce(
        () =>
          new Promise<LearnSessionPersistence>((_resolve, reject) => {
            rejectRetryCreation = reject;
          }),
      );

    renderLearn(
      fake.audio,
      {},
      {
        startLearnSessionPersistence,
      },
    );
    await completeContinuousCopy(fake);

    fireEvent.click(screen.getByRole("button", { name: "Practice long copy" }));
    await flush();

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Your session could not be saved",
    );

    fireEvent.click(screen.getByRole("button", { name: "Retry saving" }));
    await flush();

    expect(screen.getByText("Retrying save...")).toBeInTheDocument();
    expect(interrupt).toHaveBeenCalledTimes(2);
    expect(startLearnSessionPersistence).toHaveBeenCalledTimes(2);
    expect(startLearnSessionPersistence.mock.calls[1]?.[0].mode).toBe("review");

    await act(async () =>
      rejectRetryCreation?.(
        Object.assign(new Error("quota exceeded"), {
          name: "QuotaExceededError",
        }),
      ),
    );
    await flush();

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Your session could not be saved",
    );
    fireEvent.click(screen.getByText("Save details"));
    expect(
      screen.getByText(
        "Save failed (session-start): QuotaExceededError - quota exceeded | retries: 1",
      ),
    ).toBeInTheDocument();
  });

  it("starts another lesson without unlocking from the secondary action", async () => {
    const fake = makeFakeAudio();
    renderLearn(fake.audio);
    await completeContinuousCopy(fake);

    fireEvent.click(
      screen.getByRole("button", { name: "Restart full lesson" }),
    );
    await flush();

    const saved = JSON.parse(
      localStorage.getItem("k1frx.curriculum.v2") ?? "[]",
    ) as Array<{ character: string }>;
    expect(saved.map(({ character }) => character)).toEqual(["K", "M"]);
    expect(fake.pending[0]?.text).not.toBe("U");
  });

  it("does not offer advancement below the overall accuracy threshold", async () => {
    const fake = makeFakeAudio();
    renderLearn(fake.audio);
    await completeContinuousCopy(fake, (target) =>
      [...target]
        .map((character, index) => (index < 11 ? "U" : character))
        .join(""),
    );

    expect(screen.getByText(/aim for 90%/)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^Learn / }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Practice long copy" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Restart full lesson" }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Practice long copy" }));
    await flush();
    expect(screen.getByLabelText("Continuous copy")).toHaveFocus();
    expect(fake.pending[0]?.schedule).toBeDefined();
  });

  it("offers and applies more spacing after repeated accuracy misses", async () => {
    const fake = makeFakeAudio();
    const persistSettings = vi.fn();
    renderLearn(
      fake.audio,
      {},
      {
        retryClassification: {
          consecutiveAccuracyMisses: 3,
          shouldSuggestSpacing: true,
        },
        persistSettings,
      },
    );
    await completeContinuousCopy(fake, (target) =>
      [...target]
        .map((character, index) => (index < 11 ? "U" : character))
        .join(""),
    );

    expect(
      screen.getByText(/characters will still play at 20 WPM/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Practice again at 20 / 12 WPM" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Restart full lesson" }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Try 20 / 10 WPM" }));
    await flush();
    expect(persistSettings).toHaveBeenLastCalledWith(
      expect.objectContaining({ charWpm: 20, effectiveWpm: 10 }),
    );
    expect(screen.getByLabelText("Continuous copy")).toHaveFocus();
  });

  it("preserves full-lesson isolated weakness after a long-copy retry", async () => {
    const fake = makeFakeAudio();
    renderLearn(
      fake.audio,
      {},
      {
        retryClassification: {
          consecutiveAccuracyMisses: 1,
          shouldSuggestSpacing: false,
          isolatedPerformance: {
            eligibleObservations: 12,
            eligibleCorrect: 8,
            accuracy: 8 / 12,
          },
        },
      },
    );
    await completeContinuousCopy(fake, (target) =>
      [...target]
        .map((character, index) => (index < 11 ? "U" : character))
        .join(""),
    );

    fireEvent.click(screen.getByRole("button", { name: "Practice long copy" }));
    await flush();
    const reviewTarget = fake.pending[0]?.text ?? "";
    fireEvent.change(screen.getByLabelText("Continuous copy"), {
      target: {
        value: [...reviewTarget]
          .map((character, index) => (index < 11 ? "U" : character))
          .join(""),
      },
    });
    await resolvePlay(fake);
    await tick(2000);
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await flush();

    const retryButtons = screen
      .getAllByRole("button")
      .map((button) => button.textContent);
    expect(retryButtons).toEqual(["Restart full lesson", "Practice long copy"]);
  });

  it("gives unresolved review priority and never offers advancement", async () => {
    const fake = makeFakeAudio();
    renderLearn(fake.audio);
    await completeContinuousCopy(fake, (target) =>
      target.replace(/[KM]/g, "U"),
    );

    expect(screen.getByText(/more practice with K/)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^Learn / }),
    ).not.toBeInTheDocument();
  });

  it("contains no checkpoint controls or terminology", async () => {
    const fake = makeFakeAudio();
    renderLearn(fake.audio);
    await completeContinuousCopy(fake);

    expect(screen.queryByText(/checkpoint/i)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /checkpoint/i }),
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/checkpoint/i)).not.toBeInTheDocument();
  });
});
