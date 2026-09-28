import { createContext, useContext } from "react";
import type { Schedule } from "../core/timing.ts";

/** Source-agnostic RX playback surface, injectable for orchestration tests. */
export type RxAudio = {
  unlock: () => Promise<void>;
  /** Resolves when playback finishes so flows can pace to real audio length. */
  play: (
    text: string,
    timing: { charWpm: number; effectiveWpm: number },
    options: { toneHz: number },
  ) => Promise<void>;
  /** Plays an already-generated schedule without rebuilding or chunking it. */
  playSchedule: (
    schedule: Schedule,
    options: { toneHz: number },
  ) => Promise<void>;
  /** Stops any current playback (used when leaving a flow). */
  cancel: () => Promise<void>;
  /** Suspends the audio context to release the device when idle. */
  suspend: () => Promise<void>;
  /** Cancels playback and suspends only if no newer audio flow has started. */
  cancelAndSuspend: () => Promise<void>;
};

export type LearnAudio = RxAudio;

export const LearnAudioContext = createContext<LearnAudio | undefined>(
  undefined,
);

export function useLearnAudio(): LearnAudio {
  const value = useContext(LearnAudioContext);
  if (!value) {
    throw new Error("useLearnAudio must be used within a LearnAudioProvider");
  }
  return value;
}
