// Analytics consent, recorded in one strictly necessary first-party cookie.
// Set only by the server so page code never touches cookies, HttpOnly so it
// cannot be read or forged by script, and __Host- so no subdomain can set it.
// The value holds the choice and the policy version, never an identifier.

export type ConsentChoice = "granted" | "denied";
export type ConsentState = ConsentChoice | "unset";

// Bump when the consent text materially changes; older choices then read as unset.
export const CONSENT_VERSION = "v1";
export const CONSENT_COOKIE = "__Host-wid_consent";
const MAX_AGE_SECONDS = 180 * 24 * 60 * 60;

export function readConsent(request: Request): ConsentState {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const [name, value] = part.trim().split("=", 2);
    if (name !== CONSENT_COOKIE) continue;
    if (value === `${CONSENT_VERSION}.granted`) return "granted";
    if (value === `${CONSENT_VERSION}.denied`) return "denied";
    return "unset";
  }
  return "unset";
}

/** Global Privacy Control is an opt-out signal: without an explicit choice it means denied. */
export function effectiveConsent(request: Request): ConsentState {
  const state = readConsent(request);
  return state === "unset" && request.headers.get("sec-gpc") === "1" ? "denied" : state;
}

export function consentCookie(choice: ConsentChoice): string {
  return `${CONSENT_COOKIE}=${CONSENT_VERSION}.${choice}; Max-Age=${MAX_AGE_SECONDS}; Path=/; Secure; HttpOnly; SameSite=Lax`;
}
