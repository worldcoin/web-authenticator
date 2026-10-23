import { afterAll, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AUTHENTICATOR_APP_SECURITY_HEADERS_V0 } from "../lib/config";
import { secureRoutes } from "../lib/http";
import { createServerOptions } from "../server";
const servers: ReturnType<typeof Bun.serve>[] = [];
const start = (options: Parameters<typeof createServerOptions>[0] = {}) => {
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, ...createServerOptions(options) });
  servers.push(server);
  return server.url.origin;
};
afterAll(() => Promise.all(servers.map(server => server.stop(true))));
const origin = start();
const get = (path: string, init?: RequestInit) => fetch(origin + path, { redirect: "manual", ...init });
const expectSecurityHeaders = (response: Response) => {
  for (const [name, value] of Object.entries(AUTHENTICATOR_APP_SECURITY_HEADERS_V0)) expect(response.headers.get(name)).toBe(value);
};
test("serves web assets and HEAD responses with security headers", async () => {
  const staticRoot = await mkdtemp(join(tmpdir(), "authenticator-assets-"));
  try {
    await writeFile(join(staticRoot, "index.html"), "<h1>Authenticator</h1>");
    await writeFile(join(staticRoot, "app.js"), "export const ready = true;");
    const assets = start({ staticRoot });
    const page = await fetch(assets + "/index.html");
    expect(page.status).toBe(200);
    expect(page.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(await page.text()).toContain("Authenticator");
    const head = await fetch(assets + "/app.js", { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(head.headers.get("content-type")).toBe("text/javascript; charset=utf-8");
    expectSecurityHeaders(head);
    expect(await head.text()).toBe("");
    expect((await fetch(assets + "/missing.js")).status).toBe(404);
    expect((await fetch(assets + "/app.js", { method: "POST" })).status).toBe(405);
  } finally {
    await rm(staticRoot, { recursive: true, force: true });
  }
});
test("the bare origin redirects to world.org temporarily and never forwards the query", async () => {
  const staticRoot = await mkdtemp(join(tmpdir(), "authenticator-root-"));
  try {
    await writeFile(join(staticRoot, "index.html"), "<h1>Authenticator</h1>");
    const app = start({ staticRoot });
    for (const path of ["/", "/?t=wld&i=550e8400-e29b-41d4-a716-446655440000&k=a%2Bb%2Fc%3D"]) {
      for (const method of ["GET", "HEAD"]) {
        const response = await fetch(app + path, { method, redirect: "manual" });
        expect(response.status).toBe(302);
        expect(response.headers.get("location")).toBe("https://world.org/");
        expectSecurityHeaders(response);
      }
    }
    expect((await fetch(app + "/", { method: "POST" })).status).toBe(405);
  } finally {
    await rm(staticRoot, { recursive: true, force: true });
  }
});

test("verify links serve the app directly, without a redirect that repeats the bridge key", async () => {
  const staticRoot = await mkdtemp(join(tmpdir(), "authenticator-verify-"));
  try {
    await writeFile(join(staticRoot, "index.html"), "<h1>Authenticator</h1>");
    const app = start({ staticRoot });
    const query = "?t=wld&i=550e8400-e29b-41d4-a716-446655440000&k=a%2Bb%2Fc%3D&b=https%3A%2F%2Fstaging-bridge.worldcoin.org";
    for (const method of ["GET", "HEAD"]) {
      const response = await fetch(`${app}/verify${query}`, { method, redirect: "manual" });
      expect(response.status).toBe(200);
      expect(response.headers.get("location")).toBeNull();
      expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
      expect(await response.text()).toBe(method === "GET" ? "<h1>Authenticator</h1>" : "");
      expectSecurityHeaders(response);
    }
    expect((await fetch(`${app}/verify${query}`, { method: "POST" })).status).toBe(405);
  } finally {
    await rm(staticRoot, { recursive: true, force: true });
  }
});
test("embedded demo routes and simulated endpoints are gone", async () => {
  for (const path of ["/demo", "/returned", "/api/v0/bootstrap", "/api/v0/session/create"]) {
    expect((await get(path)).status).toBe(404);
  }
});
test("synthetic enrollment is absent even for valid localhost requests", async () => {
  const body = { sub: "0x" + "a".repeat(64), token: "b".repeat(64) };
  for (const path of ["/api/faux-credential", "/api/selfie-credential"]) {
    for (const headerOrigin of [origin, "https://other.example"]) {
      const response = await get(path, {
        method: "POST", headers: { origin: headerOrigin, "content-type": "application/json" }, body: JSON.stringify(body),
      });
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "Not found" });
    }
  }
  expect((await get("/api/capabilities")).status).toBe(404);
});
test("RP lookup rejects malformed identifiers without a remote call", async () => {
  const response = await get("/api/staging-rp?id=bad");
  expect(response.status).toBe(400);
  expectSecurityHeaders(response);
});
test("API routes reject other methods as JSON 404 instead of serving the web app", async () => {
  for (const path of ["/api/staging-rp?id=rp_1", "/api/health/live"]) {
    const response = await get(path, { method: "POST" });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Not found" });
    expectSecurityHeaders(response);
  }
});
test("liveness ignores dependencies and readiness fails without the web bundle", async () => {
  const live = await get("/api/health/live");
  expect(live.status).toBe(200);
  expect(await live.json()).toEqual({ status: "ok" });
  expectSecurityHeaders(live);
  const emptyRoot = await mkdtemp(join(tmpdir(), "authenticator-empty-"));
  try {
    const unready = start({ staticRoot: emptyRoot });
    const ready = await fetch(unready + "/api/health/ready");
    expect(ready.status).toBe(503);
    expect(await ready.json()).toEqual({ status: "unavailable", failed: ["web_bundle"] });
    expect((await fetch(unready + "/api/health/live")).status).toBe(200);
    await writeFile(join(emptyRoot, "index.html"), "<h1>Authenticator</h1>");
    expect((await fetch(unready + "/api/health/ready")).status).toBe(200);
  } finally {
    await rm(emptyRoot, { recursive: true, force: true });
  }
});
test("security headers apply to responses with immutable headers", async () => {
  const routes = secureRoutes({ "/x": () => Response.redirect("https://example.com", 302) });
  const handler = routes["/x"];
  if (typeof handler !== "function") throw new Error("expected a handler");
  const response = await handler(new Request(origin + "/x"));
  expect(response.status).toBe(302);
  expectSecurityHeaders(response);
});
test("all responses include no-referrer/no-store and bounded CSP destinations", async () => {
  const response = await get("/api/missing");
  expectSecurityHeaders(response);
  expect(response.headers.get("content-security-policy")).toContain("https://staging-bridge.worldcoin.org");
  expect(response.headers.get("content-security-policy")).not.toContain("connect-src *");
});

test("consent is unset by default, denied under Global Privacy Control, and read from the cookie", async () => {
  expect(await (await get("/api/consent")).json()).toEqual({ analytics: "unset" });
  expect(await (await get("/api/consent", { headers: { "sec-gpc": "1" } })).json()).toEqual({ analytics: "denied" });
  expect(await (await get("/api/consent", { headers: { cookie: "__Host-wid_consent=v1.granted" } })).json()).toEqual({ analytics: "granted" });
  expect(await (await get("/api/consent", { headers: { cookie: "__Host-wid_consent=v0.granted" } })).json()).toEqual({ analytics: "unset" });
});
test("saving consent sets a hardened cookie holding only the versioned choice", async () => {
  const response = await get("/api/consent", { method: "PUT", headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" }, body: JSON.stringify({ analytics: "granted" }) });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ analytics: "granted" });
  const cookie = response.headers.get("set-cookie") ?? "";
  expect(cookie).toStartWith("__Host-wid_consent=v1.granted;");
  for (const attribute of ["Path=/", "Secure", "HttpOnly", "SameSite=Lax", "Max-Age="]) expect(cookie).toContain(attribute);
  expectSecurityHeaders(response);
});
test("consent cannot be set cross-site or with a malformed body", async () => {
  const put = (headers: Record<string, string>, body: string) => get("/api/consent", { method: "PUT", headers, body });
  const json = { "content-type": "application/json" };
  expect((await put({ ...json, "sec-fetch-site": "cross-site" }, JSON.stringify({ analytics: "granted" }))).status).toBe(403);
  expect((await put({ "content-type": "text/plain" }, JSON.stringify({ analytics: "granted" }))).status).toBe(403);
  expect((await put(json, "{")).status).toBe(400);
  expect((await put(json, JSON.stringify({ analytics: "yes" }))).status).toBe(400);
});
