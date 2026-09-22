import { useEffect, useRef } from "react";
import { AudioSession } from "../../audio/audio-session.ts";
import { CwEngine } from "../../audio/cw-engine.ts";
import { BandNoise } from "../../audio/noise.ts";
import { useSettings } from "../settings-context.ts";

export type AudioEngine = {
  session: AudioSession;
  engine: CwEngine;
  noise: BandNoise;
  /** Resume + one-time iOS unlock; call from a user gesture before playback. */
  unlock: () => Promise<void>;
};

/**
 * Owns a single audio graph for the lifetime of the component. Keeps master
 * volume in sync with settings and tears everything down on unmount.
 */
export function useAudioEngine(): AudioEngine {
  const { settings, outputDeviceId } = useSettings();
  const ref = useRef<AudioEngine | undefined>(undefined);

  if (!ref.current) {
    const session = new AudioSession();
    session.setVolume(settings.volume);
    session.setPreferredSinkId(outputDeviceId);
    ref.current = {
      session,
      engine: new CwEngine(session),
      noise: new BandNoise(session),
      unlock: () => session.unlock(),
    };
  }

  useEffect(() => {
    ref.current?.session.setVolume(settings.volume);
  }, [settings.volume]);

  useEffect(() => {
    ref.current?.session.setPreferredSinkId(outputDeviceId);
  }, [outputDeviceId]);

  useEffect(() => {
    const current = ref.current;
    return () => {
      current?.noise.stop();
      if (current) {
        void current.engine.dispose().finally(() => current.session.close());
      }
    };
  }, []);

  return ref.current;
}
