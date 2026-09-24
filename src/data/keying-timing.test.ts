import { MAX_KEYING_MARK_SAMPLES, MAX_KEYING_SPACE_SAMPLES } from "./models.ts";
import { decodeKeyingSamples, encodeKeyingTiming } from "./keying-timing.ts";

describe("keying timing encoding", () => {
  it("round-trips integer millisecond samples as little-endian u32 data", () => {
    const encoded = encodeKeyingTiming([60, 180, 61.6], [59.5, 181], 60);

    expect(decodeKeyingSamples(encoded.marks)).toEqual([60, 180, 62]);
    expect(decodeKeyingSamples(encoded.spaces)).toEqual([60, 181]);
    expect(encoded).toMatchObject({
      encoding: "u32-ms-le-v1",
      originalMarkCount: 3,
      originalSpaceCount: 2,
      timingTruncated: false,
      timingOverflowed: false,
      ditEstimateMs: 60,
    });
  });

  it("retains bounded prefixes and records original sample counts", () => {
    const marks = Array.from(
      { length: MAX_KEYING_MARK_SAMPLES + 2 },
      (_, index) => index,
    );
    const spaces = Array.from(
      { length: MAX_KEYING_SPACE_SAMPLES + 3 },
      (_, index) => index + 10,
    );

    const encoded = encodeKeyingTiming(marks, spaces);

    expect(decodeKeyingSamples(encoded.marks)).toHaveLength(
      MAX_KEYING_MARK_SAMPLES,
    );
    expect(decodeKeyingSamples(encoded.spaces)).toHaveLength(
      MAX_KEYING_SPACE_SAMPLES,
    );
    expect(encoded).toMatchObject({
      originalMarkCount: MAX_KEYING_MARK_SAMPLES + 2,
      originalSpaceCount: MAX_KEYING_SPACE_SAMPLES + 3,
      timingTruncated: true,
    });
  });

  it("clamps invalid samples and records overflow", () => {
    const encoded = encodeKeyingTiming(
      [-1, Number.POSITIVE_INFINITY, 0x1_0000_0000],
      [],
    );

    expect(decodeKeyingSamples(encoded.marks)).toEqual([0, 0, 0xffffffff]);
    expect(encoded.timingOverflowed).toBe(true);
  });

  it("rejects payloads that are not complete u32 samples", () => {
    expect(() => decodeKeyingSamples(btoa("x"))).toThrow(RangeError);
  });
});
