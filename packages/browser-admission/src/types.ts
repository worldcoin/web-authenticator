export const BROWSER_ADMISSION_V1 = "browser_admission_v1" as const;

export const BROWSER_ADMISSION_OUTCOMES_V1 = [
  "eligible_candidate",
  "ios_update_required",
  "embedded_browser_handoff",
  "context_not_top_level",
  "insecure_context",
  "origin_or_rp_invalid",
  "uv_unavailable",
  "private_or_unknown_context",
  "interrupted",
  "unsupported",
  "internal_error",
] as const;

export type BrowserAdmissionOutcomeV1 = (typeof BROWSER_ADMISSION_OUTCOMES_V1)[number];

export type BrowserFamilyV1 = "safari" | "chrome" | "other" | "unknown";
export type DeviceClassV1 = "iphone" | "other" | "unknown";
export type IosVersionBandV1 = "ios_15_17" | "ios_18_plus" | "other" | "unknown";
export type BrowserContextKindV1 =
  | "normal_tab"
  | "private_or_unknown"
  | "installed_pwa"
  | "embedded"
  | "unknown";
export type EmbeddedEvidenceV1 = "confirmed" | "probable" | "none" | "unknown";
export type AvailabilityV1 = "available" | "unavailable" | "unknown";
export type VisibilityV1 = "visible" | "hidden" | "prerender" | "unknown";
export type EngineClassV1 = "webkit_family" | "alternative_engine_confirmed" | "unknown";
export type RegionClassV1 = "eu" | "japan" | "other" | "unknown";
export type ProviderClassV1 =
  | "apple_passwords"
  | "google_password_manager"
  | "third_party"
  | "unknown";

export type BrowserAdmissionReasonV1 =
  | "candidate_only_ceremony_required"
  | "ios_version_requires_update"
  | "embedded_context_requires_handoff"
  | "document_is_framed"
  | "cross_origin_frame"
  | "secure_context_required"
  | "origin_invalid"
  | "origin_not_allowed"
  | "rp_id_invalid"
  | "authenticator_policy_invalid"
  | "permissions_policy_blocked_or_unknown"
  | "request_context_invalid"
  | "platform_uv_unavailable"
  | "private_context_not_admitted"
  | "installed_context_not_admitted"
  | "context_unknown"
  | "document_not_visible"
  | "iphone_required"
  | "supported_browser_required"
  | "ios_version_unknown_or_unsupported"
  | "webauthn_api_unavailable"
  | "media_api_unavailable"
  | "caller_interrupted"
  | "safe_internal_error";

export interface DetectedIPhonePlatformV1 {
  readonly device: DeviceClassV1;
  readonly iosMajor: number | null;
  readonly browser: BrowserFamilyV1;
}

export interface AdvisoryCapabilitiesV1 {
  readonly secureContext: boolean;
  readonly webAuthnApi: AvailabilityV1;
  readonly platformUv: AvailabilityV1;
  readonly clientCapabilitiesApi: AvailabilityV1;
  readonly conditionalMediation: AvailabilityV1;
  readonly mediaApi: AvailabilityV1;
  readonly visibility: VisibilityV1;
}

export interface TrustedEvidenceDimensionsV1 {
  readonly engine: EngineClassV1;
  readonly region: RegionClassV1;
  readonly provider: ProviderClassV1;
  readonly source: "trusted_platform_api" | "device_lab_confirmed" | "none";
}

export interface RequestContextStatusV1 {
  readonly transactionHandle: "validated" | "missing" | "invalid";
  readonly returnTarget: "validated" | "missing" | "invalid";
  readonly session: "approved" | "missing" | "invalid";
  readonly unexpectedQueryFields: boolean;
}

export interface BrowserAdmissionInputV1 {
  readonly actualOrigin: string;
  readonly isTopLevel: boolean;
  readonly frameOrigin: "same_origin" | "cross_origin" | "unknown";
  readonly permissionsPolicy: "allowed" | "blocked" | "unknown";
  readonly requestContext: RequestContextStatusV1;
  readonly platform: DetectedIPhonePlatformV1;
  readonly browserContext: BrowserContextKindV1;
  readonly embeddedEvidence: EmbeddedEvidenceV1;
  readonly capabilities: AdvisoryCapabilitiesV1;
  readonly evidence?: TrustedEvidenceDimensionsV1;
  readonly interrupted?: boolean;
}

export interface BrowserAdmissionCapabilitySummaryV1 {
  readonly webAuthnApi: AvailabilityV1;
  readonly platformUv: AvailabilityV1;
  readonly clientCapabilitiesApi: AvailabilityV1;
  readonly conditionalMediation: AvailabilityV1;
  readonly mediaApi: AvailabilityV1;
  readonly visibility: VisibilityV1;
}

export interface BrowserAdmissionDecisionV1 {
  readonly version: typeof BROWSER_ADMISSION_V1;
  readonly outcome: BrowserAdmissionOutcomeV1;
  readonly reason: BrowserAdmissionReasonV1;
  readonly mayStartSensitiveFlow: boolean;
  readonly browser: BrowserFamilyV1;
  readonly iosVersionBand: IosVersionBandV1;
  readonly context: BrowserContextKindV1;
  readonly engine: EngineClassV1;
  readonly region: RegionClassV1;
  readonly provider: ProviderClassV1;
  readonly capabilities: BrowserAdmissionCapabilitySummaryV1;
}

export interface BrowserProbeRuntimeV1 {
  readonly isSecureContext: boolean;
  readonly visibilityState?: string;
  readonly publicKeyCredential?: {
    readonly isUserVerifyingPlatformAuthenticatorAvailable?: () => Promise<boolean>;
    readonly getClientCapabilities?: () => Promise<Readonly<Record<string, boolean>>>;
    readonly isConditionalMediationAvailable?: () => Promise<boolean>;
  };
  readonly mediaDevices?: {
    readonly getUserMedia?: unknown;
  };
}

export interface ValidatedHandoffContextV1 {
  readonly validation: "server_validated";
  readonly transactionHandle: string;
  readonly returnTargetHandle: string;
}

export interface ExternalBrowserHandoffV1 {
  readonly version: typeof BROWSER_ADMISSION_V1;
  readonly href: string;
  readonly carries: "validated_opaque_handles_only";
  readonly challengeAction: "invalidate_and_reissue_after_navigation";
}
