import { WalletOpenError } from "./errors";
import type { WalletKit } from "../lib/walletkit";
import { abortable, pause } from "../lib/async";
import { registrationState, saveRegistrationState } from "./persistence";

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
    if (saved === null) {
      signal.throwIfAborted();
      // Persist before the remote mutation: an ambiguous result must never trigger a second registration.
      saveRegistrationState(credentialId, "submitting");
      stage = "confirm staging registration; it may already have been submitted";
      progress("Registering your World ID account on staging…");
      await abortable(wallet.register(seed), signal);
      for (;;) {
        const status = await abortable(wallet.pollRegistration(), signal);
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
    await abortable(wallet.initializeAuthenticator(seed), signal);
    signal.throwIfAborted();
    saveRegistrationState(credentialId, "finalized");
  } catch (cause) {
    wallet.terminate();
    throw new WalletOpenError(`Could not ${stage}. Unlock to check again. No automatic resubmission was made.`, { cause });
  }
}
