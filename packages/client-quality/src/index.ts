import {
  CLIENT_QUALITY_POLICY_V0,
  validateClientQualityPolicyV0,
  type ClientQualityActionV0,
  type ClientQualityCheckV0,
  type ClientQualityPolicyV0,
  type ClientQualityResultV0,
} from "../../contracts/src";

export const CLIENT_QUALITY_REASON_CODES_V0 = [
  "camera_inactive",
  "camera_unavailable",
  "face_not_found",
  "multiple_faces",
  "face_guidance_unavailable",
  "move_closer",
  "move_farther",
  "center_face",
  "framing_guidance_unavailable",
  "improve_lighting",
  "reduce_lighting",
  "lighting_guidance_unavailable",
  "image_blurry",
  "sharpness_guidance_unavailable",
  "retake_limit_reached",
  "policy_invalid",
  "quality_input_invalid",
] as const;

export type ClientQualityReasonCodeV0 =
  (typeof CLIENT_QUALITY_REASON_CODES_V0)[number];

export type FaceCountMeasurementV0 = 0 | 1 | "multiple";

export interface FramingMeasurementV0 {
  readonly faceAreaRatio: number;
  readonly centerOffsetRatio: number;
}

/**
 * Reads ephemeral measurements owned by the caller. Measurements are consumed
 * synchronously and are never included in the returned result.
 */
export interface ClientQualityMeasurementSourceV0 {
  readonly readCameraActive: () => boolean | null;
  readonly readFaceCount?: () => FaceCountMeasurementV0 | null;
  readonly readFraming?: () => FramingMeasurementV0 | null;
  readonly readMeanLuma?: () => number | null;
  readonly readSharpnessScore?: () => number | null;
}

export interface ClientQualityEvaluationOptionsV0 {
  readonly retakesUsed: number;
}

export interface EvaluatedClientQualityResultV0 extends ClientQualityResultV0 {
  readonly reasonCodes: readonly ClientQualityReasonCodeV0[];
}

const REASON_CODE_SET = new Set<string>(CLIENT_QUALITY_REASON_CODES_V0);

const ADJUST_REASONS = new Set<ClientQualityReasonCodeV0>([
  "face_not_found",
  "multiple_faces",
  "move_closer",
  "move_farther",
  "center_face",
  "improve_lighting",
  "reduce_lighting",
]);

const UNAVAILABLE_REASONS = new Set<ClientQualityReasonCodeV0>([
  "camera_inactive",
  "camera_unavailable",
  "face_guidance_unavailable",
  "framing_guidance_unavailable",
  "lighting_guidance_unavailable",
  "sharpness_guidance_unavailable",
  "retake_limit_reached",
  "policy_invalid",
  "quality_input_invalid",
]);

function result(
  policyId: string,
  action: ClientQualityActionV0,
  reasonCode?: ClientQualityReasonCodeV0,
): EvaluatedClientQualityResultV0 {
  const reasonCodes = Object.freeze(reasonCode === undefined ? [] : [reasonCode]);
  return Object.freeze({
    version: CLIENT_QUALITY_POLICY_V0,
    policyId,
    action,
    reasonCodes,
  });
}

function hasExactKeys(value: object, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function hasFiniteThresholds(check: ClientQualityCheckV0): boolean {
  if (check.kind === "framing") {
    return (
      Number.isFinite(check.minFaceAreaRatio) &&
      Number.isFinite(check.maxFaceAreaRatio) &&
      Number.isFinite(check.maxCenterOffsetRatio) &&
      hasExactKeys(check, [
        "kind",
        "minFaceAreaRatio",
        "maxFaceAreaRatio",
        "maxCenterOffsetRatio",
      ])
    );
  }
  if (check.kind === "lighting") {
    return (
      Number.isFinite(check.minMeanLuma) &&
      Number.isFinite(check.maxMeanLuma) &&
      hasExactKeys(check, ["kind", "minMeanLuma", "maxMeanLuma"])
    );
  }
  if (check.kind === "sharpness") {
    return Number.isFinite(check.minScore) && hasExactKeys(check, ["kind", "minScore"]);
  }
  if (check.kind === "camera_active" || check.kind === "single_face") {
    return hasExactKeys(check, ["kind"]);
  }
  return false;
}

function containsAccessor(value: unknown, seen = new WeakSet<object>()): boolean {
  if (typeof value !== "object" || value === null || seen.has(value)) return false;
  seen.add(value);

  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const descriptor of Object.values(descriptors)) {
    if (descriptor.get !== undefined || descriptor.set !== undefined) return true;
    if ("value" in descriptor && containsAccessor(descriptor.value, seen)) return true;
  }
  return false;
}

