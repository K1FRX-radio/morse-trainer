import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createImportedTextPlan } from "../../training/imported-text.ts";
import { usePracticeSession } from "../hooks/usePracticeSession.ts";
import { useSettings } from "../settings-context.ts";
import { useAudioEngine } from "../hooks/useAudioEngine.ts";
import { useNavigationGuard } from "../navigation-guard-context.ts";

type PlaybackState = "idle" | "playing" | "paused";

export function ImportedTextPractice() {
  const { settings } = useSettings();
  const { engine, noise, unlock } = useAudioEngine();
  const { setBlocked } = useNavigationGuard();

  const [text, setText] = useState("");
  const [state, setState] = useState<PlaybackState>("idle");
  const [unsupported, setUnsupported] = useState<string[]>([]);
  const [error, setError] = useState<string | undefined>(undefined);
  const [planWords, setPlanWords] = useState(0);
  const [completedWords, setCompletedWords] = useState(0);

  const runId = useRef(0);
  const mountedRef = useRef(true);
  const noiseRunId = useRef<number | undefined>(undefined);
  const completedPlaybackRef = useRef(false);
  const resumeIndex = useRef(0);
  const chunksRef = useRef<string[]>([]);
  const resolveUnmountStatus = useCallback(
    () => (completedPlaybackRef.current ? "completed" : "interrupted"),
    [],
  );
  const practice = usePracticeSession("imported-text-rx", settings, {
    unmountStatus: resolveUnmountStatus,
  });

  const progressLabel = useMemo(() => {
    if (planWords === 0) return "No playback plan";
    if (state === "playing") {
      return `Playing word ${Math.min(completedWords + 1, planWords)} of ${planWords}`;
    }
    if (state === "paused") {
      return `Paused at word ${Math.min(completedWords + 1, planWords)} of ${planWords}`;
    }
    if (completedWords >= planWords) {
      return `Completed ${planWords} of ${planWords} words`;
    }
    return `Ready at word ${Math.min(completedWords + 1, planWords)} of ${planWords}`;
  }, [completedWords, planWords, state]);

  const timing = useMemo(
    () => ({ charWpm: settings.charWpm, effectiveWpm: settings.effectiveWpm }),
    [settings.charWpm, settings.effectiveWpm],
  );

  const stopNoiseForRun = useCallback(
    (run: number): void => {
      if (noiseRunId.current !== run) {
        return;
      }
      noise.stop();
      noiseRunId.current = undefined;
    },
    [noise],
  );

  async function stopPlayback(
    nextState: PlaybackState,
    restartAtZero: boolean,
  ): Promise<void> {
    practice.recordActivity();
    const previousRun = runId.current;
    runId.current += 1;
    setBlocked(false);
    stopNoiseForRun(previousRun);
    await engine.cancel();
    if (!mountedRef.current) {
      return;
    }
    if (restartAtZero) {
      resumeIndex.current = 0;
      setCompletedWords(0);
    }
    setState(nextState);
  }

  async function playFrom(index: number): Promise<void> {
    const currentRun = ++runId.current;
    if (mountedRef.current) {
      setError(undefined);
      setState("playing");
    }
    setBlocked(true);

    try {
      await practice.start();
      await unlock();
      if (currentRun !== runId.current || !mountedRef.current) {
        return;
      }

      if (settings.noiseLevel > 0) {
        noise.start(settings.toneHz, settings.noiseLevel);
        noiseRunId.current = currentRun;
      }

      let cursor = index;
      while (cursor < chunksRef.current.length) {
        await engine.playText(chunksRef.current[cursor], timing, {
          toneHz: settings.toneHz,
        });
        if (currentRun !== runId.current || !mountedRef.current) {
          return;
        }
        cursor += 1;
        resumeIndex.current = cursor;
        practice.recordActivity();
        setCompletedWords(cursor);
      }
      practice.recordActivity();
      completedPlaybackRef.current = true;
      await practice.finish();
      setState("idle");
    } catch (cause) {
      if (currentRun !== runId.current || !mountedRef.current) {
        return;
      }
      const message =
        cause instanceof Error ? cause.message : "Playback could not start.";
      setError(message);
      setState("idle");
    } finally {
      stopNoiseForRun(currentRun);
      if (currentRun === runId.current) {
        setBlocked(false);
      }
    }
  }

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      const previousRun = runId.current;
      runId.current += 1;
      stopNoiseForRun(previousRun);
      setBlocked(false);
      void engine.cancel();
    };
  }, [engine, setBlocked, stopNoiseForRun]);

  function preparePlan(): boolean {
    try {
      const plan = createImportedTextPlan(text);
      setUnsupported(plan.unsupportedCharacters);
      setError(undefined);
      chunksRef.current = plan.chunks;
      setPlanWords(plan.totalWords);
      if (plan.chunks.length === 0) {
        setCompletedWords(0);
        setError("No playable characters were found in the provided text.");
        return false;
      }
      return true;
    } catch (issue) {
      const message = issue instanceof Error ? issue.message : "Invalid input";
      setError(message);
      return false;
    }
  }

  async function start(): Promise<void> {
    if (!preparePlan()) return;
    completedPlaybackRef.current = false;
    resumeIndex.current = 0;
    setCompletedWords(0);
    await playFrom(0);
  }

  async function resume(): Promise<void> {
    if (chunksRef.current.length === 0) {
      if (!preparePlan()) return;
    }
    await playFrom(resumeIndex.current);
  }

  async function pause(): Promise<void> {
    await stopPlayback("paused", false);
  }

  async function stop(): Promise<void> {
    completedPlaybackRef.current = false;
    await stopPlayback("idle", true);
    await practice.interrupt();
  }

  async function replay(): Promise<void> {
    if (chunksRef.current.length === 0) {
      if (!preparePlan()) return;
    }
    completedPlaybackRef.current = false;
    await stopPlayback("idle", true);
    await playFrom(0);
  }

  async function onLoadFile(file: File | undefined): Promise<void> {
    if (!file) return;
    const withText = file as File & { text?: () => Promise<string> };
    const content =
      typeof withText.text === "function"
        ? await withText.text()
        : await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result ?? ""));
            reader.onerror = () =>
              reject(new Error("Unable to read the selected file."));
            reader.readAsText(file);
          });
    setText(content);
  }

  return (
    <section className="imported-rx">
      <h3>Imported Text RX</h3>
      <p className="settings__note">
        Paste text or load a plain-text file. This mode plays CW audio only and
        does not affect Learn progression.
      </p>

      <label className="field">
        <span className="field__label">Text to play</span>
        <textarea
          className="imported-rx__input"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="Paste plain text here"
          aria-label="Imported text"
        />
      </label>

      <label className="field">
        <span className="field__label">Load .txt file</span>
        <input
          type="file"
          accept=".txt,text/plain"
          aria-label="Load text file"
          onChange={(event) =>
            void onLoadFile(event.target.files?.[0] ?? undefined)
          }
        />
      </label>

      {unsupported.length > 0 && (
        <p className="feedback feedback--neutral" role="status">
          Unsupported characters were ignored: {unsupported.join(" ")}
        </p>
      )}
      {error && (
        <p className="feedback feedback--bad" role="alert">
          {error}
        </p>
      )}

      <p className="field__label" role="status">
        {progressLabel}
      </p>

      <div className="practice__controls">
        <button
          type="button"
          onClick={() => void start()}
          disabled={state === "playing"}
        >
          Start
        </button>
        {state === "playing" ? (
          <button type="button" onClick={() => void pause()}>
            Pause
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void resume()}
            disabled={state !== "paused"}
          >
            Resume
          </button>
        )}
        <button
          type="button"
          onClick={() => void stop()}
          disabled={state === "idle" && completedWords === 0}
        >
          Stop
        </button>
        <button
          type="button"
          onClick={() => void replay()}
          disabled={chunksRef.current.length === 0}
        >
          Replay
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
    </section>
  );
}
