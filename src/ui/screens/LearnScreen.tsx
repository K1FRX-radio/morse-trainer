import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from "react";
import { encodeCharacter } from "../../core/morse.ts";
import { useLearnSession } from "../hooks/useLearnSession.ts";
import { SendPad } from "../components/SendPad.tsx";

const PROMPTS: Record<string, string> = {
  "copy-character": "Copy the character you hear",
  "copy-group": "Copy the group you hear",
  "copy-word": "Copy the word you hear",
  "send-character": "Send this character",
};

function sanitize(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function LearnScreen() {
  const learn = useLearnSession();
  const { exercise, feedback, awaitingContinue } = learn;
  const { record, replay, continueNow, begin, endSession } = learn.actions;

  const [value, setValue] = useState("");
  const [decoded, setDecoded] = useState("");
  const [sendReset, setSendReset] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const isCopy =
    exercise?.direction === "rx" && exercise.type !== "introduce";

  useEffect(() => {
    setValue("");
    setDecoded("");
    setSendReset((n) => n + 1);
    if (isCopy) {
      // Focus so physical and on-screen keyboards go straight to the answer.
      inputRef.current?.focus();
    }
  }, [exercise, isCopy]);

  // Sending auto-submits as correct as soon as the decode matches the target.
  useEffect(() => {
    if (
      exercise?.type === "send-character" &&
      !feedback &&
      decoded.trim().toUpperCase() === exercise.target
    ) {
      record(true);
    }
  }, [decoded, exercise, feedback, record]);

  function onInputChange(event: ChangeEvent<HTMLInputElement>) {
    if (!exercise || feedback) return;
    const next = sanitize(event.target.value);
    if (exercise.type === "copy-character") {
      const first = next.slice(0, 1);
      setValue(first);
      if (first) record(first);
      return;
    }
    setValue(next);
    if (exercise.type === "copy-group" && next.length >= exercise.target.length) {
      record(next);
    }
  }

  function onInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter" || !exercise || feedback) return;
    if (exercise.type === "copy-word" || exercise.type === "copy-group") {
      record(value);
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
          <li>Characters practiced: {s.charactersPracticed.join(" ") || "—"}</li>
        </ul>
        <button type="button" onClick={() => void begin()}>
          Practice again
        </button>
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
        <span className="field__label">
          Character {learn.progress.current} · {learn.progress.unlocked}/
          {learn.progress.total} unlocked
        </span>
        <div className="learn__bar" aria-hidden>
          <span style={{ width: `${progressPct}%` }} />
        </div>
        <span className="field__label">
          {learn.completed}/{learn.total}
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
            <button type="button" className="tab" onClick={replay}>
              Replay
            </button>
            <button type="button" onClick={continueNow}>
              Continue
            </button>
          </div>
        </div>
      ) : (
        <div className="practice">
          <p className="field__label">
            {PROMPTS[exercise.type]}
            {exercise.type === "send-character" ? `: ${exercise.target}` : ""}
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

          {isCopy ? (
            <>
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
                disabled={!!feedback}
                aria-label="Your copy"
              />
              <div className="practice__controls">
                <button type="button" className="tab" onClick={replay}>
                  Replay
                </button>
              </div>
            </>
          ) : (
            <>
              <SendPad onDecode={setDecoded} resetKey={sendReset} />
              <div className="send__decoded" role="status" aria-live="polite">
                <span className="field__label">Decoded</span>
                <span className="send__decoded-text">{decoded || "\u00a0"}</span>
              </div>
              {!feedback && (
                <div className="practice__controls">
                  <button
                    type="button"
                    className="tab"
                    onClick={() =>
                      record(decoded.trim().toUpperCase() === exercise.target)
                    }
                  >
                    Submit
                  </button>
                </div>
              )}
            </>
          )}

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
              <button type="button" onClick={continueNow} autoFocus>
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
