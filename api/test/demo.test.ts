import { expect, spyOn, test } from "bun:test";
import { DEMO_ACTION, DEMO_REQUEST_PATH, DEMO_VERIFY_PATH, DemoRequestSchema, type DemoRequest } from "../../config/demo";
import { ENVIRONMENTS } from "../../config/environment";
import { handleDemoApi } from "../lib/demo";

const origin = ENVIRONMENTS.staging.appOrigin;
const bindings = {
  DEMO_APP_ID: `app_${"1".repeat(32)}` as const,
  DEMO_RP_ID: "rp_0000000000000001",
  IDKIT_EXAMPLE_RP_SIGNING_KEY: `0x${"1".padStart(64, "0")}`,
  DEMO_VERIFY_ORIGIN: "https://staging-verifier.example",
};

function post(path: string, body?: object, requestOrigin = origin) {
  return new Request(origin + path, {
    method: "POST", headers: { Origin: requestOrigin, "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
}

async function issue(): Promise<DemoRequest> {
  const response = await handleDemoApi(post(DEMO_REQUEST_PATH), "staging", bindings);
  expect(response.status).toBe(200);
  return DemoRequestSchema.parse(await response.json());
}

test("serves expiring demo contexts on staging with a fresh nonce each time", async () => {
  expect((await handleDemoApi(post(DEMO_REQUEST_PATH), "production", bindings)).status).toBe(404);
  expect((await handleDemoApi(post(DEMO_REQUEST_PATH, undefined, "https://other.example"), "staging", bindings)).status).toBe(403);
  expect((await handleDemoApi(post(DEMO_REQUEST_PATH), "staging", {})).status).toBe(503);
  for (const verifyOrigin of ["invalid URL", "http://verifier.example", "https://verifier.example/path", " https://verifier.example "]) {
    expect((await handleDemoApi(post(DEMO_REQUEST_PATH), "staging", {
      ...bindings, DEMO_VERIFY_ORIGIN: verifyOrigin,
    })).status).toBe(503);
  }
  const first = await issue(), second = await issue();
  expect(first.app_id).toBe(bindings.DEMO_APP_ID);
  expect(first.rp_context.rp_id).toBe(bindings.DEMO_RP_ID);
  expect(first.rp_context.nonce).not.toBe(second.rp_context.nonce);
  expect(first.rp_context.expires_at - first.rp_context.created_at).toBe(600);
});

test("requires an issued request and a successful upstream proof verdict", async () => {
  const { rp_context } = await issue();
  const { rp_context: otherContext } = await issue();
  const result = {
    protocol_version: "4.0", action: DEMO_ACTION, environment: "staging", nonce: rp_context.nonce,
    responses: [{
      identifier: "selfie", issuer_schema_id: 11, proof: ["1", "2", "3", "4", "5"],
      nullifier: `0x${"1".padStart(64, "0")}`, expires_at_min: rp_context.created_at, sybil_score: 10,
    }],
  };
  let accepted = false;
  const remote = spyOn(globalThis, "fetch").mockImplementation((async (input, init) => {
    expect(String(input)).toBe(`${bindings.DEMO_VERIFY_ORIGIN}/api/v4/verify/${bindings.DEMO_RP_ID}`);
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({ ...result, min_protocol_version: "4.0" });
    return Response.json({ success: accepted });
  }) as typeof fetch);
  try {
    const selfie = result.responses[0];
    for (const body of [
      { rp_context: otherContext, result },
      { rp_context: { ...rp_context, signature: `0x${"0".repeat(130)}` }, result },
      { rp_context, result: { ...result, environment: "production" } },
      { rp_context, result: { ...result, action: "another-action" } },
      { rp_context, result: { ...result, responses: [{ issuer_schema_id: 1 }] } },
      { rp_context, result: { ...result, session_id: "not-a-demo-response" } },
      { rp_context, result: { ...result, responses: [selfie, selfie] } },
      { rp_context, result: { ...result, responses: [{ ...selfie, sybil_score: Number.MAX_SAFE_INTEGER + 1 }] } },
    ]) {
      expect((await handleDemoApi(post(DEMO_VERIFY_PATH, body), "staging", bindings)).status).toBe(400);
    }
    const clock = spyOn(Date, "now").mockReturnValue(rp_context.expires_at * 1000);
    try {
      expect((await handleDemoApi(post(DEMO_VERIFY_PATH, { rp_context, result }), "staging", bindings)).status).toBe(400);
    } finally {
      clock.mockRestore();
    }
    expect(remote).not.toHaveBeenCalled();
    expect((await handleDemoApi(post(DEMO_VERIFY_PATH, { rp_context, result }), "staging", bindings)).status).toBe(422);
    for (const status of [429, 503]) {
      remote.mockResolvedValueOnce(new Response(null, { status }));
      const unavailable = await handleDemoApi(post(DEMO_VERIFY_PATH, { rp_context, result }), "staging", bindings);
      expect(unavailable.status).toBe(502);
    }
    accepted = true;
    const response = await handleDemoApi(post(DEMO_VERIFY_PATH, {
      rp_context,
      result: { ...result, session_id: null, responses: [{ ...selfie, extra: "additive metadata" }] },
    }), "staging", bindings);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
  } finally {
    remote.mockRestore();
  }
});
