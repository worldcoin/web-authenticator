import {
  FRAME_BUNDLE_V0,
  FRAME_BUNDLE_V0_DIGEST_ALGORITHM,
  SIMULATION_MODE,
  SIMULATOR_BROWSER_DEMO_AUTHENTICATOR_READY_V0,
  SIMULATOR_BROWSER_SESSION_VIEW_V0,
  SIMULATOR_UI_BOOTSTRAP_V0,
  computeFrameBundleDigestV0,
  type BiometricSimulationScenarioV0,
  type FrameBundleV0,
  type IssuanceSimulationScenarioV0,
  type SimulatorBrowserSessionPortV0,
  type SimulatorBrowserSessionViewV0,
  type SimulatorUiBootstrapV0,
} from "@clean-start/contracts";
import { createAuthenticatorServerRuntimeV0 } from "../../../apps/authenticator/src/server/runtime.server";

export const PRODUCT_REVISION_UNDER_TEST =
  "b7d3949099b175ae41e1a95f4f65ee3c2714d98b" as const;

export async function sha256Text(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}

export async function metadataBundle(
  session: SimulatorBrowserSessionViewV0,
  accountDigest: string,
  frameDigest = "a".repeat(64),
): Promise<FrameBundleV0> {
  const pending: FrameBundleV0 = {
    kind: FRAME_BUNDLE_V0,
    mode: SIMULATION_MODE,
    sessionId: session.sessionId,
    policyId: session.capturePolicy.policyId,
    accountPublicMaterialDigestSha256: accountDigest,
    nonceDigestSha256: await sha256Text(session.nonceBase64Url),
    dataMode: "metadata_only",
    frames: [{
      transportIndex: 0,
      width: 1,
      height: 1,
      encoding: "rgba8",
      byteLength: 4,
      frameDigestSha256: frameDigest,
    }],
    totalByteLength: 4,
    digestAlgorithm: FRAME_BUNDLE_V0_DIGEST_ALGORITHM,
    artifactDigestSha256: "0".repeat(64),
  };
  return Object.freeze({
    ...pending,
    frames: Object.freeze(pending.frames),
    artifactDigestSha256: await computeFrameBundleDigestV0(pending),
  });
}

export interface CompletedScenarioV0 {
  readonly browserPort: SimulatorBrowserSessionPortV0;
  readonly bootstrap: SimulatorUiBootstrapV0;
  readonly created: SimulatorBrowserSessionViewV0;
  readonly captureReady: SimulatorBrowserSessionViewV0;
  readonly result: Awaited<ReturnType<SimulatorBrowserSessionPortV0["submitCapture"]>>;
  readonly submitInput: {
    readonly sessionId: string;
    readonly browserHandle: string;
    readonly idempotencyKey: string;
    readonly nonceBase64Url: string;
    readonly frameBundle: FrameBundleV0;
  };
}

export interface PreparedScenarioV0 {
  readonly browserPort: SimulatorBrowserSessionPortV0;
  readonly bootstrap: SimulatorUiBootstrapV0;
  readonly created: SimulatorBrowserSessionViewV0;
  readonly captureReady: SimulatorBrowserSessionViewV0;
}

export async function prepareScenario(
  biometricScenario: BiometricSimulationScenarioV0,
  issuanceScenario: IssuanceSimulationScenarioV0,
  id = `${biometricScenario}-${issuanceScenario}`,
): Promise<PreparedScenarioV0> {
  const runtime = await createAuthenticatorServerRuntimeV0({
    testConfiguration: {
      kind: "authenticator_server_test_configuration_v0",
      biometricScenario,
      issuanceScenario,
    },
  });
  const bootstrap = await runtime.browserPort.bootstrap();
  if (bootstrap.kind !== SIMULATOR_UI_BOOTSTRAP_V0) throw new Error("bootstrap_failed");
  const created = await runtime.browserPort.createSession({
    idempotencyKey: `create-${id}`,
  });
  if (created.kind !== SIMULATOR_BROWSER_SESSION_VIEW_V0) throw new Error("create_failed");
  const demo = await runtime.browserPort.beginDemoAuthenticator({
    sessionId: created.sessionId,
    browserHandle: created.browserHandle,
    idempotencyKey: `demo-${id}`,
  });
  if (demo.kind !== SIMULATOR_BROWSER_DEMO_AUTHENTICATOR_READY_V0) {
    throw new Error("demo_begin_failed");
  }
  const completed = await runtime.browserPort.completeDemoAuthenticator({
    sessionId: created.sessionId,
    browserHandle: created.browserHandle,
    idempotencyKey: demo.idempotencyKey,
    completionHandle: demo.completionHandle,
  });
  if (completed.kind !== SIMULATOR_BROWSER_SESSION_VIEW_V0) {
    throw new Error("demo_complete_failed");
  }
  const captureReady = await runtime.browserPort.prepareCapture({
    sessionId: completed.sessionId,
    browserHandle: completed.browserHandle,
  });
  if (captureReady.kind !== SIMULATOR_BROWSER_SESSION_VIEW_V0) {
    throw new Error("capture_prepare_failed");
  }
  return Object.freeze({
    browserPort: runtime.browserPort,
    bootstrap,
    created,
    captureReady,
  });
}

export async function completeScenario(
  biometricScenario: BiometricSimulationScenarioV0,
  issuanceScenario: IssuanceSimulationScenarioV0,
  id = `${biometricScenario}-${issuanceScenario}`,
): Promise<CompletedScenarioV0> {
  const prepared = await prepareScenario(biometricScenario, issuanceScenario, id);
  const { browserPort, bootstrap, created, captureReady } = prepared;
  const submitInput = Object.freeze({
    sessionId: captureReady.sessionId,
    browserHandle: captureReady.browserHandle,
    idempotencyKey: `capture-${id}`,
    nonceBase64Url: captureReady.nonceBase64Url,
    frameBundle: await metadataBundle(
      captureReady,
      bootstrap.accountPublicMaterialDigestSha256,
    ),
  });
  const result = await browserPort.submitCapture(submitInput);
  return Object.freeze({
    browserPort,
    bootstrap,
    created,
    captureReady,
    result,
    submitInput,
  });
}
