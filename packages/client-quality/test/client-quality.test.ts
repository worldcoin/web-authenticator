import { describe, expect, test } from "bun:test";
import {
  CLIENT_QUALITY_POLICY_V0,
  SIMULATION_ENVIRONMENT,
  SIMULATION_MODE,
  type ClientQualityPolicyV0,
} from "../../contracts/src";
import {
  CLIENT_QUALITY_REASON_CODES_V0,
  evaluateClientQualityV0,
  isClientQualityResultV0,
  type ClientQualityMeasurementSourceV0,
} from "../src";

const completePolicy: ClientQualityPolicyV0 = {
  version: CLIENT_QUALITY_POLICY_V0,
  mode: SIMULATION_MODE,
  environment: SIMULATION_ENVIRONMENT,
  policyId: "quality-policy-fixture",
  purpose: "capture_ux_only",
  checks: [
    { kind: "camera_active" },
    { kind: "single_face" },
    {
      kind: "framing",
      minFaceAreaRatio: 0.2,
      maxFaceAreaRatio: 0.6,
      maxCenterOffsetRatio: 0.15,
    },
    { kind: "lighting", minMeanLuma: 60, maxMeanLuma: 210 },
    { kind: "sharpness", minScore: 12 },
  ],
  maxRetakes: 2,
};

function source(
  overrides: Partial<ClientQualityMeasurementSourceV0> = {},
): ClientQualityMeasurementSourceV0 {
  return {
    readCameraActive: () => true,
    readFaceCount: () => 1,
    readFraming: () => ({ faceAreaRatio: 0.4, centerOffsetRatio: 0.05 }),
    readMeanLuma: () => 128,
    readSharpnessScore: () => 20,
    ...overrides,
  };
}

function evaluate(
  policy: ClientQualityPolicyV0 = completePolicy,
  measurements: ClientQualityMeasurementSourceV0 = source(),
  retakesUsed = 0,
) {
  return evaluateClientQualityV0(policy, measurements, { retakesUsed });
}

describe("ClientQualityPolicyV0 selection", () => {
  test("returns ready when every explicitly enabled check is satisfied", () => {
    expect(evaluate()).toEqual({
      version: CLIENT_QUALITY_POLICY_V0,
      policyId: completePolicy.policyId,
      action: "ready",
      reasonCodes: [],
    });
  });

  test("never reads a check omitted by policy", () => {
    const cameraOnly: ClientQualityPolicyV0 = {
      ...completePolicy,
      checks: [{ kind: "camera_active" }],
    };
    const unused = () => {
      throw new Error("disabled check was read");
    };
    const result = evaluate(cameraOnly, {
      readCameraActive: () => true,
      readFaceCount: unused,
      readFraming: unused,
      readMeanLuma: unused,
      readSharpnessScore: unused,
    });
    expect(result.action).toBe("ready");
  });

  test("requires a valid explicit camera-active check and finite thresholds", () => {
    const withoutCamera = { ...completePolicy, checks: [{ kind: "single_face" }] };
    const nonFinite = {
      ...completePolicy,
      checks: [{ kind: "camera_active" }, { kind: "sharpness", minScore: Number.NaN }],
    };
    const unknownCheck = {
      ...completePolicy,
      checks: [{ kind: "camera_active" }, { kind: "unexpected_check" }],
    };
    expect(evaluate(withoutCamera as ClientQualityPolicyV0).reasonCodes).toEqual([
      "policy_invalid",
    ]);
    expect(evaluate(nonFinite as ClientQualityPolicyV0).reasonCodes).toEqual([
      "policy_invalid",
    ]);
    expect(evaluate(unknownCheck as ClientQualityPolicyV0).reasonCodes).toEqual([
      "policy_invalid",
    ]);
  });

  test("rejects time-varying policy getters and proxies before evaluation", () => {
    let getterReads = 0;
    const getterPolicy = { ...completePolicy };
    Object.defineProperty(getterPolicy, "checks", {
      enumerable: true,
      get() {
        getterReads += 1;
        return getterReads === 1
          ? completePolicy.checks
          : [{ kind: "camera_active" }, { kind: "unexpected_check" }];
      },
    });
    expect(evaluate(getterPolicy)).toMatchObject({
      action: "unavailable",
      reasonCodes: ["policy_invalid"],
    });
    expect(getterReads).toBe(0);

    let proxyReads = 0;
    const proxyPolicy = new Proxy(completePolicy, {
      get(target, property, receiver) {
        if (property === "checks") {
          proxyReads += 1;
          return proxyReads === 1
            ? target.checks
            : [{ kind: "camera_active" }, { kind: "unexpected_check" }];
        }
        return Reflect.get(target, property, receiver);
      },
    });
    expect(evaluate(proxyPolicy)).toMatchObject({
      action: "unavailable",
      reasonCodes: ["policy_invalid"],
    });
  });
});

