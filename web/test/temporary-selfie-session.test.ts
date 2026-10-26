import { afterEach, expect, spyOn, test } from "bun:test";
import * as sdk from "@worldcoin/walletkit-web";
import * as passkeys from "../lib/wallet-session";
import { analytics } from "../lib/analytics";
import type { AnalyticsStatus, AnalyticsStep } from "../../packages/contracts/src/analytics";
import { WalletKit } from "../lib/walletkit";
import { prepareTemporarySelfieSession, type SelfieProcessingStep } from "../lib/temporary-selfie-session";
import { signedRequest } from "../../tests/integration/fixtures/request";
import type { IncomingRequest } from "../lib/incoming-request";

const restore: (() => void)[] = [];
afterEach(() => { for (const undo of restore.splice(0).reverse()) undo(); });
function mock<T extends { mockRestore(): void }>(value: T): T { restore.push(() => value.mockRestore()); return value; }

async function fixture() {
  const events: { step: AnalyticsStep; status: AnalyticsStatus; reason?: string }[] = [];
  mock(spyOn(analytics, "record").mockImplementation((step, status, fields) => {
    events.push({ step, status, reason: fields?.reason }); return true;
  }));
  mock(spyOn(analytics, "flush").mockResolvedValue());
  const { payload } = await signedRequest(11);
  const calls = { register: 0, initialize: 0, subject: 0, issue: 0, store: 0, prove: 0, deliver: 0, save: 0, destroy: 0, terminated: 0, failDelivery: false, failIssuance: false, failStorage: false, invalidCredential: false, failRegistration: false, subjectFailures: 0, accountMissingOnce: false, failInitialize: false };
  const incoming: IncomingRequest = { proof: payload.proof_request, label: "test", actionLabel: payload.action,
    validate: async () => {}, cancel: async () => {}, deliver: async () => { calls.deliver++; if (calls.failDelivery) throw new Error("delivery unavailable"); } };
  let stopped = false;
  const client = { StorageKeys: { fromBytes: async () => ({ free() {} }) }, StoragePaths: { fromRoot: async () => ({ free() {} }) },
    CredentialStore: { new: async () => ({ destroyStorage: async () => { calls.destroy++; } }) },
    extractSelfieEmbedding: async () => ({ status: "success", embedding: { embedding: "private-vector", embeddingType: "face", embeddingVersion: "2", embeddingInferenceBackend: "test" } }),
    isStopped: () => stopped, close: async () => { stopped = true; }, terminate: () => { calls.terminated++; stopped = true; },
  } as unknown as sdk.WalletKit;
  mock(spyOn(sdk, "initializeWalletKit").mockResolvedValue(client));
  mock(spyOn(console, "info").mockImplementation(() => {}));
  mock(spyOn(console, "error").mockImplementation(() => {}));
  mock(spyOn(WalletKit.prototype, "register").mockImplementation(async () => { calls.register++; if (calls.failRegistration) throw new Error("registration unavailable"); }));
  mock(spyOn(WalletKit.prototype, "pollRegistration").mockResolvedValue({ state: "finalized" }));
  mock(spyOn(WalletKit.prototype, "initializeAuthenticator").mockImplementation(async () => {
    calls.initialize++;
    if (calls.failInitialize) throw new Error("storage unavailable");
    if (calls.accountMissingOnce && calls.initialize === 1) {
      throw Object.assign(new Error("Account not visible yet"), { name: "WalletKitError", code: "AccountDoesNotExist" });
    }
  }));
  mock(spyOn(WalletKit.prototype, "prepareCredential").mockImplementation(async () => {
    calls.subject++;
    if (calls.subject <= calls.subjectFailures) throw new Error("OPRF temporarily unavailable");
    return { sub: "0x" + "a".repeat(64), blindingFactor: "0x01" };
  }));
  mock(spyOn(WalletKit.prototype, "storeCredential").mockImplementation(async () => { calls.store++; if (calls.failStorage) throw new Error("storage unavailable"); return { credentialId: 1n, issuerSchemaId: 11n }; }));
  mock(spyOn(WalletKit.prototype, "listCredentials").mockImplementation(async () => calls.store ? [{ credentialId: 1n, issuerSchemaId: 11n, isExpired: false,
    genesisIssuedAt: BigInt(payload.proof_request.created_at), expiresAt: BigInt(payload.proof_request.expires_at + 3600) }] : []));
  mock(spyOn(WalletKit.prototype, "generateProof").mockImplementation(async () => { calls.prove++; return JSON.stringify({ id: incoming.proof.id, responses: [{}] }); }));
  mock(spyOn(passkeys, "saveTemporaryWallet").mockImplementation(async material => { calls.save++; material.persisted = true; }));
  mock(spyOn(globalThis, "fetch").mockImplementation((async (_url, init) => {
    if (!init?.method) return Response.json({ enabled: true });
    calls.issue++;
    if (calls.failIssuance) return new Response("private upstream detail", { status: 503 });
    if (calls.invalidCredential) return Response.json({ status: "issued", credential: "invalid!" });
    return Response.json({ status: "issued", credential: btoa("signed-test-credential") });
  }) as typeof fetch));
  const controller = new AbortController();
  return { calls, incoming, controller, events, begin: () => prepareTemporarySelfieSession(controller.signal) };
}

