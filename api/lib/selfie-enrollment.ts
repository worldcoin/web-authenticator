import { readFileSync } from "node:fs";

/** Release policy from worldcoin/tee-apps `client-stage.json`. The browser client verifies Nitro PCRs against it. */
export type SelfieEnrollmentPolicy = Readonly<{
  endpoint: string;
  releases: readonly Readonly<{ pcr0: string; pcr1: string; pcr2: string }>[];
}>;

const MAX_POLICY_BYTES = 8192;
const PCR = /^[0-9a-f]{96}$/;
const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);

function invalid(reason: string): never {
  throw new TypeError(`selfie_enrollment_policy_invalid: ${reason}`);
}

function exactKeys(value: unknown, keys: string[], what: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) invalid(`${what} must be an object`);
  const actual = Object.keys(value).sort();
  if (actual.join() !== [...keys].sort().join()) invalid(`${what} must have exactly ${keys.join(", ")}`);
  return value as Record<string, unknown>;
}

// Mirrors selfie-enrollment-client's Config::validate so a bad policy fails at startup, not per capture.
export function parseSelfieEnrollmentPolicy(text: string): SelfieEnrollmentPolicy {
  if (text.length > MAX_POLICY_BYTES) invalid("file is too large");
  let json: unknown;
  try { json = JSON.parse(text); } catch { invalid("file is not JSON"); }
  const root = exactKeys(json, ["endpoint", "releases"], "policy");
  if (typeof root.endpoint !== "string") invalid("endpoint must be a string");
  let url: URL;
  try { url = new URL(root.endpoint); } catch { invalid("endpoint is not a URL"); }
  if (!(url.protocol === "wss:" || (url.protocol === "ws:" && LOOPBACK.has(url.hostname)))
    || url.search || url.hash || url.username || url.password) invalid("endpoint must be wss:// without query, fragment or credentials");
  if (!Array.isArray(root.releases) || root.releases.length === 0) invalid("releases must be a non-empty array");
  const releases = root.releases.map((release, index) => {
    const pcrs = exactKeys(release, ["pcr0", "pcr1", "pcr2"], `releases[${index}]`);
    for (const key of ["pcr0", "pcr1", "pcr2"]) {
      if (typeof pcrs[key] !== "string" || !PCR.test(pcrs[key])) invalid(`releases[${index}].${key} must be lowercase SHA-384 hex`);
    }
    return Object.freeze({ pcr0: pcrs.pcr0 as string, pcr1: pcrs.pcr1 as string, pcr2: pcrs.pcr2 as string });
  });
  return Object.freeze({ endpoint: root.endpoint, releases: Object.freeze(releases) });
}

/** Unset disables enrollment (local capture only). Set but unreadable or invalid stops startup. */
export function loadSelfieEnrollmentPolicy(path: string | undefined): SelfieEnrollmentPolicy | undefined {
  if (path === undefined) return undefined;
  let text: string;
  try { text = readFileSync(path, "utf8"); } catch (error) {
    throw new TypeError(`selfie_enrollment_policy_unreadable: ${path}`, { cause: error });
  }
  return parseSelfieEnrollmentPolicy(text);
}

/** CSP source for exactly the enrollment WebSocket. */
export function selfieEnrollmentConnectSource(policy: SelfieEnrollmentPolicy): string {
  const url = new URL(policy.endpoint);
  return `${url.protocol}//${url.host}${url.pathname}`;
}
