import { logFlowStep } from './flow-logging';
import { currentProtocolEnvironment } from './environment';
import { parseLegacyProfile } from './legacy-profile';
import { derivePasskeySecrets, AUTHENTICATOR_SALT, STORAGE_SALT } from './legacy-passkey-secrets';
import { registrationState, saveRegistrationState } from './wallet-persistence';
import { initializeWalletKit, type CredentialStore, type WalletKit } from "@worldcoin/walletkit-web";
import { WalletKit as AccountWallet } from "./walletkit";
import { openOrRegisterAuthenticator } from "./wallet-registration";
import { abortable } from "./async";
import { prfBytes } from "./prf-result";
import { isSharedRpId, rpIdForNewPasskey } from "./passkey-rp";
import { WalletOpenError, WalletRegistrationError } from "./wallet-errors";

const PROFILE_KEY = "world-id-wallet-v1";
const LEGACY_PROFILE_KEY = "world-id-passkey-registration-v1";
/** Passkey PRF input label; must equal the contract's `PRF_INPUT_V1_LABEL`. */
export const PRF_INPUT_LABEL = "world-id/web-authenticator/prf/v1";
const PRF_INPUT = new TextEncoder().encode(PRF_INPUT_LABEL);
const KEY_SALT = new TextEncoder().encode("world-id/web-authenticator/keys/v1");
const PASSKEY_NAME = { name: "World ID", displayName: "World ID" } as const;
const SHARED_RP_PASSKEY_NAME = { name: "World ID web authenticator", displayName: "World ID web authenticator" } as const;

export type WalletOpenMode = "open" | "create" | "either";

export interface WalletProfile {
  readonly version: 1;
  readonly credentialId: string;
  /** RP ID the passkey was created under; absent means this page's hostname. */
  readonly rpId?: string;
}

export interface WalletSession {
  readonly client: WalletKit;
  readonly store: CredentialStore;
}

export interface RequestWalletSession {
  readonly ready: Promise<{ wallet: AccountWallet } | { error: unknown }>;
  dispose(): void;
}

type PrfOutputs = AuthenticationExtensionsClientOutputs & {
  prf?: { results?: { first?: unknown; second?: unknown } };
};

/** Whether this browser already holds a wallet, so opening it unlocks instead of creating one. */
export function hasSavedWallet(): boolean {
  try {
    return window.localStorage.getItem(PROFILE_KEY) !== null || window.localStorage.getItem(LEGACY_PROFILE_KEY) !== null;
  } catch {
    // Blocked storage: openAuthenticator reports the actual failure when the user continues.
    return false;
  }
}

export function parseWalletProfile(raw: string): WalletProfile {
  let value: unknown;
  try { value = JSON.parse(raw); }
  catch { throw new WalletOpenError("Saved wallet metadata is invalid. Do not clear site data if you need this wallet."); }
  if (
    typeof value !== "object" || value === null ||
    !("version" in value) || value.version !== 1 ||
    !("credentialId" in value) || typeof value.credentialId !== "string" ||
    !/^(?:[0-9a-f]{2}){1,1024}$/.test(value.credentialId) ||
    ("rpId" in value && !isSharedRpId(value.rpId))
  ) throw new WalletOpenError("Saved wallet metadata is invalid. Do not clear site data if you need this wallet.");
  return "rpId" in value && isSharedRpId(value.rpId)
    ? { version: 1, credentialId: value.credentialId, rpId: value.rpId }
    : { version: 1, credentialId: value.credentialId };
}

export async function deriveWalletKeys(prf: Uint8Array<ArrayBuffer>): Promise<{
  seed: Uint8Array<ArrayBuffer>;
  databaseKey: Uint8Array<ArrayBuffer>;
}> {
  if (prf.byteLength !== 32) throw new WalletOpenError("The passkey returned invalid PRF output.");
  const key = await crypto.subtle.importKey("raw", prf, "HKDF", false, ["deriveBits"]);
  const derive = async (purpose: string) => new Uint8Array(await crypto.subtle.deriveBits({
    name: "HKDF", hash: "SHA-256", salt: KEY_SALT,
    info: new TextEncoder().encode(purpose),
  }, key, 256));
  return { seed: await derive("authenticator-seed"), databaseKey: await derive("credential-store") };
}

