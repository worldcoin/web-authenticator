import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAuthenticatorHttpHandler } from "../src/http";
import { AUTHENTICATOR_APP_CONFIG, AUTHENTICATOR_APP_SECURITY_HEADERS_V0 } from "../src/config";
const handler = createAuthenticatorHttpHandler();
const origin = `http://localhost:${AUTHENTICATOR_APP_CONFIG.port}`;
const post = (body: unknown, headerOrigin = origin, pathOrigin = origin) => handler(new Request(`${pathOrigin}/api/selfie-credential`, {
  method: "POST", headers: { origin: headerOrigin, "content-type": "application/json" }, body: JSON.stringify(body),
}));
test("serves web assets and HEAD responses with security headers", async () => {
  const staticRoot = await mkdtemp(join(tmpdir(), "authenticator-assets-"));
  try {
    await writeFile(join(staticRoot, "index.html"), "<h1>Authenticator</h1>");
    await writeFile(join(staticRoot, "app.js"), "export const ready = true;");
    const serve = createAuthenticatorHttpHandler({ staticRoot });
    const page = await serve(new Request(origin));
    expect(page.status).toBe(200);
    expect(page.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(await page.text()).toContain("Authenticator");
    const head = await serve(new Request(origin + "/app.js", { method: "HEAD" }));
    expect(head.status).toBe(200);
    expect(head.headers.get("content-type")).toBe("text/javascript; charset=utf-8");
    expect(head.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await head.text()).toBe("");
    expect((await serve(new Request(origin + "/missing.js"))).status).toBe(404);
  } finally {
    await rm(staticRoot, { recursive: true, force: true });
  }
});
test("embedded demo routes and simulated endpoints are gone", async () => {
  for (const path of ["/demo", "/returned", "/api/v0/bootstrap", "/api/v0/session/create"]) {
    expect((await handler(new Request(origin + path))).status).toBe(404);
  }
});
test("synthetic enrollment is absent even for valid localhost requests", async () => {
  const body = { sub: "0x" + "a".repeat(64), token: "b".repeat(64) };
  expect((await post(body)).status).toBe(404);
  expect((await post(body, "https://other.example")).status).toBe(404);
  expect((await post(body, "https://auth.example", "https://auth.example")).status).toBe(404);
  expect((await handler(new Request(origin + "/api/capabilities"))).status).toBe(404);
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
