import type { CaptureState } from "./types";

const TRANSITIONS: Readonly<Record<CaptureState, readonly CaptureState[]>> = {
  idle: ["permission_request", "sampling", "failed", "expired"],
  permission_request: [
    "permission_denied",
    "camera_unavailable",
    "camera_busy",
    "camera_restricted",
    "acquiring",
    "interrupted",
    "expired",
    "failed",
  ],
  permission_denied: ["cleaning_up"],
  camera_unavailable: ["cleaning_up"],
  camera_busy: ["cleaning_up"],
  camera_restricted: ["cleaning_up"],
  acquiring: [
    "camera_unavailable",
    "awaiting_first_frame",
    "interrupted",
    "expired",
    "failed",
  ],
  awaiting_first_frame: ["preview", "interrupted", "expired", "failed"],
  preview: ["sampling", "interrupted", "expired", "failed"],
  sampling: ["artifact_ready", "interrupted", "expired", "failed"],
  artifact_ready: ["cleaning_up"],
  interrupted: ["cleaning_up"],
  expired: ["cleaning_up"],
  failed: ["cleaning_up"],
  cleaning_up: ["complete"],
  complete: ["permission_request", "sampling", "failed", "expired"],
};

export function isCaptureTransitionAllowed(from: CaptureState, to: CaptureState): boolean {
  return TRANSITIONS[from].includes(to);
}

export function reduceCaptureState(from: CaptureState, to: CaptureState): CaptureState {
  if (!isCaptureTransitionAllowed(from, to)) {
    throw new Error(`Invalid capture state transition: ${from} -> ${to}`);
  }
  return to;
}
