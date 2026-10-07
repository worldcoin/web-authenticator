import type { Identifier, IsoDateTime } from "./common";
import { SIMULATION_ENVIRONMENT, SIMULATION_MODE } from "./common";

export const SIMULATION_CAPTURE_POLICY_V0 = "simulation_capture_policy_v0" as const;
export const FRAME_BUNDLE_V0_MIN_FRAMES = 1 as const;
export const FRAME_BUNDLE_V0_MAX_FRAMES = 4 as const;

export type FrameArtifactDataModeV0 = "metadata_only" | "synthetic_fixture";

export interface SimulationCapturePolicyV0 {
  readonly version: typeof SIMULATION_CAPTURE_POLICY_V0;
  readonly mode: typeof SIMULATION_MODE;
  readonly environment: typeof SIMULATION_ENVIRONMENT;
  readonly policyId: Identifier;
  readonly dataMode: FrameArtifactDataModeV0;
  readonly encoding: "rgba8";
  readonly minFrames: number;
  readonly maxFrames: number;
  readonly maxWidth: number;
  readonly maxHeight: number;
  readonly maxFrameBytes: number;
  readonly maxTotalBytes: number;
  readonly captureOffsetsAreDiagnosticOnly: true;
  readonly arrayOrderHasBiometricMeaning: false;
  readonly qualityPolicyId: Identifier;
  readonly expiresAt: IsoDateTime;
}

export function validateSimulationCapturePolicyV0(
  policy: SimulationCapturePolicyV0,
): readonly string[] {
  const errors: string[] = [];
  if (policy.version !== SIMULATION_CAPTURE_POLICY_V0) errors.push("version");
  if (policy.mode !== SIMULATION_MODE) errors.push("mode");
  if (policy.environment !== SIMULATION_ENVIRONMENT) errors.push("environment");
  if (policy.minFrames < FRAME_BUNDLE_V0_MIN_FRAMES) errors.push("minFrames");
  if (policy.maxFrames > FRAME_BUNDLE_V0_MAX_FRAMES) errors.push("maxFrames");
  if (policy.minFrames > policy.maxFrames) errors.push("frameRange");
  if (policy.maxWidth <= 0 || policy.maxHeight <= 0) errors.push("dimensions");
  if (policy.maxFrameBytes <= 0 || policy.maxTotalBytes <= 0) errors.push("byteLimits");
  return errors;
}
