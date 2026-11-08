import type { Rng } from "../core/rng.ts";
import { generateCallsignForStage } from "./callsigns.ts";

export type LearnerStationProfile = {
  callsign?: string;
  name?: string;
  qth?: string;
  rig?: string;
  power?: string;
};

export type LearnerStationProfileField = keyof LearnerStationProfile;

export type ResolvedStationProfile = {
  callsign: string;
  name: string;
  qth: string;
  rig?: string;
  power?: string;
  usesFallback: boolean;
  fallbackFields: LearnerStationProfileField[];
};

export type LearnerStationContent = {
  learner: ResolvedStationProfile;
  counterpartCallsign: string;
};

export const GENERIC_STATION_FALLBACK = {
  callsigns: ["K1ABC", "W1AW", "N0CALL", "DL1ABC", "VK2DX"] as const,
  names: ["ALEX", "SAM", "PAT", "CHRIS", "JORDAN"] as const,
  qths: ["BOSTON", "SEATTLE", "AUSTIN", "DENVER", "TOKYO"] as const,
  rigs: ["IC7300", "FT891", "KX2", "TS590"] as const,
  powers: ["5W", "50W", "100W"] as const,
};

const CALLSIGN_PATTERN =
  /^(?:[A-Z0-9]{1,4}\/)?[A-Z]{1,2}[0-9][A-Z0-9]{1,4}(?:\/[A-Z0-9]{1,4})?$/;

function normalizeText(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const normalized = value.trim().replace(/\s+/g, " ").toUpperCase();
  return normalized.length > 0 ? normalized : undefined;
}

function pick<T>(items: readonly T[], rng: Rng): T {
  return items[Math.floor(rng() * items.length)];
}

export function validateCallsign(value: string | undefined): string | undefined {
  if (value === undefined || value.length === 0) {
    return undefined;
  }
  if (!CALLSIGN_PATTERN.test(value)) {
    return "Callsign must use a plausible amateur-radio format (letters, digits, optional /).";
  }
  return undefined;
}

export function normalizeLearnerStationProfile(
  profile: LearnerStationProfile,
): LearnerStationProfile {
  const callsign = normalizeText(profile.callsign);
  const error = validateCallsign(callsign);
  if (error) {
    throw new Error(error);
  }

  return {
    ...(callsign ? { callsign } : {}),
    ...(normalizeText(profile.name) ? { name: normalizeText(profile.name) } : {}),
    ...(normalizeText(profile.qth) ? { qth: normalizeText(profile.qth) } : {}),
    ...(normalizeText(profile.rig) ? { rig: normalizeText(profile.rig) } : {}),
    ...(normalizeText(profile.power)
      ? { power: normalizeText(profile.power) }
      : {}),
  };
}

export function resolveLearnerStationProfile(
  profile: LearnerStationProfile | undefined,
  rng: Rng,
): ResolvedStationProfile {
  const normalized = normalizeLearnerStationProfile(profile ?? {});
  const fallbackFields: LearnerStationProfileField[] = [];

  const callsign =
    normalized.callsign ??
    (() => {
      fallbackFields.push("callsign");
      return pick(GENERIC_STATION_FALLBACK.callsigns, rng);
    })();

  const name =
    normalized.name ??
    (() => {
      fallbackFields.push("name");
      return pick(GENERIC_STATION_FALLBACK.names, rng);
    })();

  const qth =
    normalized.qth ??
    (() => {
      fallbackFields.push("qth");
      return pick(GENERIC_STATION_FALLBACK.qths, rng);
    })();

  const rig =
    normalized.rig ??
    (rng() < 0.5 ? undefined : pick(GENERIC_STATION_FALLBACK.rigs, rng));
  if (normalized.rig === undefined && rig !== undefined) {
    fallbackFields.push("rig");
  }

  const power =
    normalized.power ??
    (rng() < 0.5 ? undefined : pick(GENERIC_STATION_FALLBACK.powers, rng));
  if (normalized.power === undefined && power !== undefined) {
    fallbackFields.push("power");
  }

  return {
    callsign,
    name,
    qth,
    ...(rig ? { rig } : {}),
    ...(power ? { power } : {}),
    usesFallback: fallbackFields.length > 0,
    fallbackFields,
  };
}

/**
 * Builds deterministic station content for future OP-3/OP-4 drills.
 * Learner fields come from profile when available, with explicit fallbacks.
 */
export function buildLearnerStationContent(
  profile: LearnerStationProfile | undefined,
  rng: Rng,
): LearnerStationContent {
  return {
    learner: resolveLearnerStationProfile(profile, rng),
    counterpartCallsign: generateCallsignForStage("international", rng),
  };
}
