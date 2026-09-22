import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type CompositionEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { encodeCharacter, isSupportedCharacter } from "../../core/morse.ts";
import { useLearnSession } from "../hooks/useLearnSession.ts";

const PROMPTS: Record<string, string> = {
  "copy-character": "Copy the character you hear",
  "copy-group": "Copy the group you hear",
  "copy-word": "Copy the word you hear",
};

function sanitize(value: string): string {
  // Keep every supported Morse character, including punctuation like . , = / ?
  return [...value.toUpperCase()].filter(isSupportedCharacter).join("");
}

export function LearnScreen() {
  const learn = useLearnSession();
  const { exercise, feedback, awaitingContinue, inputReady, isPlaying } = learn;
  const {
    acceptIsolated,
    submitGroupWord,
    acceptCheckpoint,
    replay,
    continueNow,
    continueTransition,
    continueNotification,
    begin,
    endSession,
    startCheckpoint,
    physicalKeyDown,
    physicalKeyUp,
    clearHeldKeys,
    updateContinuousCopy,
    finishContinuousCopy,
    continueContinuousCopy,
  } = learn.actions;

  const [value, setValue] = useState("");
  const composingRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const continuousInputRef = useRef<HTMLTextAreaElement>(null);

  const isCopy = exercise?.direction === "rx" && exercise.type !== "introduce";
  const inCheckpoint = learn.phase === "checkpoint";

  // Clear the field for each new prompt (practice card or checkpoint item).
  useEffect(() => {
    setValue("");
  }, [exercise, learn.checkpoint.position]);

  // Focus the field once its prompt audio has finished and input is unlocked.
  useEffect(() => {
    if (inputReady && (isCopy || inCheckpoint)) {
      inputRef.current?.focus();
    }
  }, [inputReady, isCopy, inCheckpoint]);

  useEffect(() => {
    if (learn.continuousCopy.active) continuousInputRef.current?.focus();
  }, [learn.continuousCopy.active]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        learn.notification &&
        !event.repeat &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey
      ) {
        event.preventDefault();
        continueNotification();
        return;
      }
      const handled = physicalKeyDown(
        event.key,
        event.code,
        event.repeat,
        event.ctrlKey || event.metaKey || event.altKey,
      );
      if (handled) event.preventDefault();
    };
    const onKeyUp = (event: KeyboardEvent) => {
      physicalKeyUp(event.key, event.code);
    };
    const onBlur = () => clearHeldKeys();
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      clearHeldKeys();
    };
  }, [
    learn.notification,
    continueNotification,
    physicalKeyDown,
    physicalKeyUp,
    clearHeldKeys,
  ]);

  function processCheckpoint(raw: string) {
    setValue("");
    acceptCheckpoint(raw);
  }

  function onCheckpointChange(event: ChangeEvent<HTMLInputElement>) {
    if (composingRef.current) return;
    processCheckpoint(event.target.value);
  }

  function processCopy(raw: string) {
    if (!exercise) return;
    if (exercise.type === "copy-character") {
      setValue("");
      acceptIsolated(raw);
      return;
    }
    const next = sanitize(raw);
    setValue(next);
    if (
      exercise.type === "copy-group" &&
      next.length >= exercise.target.length
    ) {
      submitGroupWord(next);
    }
  }

  function onInputChange(event: ChangeEvent<HTMLInputElement>) {
    if (composingRef.current) return;
    processCopy(event.target.value);
  }

  function onCompositionEnd(event: CompositionEvent<HTMLInputElement>) {
    composingRef.current = false;
    const raw = event.currentTarget.value || event.data;
    if (inCheckpoint) processCheckpoint(raw);
    else processCopy(raw);
  }

  function onInputKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter" || event.repeat) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (!exercise) return;
    if (exercise.type === "copy-word" || exercise.type === "copy-group") {
      submitGroupWord(value);
    }
  }

  // Keep focus in the answer field, but never let a focus change unlock input.
  function retainFocus() {
    if (inputReady && (isCopy || inCheckpoint)) {
      window.setTimeout(() => inputRef.current?.focus(), 0);
    }
  }

  function retainContinuousFocus() {
    if (learn.continuousCopy.active) {
      window.setTimeout(() => continuousInputRef.current?.focus(), 0);
    }
  }

  if (learn.phase === "onboarding") {
    return (
      <section>
        <h2>Learn</h2>
        <p>
          Short lessons teach Morse by ear: each new character is introduced by
          sound, drilled on its own, then mixed with the ones you know. Just
          listen and type. One tap to begin, then let it flow.
        </p>
        <button type="button" onClick={() => void begin()}>
          Start learning
        </button>
      </section>
    );
  }

  if (learn.phase === "summary" && learn.summary) {
    const s = learn.summary;
    const { reason, weakCharacter } = learn.readiness;
    return (
      <section>
        <h2>Session complete</h2>
        <ul className="summary">
          <li>
            Active time: {Math.round(s.activeMs / 1000)} s
            {s.valid ? "" : " (too short to count)"}
          </li>
          <li>
            Cards: {s.cards} · scored attempts: {s.attempts} (
            {Math.round(s.accuracy * 100)}% correct)
          </li>
          <li>
            Isolated prompts: {s.isolatedPrompts} · groups: {s.groups} · words:{" "}
            {s.words}
          </li>
          {s.continuousCopyResult && (
            <li>
              Continuous copy: {Math.round(s.continuousCopyDurationMs / 1000)} s
            </li>
          )}
          <li>
            Aligned copy: {s.alignedCorrectCharacters}/{s.charactersTransmitted}{" "}
            correct · {s.charactersTyped} typed (
            {Math.round(s.alignedCharacterAccuracy * 100)}%)
          </li>
          {s.excludedFromMastery > 0 && (
            <li>Excluded assisted/replayed cards: {s.excludedFromMastery}</li>
          )}
          <li>Needs review: {s.charactersNeedingReview.join(" ") || "none"}</li>
          <li>
            Characters practiced: {s.charactersPracticed.join(" ") || "—"}
          </li>
        </ul>

        {s.continuousCopyResult?.abandoned && (
          <p className="feedback feedback--neutral">
            Continuous copy ended early and was not counted toward practice.
          </p>
        )}

        {reason === "READY" && (
          <p className="feedback feedback--ok">
            You’re ready for a checkpoint to unlock the next character.
          </p>
        )}
        {reason === "NEEDS_REVIEW" && (
          <p className="feedback feedback--neutral">
            Review {weakCharacter} a little more before the next checkpoint.
          </p>
        )}
        {reason === "NEEDS_PRACTICE" && (
          <p className="field__label">
            Keep practicing the newest character to get checkpoint-ready.
          </p>
        )}
        {reason === "COMPLETE" && (
          <p className="feedback feedback--ok">
            You’ve unlocked every character. Keep practicing to stay sharp.
          </p>
        )}

        <div className="practice__controls">
          <button type="button" onClick={() => void begin()}>
            Practice again
          </button>
          {reason !== "COMPLETE" && (
            <button
              type="button"
              className={reason === "READY" ? "" : "tab"}
              onClick={() => void startCheckpoint()}
            >
              {reason === "READY" ? "Start checkpoint" : "Try a checkpoint"}
            </button>
          )}
        </div>
      </section>
    );
  }

  if (learn.phase === "checkpoint") {
    const pct = learn.checkpoint.length
      ? Math.round((learn.checkpoint.position / learn.checkpoint.length) * 100)
      : 0;
    return (
      <section>
        <div className="learn__top">
          <span className="field__label">Checkpoint</span>
          <div className="learn__bar" aria-hidden>
            <span style={{ width: `${pct}%` }} />
          </div>
          <span className="field__label">
            {learn.checkpoint.position}/{learn.checkpoint.length}
          </span>
        </div>
        <p className="field__label">
          Copy each character you hear. No replay or hints during the
          checkpoint.
        </p>
        <input
          ref={inputRef}
          className="learn__answer"
          type="text"
          inputMode="text"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          maxLength={1}
          placeholder={inputReady ? "type it" : "listen…"}
          value={value}
          onChange={onCheckpointChange}
          onCompositionStart={() => (composingRef.current = true)}
          onCompositionEnd={onCompositionEnd}
          onBlur={retainFocus}
          disabled={!inputReady}
          aria-label="Checkpoint answer"
        />
      </section>
    );
  }

  if (learn.phase === "checkpoint-result" && learn.checkpointResult) {
    const { result, unlockedCharacter } = learn.checkpointResult;
    return (
      <section>
        <h2>{result.pass ? "Checkpoint passed" : "Not yet"}</h2>
        {result.pass && unlockedCharacter && (
          <p className="feedback feedback--ok">
            New character unlocked: {unlockedCharacter}
          </p>
        )}
        <ul className="summary">
          <li>Overall: {Math.round(result.overallAccuracy * 100)}%</li>
          <li>Newest character: {Math.round(result.newestAccuracy * 100)}%</li>
        </ul>
        {!result.pass && (
          <p className="feedback feedback--neutral">
            {result.missedCharacters.length
              ? `A little more practice on ${result.missedCharacters.join(" ")}.`
              : "Close. A little more practice and try again."}
          </p>
        )}
        <button type="button" onClick={() => void begin()}>
          {result.pass ? "Keep going" : "Back to practice"}
        </button>
      </section>
    );
  }

  if (learn.transition) {
    const recommendationMinutes =
      learn.continuousCopy.recommendedDurationMs / 60000;
    const selectedMinutes = learn.continuousCopy.selectedDurationMs / 60000;
    return (
      <section>
        <div className="learn__top">
          <span className="field__label" aria-live="polite">
            {learn.phaseLabel}
          </span>
          <div className="learn__bar" aria-hidden>
            <span style={{ width: "100%" }} />
          </div>
        </div>
        <div className="learn__intro" aria-live="polite">
          <h2>{learn.transition.title}</h2>
          <p>{learn.transition.text}</p>
          {learn.transition.id === "continuous-copy" && (
            <p className="field__label">
              Recommended for your active set: {recommendationMinutes}{" "}
              {recommendationMinutes === 1 ? "minute" : "minutes"}. Selected:{" "}
              {selectedMinutes} {selectedMinutes === 1 ? "minute" : "minutes"}.
            </p>
          )}
          <button type="button" onClick={continueTransition} autoFocus>
            {learn.transition.actionLabel}
          </button>
        </div>
        <div className="practice__controls learn__end">
          <button type="button" className="tab" onClick={endSession}>
            End session
          </button>
        </div>
      </section>
    );
  }

  if (learn.notification) {
    return (
      <section>
        <div className="learn__top">
          <span className="field__label" aria-live="polite">
            {learn.phaseLabel}
          </span>
        </div>
        <div className="learn__intro" aria-live="polite">
          <h2>{learn.notification.title}</h2>
          <button type="button" onClick={continueNotification} autoFocus>
            {learn.notification.actionLabel}
          </button>
        </div>
        <div className="practice__controls learn__end">
          <button type="button" className="tab" onClick={endSession}>
            End session
          </button>
        </div>
      </section>
    );
  }

  if (learn.continuousCopy.stage === "result" && learn.continuousCopy.result) {
    const result = learn.continuousCopy.result;
    return (
      <section>
        <div className="learn__top">
          <span className="field__label">Continuous copy</span>
          <div className="learn__bar" aria-hidden>
            <span style={{ width: "100%" }} />
          </div>
        </div>
        <h2>Copy complete</h2>
        <ul className="summary">
          <li>{Math.round((result.accuracy ?? 0) * 100)}% aligned accuracy</li>
          <li>
            {result.alignedCorrect} correct · {result.insertions} extra ·{" "}
            {result.deletions} missed · {result.substitutions} changed
          </li>
        </ul>
        <button type="button" onClick={continueContinuousCopy} autoFocus>
          Continue
        </button>
      </section>
    );
  }

  if (learn.continuousCopy.active) {
    const { remainingMs, totalMs, stage } = learn.continuousCopy;
    const remainingSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
    const minutes = Math.floor(remainingSeconds / 60);
    const seconds = String(remainingSeconds % 60).padStart(2, "0");
    const progress = totalMs
      ? Math.round(((totalMs - remainingMs) / totalMs) * 100)
      : 0;
    return (
      <section>
        <div className="learn__top">
          <span className="field__label" aria-live="polite">
            Continuous copy
          </span>
          <div className="learn__bar" aria-hidden>
            <span style={{ width: `${progress}%` }} />
          </div>
          <span className="field__label" aria-label="Time remaining">
            {minutes}:{seconds}
          </span>
        </div>
        <div className="practice">
          <p className="field__label" role="status">
            {stage === "playing" ? "Listening…" : "Finishing…"}
          </p>
          <textarea
            ref={continuousInputRef}
            className="learn__continuous-answer"
            inputMode="text"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            value={learn.continuousCopy.text}
            onChange={(event) => updateContinuousCopy(event.target.value)}
            onBlur={retainContinuousFocus}
            aria-label="Continuous copy"
          />
          {stage === "finishing" && (
            <div className="practice__controls">
              <button type="button" onClick={() => finishContinuousCopy()}>
                Finish
              </button>
            </div>
          )}
        </div>
        <div className="practice__controls learn__end">
          <button type="button" className="tab" onClick={endSession}>
            End session
          </button>
        </div>
      </section>
    );
  }

  if (!exercise) {
    return null;
  }

  const progressPct = Math.round(
    (learn.progress.unlocked / learn.progress.total) * 100,
  );
  const assisted = exercise.assisted && exercise.type === "copy-character";

  return (
    <section>
      <div className="learn__top">
        <span className="field__label" aria-live="polite">
          {learn.phaseLabel}
        </span>
        <div className="learn__bar" aria-hidden>
          <span style={{ width: `${progressPct}%` }} />
        </div>
        <span className="field__label" aria-label="Lesson card progress">
          {learn.completed}/{learn.total} · {learn.progress.unlocked}/
          {learn.progress.total} unlocked
        </span>
      </div>

      {exercise.type === "introduce" ? (
        <div className="learn__intro">
          <p className="field__label">New character</p>
          <div className="send__target-char">{exercise.target}</div>
          <code className="learn__morse">
            {encodeCharacter(exercise.target) ?? ""}
          </code>
          <p className="field__label">Listen…</p>
          <div className="practice__controls">
            <button
              type="button"
              className="tab"
              onClick={replay}
              disabled={isPlaying}
            >
              Replay
            </button>
            <button type="button" onClick={continueNow} disabled={isPlaying}>
              Continue
            </button>
          </div>
        </div>
      ) : (
        <div className="practice">
          <p className="field__label">
            {PROMPTS[exercise.type]}
            {exercise.type === "copy-group"
              ? ` · ${exercise.target.length} characters`
              : ""}
          </p>

          {assisted && (
            <div className="learn__assist" role="note">
              <span className="learn__assist-char">{exercise.target}</span>
              <code className="learn__morse">
                {encodeCharacter(exercise.target) ?? ""}
              </code>
              <span className="field__label">Listen and type it.</span>
            </div>
          )}

          <input
            ref={inputRef}
            className="learn__answer"
            type="text"
            inputMode="text"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            maxLength={
              exercise.type === "copy-character"
                ? 1
                : exercise.type === "copy-group"
                  ? exercise.target.length
                  : undefined
            }
            placeholder={
              exercise.type === "copy-character"
                ? "type the letter"
                : exercise.type === "copy-group"
                  ? `type ${exercise.target.length} characters`
                  : "type the word, then Enter"
            }
            value={value}
            onChange={onInputChange}
            onKeyDown={onInputKeyDown}
            onCompositionStart={() => (composingRef.current = true)}
            onCompositionEnd={onCompositionEnd}
            onBlur={retainFocus}
            disabled={!inputReady || !!feedback}
            aria-label="Your copy"
          />
          <div className="practice__controls">
            <button
              type="button"
              className="tab"
              onClick={replay}
              disabled={isPlaying}
            >
              Replay
            </button>
          </div>

          {feedback && (
            <div className="learn__feedback" role="status">
              {feedback.correct ? (
                <span className="learn__mark">✓</span>
              ) : exercise.type === "copy-character" ? (
                <span className="feedback feedback--neutral">
                  Let’s hear that one again
                </span>
              ) : (
                <span className="feedback feedback--neutral">
                  Expected {feedback.expected}
                </span>
              )}
            </div>
          )}

          {awaitingContinue && (
            <div className="practice__controls">
              <button
                type="button"
                onClick={continueNow}
                disabled={isPlaying}
                autoFocus
              >
                Continue
              </button>
            </div>
          )}
        </div>
      )}

      <div className="practice__controls learn__end">
        <button type="button" className="tab" onClick={endSession}>
          End session
        </button>
      </div>
    </section>
  );
}
