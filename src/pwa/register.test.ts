import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerPwaServiceWorker } from "./register.ts";

const { registerSWMock, markOfflineReadyMock, markUpdateReadyMock } =
  vi.hoisted(() => ({
    registerSWMock: vi.fn(),
    markOfflineReadyMock: vi.fn(),
    markUpdateReadyMock: vi.fn(),
  }));

vi.mock("virtual:pwa-register", () => ({
  registerSW: registerSWMock,
}));

vi.mock("./pwa-status.ts", () => ({
  markPwaOfflineReady: markOfflineReadyMock,
  markPwaUpdateReady: markUpdateReadyMock,
}));

describe("registerPwaServiceWorker", () => {
  beforeEach(() => {
    registerSWMock.mockReset();
    markOfflineReadyMock.mockReset();
    markUpdateReadyMock.mockReset();
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: {},
    });
  });

  it("marks offline-ready and uses controlled update activation without auto reload", async () => {
    const updateServiceWorker = vi.fn(async () => undefined);
    registerSWMock.mockReturnValue(updateServiceWorker);

    registerPwaServiceWorker();

    const options = registerSWMock.mock.calls[0]?.[0] as
      | {
          onOfflineReady?: () => void;
          onNeedRefresh?: () => void;
        }
      | undefined;
    expect(options).toBeDefined();

    options?.onOfflineReady?.();
    expect(markOfflineReadyMock).toHaveBeenCalledTimes(1);

    options?.onNeedRefresh?.();
    const activate = markUpdateReadyMock.mock.calls[0]?.[0] as
      (() => Promise<void>) | undefined;
    expect(typeof activate).toBe("function");

    await activate?.();
    expect(updateServiceWorker).toHaveBeenCalledWith(false);
  });
});
