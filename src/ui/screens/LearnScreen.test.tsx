import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { DEFAULT_CURRICULUM_CONFIG } from "../../content/curriculum-data.ts";
import { createInitialState, forceUnlockNext } from "../../core/curriculum.ts";
import { createRng } from "../../core/rng.ts";
import type { Schedule } from "../../core/timing.ts";
import { buildCheckpoint } from "../../training/checkpoint.ts";
import { DEFAULT_LESSON_CONFIG } from "../../training/lesson-plan.ts";
import { sanitizeCopyInput } from "../copy-input.ts";
import { LearnAudioContext, type LearnAudio } from "../learn-audio-context.ts";
import { SettingsProvider } from "../settings-provider.tsx";
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
        pending.push({ schedule, resolve });
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

function checkpointSeedFor(prefix: readonly string[]): number {
  for (let seed = 0; seed < 10000; seed++) {
    const targets = buildCheckpoint(["K", "M"], "M", createRng(seed));
    if (prefix.every((target, index) => targets[index] === target)) {
      return seed;
    }
  }
  throw new Error(`No checkpoint seed starts with ${prefix.join("")}`);
}

/** Drives from onboarding to the first isolated copy card (acquire of K). */
async function toFirstCopy(fake: ReturnType<typeof makeFakeAudio>) {
  fireEvent.click(screen.getByRole("button", { name: "Start learning" }));
  await flush(); // begin: unlock + intro K present -> play #1
  await resolvePlay(fake); // intro play 1 -> intro gap timer
  await tick(700); // INTRO_REPEAT_GAP_MS -> play #2
  await resolvePlay(fake); // intro play 2 -> ready hold
  await tick(900); // INTRO_READY_HOLD_MS -> acquire K present -> play #3
  await resolvePlay(fake); // acquire audio done -> input unlocked
}

async function toMultiCharacterTransition(
  fake: ReturnType<typeof makeFakeAudio>,
  manual = false,
) {
  if (!localStorage.getItem("k1frx.introduced.v1")) {
    localStorage.setItem("k1frx.introduced.v1", JSON.stringify(["K", "M"]));
  }
  fireEvent.click(screen.getByRole("button", { name: "Start learning" }));
  await flush();
  for (let attempt = 0; attempt < 16; attempt++) {
    const target = fake.pending[0]?.text;
    expect(target).toHaveLength(1);
    await resolvePlay(fake);
    fireEvent.change(screen.getByLabelText("Your copy"), {
      target: { value: target },
    });
    await flush();
    if (manual) {
      fireEvent.click(screen.getByRole("button", { name: "Continue" }));
      await flush();
    } else {
      await tick(450);
    }
  }
}

async function toThreeCharacterNotice(fake: ReturnType<typeof makeFakeAudio>) {
  await toMultiCharacterTransition(fake);
  fireEvent.click(screen.getByRole("button", { name: "Go" }));
  await flush();
  for (let group = 0; group < 8; group++) {
    const target = fake.pending[0]?.text;
    expect(target).toHaveLength(2);
    await resolvePlay(fake);
    fireEvent.change(screen.getByLabelText("Your copy"), {
      target: { value: target },
    });
    await flush();
    await tick(450);
  }
}

