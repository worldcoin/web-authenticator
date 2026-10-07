import {
  BIOMETRIC_SIMULATOR_AUDIENCE_V0,
  SIMULATED_STAGING_AUDIENCE_V0,
  STAGING_ISSUANCE_SIMULATOR_AUDIENCE_V0,
  canonicalizeJsonV0,
  type BiometricSimulationScenarioV0,
  type IssuanceSimulationScenarioV0,
} from "@clean-start/contracts";
import {
  SessionGatewayV0,
  sha256Text,
  type BrowserCeremonyVerifierV0,
  type RpRequestVerifierV0,
  type ServerScenarioSelectorV0,
} from "@clean-start/session-gateway";
import { SimulatedBiometricVerifierV0 } from "@clean-start/simulated-biometric-verifier";
import { SimulatedStagingIssuerV0 } from "@clean-start/simulated-staging-issuer";
import { AUTHENTICATOR_APP_CONFIG } from "@clean-start/app-config";
import { RealSimulatorBrowserSessionServiceV0 } from "./browser-session-service.server";
import {
  StagingDemoAuthenticatorServiceV0,
  isDemoCompletionCeremonyV0,
  type StagingDemoAuthenticatorOutcomeV0,
} from "./demo-authenticator.server";
import {
  assertPurposeKeySeparationV0,
  createPurposeEd25519KeyV0,
  createSessionHandleHmacKeyV0,
} from "./crypto.server";

export const AUTHENTICATOR_SERVER_TEST_CONFIGURATION_V0 =
  "authenticator_server_test_configuration_v0" as const;
export const DEMO_COMPLETION_AUDIENCE_V0 =
  "world_id_web_authenticator_demo_completion_staging" as const;

export interface AuthenticatorServerTestConfigurationV0 {
  readonly kind: typeof AUTHENTICATOR_SERVER_TEST_CONFIGURATION_V0;
  readonly biometricScenario: BiometricSimulationScenarioV0;
  readonly issuanceScenario: IssuanceSimulationScenarioV0;
  readonly demoAuthenticatorOutcome?: StagingDemoAuthenticatorOutcomeV0;
}

export interface AuthenticatorServerRuntimeV0 {
  readonly browserPort: RealSimulatorBrowserSessionServiceV0;
  readonly keyReadiness: {
    readonly ed25519PublicFingerprints: readonly string[];
    readonly handleKeyAlgorithm: "HMAC";
  };
}

function isServerTestConfigurationV0(
  value: unknown,
): value is AuthenticatorServerTestConfigurationV0 {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const keys = Object.keys(value).sort().join(",");
  return (keys === "biometricScenario,issuanceScenario,kind" ||
    keys === "biometricScenario,demoAuthenticatorOutcome,issuanceScenario,kind") &&
    (value as { readonly kind?: unknown }).kind === AUTHENTICATOR_SERVER_TEST_CONFIGURATION_V0 &&
    ["happy_path", "spoof_reject", "capture_retry", "dependency_unavailable"].includes(
      String((value as { readonly biometricScenario?: unknown }).biometricScenario),
    ) &&
    ["issue_success", "issue_reject", "issue_unavailable"].includes(
      String((value as { readonly issuanceScenario?: unknown }).issuanceScenario),
    ) &&
    (!("demoAuthenticatorOutcome" in value) ||
      ["ready", "unavailable", "invalid_response"].includes(
        String((value as { readonly demoAuthenticatorOutcome?: unknown })
          .demoAuthenticatorOutcome),
      ));
}

