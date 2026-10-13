import { WalletOpenError } from "./errors";

export type RegistrationState = "submitting" | "finalized";

export function registrationState(credentialId: string): RegistrationState | null {
  const value = window.localStorage.getItem(`world-id-staging-registration-v1:${credentialId}`);
  if (value !== null && value !== "submitting" && value !== "finalized") {
    throw new WalletOpenError("Saved registration status is invalid. Do not clear site data to retry registration.");
  }
  return value;
}

export function saveRegistrationState(credentialId: string, state: RegistrationState): void {
  window.localStorage.setItem(`world-id-staging-registration-v1:${credentialId}`, state);
}

/** An opaque issuer operation capability, never a passkey secret or blinding factor. */
export function selfieResumeToken(sub: string): string {
  const key = `world-id-staging-selfie-resume:${sub}`;
  let token = window.localStorage.getItem(key);
  if (token === null) {
    token = Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, "0")).join("");
    window.localStorage.setItem(key, token);
  }
  if (!/^[0-9a-f]{64}$/.test(token)) throw new Error("The saved selfie enrollment resume token is invalid.");
  return token;
}
