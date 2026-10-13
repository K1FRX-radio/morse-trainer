import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const distDir = process.argv[2] ?? "dist-morse-trainer";
const expectedBase = "/morse-trainer/";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const manifestPath = join(distDir, "manifest.webmanifest");
assert(existsSync(manifestPath), `Missing manifest: ${manifestPath}`);

const manifestRaw = readFileSync(manifestPath, "utf8");
const manifest = JSON.parse(manifestRaw);

assert(
  manifest.scope === expectedBase,
  `manifest.scope expected ${expectedBase} but got ${String(manifest.scope)}`,
);
assert(
  manifest.start_url === expectedBase,
  `manifest.start_url expected ${expectedBase} but got ${String(manifest.start_url)}`,
);

const swPath = join(distDir, "sw.js");
assert(existsSync(swPath), `Missing service worker output: ${swPath}`);
const swText = readFileSync(swPath, "utf8");
assert(
  swText.includes(`${expectedBase}index.html`),
  `sw.js must reference ${expectedBase}index.html for app-shell fallback`,
);

console.log(
  `Validated PWA base build in ${distDir}: manifest scope/start_url and SW fallback match ${expectedBase}`,
);
