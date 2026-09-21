// Pointer/touch straight-key adapter. Binds a button element to a StraightKey
// using pointer capture, and releases cleanly on pointerup, pointercancel, or
// the pointer leaving the element while pressed so no mark ever sticks.

import type { StraightKey } from "./key-input.ts";

/**
 * Attaches pointer keying to the given element. Returns a detach function that
 * removes every listener and lifts any held contact.
 */
export function attachPointerKey(
  element: HTMLElement,
  straightKey: StraightKey,
): () => void {
  let activePointerId: number | undefined;

  const onPointerDown = (event: PointerEvent): void => {
    if (activePointerId !== undefined) {
      return;
    }
    activePointerId = event.pointerId;
    // Route later pointer events to this element even if it moves off.
    try {
      element.setPointerCapture(event.pointerId);
    } catch {
      // Capture is best-effort; keying still works without it.
    }
    event.preventDefault();
    straightKey.press();
  };

  const endContact = (event: PointerEvent): void => {
    if (event.pointerId !== activePointerId) {
      return;
    }
    activePointerId = undefined;
    if (element.hasPointerCapture(event.pointerId)) {
      element.releasePointerCapture(event.pointerId);
    }
    straightKey.release();
  };

  const onLostCapture = (): void => {
    if (activePointerId !== undefined) {
      activePointerId = undefined;
      straightKey.release();
    }
  };

  element.addEventListener("pointerdown", onPointerDown);
  element.addEventListener("pointerup", endContact);
  element.addEventListener("pointercancel", endContact);
  element.addEventListener("pointerleave", endContact);
  element.addEventListener("lostpointercapture", onLostCapture);

  return () => {
    element.removeEventListener("pointerdown", onPointerDown);
    element.removeEventListener("pointerup", endContact);
    element.removeEventListener("pointercancel", endContact);
    element.removeEventListener("pointerleave", endContact);
    element.removeEventListener("lostpointercapture", onLostCapture);
    straightKey.release();
  };
}