/** Unlocks the local vault. This does not register an account or issue a credential. */
export async function openPasskeyWallet(signal: AbortSignal): Promise<WalletSession> {
  return openWithPasskey(signal);
}

/** The camera can open with the vault while account activation continues. */
export async function openRequestWallet(signal: AbortSignal, progress: (message: string) => void = () => {}, mode: WalletOpenMode = "either"): Promise<RequestWalletSession> {
  let resolveOpened!: (session: RequestWalletSession) => void;
  let rejectOpened!: (cause: unknown) => void;
  const opened = new Promise<RequestWalletSession>((resolve, reject) => { resolveOpened = resolve; rejectOpened = reject; });
  const controller = new AbortController();
  let account!: AccountWallet;
  // Keep the existing lock and seed ownership until activation settles, without
  // blocking camera startup or copying the seed into a second lifetime.
  const operation = openWithPasskey(AbortSignal.any([signal, controller.signal]), async (session, seed, credentialId, deadline, registerIfMissing) => {
    account = new AccountWallet(session.client, session.store, currentProtocolEnvironment(), "us");
    resolveOpened({
      ready,
      dispose: () => {
        if (controller.signal.aborted) return;
        controller.abort(); session.client.terminate();
      },
    });
    await openOrRegisterAuthenticator(account, seed, credentialId, deadline, () => progress("Getting your World ID ready…"), registerIfMissing);
  }, mode);
  // Opening failures reject the opener. Later failures are explicit results for
  // the request flow, including when capture has not yet finished.
  const ready = operation.then(
    () => ({ wallet: account }),
    error => { rejectOpened(error); return { error }; },
  );
  return opened;
}

/**
 * Opens or creates an authenticator according to the requested mode.
 * The seed stays inside the unlock scope and is erased after account activation.
 */
export async function openAuthenticator(signal: AbortSignal, progress: (message: string) => void, mode: WalletOpenMode = "either"): Promise<AccountWallet> {
  let account: AccountWallet | undefined;
  await openWithPasskey(signal, async (session, seed, credentialId, deadline, registerIfMissing) => {
    account = new AccountWallet(session.client, session.store, currentProtocolEnvironment(), "us");
    await openOrRegisterAuthenticator(account, seed, credentialId, deadline, progress, registerIfMissing);
  }, mode);
  if (!account) throw new WalletOpenError("The authenticator could not be opened.");
  return account;
}

type Activate = (session: WalletSession, seed: Uint8Array, credentialId: string, signal: AbortSignal, registerIfMissing: boolean) => Promise<void>;

async function openWithPasskey(signal: AbortSignal, activate?: Activate, mode: WalletOpenMode = "either"): Promise<WalletSession> {
  if (!window.isSecureContext || typeof PublicKeyCredential === "undefined") {
    throw new WalletOpenError("Use a secure browser with a PRF-capable passkey provider.");
  }
  if (window.top !== window.self || document.visibilityState !== "visible") {
    throw new WalletOpenError("Open this authenticator in a visible top-level browser tab.");
  }
  if (navigator.locks === undefined) {
    throw new WalletOpenError("This browser cannot safely coordinate wallet setup across tabs.");
  }
  return navigator.locks.request("world-id-wallet-setup-v1", { ifAvailable: true }, async (lock) => {
    if (lock === null) throw new WalletOpenError("Wallet setup is already running in another tab.");
    const saved = window.localStorage.getItem(PROFILE_KEY) !== null || window.localStorage.getItem(LEGACY_PROFILE_KEY) !== null;
    if (mode === "create" && saved) throw new WalletOpenError("An authenticator already exists in this browser. Sign in to continue.");
    return openWalletUnderLock(signal, activate, mode);
  });
}

/**
 * Under a shared RP ID, a SecurityError means the browser could not confirm the IdP's
 * Related Origin Requests document, not that the page is insecure.
 */