export async function createAuthenticatorServerRuntimeV0(
  options: { readonly testConfiguration?: AuthenticatorServerTestConfigurationV0 } = {},
): Promise<AuthenticatorServerRuntimeV0> {
  if (
    options.testConfiguration !== undefined &&
    !isServerTestConfigurationV0(options.testConfiguration)
  ) {
    throw new TypeError("invalid_server_test_configuration_v0");
  }
  const biometricScenario = options.testConfiguration?.biometricScenario ??
    AUTHENTICATOR_APP_CONFIG.defaultBiometricScenario;
  const issuanceScenario = options.testConfiguration?.issuanceScenario ??
    AUTHENTICATOR_APP_CONFIG.defaultIssuanceScenario;

  const [
    biometricRequestKey,
    biometricReceiptKey,
    issuanceRequestKey,
    simulatedCredentialKey,
    demoCompletionKey,
    handleKey,
  ] = await Promise.all([
    createPurposeEd25519KeyV0(
      AUTHENTICATOR_APP_CONFIG.purposeKeyIds.biometricRequest,
      BIOMETRIC_SIMULATOR_AUDIENCE_V0,
    ),
    createPurposeEd25519KeyV0(
      AUTHENTICATOR_APP_CONFIG.purposeKeyIds.biometricReceipt,
      BIOMETRIC_SIMULATOR_AUDIENCE_V0,
    ),
    createPurposeEd25519KeyV0(
      AUTHENTICATOR_APP_CONFIG.purposeKeyIds.issuanceRequest,
      STAGING_ISSUANCE_SIMULATOR_AUDIENCE_V0,
    ),
    createPurposeEd25519KeyV0(
      AUTHENTICATOR_APP_CONFIG.purposeKeyIds.simulatedCredential,
      SIMULATED_STAGING_AUDIENCE_V0,
    ),
    createPurposeEd25519KeyV0(
      AUTHENTICATOR_APP_CONFIG.purposeKeyIds.demoCompletion,
      DEMO_COMPLETION_AUDIENCE_V0,
    ),
    createSessionHandleHmacKeyV0(),
  ]);
  const purposeKeys = Object.freeze([
    biometricRequestKey,
    biometricReceiptKey,
    issuanceRequestKey,
    simulatedCredentialKey,
    demoCompletionKey,
  ]);
  assertPurposeKeySeparationV0(purposeKeys, handleKey);

  const now = (): Date => new Date();
  const demoAuthenticator = new StagingDemoAuthenticatorServiceV0(
    demoCompletionKey,
    AUTHENTICATOR_APP_CONFIG.demoCompletionTtlMs,
    now,
    options.testConfiguration?.demoAuthenticatorOutcome ?? "ready",
  );

  const biometricVerifier = new SimulatedBiometricVerifierV0({
    runtimeEnvironment: "staging",
    gatewayTrustRoot: biometricRequestKey.trustRoot,
    receiptSigner: {
      environment: "staging",
      audience: BIOMETRIC_SIMULATOR_AUDIENCE_V0,
      keyId: biometricReceiptKey.keyId,
      privateKey: biometricReceiptKey.privateKey,
    },
    simulatorVersion: AUTHENTICATOR_APP_CONFIG.biometricSimulatorVersion,
    receiptTtlMs: AUTHENTICATOR_APP_CONFIG.biometricReceiptTtlMs,
    maxCacheEntries: AUTHENTICATOR_APP_CONFIG.biometricCacheEntries,
    allowedSyntheticFixtureIds: AUTHENTICATOR_APP_CONFIG.allowedSyntheticFixtureIds,
    now,
  });
  const stagingIssuer = new SimulatedStagingIssuerV0({
    runtimeEnvironment: "staging",
    gatewayTrustRoot: issuanceRequestKey.trustRoot,
    biometricReceiptTrustRoot: biometricReceiptKey.trustRoot,
    credentialSigner: {
      environment: "staging",
      audience: SIMULATED_STAGING_AUDIENCE_V0,
      keyId: simulatedCredentialKey.keyId,
      privateKey: simulatedCredentialKey.privateKey,
    },
    credentialTtlMs: AUTHENTICATOR_APP_CONFIG.stagingCredentialTtlMs,
    maxCacheEntries: AUTHENTICATOR_APP_CONFIG.issuanceCacheEntries,
    now,
  });

  const rpRequestVerifier: RpRequestVerifierV0 = {
    async verify(request, context) {
      if (
        context.origin !== AUTHENTICATOR_APP_CONFIG.publicOrigin ||
        context.rpId !== AUTHENTICATOR_APP_CONFIG.rpId ||
        typeof request !== "object" ||
        request === null ||
        Array.isArray(request) ||
        canonicalizeJsonV0(request) !== canonicalizeJsonV0({
          kind: "cs5_zoom_demo_request_v0",
          presentationId: "zoom_demo",
        })
      ) return null;
      return Object.freeze({
        rpId: AUTHENTICATOR_APP_CONFIG.rpId,
        origin: AUTHENTICATOR_APP_CONFIG.publicOrigin,
        returnTarget: "/returned",
        requestDigestSha256: await sha256Text(canonicalizeJsonV0(request)),
      });
    },
  };
  const ceremonyVerifier: BrowserCeremonyVerifierV0 = {
    async verify(ceremony, expected) {
      return isDemoCompletionCeremonyV0(ceremony) &&
        ceremony.sessionId === expected.sessionId &&
        ceremony.accountPublicMaterialDigestSha256 ===
          expected.accountPublicMaterialDigestSha256 &&
        demoAuthenticator.verifyCompletion(ceremony);
    },
  };
  const scenarioSelector: ServerScenarioSelectorV0 = {
    async select(_input) {
      return Object.freeze({ biometric: biometricScenario, issuance: issuanceScenario });
    },
  };

  const gateway = new SessionGatewayV0({
    runtimeEnvironment: AUTHENTICATOR_APP_CONFIG.runtimeEnvironment,
    enabled: AUTHENTICATOR_APP_CONFIG.gatewayEnabled,
    sessionTtlMs: AUTHENTICATOR_APP_CONFIG.sessionTtlMs,
    maxRequestBodyBytes: AUTHENTICATOR_APP_CONFIG.maxRequestBodyBytes,
    maxConcurrentOperations: AUTHENTICATOR_APP_CONFIG.maxConcurrentOperations,
    simulatorTimeoutMs: AUTHENTICATOR_APP_CONFIG.simulatorTimeoutMs,
    capturePolicy: AUTHENTICATOR_APP_CONFIG.capturePolicy,
    allowedSyntheticFixtureIds: AUTHENTICATOR_APP_CONFIG.allowedSyntheticFixtureIds,
    handleKey,
    rpRequestVerifier,
    ceremonyVerifier,
    scenarioSelector,
    biometricRequestSigner: biometricRequestKey,
    issuanceRequestSigner: issuanceRequestKey,
    biometricReceiptTrustRoot: biometricReceiptKey.trustRoot,
    simulatedCredentialTrustRoot: simulatedCredentialKey.trustRoot,
    biometricClient: biometricVerifier,
    issuanceClient: stagingIssuer,
    clock: { now },
  });
  const readiness = await gateway.readiness();
  if (!readiness.ready || !demoAuthenticator.readiness()) {
    throw new TypeError("authenticator_server_not_ready");
  }

  return Object.freeze({
    browserPort: new RealSimulatorBrowserSessionServiceV0(gateway, demoAuthenticator),
    keyReadiness: Object.freeze({
      ed25519PublicFingerprints: Object.freeze(
        purposeKeys.map((key) => key.publicKeyFingerprintHex),
      ),
      handleKeyAlgorithm: "HMAC" as const,
    }),
  });
}
