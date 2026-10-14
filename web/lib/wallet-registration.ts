import { logFlowStep } from './flow-logging';
import { WalletRegistrationError } from "./wallet-errors";
import type { WalletKit } from "./walletkit";
import { abortable, pause } from "./async";
import { registrationState, saveRegistrationState } from "./wallet-persistence";

export async function activateStagingWallet(
  wallet: WalletKit,
  seed: Uint8Array,
  credentialId: string,
  signal: AbortSignal,
  progress: (message: string) => void,
): Promise<void> {
  const saved = registrationState(credentialId);
  let stage = "initialize the registered account";
  try {
    if (saved === null || saved === "failed") {
      signal.throwIfAborted();
      // Persist before the remote mutation: an ambiguous result must never trigger a second registration.
      saveRegistrationState(credentialId, "submitting");
      stage = "confirm staging registration; it may already have been submitted";
      progress("Registering your World ID account on staging…");
      await logFlowStep("registration.submit", () => abortable(wallet.register(seed), AbortSignal.any([signal, AbortSignal.timeout(30_000)])));
      for (;;) {
        const status = await logFlowStep("registration.poll", () => abortable(wallet.pollRegistration(), AbortSignal.any([signal, AbortSignal.timeout(30_000)])));
        if (status.state === "failed") {
          saveRegistrationState(credentialId, "failed");
          throw new WalletRegistrationError("Registration failed. Retry with your existing passkey to submit registration again.", false);
        }
        if (!["queued", "batching", "submitted", "finalized"].includes(status.state)) {
          throw new Error("Registration was not finalized.");
        }
        progress(`Staging registration: ${status.state}.`);
        if (status.state === "finalized") break;
        await pause(1000, signal);
      }
      saveRegistrationState(credentialId, "finalized");
    }
    progress(saved === "submitting"
      ? "Checking the previously submitted account. No new registration will be sent…"
      : "Opening the registered authenticator and encrypted vault…");
    await logFlowStep("registration.initialize_authenticator", () => abortable(wallet.initializeAuthenticator(seed), AbortSignal.any([signal, AbortSignal.timeout(30_000)])));
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
