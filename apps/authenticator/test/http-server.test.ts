import { expect, test } from "bun:test";
import { createAuthenticatorHttpHandler } from "../src/server/http.server";
import { AUTHENTICATOR_APP_CONFIG, AUTHENTICATOR_APP_SECURITY_HEADERS_V0 } from "../../../config/authenticator-app-v0";
const handler = createAuthenticatorHttpHandler();
const origin = AUTHENTICATOR_APP_CONFIG.localOrigin;
const post = (body: unknown, headerOrigin = origin, pathOrigin = origin) => handler(new Request(`${pathOrigin}/api/selfie-credential`, {
  method: "POST", headers: { origin: headerOrigin, "content-type": "application/json" }, body: JSON.stringify(body),
}));
test("embedded demo routes and simulated endpoints are gone", async () => {
  for (const path of ["/demo", "/returned", "/api/v0/bootstrap", "/api/v0/session/create"]) {
    expect((await handler(new Request(origin + path))).status).toBe(404);
  }
});
test("synthetic issuance rejects other origins and non-loopback hosts before issuing", async () => {
  const body = { sub: "0x" + "a".repeat(64), token: "b".repeat(64) };
  expect((await post(body, "https://other.example")).status).toBe(403);
  expect((await post(body, "https://auth.example", "https://auth.example")).status).toBe(403);
});
test("issuance rejects malformed subjects, tokens, types and oversized bodies", async () => {
  for (const body of [null, {}, { sub: ["0x" + "a".repeat(64)], token: "b".repeat(64) }, { sub: "0x01", token: "abc" }, { excess: "x".repeat(2000) }]) {
    expect((await post(body)).status).toBe(400);
  }
});
test("RP lookup rejects malformed identifiers without a remote call", async () => {
  expect((await handler(new Request(origin + "/api/staging-rp?id=bad"))).status).toBe(400);
});
test("all responses include no-referrer/no-store and bounded CSP destinations", async () => {
  const response = await handler(new Request(origin + "/api/missing"));
  for (const [name, value] of Object.entries(AUTHENTICATOR_APP_SECURITY_HEADERS_V0)) expect(response.headers.get(name)).toBe(value);
  expect(response.headers.get("content-security-policy")).toContain("https://staging-bridge.worldcoin.org");
  expect(response.headers.get("content-security-policy")).not.toContain("connect-src *");
});
