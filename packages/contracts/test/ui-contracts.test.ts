import { describe, expect, test } from "bun:test";
import {
  AUTHENTICATOR_UI_ACTIONS_BY_STATE_V1,
  AUTHENTICATOR_UI_ACTIONS_V1,
  AUTHENTICATOR_UI_COPY_V1,
  AUTHENTICATOR_UI_DEFAULT_VISUAL_SOURCE_V1,
  AUTHENTICATOR_UI_DETAIL_CODES_V1,
  AUTHENTICATOR_UI_DETAIL_COPY_V1,
  AUTHENTICATOR_UI_EFFECTS_V1,
  AUTHENTICATOR_UI_EVENTS_V1,
  AUTHENTICATOR_UI_EVENT_V1,
  AUTHENTICATOR_UI_FLOW_V1,
  AUTHENTICATOR_UI_INITIAL_EFFECTS_V1,
  AUTHENTICATOR_UI_SNAPSHOT_V1,
  AUTHENTICATOR_UI_STAGING_BANNER_V1,
  AUTHENTICATOR_UI_STATES_V1,
  AUTHENTICATOR_UI_STATE_PROGRESS_V1,
  AUTHENTICATOR_UI_TERMINAL_STATES_V1,
  AUTHENTICATOR_UI_VISUAL_SOURCES_V1,
  ENROLLMENT_SESSION_ALLOWED_UI_STATES_V1,
  ENROLLMENT_SESSION_STATES_V2,
  ENROLLMENT_SESSION_TO_UI_STATE_V1,
  FRAME_BUNDLE_V0,
  FRAME_BUNDLE_V0_DIGEST_ALGORITHM,
  INJECTED_AUTHENTICATOR_PORT_V0,
  INJECTED_AUTHENTICATOR_REQUEST_V0,
  RP_PRESENTATION_IDS_V0,
  SIMULATED_WORKFLOW_ARTIFACT_SUMMARY_V0,
  SIMULATION_ENVIRONMENT,
  SIMULATION_MODE,
  SIMULATOR_BROWSER_DEMO_AUTHENTICATOR_READY_V0,
  SIMULATOR_BROWSER_RETURN_ACCEPTED_V0,
  SIMULATOR_BROWSER_SESSION_ERROR_CODES_V0,
  SIMULATOR_BROWSER_SESSION_ERROR_V0,
  SIMULATOR_BROWSER_SESSION_OPERATIONS_V0,
  SIMULATOR_BROWSER_SESSION_PORT_V0,
  SIMULATOR_BROWSER_SESSION_VIEW_V0,
  SIMULATOR_SESSION_STATUS_CODES_V0,
  SIMULATOR_UI_BOOTSTRAP_V0,
  SIMULATOR_UI_CAPTURE_POLICY_TEMPLATE_V0,
  SIMULATOR_UI_QUALITY_POLICY_V0,
  STAGING_DEMO_AUTHENTICATOR_ERROR_REASONS_V0,
  STAGING_DEMO_AUTHENTICATOR_ERROR_V0,
  STAGING_DEMO_AUTHENTICATOR_READY_V0,
  SimulationArtifactInProductionError,
  assertAuthenticatorUiEventAllowed,
  assertAuthenticatorUiSnapshotAllowed,
  assertSimulationArtifactAllowed,
  assertSimulatorBrowserArtifactAllowed,
  computeFrameBundleDigestV0,
  dispatchAuthenticatorUiActionV1,
  isAuthenticatorUiEventV1,
  isAuthenticatorUiSnapshotV1,
  isBrowserIdempotentSessionFieldsV0,
  isBrowserSessionFieldsV0,
  isCompleteDemoAuthenticatorV0,
  isCreateSimulatorBrowserSessionV0,
  isInjectedAuthenticatorRequestV0,
  isSimulatorBrowserDemoAuthenticatorReadyV0,
  isSimulatorBrowserReturnAcceptedV0,
  isSimulatorBrowserSessionErrorV0,
  isSimulatorBrowserSessionViewV0,
  isSimulatorUiBootstrapV0,
  isStagingDemoAuthenticatorErrorV0,
  isStagingDemoAuthenticatorReadyV0,
  isSubmitSimulatorCaptureShapeV0,
  makeAuthenticatorUiEventV1,
  makeAuthenticatorUiSnapshotV1,
  matchesExpectedSimulatorBrowserDemoAuthenticatorReadyV0,
  matchesExpectedSimulatorBrowserSessionViewV0,
  matchesExpectedStagingDemoAuthenticatorErrorV0,
  matchesExpectedStagingDemoAuthenticatorReadyV0,
  matchesExpectedSubmitSimulatorCaptureV0,
  projectEnrollmentSessionStateToUiV1,
  projectSimulatorBrowserErrorToUiEventV1,
  transitionAuthenticatorUiV1,
  type AuthenticatorUiDetailCodeV1,
  type AuthenticatorUiEventTypeV1,
  type AuthenticatorUiSnapshotV1,
  type AuthenticatorUiStateIdV1,
  type EnrollmentSessionStateV2,
  type FrameBundleV0,
  type SimulatorBrowserSessionViewV0,
} from "../src";

const REQUEST_STARTED = "2026-09-02T21:59:59.000Z";
const NOW = "2026-09-02T22:00:00.000Z";
const LATER = "2026-09-02T22:05:00.000Z";
const ACCOUNT_DIGEST = "a".repeat(64);
const NONCE_DIGEST = "b".repeat(64);
const FRAME_DIGEST = "c".repeat(64);

const injectedRequest = {
  kind: INJECTED_AUTHENTICATOR_REQUEST_V0,
  version: INJECTED_AUTHENTICATOR_PORT_V0,
  mode: SIMULATION_MODE,
  environment: SIMULATION_ENVIRONMENT,
  requestId: "demo-auth-request",
  sessionId: "session-v0",
  idempotencyKey: "demo-auth-idempotency",
  accountPublicMaterialDigestSha256: ACCOUNT_DIGEST,
  requestedAt: REQUEST_STARTED,
  expiresAt: LATER,
} as const;

