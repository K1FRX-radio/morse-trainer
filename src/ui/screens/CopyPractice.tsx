import { useMemo, useRef, useState, type FormEvent } from "react";
import { unlockedCharacters } from "../../core/curriculum.ts";
import { createRng, type Rng } from "../../core/rng.ts";
import {
  COPY_CONTENT_LABELS,
  COPY_CONTENT_MODES,
  COPY_PRACTICE_SCOPES,
  COPY_PRACTICE_SCOPE_LABELS,
  generateScopedCopyPrompt,
  generateCopyPrompt,
  type CopyContentMode,
  type CopyPracticeScope,
} from "../../content/practice-content.ts";
import { useSettings } from "../settings-context.ts";
import { useAudioEngine } from "../hooks/useAudioEngine.ts";
import { usePracticeSession } from "../hooks/usePracticeSession.ts";
import { useTrainingData } from "../training-data-context.ts";

type Result = "correct" | "incorrect";

function normalize(value: string): string {
  return value.toUpperCase().replace(/\s+/g, "");
}

function unavailableMessage(mode: CopyContentMode): string {
  switch (mode) {
    case "letters":
      return "No unlocked letters are available for this scope yet.";
    case "letters-numbers":
      return "No unlocked letters or numbers are available for this scope yet.";
    case "words":
      return "No eligible words are available for the unlocked character set yet.";
    case "callsigns":
      return "Callsign practice in Unlocked scope needs at least one unlocked letter and one unlocked digit.";
  }
}

export function CopyPractice() {
  const { settings } = useSettings();
  const { loadCurriculum } = useTrainingData();
  const { engine, noise, unlock } = useAudioEngine();
  const rng = useRef<Rng>(createRng(Date.now() >>> 0));
  const practice = usePracticeSession("copy-practice", settings);
  const replayed = useRef(false);
  const audioCompletedAt = useRef<number | undefined>(undefined);
  const playbackToken = useRef(0);

  const [mode, setMode] = useState<CopyContentMode>("letters");
  const [scope, setScope] = useState<CopyPracticeScope>("unlocked");
  const [prompt, setPrompt] = useState<string | undefined>(undefined);
  const [answer, setAnswer] = useState("");
  const [result, setResult] = useState<Result | undefined>(undefined);
  const [revealed, setRevealed] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [unavailable, setUnavailable] = useState<string | undefined>(undefined);

  const timing = useMemo(
    () => ({ charWpm: settings.charWpm, effectiveWpm: settings.effectiveWpm }),
    [settings.charWpm, settings.effectiveWpm],
  );

  async function play(text: string): Promise<void> {
    const token = ++playbackToken.current;
    audioCompletedAt.current = undefined;
    await unlock();
    setPlaying(true);
    if (settings.noiseLevel > 0) {
      noise.start(settings.toneHz, settings.noiseLevel);
    }
    try {
      await engine.playText(text, timing, { toneHz: settings.toneHz });
    } finally {
      noise.stop();
      setPlaying(false);
      if (token === playbackToken.current) {
        audioCompletedAt.current = performance.now();
      }
    }
  }

  async function nextPrompt(): Promise<void> {
    try {
      await practice.start();
    } catch {
      return;
    }
    engine.cancel();
    const unlocked = unlockedCharacters(loadCurriculum());
    const next =
      scope === "all-characters"
        ? generateCopyPrompt(mode, rng.current)
        : generateScopedCopyPrompt(mode, rng.current, scope, unlocked);
    if (!next) {
      setPrompt(undefined);
      setAnswer("");
      setResult(undefined);
      setRevealed(false);
      setUnavailable(unavailableMessage(mode));
      return;
    }
    setUnavailable(undefined);
    setPrompt(next);
    setAnswer("");
    setResult(undefined);
    setRevealed(false);
    replayed.current = false;
    await play(next);
  }

  function replay(): void {
    if (prompt) {
      practice.recordActivity();
      replayed.current = true;
      void play(prompt);
    }
  }

  function submit(event: FormEvent): void {
    event.preventDefault();
    if (!prompt) {
      return;
    }
    if (result) return;
    practice.recordActivity();
    const correct = normalize(answer) === normalize(prompt);
    setResult(correct ? "correct" : "incorrect");
    setRevealed(true);
    const completedAt = audioCompletedAt.current;
    void practice
      .recordAttempt({
        exerciseType: mode === "words" ? "copy-word" : "copy-group",
        target: prompt,
        response: answer,
        assisted: replayed.current,
        replayed: replayed.current,
        responseMs:
          completedAt === undefined
            ? 0
            : Math.max(0, performance.now() - completedAt),
      })
      .catch(() => undefined);
  }

  return (
    <div className="practice">
      <label className="field">
        <span className="field__label">Content</span>
        <select
          value={mode}
          onChange={(event) => {
            setMode(event.target.value as CopyContentMode);
            setUnavailable(undefined);
          }}
        >
          {COPY_CONTENT_MODES.map((value) => (
            <option key={value} value={value}>
              {COPY_CONTENT_LABELS[value]}
            </option>
          ))}
        </select>
      </label>

      <label className="field">
        <span className="field__label">Scope</span>
        <select
          aria-label="Practice scope"
          value={scope}
          onChange={(event) => {
            setScope(event.target.value as CopyPracticeScope);
            setUnavailable(undefined);
          }}
        >
          {COPY_PRACTICE_SCOPES.map((value) => (
            <option key={value} value={value}>
              {COPY_PRACTICE_SCOPE_LABELS[value]}
            </option>
          ))}
        </select>
      </label>

      <div className="practice__controls">
        <button type="button" onClick={() => void nextPrompt()}>
          {prompt ? "Next" : "Start"}
        </button>
        <button type="button" onClick={replay} disabled={!prompt || playing}>
          Replay
        </button>
      </div>

      {prompt && (
        <form className="practice__answer" onSubmit={submit}>
          <input
            type="text"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            placeholder="Type what you hear"
            value={answer}
            onChange={(event) => {
              practice.recordActivity();
              setAnswer(event.target.value);
            }}
            aria-label="Your copy"
          />
          <button type="submit">Check</button>
        </form>
      )}

      {result && (
        <p
          className={
            result === "correct"
              ? "feedback feedback--ok"
              : "feedback feedback--bad"
          }
          role="status"
        >
          {result === "correct" ? "Correct" : "Not quite"}
          {revealed && prompt ? ` — sent ${prompt}` : ""}
        </p>
      )}

      {unavailable && <p role="alert">{unavailable}</p>}

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
