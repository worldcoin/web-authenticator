import {
  PRF_INPUT_V1_SHA256,
  WEB_AUTHN_PRF_AUTHENTICATOR_V1,
  type WebAuthnPrfAuthenticatorPolicyV1,
} from "../../contracts/src";
import { iosVersionBandV1 } from "./platform";
import {
  BROWSER_ADMISSION_V1,
  type BrowserAdmissionDecisionV1,
  type BrowserAdmissionInputV1,
  type BrowserAdmissionOutcomeV1,
  type BrowserAdmissionReasonV1,
  type TrustedEvidenceDimensionsV1,
} from "./types";

const UNKNOWN_EVIDENCE: TrustedEvidenceDimensionsV1 = {
  engine: "unknown",
  region: "unknown",
  provider: "unknown",
  source: "none",
};

const SAFE_INTERNAL_ERROR_DECISION_V1: BrowserAdmissionDecisionV1 = Object.freeze({
  version: BROWSER_ADMISSION_V1,
  outcome: "internal_error",
  reason: "safe_internal_error",
  mayStartSensitiveFlow: false,
  browser: "unknown",
  iosVersionBand: "unknown",
  context: "unknown",
  engine: "unknown",
  region: "unknown",
  provider: "unknown",
  capabilities: Object.freeze({
    webAuthnApi: "unknown",
    platformUv: "unknown",
    clientCapabilitiesApi: "unknown",
    conditionalMediation: "unknown",
    mediaApi: "unknown",
    visibility: "unknown",
  }),
});

function evidenceOrUnknown(
  evidence: TrustedEvidenceDimensionsV1 | undefined,
): TrustedEvidenceDimensionsV1 {
  if (!evidence || evidence.source === "none") return UNKNOWN_EVIDENCE;
  return evidence;
}

function decision(
  input: BrowserAdmissionInputV1,
  outcome: BrowserAdmissionOutcomeV1,
  reason: BrowserAdmissionReasonV1,
): BrowserAdmissionDecisionV1 {
  const evidence = evidenceOrUnknown(input.evidence);
  return {
    version: BROWSER_ADMISSION_V1,
    outcome,
    reason,
    mayStartSensitiveFlow: outcome === "eligible_candidate",
    browser: input.platform.browser,
    iosVersionBand: iosVersionBandV1(input.platform.iosMajor),
    context: input.browserContext,
    engine: evidence.engine,
    region: evidence.region,
    provider: evidence.provider,
    capabilities: {
      webAuthnApi: input.capabilities.webAuthnApi,
      platformUv: input.capabilities.platformUv,
      clientCapabilitiesApi: input.capabilities.clientCapabilitiesApi,
      conditionalMediation: input.capabilities.conditionalMediation,
      mediaApi: input.capabilities.mediaApi,
      visibility: input.capabilities.visibility,
    },
  };
}