const injectedReady = {
  kind: STAGING_DEMO_AUTHENTICATOR_READY_V0,
  version: INJECTED_AUTHENTICATOR_PORT_V0,
  mode: SIMULATION_MODE,
  environment: SIMULATION_ENVIRONMENT,
  requestId: injectedRequest.requestId,
  sessionId: injectedRequest.sessionId,
  idempotencyKey: injectedRequest.idempotencyKey,
  completionHandle: "opaque-completion-handle",
  accountPublicMaterialDigestSha256: ACCOUNT_DIGEST,
  claims: {
    webauthnPerformed: false,
    prfEvaluated: false,
    worldIdCreated: false,
  },
  issuedAt: NOW,
  expiresAt: LATER,
} as const;

const expectedInjectedReady = {
  runtimeEnvironment: "staging" as const,
  requestId: injectedRequest.requestId,
  sessionId: injectedRequest.sessionId,
  idempotencyKey: injectedRequest.idempotencyKey,
  accountPublicMaterialDigestSha256: ACCOUNT_DIGEST,
  requestRequestedAt: injectedRequest.requestedAt,
  requestExpiresAt: injectedRequest.expiresAt,
  now: NOW,
};

function capturePolicy(expiresAt = LATER) {
  return { ...SIMULATOR_UI_CAPTURE_POLICY_TEMPLATE_V0, expiresAt };
}

const artifactSummary = {
  kind: SIMULATED_WORKFLOW_ARTIFACT_SUMMARY_V0,
  biometricVerification: "not_performed",
  uniqueness: "not_performed",
  credentialClass: "not_selfie_check",
  productionCredential: false,
} as const;

function sessionView(
  state: EnrollmentSessionStateV2 = "capture_ready",
  code: SimulatorBrowserSessionViewV0["code"] = "capture_ready",
): SimulatorBrowserSessionViewV0 {
  return {
    kind: SIMULATOR_BROWSER_SESSION_VIEW_V0,
    version: SIMULATOR_BROWSER_SESSION_PORT_V0,
    mode: SIMULATION_MODE,
    environment: SIMULATION_ENVIRONMENT,
    sessionId: "session-v0",
    browserHandle: "opaque-browser-handle",
    nonceBase64Url: "opaque-nonce",
    state,
    code,
    retryable:
      code === "simulation_retry" ||
      code === "simulation_unavailable" ||
      code === "issuance_unavailable",
    expiresAt: LATER,
    capturePolicy: capturePolicy(),
    artifactSummary: state === "simulated_credential_ready" ? artifactSummary : null,
  };
}

async function frameBundle(): Promise<FrameBundleV0> {
  const pending: FrameBundleV0 = {
    kind: FRAME_BUNDLE_V0,
    mode: SIMULATION_MODE,
    sessionId: "session-v0",
    policyId: SIMULATOR_UI_CAPTURE_POLICY_TEMPLATE_V0.policyId,
    accountPublicMaterialDigestSha256: ACCOUNT_DIGEST,
    nonceDigestSha256: NONCE_DIGEST,
    dataMode: "metadata_only",
    frames: [
      {
        transportIndex: 0,
        width: 1,
        height: 1,
        encoding: "rgba8",
        byteLength: 4,
        frameDigestSha256: FRAME_DIGEST,
      },
    ],
    totalByteLength: 4,
    digestAlgorithm: FRAME_BUNDLE_V0_DIGEST_ALGORITHM,
    artifactDigestSha256: "0".repeat(64),
  };
  return { ...pending, artifactDigestSha256: await computeFrameBundleDigestV0(pending) };
}

function detailFor(state: AuthenticatorUiStateIdV1): AuthenticatorUiDetailCodeV1 | null {
  if (state === "capture_guidance_adjust") return "move_closer";
  if (state === "capture_guidance_retake") return "image_blurry";
  if (state === "capture_guidance_unavailable") return "framing_guidance_unavailable";
  if (state === "capture_error") return "permission_denied";
  if (state === "session_error") return "network_timeout";
  if (state === "return_callback_failed") return "navigation_failed";
  if (state === "flow_failed") return "safe_internal_error";
  return null;
}

function authoritativeFor(
  state: AuthenticatorUiStateIdV1,
): EnrollmentSessionStateV2 | null {
  for (const serverState of ENROLLMENT_SESSION_STATES_V2) {
    if (ENROLLMENT_SESSION_ALLOWED_UI_STATES_V1[serverState].includes(state)) {
      return serverState;
    }
  }
  return null;
}

function event(
  eventType: AuthenticatorUiEventTypeV1,
  fields: Partial<{
    detailCode: AuthenticatorUiDetailCodeV1 | null;
    authoritativeSessionState: EnrollmentSessionStateV2 | null;
    rpPresentationId: "zoom_demo" | null;
  }> = {},
) {
  return makeAuthenticatorUiEventV1({ event: eventType, ...fields });
}

function advance(
  current: AuthenticatorUiSnapshotV1,
  nextEvent: ReturnType<typeof event>,
) {
  const transition = transitionAuthenticatorUiV1(current, nextEvent);
  expect(transition).not.toBeNull();
  return transition!;
}

