import { currentProtocolEnvironment } from "./environment";
import { WalletOpenError } from "./wallet-errors";

export type RegistrationState = "submitting" | "failed" | "finalized";

export function registrationState(credentialId: string): RegistrationState | null {
  const value = window.localStorage.getItem(`world-id-${currentProtocolEnvironment()}-registration-v1:${credentialId}`);
  if (value !== null && value !== "submitting" && value !== "failed" && value !== "finalized") {
    throw new WalletOpenError("Saved registration status is invalid. Do not clear site data to retry registration.");
  }
  return value;
}

export function saveRegistrationState(credentialId: string, state: RegistrationState): void {
  window.localStorage.setItem(`world-id-${currentProtocolEnvironment()}-registration-v1:${credentialId}`, state);
}