async function toContinuousCopyTransition(
  fake: ReturnType<typeof makeFakeAudio>,
) {
  await toThreeCharacterNotice(fake);
  fireEvent.click(screen.getByRole("button", { name: "Go" }));
  await flush();
  for (let group = 0; group < 8; group++) {
    const target = fake.pending[0]?.text;
    expect(target).toHaveLength(3);
    await resolvePlay(fake);
    fireEvent.change(screen.getByLabelText("Your copy"), {
      target: { value: target },
    });
    await flush();
    await tick(450);
  }
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
  it("preserves every supported punctuation character", () => {
    expect(sanitizeCopyInput("a .,-=/ ?~")).toBe("A.,-=/?");
  });

  it("locks input until the prompt audio finishes, then unlocks", async () => {
    const fake = makeFakeAudio();
    renderLearn(fake.audio);
    fireEvent.click(screen.getByRole("button", { name: "Start learning" }));
    await flush();
    await resolvePlay(fake);
    await tick(700);
    await resolvePlay(fake);
    await tick(900); // acquire card presented, audio still playing (play #3 pending)

    const input = screen.getByLabelText("Your copy") as HTMLInputElement;
    expect(input.disabled).toBe(true); // audio not yet finished
    await resolvePlay(fake); // finish acquire audio
    expect(input.disabled).toBe(false);
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

  it("ignores input while the prompt audio is still playing", async () => {
    const fake = makeFakeAudio();
    renderLearn(fake.audio);
    fireEvent.click(screen.getByRole("button", { name: "Start learning" }));
    await flush();
    await resolvePlay(fake);
    await tick(700);
    await resolvePlay(fake);
    await tick(900); // acquire presented, audio pending

    const input = screen.getByLabelText("Your copy") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "K" } }); // too early
    await flush();
    // No feedback yet: the answer was ignored during playback.
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("rejects held repeats but accepts a fresh same-key press next prompt", async () => {
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
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("lets multiple physical events claim a prompt only once", async () => {
    const fake = makeFakeAudio();
    renderLearn(fake.audio);
    await toFirstCopy(fake);

    fireEvent.keyDown(window, { key: "k", code: "KeyK" });
    fireEvent.keyDown(window, { key: "m", code: "KeyM" });
    fireEvent.keyDown(window, { key: "k", code: "KeyK", repeat: true });
    await flush();

    expect(screen.getByRole("status")).toBeInTheDocument();
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
    await tick(700);
    await resolvePlay(fake);
    await tick(900);

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
  it("separates both introduction plays from the first drill", async () => {
    const fake = makeFakeAudio();
    renderLearn(fake.audio);

    fireEvent.click(screen.getByRole("button", { name: "Start learning" }));
    await flush();

    expect(fake.played).toEqual(["K"]);
    expect(screen.getByText("-.-")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Replay" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();

    await tick(5000);
    expect(fake.played).toEqual(["K"]);

    await resolvePlay(fake);
    await tick(699);
    expect(fake.played).toEqual(["K"]);
    expect(screen.getByText("-.-")).toBeInTheDocument();

    await tick(1);
    expect(fake.played).toEqual(["K", "K"]);
    await tick(5000);
    expect(fake.played).toEqual(["K", "K"]);

    await resolvePlay(fake);
    expect(screen.getByText("-.-")).toBeInTheDocument();
    expect(screen.getByText("Your turn next…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Replay" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled();

    await tick(899);
    expect(fake.played).toEqual(["K", "K"]);
    expect(screen.queryByLabelText("Your copy")).not.toBeInTheDocument();

    await tick(1);
    expect(screen.getByLabelText("Your copy")).toBeInTheDocument();
    expect(fake.played).toEqual(["K", "K", "K"]);
    expect(fake.playCount()).toBe(1);
  });

  it("waits for Continue after a manual introduction", async () => {
    localStorage.setItem(
      "k1frx.settings.v1",
      JSON.stringify({ pacing: "manual" }),
    );
    const fake = makeFakeAudio();
    renderLearn(fake.audio);

    fireEvent.click(screen.getByRole("button", { name: "Start learning" }));
    await flush();
    await resolvePlay(fake);
    await tick(700);
    await resolvePlay(fake);
    await tick(5000);

    expect(screen.getByText("Your turn next…")).toBeInTheDocument();
    expect(fake.played).toEqual(["K", "K"]);
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await flush();
    expect(screen.getByLabelText("Your copy")).toBeInTheDocument();
    expect(fake.played).toEqual(["K", "K", "K"]);
  });

  it("serializes introduction Replay and restarts the ready hold", async () => {
    const fake = makeFakeAudio();
    renderLearn(fake.audio);

    fireEvent.click(screen.getByRole("button", { name: "Start learning" }));
    await flush();
    await resolvePlay(fake);
    await tick(700);
    await resolvePlay(fake);

    const replay = screen.getByRole("button", { name: "Replay" });
    fireEvent.click(replay);
    fireEvent.click(replay);
    await flush();
    expect(fake.played).toEqual(["K", "K", "K"]);
    expect(fake.playCount()).toBe(1);
    await tick(2000);
    expect(screen.queryByLabelText("Your copy")).not.toBeInTheDocument();

    await resolvePlay(fake);
    await tick(899);
    expect(screen.queryByLabelText("Your copy")).not.toBeInTheDocument();
    await tick(1);
    expect(screen.getByLabelText("Your copy")).toBeInTheDocument();
    expect(fake.played).toEqual(["K", "K", "K", "K"]);
    expect(fake.playCount()).toBe(1);
  });

  it.each(["repeat gap", "ready hold"])(
    "ending during the introduction %s prevents late advancement",
    async (stage) => {
      const fake = makeFakeAudio();
      renderLearn(fake.audio);
      fireEvent.click(screen.getByRole("button", { name: "Start learning" }));
      await flush();
      await resolvePlay(fake);
      if (stage === "ready hold") {
        await tick(700);
        await resolvePlay(fake);
      }
      const playedBeforeEnd = [...fake.played];

      fireEvent.click(screen.getByRole("button", { name: "End session" }));
      await flush();
      await tick(5000);

      expect(
        screen.getByRole("heading", { name: "Session complete" }),
      ).toBeInTheDocument();
      expect(fake.played).toEqual(playedBeforeEnd);
      expect(fake.playCount()).toBe(0);
    },
  );

  it("keeps slow introduction playback completion-driven", async () => {
    localStorage.setItem(
      "k1frx.settings.v1",
      JSON.stringify({ charWpm: 8, effectiveWpm: 5 }),
    );
    const fake = makeFakeAudio();
    renderLearn(fake.audio);
    fireEvent.click(screen.getByRole("button", { name: "Start learning" }));
    await flush();

    await tick(5000);
    expect(fake.played).toEqual(["K"]);
    expect(fake.playCount()).toBe(1);
    await resolvePlay(fake);
    await tick(700);
    expect(fake.played).toEqual(["K", "K"]);
    expect(fake.playCount()).toBe(1);
    await tick(5000);
    expect(fake.played).toEqual(["K", "K"]);
    expect(fake.playCount()).toBe(1);
    await resolvePlay(fake);
    await tick(900);
    expect(fake.played).toEqual(["K", "K", "K"]);
    expect(fake.playCount()).toBe(1);
  });

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
    localStorage.setItem(
      "k1frx.settings.v1",
      JSON.stringify({ pacing: "manual" }),
    );
    const fake = makeFakeAudio();
    renderLearn(fake.audio);
    await toMultiCharacterTransition(fake, true);
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
    localStorage.setItem(
      "k1frx.settings.v1",
      JSON.stringify({ charWpm: 8, effectiveWpm: 5 }),
    );
    const fake = makeFakeAudio();
    renderLearn(fake.audio);
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
  });

  it("automatically continues the group notice after its named delay", async () => {
    const fake = makeFakeAudio();
    renderLearn(fake.audio);
    await toThreeCharacterNotice(fake);

    await tick(1799);
    expect(
      screen.getByRole("heading", {
        name: "Now copying 3-character groups",
      }),
    ).toBeInTheDocument();
    expect(fake.playCount()).toBe(0);
    await tick(1);
    expect(fake.pending[0]?.text).toHaveLength(3);
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
    localStorage.setItem(
      "k1frx.settings.v1",
      JSON.stringify({ continuousCopyDurationMs: 180000 }),
    );
    const fake = makeFakeAudio();
    renderLearn(fake.audio);
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
    for (let index = 0; index < DEFAULT_LESSON_CONFIG.wordCopyCount; index++) {
      const target = fake.pending[0]?.text ?? "";
      expect(target.length).toBeGreaterThanOrEqual(2);
      expect([...target].every((character) => active.includes(character))).toBe(
        true,
      );
      expect(screen.queryByText(/characters/)).not.toBeInTheDocument();
      const input = screen.getByLabelText("Your copy") as HTMLInputElement;
      expect(input).toBeEnabled();
      fireEvent.change(input, { target: { value: target } });
      fireEvent.keyDown(input, { key: "Enter" });
      await flush();
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
      await resolvePlay(fake);
      expect(screen.getByRole("status")).toHaveTextContent("✓");
      await tick(450);
    }

    expect(
      screen.getByRole("heading", { name: "Ready for continuous copy?" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Go" }));
    await flush();
    expect(fake.pending[0]?.schedule?.totalMs).toBeGreaterThanOrEqual(60000);
  });
});

describe("LearnScreen checkpoint", () => {
  async function toCheckpoint(
    fake: ReturnType<typeof makeFakeAudio>,
    prefix?: readonly string[],
  ) {
    await toFirstCopy(fake);
    fireEvent.click(screen.getByRole("button", { name: "End session" }));
    await flush();
    if (prefix) vi.setSystemTime(checkpointSeedFor(prefix));
    fireEvent.click(screen.getByRole("button", { name: /checkpoint/i }));
    await flush(); // startCheckpoint: unlock + present first item -> play
    if (prefix) expect(fake.pending[0]?.text).toBe(prefix[0]);
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

  it("accepts fresh same-key presses without keyup between checkpoint items", async () => {
    const fake = makeFakeAudio();
    renderLearn(fake.audio);
    await toCheckpoint(fake, ["K", "K"]);

    fireEvent.keyDown(window, { key: "k", code: "KeyK" });
    await flush();
    expect(screen.getByText(/^1\//)).toBeInTheDocument();
    expect(fake.pending[0]?.text).toBe("K");
    await resolvePlay(fake);

    fireEvent.keyDown(window, { key: "k", code: "KeyK", repeat: true });
    await flush();
    expect(screen.getByText(/^1\//)).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "k", code: "KeyK" });
    await flush();
    expect(screen.getByText(/^2\//)).toBeInTheDocument();
  });

  it("accepts an alternating K M K checkpoint with one press per item", async () => {
    const fake = makeFakeAudio();
    renderLearn(fake.audio);
    await toCheckpoint(fake, ["K", "M", "K"]);

    fireEvent.keyDown(window, { key: "k", code: "KeyK" });
    await flush();
    expect(fake.pending[0]?.text).toBe("M");
    await resolvePlay(fake);

    fireEvent.keyDown(window, { key: "m", code: "KeyM" });
    await flush();
    expect(fake.pending[0]?.text).toBe("K");
    await resolvePlay(fake);

    fireEvent.keyDown(window, { key: "k", code: "KeyK" });
    await flush();
    expect(screen.getByText(/^3\//)).toBeInTheDocument();
  });
});
