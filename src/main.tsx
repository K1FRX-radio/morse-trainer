import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AppRoot } from "./ui/app-root.tsx";
import { registerPwaServiceWorker } from "./pwa/register.ts";
import "./global.css";

registerPwaServiceWorker();

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element #root not found");
}
const root = createRoot(rootElement);

root.render(
  <StrictMode>
    <AppRoot />
  </StrictMode>,
);
