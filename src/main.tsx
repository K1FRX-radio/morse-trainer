import {
  StrictMode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App, type StorageLifecycleNotice } from "./App.tsx";
import {
  createTrainingDataBootstrap,
  curriculumState,
  type TrainingDataBootstrap,
} from "./data/bootstrap.ts";
import { DurableLearnSession } from "./data/learn-persistence.ts";
import { DurablePracticeSession } from "./data/practice-persistence.ts";
import type { PracticeSettings } from "./core/settings.ts";
import {
  subscribeStorageLifecycleEvents,
  type StorageLifecycleEvent,
} from "./data/storage-lifecycle.ts";
import { LearnAudioProvider } from "./ui/learn-audio.tsx";
import { SettingsProvider } from "./ui/settings-provider.tsx";
import { TrainingDataProvider } from "./ui/training-data-context.tsx";
import "./global.css";

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element #root not found");
}
const root = createRoot(rootElement);

type StartupState =
  | { status: "loading" }
  | { status: "ready"; bootstrap: TrainingDataBootstrap }
  | { status: "error"; message: string; guidance: string; retryable: boolean };

function startupErrorDetails(error: unknown): {
  message: string;
  guidance: string;
} {
  const message = error instanceof Error ? error.message : "Unknown error";
  const normalized = message.toLowerCase();
  if (
    normalized.includes("indexeddb") ||
    normalized.includes("missingapi") ||
    normalized.includes("openfailed")
  ) {
    return {
      message,
      guidance:
        "Storage is unavailable in this browser context. Training is disabled until storage is restored. Check private browsing restrictions or site data permissions, then retry. If needed, import a backup after recovery from Settings > Data management.",
    };
  }

  return {
    message,
    guidance:
      "Training data could not be opened. Retry after closing other tabs using this app, or reload this tab after an app update.",
  };
}

