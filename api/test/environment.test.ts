import { expect, test } from "bun:test";
import { connectSources, ENVIRONMENTS, SHARED_CONNECT_SRC, type ProtocolEnvironment } from "../../config/environment";
import { securityHeaders } from "../lib/security-headers";

const environments = Object.keys(ENVIRONMENTS) as ProtocolEnvironment[];

/** Every URL an environment's build or Worker may contact. */
function urls(environment: ProtocolEnvironment): string[] {
  const config = ENVIRONMENTS[environment];
  return [config.appOrigin, config.signupIdentity, ...config.connectSrc, ...(config.selfieEnrollment ? [config.selfieEnrollment.endpoint] : [])];
}

const STAGING_HOSTS = [
  /(^|[.-])stag(e|ing)([.-]|$)/, // selfie-enrollment-stage.…, staging.world.oprf…, staging-bridge…
  /(^|\.)worldcoin\.dev$/,
  /(^|\.)toolsforhumanity\.dev$/,
];

test("production never points at a staging service", () => {
  for (const url of urls("production")) {
    const host = new URL(url).hostname;
    for (const pattern of STAGING_HOSTS) expect({ url, staging: pattern.test(host) }).toEqual({ url, staging: false });
  }
});

test("staging and production share no protocol service", () => {
  const production = new Set(urls("production"));
  for (const url of urls("staging")) expect({ url, shared: production.has(url) }).toEqual({ url, shared: false });
});

test("only environment-neutral services are shared, and they are not staging-only", () => {
  for (const url of SHARED_CONNECT_SRC) {
    expect(new URL(url).protocol).toBe("https:");
    for (const environment of environments) expect(ENVIRONMENTS[environment].connectSrc).not.toContain(url);
  }
});

test("each environment's CSP allows exactly its own services", () => {
  for (const environment of environments) {
    const other = environments.find(candidate => candidate !== environment)!;
    const csp = securityHeaders(environment)["Content-Security-Policy"];
    const connectSrc = csp.split("; ").find(directive => directive.startsWith("connect-src "))!.split(" ").slice(1);
    expect(connectSrc).toEqual(["'self'", ...connectSources(environment)]);
    for (const url of ENVIRONMENTS[other].connectSrc) expect(connectSrc).not.toContain(url);
    expect(connectSrc).toContain(new URL(ENVIRONMENTS[environment].signupIdentity).origin);
    expect(connectSrc).not.toContain(new URL(ENVIRONMENTS[other].signupIdentity).origin);
  }
});

test("TEE policies, when enabled, use wss and full SHA-384 measurements", () => {
  for (const environment of environments) {
    const policy = ENVIRONMENTS[environment].selfieEnrollment;
    if (policy === null) continue;
    expect(new URL(policy.endpoint).protocol).toBe("wss:");
    expect(policy.releases.length).toBeGreaterThan(0);
    for (const release of policy.releases) {
      for (const pcr of [release.pcr0, release.pcr1, release.pcr2]) expect(pcr).toMatch(/^[0-9a-f]{96}$/);
    }
  }
});