describe("threshold and action matrix", () => {
  test("maps camera states only to unavailable or continued evaluation", () => {
    expect(evaluate(completePolicy, source({ readCameraActive: () => false }))).toMatchObject({
      action: "unavailable",
      reasonCodes: ["camera_inactive"],
    });
    expect(evaluate(completePolicy, source({ readCameraActive: () => null }))).toMatchObject({
      action: "unavailable",
      reasonCodes: ["camera_unavailable"],
    });
  });

  test("maps face count to one specific adjustment", () => {
    expect(evaluate(completePolicy, source({ readFaceCount: () => 0 }))).toMatchObject({
      action: "adjust",
      reasonCodes: ["face_not_found"],
    });
    expect(evaluate(completePolicy, source({ readFaceCount: () => "multiple" }))).toMatchObject({
      action: "adjust",
      reasonCodes: ["multiple_faces"],
    });
  });

  test("treats framing boundaries as ready and values outside them as adjustments", () => {
    expect(
      evaluate(
        { ...completePolicy, checks: completePolicy.checks.slice(0, 3) },
        source({ readFraming: () => ({ faceAreaRatio: 0.2, centerOffsetRatio: 0.15 }) }),
      ).action,
    ).toBe("ready");
    expect(
      evaluate(completePolicy, source({ readFraming: () => ({ faceAreaRatio: 0.19, centerOffsetRatio: 0 }) })),
    ).toMatchObject({ action: "adjust", reasonCodes: ["move_closer"] });
    expect(
      evaluate(completePolicy, source({ readFraming: () => ({ faceAreaRatio: 0.61, centerOffsetRatio: 0 }) })),
    ).toMatchObject({ action: "adjust", reasonCodes: ["move_farther"] });
    expect(
      evaluate(completePolicy, source({ readFraming: () => ({ faceAreaRatio: 0.4, centerOffsetRatio: 0.16 }) })),
    ).toMatchObject({ action: "adjust", reasonCodes: ["center_face"] });
  });

  test("treats lighting boundaries as ready and values outside them as adjustments", () => {
    const throughLighting = { ...completePolicy, checks: completePolicy.checks.slice(0, 4) };
    expect(evaluate(throughLighting, source({ readMeanLuma: () => 60 })).action).toBe("ready");
    expect(evaluate(throughLighting, source({ readMeanLuma: () => 210 })).action).toBe("ready");
    expect(evaluate(completePolicy, source({ readMeanLuma: () => 59 }))).toMatchObject({
      action: "adjust",
      reasonCodes: ["improve_lighting"],
    });
    expect(evaluate(completePolicy, source({ readMeanLuma: () => 211 }))).toMatchObject({
      action: "adjust",
      reasonCodes: ["reduce_lighting"],
    });
  });

  test("bounds retakes using the explicit policy limit", () => {
    expect(evaluate(completePolicy, source({ readSharpnessScore: () => 11 }), 1)).toMatchObject({
      action: "retake",
      reasonCodes: ["image_blurry"],
    });
    expect(evaluate(completePolicy, source({ readSharpnessScore: () => 11 }), 2)).toMatchObject({
      action: "unavailable",
      reasonCodes: ["retake_limit_reached"],
    });
    expect(evaluate(completePolicy, source({ readSharpnessScore: () => 12 }), 2).action).toBe(
      "ready",
    );
  });
});

