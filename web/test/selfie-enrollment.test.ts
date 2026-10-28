import { afterEach, expect, spyOn, test } from "bun:test";
import type { initializeWalletKit } from "@worldcoin/walletkit-web";
import { extractSelfieEmbedding, fetchSelfieEnrollmentPolicy, SelfieRejectedError, type SelfieEmbeddingResult } from "../lib/selfie-enrollment";

const POLICY = JSON.stringify({ endpoint: "wss://enclave.test/v1/embeddings", releases: [] });
const image = () => new Blob([new Uint8Array([1, 2, 3])], { type: "image/jpeg" });
const quiet = [spyOn(console, "info").mockImplementation(() => {}), spyOn(console, "warn").mockImplementation(() => {}), spyOn(console, "error").mockImplementation(() => {})];
afterEach(() => { for (const spy of quiet) spy.mockClear(); });

function worker(answer: (policy: string, bytes: Uint8Array) => Promise<SelfieEmbeddingResult>) {
  const calls = { terminated: 0, sent: [] as number[][] };
  const initialize = (async () => ({
    extractSelfieEmbedding: (policy: string, bytes: Uint8Array) => { calls.sent.push([...bytes]); return answer(policy, bytes); },
    terminate: () => { calls.terminated++; },
  })) as unknown as typeof initializeWalletKit;
  return { calls, initialize };
}

test("success returns metadata and the encoded length, never the vector, and closes the worker", async () => {
  const { calls, initialize } = worker(async policy => {
    expect(policy).toBe(POLICY);
    return { status: "success", embedding: { embedding: "c2VjcmV0", embeddingType: "ghostfacenet_flipped_mean", embeddingVersion: "2.0.0", embeddingInferenceBackend: "face-engine" } };
  });
  const summary = await extractSelfieEmbedding(POLICY, image(), new AbortController().signal, initialize);
  expect(summary).toEqual({ embeddingType: "ghostfacenet_flipped_mean", embeddingVersion: "2.0.0", embeddingInferenceBackend: "face-engine", encodedLength: 8 });
  expect(JSON.stringify(summary)).not.toContain("c2VjcmV0");
  expect(JSON.stringify(quiet[0]!.mock.calls)).not.toContain("c2VjcmV0");
  expect(calls.sent).toEqual([[1, 2, 3]]);
  expect(calls.terminated).toBe(1);
});

test("a typed enclave rejection throws SelfieRejectedError with the reason and closes the worker", async () => {
  const { calls, initialize } = worker(async () => ({ status: "failed", reason: "invalid_image" }));
  const error = await extractSelfieEmbedding(POLICY, image(), new AbortController().signal, initialize).catch(e => e);
  expect(error).toBeInstanceOf(SelfieRejectedError);
  expect(error.reason).toBe("invalid_image");
  expect(calls.terminated).toBe(1);
});

test("attestation or transport errors propagate and close the worker", async () => {
  const { calls, initialize } = worker(async () => { throw new Error("attestation rejected"); });
  await expect(extractSelfieEmbedding(POLICY, image(), new AbortController().signal, initialize)).rejects.toThrow("attestation rejected");
  expect(calls.terminated).toBe(1);
});

for (const result of [null, { status: "failed", reason: "unknown" }, { status: "success", embedding: {} }]) {
  test("malformed extraction responses fail closed and close the worker", async () => {
    const { calls, initialize } = worker(async () => result as unknown as SelfieEmbeddingResult);
    await expect(extractSelfieEmbedding(POLICY, image(), new AbortController().signal, initialize)).rejects.toThrow("Invalid selfie extraction response");
    expect(calls.terminated).toBe(1);
  });
}

test("an SDK without the extraction operation reports unsupported instead of completing", async () => {
  const { calls, initialize } = worker(async () => { throw new Error("Unknown function: extractSelfieEmbedding"); });
  const error = await extractSelfieEmbedding(POLICY, image(), new AbortController().signal, initialize).catch(value => value);
  expect(error.name).toBe("NotSupportedError");
  expect(calls.terminated).toBe(1);
});

test("aborting a hung extraction rejects promptly and terminates the worker", async () => {
  const { calls, initialize } = worker(() => new Promise(() => {}));
  const controller = new AbortController();
  const pending = extractSelfieEmbedding(POLICY, image(), controller.signal, initialize);
  await new Promise(resolve => setTimeout(resolve, 0));
  controller.abort(new DOMException("Page hidden", "AbortError"));
  await expect(pending).rejects.toThrow("Page hidden");
  expect(calls.terminated).toBeGreaterThanOrEqual(1);
});

test("an already-aborted signal never starts a worker", async () => {
  let started = 0;
  const initialize = (async () => { started++; throw new Error("unreachable"); }) as unknown as typeof initializeWalletKit;
  const controller = new AbortController();
  controller.abort();
  await expect(extractSelfieEmbedding(POLICY, image(), controller.signal, initialize)).rejects.toBeDefined();
  expect(started).toBe(0);
});

for (const [name, response, expected] of [
  ["switched off", Response.json({ enabled: false }), null],
  ["switched on", Response.json({ enabled: true, policy: JSON.parse(POLICY) }), POLICY],
] as const) {
  test(`policy endpoint ${name}`, async () => {
    const fetchMock = spyOn(globalThis, "fetch").mockResolvedValue(response);
    try {
      expect(await fetchSelfieEnrollmentPolicy(new AbortController().signal)).toBe(expected);
    } finally { fetchMock.mockRestore(); }
  });
}

for (const [name, response] of [
  ["a missing route", Response.json({ error: "Not found" }, { status: 404 })],
  ["a server error", new Response("upstream", { status: 502 })],
  ["an enabled response without a policy", Response.json({ enabled: true })],
  ["an oversized body", new Response("x".repeat(9000))],
] as const) {
  test(`policy endpoint treats ${name} as a failure, not as switched off`, async () => {
    const fetchMock = spyOn(globalThis, "fetch").mockResolvedValue(response);
    try {
      await expect(fetchSelfieEnrollmentPolicy(new AbortController().signal)).rejects.toBeDefined();
    } finally { fetchMock.mockRestore(); }
  });
}
