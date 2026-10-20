import { WalletOpenError } from "./wallet-errors";

export type RegistrationState = "submitting" | "failed" | "finalized";

export function registrationState(credentialId: string): RegistrationState | null {
  const value = window.localStorage.getItem(`world-id-staging-registration-v1:${credentialId}`);
  if (value !== null && value !== "submitting" && value !== "failed" && value !== "finalized") {
    throw new WalletOpenError("Saved registration status is invalid. Do not clear site data to retry registration.");
  }
  return value;
}

export function saveRegistrationState(credentialId: string, state: RegistrationState): void {
  window.localStorage.setItem(`world-id-staging-registration-v1:${credentialId}`, state);
}

/** Keep the opaque retry capability, never the credential blinding factor or account seed. */
export function selfieIssuanceToken(sub: string): string {
  if (!/^0x[0-9a-f]{64}$/.test(sub)) throw new Error('Invalid staging credential subject.');
  const key = `world-id-staging-selfie-resume:${sub}`;
  let token = window.localStorage.getItem(key);
  if (token === null) {
    token = Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join('');
    window.localStorage.setItem(key, token);
  }
  if (!/^[0-9a-f]{64}$/.test(token)) throw new Error('The saved Selfie issuance resume token is invalid.');
  return token;
}