describe("InjectedAuthenticatorPortV0", () => {
  test("is type-distinct, strict, staging-only, and explicitly performs no real authenticator work", () => {
    expect(isInjectedAuthenticatorRequestV0(injectedRequest)).toBe(true);
    expect(isStagingDemoAuthenticatorReadyV0(injectedReady)).toBe(true);
    expect(matchesExpectedStagingDemoAuthenticatorReadyV0(
      injectedReady,
      expectedInjectedReady,
    )).toBe(true);
    expect(injectedReady.claims).toEqual({
      webauthnPerformed: false,
      prfEvaluated: false,
      worldIdCreated: false,
    });

    for (const extra of [
      { syntheticAccountHandle: "unneeded" },
      { prfResult: "forbidden" },
      { privateKey: "forbidden" },
      { passkeyCredential: "forbidden" },
      { worldIdSignature: "forbidden" },
    ]) {
      expect(isStagingDemoAuthenticatorReadyV0({ ...injectedReady, ...extra })).toBe(false);
    }
    expect(isStagingDemoAuthenticatorReadyV0({
      ...injectedReady,
      claims: { ...injectedReady.claims, prfEvaluated: true },
    })).toBe(false);
  });

  test("binds a ready result to the initiating request time window", () => {
    for (const [candidate, expected] of [
      [injectedReady, { ...expectedInjectedReady, requestId: "wrong" }],
      [injectedReady, { ...expectedInjectedReady, sessionId: "wrong" }],
      [injectedReady, { ...expectedInjectedReady, idempotencyKey: "wrong" }],
      [injectedReady, { ...expectedInjectedReady, accountPublicMaterialDigestSha256: "d".repeat(64) }],
      [injectedReady, { ...expectedInjectedReady, now: LATER }],
      [{ ...injectedReady, issuedAt: "2020-01-01T00:00:00.000Z", expiresAt: "2030-01-01T00:00:00.000Z" }, expectedInjectedReady],
      [{ ...injectedReady, expiresAt: "2026-09-02T22:06:00.000Z" }, expectedInjectedReady],
    ] as const) {
      expect(matchesExpectedStagingDemoAuthenticatorReadyV0(candidate, expected)).toBe(false);
    }
    expect(matchesExpectedStagingDemoAuthenticatorReadyV0(injectedReady, {
      ...expectedInjectedReady,
      now: "not-a-date",
    })).toBe(false);
  });

  test("strictly matches stable demo errors to the initiating operation", () => {
    const error = {
      kind: STAGING_DEMO_AUTHENTICATOR_ERROR_V0,
      version: INJECTED_AUTHENTICATOR_PORT_V0,
      mode: SIMULATION_MODE,
      environment: SIMULATION_ENVIRONMENT,
      requestId: injectedRequest.requestId,
      sessionId: injectedRequest.sessionId,
      idempotencyKey: injectedRequest.idempotencyKey,
      reasonCode: "interrupted",
    } as const;
    expect(isStagingDemoAuthenticatorErrorV0(error)).toBe(true);
    expect(matchesExpectedStagingDemoAuthenticatorErrorV0(error, {
      runtimeEnvironment: "staging",
      requestId: injectedRequest.requestId,
      sessionId: injectedRequest.sessionId,
      idempotencyKey: injectedRequest.idempotencyKey,
    })).toBe(true);
    expect(matchesExpectedStagingDemoAuthenticatorErrorV0(error, {
      runtimeEnvironment: "staging",
      requestId: "wrong",
      sessionId: injectedRequest.sessionId,
      idempotencyKey: injectedRequest.idempotencyKey,
    })).toBe(false);
    expect(isStagingDemoAuthenticatorErrorV0({ ...error, reasonCode: "raw upstream error" })).toBe(false);
    expect(isStagingDemoAuthenticatorErrorV0({ ...error, message: "forbidden" })).toBe(false);
  });

  test("rejects production before nested demo claims are read", () => {
    let claimsReads = 0;
    const hostile = { ...injectedReady } as Record<string, unknown>;
    Object.defineProperty(hostile, "claims", {
      enumerable: true,
      get() {
        claimsReads += 1;
        throw new Error("nested claims read");
      },
    });
    expect(() => matchesExpectedStagingDemoAuthenticatorReadyV0(hostile, {
      ...expectedInjectedReady,
      runtimeEnvironment: "production",
    })).toThrow(SimulationArtifactInProductionError);
    expect(claimsReads).toBe(0);
  });

  test("fails closed for hostile request and result objects", () => {
    const hostile = new Proxy({}, { ownKeys() { throw new Error("hostile keys"); } });
    expect(isInjectedAuthenticatorRequestV0(hostile)).toBe(false);
    expect(isStagingDemoAuthenticatorReadyV0(hostile)).toBe(false);
    expect(isStagingDemoAuthenticatorErrorV0(hostile)).toBe(false);
  });
});

