import { afterEach, expect, spyOn, test } from "bun:test";
import { keccak256, stringToHex } from "viem";
import { signedRequest, encryptedRequest } from "../../tests/integration/fixtures/request";
import { loadIncomingRequest, publicRequestUnsupportedReason } from "../lib/incoming-request";
import { parseConnector, returnUrl } from "../lib/connector";
import { parsePayload, validateSignature } from "../lib/proof-request";
import { createProof } from "../lib/prove";
import type { WalletKit } from "../lib/walletkit";
import { proofResponse } from "./fixtures/proof-response";

let restore: (() => void) | undefined;
afterEach(() => { restore?.(); });
const signal = () => new AbortController().signal;
async function fixture(returnToUrl?: string) {
  const { payload, registry } = await signedRequest();
  if (returnToUrl !== undefined) payload.return_to_url = returnToUrl;
  const encrypted = await encryptedRequest(payload);
  const sent: unknown[] = [];
  const requests: string[] = [];
  const mock = spyOn(globalThis, "fetch").mockImplementation((async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input); requests.push(url);
    if (url.startsWith("/api/staging-rp")) return Response.json(registry);
    if (url.includes("/request/")) return Response.json(encrypted.body);
    if (url.includes("/response/")) {
      const wrapper = JSON.parse(String(init?.body));
      const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv: Buffer.from(wrapper.iv, "base64") }, encrypted.key, Buffer.from(wrapper.payload, "base64"));
      sent.push(JSON.parse(new TextDecoder().decode(decrypted)));
      return new Response(null, { status: 204 });
    }
    throw new Error("Unexpected request");
  }) as typeof fetch);
  restore = () => mock.mockRestore();
  return { payload, registry, encrypted, sent, requests };
}
test("fetches, decrypts and validates a real-format RP request; encrypts the matching proof response", async () => {
  const f = await fixture();
  const incoming = await loadIncomingRequest("http://localhost" + f.encrypted.query, signal(), () => {});
  expect(incoming?.proof).toEqual(f.payload.proof_request);
  const response = proofResponse();
  await incoming!.deliver(JSON.stringify(response), signal());
  expect(f.sent).toEqual([{ proof_response: response }]);
  await incoming!.cancel(signal());
  expect(f.sent[1]).toEqual({ error_code: "verification_rejected" });
  await expect(incoming!.deliver(JSON.stringify({ ...response, id: "wrong" }), signal())).rejects.toThrow("mismatched");
});
test("the public flow accepts Selfie requests but rejects other schemas, mixed alternatives and unsupported requirements", async () => {
  const f = await fixture();
  const incoming = (await loadIncomingRequest("http://localhost" + f.encrypted.query, signal(), () => {}))!;
  expect(publicRequestUnsupportedReason(incoming)).toBeUndefined();
  incoming.proof.proof_requests.push({ identifier: "orb", issuer_schema_id: 1 });
  incoming.proof.constraints = { any: [incoming.proof.proof_requests[0]!.identifier, "orb"] };
  expect(publicRequestUnsupportedReason(incoming)).toContain("Selfie Check requests only");
  incoming.proof.proof_requests = [{ identifier: "orb", issuer_schema_id: 1 }];
  expect(publicRequestUnsupportedReason(incoming)).toContain("Selfie Check requests only");
  incoming.proof.proof_requests = [{ identifier: "selfie", issuer_schema_id: 11 }];
  incoming.unsupportedReason = "User presence is not implemented.";
  expect(publicRequestUnsupportedReason(incoming)).toBe(incoming.unsupportedReason);
});
test.each([
  { name: "no callback", payloadUrl: undefined, queryUrl: undefined },
  { name: "an injected query-only callback", payloadUrl: undefined, queryUrl: "https://attacker.example/" },
  { name: "a payload-only callback", payloadUrl: "https://app.example/done", queryUrl: undefined },
  { name: "matching callbacks", payloadUrl: "https://app.example/done", queryUrl: "https://app.example/done" },
])("return navigation uses only the encrypted payload with $name", async ({ payloadUrl, queryUrl }) => {
  const f = await fixture(payloadUrl);
  const query = f.encrypted.query + (queryUrl ? `&return_to=${encodeURIComponent(queryUrl)}` : "");
  const incoming = await loadIncomingRequest("http://localhost" + query, signal(), () => {});
  expect(incoming).not.toBeNull();
  expect(incoming!.returnUrl).toBe(payloadUrl);
});
test("conflicting connector and payload callbacks reject the request", async () => {
  const f = await fixture("https://app.example/done");
  const query = f.encrypted.query + `&return_to=${encodeURIComponent("https://attacker.example/")}`;
  await expect(loadIncomingRequest("http://localhost" + query, signal(), () => {})).rejects.toThrow("return URLs disagree");
});
test("invalid signer and OPRF binding stop a request before wallet access", async () => {
  const f = await fixture(); f.registry.oprfKeyId = "0x2";
  await expect(loadIncomingRequest("http://localhost" + f.encrypted.query, signal(), () => {})).rejects.toThrow("OPRF key");
  f.registry.oprfKeyId = "0x1"; f.registry.signer = `0x${"2".repeat(40)}`;
  await expect(loadIncomingRequest("http://localhost" + f.encrypted.query, signal(), () => {})).rejects.toThrow("signature");
});
test("proof generation revalidates the request and passes its constraints unchanged", async () => {
  const f = await fixture();
  const incoming = (await loadIncomingRequest("http://localhost" + f.encrypted.query, signal(), () => {}))!;
  let serialized = "";
  const wallet = {
    listCredentials: async () => [{ issuerSchemaId: 11n, isExpired: false, expiresAt: BigInt(Math.floor(Date.now()/1000)+3600), genesisIssuedAt: 0n }],
    generateProof: async (json: string) => { serialized = json; return JSON.stringify({ ...proofResponse(), id: incoming.proof.id }); },
    terminate: () => {},
  } as unknown as WalletKit;
  await createProof(incoming, wallet, signal(), () => {});
  expect(JSON.parse(serialized)).toEqual(incoming.proof);
  expect(f.requests.filter(url => url.startsWith("/api/staging-rp"))).toHaveLength(2);
  incoming.unsupportedReason = "User presence required";
  serialized = "";
  await expect(createProof(incoming, wallet, signal(), () => {})).rejects.toThrow("Proof generation failed");
  expect(serialized).toBe("");
});
test("connector rejects unofficial bridges, duplicates, malformed keys and unsafe callbacks", async () => {
  const { payload } = await signedRequest(); const f = await encryptedRequest(payload);
  for (const suffix of ["&i=other", "&b=https://evil.example", "&return_to=javascript:alert(1)"]) {
    expect(() => parseConnector("http://localhost" + f.query + suffix)).toThrow();
  }
  expect(() => parseConnector("http://localhost/?i=bad&k=bad")).toThrow();
  expect(() => returnUrl("https://user:pass@example.com")).toThrow();
  expect(returnUrl("http://localhost:3000/done")).toBe("http://localhost:3000/done");
});
test("payload validation rejects expiry, misleading action and malformed nested requirements", async () => {
  const { payload } = await signedRequest();
  expect(() => parsePayload(JSON.stringify(payload))).not.toThrow();
  expect(() => parsePayload(JSON.stringify({ ...payload, environment: "production" }))).toThrow();
  expect(() => parsePayload(JSON.stringify({ ...payload, action: "another-action" }))).toThrow();
  expect(() => parsePayload(JSON.stringify({ ...payload, return_to_url: 4 }))).toThrow();
  for (const overrides of [{ expires_at: 1 }, { constraints: "unknown" }, { constraints: { any: [] } }, { constraints: { all: ["credential"], extra: true } }]) {
    expect(() => parsePayload(JSON.stringify({ ...payload, proof_request: { ...payload.proof_request, ...overrides } }))).toThrow();
  }
});

