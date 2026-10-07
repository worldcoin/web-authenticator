import type { Identifier } from "./common";
import { SIMULATION_ENVIRONMENT, SIMULATION_MODE } from "./common";

export const CLIENT_QUALITY_POLICY_V0 = "client_quality_policy_v0" as const;

export type ClientQualityCheckV0 =
  | { readonly kind: "camera_active" }
  | { readonly kind: "single_face" }
  | {
      readonly kind: "framing";
      readonly minFaceAreaRatio: number;
      readonly maxFaceAreaRatio: number;
      readonly maxCenterOffsetRatio: number;
    }
  | {
      readonly kind: "lighting";
      readonly minMeanLuma: number;
      readonly maxMeanLuma: number;
    }
  | { readonly kind: "sharpness"; readonly minScore: number };

export type ClientQualityActionV0 = "ready" | "adjust" | "retake" | "unavailable";

export interface ClientQualityPolicyV0 {
  readonly version: typeof CLIENT_QUALITY_POLICY_V0;
  readonly mode: typeof SIMULATION_MODE;
  readonly environment: typeof SIMULATION_ENVIRONMENT;
  readonly policyId: Identifier;
  readonly purpose: "capture_ux_only";
  readonly checks: readonly ClientQualityCheckV0[];
  readonly maxRetakes: number;
}

export interface ClientQualityResultV0 {
  readonly version: typeof CLIENT_QUALITY_POLICY_V0;
  readonly policyId: Identifier;
  readonly action: ClientQualityActionV0;
  readonly reasonCodes: readonly string[];
}

export function validateClientQualityPolicyV0(
  policy: ClientQualityPolicyV0,
): readonly string[] {
  const errors: string[] = [];
  if (policy.version !== CLIENT_QUALITY_POLICY_V0) errors.push("version");
  if (policy.mode !== SIMULATION_MODE) errors.push("mode");
  if (policy.environment !== SIMULATION_ENVIRONMENT) errors.push("environment");
  if (policy.purpose !== "capture_ux_only") errors.push("purpose");
  if (policy.maxRetakes < 0) errors.push("maxRetakes");

  const kinds = policy.checks.map((check) => check.kind);
  if (new Set(kinds).size !== kinds.length) errors.push("duplicateChecks");
  if (!kinds.includes("camera_active")) errors.push("cameraActiveRequired");

  for (const check of policy.checks) {
    if (check.kind === "framing") {
      if (
        check.minFaceAreaRatio < 0 ||
        check.maxFaceAreaRatio > 1 ||
        check.minFaceAreaRatio >= check.maxFaceAreaRatio ||
        check.maxCenterOffsetRatio < 0 ||
        check.maxCenterOffsetRatio > 1
      ) {
        errors.push("framingThresholds");
      }
    }
    if (check.kind === "lighting") {
      if (
        check.minMeanLuma < 0 ||
        check.maxMeanLuma > 255 ||
        check.minMeanLuma >= check.maxMeanLuma
      ) {
        errors.push("lightingThresholds");
      }
    }
    if (check.kind === "sharpness" && check.minScore < 0) {
      errors.push("sharpnessThreshold");
    }
  }
  return errors;
}

// Results contain actions and reason codes only: no frames, landmarks, bounds, or spoof score.
