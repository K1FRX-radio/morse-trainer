import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type CompositionEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { encodeCharacter } from "../../core/morse.ts";
import { sanitizeCopyInput } from "../copy-input.ts";
import { useLearnSession } from "../hooks/useLearnSession.ts";

const PROMPTS: Record<string, string> = {
  "copy-character": "Copy the character you hear",
  "copy-group": "Copy the group you hear",
  "copy-word": "Copy the word you hear",
};

const FAMILIARITY_LABELS = {
  new: "New",
  learning: "Learning",
  familiar: "Familiar",
  solid: "Solid",
} as const;

export function LearnScreen() {
  const learn = useLearnSession();
  const {
    exercise,
    feedback,
    introStage,
    awaitingContinue,
    inputReady,
    typingReady,
    isPlaying,
  } = learn;
  const {
    acceptIsolated,
    updateGroupWord,
    submitGroupWord,
    acceptAdvancement,
    replay,
    continueNow,
    continueTransition,
    continueNotification,
    begin,
    restartFullLesson,
    practiceLongCopy,
    acceptSpacingSuggestion,
    retryPersistence,
    endSession,
    physicalKeyDown,
    physicalKeyUp,
    clearHeldKeys,
    updateContinuousCopy,
    finishContinuousCopy,
    continueContinuousCopy,
    pauseContinuousCopy,
    resumeContinuousCopy,
  } = learn.actions;

  const [value, setValue] = useState("");
  const [selectedCharacter, setSelectedCharacter] = useState<
    string | undefined
  >(undefined);
  const composingRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const continuousInputRef = useRef<HTMLTextAreaElement>(null);

  const isCopy = exercise?.direction === "rx" && exercise.type !== "introduce";
  const supportsTypeBehind =
    exercise?.type === "copy-group" || exercise?.type === "copy-word";
  const isolatedCopy = exercise?.type === "copy-character";
  const answerReady =
    isolatedCopy || supportsTypeBehind ? typingReady : inputReady;
  const introControlsReady = introStage === "ready" && !isPlaying;
  const persistenceReady = learn.persistenceStatus === "ready";
  const canStartLongCopy = learn.progress.unlocked >= 2;
  const selectedFamiliarity = useMemo(
    () =>
      learn.dashboard.characters.find(
        (character) => character.character === selectedCharacter,
      ),
    [learn.dashboard.characters, selectedCharacter],
  );
  const persistenceNotice =
    learn.persistenceStatus === "error" ? (
      <div className="feedback feedback--neutral" role="alert">
        <p>{learn.persistenceError}</p>
        {learn.persistenceDiagnostic && (
          <details>
            <summary>Save details</summary>
            <p>{learn.persistenceDiagnostic.summary}</p>
          </details>
        )}
        <button type="button" onClick={retryPersistence}>
          Retry saving
        </button>
      </div>
    ) : learn.persistenceStatus === "pending" &&
      (learn.phase === "summary" || learn.persistenceRetrying) ? (
      <p className="feedback feedback--neutral" role="status">
        {learn.persistenceRetrying ? "Retrying save..." : "Saving session..."}
      </p>
    ) : null;

  // Clear the field for each new practice prompt.
  useEffect(() => {
    setValue("");
  }, [exercise]);

  // Keep the active copy field focused as each prompt begins.
  useEffect(() => {
    if (answerReady && isCopy) {
      inputRef.current?.focus();
    }
  }, [answerReady, exercise, isCopy]);

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

  function processCopy(raw: string) {
    if (!exercise) return;
    if (exercise.type === "copy-character") {
      setValue("");
      acceptIsolated(raw);
      return;
    }
    const next = sanitizeCopyInput(raw);
    setValue(next);
    updateGroupWord(next);
  }

  function onInputChange(event: ChangeEvent<HTMLInputElement>) {
    if (composingRef.current) return;
    processCopy(event.target.value);
  }

  function onCompositionEnd(event: CompositionEvent<HTMLInputElement>) {
    composingRef.current = false;
    const raw = event.currentTarget.value || event.data;
    processCopy(raw);
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
    if (answerReady && isCopy) {
      window.setTimeout(() => inputRef.current?.focus(), 0);
    }
  }

  function retainContinuousFocus() {
    if (learn.continuousCopy.active) {
      window.setTimeout(() => continuousInputRef.current?.focus(), 0);
    }
  }

  if (learn.phase === "onboarding") {
    const curriculumPct = Math.round(learn.dashboard.curriculumProgress * 100);
    return (
      <section data-learn-phase="onboarding">
        <h2>Learn</h2>
        {persistenceNotice}
        <div className="learn__dashboard" aria-label="Curriculum progress">
          <p className="field__label">
            {learn.dashboard.unlocked} of {learn.dashboard.total} characters
            discovered
          </p>
          <p className="field__label">
            Progress shows discovered curriculum characters, not proficiency.
          </p>
          <div
            className="learn__bar"
            role="progressbar"
            aria-label="Curriculum discovery progress"
            aria-valuemin={0}
            aria-valuemax={learn.dashboard.total}
            aria-valuenow={learn.dashboard.unlocked}
            aria-valuetext={`${curriculumPct}% of curriculum discovered`}
          >
            <span style={{ width: `${curriculumPct}%` }} />
          </div>
        </div>

        <div
          className="learn__character-map"
          aria-label="Discovered characters"
        >
          {learn.dashboard.characters.map((character) => {
            const ringPct = Math.round(character.ringFill * 100);
            return (
              <button
                key={character.character}
                type="button"
                className="learn__character-tile"
                aria-label={`Character ${character.character}`}
                aria-pressed={selectedCharacter === character.character}
                onClick={() => setSelectedCharacter(character.character)}
              >
                <span
                  className="learn__character-ring"
                  aria-hidden
                  style={{
                    background: `conic-gradient(var(--k1frx-accent) ${ringPct}%, rgba(255,255,255,0.12) 0%)`,
                  }}
                >
                  <span className="learn__character-fill" />
                </span>
                <span className="learn__character-symbol">
                  {character.character}
                </span>
                <span className="learn__character-level field__label">
                  {FAMILIARITY_LABELS[character.level]}
                  {character.needsReview ? " · review" : ""}
                </span>
              </button>
            );
          })}
        </div>

        {selectedFamiliarity && (
          <section
            className="learn__character-detail"
            aria-label={`Character detail ${selectedFamiliarity.character}`}
          >
            <div className="learn__intro">
              <p className="field__label">Character detail</p>
              <div className="send__target-char">
                {selectedFamiliarity.character}
              </div>
              <code className="learn__morse">
                {encodeCharacter(selectedFamiliarity.character) ?? ""}
              </code>
              <p className="field__label">
                Familiarity: {FAMILIARITY_LABELS[selectedFamiliarity.level]}
                {selectedFamiliarity.needsReview ? " · needs review" : ""}
              </p>
              <p className="field__label">
                Recent RX:{" "}
                {Math.round(selectedFamiliarity.recentAccuracy * 100)}% ·
                observations: {selectedFamiliarity.observations}
              </p>
              <div className="practice__controls">
                <button
                  type="button"
                  className="tab"
                  onClick={() =>
                    void learn.actions.previewCharacter(
                      selectedFamiliarity.character,
                    )
                  }
                  disabled={learn.previewingCharacter !== undefined}
                >
                  {learn.previewingCharacter === selectedFamiliarity.character
                    ? `Playing ${selectedFamiliarity.character}...`
                    : `Hear ${selectedFamiliarity.character}`}
                </button>
                <button
                  type="button"
                  className="tab"
                  onClick={() => setSelectedCharacter(undefined)}
                >
                  Close detail
                </button>
              </div>
              <div className="practice__controls">
                <button type="button" onClick={() => void begin()}>
                  Continue learning
                </button>
                {canStartLongCopy && (
                  <button type="button" onClick={() => void practiceLongCopy()}>
                    Practice long copy
                  </button>
                )}
              </div>
            </div>
          </section>
        )}

        <p>
          Short lessons teach Morse by ear: each new character is introduced by
          sound, drilled on its own, then mixed with the ones you know. Just
          listen and type. One tap to begin, then let it flow.
        </p>
        <div className="practice__controls">
          <button type="button" onClick={() => void begin()}>
            Start learning
          </button>
          {canStartLongCopy && (
            <button type="button" onClick={() => void practiceLongCopy()}>
              Start long copy
            </button>
          )}
        </div>
      </section>
    );
  }

  if (learn.phase === "summary" && learn.summary) {
    const s = learn.summary;
    const assessment = s.advancementAssessment;
    const recommendation = learn.retryRecommendation;
    const spacing = recommendation?.spacing;
    const longCopyButton = (
      <button
        type="button"
        className={
          assessment?.eligible ||
          recommendation?.emphasizedAction === "full-lesson"
            ? "tab"
            : undefined
        }
        onClick={() => void practiceLongCopy()}
        disabled={!persistenceReady}
      >
        {spacing
          ? `Practice again at ${spacing.charWpm} / ${spacing.currentEffectiveWpm} WPM`
          : "Practice long copy"}
      </button>
    );
    const fullLessonButton = (
      <button
        type="button"
        className={
          recommendation?.emphasizedAction === "full-lesson" ? undefined : "tab"
        }
        onClick={() => void restartFullLesson()}
        disabled={!persistenceReady}
      >
        Restart full lesson
      </button>
    );
    return (
      <section data-learn-phase={learn.phaseId}>
        <h2>Session complete</h2>
        {persistenceNotice}
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
              · {s.continuousTotalTokens} tokens (
              {s.continuousRandomGroupTokens} groups · {s.continuousWordTokens}{" "}
              words)
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

        {assessment?.reason === "READY" && (
          <div className="learn__intro">
            <h2>Looks like you’re ready for a new character!</h2>
            <p>
              You copied {Math.round(assessment.overallAccuracy * 100)}% overall
              and {Math.round(assessment.newestAccuracy * 100)}% of{" "}
              {assessment.newestCharacter}.
            </p>
          </div>
        )}
        {assessment?.reason === "ABANDONED" && (
          <p className="feedback feedback--neutral">
            Continuous copy ended early and was not counted toward practice.
          </p>
        )}
        {assessment?.reason === "NEEDS_REVIEW" && (
          <p className="feedback feedback--neutral">
            A little more practice with {assessment.weakCharacter} will help
            before adding another character.
          </p>
        )}
        {assessment?.reason === "INSUFFICIENT_TOTAL_EVIDENCE" && (
          <p className="feedback feedback--neutral">
            Keep copying a little longer so the app has enough information.
          </p>
        )}
        {assessment?.reason === "INCOMPLETE_ACTIVE_COVERAGE" && (
          <p className="feedback feedback--neutral">
            This session didn’t include enough of the full character set yet.
          </p>
        )}
        {assessment?.reason === "INSUFFICIENT_NEWEST_COVERAGE" && (
          <p className="feedback feedback--neutral">
            Let’s hear {assessment.newestCharacter} a few more times before
            adding another character.
          </p>
        )}
        {assessment?.reason === "LOW_OVERALL_ACCURACY" && (
          <p className="feedback feedback--neutral">
            You copied {Math.round(assessment.overallAccuracy * 100)}% overall.
            Keep practicing and aim for 90%.
          </p>
        )}
        {assessment?.reason === "LOW_NEWEST_ACCURACY" && (
          <p className="feedback feedback--neutral">
            Keep practicing {assessment.newestCharacter}. You copied it
            correctly {Math.round(assessment.newestAccuracy * 100)}% of the
            time.
          </p>
        )}
        {assessment?.reason === "COMPLETE" && (
          <p className="feedback feedback--ok">
            You’ve unlocked every character. Keep practicing to stay sharp.
          </p>
        )}
        {!assessment && (
          <p className="feedback feedback--neutral">
            Complete continuous copy to see whether you’re ready for another
            character.
          </p>
        )}

        {assessment && !assessment.eligible && (
          <p>
            Not quite ready for a new character yet. What would you like to
            practice?
          </p>
        )}

        {spacing && (
          <p className="feedback feedback--neutral">
            Continuous copy is still feeling difficult. Want a little more space
            between characters? The characters will still play at{" "}
            {spacing.charWpm} WPM, but the overall pace will drop from{" "}
            {spacing.currentEffectiveWpm} to {spacing.effectiveWpm} WPM.
          </p>
        )}

        <div className="practice__controls retry-actions">
          {assessment?.eligible && assessment.nextCharacter && (
            <button
              type="button"
              onClick={acceptAdvancement}
              disabled={!persistenceReady}
            >
              Learn {assessment.nextCharacter}
            </button>
          )}
          {assessment?.eligible && assessment.reason === "COMPLETE" && (
            <button
              type="button"
              onClick={acceptAdvancement}
              disabled={!persistenceReady}
            >
              Complete curriculum
            </button>
          )}
          {spacing && (
            <button
              type="button"
              onClick={acceptSpacingSuggestion}
              disabled={!persistenceReady}
            >
              Try {spacing.charWpm} / {spacing.effectiveWpm} WPM
            </button>
          )}
          {recommendation?.emphasizedAction === "full-lesson" && !spacing ? (
            <>
              {fullLessonButton}
              {longCopyButton}
            </>
          ) : (
            <>
              {longCopyButton}
              {fullLessonButton}
            </>
          )}
        </div>
      </section>
    );
  }

  if (learn.transition) {
    const recommendationMinutes =
      learn.continuousCopy.recommendedDurationMs / 60000;
    const selectedMinutes = learn.continuousCopy.selectedDurationMs / 60000;
    return (
      <section data-learn-phase={learn.phaseId}>
        {persistenceNotice}
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
      <section data-learn-phase={learn.phaseId}>
        {persistenceNotice}
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
      <section data-learn-phase={learn.phaseId}>
        {persistenceNotice}
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
          <li>
            {result.totalTokens} tokens · {result.randomGroupTokens} groups ·{" "}
            {result.wordTokens} words
          </li>
        </ul>
        <button type="button" onClick={continueContinuousCopy} autoFocus>
          Continue
        </button>
      </section>
    );
  }

  if (learn.continuousCopy.active || learn.continuousCopy.paused) {
    const { remainingMs, totalMs, stage } = learn.continuousCopy;
    const remainingSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
    const minutes = Math.floor(remainingSeconds / 60);
    const seconds = String(remainingSeconds % 60).padStart(2, "0");
    const progress = totalMs
      ? Math.round(((totalMs - remainingMs) / totalMs) * 100)
      : 0;
    return (
      <section data-learn-phase={learn.phaseId}>
        {persistenceNotice}
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
            {stage === "playing"
              ? "Listening…"
              : stage === "paused"
                ? "Paused"
                : "Finishing…"}
          </p>
          {stage === "paused" && (
            <p className="field__label">
              Paused with {minutes}:{seconds} remaining
            </p>
          )}
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
          <div className="practice__controls">
            {stage === "playing" && (
              <button type="button" onClick={() => pauseContinuousCopy()}>
                Pause
              </button>
            )}
            {stage === "paused" && (
              <button type="button" onClick={() => resumeContinuousCopy()}>
                Resume
              </button>
            )}
            {stage === "finishing" && (
              <button type="button" onClick={() => finishContinuousCopy()}>
                Finish
              </button>
            )}
          </div>
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
    <section data-learn-phase={learn.phaseId}>
      {persistenceNotice}
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
          <p className="field__label">
            {introStage === "ready"
              ? "Replay it as often as you like. Start practice when the sound feels familiar."
              : "Listen…"}
          </p>
          <div className="practice__controls">
            <button
              type="button"
              className="tab"
              onClick={replay}
              disabled={!introControlsReady}
            >
              Replay
            </button>
            <button
              type="button"
              onClick={continueNow}
              disabled={!introControlsReady}
            >
              Start practice
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
            disabled={!answerReady || (!isolatedCopy && !!feedback)}
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