test("payload schemas preserve nullish fields and additive RP metadata", async () => {
  const { payload } = await signedRequest();
  const wire = {
    ...payload,
    require_user_presence: false,
    identity_attributes: null,
    return_to_url: "",
    extension: { version: 2 },
    proof_request: {
      ...payload.proof_request,
      session_id: undefined,
      extension: { nested: true },
      proof_requests: [{
        ...payload.proof_request.proof_requests[0],
        signal: null, genesis_issued_at_min: null, expires_at_min: null,
        extension: ["retained"],
      }],
    },
  };
  for (const input of [
    wire,
    { ...wire, identity_attributes: undefined, proof_request: { ...wire.proof_request, session_id: null, constraints: null } },
    { ...wire, identity_attributes: [{ nested: [false, null, 3, ""] }], proof_request: { ...wire.proof_request, constraints: undefined } },
  ]) {
    const json = JSON.stringify(input);
    expect(parsePayload(json)).toStrictEqual(JSON.parse(json));
  }
});

test("payload schemas retain UTF-16 string limits and bounded integer requirements", async () => {
  const { payload } = await signedRequest();
  for (const length of [512, 513]) {
    const action = "😀".repeat(length);
    const signedAction = `0x${(BigInt(keccak256(stringToHex(action))) >> 8n).toString(16).padStart(64, "0")}`;
    const json = JSON.stringify({ ...payload, action, proof_request: { ...payload.proof_request, action: signedAction } });
    if (length === 512) expect(() => parsePayload(json)).not.toThrow();
    else expect(() => parsePayload(json)).toThrow("Malformed World ID request metadata.");
  }
  for (const length of [64, 65]) {
    const json = JSON.stringify({ ...payload, proof_request: { ...payload.proof_request, id: "😀".repeat(length) } });
    if (length === 64) expect(() => parsePayload(json)).not.toThrow();
    else expect(() => parsePayload(json)).toThrow("Malformed World ID request metadata.");
  }
  for (const requirement of [
    { identifier: "credential", issuer_schema_id: Number.MAX_SAFE_INTEGER + 1 },
    { identifier: "credential", issuer_schema_id: -1 },
    { identifier: "credential", issuer_schema_id: 1.5 },
    { identifier: "credential", issuer_schema_id: 11, signal: "0x" + "ab".repeat(2049) },
    { identifier: "credential", issuer_schema_id: 11, expires_at_min: -1 },
  ]) {
    expect(() => parsePayload(JSON.stringify({ ...payload, proof_request: { ...payload.proof_request, proof_requests: [requirement] } })))
      .toThrow("Malformed credential requirement.");
  }
  const duplicate = Array(2).fill(payload.proof_request.proof_requests[0]);
  expect(() => parsePayload(JSON.stringify({ ...payload, proof_request: { ...payload.proof_request, proof_requests: duplicate } })))
    .toThrow("Malformed credential requirement.");
});

