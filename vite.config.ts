/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { buildPwaOptions } from "./src/pwa/pwa-config.ts";

// Base path is configurable so the app can deploy under a GitHub Pages
// subpath (e.g. /morse-trainer/) or a future custom domain root (/).
const base = process.env.VITE_BASE ?? "/";

export default defineConfig({
  base,
  plugins: [react(), VitePWA(buildPwaOptions(base))],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
  },
});
