import {
  admitBrowserV1,
  classifyIPhoneUserAgentV1,
  collectAdvisoryCapabilitiesV1,
  createExternalBrowserHandoffV1,
  type BrowserAdmissionDecisionV1,
  type BrowserAdmissionInputV1,
  type BrowserContextKindV1,
  type EmbeddedEvidenceV1,
  type ValidatedHandoffContextV1,
} from "@clean-start/browser-admission";
import {
  PRF_INPUT_V1_SHA256,
  WEB_AUTHN_PRF_AUTHENTICATOR_V1,
  type WebAuthnPrfAuthenticatorPolicyV1,
} from "@clean-start/contracts";

export interface BrowserAdmissionAdapterV1 {
  evaluate(signal?: AbortSignal): Promise<BrowserAdmissionDecisionV1>;
  openExternalBrowser(signal?: AbortSignal): Promise<void>;
}

export function evaluateBrowserAdmissionFactsV1(
  policy: WebAuthnPrfAuthenticatorPolicyV1,
  input: BrowserAdmissionInputV1,
): BrowserAdmissionDecisionV1 {
  return admitBrowserV1(policy, input);
}

function embeddedEvidence(userAgent: string): EmbeddedEvidenceV1 {
  return /\b(FBAN|FBAV|Instagram|Line|MicroMessenger|GSA|TikTok)\b/i.test(userAgent)
    ? "probable"
    : "none";
}

function topLevelContext(): {
  readonly isTopLevel: boolean;
  readonly frameOrigin: "same_origin" | "cross_origin" | "unknown";
} {
  try {
    if (window.top === window.self) return { isTopLevel: true, frameOrigin: "same_origin" };
    try {
      return {
        isTopLevel: false,
        frameOrigin: window.top?.location.origin === window.location.origin
          ? "same_origin"
          : "cross_origin",
      };
    } catch {
      return { isTopLevel: false, frameOrigin: "cross_origin" };
    }
  } catch {
    return { isTopLevel: false, frameOrigin: "unknown" };
  }
}

function browserContext(userAgent: string): BrowserContextKindV1 {
  const standalone = window.matchMedia?.("(display-mode: standalone)").matches ||
    (navigator as Navigator & { readonly standalone?: boolean }).standalone === true;
  if (standalone) return "installed_pwa";
  if (embeddedEvidence(userAgent) !== "none") return "embedded";
  return "normal_tab";
}

function cameraPermissionsPolicy(): "allowed" | "blocked" | "unknown" {
  const documentWithPolicy = document as Document & {
    readonly permissionsPolicy?: { allowsFeature(name: string): boolean };
    readonly featurePolicy?: { allowsFeature(name: string): boolean };
  };
  const policy = documentWithPolicy.permissionsPolicy ?? documentWithPolicy.featurePolicy;
  if (policy === undefined) return "unknown";
  try {
    return policy.allowsFeature("camera") ? "allowed" : "blocked";
  } catch {
    return "unknown";
  }
}

function defaultPolicy(): WebAuthnPrfAuthenticatorPolicyV1 {
  const secureHttpsOrigin = window.location.protocol === "https:" ? window.location.origin : null;
  return Object.freeze({
    version: WEB_AUTHN_PRF_AUTHENTICATOR_V1,
    rpId: window.location.hostname,
    allowedOrigins: Object.freeze(secureHttpsOrigin === null ? [] : [secureHttpsOrigin]),
    userVerification: "required",
    prfInputSha256: PRF_INPUT_V1_SHA256,
    prfOutputMapping: "verbatim_32_byte_first_result_to_world_id_4_signer_seed",
    secretLifecycle: "browser_memory_only",
  });
}

export function createBrowserAdmissionAdapterV1(options: {
  readonly policy?: WebAuthnPrfAuthenticatorPolicyV1;
  readonly handoffContext?: ValidatedHandoffContextV1;
  readonly assignLocation?: (href: string) => void;
} = {}): BrowserAdmissionAdapterV1 {
  return {
    async evaluate(signal?: AbortSignal): Promise<BrowserAdmissionDecisionV1> {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      const userAgent = navigator.userAgent;
      const capabilities = await collectAdvisoryCapabilitiesV1({
        isSecureContext: window.isSecureContext,
        visibilityState: document.visibilityState,
        publicKeyCredential: typeof PublicKeyCredential === "undefined"
          ? undefined
          : PublicKeyCredential,
        mediaDevices: navigator.mediaDevices,
      });
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      const frame = topLevelContext();
      return admitBrowserV1(options.policy ?? defaultPolicy(), {
        actualOrigin: window.location.origin,
        isTopLevel: frame.isTopLevel,
        frameOrigin: frame.frameOrigin,
        permissionsPolicy: cameraPermissionsPolicy(),
        requestContext: {
          transactionHandle: "validated",
          returnTarget: "validated",
          session: "approved",
          unexpectedQueryFields: window.location.search.length > 0,
        },
        platform: classifyIPhoneUserAgentV1(userAgent),
        browserContext: browserContext(userAgent),
        embeddedEvidence: embeddedEvidence(userAgent),
        capabilities,
      });
    },

    async openExternalBrowser(signal?: AbortSignal): Promise<void> {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      if (options.handoffContext === undefined || window.location.protocol !== "https:") {
        throw new TypeError("validated_handoff_unavailable");
      }
      const handoff = createExternalBrowserHandoffV1(
        window.location.origin,
        options.handoffContext,
      );
      (options.assignLocation ?? ((href) => window.location.assign(href)))(handoff.href);
    },
  };
}
