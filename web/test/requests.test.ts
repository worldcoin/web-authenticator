import { afterEach, expect, spyOn, test } from "bun:test";
import { signedRequest, encryptedRequest } from "../../tests/integration/fixtures/request";
import { loadIncomingRequest, publicRequestUnsupportedReason } from "../lib/incoming-request";
import { parseConnector, returnUrl } from "../lib/connector";
import { parsePayload } from "../lib/proof-request";
import { createProof } from "../lib/prove";
import type { WalletKit } from "../lib/walletkit";

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
  const response = { id: "test-request", responses: [{ issuer_schema_id: 11, proof: "test-proof" }] };
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
    generateProof: async (json: string) => { serialized = json; return JSON.stringify({ id: incoming.proof.id, responses: [{}] }); },
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
