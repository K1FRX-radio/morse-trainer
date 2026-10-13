import { describe, expect, it } from "vitest";
import { buildPwaOptions } from "./pwa-config.ts";

function requireManifest(options: ReturnType<typeof buildPwaOptions>) {
  if (!options.manifest) {
    throw new Error("expected manifest to be configured");
  }
  return options.manifest;
}

describe("buildPwaOptions", () => {
  it("uses normalized GitHub Pages subpath for manifest scope and start_url", () => {
    const options = buildPwaOptions("/morse-trainer");
    const manifest = requireManifest(options);
    expect(manifest.scope).toBe("/morse-trainer/");
    expect(manifest.start_url).toBe("/morse-trainer/");
    expect(options.workbox?.navigateFallback).toBe("/morse-trainer/index.html");
  });

  it("preserves root-path behavior for local preview/dev", () => {
    const options = buildPwaOptions("/");
    const manifest = requireManifest(options);
    expect(manifest.scope).toBe("/");
    expect(manifest.start_url).toBe("/");
    expect(options.workbox?.navigateFallback).toBe("/index.html");
  });

  it("limits service worker cache ownership to static shell assets", () => {
    const options = buildPwaOptions("/morse-trainer/");
    expect(options.workbox?.runtimeCaching).toEqual([]);
    expect(options.workbox?.globPatterns).toContain(
      "**/*.{js,css,html,svg,png,ico,json,txt,woff2}",
    );
  });

  it("supports branding overrides without code edits", () => {
    const options = buildPwaOptions("/", {
      name: "Trainer Preview",
      shortName: "CW Preview",
      anyIconSrc: "preview-icon.svg",
      maskableIconSrc: "preview-maskable.svg",
    });
    const manifest = requireManifest(options);

    expect(manifest.name).toBe("Trainer Preview");
    expect(manifest.short_name).toBe("CW Preview");
    expect(manifest.icons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ src: "preview-icon.svg" }),
        expect.objectContaining({ src: "preview-maskable.svg" }),
      ]),
    );
    expect(options.includeAssets).toEqual(
      expect.arrayContaining(["preview-icon.svg", "preview-maskable.svg"]),
    );
  });
});