function snapshotUsablePolicy(
  policy: ClientQualityPolicyV0,
): ClientQualityPolicyV0 | null {
  try {
    if (typeof policy !== "object" || policy === null || Array.isArray(policy)) return null;
    if (containsAccessor(policy)) return null;

    const snapshot = structuredClone(policy) as ClientQualityPolicyV0;
    if (
      !hasExactKeys(snapshot, [
        "version",
        "mode",
        "environment",
        "policyId",
        "purpose",
        "checks",
        "maxRetakes",
      ]) ||
      typeof snapshot.policyId !== "string" ||
      snapshot.policyId.length === 0 ||
      !Number.isSafeInteger(snapshot.maxRetakes) ||
      !Array.isArray(snapshot.checks) ||
      !snapshot.checks.every(
        (check) =>
          typeof check === "object" && check !== null && hasFiniteThresholds(check),
      ) ||
      validateClientQualityPolicyV0(snapshot).length !== 0
    ) {
      return null;
    }

    for (const check of snapshot.checks) Object.freeze(check);
    Object.freeze(snapshot.checks);
    return Object.freeze(snapshot);
  } catch {
    return null;
  }
}

function safelyRead<T>(reader: (() => T | null) | undefined): T | null {
  if (reader === undefined) return null;
  try {
    const value = reader();
    return value === undefined ? null : value;
  } catch {
    return null;
  }
}

function safelyReadFromSource<T>(
  source: ClientQualityMeasurementSourceV0,
  selectReader: (
    candidate: ClientQualityMeasurementSourceV0,
  ) => (() => T | null) | undefined,
): T | null {
  return safelyRead(() => {
    const reader = selectReader(source);
    return typeof reader === "function" ? reader() : null;
  });
}