describe("SimulatorBrowserSessionPortV0", () => {
  const bootstrap = {
    kind: SIMULATOR_UI_BOOTSTRAP_V0,
    version: SIMULATOR_BROWSER_SESSION_PORT_V0,
    mode: SIMULATION_MODE,
    environment: SIMULATION_ENVIRONMENT,
    rpPresentationId: "zoom_demo",
    accountPublicMaterialDigestSha256: ACCOUNT_DIGEST,
    returnAction: "server_managed",
    authenticator: {
      kind: "injected_demo_only",
      webauthnPerformed: false,
      prfEvaluated: false,
      worldIdCreated: false,
    },
    qualityPolicy: SIMULATOR_UI_QUALITY_POLICY_V0,
  } as const;

  test("enforces the exact camera-active-only bootstrap policy", () => {
    expect(isSimulatorUiBootstrapV0(bootstrap)).toBe(true);
    expect(SIMULATOR_UI_QUALITY_POLICY_V0.checks).toEqual([{ kind: "camera_active" }]);
    expect(SIMULATOR_UI_CAPTURE_POLICY_TEMPLATE_V0.qualityPolicyId).toBe(
      SIMULATOR_UI_QUALITY_POLICY_V0.policyId,
    );
    expect(isSimulatorUiBootstrapV0({ ...bootstrap, scenario: "happy_path" })).toBe(false);
    expect(isSimulatorUiBootstrapV0({
      ...bootstrap,
      authenticator: { ...bootstrap.authenticator, worldIdCreated: true },
    })).toBe(false);
    expect(isSimulatorUiBootstrapV0({
      ...bootstrap,
      qualityPolicy: {
        ...SIMULATOR_UI_QUALITY_POLICY_V0,
        checks: [
          { kind: "camera_active" },
          {
            kind: "framing",
            minFaceAreaRatio: 0.2,
            maxFaceAreaRatio: 0.8,
            maxCenterOffsetRatio: 0.2,
          },
        ],
      },
    })).toBe(false);
  });

  test("strictly validates every browser request shape", async () => {
    const basic = { sessionId: "session-v0", browserHandle: "opaque-browser-handle" };
    const idempotent = { ...basic, idempotencyKey: "operation-key" };
    const complete = { ...idempotent, completionHandle: "opaque-completion" };
    const bundle = await frameBundle();
    const submit = { ...idempotent, nonceBase64Url: "opaque-nonce", frameBundle: bundle };

    expect(isCreateSimulatorBrowserSessionV0({ idempotencyKey: "create-key" })).toBe(true);
    expect(isBrowserSessionFieldsV0(basic)).toBe(true);
    expect(isBrowserIdempotentSessionFieldsV0(idempotent)).toBe(true);
    expect(isCompleteDemoAuthenticatorV0(complete)).toBe(true);
    expect(isSubmitSimulatorCaptureShapeV0(submit)).toBe(true);
    expect(await matchesExpectedSubmitSimulatorCaptureV0(submit, {
      ...idempotent,
      nonceBase64Url: "opaque-nonce",
      nonceDigestSha256: NONCE_DIGEST,
      accountPublicMaterialDigestSha256: ACCOUNT_DIGEST,
      capturePolicy: capturePolicy(),
    })).toBe(true);

    for (const invalid of [
      { ...basic, extra: true },
      { ...idempotent, idempotencyKey: "" },
      { ...complete, completionHandle: "", extra: true },
      { ...submit, pixels: "forbidden" },
    ]) {
      expect(
        isBrowserSessionFieldsV0(invalid) ||
        isBrowserIdempotentSessionFieldsV0(invalid) ||
        isCompleteDemoAuthenticatorV0(invalid) ||
        isSubmitSimulatorCaptureShapeV0(invalid),
      ).toBe(false);
    }
    expect(await matchesExpectedSubmitSimulatorCaptureV0(submit, {
      ...idempotent,
      sessionId: "wrong",
      nonceBase64Url: "opaque-nonce",
      nonceDigestSha256: NONCE_DIGEST,
      accountPublicMaterialDigestSha256: ACCOUNT_DIGEST,
      capturePolicy: capturePolicy(),
    })).toBe(false);
  });

  test("narrows demo results and errors to strict browser envelopes", () => {
    const ready = {
      kind: SIMULATOR_BROWSER_DEMO_AUTHENTICATOR_READY_V0,
      version: SIMULATOR_BROWSER_SESSION_PORT_V0,
      mode: SIMULATION_MODE,
      environment: SIMULATION_ENVIRONMENT,
      sessionId: "session-v0",
      idempotencyKey: "demo-auth-idempotency",
      completionHandle: "opaque-completion",
      claims: {
        webauthnPerformed: false,
        prfEvaluated: false,
        worldIdCreated: false,
      },
      expiresAt: LATER,
    } as const;
    expect(isSimulatorBrowserDemoAuthenticatorReadyV0(ready)).toBe(true);
    expect(matchesExpectedSimulatorBrowserDemoAuthenticatorReadyV0(ready, {
      runtimeEnvironment: "staging",
      sessionId: "session-v0",
      idempotencyKey: "demo-auth-idempotency",
      now: NOW,
    })).toBe(true);
    expect(isSimulatorBrowserDemoAuthenticatorReadyV0({
      ...ready,
      syntheticAccountHandle: "forbidden",
    })).toBe(false);
    expect(isSimulatorBrowserDemoAuthenticatorReadyV0({
      ...ready,
      accountPublicMaterialDigestSha256: ACCOUNT_DIGEST,
    })).toBe(false);

    const error = {
      kind: SIMULATOR_BROWSER_SESSION_ERROR_V0,
      version: SIMULATOR_BROWSER_SESSION_PORT_V0,
      mode: SIMULATION_MODE,
      environment: SIMULATION_ENVIRONMENT,
      operation: "begin_demo_authenticator",
      reasonCode: "user_non_completion",
    } as const;
    expect(isSimulatorBrowserSessionErrorV0(error)).toBe(true);
    expect(projectSimulatorBrowserErrorToUiEventV1(error)?.event).toBe(
      "demo_authenticator_non_completion",
    );
    expect(isSimulatorBrowserSessionErrorV0({ ...error, message: "raw" })).toBe(false);
    expect(isSimulatorBrowserSessionErrorV0({ ...error, operation: "unknown" })).toBe(false);

    const returned = {
      kind: SIMULATOR_BROWSER_RETURN_ACCEPTED_V0,
      version: SIMULATOR_BROWSER_SESSION_PORT_V0,
      mode: SIMULATION_MODE,
      environment: SIMULATION_ENVIRONMENT,
      action: "server_managed",
    } as const;
    expect(isSimulatorBrowserReturnAcceptedV0(returned)).toBe(true);
    expect(isSimulatorBrowserReturnAcceptedV0({ ...returned, returnUrl: "https://evil.test" })).toBe(false);
  });

  test("maps each strict browser error class to one frozen UI event", () => {
    const base = {
      kind: SIMULATOR_BROWSER_SESSION_ERROR_V0,
      version: SIMULATOR_BROWSER_SESSION_PORT_V0,
      mode: SIMULATION_MODE,
      environment: SIMULATION_ENVIRONMENT,
    } as const;
    expect(projectSimulatorBrowserErrorToUiEventV1({
      ...base,
      operation: "submit_capture",
      reasonCode: "artifact_invalid",
    })).toMatchObject({ event: "session_failed", detailCode: "artifact_invalid" });
    expect(projectSimulatorBrowserErrorToUiEventV1({
      ...base,
      operation: "return_to_rp",
      reasonCode: "navigation_failed",
    })).toMatchObject({ event: "return_failed", detailCode: "navigation_failed" });
    expect(projectSimulatorBrowserErrorToUiEventV1({
      ...base,
      operation: "bootstrap",
      reasonCode: "response_invalid",
    })).toMatchObject({ event: "fatal_error", detailCode: "safe_internal_error" });
    expect(projectSimulatorBrowserErrorToUiEventV1({
      ...base,
      operation: "create_session",
      reasonCode: "network_unavailable",
    })).toMatchObject({ event: "fatal_error", detailCode: "safe_internal_error" });
    expect(projectSimulatorBrowserErrorToUiEventV1({ ...base, message: "raw" })).toBeNull();
  });

  test("enforces exact state/code/retryability and expected session bindings", () => {
    expect(isSimulatorBrowserSessionViewV0(sessionView())).toBe(true);
    const ready = sessionView("simulated_credential_ready", "simulated_credential_ready");
    expect(isSimulatorBrowserSessionViewV0(ready)).toBe(true);
    expect(isSimulatorBrowserSessionViewV0({ ...ready, retryable: true })).toBe(false);
    expect(isSimulatorBrowserSessionViewV0(sessionView("simulated_reject", "simulation_pass"))).toBe(false);
    expect(isSimulatorBrowserSessionViewV0({
      ...sessionView(),
      capturePolicy: capturePolicy("2026-09-02T22:04:00.000Z"),
    })).toBe(false);
    expect(matchesExpectedSimulatorBrowserSessionViewV0(sessionView(), {
      runtimeEnvironment: "staging",
      sessionId: "session-v0",
      browserHandle: "opaque-browser-handle",
      now: NOW,
    })).toBe(true);
    expect(matchesExpectedSimulatorBrowserSessionViewV0(sessionView(), {
      runtimeEnvironment: "staging",
      sessionId: "wrong",
      browserHandle: "opaque-browser-handle",
      now: NOW,
    })).toBe(false);

    for (const extra of [
      { biometricScenario: "happy_path" },
      { issuanceScenario: "issue_success" },
      { receipt: {} },
      { credential: {} },
      { signatureBase64Url: "forbidden" },
      { pixels: "forbidden" },
      { returnUrl: "https://example.test" },
    ]) {
      expect(isSimulatorBrowserSessionViewV0({ ...sessionView(), ...extra })).toBe(false);
    }
  });

  test("requires the negative artifact summary only at simulated credential ready", () => {
    expect(isSimulatorBrowserSessionViewV0({
      ...sessionView("simulated_credential_ready", "simulated_credential_ready"),
      artifactSummary: null,
    })).toBe(false);
    expect(isSimulatorBrowserSessionViewV0({ ...sessionView(), artifactSummary })).toBe(false);
    expect(isSimulatorBrowserSessionViewV0({
      ...sessionView("simulated_credential_ready", "simulated_credential_ready"),
      artifactSummary: { ...artifactSummary, biometricVerification: "performed" },
    })).toBe(false);
  });

  test("rejects production before a projected artifact body is read", () => {
    let summaryReads = 0;
    const hostile = { ...sessionView() } as Record<string, unknown>;
    Object.defineProperty(hostile, "artifactSummary", {
      enumerable: true,
      get() {
        summaryReads += 1;
        throw new Error("summary read");
      },
    });
    expect(() => assertSimulatorBrowserArtifactAllowed("production", hostile)).toThrow(
      SimulationArtifactInProductionError,
    );
    expect(summaryReads).toBe(0);
  });

  test("fails closed for hostile request, policy, and result objects", () => {
    const hostile = new Proxy({}, { ownKeys() { throw new Error("hostile keys"); } });
    expect(isCreateSimulatorBrowserSessionV0(hostile)).toBe(false);
    expect(isBrowserSessionFieldsV0(hostile)).toBe(false);
    expect(isBrowserIdempotentSessionFieldsV0(hostile)).toBe(false);
    expect(isCompleteDemoAuthenticatorV0(hostile)).toBe(false);
    expect(isSubmitSimulatorCaptureShapeV0(hostile)).toBe(false);
    expect(isSimulatorUiBootstrapV0({ ...bootstrap, qualityPolicy: hostile })).toBe(false);
    expect(isSimulatorBrowserSessionViewV0({ ...sessionView(), capturePolicy: hostile })).toBe(false);
    expect(isSimulatorBrowserSessionErrorV0(hostile)).toBe(false);
  });
});

