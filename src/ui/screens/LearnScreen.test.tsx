import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { DEFAULT_CURRICULUM_CONFIG } from "../../content/curriculum-data.ts";
import { createInitialState } from "../../core/curriculum.ts";
import { LearnAudioContext, type LearnAudio } from "../learn-audio-context.ts";
import { SettingsProvider } from "../settings-provider.tsx";
import { LearnScreen } from "./LearnScreen.tsx";

type PendingPlay = { text: string; resolve: () => void };

function makeFakeAudio() {
  const pending: PendingPlay[] = [];
  const audio: LearnAudio = {
    unlock: () => Promise.resolve(),
    play: (text) =>
      new Promise<void>((resolve) => {
        pending.push({ text, resolve });
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
    playCount: () => pending.length,
    resolveNext: () => pending.shift()?.resolve(),
    resolveAt: (index: number) => pending.splice(index, 1)[0]?.resolve(),
  };
}

function renderLearn(audio: LearnAudio) {
  return render(
    <SettingsProvider>
      <LearnAudioContext.Provider value={audio}>
        <LearnScreen />
      </LearnAudioContext.Provider>
    </SettingsProvider>,
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

/** Drives from onboarding to the first isolated copy card (acquire of K). */
async function toFirstCopy(fake: ReturnType<typeof makeFakeAudio>) {
  fireEvent.click(screen.getByRole("button", { name: "Start learning" }));
  await flush(); // begin: unlock + intro K present -> play #1
  await resolvePlay(fake); // intro play 1 -> intro gap timer
  await tick(400); // INTRO_GAP -> play #2
  await resolvePlay(fake); // intro play 2 -> completeIntro -> acquire K present -> play #3
  await resolvePlay(fake); // acquire audio done -> input unlocked
}

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe("LearnScreen input gating", () => {
  it("locks input until the prompt audio finishes, then unlocks", async () => {
    const fake = makeFakeAudio();
    renderLearn(fake.audio);
    fireEvent.click(screen.getByRole("button", { name: "Start learning" }));
    await flush();
    await resolvePlay(fake);
    await tick(400);
    await resolvePlay(fake); // acquire card presented, audio still playing (play #3 pending)

    const input = screen.getByLabelText("Your copy") as HTMLInputElement;
    expect(input.disabled).toBe(true); // audio not yet finished
    await resolvePlay(fake); // finish acquire audio
    expect(input.disabled).toBe(false);
  });

  it("accepts only one answer despite repeated input events", async () => {
    const fake = makeFakeAudio();
    renderLearn(fake.audio);
    await toFirstCopy(fake);

    const counterBefore = screen.getByText(/\/\d+$/).textContent;
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
    const counterAfter = screen.getByText(/\/\d+$/).textContent;
    expect(counterAfter).not.toBe(counterBefore);
  });

  it("ignores input while the prompt audio is still playing", async () => {
    const fake = makeFakeAudio();
    renderLearn(fake.audio);
    fireEvent.click(screen.getByRole("button", { name: "Start learning" }));
    await flush();
    await resolvePlay(fake);
    await tick(400);
    await resolvePlay(fake); // acquire presented, audio pending

    const input = screen.getByLabelText("Your copy") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "K" } }); // too early
    await flush();
    // No feedback yet: the answer was ignored during playback.
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("does not let a held physical key answer the next prompt", async () => {
    const fake = makeFakeAudio();
    renderLearn(fake.audio);
    await toFirstCopy(fake);

    fireEvent.keyDown(window, { key: "k", code: "KeyK" });
    await flush();
    await tick(450);
    await resolvePlay(fake);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    fireEvent.keyDown(window, { key: "k", code: "KeyK", repeat: true });
    await flush();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    fireEvent.keyUp(window, { key: "k", code: "KeyK" });
    fireEvent.keyDown(window, { key: "k", code: "KeyK" });
    await flush();
    expect(screen.getByRole("status")).toBeInTheDocument();
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

  it("locks input for Replay and unlocks only after it completes", async () => {
    const fake = makeFakeAudio();
    renderLearn(fake.audio);
    await toFirstCopy(fake);

    fireEvent.click(screen.getByRole("button", { name: "Replay" }));
    await flush();
    expect(
      (screen.getByLabelText("Your copy") as HTMLInputElement).disabled,
    ).toBe(true);

    await resolvePlay(fake);
    expect(
      (screen.getByLabelText("Your copy") as HTMLInputElement).disabled,
    ).toBe(false);
  });

  it("does not let stale Replay completion clear newer playback state", async () => {
    const fake = makeFakeAudio();
    fake.audio.cancel = () => Promise.resolve();
    fake.audio.cancelAndSuspend = () => Promise.resolve();
    renderLearn(fake.audio);
    await toFirstCopy(fake);

    fireEvent.click(screen.getByRole("button", { name: "Replay" }));
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "End session" }));
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Practice again" }));
    await flush();
    expect(fake.playCount()).toBe(2);

    await act(async () => {
      fake.resolveAt(0);
      await Promise.resolve();
    });
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
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
});

describe("LearnScreen checkpoint", () => {
  async function toCheckpoint(fake: ReturnType<typeof makeFakeAudio>) {
    await toFirstCopy(fake);
    fireEvent.click(screen.getByRole("button", { name: "End session" }));
    await flush();
    fireEvent.click(screen.getByRole("button", { name: /checkpoint/i }));
    await flush(); // startCheckpoint: unlock + present first item -> play
    await resolvePlay(fake); // first item audio done -> input enabled
  }

  it("keeps manual checkpoint entry available while review is unresolved", async () => {
    const state = createInitialState(DEFAULT_CURRICULUM_CONFIG);
    state.characters[0].needsReview = true;
    localStorage.setItem(
      "k1frx.curriculum.v2",
      JSON.stringify(state.characters),
    );
    localStorage.setItem("k1frx.introduced.v1", JSON.stringify(["K", "M"]));
    const fake = makeFakeAudio();
    renderLearn(fake.audio);

    fireEvent.click(screen.getByRole("button", { name: "Start learning" }));
    await flush();
    await resolvePlay(fake);
    fireEvent.click(screen.getByRole("button", { name: "End session" }));
    await flush();

    expect(screen.getByText(/Review K/)).toBeInTheDocument();
    const checkpoint = screen.getByRole("button", {
      name: "Try a checkpoint",
    });
    expect(checkpoint).toBeEnabled();
    fireEvent.click(checkpoint);
    await flush();
    expect(screen.getByLabelText("Checkpoint answer")).toBeInTheDocument();
  });

  it("accepts exactly one response per played character with no feedback", async () => {
    const fake = makeFakeAudio();
    renderLearn(fake.audio);
    await toCheckpoint(fake);

    const input = screen.getByLabelText(
      "Checkpoint answer",
    ) as HTMLInputElement;
    expect(screen.getByText(/^0\//)).toBeInTheDocument();

    fireEvent.change(input, { target: { value: "K" } }); // accept -> next item plays
    fireEvent.change(input, { target: { value: "M" } }); // locked during audio
    await flush();

    expect(screen.getByText(/^1\//)).toBeInTheDocument(); // advanced by one only
    // No per-item correctness feedback during the checkpoint.
    expect(screen.queryByText("✓")).not.toBeInTheDocument();
    expect(screen.queryByText(/Correct|Not quite/)).not.toBeInTheDocument();
  });

  it("keeps the checkpoint input locked until its tone finishes", async () => {
    const fake = makeFakeAudio();
    renderLearn(fake.audio);
    await toCheckpoint(fake);

    const input = screen.getByLabelText(
      "Checkpoint answer",
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "K" } }); // advances; next tone plays
    await flush();
    const next = screen.getByLabelText("Checkpoint answer") as HTMLInputElement;
    expect(next.disabled).toBe(true); // tone not finished
    await resolvePlay(fake);
    expect(
      (screen.getByLabelText("Checkpoint answer") as HTMLInputElement).disabled,
    ).toBe(false);
  });

  it("requires keyup before the same physical key answers a later item", async () => {
    const fake = makeFakeAudio();
    renderLearn(fake.audio);
    await toCheckpoint(fake);

    fireEvent.keyDown(window, { key: "k", code: "KeyK" });
    await flush();
    expect(screen.getByText(/^1\//)).toBeInTheDocument();
    await resolvePlay(fake);

    fireEvent.keyDown(window, { key: "k", code: "KeyK", repeat: true });
    await flush();
    expect(screen.getByText(/^1\//)).toBeInTheDocument();

    fireEvent.keyUp(window, { key: "k", code: "KeyK" });
    fireEvent.keyDown(window, { key: "k", code: "KeyK" });
    await flush();
    expect(screen.getByText(/^2\//)).toBeInTheDocument();
  });
});
