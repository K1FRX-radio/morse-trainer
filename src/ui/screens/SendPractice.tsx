import { useCallback, useEffect, useRef, useState } from "react";
import {
  buildSendWordTarget,
  buildSendTarget,
  type SendTargetLength,
} from "../../core/scheduler.ts";
import type { CurriculumState } from "../../core/curriculum.ts";
import { createRng, type Rng } from "../../core/rng.ts";
import type { SchedulerReason } from "../../core/types.ts";
import { thresholdsForWpm } from "../../core/keying.ts";
import { StraightKey } from "../../input/key-input.ts";
import { attachKeyboardKey } from "../../input/keyboard-key.ts";
import { attachPointerKey } from "../../input/pointer-key.ts";
import { encodeKeyingTiming } from "../../data/keying-timing.ts";
import type { CharacterProjectionRecord } from "../../data/models.ts";
import { DEFAULT_LESSON_CONFIG } from "../../training/lesson-plan.ts";
import { useSettings } from "../settings-context.ts";
import { useAudioEngine } from "../hooks/useAudioEngine.ts";
import { usePracticeSession } from "../hooks/usePracticeSession.ts";
import { useTrainingData } from "../training-data-context.ts";

type SendExerciseMode = "character" | "group-2" | "group-3" | "word";

type TargetSelection = {
  target: string | undefined;
  reason: SchedulerReason;
};

function normalizeDecoded(value: string): string {
  return value.toUpperCase().replace(/\s+/g, "");
}

function modeLength(mode: SendExerciseMode): SendTargetLength | undefined {
  switch (mode) {
    case "character":
      return 1;
    case "group-2":
      return 2;
    case "group-3":
      return 3;
    case "word":
      return undefined;
  }
}

function exerciseTypeForMode(
  mode: SendExerciseMode,
): "send-character" | "send-group" | "send-word" {
  switch (mode) {
    case "character":
      return "send-character";
    case "group-2":
    case "group-3":
      return "send-group";
    case "word":
      return "send-word";
  }
}

function selectTarget(
  mode: SendExerciseMode,
  txRows: CharacterProjectionRecord[],
  rng: Rng,
  curriculum: CurriculumState,
): TargetSelection {
  const performance = txAccuracy(txRows);
  const length = modeLength(mode);
  if (length !== undefined) {
    const selection = buildSendTarget(curriculum, rng, length, performance);
    return {
      target: selection.target,
      reason: selection.reason,
    };
  }

  const selection = buildSendWordTarget(curriculum, rng, {
    minimumLength: DEFAULT_LESSON_CONFIG.initialWordMinLength,
    maximumLength: DEFAULT_LESSON_CONFIG.initialWordMaxLength,
    performance,
  });
  return {
    target: selection.target,
    reason: selection.reason,
  };
}

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
  const targetModeRef = useRef<SendExerciseMode | undefined>(undefined);
  const schedulerReasonRef = useRef<SchedulerReason | undefined>(undefined);
  const promptToken = useRef(1);
  const committedToken = useRef<number | undefined>(undefined);
  const targetRequestIdRef = useRef(0);

  const [decoded, setDecoded] = useState("");
  const [exerciseMode, setExerciseMode] =
    useState<SendExerciseMode>("character");
  const [target, setTarget] = useState<string | undefined>(undefined);
  const [targetError, setTargetError] = useState<string | undefined>(undefined);
  targetRef.current = target;

  const chooseTarget = useCallback(
    async (mode: SendExerciseMode): Promise<void> => {
      const requestId = targetRequestIdRef.current + 1;
      targetRequestIdRef.current = requestId;
      const curriculum = loadCurriculum();
      if (curriculum.characters.length === 0) {
        if (requestId !== targetRequestIdRef.current) return;
        setTarget(undefined);
        setTargetError(
          "No unlocked characters are available for Send Practice.",
        );
        targetModeRef.current = undefined;
        schedulerReasonRef.current = undefined;
        return;
      }

      const txRows = await listCharacterProjections({
        direction: "tx",
        limit: curriculum.characters.length,
      });
      if (requestId !== targetRequestIdRef.current) return;
      const selection = selectTarget(mode, txRows, rng.current, curriculum);
      if (!selection.target) {
        targetModeRef.current = undefined;
        schedulerReasonRef.current = undefined;
        setTarget(undefined);
        setTargetError(
          "No eligible words are available for the unlocked character set.",
        );
        return;
      }
      targetModeRef.current = mode;
      schedulerReasonRef.current = selection.reason;
      setTarget(selection.target);
      setTargetError(undefined);
    },
    [listCharacterProjections, loadCurriculum],
  );

  useEffect(() => {
    void chooseTarget(exerciseMode).catch(() => {
      setTarget(undefined);
      setTargetError("Unable to load a target right now.");
      schedulerReasonRef.current = undefined;
      targetModeRef.current = undefined;
    });
  }, [chooseTarget, exerciseMode]);

  if (!keyRef.current) {
    keyRef.current = new StraightKey({
      thresholds: thresholdsForWpm(settings.charWpm),
      onMarkStart: () => {
        if (
          targetRef.current === undefined ||
          targetModeRef.current === undefined
        ) {
          keyRef.current?.reset();
          return;
        }
        void practice.start().catch(() => undefined);
        void unlock();
        engine.startTone(settingsRef.current.toneHz);
      },
      onMarkEnd: () => {
        if (
          targetRef.current === undefined ||
          targetModeRef.current === undefined
        ) {
          engine.stopTone();
          return;
        }
        practice.recordActivity();
        engine.stopTone();
      },
      onDecodeChange: (result) => {
        if (
          targetRef.current === undefined ||
          targetModeRef.current === undefined
        ) {
          return;
        }
        setDecoded(result.text);
        const token = promptToken.current;
        if (
          targetRef.current === undefined ||
          normalizeDecoded(result.text) !== targetRef.current ||
          committedToken.current === token
        ) {
          return;
        }
        const targetMode = targetModeRef.current;
        if (targetMode === undefined) {
          return;
        }
        committedToken.current = token;
        void practice
          .recordAttempt({
            exerciseType: exerciseTypeForMode(targetMode),
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

  function beginNewPrompt(): void {
    promptToken.current += 1;
  }

  async function nextTarget(): Promise<void> {
    if (!target) {
      await chooseTarget(exerciseMode);
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
      const targetMode = targetModeRef.current;
      if (targetMode === undefined) {
        return;
      }
      committedToken.current = token;
      try {
        await practice.recordAttempt({
          exerciseType: exerciseTypeForMode(targetMode),
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
    beginNewPrompt();
    await chooseTarget(exerciseMode);
  }

  async function changeMode(mode: SendExerciseMode): Promise<void> {
    setTarget(undefined);
    setTargetError(undefined);
    targetModeRef.current = undefined;
    schedulerReasonRef.current = undefined;
    setExerciseMode(mode);
    clear();
    beginNewPrompt();
  }

  const matched = target !== undefined && normalizeDecoded(decoded) === target;

  return (
    <div className="practice">
      <div className="send__target" aria-label="Send this character">
        <span className="send__target-label">Send</span>
        <span className="send__target-char">{target ?? "-"}</span>
      </div>

      <label className="field">
        <span className="field__label">Exercise</span>
        <select
          value={exerciseMode}
          onChange={(event) => {
            const mode = event.target.value as SendExerciseMode;
            void changeMode(mode);
          }}
        >
          <option value="character">1 character</option>
          <option value="group-2">2 characters</option>
          <option value="group-3">3 characters</option>
          <option value="word">Word</option>
        </select>
      </label>

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
