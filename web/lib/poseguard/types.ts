export type { PoseGuardCapture, PoseGuardImages, PoseGuardPrompt } from "@worldcoin/walletkit-web";

export type PoseObservation = {
  yaw: number;
  pitch: number;
  /** FaceEngine's roll from the eye landmarks; 0 is level. */
  roll: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
};

export type PoseTarget = Pick<PoseObservation, "pitch" | "yaw">;

export type ImageSize = readonly [width: number, height: number];

export type PoseGate = "no_estimate" | "stale" | "framing" | "too_small" | "pitch" | "yaw" | "pitch_and_yaw" | "aligned";

export type PoseWorkerRequest =
  | { type: "init" }
  | { type: "analyze"; frame: ImageBitmap; timestamp: number };

export type PoseWorkerResponse =
  | { type: "ready" }
  | { type: "result"; pose: PoseObservation | null }
  | { type: "error"; message: string };
