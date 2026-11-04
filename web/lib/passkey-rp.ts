/**
 * WebAuthn RP IDs shared with the World ID IdP.
 *
 * The IdP's `/.well-known/webauthn` authorizes exactly one web authenticator origin per
 * environment to use the IdP hostname as its RP ID (Related Origin Requests). Passkeys
 * created under that RP ID are the ones the IdP can later enroll and recognize. The
 * browser enforces the IdP's document; this list only decides which RP ID the page asks for.
 *
 * Never remove a pair: saved wallets created under it would be rejected as invalid
 * metadata, and `scripts/check-related-origins.ts` would stop checking that the IdP still
 * authorizes the origin those wallets need.
 */
export const SHARED_RP_PAIRS: readonly { readonly origin: string; readonly rpId: string }[] = Object.freeze([
  { origin: "https://authenticator.toolsforhumanity.dev", rpId: "auth.worldcoin.dev" },
  { origin: "https://web.sandbox.world.org", rpId: "sandbox.auth.world.org" },
  { origin: "https://web.world.org", rpId: "auth.world.org" },
]);

/**
 * Kill switch: origins listed here stop creating passkeys under the shared RP ID and fall
 * back to the page hostname. Wallets already created under it keep unlocking.
 */
const CREATION_DISABLED_ORIGINS: ReadonlySet<string> = new Set<string>([]);

const SHARED_RP_IDS: ReadonlySet<string> = new Set(SHARED_RP_PAIRS.map(pair => pair.rpId));

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
  const shared = CREATION_DISABLED_ORIGINS.has(origin) ? undefined : SHARED_RP_PAIRS.find(pair => pair.origin === origin)?.rpId;
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