test("constraint validation enforces node and depth budgets before descending", async () => {
  const { payload } = await signedRequest();
  const parse = (constraints: unknown) => parsePayload(JSON.stringify({ ...payload, proof_request: { ...payload.proof_request, constraints } }));
  expect(() => parse({ all: Array(63).fill("credential") })).not.toThrow();
  expect(() => parse({ all: Array(64).fill("credential") })).toThrow("Credential constraints exceed supported limits.");
  let constraints: unknown = "credential";
  for (let depth = 1; depth <= 100; depth++) {
    constraints = { any: [constraints] };
    if (depth === 8) expect(() => parse(constraints)).not.toThrow();
    if (depth === 9 || depth === 100) expect(() => parse(constraints)).toThrow("Credential constraints exceed supported limits.");
  }
  expect(() => parse({ all: ["credential"], metadata: true })).toThrow("Invalid credential constraints.");
});

test("payload schema failures keep the existing error precedence and field messages", async () => {
  const { payload } = await signedRequest();
  for (const [change, message] of [
    [{ proof_request: { ...payload.proof_request, version: 2 }, app_id: null }, "Only World ID 4.0 uniqueness requests"],
    [{ action: "misleading", proof_request: { ...payload.proof_request, proof_requests: [] } }, "The displayed action does not match the signed action."],
    [{ proof_request: { ...payload.proof_request, proof_requests: [] } }, "Invalid credential requirements."],
    [{ proof_request: { ...payload.proof_request, proof_requests: Array(33).fill(null) } }, "Invalid credential requirements."],
    [{ require_user_presence: null }, "Invalid user presence requirement."],
    [{ identity_attributes: {} }, "Invalid identity attribute requirements."],
    [{ return_to_url: null }, "Invalid return URL."],
  ] as const) {
    expect(() => parsePayload(JSON.stringify({ ...payload, ...change }))).toThrow(message);
  }
});

test("malformed RP registry fields retain the safe registry error", async () => {
  const { payload } = await signedRequest();
  const mock = spyOn(globalThis, "fetch");
  restore = () => mock.mockRestore();
  for (const registry of [null, [], { signer: "private-text", oprfKeyId: "0x1" }, { signer: `0x${"1".repeat(40)}`, oprfKeyId: 1 }]) {
    mock.mockResolvedValue(Response.json(registry));
    await expect(validateSignature(payload.proof_request, signal())).rejects.toThrow("Invalid RP registry response.");
  }
});


test("production accepts only production payloads and verifies the production RP endpoint", async () => {
  const { payload, registry } = await signedRequest();
  const json = (environment: string) => JSON.stringify({ ...payload, environment });
  expect(() => parsePayload(json("production"), "production")).not.toThrow();
  for (const environment of ["staging", "sandbox", "unknown"]) {
    expect(() => parsePayload(json(environment), "production")).toThrow("production requests only");
  }
  expect(() => parsePayload(json("sandbox"), "staging")).not.toThrow();
  expect(() => parsePayload(json("production"), "staging")).toThrow("staging requests only");
  const mock = spyOn(globalThis, "fetch").mockImplementation((async input => {
    expect(String(input)).toBe("/api/rp?id=rp_1");
    return Response.json(registry);
  }) as typeof fetch);
  restore = () => mock.mockRestore();
  await validateSignature(payload.proof_request, signal(), "production");
  expect(mock).toHaveBeenCalledTimes(1);
});
