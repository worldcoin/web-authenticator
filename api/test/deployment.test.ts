import { expect, test } from "bun:test";
import { DEPLOYMENTS, protocolEnvironmentForOrigin } from "../../packages/contracts/src/deployment";
import { smokeDeployment } from "../../scripts/smoke-cloudflare";

const commit = "b".repeat(40);

test("network selection uses exact origins and rejects unrecognized sites", () => {
  expect(protocolEnvironmentForOrigin("https://web.world.org")).toBe("production");
  expect(protocolEnvironmentForOrigin("https://web.sandbox.world.org")).toBe("staging");
  expect(protocolEnvironmentForOrigin("https://authenticator.toolsforhumanity.dev")).toBe("staging");
  expect(protocolEnvironmentForOrigin("http://localhost:4173")).toBe("staging");
  for (const origin of ["http://web.world.org", "https://web.world.org:444", "https://web.world.org.attacker.example", "https://other.world.org"]) {
    expect(() => protocolEnvironmentForOrigin(origin)).toThrow("Unsupported authenticator origin");
  }
});

function fixture(overrides: Record<string, unknown> = {}, brokenAsset = false) {
  const calls: string[] = [];
  const fetcher: typeof fetch = (async (input, init) => {
    const url = new URL(String(input));
    calls.push(url.pathname);
    expect(url.origin).toBe(DEPLOYMENTS.sandbox.origin);
    expect(init?.redirect).toBe("error");
    const headers = { "cache-control": "no-store", "x-content-type-options": "nosniff" };
    if (url.pathname === "/api/health/ready") return Response.json({ status: "ready", environment: "sandbox", protocol: "staging", origin: DEPLOYMENTS.sandbox.origin, commit, ...overrides }, { headers });
    if (url.pathname === "/verify") return new Response('<html><script type="module" src="/assets/main.js"></script></html>', { headers: { ...headers, "content-type": "text/html" } });
    return new Response("app()", { headers: { ...headers, "content-type": brokenAsset ? "text/html" : "application/javascript" } });
  }) as typeof fetch;
  return { calls, fetcher };
}

test("promotion checks the deployed commit, environment, origin and browser assets", async () => {
  const good = fixture();
  await smokeDeployment("sandbox", commit, good.fetcher);
  expect(good.calls).toEqual(["/api/health/ready", "/verify", "/assets/main.js"]);
  for (const bad of [{ commit: "c".repeat(40) }, { environment: "production" }, { protocol: "production" }, { origin: DEPLOYMENTS.production.origin }]) {
    const current = fixture(bad);
    await expect(smokeDeployment("sandbox", commit, current.fetcher)).rejects.toThrow("does not match");
    expect(current.calls).toEqual(["/api/health/ready"]);
  }
  await expect(smokeDeployment("sandbox", commit, fixture({}, true).fetcher)).rejects.toThrow("Browser entry is unavailable");
});
