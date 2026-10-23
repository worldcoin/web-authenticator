import { initializeWalletKit, type CredentialStore, type WalletKit as Worker } from "@worldcoin/walletkit-web";
import { abortable, pause } from "./async";
import { logFlowStep } from "./flow-logging";
import type { IncomingRequest } from "./incoming-request";
import { createProof } from "./prove";
import { extractSelfieEmbedding, type SelfieEmbeddingSummary } from "./selfie-enrollment";
import { WalletKit } from "./walletkit";
import { saveTemporaryWallet } from "./wallet-session";
import type { TemporaryWalletMaterial } from "./wallet-envelope";

export interface TemporarySelfieSession {
  extract(policy: string, image: Blob, signal: AbortSignal): Promise<SelfieEmbeddingSummary>;
  complete(request: IncomingRequest, signal: AbortSignal): Promise<void>;
  save(signal: AbortSignal): Promise<void>;
  dispose(): Promise<void>;
}
export type PrepareTemporarySession = (signal: AbortSignal) => Promise<TemporarySelfieSession | null>;
const hex = (bytes: Uint8Array) => Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");

async function issue(sub: string, token: string, signal: AbortSignal): Promise<Uint8Array> {
  for (;;) {
    const response = await fetch("/api/selfie-credential", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sub, token }),
      signal: AbortSignal.any([signal, AbortSignal.timeout(175_000)]),
    });
    const text = await response.text();
    if (text.length > 131_072) throw new Error("Staging issuance response is too large.");
    const value = JSON.parse(text) as { status?: unknown; credential?: unknown };
    if (!response.ok) throw new Error(`Staging issuance failed (${response.status}). Retry resumes the same operation.`);
    if (value.status === "pending") { await pause(3000, signal); continue; }
    if (value.status !== "issued" || typeof value.credential !== "string" ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(value.credential) || value.credential.length > 90_000) {
      throw new Error("Staging returned an invalid credential.");
    }
    return Uint8Array.from(atob(value.credential), c => c.charCodeAt(0));
  }
}

