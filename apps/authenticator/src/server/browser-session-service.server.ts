import {
  SIMULATED_WORKFLOW_ARTIFACT_SUMMARY_V0,
  SIMULATION_ENVIRONMENT,
  SIMULATION_MODE,
  SIMULATOR_BROWSER_DEMO_AUTHENTICATOR_READY_V0,
  SIMULATOR_BROWSER_RETURN_ACCEPTED_V0,
  SIMULATOR_BROWSER_SESSION_ERROR_V0,
  SIMULATOR_BROWSER_SESSION_PORT_V0,
  SIMULATOR_BROWSER_SESSION_VIEW_V0,
  SIMULATOR_UI_BOOTSTRAP_V0,
  isBrowserIdempotentSessionFieldsV0,
  isBrowserSessionFieldsV0,
  isCompleteDemoAuthenticatorV0,
  isCreateSimulatorBrowserSessionV0,
  isSubmitSimulatorCaptureShapeV0,
  type InjectedAuthenticatorResultV0,
  type EnrollmentSessionStateV2,
  type SimulatorBrowserDemoAuthenticatorResultV0,
  type SimulatorBrowserBootstrapResultV0,
  type SimulatorBrowserReturnResultV0,
  type SimulatorBrowserSessionErrorCodeV0,
  type SimulatorBrowserSessionOperationV0,
  type SimulatorBrowserSessionPortV0,
  type SimulatorBrowserSessionResultV0,
  type SimulatorBrowserSessionViewV0,
} from "@clean-start/contracts";
import {
  GatewayErrorV0,
  SessionGatewayV0,
  sha256Text,
  type CreateSessionResultV0,
  type RequestContextV0,
  type SessionStatusV0,
  type SubmitCaptureResultV0,
} from "@clean-start/session-gateway";
import { AUTHENTICATOR_APP_CONFIG } from "@clean-start/app-config";
import {
  STAGING_DEMO_AUTHENTICATOR_ERROR_V0,
  STAGING_DEMO_AUTHENTICATOR_READY_V0,
} from "@clean-start/contracts";
import {
  StagingDemoAuthenticatorServiceV0,
  makeInjectedAuthenticatorRequestV0,
} from "./demo-authenticator.server";

const FIXED_RP_REQUEST = Object.freeze({
  kind: "cs5_zoom_demo_request_v0",
  presentationId: "zoom_demo",
});

const FIXED_CONTEXT: RequestContextV0 = Object.freeze({
  origin: AUTHENTICATOR_APP_CONFIG.publicOrigin,
  rpId: AUTHENTICATOR_APP_CONFIG.rpId,
  authenticatedServerContext: Object.freeze({ kind: "server_selected_scenario_v0" }),
});

const ARTIFACT_SUMMARY = Object.freeze({
  kind: SIMULATED_WORKFLOW_ARTIFACT_SUMMARY_V0,
  biometricVerification: "not_performed",
  uniqueness: "not_performed",
  credentialClass: "not_selfie_check",
  productionCredential: false,
} as const);

const RETURN_TERMINAL_STATES = new Set<EnrollmentSessionStateV2>([
  "simulated_reject",
  "simulated_issuance_reject",
  "simulated_credential_ready",
  "cancelled",
] as const);

function error(
  operation: SimulatorBrowserSessionOperationV0,
  reasonCode: SimulatorBrowserSessionErrorCodeV0,
): SimulatorBrowserSessionResultV0 & { readonly kind: typeof SIMULATOR_BROWSER_SESSION_ERROR_V0 } {
  return Object.freeze({
    kind: SIMULATOR_BROWSER_SESSION_ERROR_V0,
    version: SIMULATOR_BROWSER_SESSION_PORT_V0,
    mode: SIMULATION_MODE,
    environment: SIMULATION_ENVIRONMENT,
    operation,
    reasonCode,
  });
}

function mapError(
  operation: SimulatorBrowserSessionOperationV0,
  value: unknown,
): ReturnType<typeof error> {
  if (value instanceof GatewayErrorV0) return error(operation, value.code);
  return error(operation, "response_invalid");
}

function isSafeCredentialResult(
  result: SubmitCaptureResultV0,
): boolean {
  return result.session.state !== "simulated_credential_ready" ||
    (result.credential?.claims.biometricVerification === "simulated_not_performed" &&
      result.credential.claims.uniqueness === "not_performed" &&
      result.credential.claims.credentialClass === "not_selfie_check");
}

