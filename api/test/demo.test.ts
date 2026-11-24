import { expect, spyOn, test } from "bun:test";
import { decodeFunctionData, encodeFunctionResult, keccak256, parseAbi, stringToBytes } from "viem";
import { DEMO_REQUEST_PATH, DEMO_VERIFY_PATH, DemoRequestSchema, type DemoRequest } from "../../config/demo";
import { ENVIRONMENTS } from "../../config/environment";
import { handleDemoApi } from "../lib/demo";

const origin = ENVIRONMENTS.staging.appOrigin;
const bindings = {
  DEMO_APP_ID: `app_${"1".repeat(32)}` as const,
  DEMO_RP_ID: "rp_0000000000000001",
  WEB_AUTH_RP_SIGNER: `0x${"1".padStart(64, "0")}`,
  DEMO_WORLDCHAIN_RPC_URL: "https://rpc.example/worldchain",
};
const STAGING_WORLD_ID_VERIFIER = "0x703a6316c975deabf30b637c155edd53e24657db";
const verifierAbi = parseAbi([
  "function getWorldIDRegistry() view returns (address)",
  "function verify(uint256 nullifier, uint256 action, uint64 rpId, uint256 nonce, uint256 signalHash, uint64 expiresAtMin, uint64 issuerSchemaId, uint256 credentialGenesisIssuedAtMin, uint256[5] zeroKnowledgeProof) view",
]);

async function issue(): Promise<DemoRequest> {
  const response = await handleDemoApi(post(DEMO_REQUEST_PATH), "staging", bindings);
  expect(response.status).toBe(200);
  return DemoRequestSchema.parse(await response.json());
}

