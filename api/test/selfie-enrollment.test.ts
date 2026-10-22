import { afterAll, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadSelfieEnrollmentPolicy, parseSelfieEnrollmentPolicy, selfieEnrollmentConnectSource } from "../lib/selfie-enrollment";
import { createServerOptions } from "../server";

const pcr = (c: string) => c.repeat(96);
const valid = { endpoint: "wss://selfie-enrollment-stage.worldcoin.dev/v1/embeddings", releases: [{ pcr0: pcr("a"), pcr1: pcr("b"), pcr2: pcr("c") }] };
const servers: ReturnType<typeof Bun.serve>[] = [];
const start = (options: Parameters<typeof createServerOptions>[0]) => {
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, ...createServerOptions(options) });
  servers.push(server);
  return server.url.origin;
};
afterAll(() => Promise.all(servers.map(server => server.stop(true))));

test("a valid tee-apps policy parses and yields an exact CSP source", () => {
  const policy = parseSelfieEnrollmentPolicy(JSON.stringify(valid));
  expect(policy).toEqual(valid);
  expect(selfieEnrollmentConnectSource(policy)).toBe("wss://selfie-enrollment-stage.worldcoin.dev/v1/embeddings");
  expect(parseSelfieEnrollmentPolicy(JSON.stringify({ ...valid, endpoint: "ws://127.0.0.1:9000/v1/embeddings" })).endpoint).toBe("ws://127.0.0.1:9000/v1/embeddings");
});

for (const [name, policy] of [
  ["plain ws to a remote host", { ...valid, endpoint: "ws://enclave.example/v1/embeddings" }],
  ["https endpoint", { ...valid, endpoint: "https://enclave.example/v1/embeddings" }],
  ["endpoint query", { ...valid, endpoint: `${valid.endpoint}?x=1` }],
  ["endpoint credentials", { ...valid, endpoint: "wss://user:pw@enclave.example/v1" }],
  ["no releases", { ...valid, releases: [] }],
  ["uppercase PCR", { ...valid, releases: [{ ...valid.releases[0], pcr0: pcr("A") }] }],
  ["short PCR", { ...valid, releases: [{ ...valid.releases[0], pcr1: "ab" }] }],
  ["unknown release field", { ...valid, releases: [{ ...valid.releases[0], worker_sha384: pcr("d") }] }],
  ["unknown root field", { ...valid, audience: "selfie-enrollment-stage.worldcoin.dev" }],
] as const) {
  test(`policy with ${name} is rejected at startup`, () => {
    expect(() => parseSelfieEnrollmentPolicy(JSON.stringify(policy))).toThrow("selfie_enrollment_policy_invalid");
  });
}

test("unset policy disables enrollment; a missing or malformed file fails loudly", async () => {
  expect(loadSelfieEnrollmentPolicy(undefined)).toBeUndefined();
  expect(() => loadSelfieEnrollmentPolicy("/nonexistent/client-stage.json")).toThrow("selfie_enrollment_policy_unreadable");
  const dir = await mkdtemp(join(tmpdir(), "selfie-policy-"));
  try {
    await writeFile(join(dir, "bad.json"), "{");
    expect(() => loadSelfieEnrollmentPolicy(join(dir, "bad.json"))).toThrow("selfie_enrollment_policy_invalid");
    await writeFile(join(dir, "good.json"), JSON.stringify(valid));
    expect(loadSelfieEnrollmentPolicy(join(dir, "good.json"))).toEqual(valid);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("the policy endpoint reports switched off or serves the trusted policy, never cached", async () => {
  for (const [policy, body] of [
    [undefined, { enabled: false }],
    [parseSelfieEnrollmentPolicy(JSON.stringify(valid)), { enabled: true, policy: valid }],
  ] as const) {
    const response = await fetch(`${start({ selfieEnrollmentPolicy: policy })}/api/selfie-enrollment`);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual(body);
  }
});
