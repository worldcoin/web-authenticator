/**
 * WebAuthn RP IDs shared with the World ID IdP.
 *
 * The IdP's `/.well-known/webauthn` authorizes exactly one web authenticator origin per
 * environment to use the IdP hostname as its RP ID (Related Origin Requests). Passkeys
 * created under that RP ID are the ones the IdP can later enroll and recognize.
 *
 * Removing an entry here stops new passkeys from using the shared RP ID for that origin.
 * Existing wallets keep working, because each saved profile records the RP ID its passkey
 * was created under.
 */
const SHARED_RP_ID_BY_ORIGIN: Readonly<Record<string, string>> = Object.freeze({
  "https://authenticator.toolsforhumanity.dev": "auth.worldcoin.dev",
  "https://web.sandbox.world.org": "sandbox.auth.world.org",
  "https://web.world.org": "auth.world.org",
});

const SHARED_RP_IDS: ReadonlySet<string> = new Set(Object.values(SHARED_RP_ID_BY_ORIGIN));

/** Whether a saved profile's RP ID is one this app may request. */
export function isSharedRpId(value: unknown): value is string {
  return typeof value === "string" && SHARED_RP_IDS.has(value);
}

/**
 * RP ID for a passkey this origin is about to create, or `undefined` for the browser
 * default (this page's hostname, the behavior before the shared RP ID).
 *
 * The shared RP ID is used only when the browser reports Related Origin Requests support.
 * Otherwise `create()` would fail with a SecurityError, so the page keeps the default.
 */
export async function rpIdForNewPasskey(origin: string, publicKeyCredential: unknown): Promise<string | undefined> {
  const shared = Object.hasOwn(SHARED_RP_ID_BY_ORIGIN, origin) ? SHARED_RP_ID_BY_ORIGIN[origin] : undefined;
  if (shared === undefined || publicKeyCredential === null || typeof publicKeyCredential !== "function") return undefined;
  const getClientCapabilities: unknown = (publicKeyCredential as { getClientCapabilities?: unknown }).getClientCapabilities;
  if (typeof getClientCapabilities !== "function") return undefined;
  try {
    const capabilities: unknown = await getClientCapabilities.call(publicKeyCredential);
    return typeof capabilities === "object" && capabilities !== null &&
      (capabilities as { relatedOrigins?: unknown }).relatedOrigins === true ? shared : undefined;
  } catch {
    // Unknown support: creating under this page's hostname still works everywhere.
    return undefined;
  }
}
