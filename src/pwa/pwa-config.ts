import type { VitePWAOptions } from "vite-plugin-pwa";

const APP_NAME = "K1FRX Morse Trainer";
const APP_SHORT_NAME = "K1FRX CW";
const APP_DESCRIPTION =
  "Web-first CW trainer with Koch progression and offline-capable lessons.";

function normalizedBasePath(base: string): string {
  const trimmed = base.trim();
  if (trimmed.length === 0) return "/";
  const withLeadingSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return withLeadingSlash.endsWith("/")
    ? withLeadingSlash
    : `${withLeadingSlash}/`;
}

export function buildPwaOptions(base: string): Partial<VitePWAOptions> {
  const scope = normalizedBasePath(base);

  return {
    registerType: "prompt",
    injectRegister: false,
    strategies: "generateSW",
    includeAssets: ["pwa-icon.svg", "maskable-icon.svg"],
    manifest: {
      name: APP_NAME,
      short_name: APP_SHORT_NAME,
      description: APP_DESCRIPTION,
      start_url: scope,
      scope,
      display: "standalone",
      background_color: "#0e1116",
      theme_color: "#0e1116",
      icons: [
        {
          src: "pwa-icon.svg",
          sizes: "any",
          type: "image/svg+xml",
          purpose: "any",
        },
        {
          src: "maskable-icon.svg",
          sizes: "any",
          type: "image/svg+xml",
          purpose: "maskable",
        },
      ],
    },
    workbox: {
      cleanupOutdatedCaches: true,
      navigateFallback: `${scope}index.html`,
      globPatterns: ["**/*.{js,css,html,svg,png,ico,json,txt,woff2}"],
      // SW cache ownership is restricted to static app-shell assets.
      // IndexedDB learner data is explicitly out-of-scope for SW lifecycle.
      runtimeCaching: [],
    },
  };
}