export class RealSimulatorBrowserSessionServiceV0 implements SimulatorBrowserSessionPortV0 {
  readonly #artifactReady = new Set<string>();
  readonly #exitEligibleUntil = new Map<string, string>();

  constructor(
    private readonly gateway: SessionGatewayV0,
    private readonly demoAuthenticator: StagingDemoAuthenticatorServiceV0,
  ) {}

  async bootstrap(): Promise<SimulatorBrowserBootstrapResultV0> {
    const readiness = await this.gateway.readiness();
    if (!readiness.ready || !this.demoAuthenticator.readiness()) {
      return error("bootstrap", "gateway_disabled");
    }
    return Object.freeze({
      kind: SIMULATOR_UI_BOOTSTRAP_V0,
      version: SIMULATOR_BROWSER_SESSION_PORT_V0,
      mode: SIMULATION_MODE,
      environment: SIMULATION_ENVIRONMENT,
      rpPresentationId: "zoom_demo",
      accountPublicMaterialDigestSha256:
        AUTHENTICATOR_APP_CONFIG.demoAccountPublicMaterialDigestSha256,
      returnAction: "server_managed",
      authenticator: Object.freeze({
        kind: "injected_demo_only",
        webauthnPerformed: false,
        prfEvaluated: false,
        worldIdCreated: false,
      }),
      qualityPolicy: AUTHENTICATOR_APP_CONFIG.qualityPolicy,
    });
  }

  async createSession(input: { readonly idempotencyKey: string }): Promise<SimulatorBrowserSessionResultV0> {
    if (!isCreateSimulatorBrowserSessionV0(input)) return error("create_session", "invalid_request");
    try {
      const result = await this.gateway.createSession({
        rpRequest: FIXED_RP_REQUEST,
        accountId: AUTHENTICATOR_APP_CONFIG.demoAccountId,
        accountPublicMaterialDigestSha256:
          AUTHENTICATOR_APP_CONFIG.demoAccountPublicMaterialDigestSha256,
        idempotencyKey: input.idempotencyKey,
      }, FIXED_CONTEXT);
      return this.project(result, result.browserHandle, result.capturePolicy);
    } catch (cause) {
      return mapError("create_session", cause);
    }
  }

  async beginDemoAuthenticator(input: {
    readonly sessionId: string;
    readonly browserHandle: string;
    readonly idempotencyKey: string;
  }): Promise<SimulatorBrowserDemoAuthenticatorResultV0> {
    if (!isBrowserIdempotentSessionFieldsV0(input)) {
      return error("begin_demo_authenticator", "invalid_request");
    }
    try {
      const status = await this.gateway.getStatus({
        sessionId: input.sessionId,
        browserHandle: input.browserHandle,
      }, FIXED_CONTEXT);
      if (status.session.state !== "created") {
        return error("begin_demo_authenticator", "invalid_state");
      }
      const requestId = `demo_req_${(await sha256Text(`${input.sessionId}\u0000${input.idempotencyKey}`)).slice(0, 32)}`;
      const result = await this.demoAuthenticator.begin(makeInjectedAuthenticatorRequestV0({
        requestId,
        sessionId: input.sessionId,
        idempotencyKey: input.idempotencyKey,
        accountPublicMaterialDigestSha256: status.session.accountPublicMaterialDigestSha256,
        requestedAt: new Date().toISOString(),
        expiresAt: status.session.expiresAt,
      }));
      return this.projectDemoResult(result, status.session.expiresAt);
    } catch (cause) {
      return mapError("begin_demo_authenticator", cause);
    }
  }

