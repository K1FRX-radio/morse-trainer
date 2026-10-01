import { useCallback, useEffect, useRef, useState } from "react";
import { selectExercise } from "../../core/scheduler.ts";
import { createRng, type Rng } from "../../core/rng.ts";
import type { SchedulerReason } from "../../core/types.ts";
import { thresholdsForWpm } from "../../core/keying.ts";
import { StraightKey } from "../../input/key-input.ts";
import { attachKeyboardKey } from "../../input/keyboard-key.ts";
import { attachPointerKey } from "../../input/pointer-key.ts";
import { encodeKeyingTiming } from "../../data/keying-timing.ts";
import type { CharacterProjectionRecord } from "../../data/models.ts";
import { useSettings } from "../settings-context.ts";
import { useAudioEngine } from "../hooks/useAudioEngine.ts";
import { usePracticeSession } from "../hooks/usePracticeSession.ts";
import { useTrainingData } from "../training-data-context.ts";

function txAccuracy(
  rows: CharacterProjectionRecord[],
): Partial<Record<string, number>> {
  const byCharacter: Partial<Record<string, number>> = {};
  for (const row of rows) {
    if (row.direction !== "tx") {
      continue;
    }
    if (row.recent.length === 0) {
      continue;
    }
    const correct = row.recent.filter(
      (observation) => observation.correct,
    ).length;
    byCharacter[row.character] = correct / row.recent.length;
  }
  return byCharacter;
}

export function SendPractice() {
  const { settings } = useSettings();
  const { loadCurriculum, listCharacterProjections } = useTrainingData();
  const { engine, unlock } = useAudioEngine();
  const practice = usePracticeSession("send-practice", settings);
  const rng = useRef<Rng>(createRng(Date.now() >>> 0));

  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const buttonRef = useRef<HTMLButtonElement>(null);
  const keyRef = useRef<StraightKey | undefined>(undefined);
  const targetRef = useRef<string | undefined>(undefined);
  const schedulerReasonRef = useRef<SchedulerReason | undefined>(undefined);
  const promptToken = useRef(1);
  const committedToken = useRef<number | undefined>(undefined);

  const [decoded, setDecoded] = useState("");
  const [target, setTarget] = useState<string | undefined>(undefined);
  const [targetError, setTargetError] = useState<string | undefined>(undefined);
  targetRef.current = target;

  const chooseTarget = useCallback(async (): Promise<void> => {
    const curriculum = loadCurriculum();
    if (curriculum.characters.length === 0) {
      setTarget(undefined);
      setTargetError("No unlocked characters are available for Send Practice.");
      schedulerReasonRef.current = undefined;
      return;
    }

    const txRows = await listCharacterProjections({
      direction: "tx",
      limit: curriculum.characters.length,
    });
    const selection = selectExercise(curriculum, rng.current, {
      direction: "tx",
      performance: txAccuracy(txRows),
    });
    schedulerReasonRef.current = selection.reason;
    setTarget(selection.character);
    setTargetError(undefined);
  }, [listCharacterProjections, loadCurriculum]);

  useEffect(() => {
    void chooseTarget().catch(() => {
      setTarget(undefined);
      setTargetError("Unable to load a target right now.");
      schedulerReasonRef.current = undefined;
    });
  }, [chooseTarget]);

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
          targetRef.current === undefined ||
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
            ...(schedulerReasonRef.current === undefined
              ? {}
              : { schedulerReason: schedulerReasonRef.current }),
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
    if (!target) {
      await chooseTarget();
      return;
    }
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
          ...(schedulerReasonRef.current === undefined
            ? {}
            : { schedulerReason: schedulerReasonRef.current }),
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
    await chooseTarget();
  }

  const matched =
    target !== undefined && decoded.trim().toUpperCase() === target;

  return (
    <div className="practice">
      <div className="send__target" aria-label="Send this character">
        <span className="send__target-label">Send</span>
        <span className="send__target-char">{target ?? "-"}</span>
      </div>

      {targetError && (
        <p className="feedback feedback--bad" role="alert">
          {targetError}
        </p>
      )}

      <button
        ref={buttonRef}
        type="button"
        className="send__key"
        aria-label="Straight key (hold to send)"
        disabled={!target}
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
