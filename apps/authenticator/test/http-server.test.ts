import { describe, expect, test } from "bun:test";
import {
  FRAME_BUNDLE_V0,
  FRAME_BUNDLE_V0_DIGEST_ALGORITHM,
  SIMULATION_MODE,
  SIMULATOR_BROWSER_SESSION_ERROR_V0,
  SIMULATOR_UI_BOOTSTRAP_V0,
  computeFrameBundleDigestV0,
  isSimulatorBrowserDemoAuthenticatorReadyV0,
  isSimulatorBrowserSessionViewV0,
  isSimulatorUiBootstrapV0,
  type FrameBundleV0,
  type SimulatorBrowserSessionViewV0,
} from "@clean-start/contracts";
import { AUTHENTICATOR_APP_CONFIG } from "@clean-start/app-config";
import { createAuthenticatorHttpHandlerV0 } from "../src/server/http.server";
import { createAuthenticatorServerRuntimeV0 } from "../src/server/runtime.server";

function apiRequest(path: string, body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`${AUTHENTICATOR_APP_CONFIG.publicOrigin}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: AUTHENTICATOR_APP_CONFIG.publicOrigin,
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

async function postJson(
  handle: (request: Request) => Promise<Response>,
  path: string,
  body: unknown,
): Promise<unknown> {
  const response = await handle(apiRequest(path, body));
  expect(response.status).toBe(200);
  return response.json();
}

async function frameBundle(session: SimulatorBrowserSessionViewV0, accountDigest: string): Promise<FrameBundleV0> {
  const nonceBytes = new TextEncoder().encode(session.nonceBase64Url);
  const nonceHash = await crypto.subtle.digest("SHA-256", nonceBytes);
  const nonceDigestSha256 = Array.from(
    new Uint8Array(nonceHash),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
  const pending: FrameBundleV0 = {
    kind: FRAME_BUNDLE_V0,
    mode: SIMULATION_MODE,
    sessionId: session.sessionId,
    policyId: session.capturePolicy.policyId,
    accountPublicMaterialDigestSha256: accountDigest,
    nonceDigestSha256,
    dataMode: "metadata_only",
    frames: [{ transportIndex: 0, width: 1, height: 1, encoding: "rgba8", byteLength: 4, frameDigestSha256: "e".repeat(64) }],
    totalByteLength: 4,
    digestAlgorithm: FRAME_BUNDLE_V0_DIGEST_ALGORITHM,
    artifactDigestSha256: "0".repeat(64),
  };
  return { ...pending, artifactDigestSha256: await computeFrameBundleDigestV0(pending) };
}

describe("authenticator HTTP boundary", () => {
  test("returns only the strict bootstrap projection with security headers", async () => {
    const runtime = await createAuthenticatorServerRuntimeV0();
    const response = await createAuthenticatorHttpHandlerV0(runtime.browserPort)(
      apiRequest("/api/v0/bootstrap", {}),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    const body = await response.json();
    expect(body.kind).toBe(SIMULATOR_UI_BOOTSTRAP_V0);
    expect(Object.keys(body)).not.toContain("scenario");
    expect(JSON.stringify(body)).not.toContain("signature");
  });

  test("rejects cross-origin, wrong media type, extra fields, and oversized bodies before dispatch", async () => {
    const runtime = await createAuthenticatorServerRuntimeV0();
    const handle = createAuthenticatorHttpHandlerV0(runtime.browserPort);

    const wrongOrigin = await handle(apiRequest("/api/v0/bootstrap", {}, { origin: "https://attacker.invalid" }));
    expect(wrongOrigin.status).toBe(403);
    expect((await wrongOrigin.json()).kind).toBe(SIMULATOR_BROWSER_SESSION_ERROR_V0);

    const wrongType = await handle(new Request(`${AUTHENTICATOR_APP_CONFIG.publicOrigin}/api/v0/bootstrap`, {
      method: "POST",
      headers: { origin: AUTHENTICATOR_APP_CONFIG.publicOrigin, "content-type": "text/plain" },
      body: "{}",
    }));
    expect(wrongType.status).toBe(415);

    const extra = await handle(apiRequest("/api/v0/session/create", {
      idempotencyKey: "create",
      biometricScenario: "happy_path",
    }));
    expect(extra.status).toBe(400);

    const oversized = await handle(new Request(`${AUTHENTICATOR_APP_CONFIG.publicOrigin}/api/v0/bootstrap`, {
      method: "POST",
      headers: {
        origin: AUTHENTICATOR_APP_CONFIG.publicOrigin,
        "content-type": "application/json",
        "content-length": String(AUTHENTICATOR_APP_CONFIG.maxRequestBodyBytes + 1),
      },
      body: "{}",
    }));
    expect(oversized.status).toBe(413);
  });

  test("accepts the exact loopback walkthrough origin without opening CORS", async () => {
    const runtime = await createAuthenticatorServerRuntimeV0();
    const handle = createAuthenticatorHttpHandlerV0(runtime.browserPort);
    const response = await handle(new Request(
      `${AUTHENTICATOR_APP_CONFIG.localWalkthroughOrigin}/api/v0/bootstrap`,
      {
        method: "POST",
        headers: {
          origin: AUTHENTICATOR_APP_CONFIG.localWalkthroughOrigin,
          "content-type": "application/json",
        },
        body: "{}",
      },
    ));
    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });

  test("rejects unknown API routes and traversal with the same security headers", async () => {
    const runtime = await createAuthenticatorServerRuntimeV0();
    const handle = createAuthenticatorHttpHandlerV0(runtime.browserPort);
    const unknown = await handle(apiRequest("/api/v0/not-real", {}));
    expect(unknown.status).toBe(404);
    expect(unknown.headers.get("x-content-type-options")).toBe("nosniff");

    const traversal = await handle(new Request(
      `${AUTHENTICATOR_APP_CONFIG.publicOrigin}/assets/%2e%2e%2fserver/main.ts`,
    ));
    expect(traversal.status).toBe(404);
    expect(traversal.headers.get("cache-control")).toBe("no-store");
  });

  test("serves the complete safe route matrix without scenarios or simulator bodies", async () => {
    const runtime = await createAuthenticatorServerRuntimeV0();
    const handle = createAuthenticatorHttpHandlerV0(runtime.browserPort);
    const bootstrap = await postJson(handle, "/api/v0/bootstrap", {});
    if (!isSimulatorUiBootstrapV0(bootstrap)) {
      throw new Error("bootstrap failed");
    }
    const accountDigest = bootstrap.accountPublicMaterialDigestSha256;
    const created = await postJson(handle, "/api/v0/session/create", { idempotencyKey: "http-create" });
    if (!isSimulatorBrowserSessionViewV0(created)) {
      throw new Error("create failed");
    }
    const createdView = created;
    const demo = await postJson(handle, "/api/v0/session/demo/begin", {
      sessionId: createdView.sessionId,
      browserHandle: createdView.browserHandle,
      idempotencyKey: "http-demo",
    });
    if (!isSimulatorBrowserDemoAuthenticatorReadyV0(demo)) {
      throw new Error("demo failed");
    }
    const completed = await postJson(handle, "/api/v0/session/demo/complete", {
      sessionId: createdView.sessionId,
      browserHandle: createdView.browserHandle,
      idempotencyKey: demo.idempotencyKey,
      completionHandle: demo.completionHandle,
    }) as SimulatorBrowserSessionViewV0;
    const prepared = await postJson(handle, "/api/v0/session/capture/prepare", {
      sessionId: completed.sessionId,
      browserHandle: completed.browserHandle,
    }) as SimulatorBrowserSessionViewV0;
    const submitted = await postJson(handle, "/api/v0/session/capture/submit", {
      sessionId: prepared.sessionId,
      browserHandle: prepared.browserHandle,
      idempotencyKey: "http-capture",
      nonceBase64Url: prepared.nonceBase64Url,
      frameBundle: await frameBundle(prepared, accountDigest),
    });
    expect(JSON.stringify(submitted)).not.toContain("signatureBase64Url");
    expect(JSON.stringify(submitted)).not.toContain("scenario");
    expect(JSON.stringify(submitted)).not.toContain("receiptId");
    const status = await postJson(handle, "/api/v0/session/status", {
      sessionId: prepared.sessionId,
      browserHandle: prepared.browserHandle,
    });
    expect((status as { readonly state: string }).state).toBe("simulated_credential_ready");
    const returned = await postJson(handle, "/api/v0/session/return", {
      sessionId: prepared.sessionId,
      browserHandle: prepared.browserHandle,
    });
    expect(returned).toEqual({
      kind: "simulator_browser_return_accepted_v0",
      version: "simulator_browser_session_port_v0",
      mode: "simulation",
      environment: "staging",
      action: "server_managed",
    });
  });

  test("return route rejects a newly created live session", async () => {
    const runtime = await createAuthenticatorServerRuntimeV0();
    const handle = createAuthenticatorHttpHandlerV0(runtime.browserPort);
    const created = await postJson(handle, "/api/v0/session/create", {
      idempotencyKey: "http-live-return",
    });
    if (!isSimulatorBrowserSessionViewV0(created)) throw new Error("create failed");
    const response = await handle(apiRequest("/api/v0/session/return", {
      sessionId: created.sessionId,
      browserHandle: created.browserHandle,
    }));
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.kind).toBe(SIMULATOR_BROWSER_SESSION_ERROR_V0);
    expect(body.operation).toBe("return_to_rp");
    expect(body.reasonCode).toBe("invalid_state");
  });

  test("serves the walkthrough entry and returned paths from the same app shell", async () => {
    const runtime = await createAuthenticatorServerRuntimeV0();
    const handle = createAuthenticatorHttpHandlerV0(runtime.browserPort, {
      staticRoot: new URL("../dist", import.meta.url).pathname,
    });
    for (const path of ["/demo", "/demo/returned"]) {
      const response = await handle(new Request(`${AUTHENTICATOR_APP_CONFIG.publicOrigin}${path}`));
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/html");
    }
  });

  test("serves only the allowlisted self-hosted MediaPipe runtime files", async () => {
    const runtime = await createAuthenticatorServerRuntimeV0();
    const handle = createAuthenticatorHttpHandlerV0(runtime.browserPort);
    const loader = await handle(new Request(
      `${AUTHENTICATOR_APP_CONFIG.publicOrigin}/mediapipe/vision_wasm_internal.js`,
    ));
    expect(loader.status).toBe(200);
    expect(loader.headers.get("content-type")).toContain("javascript");
    const wasm = await handle(new Request(
      `${AUTHENTICATOR_APP_CONFIG.publicOrigin}/mediapipe/vision_wasm_internal.wasm`,
    ));
    expect(wasm.status).toBe(200);
    expect(wasm.headers.get("content-type")).toBe("application/wasm");
    const unknown = await handle(new Request(
      `${AUTHENTICATOR_APP_CONFIG.publicOrigin}/mediapipe/../package.json`,
    ));
    expect(unknown.status).toBe(404);
  });
});
