import type { AudioSession } from "../audio/audio-session.ts";
import type { CwEngine } from "../audio/cw-engine.ts";
import type { LearnAudio } from "./learn-audio-context.ts";

export function createLearnAudio(
  engine: CwEngine,
  session: AudioSession,
  unlockEngine: () => Promise<void>,
): LearnAudio {
  let lifecycleGeneration = 0;

  return {
    unlock: async () => {
      lifecycleGeneration += 1;
      await unlockEngine();
    },
    play: async (text, timing, options) => {
      lifecycleGeneration += 1;
      await engine.playText(text, timing, options);
    },
    playSchedule: async (schedule, options) => {
      lifecycleGeneration += 1;
      await engine.playSchedule(schedule, options);
    },
    cancel: async () => {
      lifecycleGeneration += 1;
      await engine.cancel();
    },
    suspend: () => session.suspend(),
    cancelAndSuspend: async () => {
      const generation = ++lifecycleGeneration;
      await engine.cancel();
      if (generation === lifecycleGeneration) {
        await session.suspend();
      }
    },
  };
}