test("prepares without a passkey, shares the worker for extraction, delivers before optional saving", async () => {
  const f = await fixture();
  const session = (await f.begin())!;
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(f.calls.register).toBe(1);
  expect(f.calls.issue).toBe(0);
  expect(f.calls.save).toBe(0);
  await session.waitUntilReady(f.controller.signal);
  expect(f.calls).toMatchObject({ initialize: 1, subject: 1, issue: 0 });
  await session.extract("{}", new Blob(["image"]), f.controller.signal);
  expect(f.calls.terminated).toBe(0);
  const steps: SelfieProcessingStep[] = [];
  await session.complete(f.incoming, f.controller.signal, step => steps.push(step));
  expect(steps).toEqual(["preparing-credential", "creating-proof", "sending-proof"]);
  expect(f.calls).toMatchObject({ issue: 1, store: 1, prove: 1, deliver: 1, save: 0 });
  await session.save(f.controller.signal);
  await session.complete(f.incoming, f.controller.signal);
  await session.dispose();
  expect(f.calls).toMatchObject({ register: 1, issue: 1, prove: 1, deliver: 1, save: 1, destroy: 0 });
});

test("declining erases the unsaved store; a delivery retry reuses the same issued credential and proof", async () => {
  const f = await fixture();
  const session = (await f.begin())!;
  f.calls.failDelivery = true;
  await expect(session.complete(f.incoming, f.controller.signal)).rejects.toThrow("delivery unavailable");
  f.calls.failDelivery = false;
  const steps: SelfieProcessingStep[] = [];
  await session.complete(f.incoming, f.controller.signal, step => steps.push(step));
  expect(steps).toEqual(["sending-proof"]);
  await session.dispose();
  await session.dispose();
  expect(f.calls).toMatchObject({ register: 1, issue: 1, prove: 1, deliver: 2, save: 0, destroy: 1 });
  await expect(session.save(f.controller.signal)).rejects.toThrow("before saving");
});

test("registration failure is surfaced and never issues or delivers; incomplete sessions cannot be saved", async () => {
  const f = await fixture(); f.calls.failRegistration = true;
  const session = (await f.begin())!;
  await expect(session.complete(f.incoming, f.controller.signal)).rejects.toThrow("registration unavailable");
  await expect(session.save(f.controller.signal)).rejects.toThrow("before saving");
  expect(f.calls).toMatchObject({ issue: 0, prove: 0, deliver: 0, save: 0 });
  await session.dispose();
});

