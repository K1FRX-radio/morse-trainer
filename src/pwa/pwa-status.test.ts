import { afterEach, describe, expect, it, vi } from "vitest";
import {
  activatePwaUpdate,
  markPwaOfflineReady,
  markPwaUpdateReady,
  resetPwaStatusForTests,
  subscribePwaStatus,
} from "./pwa-status.ts";

afterEach(() => {
  resetPwaStatusForTests();
  vi.restoreAllMocks();
});

describe("pwa-status", () => {
  it("surfaces update-ready before controlled activation", async () => {
    const snapshots: { offlineReady: boolean; updateReady: boolean }[] = [];
    const unsubscribe = subscribePwaStatus((snapshot) => {
      snapshots.push(snapshot);
    });

    const activate = vi.fn(async () => undefined);
    markPwaUpdateReady(activate);

    expect(snapshots.at(-1)).toEqual({
      offlineReady: false,
      updateReady: true,
    });
    expect(activate).toHaveBeenCalledTimes(0);

    await expect(activatePwaUpdate()).resolves.toBe(true);
    expect(activate).toHaveBeenCalledTimes(1);
    expect(snapshots.at(-1)).toEqual({
      offlineReady: false,
      updateReady: false,
    });

    unsubscribe();
  });

  it("keeps offline-ready visible after first successful online visit", () => {
    const snapshots: { offlineReady: boolean; updateReady: boolean }[] = [];
    const unsubscribe = subscribePwaStatus((snapshot) => {
      snapshots.push(snapshot);
    });

    markPwaOfflineReady();
    expect(snapshots.at(-1)).toEqual({
      offlineReady: true,
      updateReady: false,
    });

    unsubscribe();
  });
});
