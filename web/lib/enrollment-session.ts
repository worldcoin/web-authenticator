import { initializeWalletKit, type WalletKit as WorkerWallet } from "@worldcoin/walletkit-web";
import { WalletKit } from "./walletkit";
import { abortable, pause } from "./async";
import { currentProtocolEnvironment } from "./environment";
import { clearEnrollmentSecrets, createEnrollmentSecrets, sealEnrollmentSecrets, type EnrollmentSecrets } from "./enrollment-secrets";

export interface EnrollmentSession {
  readonly wallet: WalletKit;
  readonly storageId: string;
  readonly sub: string;
  readonly blindingFactor: string;
  readonly custodyPublicKey: Uint8Array<ArrayBuffer>;
  sealSecrets(key: CryptoKey, binding: string): Promise<Uint8Array<ArrayBuffer>>;
  dispose(): void;
}

/** No WebAuthn or backup calls. The caller owns disposal on cancellation, navigation or completion. */
export async function prepareEnrollmentSession(
  signal: AbortSignal,
  progress: (message: string) => void = () => {},
  initialize: typeof initializeWalletKit = initializeWalletKit,
): Promise<EnrollmentSession> {
  signal.throwIfAborted();
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(new DOMException("Enrollment setup timed out", "TimeoutError")), 180_000);
  const deadline = AbortSignal.any([signal, timeout.signal]);
  let client: WorkerWallet | undefined;
  let secrets: EnrollmentSecrets | undefined;
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    clearTimeout(timer);
    deadline.removeEventListener("abort", dispose);
    client?.terminate();
    if (secrets) clearEnrollmentSecrets(secrets);
  };
  deadline.addEventListener("abort", dispose, { once: true });
  try {
    secrets = await abortable(createEnrollmentSecrets().then(value => {
      secrets = value;
      if (disposed) clearEnrollmentSecrets(value);
      return value;
    }), deadline);
    deadline.throwIfAborted();
    const storageId = `/walletkit/enrollment-${crypto.randomUUID()}`;
    const worker = await abortable(initialize({ signal: deadline }).then(worker => {
      if (deadline.aborted) worker.terminate();
      return worker;
    }), deadline);
    client = worker;
    const paths = await abortable(worker.StoragePaths.fromRoot(storageId), deadline);
    try {
      const keys = await abortable(worker.StorageKeys.fromBytes(secrets.databaseKey), deadline);
      try {
        const store = await abortable(worker.CredentialStore.new(paths, keys), deadline);
        const wallet = new WalletKit(worker, store, currentProtocolEnvironment(), "us");
        progress("Preparing your World ID…");
        // Registration is submitted once. An ambiguous outcome must not be retried with another seed.
        await abortable(wallet.register(secrets.seed), deadline);
        for (;;) {
          const status = await abortable(wallet.pollRegistration(), deadline);
          if (status.state === "finalized") break;
          if (!["queued", "batching", "submitted"].includes(status.state)) throw new Error("Enrollment account registration did not complete.");
          await pause(1000, deadline);
        }
        await abortable(wallet.initializeAuthenticator(secrets.seed), deadline);
        const subject = await abortable(wallet.prepareCredential(11n), deadline);
        deadline.throwIfAborted();
        clearTimeout(timer);
        const owned = secrets;
        return {
          wallet, storageId, ...subject, custodyPublicKey: owned.custodyPublicKey.slice(),
          async sealSecrets(key, binding) {
            if (disposed) throw new Error("Enrollment session is closed.");
            const result = await sealEnrollmentSecrets(owned, key, binding);
            if (disposed) { result.fill(0); throw new Error("Enrollment session is closed."); }
            return result;
          },
          dispose,
        };
      } finally { keys.free(); }
    } finally { paths.free(); }
  } catch (error) {
    dispose();
    // Cancellation can finish before key generation returns.
    if (secrets) clearEnrollmentSecrets(secrets);
    throw error;
  }
}
