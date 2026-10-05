import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BrowserRouter } from "react-router-dom";
import { App, type StorageLifecycleNotice } from "../App.tsx";
import type { PracticeSettings } from "../core/settings.ts";
import {
  createTrainingDataBootstrap,
  curriculumState,
  type TrainingDataBootstrap,
  type TrainingDataBootstrapOptions,
} from "../data/bootstrap.ts";
import type { LegacyStorage } from "../data/legacy-migration.ts";
import { DurableLearnSession } from "../data/learn-persistence.ts";
import { DurablePracticeSession } from "../data/practice-persistence.ts";
import {
  createLifecycleTabId,
  subscribeStorageLifecycleEvents,
  type StorageLifecycleEvent,
} from "../data/storage-lifecycle.ts";
import { LearnAudioProvider } from "./learn-audio.tsx";
import { SettingsProvider } from "./settings-provider.tsx";
import { TrainingDataProvider } from "./training-data-context.tsx";

type StartupState =
  | { status: "loading" }
  | { status: "ready"; bootstrap: TrainingDataBootstrap }
  | { status: "error"; message: string; guidance: string; retryable: boolean };

type AppRootDependencies = {
  createBootstrap: (
    storage: LegacyStorage,
    options?: TrainingDataBootstrapOptions,
  ) => Promise<TrainingDataBootstrap>;
  subscribeLifecycle: (
    subscriber: (event: StorageLifecycleEvent) => void,
  ) => () => void;
  reloadPage: () => void;
  storage: LegacyStorage;
  tabId: string;
};

export type AppRootProps = {
  dependencies?: Partial<AppRootDependencies>;
};

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

export function AppRoot({ dependencies }: AppRootProps) {
  const createBootstrap =
    dependencies?.createBootstrap ?? createTrainingDataBootstrap;
  const subscribeLifecycle =
    dependencies?.subscribeLifecycle ?? subscribeStorageLifecycleEvents;
  const reloadPage =
    dependencies?.reloadPage ?? (() => window.location.reload());
  const storage = dependencies?.storage ?? localStorage;
  const tabIdRef = useRef(dependencies?.tabId ?? createLifecycleTabId());

  const [state, setState] = useState<StartupState>({ status: "loading" });
  const [upgradeBlocked, setUpgradeBlocked] = useState(false);
  const [possibleBlocker, setPossibleBlocker] = useState(false);
  const [reloadRequired, setReloadRequired] = useState(false);
  const startInFlightRef = useRef<Promise<void> | undefined>(undefined);
  const upgradeBlockedRef = useRef(false);

  useEffect(() => {
    upgradeBlockedRef.current = upgradeBlocked;
  }, [upgradeBlocked]);

  useEffect(() => {
    return subscribeLifecycle((event: StorageLifecycleEvent) => {
      if (event.sourceTabId === tabIdRef.current) {
        return;
      }
      if (event.type === "upgrade-blocked") {
        setPossibleBlocker(true);
        return;
      }
      if (event.type === "connection-closed-for-upgrade") {
        setPossibleBlocker(false);
      }
    });
  }, [subscribeLifecycle]);

  const start = useCallback((): Promise<void> => {
    if (startInFlightRef.current) {
      return startInFlightRef.current;
    }

    setState({ status: "loading" });
    const startPromise = (async () => {
      try {
        const bootstrap = await createBootstrap(storage, {
          databaseOptions: {
            tabId: tabIdRef.current,
            onLifecycleEvent: (event) => {
              if (event === "upgrade-blocked") {
                setUpgradeBlocked(true);
                return;
              }
              if (event === "reload-required") {
                setReloadRequired(true);
              }
            },
          },
        });
        setUpgradeBlocked(false);
        setPossibleBlocker(false);
        setState({ status: "ready", bootstrap });
      } catch (error) {
        const details = startupErrorDetails(error);
        setState({
          status: "error",
          message: details.message,
          guidance: details.guidance,
          retryable: !upgradeBlockedRef.current,
        });
      } finally {
        startInFlightRef.current = undefined;
      }
    })();

    startInFlightRef.current = startPromise;
    return startPromise;
  }, [createBootstrap, storage]);

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
    if (upgradeBlocked) {
      return {
        message:
          "A database upgrade is blocked by another open tab. Close or reload the other tab first.",
      };
    }
    if (possibleBlocker) {
      return {
        message:
          "Another tab is waiting for a database upgrade. This tab may be blocking it. Save your work, then reload or close this tab.",
      };
    }
    return undefined;
  }, [upgradeBlocked, possibleBlocker]);

  if (reloadRequired) {
    return (
      <main role="alert" className="app__main">
        <h1>K1FRX Morse Trainer</h1>
        <p>
          This tab&apos;s training-data connection is stale after another tab
          upgraded storage.
        </p>
        <p>Reload now before continuing training.</p>
        <button type="button" onClick={reloadPage}>
          Reload now
        </button>
      </main>
    );
  }

  if (state.status === "loading") {
    return (
      <main role="status" className="app__main">
        <h1>K1FRX Morse Trainer</h1>
        <p>Opening training data...</p>
        {storageNotice && (
          <p role="alert" className="feedback feedback--neutral">
            {storageNotice.message}
          </p>
        )}
      </main>
    );
  }

  if (state.status === "error") {
    const retryDisabled = upgradeBlocked;
    return (
      <main role="alert" className="app__main">
        <h1>K1FRX Morse Trainer</h1>
        <p>Unable to open training data: {state.message}</p>
        <p>{state.guidance}</p>
        {storageNotice && (
          <p role="alert" className="feedback feedback--neutral">
            {storageNotice.message}
          </p>
        )}
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
