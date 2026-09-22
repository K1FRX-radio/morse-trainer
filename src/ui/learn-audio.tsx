import { useMemo, type ReactNode } from "react";
import { useAudioEngine } from "./hooks/useAudioEngine.ts";
import { LearnAudioContext, type LearnAudio } from "./learn-audio-context.ts";
import { createLearnAudio } from "./learn-audio-controller.ts";

export function LearnAudioProvider({ children }: { children: ReactNode }) {
  const { engine, session, unlock } = useAudioEngine();
  const value = useMemo<LearnAudio>(
    () => createLearnAudio(engine, session, unlock),
    [engine, session, unlock],
  );
  return (
    <LearnAudioContext.Provider value={value}>
      {children}
    </LearnAudioContext.Provider>
  );
}
