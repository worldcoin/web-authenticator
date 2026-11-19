export type PoseTarget = { readonly targetPitch: number; readonly targetYaw: number };

export interface PoseGuardPrompt {
  readonly targets: readonly [PoseTarget, PoseTarget, PoseTarget];
  readonly expiresAt: number;
  readonly captureTimeoutMs: number;
}

export interface PoseGuardImages {
  readonly centralPng: Uint8Array;
  readonly captures: readonly [Uint8Array, Uint8Array, Uint8Array];
}

export type PoseGuardCapture = (prompt: PoseGuardPrompt, signal: AbortSignal) => Promise<PoseGuardImages>;

export type PoseGuardResult =
  | { status: "success"; enrollment: {
    fields: { name: string; value: string }[];
    attestationHeader: string;
    encryptedCustody: Uint8Array;
  } }
  | { status: "failed"; reason: string };

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