test("a transient OPRF failure retries derivation without registering or issuing twice", async () => {
  const f = await fixture(); f.calls.subjectFailures = 3;
  const session = (await f.begin())!;
  await session.complete(f.incoming, f.controller.signal);
  expect(f.calls).toMatchObject({ register: 1, subject: 4, issue: 1, store: 1, prove: 1, deliver: 1 });
  await session.dispose();
});

test("finalization before account visibility retries initialization of the same account", async () => {
  const f = await fixture(); f.calls.accountMissingOnce = true;
  const session = (await f.begin())!;
  await session.complete(f.incoming, f.controller.signal);
  expect(f.calls).toMatchObject({ register: 1, initialize: 2, subject: 1, issue: 1, deliver: 1 });
  await session.dispose();
});

test("unexpected initialization failures are surfaced without retrying or issuing", async () => {
  const f = await fixture(); f.calls.failInitialize = true;
  const session = (await f.begin())!;
  await expect(session.waitUntilReady(f.controller.signal)).rejects.toThrow("storage unavailable");
  await expect(session.complete(f.incoming, f.controller.signal)).rejects.toThrow("storage unavailable");
  expect(f.calls).toMatchObject({ register: 1, initialize: 1, subject: 0, issue: 0, deliver: 0 });
  await session.dispose();
});

test("cancelling while waiting for account visibility stops retries and issuance", async () => {
  const f = await fixture(); f.calls.accountMissingOnce = true;
  const session = (await f.begin())!;
  const completion = session.complete(f.incoming, f.controller.signal);
  while (!f.calls.initialize) await new Promise(resolve => setTimeout(resolve, 0));
  f.controller.abort();
  await expect(completion).rejects.toThrow();
  expect(f.calls).toMatchObject({ register: 1, initialize: 1, issue: 0, deliver: 0 });
  await session.dispose();
});

for (const failure of ["failIssuance", "invalidCredential"] as const) {
  test(`issuance ${failure} never records an issued credential or starts proof`, async () => {
    const f = await fixture(); f.calls[failure] = true;
    const session = (await f.begin())!;
    await expect(session.complete(f.incoming, f.controller.signal)).rejects.toThrow();
    expect(f.events.filter(e => e.step === "credential_issuance").map(e => e.status)).toEqual(["started", "failed"]);
    expect(f.calls).toMatchObject({ store: 0, prove: 0, deliver: 0 });
    f.calls[failure] = false;
    await session.complete(f.incoming, f.controller.signal);
    expect(f.events.filter(e => e.step === "credential_issuance").map(e => e.status)).toEqual(["started", "failed", "started", "completed"]);
    await session.dispose();
  });
}

test("issuance is counted before storage/proof and once across storage failure, delivery failure and duplicate completion", async () => {
  const f = await fixture(); f.calls.failStorage = true;
  const session = (await f.begin())!;
  await expect(session.complete(f.incoming, f.controller.signal)).rejects.toThrow("storage unavailable");
  expect(f.events.filter(e => e.step === "credential_issuance").map(e => e.status)).toEqual(["started", "completed"]);
  expect(f.events.some(e => e.step === "proof_generation")).toBe(false);
  f.calls.failStorage = false; f.calls.failDelivery = true;
  await expect(session.complete(f.incoming, f.controller.signal)).rejects.toThrow("delivery unavailable");
  f.calls.failDelivery = false;
  await Promise.all([session.complete(f.incoming, f.controller.signal), session.complete(f.incoming, f.controller.signal)]);
  await session.complete(f.incoming, f.controller.signal);
  expect(f.events.filter(e => e.step === "credential_issuance" && e.status === "completed")).toHaveLength(1);
  expect(f.events.filter(e => e.step === "proof_generation" && e.status === "completed")).toHaveLength(1);
  expect(f.calls).toMatchObject({ issue: 2, prove: 1, deliver: 2 });
  expect(JSON.stringify(f.events)).not.toContain("signed-test-credential");
  expect(JSON.stringify(f.events)).not.toContain("blindingFactor");
  await session.dispose();
});
