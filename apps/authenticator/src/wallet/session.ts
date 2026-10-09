import { initializeWalletKit, type CredentialStore, type WalletKit } from "@worldcoin/walletkit-web";
import { WalletKit as AccountWallet } from "../lib/walletkit";
import { activateStagingWallet } from "./registration";
import { abortable } from "../lib/async";

const PROFILE_KEY = "world-id-wallet-v1";
const PRF_INPUT = new TextEncoder().encode("world-id/web-authenticator/prf/v1");
const KEY_SALT = new TextEncoder().encode("world-id/web-authenticator/keys/v1");

export interface WalletProfile {
  readonly version: 1;
  readonly credentialId: string;
}

export interface WalletSession {
  readonly client: WalletKit;
  readonly store: CredentialStore;
}

type PrfOutputs = AuthenticationExtensionsClientOutputs & {
  prf?: { results?: { first?: ArrayBuffer } };
};

export function parseWalletProfile(raw: string): WalletProfile {
  const value: unknown = JSON.parse(raw);
  if (
    typeof value !== "object" || value === null ||
    !("version" in value) || value.version !== 1 ||
    !("credentialId" in value) || typeof value.credentialId !== "string" ||
    !/^(?:[0-9a-f]{2}){1,1024}$/.test(value.credentialId)
  ) throw new Error("Saved wallet metadata is invalid. Do not clear site data if you need this wallet.");
  return { version: 1, credentialId: value.credentialId };
}

export async function deriveWalletKeys(prf: Uint8Array<ArrayBuffer>): Promise<{
  seed: Uint8Array<ArrayBuffer>;
  databaseKey: Uint8Array<ArrayBuffer>;
}> {
  if (prf.byteLength !== 32) throw new Error("The passkey returned invalid PRF output.");
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

/** The seed stays inside the unlock scope and is erased after account activation. */
export async function openAuthenticator(signal: AbortSignal, progress: (message: string) => void): Promise<AccountWallet> {
  let account: AccountWallet | undefined;
  await openWithPasskey(signal, async (session, seed, credentialId, deadline) => {
    account = new AccountWallet(session.client, session.store, "staging", "us");
    await activateStagingWallet(account, seed, credentialId, deadline, progress);
  });
  if (!account) throw new Error("The authenticator could not be opened.");
  return account;
}

type Activate = (session: WalletSession, seed: Uint8Array, credentialId: string, signal: AbortSignal) => Promise<void>;

async function openWithPasskey(signal: AbortSignal, activate?: Activate): Promise<WalletSession> {
  if (!window.isSecureContext || typeof PublicKeyCredential === "undefined") {
    throw new Error("Use a secure browser with a PRF-capable passkey provider.");
  }
  if (window.top !== window.self || document.visibilityState !== "visible") {
    throw new Error("Open this authenticator in a visible top-level browser tab.");
  }
  if (navigator.locks === undefined) {
    throw new Error("This browser cannot safely coordinate wallet setup across tabs.");
  }
  return navigator.locks.request("world-id-wallet-setup-v1", { ifAvailable: true }, async (lock) => {
    if (lock === null) throw new Error("Wallet setup is already running in another tab.");
    return openWalletUnderLock(signal, activate);
  });
}

async function openWalletUnderLock(signal: AbortSignal, activate?: Activate): Promise<WalletSession> {
  signal.throwIfAborted();
  const saved = window.localStorage.getItem(PROFILE_KEY);
  let profile = saved === null ? undefined : parseWalletProfile(saved);
  if (profile === undefined) {
    const credential = await navigator.credentials.create({
      signal,
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        rp: { name: "World ID" },
        user: { id: crypto.getRandomValues(new Uint8Array(32)), name: "World ID", displayName: "World ID" },
        pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
        authenticatorSelection: { residentKey: "required", userVerification: "required" },
        attestation: "none", timeout: 60_000,
        extensions: { prf: {} } as AuthenticationExtensionsClientInputs,
      },
    });
    if (!(credential instanceof PublicKeyCredential)) throw new Error("Passkey creation was not completed.");
    const extensions = credential.getClientExtensionResults() as AuthenticationExtensionsClientOutputs & { prf?: { enabled?: boolean } };
    if (extensions.prf?.enabled !== true) throw new Error("This passkey provider does not support PRF. Choose a PRF-capable provider.");
    profile = { version: 1, credentialId: Array.from(new Uint8Array(credential.rawId), b => b.toString(16).padStart(2, "0")).join("") };
    // Persist only the public credential ID, before opening any encrypted storage.
    window.localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  }
  const credentialId = Uint8Array.from(profile.credentialId.match(/../g)!, pair => Number.parseInt(pair, 16));
  const credential = await navigator.credentials.get({
    signal,
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      allowCredentials: [{ type: "public-key", id: credentialId }],
      userVerification: "required", timeout: 60_000,
      extensions: { prf: { eval: { first: PRF_INPUT } } } as AuthenticationExtensionsClientInputs,
    },
  });
  if (!(credential instanceof PublicKeyCredential) || credential.type !== "public-key") {
    throw new Error("Passkey unlock was not completed.");
  }
  const actualId = new Uint8Array(credential.rawId);
  if (actualId.length !== credentialId.length || actualId.some((byte, index) => byte !== credentialId[index])) {
    throw new Error("The passkey does not match this wallet.");
  }
  const output = (credential.getClientExtensionResults() as PrfOutputs).prf?.results?.first;
  if (!(output instanceof ArrayBuffer) || output.byteLength !== 32) {
    throw new Error("This passkey did not provide the PRF output needed to unlock your wallet.");
  }
  const prf = new Uint8Array(output);
  let keys: Awaited<ReturnType<typeof deriveWalletKeys>> | undefined;
  let client: WalletKit | undefined;
  const opening = new AbortController();
  const abort = () => { opening.abort(); client?.terminate(); };
  const timeout = setTimeout(abort, activate ? 300_000 : 60_000);
  signal.addEventListener("abort", abort, { once: true });
  try {
    signal.throwIfAborted();
    keys = await deriveWalletKeys(prf);
    client = await initializeWalletKit({ signal: opening.signal });
    const storageKeys = await client.StorageKeys.fromBytes(keys.databaseKey);
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", credentialId));
    const root = Array.from(digest, b => b.toString(16).padStart(2, "0")).join("");
    const paths = await client.StoragePaths.fromRoot(`/walletkit/${root}`);
    let store: CredentialStore;
    try {
      store = await client.CredentialStore.new(paths, storageKeys);
      await client.recoveryDataFromSeed(keys.seed);
    } finally {
      paths.free();
      storageKeys.free();
    }
    signal.throwIfAborted();
    opening.signal.throwIfAborted();
    if (activate) await abortable(activate({ client, store }, keys.seed, profile.credentialId, opening.signal), opening.signal);
    return { client, store };
  } catch (error) {
    client?.terminate();
    throw error;
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener("abort", abort);
    prf.fill(0);
    keys?.seed.fill(0);
    keys?.databaseKey.fill(0);
  }
}
