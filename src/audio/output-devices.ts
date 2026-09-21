// Output-device discovery for routing CW audio to a chosen device (e.g.
// Bluetooth headphones). Chromium only exposes real output device ids and
// labels after a media-permission grant, so listing is gated behind a
// one-time request that immediately releases the microphone track.

export type OutputDevice = {
  deviceId: string;
  label: string;
};

export type OutputSupport =
  | { supported: true }
  | {
      supported: false;
      reason: "insecure-context" | "no-media-devices" | "no-setsinkid";
    };

/**
 * Reports whether this browser can route Web Audio to a chosen output device,
 * and if not, why. `setSinkId` on AudioContext only exists in Chromium, and
 * media APIs require a secure context (localhost or HTTPS).
 */
export function getOutputSupport(): OutputSupport {
  if (typeof window !== "undefined" && window.isSecureContext === false) {
    return { supported: false, reason: "insecure-context" };
  }
  if (
    !navigator.mediaDevices?.enumerateDevices ||
    !navigator.mediaDevices?.getUserMedia
  ) {
    return { supported: false, reason: "no-media-devices" };
  }
  const hasSetSinkId =
    typeof AudioContext !== "undefined" &&
    typeof (AudioContext.prototype as { setSinkId?: unknown }).setSinkId ===
      "function";
  if (!hasSetSinkId) {
    return { supported: false, reason: "no-setsinkid" };
  }
  return { supported: true };
}

/**
 * Prompts for media access so device labels become visible, then releases the
 * microphone immediately. Returns false if the user denies access.
 */
export async function requestOutputAccess(): Promise<boolean> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    for (const track of stream.getTracks()) {
      track.stop();
    }
    return true;
  } catch {
    return false;
  }
}

/** Lists audio output devices that have a usable id and label. */
export async function listOutputDevices(): Promise<OutputDevice[]> {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices
    .filter((device) => device.kind === "audiooutput" && device.deviceId)
    .map((device) => ({
      deviceId: device.deviceId,
      label: device.label || "Unnamed output",
    }));
}
