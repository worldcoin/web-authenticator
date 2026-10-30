// Analytics consent is kept in this browser's localStorage and never sent to the server.
// The stored value holds the choice, the policy version and when it was made, never an identifier.
export type ConsentState = "granted" | "denied" | "unset";
export type ConsentChoice = Exclude<ConsentState, "unset">;

export interface ConsentClient {
  read(): Promise<ConsentState>;
  save(choice: ConsentChoice): Promise<ConsentState>;
}

// Bump when the consent text materially changes; older choices then read as unset.
export const CONSENT_VERSION = "v1";
export const CONSENT_KEY = "wid_consent";
const MAX_AGE_MS = 180 * 24 * 60 * 60 * 1000;

interface StoredConsent { choice: ConsentChoice; version: string; at: number }

function parse(raw: string | null, now: number): ConsentChoice | undefined {
  if (raw === null) return undefined;
  try {
    const { choice, version, at } = JSON.parse(raw) as Partial<StoredConsent>;
    if (version !== CONSENT_VERSION || typeof at !== "number" || now - at > MAX_AGE_MS) return undefined;
    return choice === "granted" || choice === "denied" ? choice : undefined;
  } catch {
    return undefined;
  }
}

const globalPrivacyControl = () => (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl === true;

// Storage is resolved per call: reading `window.localStorage` itself throws when storage is blocked.
export function createConsentClient(storage = () => window.localStorage, gpc = globalPrivacyControl, now = Date.now): ConsentClient {
  return {
    // Global Privacy Control is an opt-out signal: without an explicit choice it means denied.
    read: async () => parse(storage().getItem(CONSENT_KEY), now()) ?? (gpc() ? "denied" : "unset"),
    save: async choice => {
      storage().setItem(CONSENT_KEY, JSON.stringify({ choice, version: CONSENT_VERSION, at: now() } satisfies StoredConsent));
      return choice;
    },
  };
}

export const consentClient = createConsentClient();
