import { describe, expect, it, vi } from "vitest";
import { attachKeyboardPaddle, type PaddleInputEvent } from "./paddle-keyboard.ts";

describe("attachKeyboardPaddle", () => {
  it("emits independent dit/dah down and up edges in order", () => {
    const events: PaddleInputEvent[] = [];
    const detach = attachKeyboardPaddle({ onEvent: (event) => events.push(event) });

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "b" }));
    window.dispatchEvent(new KeyboardEvent("keyup", { key: "a" }));
    window.dispatchEvent(new KeyboardEvent("keyup", { key: "b" }));

    expect(events.map(({ channel, action }) => [channel, action])).toEqual([
      ["dit", "down"],
      ["dah", "down"],
      ["dit", "up"],
      ["dah", "up"],
    ]);
    expect(events.every((event) => Number.isFinite(event.timestamp))).toBe(true);

    detach();
  });

  it("ignores repeat and duplicate edges", () => {
    const onEvent = vi.fn();
    const detach = attachKeyboardPaddle({ onEvent });

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "a", repeat: true }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));
    window.dispatchEvent(new KeyboardEvent("keyup", { key: "a" }));
    window.dispatchEvent(new KeyboardEvent("keyup", { key: "a" }));

    expect(onEvent).toHaveBeenCalledTimes(2);
    detach();
  });

  it("releases a held paddle when the window loses focus", () => {
    const events: PaddleInputEvent[] = [];
    const detach = attachKeyboardPaddle({ onEvent: (event) => events.push(event) });

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "b" }));
    window.dispatchEvent(new Event("blur"));

    expect(events.map(({ channel, action }) => [channel, action])).toEqual([
      ["dah", "down"],
      ["dah", "up"],
    ]);

    detach();
  });
});
