import { describe, expect, it, vi } from "vitest";
import { thresholdsForWpm } from "../core/keying.ts";
import { StraightKey } from "./key-input.ts";

const thresholds = thresholdsForWpm(20); // dit = 60 ms

function makeKey(overrides = {}) {
  return new StraightKey({ thresholds, now: () => 0, ...overrides });
}

describe("StraightKey", () => {
  it("records edges and fires mark callbacks", () => {
    const onMarkStart = vi.fn();
    const onMarkEnd = vi.fn();
    const key = makeKey({ onMarkStart, onMarkEnd });

    key.press(0);
    key.release(60);

    expect(onMarkStart).toHaveBeenCalledWith(0);
    expect(onMarkEnd).toHaveBeenCalledWith(60);
    expect(key.getEdges()).toEqual([
      { type: "down", t: 0 },
      { type: "up", t: 60 },
    ]);
  });

  it("ignores a repeated press while already down (auto-repeat)", () => {
    const onMarkStart = vi.fn();
    const key = makeKey({ onMarkStart });

    key.press(0);
    key.press(10);
    key.press(20);
    key.release(60);

    expect(onMarkStart).toHaveBeenCalledTimes(1);
    expect(key.getEdges()).toHaveLength(2);
  });

  it("ignores a release with no active contact", () => {
    const onMarkEnd = vi.fn();
    const key = makeKey({ onMarkEnd });

    key.release(60);

    expect(onMarkEnd).not.toHaveBeenCalled();
    expect(key.getEdges()).toHaveLength(0);
  });

  it("exposes a running decode and reports contact state", () => {
    const key = makeKey();
    expect(key.isDown).toBe(false);

    key.press(0);
    expect(key.isDown).toBe(true);
    key.release(60); // 1-dit mark -> "E"

    expect(key.isDown).toBe(false);
    expect(key.decode().text).toBe("E");
  });

  it("fires onDecodeChange after each release", () => {
    const onDecodeChange = vi.fn();
    const key = makeKey({ onDecodeChange });

    key.press(0);
    key.release(60);

    expect(onDecodeChange).toHaveBeenCalledTimes(1);
    expect(onDecodeChange.mock.calls[0][0].text).toBe("E");
  });

  it("reset lifts a held contact and clears edges", () => {
    const onMarkEnd = vi.fn();
    const key = makeKey({ onMarkEnd });

    key.press(0);
    key.reset();

    expect(key.isDown).toBe(false);
    expect(onMarkEnd).toHaveBeenCalledTimes(1);
    expect(key.getEdges()).toHaveLength(0);
  });
});
