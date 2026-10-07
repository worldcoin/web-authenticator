import { describe, expect, test } from "bun:test";
import {
  SIMULATION_ENVIRONMENT,
  SIMULATION_MODE,
  SIMULATOR_BROWSER_SESSION_ERROR_V0,
  SIMULATOR_BROWSER_SESSION_PORT_V0,
  SIMULATOR_BROWSER_SESSION_VIEW_V0,
  SIMULATOR_BROWSER_DEMO_AUTHENTICATOR_READY_V0,
  SIMULATOR_UI_BOOTSTRAP_V0,
  SIMULATOR_UI_CAPTURE_POLICY_TEMPLATE_V0,
  SIMULATOR_UI_QUALITY_POLICY_V0,
  type SimulatorBrowserSessionViewV0,
} from "@clean-start/contracts";
import { HttpSimulatorBrowserSessionClientV0 } from "../src/adapters/http-session";

describe("same-origin browser session client", () => {
  test("uses the frozen route and never adds a browser-selected scenario", async () => {
    const requests: Request[] = [];
    const client = new HttpSimulatorBrowserSessionClientV0(async (input, init) => {
      const request = new Request(input, init);
      requests.push(request.clone());
      return new Response(JSON.stringify({
        kind: SIMULATOR_UI_BOOTSTRAP_V0,
        version: SIMULATOR_BROWSER_SESSION_PORT_V0,
        mode: SIMULATION_MODE,
        environment: SIMULATION_ENVIRONMENT,
        rpPresentationId: "zoom_demo",
        accountPublicMaterialDigestSha256: "0".repeat(64),
        returnAction: "server_managed",
        authenticator: {
          kind: "injected_demo_only",
          webauthnPerformed: false,
          prfEvaluated: false,
          worldIdCreated: false,
        },
        qualityPolicy: SIMULATOR_UI_QUALITY_POLICY_V0,
      }), { headers: { "content-type": "application/json" } });
    }, "http://127.0.0.1:4173");

    const result = await client.bootstrap();
    expect(result.kind).toBe(SIMULATOR_UI_BOOTSTRAP_V0);
    expect(new URL(requests[0]!.url).pathname).toBe("/api/v0/bootstrap");
    const body = await requests[0]!.json();
    expect(body).toEqual({});
    expect(JSON.stringify(body)).not.toContain("scenario");
  });

  test("converts malformed responses and network failures to strict stable envelopes", async () => {
    const malformed = new HttpSimulatorBrowserSessionClientV0(
      async () => new Response(JSON.stringify({ unsafe: "upstream detail" })),
      "http://127.0.0.1:4173",
    );
    expect(await malformed.bootstrap()).toEqual({
      kind: SIMULATOR_BROWSER_SESSION_ERROR_V0,
      version: SIMULATOR_BROWSER_SESSION_PORT_V0,
      mode: SIMULATION_MODE,
      environment: SIMULATION_ENVIRONMENT,
      operation: "bootstrap",
      reasonCode: "response_invalid",
    });

    const offline = new HttpSimulatorBrowserSessionClientV0(async () => {
      throw new Error("private upstream text");
    }, "http://127.0.0.1:4173");
    const result = await offline.createSession({ idempotencyKey: "create" });
    expect(result.kind).toBe(SIMULATOR_BROWSER_SESSION_ERROR_V0);
    if (result.kind === SIMULATOR_BROWSER_SESSION_ERROR_V0) {
      expect(result.reasonCode).toBe("network_unavailable");
      expect(JSON.stringify(result)).not.toContain("private upstream text");
    }
  });

  test("rejects a valid session-B projection for active session A", async () => {
    const response: SimulatorBrowserSessionViewV0 = {
      kind: SIMULATOR_BROWSER_SESSION_VIEW_V0,
      version: SIMULATOR_BROWSER_SESSION_PORT_V0,
      mode: SIMULATION_MODE,
      environment: SIMULATION_ENVIRONMENT,
      sessionId: "session-b",
      browserHandle: "handle-b",
      nonceBase64Url: "nonce-b",
      state: "capture_ready",
      code: "capture_ready",
      retryable: false,
      expiresAt: "2030-01-01T00:00:00.000Z",
      capturePolicy: {
        ...SIMULATOR_UI_CAPTURE_POLICY_TEMPLATE_V0,
        expiresAt: "2030-01-01T00:00:00.000Z",
      },
      artifactSummary: null,
    };
    const client = new HttpSimulatorBrowserSessionClientV0(
      async () => new Response(JSON.stringify(response), {
        headers: { "content-type": "application/json" },
      }),
      "http://127.0.0.1:4173",
      () => new Date("2029-01-01T00:00:00.000Z"),
    );
    const result = await client.getStatus({ sessionId: "session-a", browserHandle: "handle-a" });
    expect(result).toEqual({
      kind: SIMULATOR_BROWSER_SESSION_ERROR_V0,
      version: SIMULATOR_BROWSER_SESSION_PORT_V0,
      mode: SIMULATION_MODE,
      environment: SIMULATION_ENVIRONMENT,
      operation: "get_status",
      reasonCode: "response_invalid",
    });
  });

  test("rejects demo-ready responses with a changed session or idempotency binding", async () => {
    const ready = {
      kind: SIMULATOR_BROWSER_DEMO_AUTHENTICATOR_READY_V0,
      version: SIMULATOR_BROWSER_SESSION_PORT_V0,
      mode: SIMULATION_MODE,
      environment: SIMULATION_ENVIRONMENT,
      sessionId: "session-b",
      idempotencyKey: "demo-b",
      completionHandle: "opaque",
      claims: {
        webauthnPerformed: false,
        prfEvaluated: false,
        worldIdCreated: false,
      },
      expiresAt: "2030-01-01T00:00:00.000Z",
    } as const;
    const client = new HttpSimulatorBrowserSessionClientV0(
      async () => new Response(JSON.stringify(ready), {
        headers: { "content-type": "application/json" },
      }),
      "http://127.0.0.1:4173",
      () => new Date("2029-01-01T00:00:00.000Z"),
    );
    const result = await client.beginDemoAuthenticator({
      sessionId: "session-a",
      browserHandle: "handle-a",
      idempotencyKey: "demo-a",
    });
    expect(result.kind).toBe(SIMULATOR_BROWSER_SESSION_ERROR_V0);
    if (result.kind === SIMULATOR_BROWSER_SESSION_ERROR_V0) {
      expect(result.operation).toBe("begin_demo_authenticator");
      expect(result.reasonCode).toBe("response_invalid");
    }
  });

  test("rejects expired projections and an error envelope for the wrong operation", async () => {
    const expired: SimulatorBrowserSessionViewV0 = {
      kind: SIMULATOR_BROWSER_SESSION_VIEW_V0,
      version: SIMULATOR_BROWSER_SESSION_PORT_V0,
      mode: SIMULATION_MODE,
      environment: SIMULATION_ENVIRONMENT,
      sessionId: "session-a",
      browserHandle: "handle-a",
      nonceBase64Url: "nonce-a",
      state: "capture_ready",
      code: "capture_ready",
      retryable: false,
      expiresAt: "2030-01-01T00:00:00.000Z",
      capturePolicy: {
        ...SIMULATOR_UI_CAPTURE_POLICY_TEMPLATE_V0,
        expiresAt: "2030-01-01T00:00:00.000Z",
      },
      artifactSummary: null,
    };
    const expiredClient = new HttpSimulatorBrowserSessionClientV0(
      async () => new Response(JSON.stringify(expired), {
        headers: { "content-type": "application/json" },
      }),
      "http://127.0.0.1:4173",
      () => new Date("2031-01-01T00:00:00.000Z"),
    );
    const expiredResult = await expiredClient.getStatus({
      sessionId: "session-a",
      browserHandle: "handle-a",
    });
    expect(expiredResult.kind).toBe(SIMULATOR_BROWSER_SESSION_ERROR_V0);
    if (expiredResult.kind === SIMULATOR_BROWSER_SESSION_ERROR_V0) {
      expect(expiredResult.reasonCode).toBe("response_invalid");
    }

    const wrongOperationClient = new HttpSimulatorBrowserSessionClientV0(
      async () => new Response(JSON.stringify({
        kind: SIMULATOR_BROWSER_SESSION_ERROR_V0,
        version: SIMULATOR_BROWSER_SESSION_PORT_V0,
        mode: SIMULATION_MODE,
        environment: SIMULATION_ENVIRONMENT,
        operation: "cancel",
        reasonCode: "invalid_state",
      }), { headers: { "content-type": "application/json" } }),
      "http://127.0.0.1:4173",
    );
    const wrongOperation = await wrongOperationClient.getStatus({
      sessionId: "session-a",
      browserHandle: "handle-a",
    });
    expect(wrongOperation).toEqual({
      kind: SIMULATOR_BROWSER_SESSION_ERROR_V0,
      version: SIMULATOR_BROWSER_SESSION_PORT_V0,
      mode: SIMULATION_MODE,
      environment: SIMULATION_ENVIRONMENT,
      operation: "get_status",
      reasonCode: "response_invalid",
    });
  });
});
