import { useMemo, type ReactNode } from "react";
import { useAudioEngine } from "./hooks/useAudioEngine.ts";
import { LearnAudioContext, type LearnAudio } from "./learn-audio-context.ts";

export function LearnAudioProvider({ children }: { children: ReactNode }) {
  const { engine, unlock } = useAudioEngine();
  const value = useMemo<LearnAudio>(
    () => ({
      unlock,
      play: (text, timing, options) => engine.playText(text, timing, options),
      cancel: () => engine.cancel(),
    }),
    [engine, unlock],
  );
  return (
    <LearnAudioContext.Provider value={value}>
      {children}
    </LearnAudioContext.Provider>
  );
}
