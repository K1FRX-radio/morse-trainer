import { useEffect, useRef } from "react";
import { thresholdsForWpm } from "../../core/keying.ts";
import { StraightKey } from "../../input/key-input.ts";
import { attachKeyboardKey } from "../../input/keyboard-key.ts";
import { attachPointerKey } from "../../input/pointer-key.ts";
import { useSettings } from "../settings-context.ts";
import { useAudioEngine } from "../hooks/useAudioEngine.ts";

type SendPadProps = {
  onDecode: (text: string) => void;
  /** Changing this value clears the key and decode. */
  resetKey: number;
};

/** A straight-key input pad (button + space bar) with sidetone and live decode. */
export function SendPad({ onDecode, resetKey }: SendPadProps) {
  const { settings } = useSettings();
  const { engine, unlock } = useAudioEngine();

  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const buttonRef = useRef<HTMLButtonElement>(null);
  const keyRef = useRef<StraightKey | undefined>(undefined);

  if (!keyRef.current) {
    keyRef.current = new StraightKey({
      thresholds: thresholdsForWpm(settings.charWpm),
      onMarkStart: () => {
        void unlock();
        engine.startTone(settingsRef.current.toneHz);
      },
      onMarkEnd: () => engine.stopTone(),
      onDecodeChange: (result) => onDecode(result.text),
    });
  }

  useEffect(() => {
    keyRef.current?.updateThresholds(thresholdsForWpm(settings.charWpm));
  }, [settings.charWpm]);

  useEffect(() => {
    const key = keyRef.current;
    if (!key) return;
    const detachKeyboard = attachKeyboardKey(key);
    const button = buttonRef.current;
    const detachPointer = button ? attachPointerKey(button, key) : undefined;
    return () => {
      detachKeyboard();
      detachPointer?.();
      engine.stopTone();
    };
  }, [engine]);

  useEffect(() => {
    keyRef.current?.reset();
    onDecode("");
  }, [resetKey, onDecode]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="send__key"
        aria-label="Straight key (hold to send)"
      >
        Key
      </button>
      <p className="send__hint">Hold the button or the space bar to send.</p>
    </>
  );
}