  async completeDemoAuthenticator(input: {
    readonly sessionId: string;
    readonly browserHandle: string;
    readonly idempotencyKey: string;
    readonly completionHandle: string;
  }): Promise<SimulatorBrowserSessionResultV0> {
    if (!isCompleteDemoAuthenticatorV0(input)) {
      return error("complete_demo_authenticator", "invalid_request");
    }
    try {
      const current = await this.gateway.getStatus({
        sessionId: input.sessionId,
        browserHandle: input.browserHandle,
      }, FIXED_CONTEXT);
      const ceremony = Object.freeze({
        kind: "staging_demo_completion_ceremony_v0" as const,
        completionHandle: input.completionHandle,
        sessionId: input.sessionId,
        idempotencyKey: input.idempotencyKey,
        accountPublicMaterialDigestSha256:
          current.session.accountPublicMaterialDigestSha256,
      });
      if (!(await this.demoAuthenticator.verifyCompletion(ceremony))) {
        return error("complete_demo_authenticator", "binding_mismatch");
      }
      const status = await this.gateway.completePasskey({
        sessionId: input.sessionId,
        browserHandle: input.browserHandle,
        idempotencyKey: input.idempotencyKey,
        ceremony,
      }, FIXED_CONTEXT);
      return this.project(status, input.browserHandle);
    } catch (cause) {
      return mapError("complete_demo_authenticator", cause);
    }
  }

  async prepareCapture(input: { readonly sessionId: string; readonly browserHandle: string }): Promise<SimulatorBrowserSessionResultV0> {
    if (!isBrowserSessionFieldsV0(input)) return error("prepare_capture", "invalid_request");
    try {
      const result = await this.gateway.prepareCapture(input, FIXED_CONTEXT);
      return this.project(result, input.browserHandle, result.capturePolicy);
    } catch (cause) {
      return mapError("prepare_capture", cause);
    }
  }

  async submitCapture(input: {
    readonly sessionId: string;
    readonly browserHandle: string;
    readonly idempotencyKey: string;
    readonly nonceBase64Url: string;
    readonly frameBundle: Parameters<SimulatorBrowserSessionPortV0["submitCapture"]>[0]["frameBundle"];
  }): Promise<SimulatorBrowserSessionResultV0> {
    if (!isSubmitSimulatorCaptureShapeV0(input)) {
      return error("submit_capture", "invalid_request");
    }
    try {
      const result = await this.gateway.submitCapture(input, FIXED_CONTEXT);
      if (!isSafeCredentialResult(result)) return error("submit_capture", "response_invalid");
      if (result.session.state === "simulated_credential_ready") {
        this.#artifactReady.add(result.session.sessionId);
      }
      return this.project(result, input.browserHandle);
    } catch (cause) {
      return mapError("submit_capture", cause);
    }
  }

  async retryUnavailable(input: {
    readonly sessionId: string;
    readonly browserHandle: string;
    readonly idempotencyKey: string;
  }): Promise<SimulatorBrowserSessionResultV0> {
    if (!isBrowserIdempotentSessionFieldsV0(input)) {
      return error("retry_unavailable", "invalid_request");
    }
    try {
      const result = await this.gateway.retryUnavailable(input, FIXED_CONTEXT);
      if (!isSafeCredentialResult(result)) return error("retry_unavailable", "response_invalid");
      if (result.session.state === "simulated_credential_ready") {
        this.#artifactReady.add(result.session.sessionId);
      }
      return this.project(result, input.browserHandle);
    } catch (cause) {
      return mapError("retry_unavailable", cause);
    }
  }

  async getStatus(input: { readonly sessionId: string; readonly browserHandle: string }): Promise<SimulatorBrowserSessionResultV0> {
    if (!isBrowserSessionFieldsV0(input)) return error("get_status", "invalid_request");
    try {
      return this.project(await this.gateway.getStatus(input, FIXED_CONTEXT), input.browserHandle);
    } catch (cause) {
      return mapError("get_status", cause);
    }
  }

  async cancel(input: { readonly sessionId: string; readonly browserHandle: string }): Promise<SimulatorBrowserSessionResultV0> {
    if (!isBrowserSessionFieldsV0(input)) return error("cancel", "invalid_request");
    try {
      return this.project(await this.gateway.cancel(input, FIXED_CONTEXT), input.browserHandle);
    } catch (cause) {
      return mapError("cancel", cause);
    }
  }