describe("unavailable and privacy boundaries", () => {
  test("contains no network, persistence, cache, or logging API", async () => {
    const implementation = await Bun.file(new URL("../src/index.ts", import.meta.url)).text();
    expect(implementation).not.toMatch(
      /\b(?:fetch|XMLHttpRequest|WebSocket|sendBeacon|localStorage|sessionStorage|indexedDB|CacheStorage|caches|logger|logging)\b|\bconsole\s*\./,
    );
  });

  test("missing, invalid, and throwing enabled measurements never create ready", () => {
    const cases: ClientQualityMeasurementSourceV0[] = [
      { readCameraActive: () => true },
      source({ readFaceCount: () => null }),
      source({ readFraming: () => ({ faceAreaRatio: Number.NaN, centerOffsetRatio: 0 }) }),
      source({ readMeanLuma: () => 256 }),
      source({
        readSharpnessScore: () => {
          throw new Error("measurement unavailable");
        },
      }),
      source({ readFraming: () => undefined as never }),
    ];
    for (const measurements of cases) {
      expect(evaluate(completePolicy, measurements).action).toBe("unavailable");
    }
    expect(evaluate(completePolicy, source(), -1)).toMatchObject({
      action: "unavailable",
      reasonCodes: ["quality_input_invalid"],
    });
    expect(
      evaluateClientQualityV0(completePolicy, undefined as never, { retakesUsed: 0 }),
    ).toMatchObject({ action: "unavailable", reasonCodes: ["camera_unavailable"] });
    expect(
      evaluateClientQualityV0(completePolicy, source(), undefined as never),
    ).toMatchObject({ action: "unavailable", reasonCodes: ["quality_input_invalid"] });
  });

  test("turns throwing framing properties and reader access into unavailable", () => {
    const throwingMeasurement = Object.defineProperty(
      { centerOffsetRatio: 0 },
      "faceAreaRatio",
      {
        enumerable: true,
        get() {
          throw new Error("measurement property unavailable");
        },
      },
    );
    expect(
      evaluate(
        completePolicy,
        source({ readFraming: () => throwingMeasurement as never }),
      ),
    ).toMatchObject({
      action: "unavailable",
      reasonCodes: ["framing_guidance_unavailable"],
    });

    const throwingReader = source();
    Object.defineProperty(throwingReader, "readFraming", {
      enumerable: true,
      get() {
        throw new Error("reader unavailable");
      },
    });
    expect(evaluate(completePolicy, throwingReader)).toMatchObject({
      action: "unavailable",
      reasonCodes: ["framing_guidance_unavailable"],
    });
  });

  test("emits an exact allowlisted result with no transient measurement data", () => {
    const privateData = {
      pixels: new Uint8Array([1, 2, 3]),
      landmarks: [{ x: 0.1, y: 0.2 }],
      bounds: { x: 10, y: 20, width: 40, height: 50 },
      detailedScore: 11.123456,
    };
    const result = evaluate(
      completePolicy,
      source({
        readSharpnessScore: () => privateData.detailedScore,
        ...privateData,
      } as Partial<ClientQualityMeasurementSourceV0>),
    );
    expect(Object.keys(result).sort()).toEqual([
      "action",
      "policyId",
      "reasonCodes",
      "version",
    ]);
    expect(result.reasonCodes.every((code) => CLIENT_QUALITY_REASON_CODES_V0.includes(code as never))).toBe(
      true,
    );
    expect(JSON.stringify(result)).not.toMatch(
      /pixels|landmarks|bounds|detailedScore|11\.123456|identity|provenance|attestation|simulation|spoof|liveness|verification|tee|simulated_/i,
    );
    expect(isClientQualityResultV0(result)).toBe(true);
  });

  test("rejects extra fields, unknown reasons, and action/reason mismatches", () => {
    const ready = evaluate();
    expect(isClientQualityResultV0({ ...ready, score: 1 })).toBe(false);
    expect(isClientQualityResultV0({ ...ready, reasonCodes: ["unknown"] })).toBe(false);
    expect(isClientQualityResultV0({ ...ready, action: "adjust", reasonCodes: [] })).toBe(false);
    expect(
      isClientQualityResultV0({ ...ready, action: "unavailable", reasonCodes: ["image_blurry"] }),
    ).toBe(false);
  });

  test("returns false for throwing parsed-result properties and proxies", () => {
    const throwingAction = Object.defineProperty(
      {
        version: CLIENT_QUALITY_POLICY_V0,
        policyId: completePolicy.policyId,
        reasonCodes: [],
      },
      "action",
      {
        enumerable: true,
        get() {
          throw new Error("parsed action unavailable");
        },
      },
    );
    expect(isClientQualityResultV0(throwingAction)).toBe(false);

    const revocable = Proxy.revocable(evaluate(), {});
    revocable.revoke();
    expect(isClientQualityResultV0(revocable.proxy)).toBe(false);
  });
});
