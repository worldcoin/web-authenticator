/** Versioned beta protocol. Measurements are browser claims, never issuer authorization. */
export const POSEGUARD_PROFILE = "facepad-poseguard-v8" as const;
export const POSEGUARD_BODY_LIMIT = 524_288;
export const POSEGUARD_MAX_FRAMES = 1_000;
export const POSEGUARD_RUN_SECONDS = 45;
export const POSEGUARD_TTL_MS = 120_000;
export const POSEGUARD_EYE_POINTS = [33, 133, 362, 263, 468, 473] as const;
export interface PoseGuardChallenge {
  id: string;
  capability: string;
  profile: typeof POSEGUARD_PROFILE;
  seed: string;
  expiresAt: number;
  targets: { directionDegrees: number; armDelaySeconds: number }[];
}
export interface PoseGuardFrame {
  t: number;
  present: boolean;
  yaw: number | null;
  pitch: number | null;
  eyes: number[] | null;
  width: number;
  height: number;
}
export interface PoseGuardEvidence { frames: PoseGuardFrame[] }
export interface PoseGuardVerdict {
  profile: typeof POSEGUARD_PROFILE;
  status: "passed" | "failed" | "inconclusive";
  outcome: string;
  reason: string;
}
const object = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const keys = (value: Record<string, unknown>, allowed: readonly string[]) => Object.keys(value).every(key => allowed.includes(key)) && Object.keys(value).length === allowed.length;
const finite = (value: unknown, min: number, max: number): value is number => typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
export function isPoseGuardEvidence(value: unknown): value is PoseGuardEvidence {
  if (!object(value) || !keys(value, ["frames"]) || !Array.isArray(value.frames) || value.frames.length < 2 || value.frames.length > POSEGUARD_MAX_FRAMES) return false;
  let previous = -1;
  return value.frames.every((frame, index) => {
    if (!object(frame) || !keys(frame, ["t", "present", "yaw", "pitch", "eyes", "width", "height"]) ||
      !finite(frame.t, 0, POSEGUARD_RUN_SECONDS) || frame.t <= previous || (index === 0 && (frame.t !== 0 || frame.present !== true)) ||
      typeof frame.present !== "boolean" || !finite(frame.width, 1, 4096) || !Number.isInteger(frame.width) ||
      !finite(frame.height, 1, 4096) || !Number.isInteger(frame.height)) return false;
    previous = frame.t;
    return frame.present
      ? finite(frame.yaw, -180, 180) && finite(frame.pitch, -180, 180) &&
        (frame.eyes === null || (Array.isArray(frame.eyes) && frame.eyes.length === 12 && frame.eyes.every(value => finite(value, -4, 4))))
      : frame.yaw === null && frame.pitch === null && frame.eyes === null;
  });
}
export function isPoseGuardCapability(value: unknown): value is { id: string; capability: string } {
  return object(value) && typeof value.id === "string" && /^[0-9a-f-]{36}$/.test(value.id) &&
    typeof value.capability === "string" && /^[0-9a-f]{64}$/.test(value.capability);
}
