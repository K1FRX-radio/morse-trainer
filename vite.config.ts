/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { buildPwaOptions } from "./src/pwa/pwa-config.ts";

// Base path is configurable so the app can deploy under a GitHub Pages
// subpath (e.g. /morse-trainer/) or a future custom domain root (/).
const base = process.env.VITE_BASE ?? "/";

const pwaBrandingOverrides = {
  ...(process.env.VITE_PWA_APP_NAME
    ? { name: process.env.VITE_PWA_APP_NAME }
    : {}),
  ...(process.env.VITE_PWA_SHORT_NAME
    ? { shortName: process.env.VITE_PWA_SHORT_NAME }
    : {}),
  ...(process.env.VITE_PWA_DESCRIPTION
    ? { description: process.env.VITE_PWA_DESCRIPTION }
    : {}),
  ...(process.env.VITE_PWA_THEME_COLOR
    ? { themeColor: process.env.VITE_PWA_THEME_COLOR }
    : {}),
  ...(process.env.VITE_PWA_BACKGROUND_COLOR
    ? { backgroundColor: process.env.VITE_PWA_BACKGROUND_COLOR }
    : {}),
  ...(process.env.VITE_PWA_ICON_ANY
    ? { anyIconSrc: process.env.VITE_PWA_ICON_ANY }
    : {}),
  ...(process.env.VITE_PWA_ICON_MASKABLE
    ? { maskableIconSrc: process.env.VITE_PWA_ICON_MASKABLE }
    : {}),
};

export default defineConfig({
  base,
  plugins: [react(), VitePWA(buildPwaOptions(base, pwaBrandingOverrides))],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
  },
});
