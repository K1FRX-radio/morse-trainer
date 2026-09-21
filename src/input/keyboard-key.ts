// Keyboard straight-key adapter. Binds a configurable key (default Space) to a
// StraightKey, ignoring OS auto-repeat and releasing cleanly when focus or
// visibility is lost so a held key never leaves a stuck mark.

import type { StraightKey } from "./key-input.ts";

export type KeyboardKeyOptions = {
  /** KeyboardEvent.key to treat as the straight key. Default " " (Space). */
  key?: string;
  /** Event target to bind to. Default window. */
  target?: Window | HTMLElement;
};

/**
 * Attaches keyboard keying to the given StraightKey. Returns a detach function
 * that removes every listener and lifts any held contact.
 */
export function attachKeyboardKey(
  straightKey: StraightKey,
  options: KeyboardKeyOptions = {},
): () => void {
  const key = options.key ?? " ";
  const target: Window | HTMLElement = options.target ?? window;

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== key) {
      return;
    }
    // Ignore auto-repeat so a held key is one down/up transition.
    if (event.repeat) {
      event.preventDefault();
      return;
    }
    event.preventDefault();
    straightKey.press();
  };

  const onKeyUp = (event: KeyboardEvent): void => {
    if (event.key !== key) {
      return;
    }
    event.preventDefault();
    straightKey.release();
  };

  const releaseOnLeave = (): void => {
    straightKey.release();
  };

  const onVisibilityChange = (): void => {
    if (document.visibilityState === "hidden") {
      straightKey.release();
    }
  };

  target.addEventListener("keydown", onKeyDown as EventListener);
  target.addEventListener("keyup", onKeyUp as EventListener);
  window.addEventListener("blur", releaseOnLeave);
  document.addEventListener("visibilitychange", onVisibilityChange);

  return () => {
    target.removeEventListener("keydown", onKeyDown as EventListener);
    target.removeEventListener("keyup", onKeyUp as EventListener);
    window.removeEventListener("blur", releaseOnLeave);
    document.removeEventListener("visibilitychange", onVisibilityChange);
    straightKey.release();
  };
}
