import { registerSW } from "virtual:pwa-register";
import { markPwaOfflineReady, markPwaUpdateReady } from "./pwa-status.ts";

export function registerPwaServiceWorker(): void {
  if (typeof window === "undefined") return;
  if (!("serviceWorker" in navigator)) return;

  const updateServiceWorker = registerSW({
    immediate: true,
    onOfflineReady() {
      markPwaOfflineReady();
    },
    onNeedRefresh() {
      markPwaUpdateReady(async () => {
        await updateServiceWorker(true);
      });
    },
  });
}