function canonicalHttpsOrigin(value: string): URL | null {
  try {
    const parsed = new URL(value);
    if (
      parsed.protocol !== "https:" ||
      parsed.username !== "" ||
      parsed.password !== "" ||
      parsed.origin !== value
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function rpIdMatchesHostname(rpId: string, hostname: string): boolean {
  const normalized = rpId.toLowerCase();
  if (
    normalized !== rpId ||
    normalized.length === 0 ||
    normalized.startsWith(".") ||
    normalized.endsWith(".") ||
    normalized.includes(":")
  ) {
    return false;
  }
  return hostname === normalized || hostname.endsWith(`.${normalized}`);
}

function invalidRequestContext(input: BrowserAdmissionInputV1): boolean {
  return (
    input.requestContext.transactionHandle !== "validated" ||
    input.requestContext.returnTarget !== "validated" ||
    input.requestContext.session !== "approved" ||
    input.requestContext.unexpectedQueryFields
  );
}

function hasFrozenAuthenticatorPolicy(
  policy: WebAuthnPrfAuthenticatorPolicyV1,
): boolean {
  return (
    policy.version === WEB_AUTHN_PRF_AUTHENTICATOR_V1 &&
    policy.userVerification === "required" &&
    policy.prfInputSha256 === PRF_INPUT_V1_SHA256 &&
    policy.prfOutputMapping === "verbatim_32_byte_first_result_to_world_id_4_signer_seed" &&
    policy.secretLifecycle === "browser_memory_only" &&
    Array.isArray(policy.allowedOrigins)
  );
}

export function admitBrowserV1(
  policy: WebAuthnPrfAuthenticatorPolicyV1,
  input: BrowserAdmissionInputV1,
): BrowserAdmissionDecisionV1 {
  try {
    if (!hasFrozenAuthenticatorPolicy(policy)) {
      return decision(input, "origin_or_rp_invalid", "authenticator_policy_invalid");
    }
    if (!input.capabilities.secureContext) {
      return decision(input, "insecure_context", "secure_context_required");
    }

    const actualOrigin = canonicalHttpsOrigin(input.actualOrigin);
    if (!actualOrigin) return decision(input, "origin_or_rp_invalid", "origin_invalid");
    if (!policy.allowedOrigins.includes(input.actualOrigin)) {
      return decision(input, "origin_or_rp_invalid", "origin_not_allowed");
    }
    if (!rpIdMatchesHostname(policy.rpId, actualOrigin.hostname)) {
      return decision(input, "origin_or_rp_invalid", "rp_id_invalid");
    }
    if (input.permissionsPolicy !== "allowed") {
      return decision(
        input,
        "origin_or_rp_invalid",
        "permissions_policy_blocked_or_unknown",
      );
    }
    if (invalidRequestContext(input)) {
      return decision(input, "origin_or_rp_invalid", "request_context_invalid");
    }

    if (!input.isTopLevel || input.frameOrigin === "cross_origin") {
      return decision(
        input,
        "context_not_top_level",
        input.frameOrigin === "cross_origin" ? "cross_origin_frame" : "document_is_framed",
      );
    }
    if (
      input.browserContext === "embedded" ||
      input.embeddedEvidence === "confirmed" ||
      input.embeddedEvidence === "probable"
    ) {
      return decision(
        input,
        "embedded_browser_handoff",
        "embedded_context_requires_handoff",
      );
    }
    if (input.interrupted) {
      return decision(input, "interrupted", "caller_interrupted");
    }
    if (input.capabilities.visibility !== "visible") {
      return decision(input, "interrupted", "document_not_visible");
    }
    if (input.platform.device !== "iphone") {
      return decision(input, "unsupported", "iphone_required");
    }
    if (input.platform.browser !== "safari" && input.platform.browser !== "chrome") {
      return decision(input, "unsupported", "supported_browser_required");
    }

    if (input.browserContext === "private_or_unknown") {
      return decision(
        input,
        "private_or_unknown_context",
        "private_context_not_admitted",
      );
    }
    if (input.browserContext === "installed_pwa") {
      return decision(
        input,
        "private_or_unknown_context",
        "installed_context_not_admitted",
      );
    }
    if (input.browserContext !== "normal_tab") {
      return decision(input, "private_or_unknown_context", "context_unknown");
    }

    const versionBand = iosVersionBandV1(input.platform.iosMajor);
    if (versionBand === "ios_15_17") {
      return decision(input, "ios_update_required", "ios_version_requires_update");
    }
    if (versionBand !== "ios_18_plus") {
      return decision(input, "unsupported", "ios_version_unknown_or_unsupported");
    }

    if (input.capabilities.webAuthnApi === "unavailable") {
      return decision(input, "unsupported", "webauthn_api_unavailable");
    }
    if (input.capabilities.platformUv === "unavailable") {
      return decision(input, "uv_unavailable", "platform_uv_unavailable");
    }
    if (input.capabilities.mediaApi === "unavailable") {
      return decision(input, "unsupported", "media_api_unavailable");
    }

    return decision(input, "eligible_candidate", "candidate_only_ceremony_required");
  } catch {
    return SAFE_INTERNAL_ERROR_DECISION_V1;
  }
}
