import { fireEvent, screen } from "@testing-library/react";
import type { LearnPhaseId } from "../../training/lesson-plan.ts";

type DriverPhase = LearnPhaseId | "onboarding";

type LearnAudioHarness = {
  currentText(): string | undefined;
  resolveNext(): Promise<void>;
};

type LearnDriverOptions = {
  audio: LearnAudioHarness;
  flush(): Promise<void>;
  advanceTime(ms: number): Promise<void>;
};

export type ContinuousCopyAnswerStrategy = (target: string) => string;

export function createLearnTestDriver(options: LearnDriverOptions) {
  function phase(): DriverPhase {
    const phaseId = document
      .querySelector("[data-learn-phase]")
      ?.getAttribute("data-learn-phase");
    if (!phaseId) throw new Error("Learn phase is unavailable");
    return phaseId as DriverPhase;
  }

  function target(): string {
    const current = options.audio.currentText();
    if (current === undefined) throw new Error("Learn target is unavailable");
    return current;
  }

  async function start(): Promise<void> {
    fireEvent.click(screen.getByRole("button", { name: "Start learning" }));
    await options.flush();
  }

  async function completeIntroduction(): Promise<void> {
    if (phase() !== "introduce") {
      throw new Error(`Expected introduction, received ${phase()}`);
    }
    await options.audio.resolveNext();
    fireEvent.click(screen.getByRole("button", { name: "Start practice" }));
    await options.flush();
  }

  async function continueInterstitial(): Promise<void> {
    fireEvent.click(screen.getByRole("button", { name: "Go" }));
    await options.flush();
  }

  async function answerCurrentPrompt(answer = target()): Promise<void> {
    const input = screen.getByLabelText("Your copy") as HTMLInputElement;
    fireEvent.change(input, { target: { value: answer } });
    if (input.placeholder === "type the word, then Enter") {
      fireEvent.keyDown(input, { key: "Enter" });
    }
    await options.flush();
    await options.audio.resolveNext();
    if (screen.queryByRole("button", { name: "Continue" })) {
      fireEvent.click(screen.getByRole("button", { name: "Continue" }));
      await options.flush();
    } else {
      await options.advanceTime(450);
    }
  }

  async function advanceOneEvent(): Promise<void> {
    if (phase() === "introduce") {
      await completeIntroduction();
      return;
    }
    if (screen.queryByRole("button", { name: "Go" })) {
      await continueInterstitial();
      return;
    }
    await answerCurrentPrompt();
  }

  async function advanceUntilPhase(expected: LearnPhaseId): Promise<void> {
    for (let event = 0; event < 200 && phase() !== expected; event += 1) {
      await advanceOneEvent();
    }
    if (phase() !== expected) {
      throw new Error(`Did not reach Learn phase ${expected}`);
    }
  }

  async function completePhaseCorrectly(expected: LearnPhaseId): Promise<void> {
    if (phase() !== expected) {
      throw new Error(`Expected Learn phase ${expected}, received ${phase()}`);
    }
    for (let event = 0; event < 200 && phase() === expected; event += 1) {
      await advanceOneEvent();
    }
    if (phase() === expected) {
      throw new Error(`Learn phase ${expected} did not complete`);
    }
  }

  async function completeContinuousCopy(
    answer: ContinuousCopyAnswerStrategy = (currentTarget) => currentTarget,
  ): Promise<string> {
    await advanceUntilPhase("continuous-copy");
    if (screen.queryByRole("button", { name: "Go" })) {
      await continueInterstitial();
    }
    const currentTarget = target();
    fireEvent.change(screen.getByLabelText("Continuous copy"), {
      target: { value: answer(currentTarget) },
    });
    await options.audio.resolveNext();
    await options.advanceTime(2000);
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await options.flush();
    return currentTarget;
  }

  async function abandon(): Promise<void> {
    fireEvent.click(screen.getByRole("button", { name: "End session" }));
    await options.flush();
  }

  return {
    phase,
    target,
    start,
    completeIntroduction,
    answerCurrentPrompt,
    advanceUntilPhase,
    completePhaseCorrectly,
    completeContinuousCopy,
    abandon,
  };
}