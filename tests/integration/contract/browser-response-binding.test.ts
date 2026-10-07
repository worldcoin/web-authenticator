import { describe, expect, test } from "bun:test";
import {
  SIMULATION_ENVIRONMENT,
  SIMULATION_MODE,
  SIMULATOR_BROWSER_SESSION_ERROR_V0,
  SIMULATOR_BROWSER_SESSION_PORT_V0,
  SIMULATOR_BROWSER_SESSION_VIEW_V0,
  SIMULATOR_UI_CAPTURE_POLICY_TEMPLATE_V0,
  type SimulatorBrowserSessionViewV0,
} from "@clean-start/contracts";
import { HttpSimulatorBrowserSessionClientV0 } from "../../../apps/authenticator/src/adapters/http-session";

const expiresAt = "2030-01-01T00:00:00.000Z";

function view(sessionId: string, browserHandle: string): SimulatorBrowserSessionViewV0 {
  return {
    kind: SIMULATOR_BROWSER_SESSION_VIEW_V0,
    version: SIMULATOR_BROWSER_SESSION_PORT_V0,
    mode: SIMULATION_MODE,
    environment: SIMULATION_ENVIRONMENT,
    sessionId,
    browserHandle,
    nonceBase64Url: "nonce",
    state: "capture_ready",
    code: "capture_ready",
    retryable: false,
    expiresAt,
    capturePolicy: { ...SIMULATOR_UI_CAPTURE_POLICY_TEMPLATE_V0, expiresAt },
    artifactSummary: null,
  };
}

describe("browser response request-window binding", () => {
  test("collapses a valid but cross-session server response to a safe error", async () => {
    const fetcher = async () => new Response(JSON.stringify(view("session-b", "handle-b")), {
      headers: { "content-type": "application/json" },
    });
    const client = new HttpSimulatorBrowserSessionClientV0(
      fetcher,
      "https://auth.example.test",
      () => new Date("2026-09-03T00:00:00.000Z"),
    );
    const result = await client.getStatus({
      sessionId: "session-a",
      browserHandle: "handle-a",
    });
    expect(result).toEqual({
      kind: SIMULATOR_BROWSER_SESSION_ERROR_V0,
      version: SIMULATOR_BROWSER_SESSION_PORT_V0,
      mode: SIMULATION_MODE,
      environment: SIMULATION_ENVIRONMENT,
      operation: "get_status",
      reasonCode: "response_invalid",
    });
  });

  test("never follows redirects and sends only same-origin JSON without query fields", async () => {
    const observed: { url?: string; init?: RequestInit } = {};
    const client = new HttpSimulatorBrowserSessionClientV0(async (input, init) => {
      observed.url = String(input);
      observed.init = init;
      return new Response(JSON.stringify({
        kind: SIMULATOR_BROWSER_SESSION_ERROR_V0,
        version: SIMULATOR_BROWSER_SESSION_PORT_V0,
        mode: SIMULATION_MODE,
        environment: SIMULATION_ENVIRONMENT,
        operation: "get_status",
        reasonCode: "not_found",
      }), { headers: { "content-type": "application/json" } });
    }, "https://auth.example.test");
    await client.getStatus({ sessionId: "session", browserHandle: "opaque" });
    expect(observed.url).toBe("https://auth.example.test/api/v0/session/status");
    expect(new URL(observed.url!).search).toBe("");
    expect(observed.init).toMatchObject({
      method: "POST",
      cache: "no-store",
      credentials: "same-origin",
      redirect: "error",
    });
    expect(JSON.parse(String(observed.init?.body))).toEqual({
      sessionId: "session",
      browserHandle: "opaque",
    });
  });
});
