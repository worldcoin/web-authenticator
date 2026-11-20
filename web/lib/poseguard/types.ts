export type { PoseGuardCapture, PoseGuardImages, PoseGuardPrompt, PoseGuardTarget as PoseTarget } from "@worldcoin/walletkit-web";

export type PoseObservation = {
  yaw: number;
  pitch: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
};

export type PoseWorkerRequest =
  | { type: "init" }
  | { type: "analyze"; frame: ImageBitmap; timestamp: number };

export type PoseWorkerResponse =
  | { type: "ready" }
  | { type: "result"; pose: PoseObservation | null }
  | { type: "error"; message: string };
