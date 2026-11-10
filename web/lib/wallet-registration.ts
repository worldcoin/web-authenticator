import { logFlowStep } from './flow-logging';
import { WalletRegistrationError } from "./wallet-errors";
import type { WalletKit } from "./walletkit";
import { abortable, pause } from "./async";
import { registrationState, saveRegistrationState } from "./wallet-persistence";

export async function activateWallet(
  wallet: WalletKit,
  seed: Uint8Array,
  credentialId: string,
  signal: AbortSignal,
  progress: (message: string) => void,
  registerIfMissing = true,
): Promise<void> {
  signal = AbortSignal.any([signal, AbortSignal.timeout(180_000)]);
  const saved = registrationState(credentialId);
  let stage = "initialize the registered account";
  try {
    const initialize = () => logFlowStep("registration.initialize_authenticator", () =>
      abortable(wallet.initializeAuthenticator(seed), AbortSignal.any([signal, AbortSignal.timeout(30_000)])));
    const missingAccount = (cause: unknown) => typeof cause === "object" && cause !== null &&
      "code" in cause && cause.code === "AccountDoesNotExist";
    // Browser metadata can be absent when restoring the same passkey on another device.
    // Check the actual account before considering a registration mutation.
    try {
      await initialize();
      signal.throwIfAborted();
      saveRegistrationState(credentialId, "finalized");
      return;
    } catch (cause) {
      if (!missingAccount(cause)) throw cause;
    }
    if (registerIfMissing && (saved === null || saved === "failed")) {
      signal.throwIfAborted();
      // Persist before the remote mutation: an ambiguous result must never trigger a second registration.
      saveRegistrationState(credentialId, "submitting");
      stage = "confirm registration; it may already have been submitted";
      progress("Setting up your World ID…");
      await logFlowStep("registration.submit", () => abortable(wallet.register(seed), AbortSignal.any([signal, AbortSignal.timeout(30_000)])));
      for (let poll = 0; ; poll++) {
        const status = await logFlowStep("registration.poll", () => abortable(wallet.pollRegistration(), AbortSignal.any([signal, AbortSignal.timeout(30_000)])));
        if (status.state === "failed") {
          saveRegistrationState(credentialId, "failed");
          throw new WalletRegistrationError("Registration failed. Retry with your existing passkey to submit registration again.", false);
        }
        if (!["queued", "batching", "submitted", "finalized"].includes(status.state)) {
          throw new Error("Registration was not finalized.");
        }
        progress(`Registration: ${status.state}.`);
        if (status.state === "finalized") break;
        await pause(Math.min(1000 * 2 ** poll, 4000), signal);
      }
      saveRegistrationState(credentialId, "finalized");
    }
    // Start indexer checks only after gateway finalization, or to resume a previous
    // ambiguous submission. A pending/missing read never authorizes resubmission.
    stage = "initialize the registered authenticator";
    progress("Waiting for your World ID to become available…");
    for (let attempt = 0; ; attempt++) {
      if (attempt > 0 || !registerIfMissing || saved === "submitting" || saved === "finalized") {
        await pause(Math.min(500 * 2 ** attempt, 4000), signal);
      }
      try { await initialize(); break; }
      catch (cause) {
        if (!missingAccount(cause)) throw cause;
        if (attempt >= 7) {
          if (!registerIfMissing) throw new WalletRegistrationError("No registered authenticator was found for this passkey. No new account was created.", false);
          throw cause;
        }
      }
    }
    signal.throwIfAborted();
    saveRegistrationState(credentialId, "finalized");
  } catch (cause) {
    wallet.terminate();
    if (cause instanceof WalletRegistrationError) throw cause;
    const timedOut = cause instanceof Error && cause.name === "TimeoutError";
    throw new WalletRegistrationError(timedOut
      ? "Wallet setup timed out. Registration may still finish. Retry with your existing passkey to check the account; no new registration will be submitted."
      : `Could not ${stage}. Retry with your existing passkey to check the account. No automatic resubmission was made.`, timedOut, { cause });
  }
}
