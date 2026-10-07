import { describe, expect, test } from "bun:test";
import {
  PRF_INPUT_V1_SHA256,
  WEB_AUTHN_PRF_AUTHENTICATOR_V1,
} from "@clean-start/contracts";
import type { BrowserAdmissionInputV1 } from "@clean-start/browser-admission";
import { evaluateBrowserAdmissionFactsV1 } from "../src/adapters/browser-admission";

const policy = {
  version: WEB_AUTHN_PRF_AUTHENTICATOR_V1,
  rpId: "world.id",
  allowedOrigins: ["https://world.id"],
  userVerification: "required",
  prfInputSha256: PRF_INPUT_V1_SHA256,
  prfOutputMapping: "verbatim_32_byte_first_result_to_world_id_4_signer_seed",
  secretLifecycle: "browser_memory_only",
} as const;

function input(overrides: Partial<BrowserAdmissionInputV1> = {}): BrowserAdmissionInputV1 {
  return {
    actualOrigin: "https://world.id",
    isTopLevel: true,
    frameOrigin: "same_origin",
    permissionsPolicy: "allowed",
    requestContext: {
      transactionHandle: "validated",
      returnTarget: "validated",
      session: "approved",
      unexpectedQueryFields: false,
    },
    platform: { device: "iphone", iosMajor: 18, browser: "safari" },
    browserContext: "normal_tab",
    embeddedEvidence: "none",
    capabilities: {
      secureContext: true,
      webAuthnApi: "available",
      platformUv: "available",
      clientCapabilitiesApi: "unknown",
      conditionalMediation: "unknown",
      mediaApi: "available",
      visibility: "visible",
    },
    ...overrides,
  };
}

describe("real W02 admission adapter", () => {
  test("keeps Safari and Chrome iOS 18 candidates separate", () => {
    expect(evaluateBrowserAdmissionFactsV1(policy, input()).browser).toBe("safari");
    expect(evaluateBrowserAdmissionFactsV1(policy, input({
      platform: { device: "iphone", iosMajor: 18, browser: "chrome" },
    })).browser).toBe("chrome");
  });

  test("blocks iOS 15-17 and embedded contexts before sensitive work", () => {
    const oldIos = evaluateBrowserAdmissionFactsV1(policy, input({
      platform: { device: "iphone", iosMajor: 17, browser: "safari" },
    }));
    expect(oldIos.outcome).toBe("ios_update_required");
    expect(oldIos.mayStartSensitiveFlow).toBe(false);

    const embedded = evaluateBrowserAdmissionFactsV1(policy, input({
      browserContext: "embedded",
      embeddedEvidence: "confirmed",
    }));
    expect(embedded.outcome).toBe("embedded_browser_handoff");
    expect(embedded.mayStartSensitiveFlow).toBe(false);
  });
});
