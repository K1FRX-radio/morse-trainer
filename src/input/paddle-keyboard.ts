export type PaddleChannel = "dit" | "dah";
export type PaddleAction = "down" | "up";

export type PaddleInputEvent = {
  source: "keyboard-hid";
  channel: PaddleChannel;
  action: PaddleAction;
  timestamp: number;
};

export type KeyboardPaddleOptions = {
  ditKey?: string;
  dahKey?: string;
  target?: Window | HTMLElement;
  onEvent: (event: PaddleInputEvent) => void;
};

/**
 * Treats two ordinary keyboard-HID keys as raw paddle contacts.
 *
 * The adapter preserves down/up edges and browser event timestamps, ignores
 * auto-repeat, prevents the mapped keys from typing into the page, and emits
 * safe releases if the page loses focus.
 */
export function attachKeyboardPaddle({
  ditKey = "a",
  dahKey = "b",
  target = window,
  onEvent,
}: KeyboardPaddleOptions): () => void {
  const held = new Set<PaddleChannel>();

  const channelFor = (event: KeyboardEvent): PaddleChannel | null => {
    const key = event.key.toLowerCase();
    if (key === ditKey.toLowerCase()) return "dit";
    if (key === dahKey.toLowerCase()) return "dah";
    return null;
  };

  const emit = (
    channel: PaddleChannel,
    action: PaddleAction,
    timestamp = performance.now(),
  ) => {
    if (action === "down") {
      if (held.has(channel)) return;
      held.add(channel);
    } else {
      if (!held.has(channel)) return;
      held.delete(channel);
    }

    onEvent({ source: "keyboard-hid", channel, action, timestamp });
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const channel = channelFor(event);
    if (!channel) return;
    event.preventDefault();
    if (event.repeat) return;
    emit(channel, "down", event.timeStamp);
  };

  const onKeyUp = (event: KeyboardEvent) => {
    const channel = channelFor(event);
    if (!channel) return;
    event.preventDefault();
    emit(channel, "up", event.timeStamp);
  };

  const releaseAll = () => {
    const now = performance.now();
    for (const channel of [...held]) emit(channel, "up", now);
  };

  const onVisibilityChange = () => {
    if (document.visibilityState === "hidden") releaseAll();
  };

  target.addEventListener("keydown", onKeyDown as EventListener);
  target.addEventListener("keyup", onKeyUp as EventListener);
  window.addEventListener("blur", releaseAll);
  document.addEventListener("visibilitychange", onVisibilityChange);

  return () => {
    target.removeEventListener("keydown", onKeyDown as EventListener);
    target.removeEventListener("keyup", onKeyUp as EventListener);
    window.removeEventListener("blur", releaseAll);
    document.removeEventListener("visibilitychange", onVisibilityChange);
    releaseAll();
  };
}