  async returnToRp(input: { readonly sessionId: string; readonly browserHandle: string }): Promise<SimulatorBrowserReturnResultV0> {
    if (!isBrowserSessionFieldsV0(input)) return error("return_to_rp", "invalid_request");
    try {
      const status = await this.gateway.getStatus(input, FIXED_CONTEXT);
      this.purgeExitEligibility();
      const serverObservedEarlyExit = status.session.state === "created" &&
        this.#exitEligibleUntil.get(status.session.sessionId) === status.session.expiresAt;
      if (
        !RETURN_TERMINAL_STATES.has(status.session.state) &&
        !serverObservedEarlyExit
      ) {
        return error("return_to_rp", "invalid_state");
      }
      return Object.freeze({
        kind: SIMULATOR_BROWSER_RETURN_ACCEPTED_V0,
        version: SIMULATOR_BROWSER_SESSION_PORT_V0,
        mode: SIMULATION_MODE,
        environment: SIMULATION_ENVIRONMENT,
        action: "server_managed",
      });
    } catch (cause) {
      return mapError("return_to_rp", cause);
    }
  }

  private projectDemoResult(
    result: InjectedAuthenticatorResultV0,
    sessionExpiresAt: string,
  ): SimulatorBrowserDemoAuthenticatorResultV0 {
    if (result.kind === STAGING_DEMO_AUTHENTICATOR_READY_V0) {
      return Object.freeze({
        kind: SIMULATOR_BROWSER_DEMO_AUTHENTICATOR_READY_V0,
        version: SIMULATOR_BROWSER_SESSION_PORT_V0,
        mode: SIMULATION_MODE,
        environment: SIMULATION_ENVIRONMENT,
        sessionId: result.sessionId,
        idempotencyKey: result.idempotencyKey,
        completionHandle: result.completionHandle,
        claims: result.claims,
        expiresAt: result.expiresAt,
      });
    }
    const reasonCode = result.kind === STAGING_DEMO_AUTHENTICATOR_ERROR_V0
      ? result.reasonCode === "unavailable"
        ? "demo_authenticator_unavailable"
        : result.reasonCode === "interrupted"
          ? "demo_authenticator_interrupted"
          : result.reasonCode === "user_non_completion"
            ? "user_non_completion"
            : result.reasonCode === "transport_failure"
              ? "network_unavailable"
              : "response_invalid"
      : "response_invalid";
    if (
      result.kind === STAGING_DEMO_AUTHENTICATOR_ERROR_V0 &&
      (result.reasonCode === "unavailable" || result.reasonCode === "invalid_response")
    ) {
      this.#exitEligibleUntil.set(result.sessionId, sessionExpiresAt);
    }
    return error("begin_demo_authenticator", reasonCode);
  }

  private project(
    result: SessionStatusV0 | CreateSessionResultV0 | SubmitCaptureResultV0,
    browserHandle: string,
    capturePolicy = Object.freeze({
      ...AUTHENTICATOR_APP_CONFIG.capturePolicy,
      expiresAt: result.session.expiresAt,
    }),
  ): SimulatorBrowserSessionViewV0 {
    if (
      result.session.state === "simulated_reject" ||
      result.session.state === "simulated_issuance_reject" ||
      result.session.state === "simulated_credential_ready" ||
      result.session.state === "cancelled"
    ) {
      this.#exitEligibleUntil.set(result.session.sessionId, result.session.expiresAt);
    }
    const artifactSummary = result.session.state === "simulated_credential_ready" &&
      this.#artifactReady.has(result.session.sessionId)
      ? ARTIFACT_SUMMARY
      : null;
    return Object.freeze({
      kind: SIMULATOR_BROWSER_SESSION_VIEW_V0,
      version: SIMULATOR_BROWSER_SESSION_PORT_V0,
      mode: SIMULATION_MODE,
      environment: SIMULATION_ENVIRONMENT,
      sessionId: result.session.sessionId,
      browserHandle,
      nonceBase64Url: result.session.nonceBase64Url,
      state: result.session.state,
      code: result.code,
      retryable: result.retryable,
      expiresAt: result.session.expiresAt,
      capturePolicy,
      artifactSummary,
    });
  }

  private purgeExitEligibility(): void {
    const nowMs = Date.now();
    for (const [sessionId, expiresAt] of this.#exitEligibleUntil) {
      if (Date.parse(expiresAt) <= nowMs) this.#exitEligibleUntil.delete(sessionId);
    }
  }
}

export { FIXED_CONTEXT as AUTHENTICATOR_GATEWAY_CONTEXT_V0, FIXED_RP_REQUEST as AUTHENTICATOR_FIXED_RP_REQUEST_V0 };
