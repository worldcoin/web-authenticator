import { POSEGUARD_EYE_POINTS, type PoseGuardFrame } from "../../contracts/src/poseguard";
import type { Observation } from "./vendor/posechallenge.js";

/** Only eye coordinates used by the decision rule; no full mesh, photo or embedding. */
export function encodeObservation(observation: Observation, origin: number): PoseGuardFrame {
  const present = observation.present && Number.isFinite(observation.yaw) && Number.isFinite(observation.pitch);
  const mesh = observation.landmarks;
  const eyes = present && mesh && mesh.length >= 3 * 478
    ? POSEGUARD_EYE_POINTS.flatMap(index => [mesh[index * 3], mesh[index * 3 + 1]]) : null;
  return { t: observation.t - origin, present, yaw: present ? observation.yaw : null, pitch: present ? observation.pitch : null,
    eyes: eyes?.every(Number.isFinite) ? eyes : null, width: observation.width, height: observation.height };
}

/** The unchanged core only uses these points for its gaze decision. Nose-parallax diagnostics are unavailable. */
export function decodeObservation(frame: PoseGuardFrame): Observation {
  let landmarks: Float32Array | null = null;
  if (frame.eyes) {
    landmarks = new Float32Array(478 * 3);
    POSEGUARD_EYE_POINTS.forEach((index, position) => {
      landmarks![index * 3] = frame.eyes![position * 2];
      landmarks![index * 3 + 1] = frame.eyes![position * 2 + 1];
    });
  }
  return { t: frame.t, present: frame.present, yaw: frame.yaw ?? NaN, pitch: frame.pitch ?? NaN, landmarks, width: frame.width, height: frame.height };
}
