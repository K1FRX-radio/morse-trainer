import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App.tsx";
import { SettingsProvider } from "./ui/settings-provider.tsx";
import "./global.css";

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element #root not found");
}

// The router basename mirrors Vite's base so deep links work under a subpath.
const basename = import.meta.env.BASE_URL.replace(/\/$/, "");

createRoot(rootElement).render(
  <StrictMode>
    <BrowserRouter basename={basename}>
      <SettingsProvider>
        <App />
      </SettingsProvider>
    </BrowserRouter>
  </StrictMode>,
);