function AppRoot() {
  const [state, setState] = useState<StartupState>({ status: "loading" });
  const [upgradeBlocked, setUpgradeBlocked] = useState(false);
  const [blockerReleased, setBlockerReleased] = useState(true);
  const [reloadRequired, setReloadRequired] = useState(false);
  const upgradeBlockedRef = useRef(false);
  const blockerReleasedRef = useRef(true);

  useEffect(() => {
    upgradeBlockedRef.current = upgradeBlocked;
  }, [upgradeBlocked]);

  useEffect(() => {
    blockerReleasedRef.current = blockerReleased;
  }, [blockerReleased]);

  useEffect(() => {
    return subscribeStorageLifecycleEvents((event: StorageLifecycleEvent) => {
      if (event.type === "upgrade-blocked") {
        setUpgradeBlocked(true);
        setBlockerReleased(false);
        return;
      }
      if (event.type === "connection-closed-for-upgrade") {
        setBlockerReleased(true);
        setUpgradeBlocked(false);
        return;
      }
      if (event.type === "reload-required") {
        setReloadRequired(true);
      }
    });
  }, []);

  const start = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const bootstrap = await createTrainingDataBootstrap(localStorage, {
        databaseOptions: {
          onLifecycleEvent: (event) => {
            if (event === "upgrade-blocked") {
              setUpgradeBlocked(true);
              setBlockerReleased(false);
              return;
            }
            if (event === "reload-required") {
              setReloadRequired(true);
            }
          },
        },
      });
      setUpgradeBlocked(false);
      setBlockerReleased(true);
      setState({ status: "ready", bootstrap });
    } catch (error) {
      const details = startupErrorDetails(error);
      setState({
        status: "error",
        message: details.message,
        guidance: details.guidance,
        retryable: !(upgradeBlockedRef.current && !blockerReleasedRef.current),
      });
    }
  }, []);

  useEffect(() => {
    void start();
  }, [start]);

  useEffect(() => {
    if (state.status !== "ready") return;
    const repository = state.bootstrap.repository;
    const close = () => repository.close();
    window.addEventListener("pagehide", close, { once: true });
    return () => {
      window.removeEventListener("pagehide", close);
      repository.close();
    };
  }, [state]);

  const storageNotice = useMemo((): StorageLifecycleNotice | undefined => {
    if (reloadRequired) {
      return {
        message:
          "Another tab upgraded training data. Reload this tab to reconnect safely.",
        actionLabel: "Reload now",
        onAction: () => window.location.reload(),
      };
    }
    if (upgradeBlocked && !blockerReleased) {
      return {
        message:
          "A database upgrade is blocked by another open tab. Close or reload the other tab first.",
        actionLabel: "Retry startup",
        actionDisabled: true,
      };
    }
    return undefined;
  }, [reloadRequired, upgradeBlocked, blockerReleased]);

  if (state.status === "loading") {
    return (
      <main role="status" className="app__main">
        <h1>K1FRX Morse Trainer</h1>
        <p>Opening training data...</p>
      </main>
    );
  }

  if (state.status === "error") {
    const retryDisabled = !blockerReleased && upgradeBlocked;
    return (
      <main role="alert" className="app__main">
        <h1>K1FRX Morse Trainer</h1>
        <p>Unable to open training data: {state.message}</p>
        <p>{state.guidance}</p>
        <button
          type="button"
          onClick={() => void start()}
          disabled={retryDisabled || !state.retryable}
        >
          Retry opening data
        </button>
      </main>
    );
  }

  const { bootstrap } = state;
  const persistSettings = async (settings: PracticeSettings): Promise<void> => {
    await bootstrap.repository.savePortableSettings(settings);
  };

  // The router basename mirrors Vite's base so deep links work under a subpath.
  const basename = import.meta.env.BASE_URL.replace(/\/$/, "");

  return (
    <BrowserRouter basename={basename}>
      <SettingsProvider
        initialSettings={bootstrap.settings}
        persistSettings={persistSettings}
      >
        <TrainingDataProvider
          initialCurriculum={bootstrap.curriculum}
          initialIntroductions={bootstrap.introductions}
          persistCurriculum={(value) =>
            bootstrap.repository.saveCurriculumState(value)
          }
          loadPersistedCurriculum={async () => {
            const record = await bootstrap.repository.getCurriculumState();
            if (record === undefined) {
              throw new Error("curriculum does not exist");
            }
            return curriculumState(record);
          }}
          persistIntroductions={(characters) =>
            bootstrap.repository.saveIntroductions(characters)
          }
          startLearnSessionPersistence={(options) =>
            DurableLearnSession.create(bootstrap.repository, options)
          }
          startPracticeSessionPersistence={(options) =>
            DurablePracticeSession.create(bootstrap.repository, options)
          }
          getRetryClassification={(identity, threshold) =>
            bootstrap.repository.getRetryClassification(identity, threshold)
          }
          listDailyProjections={(query) =>
            bootstrap.repository.listDailyProjections(query)
          }
          getDashboardAggregate={(query) =>
            bootstrap.repository.getDashboardAggregate(query)
          }
          listCharacterProjections={(query) =>
            bootstrap.repository.listCharacterProjections(query)
          }
          listConfusionProjections={(query) =>
            bootstrap.repository.listConfusionProjections(query)
          }
          listMilestones={(query) => bootstrap.repository.listMilestones(query)}
          exportPortableBackup={(appVersion) =>
            bootstrap.repository.exportPortableBackup(appVersion)
          }
          previewPortableBackup={(rawJson) =>
            bootstrap.repository.previewPortableBackup(rawJson)
          }
          replacePortableBackup={(rawJson, confirmation) =>
            bootstrap.repository.replacePortableBackup(rawJson, confirmation)
          }
          resetPortableData={() => bootstrap.repository.resetPortableData()}
        >
          <LearnAudioProvider>
            <App {...(storageNotice ? { storageNotice } : {})} />
          </LearnAudioProvider>
        </TrainingDataProvider>
      </SettingsProvider>
    </BrowserRouter>
  );
}

root.render(
  <StrictMode>
    <AppRoot />
  </StrictMode>,
);
