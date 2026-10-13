import { describe, expect, test } from "bun:test";
import {
  admitBrowserV1,
  BROWSER_ADMISSION_OUTCOMES_V1,
  classifyIPhoneUserAgentV1,
  collectAdvisoryCapabilitiesV1,
  createExternalBrowserHandoffV1,
  type BrowserAdmissionInputV1,
} from "../src";
import {
  PRF_INPUT_V1_SHA256,
  WEB_AUTHN_PRF_AUTHENTICATOR_V1,
  type WebAuthnPrfAuthenticatorPolicyV1,
} from "../../contracts/src";

const policy: WebAuthnPrfAuthenticatorPolicyV1 = {
  version: WEB_AUTHN_PRF_AUTHENTICATOR_V1,
  rpId: "auth.example.test",
  allowedOrigins: ["https://auth.example.test"],
  userVerification: "required",
  prfInputSha256: PRF_INPUT_V1_SHA256,
  prfOutputMapping: "verbatim_32_byte_first_result_to_world_id_4_signer_seed",
  secretLifecycle: "browser_memory_only",
};

function input(
  overrides: Partial<BrowserAdmissionInputV1> = {},
): BrowserAdmissionInputV1 {
  return {
    actualOrigin: "https://auth.example.test",
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

const safeInternalError = {
  version: "browser_admission_v1",
  outcome: "internal_error",
  reason: "safe_internal_error",
  mayStartSensitiveFlow: false,
  browser: "unknown",
  iosVersionBand: "unknown",
  context: "unknown",
  engine: "unknown",
  region: "unknown",
  provider: "unknown",
  capabilities: {
    webAuthnApi: "unknown",
    platformUv: "unknown",
    clientCapabilitiesApi: "unknown",
    conditionalMediation: "unknown",
    mediaApi: "unknown",
    visibility: "unknown",
  },
} as const;

describe("frozen iPhone policy", () => {
  test("exports no legacy iOS route outside the frozen update-required policy", () => {
    expect(BROWSER_ADMISSION_OUTCOMES_V1).not.toContain("legacy_ios_route_required");
  });

  for (const iosMajor of [15, 16, 17]) {
    for (const browser of ["safari", "chrome"] as const) {
      test(`iOS ${iosMajor} ${browser} requires an update and cannot proceed`, () => {
        const result = admitBrowserV1(
          policy,
          input({ platform: { device: "iphone", iosMajor, browser } }),
        );
        expect(result).toMatchObject({
          outcome: "ios_update_required",
          reason: "ios_version_requires_update",
          mayStartSensitiveFlow: false,
          browser,
          iosVersionBand: "ios_15_17",
        });
      });
    }
  }

  for (const iosMajor of [18, 26]) {
    test(`keeps iOS ${iosMajor} Safari and Chrome as distinct candidate cells`, () => {
      const safari = admitBrowserV1(
        policy,
        input({ platform: { device: "iphone", iosMajor, browser: "safari" } }),
      );
      const chrome = admitBrowserV1(
        policy,
        input({ platform: { device: "iphone", iosMajor, browser: "chrome" } }),
      );
      expect(safari).toMatchObject({ outcome: "eligible_candidate", browser: "safari" });
      expect(chrome).toMatchObject({ outcome: "eligible_candidate", browser: "chrome" });
      expect(safari.mayStartSensitiveFlow).toBe(true);
      expect(chrome.mayStartSensitiveFlow).toBe(true);
    });
  }

  test("fails closed when the shared authenticator policy is not the frozen version", () => {
    const malformed = { ...policy, userVerification: "preferred" };
    expect(
      admitBrowserV1(malformed as unknown as WebAuthnPrfAuthenticatorPolicyV1, input()),
    ).toMatchObject({
      outcome: "origin_or_rp_invalid",
      reason: "authenticator_policy_invalid",
      mayStartSensitiveFlow: false,
    });
  });

  test("keeps missing optional probes unknown without treating them as suspicious", () => {
    const result = admitBrowserV1(
      policy,
      input({
        capabilities: {
          ...input().capabilities,
          platformUv: "unknown",
          clientCapabilitiesApi: "unknown",
          conditionalMediation: "unknown",
        },
      }),
    );
    expect(result.outcome).toBe("eligible_candidate");
  });

  test("stops on explicit required-capability failures", () => {
    const uv = admitBrowserV1(
      policy,
      input({ capabilities: { ...input().capabilities, platformUv: "unavailable" } }),
    );
    const webAuthn = admitBrowserV1(
      policy,
      input({ capabilities: { ...input().capabilities, webAuthnApi: "unavailable" } }),
    );
    const media = admitBrowserV1(
      policy,
      input({ capabilities: { ...input().capabilities, mediaApi: "unavailable" } }),
    );
    expect(uv).toMatchObject({ outcome: "uv_unavailable", mayStartSensitiveFlow: false });
    expect(webAuthn).toMatchObject({ outcome: "unsupported", mayStartSensitiveFlow: false });
    expect(media).toMatchObject({ outcome: "unsupported", mayStartSensitiveFlow: false });
  });
});

describe("fail-closed context validation", () => {
  test("maps null policy or input to an inert internal error", () => {
    expect(
      admitBrowserV1(null as unknown as WebAuthnPrfAuthenticatorPolicyV1, input()),
    ).toEqual(safeInternalError);
    expect(
      admitBrowserV1(policy, null as unknown as BrowserAdmissionInputV1),
    ).toEqual(safeInternalError);
  });

  test("maps revoked policy and input proxies to an inert internal error", () => {
    const revokedPolicy = Proxy.revocable(policy, {});
    const revokedInput = Proxy.revocable(input(), {});
    revokedPolicy.revoke();
    revokedInput.revoke();

    expect(
      admitBrowserV1(
        revokedPolicy.proxy as WebAuthnPrfAuthenticatorPolicyV1,
        input(),
      ),
    ).toEqual(safeInternalError);
    expect(
      admitBrowserV1(policy, revokedInput.proxy as BrowserAdmissionInputV1),
    ).toEqual(safeInternalError);
  });

  test("never rereads throwing platform, capabilities, or evidence getters", () => {
    const rawSecret = "raw-secret-detail-must-not-escape";
    const fields = ["platform", "capabilities", "evidence"] as const;

    for (const field of fields) {
      const hostile = input();
      let reads = 0;
      Object.defineProperty(hostile, field, {
        configurable: true,
        get: () => {
          reads += 1;
          throw new Error(rawSecret);
        },
      });

      const result = admitBrowserV1(policy, hostile);
      expect(result).toEqual(safeInternalError);
      expect(JSON.stringify(result)).not.toContain(rawSecret);
      expect(reads).toBe(1);
      expect(Object.isFrozen(result)).toBe(true);
      expect(Object.isFrozen(result.capabilities)).toBe(true);
    }
  });

  test("rejects insecure, disallowed-origin, RP-ID, policy, and signed-context failures", () => {
    const insecure = input({ capabilities: { ...input().capabilities, secureContext: false } });
    const wrongOrigin = input({ actualOrigin: "https://elsewhere.example.test" });
    const badRpPolicy = { ...policy, rpId: "wrong.example.test" };
    const badPolicy = input({ permissionsPolicy: "unknown" });
    const badRequest = input({
      requestContext: { ...input().requestContext, transactionHandle: "invalid" },
    });

    expect(admitBrowserV1(policy, insecure)).toMatchObject({ outcome: "insecure_context" });
    expect(admitBrowserV1(policy, wrongOrigin)).toMatchObject({ outcome: "origin_or_rp_invalid" });
    expect(admitBrowserV1(badRpPolicy, input())).toMatchObject({ outcome: "origin_or_rp_invalid" });
    expect(admitBrowserV1(policy, badPolicy)).toMatchObject({ outcome: "origin_or_rp_invalid" });
    expect(admitBrowserV1(policy, badRequest)).toMatchObject({ outcome: "origin_or_rp_invalid" });
  });

  test("fails every frame closed instead of turning it into browser handoff", () => {
    const sameOrigin = admitBrowserV1(policy, input({ isTopLevel: false }));
    const crossOrigin = admitBrowserV1(
      policy,
      input({ isTopLevel: false, frameOrigin: "cross_origin", embeddedEvidence: "confirmed" }),
    );
    expect(sameOrigin).toMatchObject({
      outcome: "context_not_top_level",
      reason: "document_is_framed",
    });
    expect(crossOrigin).toMatchObject({
      outcome: "context_not_top_level",
      reason: "cross_origin_frame",
    });
    expect(
      admitBrowserV1(policy, input({ isTopLevel: true, frameOrigin: "cross_origin" })),
    ).toMatchObject({ outcome: "context_not_top_level", reason: "cross_origin_frame" });
  });

  test("hands embedded contexts off before browser capabilities matter", () => {
    for (const embeddedEvidence of ["probable", "confirmed"] as const) {
      const result = admitBrowserV1(
        policy,
        input({
          embeddedEvidence,
          browserContext: "embedded",
          capabilities: {
            ...input().capabilities,
            webAuthnApi: "unavailable",
            platformUv: "unavailable",
            mediaApi: "unavailable",
          },
        }),
      );
      expect(result).toMatchObject({
        outcome: "embedded_browser_handoff",
        mayStartSensitiveFlow: false,
      });
    }
    expect(
      admitBrowserV1(
        policy,
        input({ browserContext: "embedded", embeddedEvidence: "unknown" }),
      ),
    ).toMatchObject({ outcome: "embedded_browser_handoff", mayStartSensitiveFlow: false });
  });

  test("does not over-admit private, PWA, unknown, hidden, non-iPhone, or other browsers", () => {
    expect(admitBrowserV1(policy, input({ browserContext: "private_or_unknown" })).outcome).toBe(
      "private_or_unknown_context",
    );
    expect(admitBrowserV1(policy, input({ browserContext: "installed_pwa" })).outcome).toBe(
      "private_or_unknown_context",
    );
    expect(admitBrowserV1(policy, input({ browserContext: "unknown" })).outcome).toBe(
      "private_or_unknown_context",
    );
    expect(
      admitBrowserV1(
        policy,
        input({ capabilities: { ...input().capabilities, visibility: "hidden" } }),
      ).outcome,
    ).toBe("interrupted");
    expect(
      admitBrowserV1(
        policy,
        input({ platform: { device: "other", iosMajor: null, browser: "unknown" } }),
      ).outcome,
    ).toBe("unsupported");
    expect(
      admitBrowserV1(
        policy,
        input({ platform: { device: "iphone", iosMajor: 18, browser: "other" } }),
      ).outcome,
    ).toBe("unsupported");
  });
});

describe("coarse platform classification and advisory probes", () => {
  const safariUa =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1";
  const chromeUa =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0.0.0 Mobile/15E148 Safari/604.1";

  test("attributes iPhone Safari and Chrome without retaining the full UA", () => {
    expect(classifyIPhoneUserAgentV1(safariUa)).toEqual({
      device: "iphone",
      iosMajor: 18,
      browser: "safari",
    });
    expect(classifyIPhoneUserAgentV1(chromeUa)).toEqual({
      device: "iphone",
      iosMajor: 18,
      browser: "chrome",
    });
    expect(JSON.stringify(classifyIPhoneUserAgentV1(chromeUa))).not.toContain("Mozilla");
  });

  test("records engine, region, and provider only from explicit trusted evidence", () => {
    const untrusted = admitBrowserV1(
      policy,
      input({
        evidence: {
          engine: "alternative_engine_confirmed",
          region: "eu",
          provider: "google_password_manager",
          source: "none",
        },
      }),
    );
    const confirmed = admitBrowserV1(
      policy,
      input({
        evidence: {
          engine: "alternative_engine_confirmed",
          region: "eu",
          provider: "google_password_manager",
          source: "device_lab_confirmed",
        },
      }),
    );
    expect(untrusted).toMatchObject({ engine: "unknown", region: "unknown", provider: "unknown" });
    expect(confirmed).toMatchObject({
      engine: "alternative_engine_confirmed",
      region: "eu",
      provider: "google_password_manager",
    });
  });

  test("collects only coarse probes and never invokes getUserMedia", async () => {
    let cameraCalls = 0;
    const result = await collectAdvisoryCapabilitiesV1({
      isSecureContext: true,
      visibilityState: "visible",
      publicKeyCredential: {
        isUserVerifyingPlatformAuthenticatorAvailable: async () => true,
        getClientCapabilities: async () => ({ conditionalCreate: true }),
        isConditionalMediationAvailable: async () => false,
      },
      mediaDevices: {
        getUserMedia: () => {
          cameraCalls += 1;
        },
      },
    });
    expect(result).toEqual({
      secureContext: true,
      webAuthnApi: "available",
      platformUv: "available",
      clientCapabilitiesApi: "available",
      conditionalMediation: "unavailable",
      mediaApi: "available",
      visibility: "visible",
    });
    expect(cameraCalls).toBe(0);
  });

  test("maps unavailable optional probes to unknown without raw exceptions", async () => {
    const result = await collectAdvisoryCapabilitiesV1({
      isSecureContext: true,
      publicKeyCredential: {
        isUserVerifyingPlatformAuthenticatorAvailable: async () => {
          throw new Error("sensitive raw detail");
        },
        getClientCapabilities: async () => {
          throw new Error("sensitive raw detail");
        },
      },
    });
    expect(result.platformUv).toBe("unknown");
    expect(result.clientCapabilitiesApi).toBe("unknown");
    expect(JSON.stringify(result)).not.toContain("sensitive raw detail");
  });
});

describe("safe external-browser handoff", () => {
  test("carries only validated opaque handles and requires a fresh challenge", () => {
    const handoff = createExternalBrowserHandoffV1("https://auth.example.test", {
      validation: "server_validated",
      transactionHandle: "transaction_ABC123",
      returnTargetHandle: "return_target_ABC123",
    });
    expect(handoff).toEqual({
      version: "browser_admission_v1",
      href:
        "https://auth.example.test/continue?transaction=transaction_ABC123&return_target=return_target_ABC123",
      carries: "validated_opaque_handles_only",
      challengeAction: "invalidate_and_reissue_after_navigation",
    });
  });

  test("rejects non-canonical origins and URL-shaped return targets", () => {
    expect(() =>
      createExternalBrowserHandoffV1("http://auth.example.test", {
        validation: "server_validated",
        transactionHandle: "transaction_ABC123",
        returnTargetHandle: "return_target_ABC123",
      }),
    ).toThrow();
    expect(() =>
      createExternalBrowserHandoffV1("https://auth.example.test", {
        validation: "server_validated",
        transactionHandle: "transaction_ABC123",
        returnTargetHandle: "https://evil.example/",
      }),
    ).toThrow();
  });

  test("capability decisions contain no credential, media, or secret state", () => {
    const result = admitBrowserV1(policy, input());
    const keys = Object.keys(result).concat(Object.keys(result.capabilities));
    expect(keys).not.toContain("credentialId");
    expect(keys).not.toContain("prfOutput");
    expect(keys).not.toContain("privateKey");
    expect(keys).not.toContain("seed32");
    expect(keys).not.toContain("cameraStream");
    expect(keys).not.toContain("mediaBytes");
    expect(keys).not.toContain("userAgent");
    expect(keys).not.toContain("exception");
  });
});