describe("AuthenticatorUiFlowV1", () => {
  test("covers every frozen state with exact categorical progress, actions, visuals, and copy", () => {
    expect(new Set(AUTHENTICATOR_UI_STATES_V1).size).toBe(AUTHENTICATOR_UI_STATES_V1.length);
    for (const registry of [
      AUTHENTICATOR_UI_STATE_PROGRESS_V1,
      AUTHENTICATOR_UI_ACTIONS_BY_STATE_V1,
      AUTHENTICATOR_UI_DEFAULT_VISUAL_SOURCE_V1,
      AUTHENTICATOR_UI_COPY_V1,
    ]) {
      expect(Object.keys(registry).sort()).toEqual([...AUTHENTICATOR_UI_STATES_V1].sort());
    }
    for (const state of AUTHENTICATOR_UI_STATES_V1) {
      const snapshot = makeAuthenticatorUiSnapshotV1({
        state,
        detailCode: detailFor(state),
        authoritativeSessionState: authoritativeFor(state),
        rpPresentationId: "zoom_demo",
        visualSource: AUTHENTICATOR_UI_DEFAULT_VISUAL_SOURCE_V1[state],
      });
      expect(isAuthenticatorUiSnapshotV1(snapshot)).toBe(true);
      expect(snapshot.progress).toEqual(AUTHENTICATOR_UI_STATE_PROGRESS_V1[state]);
      expect(AUTHENTICATOR_UI_COPY_V1[state].heading.length).toBeGreaterThan(0);
      expect(AUTHENTICATOR_UI_COPY_V1[state].body.length).toBeGreaterThan(0);
    }
    expect(AUTHENTICATOR_UI_STAGING_BANNER_V1).toContain("No biometric verification");
    expect(AUTHENTICATOR_UI_TERMINAL_STATES_V1).toContain("simulated_credential_ready");
    expect(AUTHENTICATOR_UI_DEFAULT_VISUAL_SOURCE_V1.biometric_simulation_pending).toBe(
      "figma_5132_135038",
    );
  });

  test("contains no fabricated percentage, ETA, or positive assurance copy", () => {
    const text = JSON.stringify(AUTHENTICATOR_UI_COPY_V1).toLowerCase();
    expect(text).not.toContain("%");
    expect(text).not.toMatch(/\beta\b/);
    for (const forbidden of [
      "verified human",
      "biometric verification complete",
      "selfie check credential issued",
      "prove your liveness",
      "real, unique person",
      "passkey created successfully",
      "world id created successfully",
      "great position",
    ]) {
      expect(text).not.toContain(forbidden);
    }
  });

  test("rejects impossible UI/server combinations and projects every V2 state", () => {
    expect(Object.keys(ENROLLMENT_SESSION_TO_UI_STATE_V1).sort()).toEqual(
      [...ENROLLMENT_SESSION_STATES_V2].sort(),
    );
    for (const state of ENROLLMENT_SESSION_STATES_V2) {
      const projected = projectEnrollmentSessionStateToUiV1(state, {
        rpPresentationId: "zoom_demo",
        visualSource: AUTHENTICATOR_UI_DEFAULT_VISUAL_SOURCE_V1[
          ENROLLMENT_SESSION_TO_UI_STATE_V1[state]
        ],
      });
      expect(projected.state).toBe(ENROLLMENT_SESSION_TO_UI_STATE_V1[state]);
      expect(projected.authoritativeSessionState).toBe(state);
    }
    const valid = projectEnrollmentSessionStateToUiV1("simulated_credential_ready");
    expect(isAuthenticatorUiSnapshotV1({
      ...valid,
      authoritativeSessionState: "created",
    })).toBe(false);
    expect(isAuthenticatorUiSnapshotV1({
      ...makeAuthenticatorUiSnapshotV1({ state: "request_review" }),
      authoritativeSessionState: "simulated_credential_ready",
    })).toBe(false);
    for (const authoritativeSessionState of [
      "simulated_reject",
      "simulated_issuance_reject",
      "simulated_credential_ready",
      "cancelled",
      "expired",
    ] as const) {
      expect(isAuthenticatorUiSnapshotV1({
        ...makeAuthenticatorUiSnapshotV1({ state: "return_redirecting" }),
        authoritativeSessionState,
      })).toBe(false);
    }
  });

  test("freezes legal actions, effects, events, and a complete happy transition path", () => {
    expect(AUTHENTICATOR_UI_INITIAL_EFFECTS_V1).toEqual(["validate_request"]);
    let current = makeAuthenticatorUiSnapshotV1({
      state: "request_checking",
      visualSource: AUTHENTICATOR_UI_DEFAULT_VISUAL_SOURCE_V1.request_checking,
    });
    current = advance(current, event("request_accepted", { rpPresentationId: "zoom_demo" })).snapshot;
    current = advance(current, event("continue")).snapshot;
    current = advance(current, event("admission_safari_candidate")).snapshot;
    current = advance(current, event("continue")).snapshot;
    let result = advance(current, event("start_demo_authenticator"));
    expect(result.effects).toEqual(["create_session"]);
    current = result.snapshot;
    result = advance(current, event("authoritative_session", {
      authoritativeSessionState: "created",
    }));
    expect(result.effects).toEqual(["begin_demo_authenticator"]);
    current = result.snapshot;
    result = advance(current, event("demo_authenticator_ready"));
    expect(result.effects).toEqual(["complete_demo_authenticator"]);
    current = result.snapshot;
    current = advance(current, event("authoritative_session", {
      authoritativeSessionState: "passkey_complete",
    })).snapshot;
    result = advance(current, event("continue_to_camera"));
    expect(result.effects).toEqual(["prepare_capture"]);
    current = result.snapshot;
    current = advance(current, event("authoritative_session", {
      authoritativeSessionState: "capture_ready",
    })).snapshot;
    result = advance(current, event("start_camera"));
    expect(result.effects).toEqual(["start_capture"]);
    current = result.snapshot;
    current = advance(current, event("capture_acquiring")).snapshot;
    current = advance(current, event("capture_preparing")).snapshot;
    current = advance(current, event("capture_preview")).snapshot;
    result = advance(current, event("quality_ready"));
    expect(result.effects).toEqual(["collect_frame_metadata"]);
    current = result.snapshot;
    result = advance(current, event("capture_artifact_ready"));
    expect(result.effects).toEqual(["stop_capture", "clear_transient_media"]);
    current = result.snapshot;
    result = advance(current, event("cleanup_complete"));
    expect(result.effects).toEqual(["submit_capture"]);
    current = result.snapshot;
    current = advance(current, event("authoritative_session", {
      authoritativeSessionState: "simulated_credential_ready",
    })).snapshot;
    expect(current.state).toBe("simulated_credential_ready");
    result = advance(current, event("return_requested"));
    expect(result.effects).toEqual([
      "abort_active_effects",
      "stop_capture",
      "clear_transient_media",
      "return_to_rp",
    ]);
    current = result.snapshot;
    current = advance(current, event("return_completed")).snapshot;
    expect(current.state).toBe("returned");
    expect(transitionAuthenticatorUiV1(current, event("start_camera"))).toBeNull();
  });

  test("orders cancellation cleanup before server cancel and rejects illegal transitions", () => {
    const preview = makeAuthenticatorUiSnapshotV1({
      state: "capture_preview",
      authoritativeSessionState: "capture_ready",
      rpPresentationId: "zoom_demo",
      visualSource: "figma_5132_134743",
    });
    const cancelling = advance(preview, event("cancel_requested"));
    expect(cancelling.effects).toEqual([
      "abort_active_effects",
      "stop_capture",
      "clear_transient_media",
      "cancel_session",
    ]);
    expect(cancelling.snapshot.state).toBe("flow_cancelling");
    const cancelled = advance(cancelling.snapshot, event("authoritative_session", {
      authoritativeSessionState: "cancelled",
    }));
    expect(cancelled.snapshot.state).toBe("flow_cancelled");
    expect(transitionAuthenticatorUiV1(preview, event("return_completed"))).toBeNull();
    const quality = dispatchAuthenticatorUiActionV1(preview, "collect_frame_metadata");
    expect(quality?.snapshot).toBe(preview);
    expect(quality?.effects).toEqual(["evaluate_quality"]);
    expect(dispatchAuthenticatorUiActionV1(preview, "return_to_rp")).toBeNull();
  });

  test("keeps pre-session failures local and makes ambiguous post-session status recoverable", () => {
    const creating = makeAuthenticatorUiSnapshotV1({ state: "session_creating" });
    const preSessionFailure = advance(creating, event("session_failed", {
      detailCode: "network_unavailable",
    }));
    expect(preSessionFailure.snapshot.state).toBe("flow_failed");
    expect(preSessionFailure.snapshot.authoritativeSessionState).toBeNull();
    expect(preSessionFailure.effects).toEqual([
      "abort_active_effects",
      "stop_capture",
      "clear_transient_media",
    ]);

    const captureComplete = makeAuthenticatorUiSnapshotV1({
      state: "capture_complete",
      authoritativeSessionState: "capture_ready",
    });
    const ambiguous = advance(captureComplete, event("session_failed", {
      detailCode: "network_unavailable",
    }));
    expect(ambiguous.snapshot.state).toBe("session_error");
    expect(ambiguous.snapshot.authoritativeSessionState).toBe("capture_ready");
    expect(AUTHENTICATOR_UI_ACTIONS_BY_STATE_V1.session_error).toEqual([
      "query_status",
      "cancel",
    ]);
    const recovery = dispatchAuthenticatorUiActionV1(ambiguous.snapshot, "query_status");
    expect(recovery?.snapshot.state).toBe("session_reconciling");
    expect(recovery?.effects).toEqual(["query_status"]);
    expect(() => makeAuthenticatorUiSnapshotV1({
      state: "session_error",
      detailCode: "network_unavailable",
    })).toThrow("invalid_authenticator_ui_snapshot_v1");
  });

  test("keeps pre-session close separate from session-bound RP return", () => {
    const invalidReturn = makeAuthenticatorUiSnapshotV1({
      state: "request_return_target_invalid",
      visualSource: "verified_template",
    });
    expect(AUTHENTICATOR_UI_ACTIONS_BY_STATE_V1[invalidReturn.state]).toEqual(["close"]);
    expect(dispatchAuthenticatorUiActionV1(invalidReturn, "return_to_rp")).toBeNull();
    const closed = dispatchAuthenticatorUiActionV1(invalidReturn, "close");
    expect(closed?.snapshot.state).toBe("flow_closed");
    expect(closed?.effects).toEqual([
      "abort_active_effects",
      "stop_capture",
      "clear_transient_media",
      "close_locally",
    ]);
    expect(closed?.effects).not.toContain("return_to_rp");

    const callbackFailure = makeAuthenticatorUiSnapshotV1({
      state: "return_callback_failed",
      detailCode: "navigation_failed",
    });
    expect(callbackFailure.authoritativeSessionState).toBeNull();
    const callbackClosed = dispatchAuthenticatorUiActionV1(callbackFailure, "close");
    expect(callbackClosed?.snapshot.state).toBe("flow_closed");
    expect(callbackClosed?.effects).not.toContain("return_to_rp");
  });

  test("freezes abort and cleanup behavior for every in-flight state", () => {
    const inFlight: readonly [AuthenticatorUiStateIdV1, EnrollmentSessionStateV2 | null][] = [
      ["request_checking", null],
      ["admission_checking", null],
      ["admission_handoff_departing", null],
      ["session_creating", null],
      ["demo_authenticator_pending", "created"],
      ["session_completing_authenticator", "created"],
      ["session_reconciling", "created"],
      ["capture_policy_loading", "passkey_complete"],
      ["capture_permission_request", "capture_ready"],
      ["capture_acquiring", "capture_ready"],
      ["capture_preparing", "capture_ready"],
      ["capture_sampling", "capture_ready"],
      ["capture_artifact_ready", "capture_ready"],
      ["capture_cleaning", "capture_ready"],
      ["capture_complete", "capture_ready"],
      ["biometric_simulation_pending", "biometric_simulation_pending"],
      ["biometric_simulated_pass", "simulated_pass"],
      ["issuance_simulation_pending", "issuance_simulation_pending"],
      ["return_redirecting", null],
    ];
    const lifecycleEvents = [
      "page_hidden",
      "page_unloaded",
      "orientation_invalidated",
      "component_unmounted",
      "operation_interrupted",
    ] as const;

    for (const [state, authoritativeSessionState] of inFlight) {
      const snapshot = makeAuthenticatorUiSnapshotV1({
        state,
        authoritativeSessionState,
        visualSource: AUTHENTICATOR_UI_DEFAULT_VISUAL_SOURCE_V1[state],
      });
      for (const lifecycleEvent of lifecycleEvents) {
        const aborted = transitionAuthenticatorUiV1(snapshot, event(lifecycleEvent));
        expect(aborted).not.toBeNull();
        expect(aborted?.snapshot.state).toBe("flow_cancelling");
        expect(aborted?.effects.slice(0, 3)).toEqual([
          "abort_active_effects",
          "stop_capture",
          "clear_transient_media",
        ]);
        expect(aborted?.effects.includes("cancel_session")).toBe(
          authoritativeSessionState !== null,
        );
      }
    }

    for (const [state] of inFlight) {
      expect(AUTHENTICATOR_UI_ACTIONS_BY_STATE_V1[state]).toContain("cancel");
    }
  });

  test("strictly validates event payloads and state-specific error details", () => {
    const accepted = event("request_accepted", { rpPresentationId: "zoom_demo" });
    expect(isAuthenticatorUiEventV1(accepted)).toBe(true);
    expect(isAuthenticatorUiEventV1({ ...accepted, message: "free text" })).toBe(false);
    expect(() => event("quality_adjust", { detailCode: "network_timeout" })).toThrow(
      "invalid_authenticator_ui_event_v1",
    );
    expect(() => event("authoritative_session")).toThrow(
      "invalid_authenticator_ui_event_v1",
    );

    const captureError = makeAuthenticatorUiSnapshotV1({
      state: "capture_error",
      detailCode: "permission_denied",
      authoritativeSessionState: "capture_ready",
    });
    expect(isAuthenticatorUiSnapshotV1({ ...captureError, detailCode: "navigation_failed" })).toBe(false);
    expect(isAuthenticatorUiSnapshotV1({
      ...captureError,
      progress: { stage: "biometric_simulation", status: "pending" },
    })).toBe(false);
    expect(isAuthenticatorUiSnapshotV1({ ...captureError, message: "free text" })).toBe(false);
  });

  test("runtime-freezes every exported registry used for policy or presentation", () => {
    for (const values of [
      AUTHENTICATOR_UI_ACTIONS_V1,
      AUTHENTICATOR_UI_EFFECTS_V1,
      AUTHENTICATOR_UI_EVENTS_V1,
      AUTHENTICATOR_UI_DETAIL_CODES_V1,
      AUTHENTICATOR_UI_VISUAL_SOURCES_V1,
      SIMULATOR_SESSION_STATUS_CODES_V0,
      SIMULATOR_BROWSER_SESSION_OPERATIONS_V0,
      SIMULATOR_BROWSER_SESSION_ERROR_CODES_V0,
    ]) {
      expect(new Set(values).size).toBe(values.length);
    }
    for (const registry of [
      AUTHENTICATOR_UI_STATES_V1,
      AUTHENTICATOR_UI_ACTIONS_V1,
      AUTHENTICATOR_UI_EFFECTS_V1,
      AUTHENTICATOR_UI_INITIAL_EFFECTS_V1,
      AUTHENTICATOR_UI_EVENTS_V1,
      AUTHENTICATOR_UI_DETAIL_CODES_V1,
      AUTHENTICATOR_UI_VISUAL_SOURCES_V1,
      AUTHENTICATOR_UI_TERMINAL_STATES_V1,
      AUTHENTICATOR_UI_STATE_PROGRESS_V1,
      AUTHENTICATOR_UI_ACTIONS_BY_STATE_V1,
      AUTHENTICATOR_UI_DEFAULT_VISUAL_SOURCE_V1,
      ENROLLMENT_SESSION_TO_UI_STATE_V1,
      ENROLLMENT_SESSION_ALLOWED_UI_STATES_V1,
      AUTHENTICATOR_UI_COPY_V1,
      AUTHENTICATOR_UI_DETAIL_COPY_V1,
      RP_PRESENTATION_IDS_V0,
      SIMULATOR_SESSION_STATUS_CODES_V0,
      SIMULATOR_BROWSER_SESSION_OPERATIONS_V0,
      SIMULATOR_BROWSER_SESSION_ERROR_CODES_V0,
      STAGING_DEMO_AUTHENTICATOR_ERROR_REASONS_V0,
      SIMULATOR_UI_QUALITY_POLICY_V0,
      SIMULATOR_UI_CAPTURE_POLICY_TEMPLATE_V0,
    ]) {
      expect(Object.isFrozen(registry)).toBe(true);
    }
    for (const state of AUTHENTICATOR_UI_STATES_V1) {
      expect(Object.isFrozen(AUTHENTICATOR_UI_STATE_PROGRESS_V1[state])).toBe(true);
      expect(Object.isFrozen(AUTHENTICATOR_UI_ACTIONS_BY_STATE_V1[state])).toBe(true);
      expect(Object.isFrozen(AUTHENTICATOR_UI_COPY_V1[state])).toBe(true);
    }
    for (const state of ENROLLMENT_SESSION_STATES_V2) {
      expect(Object.isFrozen(ENROLLMENT_SESSION_ALLOWED_UI_STATES_V1[state])).toBe(true);
    }
  });

  test("production rejects snapshots/events and revoked proxies with stable isolation errors", () => {
    let progressReads = 0;
    const hostile = {
      kind: AUTHENTICATOR_UI_SNAPSHOT_V1,
      version: AUTHENTICATOR_UI_FLOW_V1,
      mode: SIMULATION_MODE,
      environment: SIMULATION_ENVIRONMENT,
    } as Record<string, unknown>;
    Object.defineProperty(hostile, "progress", {
      enumerable: true,
      get() {
        progressReads += 1;
        throw new Error("progress read");
      },
    });
    expect(() => assertAuthenticatorUiSnapshotAllowed("production", hostile)).toThrow(
      SimulationArtifactInProductionError,
    );
    expect(progressReads).toBe(0);
    expect(() => assertAuthenticatorUiEventAllowed("production", {
      kind: AUTHENTICATOR_UI_EVENT_V1,
      mode: SIMULATION_MODE,
    })).toThrow(SimulationArtifactInProductionError);

    const target = {};
    const revoked = Proxy.revocable(target, {});
    revoked.revoke();
    expect(() => assertSimulationArtifactAllowed("production", revoked.proxy)).toThrow(
      SimulationArtifactInProductionError,
    );
  });

  test("fails closed for hostile snapshot and event objects", () => {
    const hostile = new Proxy({}, { ownKeys() { throw new Error("hostile keys"); } });
    expect(isAuthenticatorUiSnapshotV1(hostile)).toBe(false);
    expect(isAuthenticatorUiEventV1(hostile)).toBe(false);
  });
});