function post(path: string, body?: object, requestOrigin = origin) {
  return new Request(origin + path, {
    method: "POST", headers: { Origin: requestOrigin, "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
}

test("issues an expiring signed demo request with a fresh action and nonce", async () => {
  expect((await handleDemoApi(post(DEMO_REQUEST_PATH), "production", bindings)).status).toBe(404);
  expect((await handleDemoApi(post(DEMO_REQUEST_PATH, undefined, "https://other.example"), "staging", bindings)).status).toBe(403);
  expect((await handleDemoApi(post(DEMO_REQUEST_PATH), "staging", {})).status).toBe(503);
  for (const rpcUrl of ["invalid URL", "http://rpc.example", "https://user:secret@rpc.example", " https://rpc.example "]) {
    expect((await handleDemoApi(post(DEMO_REQUEST_PATH), "staging", {
      ...bindings, DEMO_WORLDCHAIN_RPC_URL: rpcUrl,
    })).status).toBe(503);
  }
  const [first, second] = await Promise.all([issue(), issue()]);
  expect(first.app_id).toBe(bindings.DEMO_APP_ID);
  expect(first.rp_context.rp_id).toBe(bindings.DEMO_RP_ID);
  expect(first.action).not.toBe(second.action);
  expect(first.rp_context.nonce).not.toBe(second.rp_context.nonce);
  expect(first.rp_context.expires_at - first.rp_context.created_at).toBe(600);
});

test("requires an issued request and verifies the proof with the staging World ID Verifier", async () => {
  const { action, rp_context } = await issue();
  const { action: otherAction, rp_context: otherContext } = await issue();
  const result = {
    protocol_version: "4.0", action, environment: "staging", nonce: rp_context.nonce,
    responses: [{
      identifier: "selfie", issuer_schema_id: 11, proof: ["1", "2", "3", "4", "5"],
      nullifier: `0x${"1".padStart(64, "0")}`, expires_at_min: rp_context.created_at, sybil_score: 10,
    }],
  };
  let proofReply: { result?: string; error?: { code: number; message: string; data: string } } = {
    error: { code: 3, message: "execution reverted", data: "0x" },
  };
  const registryResult = encodeFunctionResult({
    abi: verifierAbi, functionName: "getWorldIDRegistry", result: "0x8556d07D75025f286fe757C7EeEceC40D54FA16D",
  });
  const remote = spyOn(globalThis, "fetch").mockImplementation((async (input, init) => {
    expect(String(input)).toBe(bindings.DEMO_WORLDCHAIN_RPC_URL);
    expect(init?.redirect).toBe("manual");
    const { id, method, params: [call] } = JSON.parse(String(init?.body)) as { id: number; method: string; params: [{ to: string; data: `0x${string}` }] };
    expect(method).toBe("eth_call");
    expect(call.to.toLowerCase()).toBe(STAGING_WORLD_ID_VERIFIER);
    const { functionName, args } = decodeFunctionData({ abi: verifierAbi, data: call.data });
    if (functionName === "getWorldIDRegistry") return Response.json({ jsonrpc: "2.0", id, result: registryResult });
    expect(args).toEqual([
      1n, BigInt(keccak256(stringToBytes(action))) >> 8n, 1n, BigInt(rp_context.nonce),
      0n, BigInt(rp_context.created_at), 11n, 0n, [1n, 2n, 3n, 4n, 5n],
    ]);
    return Response.json({ jsonrpc: "2.0", id, ...proofReply });
  }) as typeof fetch);
  const warn = spyOn(console, "warn").mockImplementation(() => {});
  const error = spyOn(console, "error").mockImplementation(() => {});
  try {
    const selfie = result.responses[0];
    for (const body of [
      { rp_context: otherContext, result },
      { rp_context, result: { ...result, action: otherAction } },
      { rp_context: { ...rp_context, signature: `0x${"0".repeat(130)}` }, result },
      { rp_context, result: { ...result, environment: "production" } },
      { rp_context, result: { ...result, action: "another-action" } },
      { rp_context, result: { ...result, responses: [{ issuer_schema_id: 1 }] } },
      { rp_context, result: { ...result, session_id: "not-a-demo-response" } },
      { rp_context, result: { ...result, responses: [selfie, selfie] } },
      { rp_context, result: { ...result, responses: [{ ...selfie, sybil_score: Number.MAX_SAFE_INTEGER + 1 }] } },
      { rp_context, result: { ...result, responses: [{ ...selfie, proof: ["1", "2", "3", "4", (1n << 256n).toString()] }] } },
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
    remote.mockResolvedValueOnce(Response.json({ jsonrpc: "2.0", id: 0, result: "0x" }));
    expect((await handleDemoApi(post(DEMO_VERIFY_PATH, { rp_context, result }), "staging", bindings)).status).toBe(502);
    expect(remote).toHaveBeenCalledTimes(1);
    expect((await handleDemoApi(post(DEMO_VERIFY_PATH, { rp_context, result }), "staging", bindings)).status).toBe(422);
    expect(warn).toHaveBeenCalledWith("demo_verify_rejected", expect.objectContaining({ rpId: bindings.DEMO_RP_ID }));
    // A redirect is never followed: it fails like any other unusable RPC response.
    for (const status of [307, 429, 503]) {
      remote.mockResolvedValueOnce(new Response(null, { status }));
      const unavailable = await handleDemoApi(post(DEMO_VERIFY_PATH, { rp_context, result }), "staging", bindings);
      expect(unavailable.status).toBe(502);
    }
    expect(error).toHaveBeenCalledWith("demo_verify_unavailable", expect.objectContaining({ rpId: bindings.DEMO_RP_ID }));
    proofReply = {};
    expect((await handleDemoApi(post(DEMO_VERIFY_PATH, { rp_context, result }), "staging", bindings)).status).toBe(502);
    proofReply = { result: "0x" };
    const response = await handleDemoApi(post(DEMO_VERIFY_PATH, {
      rp_context,
      result: { ...result, session_id: null, responses: [{ ...selfie, extra: "additive metadata" }] },
    }), "staging", bindings);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
  } finally {
    remote.mockRestore();
    warn.mockRestore();
    error.mockRestore();
  }
});
