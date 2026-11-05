import { expect, test } from "bun:test";
import { APP_ORIGINS, isAllowedOrigin, parseAppEnvironment } from "../../config/environment";
import { smokeDeployment } from "../../scripts/smoke-cloudflare";

const commit = "b".repeat(40);

test("deployment settings select the network and origins only validate that choice", () => {
  expect(parseAppEnvironment("production")).toBe("production");
  expect(parseAppEnvironment("staging")).toBe("staging");
  for (const value of [undefined, "prod", "", "unknown"]) {
    expect(() => parseAppEnvironment(value)).toThrow("APP_ENV must be staging or production");
  }
  expect(isAllowedOrigin("production", "https://web.world.org")).toBe(true);
  expect(isAllowedOrigin("staging", "https://authenticator.toolsforhumanity.dev")).toBe(true);
  expect(isAllowedOrigin("staging", "http://localhost:4173")).toBe(true);
  expect(isAllowedOrigin("staging", "https://web.world.org")).toBe(false);
  for (const origin of ["http://localhost:4173", "https://authenticator.toolsforhumanity.dev", "http://web.world.org", "https://web.world.org:444", "https://web.world.org.attacker.example"]) {
    expect(isAllowedOrigin("production", origin)).toBe(false);
  }
});

function fixture(overrides: Record<string, unknown> = {}, brokenAsset = false) {
  const calls: string[] = [];
  const fetcher: typeof fetch = (async (input, init) => {
    const url = new URL(String(input));
    calls.push(url.pathname);
    expect(url.origin).toBe(APP_ORIGINS.production);
    expect(init?.redirect).toBe("error");
    const headers = { "cache-control": "no-store", "x-content-type-options": "nosniff" };
    if (url.pathname === "/api/health/ready") return Response.json({ status: "ready", environment: "production", protocol: "production", origin: APP_ORIGINS.production, commit, ...overrides }, { headers });
    if (url.pathname === "/verify") return new Response('<html><script type="module" src="/assets/main.js"></script></html>', { headers: { ...headers, "content-type": "text/html" } });
    return new Response("app()", { headers: { ...headers, "content-type": brokenAsset ? "text/html" : "application/javascript" } });
  }) as typeof fetch;
  return { calls, fetcher };
}

test("promotion checks the deployed commit, environment, origin and browser assets", async () => {
  const good = fixture();
  await smokeDeployment("production", commit, good.fetcher);
  expect(good.calls).toEqual(["/api/health/ready", "/verify", "/assets/main.js"]);
  for (const bad of [{ commit: "c".repeat(40) }, { environment: "staging" }, { protocol: "staging" }, { origin: APP_ORIGINS.staging }]) {
    const current = fixture(bad);
    await expect(smokeDeployment("production", commit, current.fetcher)).rejects.toThrow("does not match");
    expect(current.calls).toEqual(["/api/health/ready"]);
  }
  await expect(smokeDeployment("production", commit, fixture({}, true).fetcher)).rejects.toThrow("Browser entry is unavailable");
});