function isUnitRatio(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

function evaluateFaceCount(
  policyId: string,
  source: ClientQualityMeasurementSourceV0,
): EvaluatedClientQualityResultV0 | null {
  const count = safelyReadFromSource(source, (candidate) => candidate.readFaceCount);
  if (count === null || (count !== 0 && count !== 1 && count !== "multiple")) {
    return result(policyId, "unavailable", "face_guidance_unavailable");
  }
  if (count === 0) return result(policyId, "adjust", "face_not_found");
  if (count === "multiple") return result(policyId, "adjust", "multiple_faces");
  return null;
}

function evaluateFraming(
  policyId: string,
  check: Extract<ClientQualityCheckV0, { readonly kind: "framing" }>,
  source: ClientQualityMeasurementSourceV0,
): EvaluatedClientQualityResultV0 | null {
  const measurement = safelyReadFromSource(source, (candidate) => candidate.readFraming);
  const ratios = safelyRead(() =>
    measurement === null
      ? null
      : {
          faceAreaRatio: measurement.faceAreaRatio,
          centerOffsetRatio: measurement.centerOffsetRatio,
        },
  );
  if (
    ratios === null ||
    !isUnitRatio(ratios.faceAreaRatio) ||
    !isUnitRatio(ratios.centerOffsetRatio)
  ) {
    return result(policyId, "unavailable", "framing_guidance_unavailable");
  }
  if (ratios.faceAreaRatio < check.minFaceAreaRatio) {
    return result(policyId, "adjust", "move_closer");
  }
  if (ratios.faceAreaRatio > check.maxFaceAreaRatio) {
    return result(policyId, "adjust", "move_farther");
  }
  if (ratios.centerOffsetRatio > check.maxCenterOffsetRatio) {
    return result(policyId, "adjust", "center_face");
  }
  return null;
}

function evaluateLighting(
  policyId: string,
  check: Extract<ClientQualityCheckV0, { readonly kind: "lighting" }>,
  source: ClientQualityMeasurementSourceV0,
): EvaluatedClientQualityResultV0 | null {
  const meanLuma = safelyReadFromSource(source, (candidate) => candidate.readMeanLuma);
  if (meanLuma === null || !Number.isFinite(meanLuma) || meanLuma < 0 || meanLuma > 255) {
    return result(policyId, "unavailable", "lighting_guidance_unavailable");
  }
  if (meanLuma < check.minMeanLuma) {
    return result(policyId, "adjust", "improve_lighting");
  }
  if (meanLuma > check.maxMeanLuma) {
    return result(policyId, "adjust", "reduce_lighting");
  }
  return null;
}

function evaluateSharpness(
  policyId: string,
  check: Extract<ClientQualityCheckV0, { readonly kind: "sharpness" }>,
  source: ClientQualityMeasurementSourceV0,
  options: ClientQualityEvaluationOptionsV0,
  maxRetakes: number,
): EvaluatedClientQualityResultV0 | null {
  const score = safelyReadFromSource(source, (candidate) => candidate.readSharpnessScore);
  if (score === null || !Number.isFinite(score) || score < 0) {
    return result(policyId, "unavailable", "sharpness_guidance_unavailable");
  }
  if (score >= check.minScore) return null;
  if (options.retakesUsed >= maxRetakes) {
    return result(policyId, "unavailable", "retake_limit_reached");
  }
  return result(policyId, "retake", "image_blurry");
}

export function evaluateClientQualityV0(
  policy: ClientQualityPolicyV0,
  source: ClientQualityMeasurementSourceV0,
  options: ClientQualityEvaluationOptionsV0,
): EvaluatedClientQualityResultV0 {
  const policySnapshot = snapshotUsablePolicy(policy);
  if (policySnapshot === null) {
    return result("invalid-policy", "unavailable", "policy_invalid");
  }
  const policyId = policySnapshot.policyId;
  if (!Number.isSafeInteger(options?.retakesUsed) || options.retakesUsed < 0) {
    return result(policyId, "unavailable", "quality_input_invalid");
  }

  const cameraActive = safelyReadFromSource(
    source,
    (candidate) => candidate.readCameraActive,
  );
  if (cameraActive === null || typeof cameraActive !== "boolean") {
    return result(policyId, "unavailable", "camera_unavailable");
  }
  if (!cameraActive) return result(policyId, "unavailable", "camera_inactive");

  for (const check of policySnapshot.checks) {
    let checkResult: EvaluatedClientQualityResultV0 | null = null;
    if (check.kind === "camera_active") continue;
    if (check.kind === "single_face") checkResult = evaluateFaceCount(policyId, source);
    if (check.kind === "framing") checkResult = evaluateFraming(policyId, check, source);
    if (check.kind === "lighting") checkResult = evaluateLighting(policyId, check, source);
    if (check.kind === "sharpness") {
      checkResult = evaluateSharpness(
        policyId,
        check,
        source,
        options,
        policySnapshot.maxRetakes,
      );
    }
    if (checkResult !== null) return checkResult;
  }

  return result(policyId, "ready");
}

export function isClientQualityResultV0(value: unknown): value is EvaluatedClientQualityResultV0 {
  try {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
    if (!hasExactKeys(value, ["version", "policyId", "action", "reasonCodes"])) return false;

    const candidate = value as Record<string, unknown>;
    if (
      candidate.version !== CLIENT_QUALITY_POLICY_V0 ||
      typeof candidate.policyId !== "string" ||
      !["ready", "adjust", "retake", "unavailable"].includes(candidate.action as string) ||
      !Array.isArray(candidate.reasonCodes) ||
      !candidate.reasonCodes.every(
        (code) => typeof code === "string" && REASON_CODE_SET.has(code),
      )
    ) {
      return false;
    }

    if (candidate.action === "ready") return candidate.reasonCodes.length === 0;
    if (candidate.reasonCodes.length !== 1) return false;
    const reason = candidate.reasonCodes[0] as ClientQualityReasonCodeV0;
    if (candidate.action === "adjust") return ADJUST_REASONS.has(reason);
    if (candidate.action === "retake") return reason === "image_blurry";
    return UNAVAILABLE_REASONS.has(reason);
  } catch {
    return false;
  }
}
