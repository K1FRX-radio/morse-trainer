import { useEffect, useState, type FormEvent } from "react";
import { encodeCharacter } from "../../core/morse.ts";
import { useLearnSession } from "../hooks/useLearnSession.ts";
import { SendPad } from "../components/SendPad.tsx";

const PROMPTS: Record<string, string> = {
  "copy-character": "Copy the character you hear",
  "copy-group": "Copy the group you hear",
  "copy-word": "Copy the word you hear",
  "send-character": "Send this character",
};

export function LearnScreen() {
  const learn = useLearnSession();
  const { exercise, feedback, actions } = learn;

  const [answer, setAnswer] = useState("");
  const [decoded, setDecoded] = useState("");
  const [sendReset, setSendReset] = useState(0);

  useEffect(() => {
    setAnswer("");
    setDecoded("");
    setSendReset((n) => n + 1);
  }, [exercise]);

  if (learn.phase === "onboarding") {
    return (
      <section>
        <h2>Learn</h2>
        <p>
          Short lessons teach Morse by ear: each new character is introduced by
          sound, drilled on its own, then mixed with the ones you know. You will
          copy characters and send a few yourself.
        </p>
        <button type="button" onClick={() => void actions.begin()}>
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
        <button type="button" onClick={() => void actions.begin()}>
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

  function submitCopy(event: FormEvent) {
    event.preventDefault();
    actions.record(answer);
  }

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
          <div className="practice__controls">
            <button type="button" onClick={actions.replay}>
              Play
            </button>
            <button type="button" onClick={() => actions.record("")}>
              Got it
            </button>
          </div>
        </div>
      ) : (
        <div className="practice">
          <p className="field__label">
            {PROMPTS[exercise.type]}
            {exercise.type === "send-character" ? `: ${exercise.target}` : ""}
          </p>

          {exercise.direction === "rx" ? (
            <>
              <div className="practice__controls">
                <button type="button" onClick={actions.replay}>
                  Replay
                </button>
              </div>
              {!feedback && (
                <form className="practice__answer" onSubmit={submitCopy}>
                  <input
                    type="text"
                    autoComplete="off"
                    autoCapitalize="characters"
                    spellCheck={false}
                    placeholder="Type what you hear"
                    value={answer}
                    onChange={(e) => setAnswer(e.target.value)}
                    aria-label="Your copy"
                    autoFocus
                  />
                  <button type="submit">Check</button>
                </form>
              )}
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
                    onClick={() =>
                      actions.record(
                        decoded.trim().toUpperCase() === exercise.target,
                      )
                    }
                  >
                    Check
                  </button>
                </div>
              )}
            </>
          )}

          {feedback && (
            <>
              <p
                className={
                  feedback.correct
                    ? "feedback feedback--ok"
                    : "feedback feedback--bad"
                }
                role="status"
              >
                {feedback.correct ? (
                  "Correct"
                ) : (
                  <>
                    Not quite — {feedback.expected}
                    <code className="learn__morse"> {feedback.morse}</code>
                  </>
                )}
              </p>
              <div className="practice__controls">
                <button type="button" onClick={actions.advance} autoFocus>
                  Next
                </button>
              </div>
            </>
          )}
        </div>
      )}

      <div className="practice__controls learn__end">
        <button type="button" className="tab" onClick={actions.endSession}>
          End session
        </button>
      </div>
    </section>
  );
}
