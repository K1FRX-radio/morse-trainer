import { useMemo, useRef, useState, type FormEvent } from "react";
import { createRng, type Rng } from "../../core/rng.ts";
import {
  COPY_CONTENT_LABELS,
  COPY_CONTENT_MODES,
  generateCopyPrompt,
  type CopyContentMode,
} from "../../content/practice-content.ts";
import { useSettings } from "../settings-context.ts";
import { useAudioEngine } from "../hooks/useAudioEngine.ts";

type Result = "correct" | "incorrect";

function normalize(value: string): string {
  return value.toUpperCase().replace(/\s+/g, "");
}

export function CopyPractice() {
  const { settings } = useSettings();
  const { engine, noise, unlock } = useAudioEngine();
  const rng = useRef<Rng>(createRng(Date.now() >>> 0));

  const [mode, setMode] = useState<CopyContentMode>("letters");
  const [prompt, setPrompt] = useState<string | undefined>(undefined);
  const [answer, setAnswer] = useState("");
  const [result, setResult] = useState<Result | undefined>(undefined);
  const [revealed, setRevealed] = useState(false);
  const [playing, setPlaying] = useState(false);

  const timing = useMemo(
    () => ({ charWpm: settings.charWpm, effectiveWpm: settings.effectiveWpm }),
    [settings.charWpm, settings.effectiveWpm],
  );

  async function play(text: string): Promise<void> {
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
    }
  }

  async function nextPrompt(): Promise<void> {
    engine.cancel();
    const next = generateCopyPrompt(mode, rng.current);
    setPrompt(next);
    setAnswer("");
    setResult(undefined);
    setRevealed(false);
    await play(next);
  }

  function replay(): void {
    if (prompt) {
      void play(prompt);
    }
  }

  function submit(event: FormEvent): void {
    event.preventDefault();
    if (!prompt) {
      return;
    }
    setResult(
      normalize(answer) === normalize(prompt) ? "correct" : "incorrect",
    );
    setRevealed(true);
  }

  return (
    <div className="practice">
      <label className="field">
        <span className="field__label">Content</span>
        <select
          value={mode}
          onChange={(event) => setMode(event.target.value as CopyContentMode)}
        >
          {COPY_CONTENT_MODES.map((value) => (
            <option key={value} value={value}>
              {COPY_CONTENT_LABELS[value]}
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
            onChange={(event) => setAnswer(event.target.value)}
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
    </div>
  );
}
