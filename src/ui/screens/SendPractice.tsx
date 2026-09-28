import { useEffect, useRef, useState } from "react";
import { thresholdsForWpm } from "../../core/keying.ts";
import { StraightKey } from "../../input/key-input.ts";
import { attachKeyboardKey } from "../../input/keyboard-key.ts";
import { attachPointerKey } from "../../input/pointer-key.ts";
import { encodeKeyingTiming } from "../../data/keying-timing.ts";
import { useSettings } from "../settings-context.ts";
import { useAudioEngine } from "../hooks/useAudioEngine.ts";
import { usePracticeSession } from "../hooks/usePracticeSession.ts";

const TARGETS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

function randomTarget(): string {
  return TARGETS[Math.floor(Math.random() * TARGETS.length)];
}

export function SendPractice() {
  const { settings } = useSettings();
  const { engine, unlock } = useAudioEngine();
  const practice = usePracticeSession("send-practice", settings);

  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const buttonRef = useRef<HTMLButtonElement>(null);
  const keyRef = useRef<StraightKey | undefined>(undefined);
  const targetRef = useRef("");
  const promptToken = useRef(1);
  const committedToken = useRef<number | undefined>(undefined);

  const [decoded, setDecoded] = useState("");
  const [target, setTarget] = useState<string>(randomTarget);
  targetRef.current = target;

  if (!keyRef.current) {
    keyRef.current = new StraightKey({
      thresholds: thresholdsForWpm(settings.charWpm),
      onMarkStart: () => {
        void practice.start().catch(() => undefined);
        void unlock();
        engine.startTone(settingsRef.current.toneHz);
      },
      onMarkEnd: () => {
        practice.recordActivity();
        engine.stopTone();
      },
      onDecodeChange: (result) => {
        setDecoded(result.text);
        const token = promptToken.current;
        if (
          result.text.trim().toUpperCase() !== targetRef.current ||
          committedToken.current === token
        ) {
          return;
        }
        committedToken.current = token;
        void practice
          .recordAttempt({
            exerciseType: "send-character",
            target: targetRef.current,
            response: result.text,
            assisted: false,
            replayed: false,
            keying: encodeKeyingTiming(
              result.marksMs,
              result.spacesMs,
              thresholdsForWpm(settingsRef.current.charWpm).ditMs,
            ),
          })
          .catch(() => undefined);
      },
    });
  }

  // Keep decode thresholds in step with the character speed setting.
  useEffect(() => {
    keyRef.current?.updateThresholds(thresholdsForWpm(settings.charWpm));
  }, [settings.charWpm]);

  useEffect(() => {
    const key = keyRef.current;
    if (!key) {
      return;
    }
    const detachKeyboard = attachKeyboardKey(key);
    const button = buttonRef.current;
    const detachPointer = button ? attachPointerKey(button, key) : undefined;
    return () => {
      detachKeyboard();
      detachPointer?.();
      engine.stopTone();
    };
  }, [engine]);

  function clear(): void {
    keyRef.current?.reset();
    setDecoded("");
  }

  async function nextTarget(): Promise<void> {
    practice.recordActivity();
    const result = keyRef.current?.decode();
    const token = promptToken.current;
    if (
      result &&
      result.text.trim() !== "" &&
      committedToken.current !== token
    ) {
      committedToken.current = token;
      try {
        await practice.recordAttempt({
          exerciseType: "send-character",
          target,
          response: result.text,
          assisted: false,
          replayed: false,
          keying: encodeKeyingTiming(
            result.marksMs,
            result.spacesMs,
            thresholdsForWpm(settings.charWpm).ditMs,
          ),
        });
      } catch {
        return;
      }
    }
    clear();
    promptToken.current += 1;
    setTarget(randomTarget());
  }

  const matched = decoded.trim().toUpperCase() === target;

  return (
    <div className="practice">
      <div className="send__target" aria-label="Send this character">
        <span className="send__target-label">Send</span>
        <span className="send__target-char">{target}</span>
      </div>

      <button
        ref={buttonRef}
        type="button"
        className="send__key"
        aria-label="Straight key (hold to send)"
      >
        Key
      </button>
      <p className="send__hint">Hold the button or the space bar to send.</p>

      <div className="send__decoded" role="status" aria-live="polite">
        <span className="field__label">Decoded</span>
        <span className="send__decoded-text">{decoded || "\u00a0"}</span>
      </div>

      {matched && (
        <p className="feedback feedback--ok" role="status">
          Correct
        </p>
      )}

      <div className="practice__controls">
        <button type="button" onClick={clear}>
          Clear
        </button>
        <button type="button" onClick={() => void nextTarget()}>
          New target
        </button>
      </div>

      {practice.status === "pending" && <p role="status">Saving…</p>}
      {practice.error && (
        <div role="alert">
          <span>{practice.error}</span>
          <button type="button" onClick={() => void practice.retry()}>
            Retry save
          </button>
        </div>
      )}
    </div>
  );
}
