import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App.tsx";
import {
  createTrainingDataBootstrap,
  curriculumState,
} from "./data/bootstrap.ts";
import { DurableLearnSession } from "./data/learn-persistence.ts";
import { DurablePracticeSession } from "./data/practice-persistence.ts";
import type { PracticeSettings } from "./core/settings.ts";
import { LearnAudioProvider } from "./ui/learn-audio.tsx";
import { SettingsProvider } from "./ui/settings-provider.tsx";
import { TrainingDataProvider } from "./ui/training-data-context.tsx";
import "./global.css";

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element #root not found");
}
const root = createRoot(rootElement);

async function start(): Promise<void> {
  const bootstrap = await createTrainingDataBootstrap(localStorage);
  const persistSettings = async (settings: PracticeSettings): Promise<void> => {
    await bootstrap.repository.savePortableSettings(settings);
  };
  window.addEventListener("pagehide", () => bootstrap.repository.close(), {
    once: true,
  });

  // The router basename mirrors Vite's base so deep links work under a subpath.
  const basename = import.meta.env.BASE_URL.replace(/\/$/, "");
  root.render(
    <StrictMode>
      <BrowserRouter basename={basename}>
        <SettingsProvider
          initialSettings={bootstrap.settings}
          persistSettings={persistSettings}
        >
          <TrainingDataProvider
            initialCurriculum={bootstrap.curriculum}
            initialIntroductions={bootstrap.introductions}
            persistCurriculum={(state) =>
              bootstrap.repository.saveCurriculumState(state)
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
          >
            <LearnAudioProvider>
              <App />
            </LearnAudioProvider>
          </TrainingDataProvider>
        </SettingsProvider>
      </BrowserRouter>
    </StrictMode>,
  );
}

void start().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown error";
  root.render(
    <main role="alert">
      <h1>K1FRX Morse Trainer</h1>
      <p>Unable to open training data: {message}</p>
    </main>,
  );
});