function sharedRpFailure(rpId: string | undefined): (cause: unknown) => never {
  return cause => {
    if (rpId && cause instanceof Error && cause.name === "SecurityError") {
      throw new WalletOpenError(`The browser could not confirm this page may use World ID passkeys from ${rpId}. Check your connection and try again.`, { cause });
    }
    throw cause;
  };
}

async function openWalletUnderLock(signal: AbortSignal, activate?: Activate, mode: WalletOpenMode = "either"): Promise<WalletSession> {
  signal.throwIfAborted();
  const saved = window.localStorage.getItem(PROFILE_KEY);
  let profile = saved === null ? undefined : parseWalletProfile(saved);
  const legacyRaw = window.localStorage.getItem(LEGACY_PROFILE_KEY);
  const legacy = legacyRaw === null ? undefined : parseLegacyProfile(legacyRaw);
  const useLegacy = legacy !== undefined && (profile === undefined || profile.credentialId === legacy.credentialId);
  if (useLegacy && legacy) {
    profile = { version: 1, credentialId: legacy.credentialId };
    if (legacy.registration !== 'created' && registrationState(legacy.credentialId) === null) {
      saveRegistrationState(legacy.credentialId, legacy.registration);
    }
  }
  let createdCredential: PublicKeyCredential | undefined;
  const discovering = profile === undefined && mode === "open";
  if (profile === undefined && !discovering) {
    const rpId = await rpIdForNewPasskey(window.location.origin, PublicKeyCredential);
    const credential = await logFlowStep(rpId ? "passkey.create_shared_rp" : "passkey.create", () => navigator.credentials.create({
      signal,
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        rp: rpId ? { id: rpId, name: "World ID" } : { name: "World ID" },
        // Under the shared RP ID this passkey also appears in the IdP's sign-in picker,
        // next to its "World ID · <suffix>" login passkeys; a distinct name tells them apart.
        user: { id: crypto.getRandomValues(new Uint8Array(32)), ...(rpId ? SHARED_RP_PASSKEY_NAME : PASSKEY_NAME) },
        pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
        authenticatorSelection: { residentKey: "required", userVerification: "required" },
        attestation: "none", timeout: 60_000,
        extensions: { prf: { eval: { first: PRF_INPUT } } } as AuthenticationExtensionsClientInputs,
      },
    })).catch(sharedRpFailure(rpId));
    if (!(credential instanceof PublicKeyCredential)) throw new WalletOpenError("Passkey creation was not completed.");
    const extensions = credential.getClientExtensionResults() as PrfOutputs & { prf?: { enabled?: boolean } };
    if (extensions.prf?.enabled !== true) throw new WalletOpenError("This passkey provider does not support PRF. Choose a PRF-capable provider.");
    // Providers that evaluate PRF during creation need no second WebAuthn ceremony.
    // Missing results require an assertion; malformed results fail validation below.
    if (extensions.prf.results !== undefined) createdCredential = credential;
    const createdId = Array.from(new Uint8Array(credential.rawId), b => b.toString(16).padStart(2, "0")).join("");
    profile = rpId ? { version: 1, credentialId: createdId, rpId } : { version: 1, credentialId: createdId };
    // Persist only the public credential ID, before opening any encrypted storage.
    window.localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  }
  const credentialId = profile ? Uint8Array.from(profile.credentialId.match(/../g)!, pair => Number.parseInt(pair, 16)) : undefined;
  const unlockRpId = profile?.rpId ?? (discovering ? await rpIdForNewPasskey(window.location.origin, PublicKeyCredential) : undefined);
  const credential = createdCredential ?? await logFlowStep(unlockRpId ? "passkey.unlock_prf_shared_rp" : "passkey.unlock_prf", () => navigator.credentials.get({
    signal,
    publicKey: {
      ...(unlockRpId ? { rpId: unlockRpId } : {}),
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      ...(credentialId ? { allowCredentials: [{ type: "public-key" as const, id: credentialId }] } : {}),
      userVerification: "required", timeout: 60_000,
      extensions: { prf: { eval: useLegacy ? { first: new TextEncoder().encode(AUTHENTICATOR_SALT), second: new TextEncoder().encode(STORAGE_SALT) } : { first: PRF_INPUT } } } as AuthenticationExtensionsClientInputs,
    },
  })).catch(sharedRpFailure(unlockRpId));
  if (!(credential instanceof PublicKeyCredential) || credential.type !== "public-key") {
    throw new WalletOpenError("Passkey unlock was not completed.");
  }
  const actualId = new Uint8Array(credential.rawId);
  if (actualId.length === 0 || actualId.length > 1024 || (credentialId && (actualId.length !== credentialId.length || actualId.some((byte, index) => byte !== credentialId[index])))) {
    throw new WalletOpenError("The passkey does not match this wallet.");
  }
  const outputs = (credential.getClientExtensionResults() as PrfOutputs).prf?.results;
  const output = outputs?.first;
  const second = useLegacy ? prfBytes(outputs?.second) : undefined;
  const prf = prfBytes(output);
  if (!prf || (useLegacy && !second)) {
    prf?.fill(0);
    second?.fill(0);
    throw new WalletOpenError("This passkey did not provide the PRF output needed to unlock your wallet.");
  }
  const selectedId = Array.from(actualId, byte => byte.toString(16).padStart(2, "0")).join("");
  const selectedProfile: WalletProfile = profile ?? (unlockRpId ? { version: 1, credentialId: selectedId, rpId: unlockRpId } : { version: 1, credentialId: selectedId });
  let keys: Awaited<ReturnType<typeof deriveWalletKeys>> | undefined;
  let client: WalletKit | undefined;
  const opening = new AbortController();
  const abort = () => { opening.abort(); client?.terminate(); };
  const timeout = setTimeout(() => {
    opening.abort(new DOMException("Wallet setup timed out", "TimeoutError"));
    client?.terminate();
  }, activate ? 300_000 : 60_000);
  signal.addEventListener("abort", abort, { once: true });
  try {
    signal.throwIfAborted();
    keys = await logFlowStep("passkey.derive_secrets", () => useLegacy && second ? derivePasskeySecrets(prf.buffer, second.buffer) : deriveWalletKeys(prf));
    client = await logFlowStep("walletkit.worker_initialize", () => initializeWalletKit({ signal: opening.signal }));
    const storageKeys = await client.StorageKeys.fromBytes(keys.databaseKey);
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", useLegacy && legacy ? new TextEncoder().encode(legacy.originalCredentialId) : actualId));
    const root = Array.from(digest, b => b.toString(16).padStart(2, "0")).join("");
    const paths = await client.StoragePaths.fromRoot(`/walletkit/${useLegacy ? "passkey-" : ""}${root}`);
    let store: CredentialStore;
    try {
      store = await logFlowStep("walletkit.storage_open", () => client!.CredentialStore.new(paths, storageKeys));
      await logFlowStep("registration.derive_public_material", () => client!.recoveryDataFromSeed(keys!.seed));
    } finally {
      paths.free();
      storageKeys.free();
    }
    signal.throwIfAborted();
    opening.signal.throwIfAborted();
    if (activate) await abortable(activate({ client, store }, keys.seed, selectedProfile.credentialId, opening.signal, !discovering), opening.signal);
    // Only retain a discovered profile after its account has actually opened.
    if (discovering) window.localStorage.setItem(PROFILE_KEY, JSON.stringify(selectedProfile));
    return { client, store };
  } catch (error) {
    client?.terminate();
    if (activate && opening.signal.reason instanceof Error && opening.signal.reason.name === "TimeoutError") {
      throw new WalletRegistrationError("Wallet setup timed out. Retry with your existing passkey. Any previously submitted registration will be checked before continuing.", true, { cause: error });
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener("abort", abort);
    prf.fill(0);
    second?.fill(0);
    keys?.seed.fill(0);
    keys?.databaseKey.fill(0);
  }
}
