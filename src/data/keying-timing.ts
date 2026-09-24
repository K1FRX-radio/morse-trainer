import {
  KEYING_TIMING_ENCODING,
  MAX_KEYING_MARK_SAMPLES,
  MAX_KEYING_SPACE_SAMPLES,
  type EncodedKeyingTiming,
} from "./models.ts";

const UINT32_MAX = 0xffffffff;

function requiresClamp(value: number): boolean {
  return !Number.isFinite(value) || value < 0 || value > UINT32_MAX;
}

function normalizedSample(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.min(UINT32_MAX, Math.round(value));
}

function encodeSamples(values: readonly number[], limit: number): string {
  const retained = values.slice(0, limit);
  const buffer = new ArrayBuffer(
    retained.length * Uint32Array.BYTES_PER_ELEMENT,
  );
  const view = new DataView(buffer);
  retained.forEach((value, index) => {
    view.setUint32(
      index * Uint32Array.BYTES_PER_ELEMENT,
      normalizedSample(value),
      true,
    );
  });
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function decodeKeyingSamples(encoded: string): number[] {
  const binary = atob(encoded);
  if (binary.length % Uint32Array.BYTES_PER_ELEMENT !== 0) {
    throw new RangeError("invalid u32 keying timing payload");
  }
  const buffer = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buffer);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  const view = new DataView(buffer);
  const result: number[] = [];
  for (
    let offset = 0;
    offset < buffer.byteLength;
    offset += Uint32Array.BYTES_PER_ELEMENT
  ) {
    result.push(view.getUint32(offset, true));
  }
  return result;
}

export function encodeKeyingTiming(
  marksMs: readonly number[],
  spacesMs: readonly number[],
  ditEstimateMs?: number,
): EncodedKeyingTiming {
  const timingOverflowed = [...marksMs, ...spacesMs].some(requiresClamp);
  return {
    encoding: KEYING_TIMING_ENCODING,
    marks: encodeSamples(marksMs, MAX_KEYING_MARK_SAMPLES),
    spaces: encodeSamples(spacesMs, MAX_KEYING_SPACE_SAMPLES),
    originalMarkCount: marksMs.length,
    originalSpaceCount: spacesMs.length,
    timingTruncated:
      marksMs.length > MAX_KEYING_MARK_SAMPLES ||
      spacesMs.length > MAX_KEYING_SPACE_SAMPLES,
    timingOverflowed,
    ...(ditEstimateMs !== undefined ? { ditEstimateMs } : {}),
  };
}
