import type { VitePWAOptions } from "vite-plugin-pwa";

export type PwaBranding = {
  name: string;
  shortName: string;
  description: string;
  themeColor: string;
  backgroundColor: string;
  anyIconSrc: string;
  maskableIconSrc: string;
};

export const DEFAULT_PWA_BRANDING: PwaBranding = {
  // Provisional defaults pending final branding decision in issue #74.
  name: "K1FRX Morse Trainer",
  shortName: "K1FRX CW",
  description:
    "Web-first CW trainer with Koch progression and offline-capable lessons.",
  themeColor: "#0e1116",
  backgroundColor: "#0e1116",
  anyIconSrc: "pwa-icon.svg",
  maskableIconSrc: "maskable-icon.svg",
};

function resolveBranding(overrides?: Partial<PwaBranding>): PwaBranding {
  return {
    ...DEFAULT_PWA_BRANDING,
    ...overrides,
  };
}

function normalizedBasePath(base: string): string {
  const trimmed = base.trim();
  if (trimmed.length === 0) return "/";
  const withLeadingSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return withLeadingSlash.endsWith("/")
    ? withLeadingSlash
    : `${withLeadingSlash}/`;
}

export function buildPwaOptions(
  base: string,
  brandingOverrides?: Partial<PwaBranding>,
): Partial<VitePWAOptions> {
  const scope = normalizedBasePath(base);
  const branding = resolveBranding(brandingOverrides);
  const includeAssets = Array.from(
    new Set([branding.anyIconSrc, branding.maskableIconSrc]),
  );

  return {
    registerType: "prompt",
    injectRegister: false,
    strategies: "generateSW",
    includeAssets,
    manifest: {
      name: branding.name,
      short_name: branding.shortName,
      description: branding.description,
      start_url: scope,
      scope,
      display: "standalone",
      background_color: branding.backgroundColor,
      theme_color: branding.themeColor,
      icons: [
        {
          src: branding.anyIconSrc,
          sizes: "any",
          type: "image/svg+xml",
          purpose: "any",
        },
        {
          src: branding.maskableIconSrc,
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
