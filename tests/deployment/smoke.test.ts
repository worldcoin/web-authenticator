import { expect, test } from "bun:test";
import { APP_ORIGINS, isAllowedOrigin, parseAppEnvironment } from "../../config/environment";
import { securityHeaders } from "../../config/security-headers";
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

type Deployment = { release?: Record<string, unknown>; headers?: Record<string, string>; missingScript?: boolean; missingRelease?: boolean };

/** A production deployment as Cloudflare serves it: missing files fall back to index.html. */
function deployment({ release = {}, headers = {}, missingScript = false, missingRelease = false }: Deployment = {}) {
  const calls: string[] = [];
  const index = '<html><script type="module" src="/assets/main.js"></script></html>';
  const fetcher: typeof fetch = (async (input, init) => {
    const url = new URL(String(input));
    calls.push(url.pathname);
    expect(url.origin).toBe(APP_ORIGINS.production);
    expect(init?.redirect).toBe("error");
    const respond = (body: string, contentType: string) =>
      new Response(body, { headers: { ...securityHeaders("production"), ...headers, "content-type": contentType } });
    if (url.pathname === "/release.json" && !missingRelease) {
      return respond(JSON.stringify({ environment: "production", commit, ...release }), "application/json");
    }
    if (url.pathname === "/assets/main.js" && !missingScript) return respond("app()", "text/javascript; charset=utf-8");
    return respond(index, "text/html; charset=utf-8");
  }) as typeof fetch;
  return { calls, fetcher };
}

test("promotion checks the deployed commit, environment, headers and browser assets", async () => {
  const good = deployment();
  await smokeDeployment("production", commit, good.fetcher);
  expect(good.calls).toEqual(["/release.json", "/verify", "/assets/main.js"]);

  for (const release of [{ commit: "c".repeat(40) }, { commit: null }, { environment: "staging" }]) {
    const stale = deployment({ release });
    await expect(smokeDeployment("production", commit, stale.fetcher)).rejects.toThrow("does not match");
    expect(stale.calls).toEqual(["/release.json"]);
  }
  await expect(smokeDeployment("production", commit, deployment({ missingRelease: true }).fetcher))
    .rejects.toThrow("Unexpected content type for /release.json");
  await expect(smokeDeployment("production", commit, deployment({ missingScript: true }).fetcher))
    .rejects.toThrow("Unexpected content type for /assets/main.js");
  await expect(smokeDeployment("production", commit, deployment({ headers: { "content-security-policy": "default-src *" } }).fetcher))
    .rejects.toThrow("Unexpected Content-Security-Policy header");
});