/** Explicitly enabled loopback demo. Signing remains with the real staging issuer. */
export const prepareTemporarySelfieSession: PrepareTemporarySession = async signal => {
  const capability = await fetch("/api/selfie-credential", { cache: "no-store", signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]) });
  if (capability.status === 404) return null;
  if (!capability.ok || (await capability.json() as { enabled?: unknown }).enabled !== true) throw new Error("Temporary issuance is unavailable.");
  const material: TemporaryWalletMaterial = {
    seed: crypto.getRandomValues(new Uint8Array(32)), databaseKey: crypto.getRandomValues(new Uint8Array(32)),
    storageRoot: `/walletkit/temporary-${crypto.randomUUID()}`, persisted: false,
  };
  const token = hex(crypto.getRandomValues(new Uint8Array(32)));
  let client: Worker | undefined;
  let store: CredentialStore | undefined;
  let wallet: WalletKit | undefined;
  let prepared: { sub: string; blindingFactor: string } | undefined;
  let credentialStored = false;
  let delivered = false;
  let boundRequest: string | undefined;
  let proof: string | undefined;
  let completing: Promise<void> | undefined;
  let disposal: Promise<void> | undefined;
  let closed = false;
  const stop = () => { client?.terminate(); material.seed.fill(0); material.databaseKey.fill(0); };
  signal.addEventListener("abort", stop, { once: true });
  const worker = logFlowStep("temporary.worker_initialize", () => initializeWalletKit({ signal })).then(value => {
    client = value;
    signal.throwIfAborted();
    return value;
  });
  const preparationDeadline = AbortSignal.any([signal, AbortSignal.timeout(300_000)]);
  const ready = (async () => {
    const api = await worker;
    const keys = await api.StorageKeys.fromBytes(material.databaseKey);
    const paths = await api.StoragePaths.fromRoot(material.storageRoot);
    try { store = await api.CredentialStore.new(paths, keys); } finally { keys.free(); paths.free(); }
    wallet = new WalletKit(api, store, "staging", "us");
    const step = <T,>(work: Promise<T>) => abortable(work, AbortSignal.any([preparationDeadline, AbortSignal.timeout(30_000)]));
    await logFlowStep("temporary.registration", () => step(wallet!.register(material.seed)));
    for (;;) {
      const status = await step(wallet.pollRegistration());
      if (status.state === "finalized") break;
      if (!["queued", "batching", "submitted"].includes(status.state)) throw new Error("Temporary account registration failed.");
      await pause(1000, preparationDeadline);
    }
    // Gateway finalization can precede the account becoming visible to SDK reads.
    // Retry initialization of this same account, never account registration.
    const accountDeadline = AbortSignal.any([preparationDeadline, AbortSignal.timeout(45_000)]);
    for (let attempt = 0; ; attempt++) {
      try {
        await logFlowStep("temporary.authenticator_initialize", () => abortable(step(wallet!.initializeAuthenticator(material.seed)), accountDeadline));
        break;
      } catch (error) {
        if (!(error instanceof Error) || !("code" in error) || error.code !== "AccountDoesNotExist" ||
          attempt === 9 || accountDeadline.aborted || api.isStopped()) throw error;
        await pause(Math.min(500 * 2 ** attempt, 4000) + Math.floor(Math.random() * 250), accountDeadline);
      }
    }
    // A finalized account can reach the OPRF nodes before their indexers catch up.
    // Subject derivation is safe to retry; account registration and issuance are not repeated.
    const subjectDeadline = AbortSignal.any([preparationDeadline, AbortSignal.timeout(45_000)]);
    for (let attempt = 0; ; attempt++) {
      try {
        prepared = await logFlowStep("temporary.prepare_subject", () => abortable(step(wallet!.prepareCredential(11n)), subjectDeadline));
        break;
      } catch (error) {
        if (attempt === 9 || subjectDeadline.aborted || api.isStopped()) throw error;
        await pause(Math.min(500 * 2 ** attempt, 4000) + Math.floor(Math.random() * 250), subjectDeadline);
      }
    }
  })().then(() => ({ ok: true as const }), error => ({ ok: false as const, error }));

  return {
    async extract(policy, image, captureSignal) {
      if (closed) throw new Error("This temporary session has ended. Start a fresh request.");
      const api = await abortable(worker, captureSignal);
      return extractSelfieEmbedding(policy, image, captureSignal, async () => api, false);
    },
    complete(request, captureSignal) {
      if (closed || (boundRequest && boundRequest !== request.proof.id)) return Promise.reject(new Error("Temporary session does not match this request."));
      boundRequest = request.proof.id;
      if (delivered) return Promise.resolve();
      if (completing) return completing;
      completing = (async () => {
        const deadline = AbortSignal.any([signal, captureSignal, AbortSignal.timeout(300_000)]);
        const preparation = await abortable(ready, deadline);
        if (!preparation.ok) throw preparation.error;
        if (!wallet || !prepared) throw new Error("Temporary authenticator is unavailable.");
        if (!credentialStored) {
          const bytes = await logFlowStep("temporary.issue_credential", () => issue(prepared!.sub, token, deadline));
          try {
            const result = await logFlowStep("temporary.store_credential", () => wallet!.storeCredential(bytes, prepared!.blindingFactor));
            if (result.issuerSchemaId !== 11n) throw new Error("Unexpected credential schema.");
            credentialStored = true;
          } finally { bytes.fill(0); }
        }
        proof ??= await logFlowStep("temporary.create_proof", () => createProof(request, wallet!, deadline, () => {}));
        await logFlowStep("temporary.deliver_proof", () => abortable(request.deliver(proof!, deadline), AbortSignal.any([deadline, AbortSignal.timeout(30_000)])));
        delivered = true;
        proof = undefined;
        prepared = undefined;
      })().finally(() => { completing = undefined; });
      return completing;
    },
    async save(saveSignal) {
      if (closed || !delivered) throw new Error("Complete this check before saving its authenticator.");
      await saveTemporaryWallet(material, saveSignal);
    },
    dispose() {
      if (disposal) return disposal;
      closed = true;
      disposal = (async () => {
        signal.removeEventListener("abort", stop);
        try {
          if (client && !client.isStopped()) {
            if (!material.persisted && store) await abortable(store.destroyStorage(), AbortSignal.timeout(5000));
            await client.close();
          }
        } finally { stop(); proof = undefined; prepared = undefined; }
      })();
      return disposal;
    },
  };
};
