import { describe, expect, it, vi } from "vitest";
import {
  publishStorageLifecycleEvent,
  subscribeStorageLifecycleEvents,
  type LifecycleChannel,
  type LifecycleChannelFactory,
} from "./storage-lifecycle.ts";

function channelFactory(channel: LifecycleChannel): LifecycleChannelFactory {
  return () => channel;
}

describe("storage lifecycle broadcast", () => {
  it("publishes lifecycle events and closes the channel", () => {
    const postMessage = vi.fn();
    const close = vi.fn();
    const channel: LifecycleChannel = {
      postMessage,
      close,
      onmessage: null,
    };

    publishStorageLifecycleEvent(
      {
        type: "upgrade-blocked",
        databaseName: "k1frx-morse-trainer",
        emittedAt: "2026-10-04T20:00:00.000Z",
        sourceTabId: "tab-1",
      },
      channelFactory(channel),
    );

    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "upgrade-blocked" }),
    );
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("forwards only valid lifecycle events to subscribers", () => {
    const close = vi.fn();
    const channel: LifecycleChannel = {
      postMessage: vi.fn(),
      close,
      onmessage: null,
    };
    const received: string[] = [];

    const unsubscribe = subscribeStorageLifecycleEvents(
      (event) => received.push(event.type),
      channelFactory(channel),
    );

    const dispatch = channel.onmessage;
    if (dispatch) {
      dispatch({ data: { type: "ignored" } });
      dispatch({
        data: {
          type: "connection-closed-for-upgrade",
          databaseName: "k1frx-morse-trainer",
          emittedAt: "2026-10-04T20:00:00.000Z",
          sourceTabId: "tab-2",
        },
      });
    }

    expect(received).toEqual(["connection-closed-for-upgrade"]);
    unsubscribe();
    expect(channel.onmessage).toBeNull();
    expect(close).toHaveBeenCalledTimes(1);
  });
});
