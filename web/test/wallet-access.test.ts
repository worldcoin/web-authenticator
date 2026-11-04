import { afterAll, afterEach, beforeAll, beforeEach, expect, spyOn, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import * as published from '@worldcoin/walletkit-web';
import { openAuthenticator, PRF_INPUT_LABEL } from "../lib/wallet-session";
import { derivePasskeySecrets, AUTHENTICATOR_SALT, STORAGE_SALT } from '../lib/legacy-passkey-secrets';

const profileKey = 'world-id-wallet-v1';
class Passkey {
  type = 'public-key';
  constructor(readonly rawId = new Uint8Array([171]).buffer, readonly prf: Uint8Array | undefined = new Uint8Array(32).fill(7), readonly second?: Uint8Array) {}
  getClientExtensionResults() { return { prf: { results: { first: this.prf, second: this.second } } }; }
}

beforeAll(() => {
  GlobalRegistrator.register({ url: "https://localhost/" });
  Object.defineProperty(window, "isSecureContext", { configurable: true, value: true });
  Object.defineProperty(globalThis, "PublicKeyCredential", { configurable: true, value: Passkey });
  Object.defineProperty(navigator, "locks", { configurable: true, value: { request: async (_name: string, _options: unknown, callback: (lock: object) => unknown) => callback({}) } });
});
beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());
afterAll(() => GlobalRegistrator.unregister());

function fixture(options: { passkey?: Passkey; accountError?: boolean; faceError?: boolean; cancel?: boolean; onInitialize?: () => void } = {}) {
  const passkey = options.passkey ?? new Passkey();
  const calls = { create: 0, initialize: 0, register: 0, terminate: 0, get: [] as CredentialRequestOptions[], seeds: [] as Uint8Array[], face: [] as Uint8Array[], database: [] as Uint8Array[], roots: [] as string[], profilesAtInitialization: [] as (string | null)[] };
  let commitment = '';
  const secretCopies = { seed: '', face: '', database: '' };
  const capture = (kind: keyof typeof secretCopies, bytes: Uint8Array) => { secretCopies[kind] = Buffer.from(bytes).toString('hex'); };
  Object.defineProperty(navigator, 'credentials', { configurable: true, value: {
    get: async (request: CredentialRequestOptions) => {
      calls.get.push(request);
      if (options.cancel) throw new DOMException('Cancelled', 'NotAllowedError');
      return passkey;
    },
    create: async () => { calls.create++; throw new Error('Must not create during sign-in'); },
  } });
  const free = () => {};
  const store = { listCredentials: async () => [] };
  const client = {
    Identity: { fromSeed: async (seed: Uint8Array, context: published.IdentityContext) => {
      expect(context).toBe(published.IdentityContext.Face);
      calls.face.push(seed); capture('face', seed); commitment = secretCopies.face;
      if (options.faceError) throw new Error('Face initialization failed');
      return { commitment: async () => `0x${commitment}`, free };
    } },
    StorageKeys: { fromBytes: async (key: Uint8Array) => { calls.database.push(key); capture('database', key); return { free }; } },
    StoragePaths: { fromRoot: async (root: string) => { calls.roots.push(root); return { free }; } },
    CredentialStore: { new: async () => store },
    recoveryDataFromSeed: async () => ({}),
    EmbeddedZkArtifacts: { new: async () => ({ free }) },
    Authenticator: { initWithDefaults: async (seed: Uint8Array) => {
      calls.initialize++; calls.seeds.push(seed); capture('seed', seed);
      options.onInitialize?.();
      calls.profilesAtInitialization.push(localStorage.getItem(profileKey));
      if (options.accountError) throw new Error('Account not found');
      return { initStorage: async () => {}, free };
    } },
    InitializingAuthenticator: { registerWithDefaults: async () => { calls.register++; throw new Error('Must not register during recovery'); } },
    terminate: () => { calls.terminate++; },
  } as unknown as published.WalletKit;
  const initialize = spyOn(published, 'initializeWalletKit').mockResolvedValue(client);
  return { calls, secretCopies, passkey, restore: () => initialize.mockRestore() };
}

const open = () => openAuthenticator(new AbortController().signal, () => {}, 'open');
const expectErased = (f: ReturnType<typeof fixture>) => {
  for (const buffer of [...f.calls.seeds, ...f.calls.face, ...f.calls.database, ...(f.passkey.prf ? [f.passkey.prf] : []), ...(f.passkey.second ? [f.passkey.second] : [])]) {
    expect(buffer.every(byte => byte === 0)).toBe(true);
  }
};

test('discovery recovers the same identity after profile clearing without registering or restoring credentials', async () => {
  let firstCommitment: string;
  const first = fixture();
  try {
    const wallet = await open();
    firstCommitment = await wallet.identityCommitment();
    expect(await wallet.listCredentials()).toEqual([]);
    expect(first.calls.get[0]?.publicKey?.allowCredentials).toBeUndefined();
    expect(first.calls.create).toBe(0);
    expect(first.calls.register).toBe(0);
    expect(first.calls.initialize).toBe(1);
    expect(first.calls.profilesAtInitialization).toEqual([null]);
    expect(JSON.parse(localStorage.getItem(profileKey)!)).toEqual({ version: 1, credentialId: 'ab' });
    expectErased(first);
  } finally { first.restore(); }
  localStorage.clear();
  const reopened = fixture();
  try {
    expect(await (await open()).identityCommitment()).toBe(firstCommitment!);
    expectErased(reopened);
  } finally { reopened.restore(); }
});

test('saved sign-in restricts the passkey and does not replace an existing profile', async () => {
  localStorage.setItem(profileKey, '{"version":1,"credentialId":"ab"}');
  localStorage.setItem('world-id-staging-registration-v1:ab', 'finalized');
  const f = fixture();
  try {
    await open();
    expect(f.calls.get[0]?.publicKey?.allowCredentials?.[0]?.id).toEqual(new Uint8Array([171]));
    await expect(openAuthenticator(new AbortController().signal, () => {}, 'create')).rejects.toThrow('already exists');
    expect(f.calls.create).toBe(0);
    expectErased(f);
  } finally { f.restore(); }
});

test('discovery never creates an account when existing-account verification fails', async () => {
  const f = fixture({ accountError: true });
  try {
    await expect(open()).rejects.toThrow('Older demo passkeys require their original browser data; no new account was created.');
    expect(localStorage.getItem(profileKey)).toBeNull();
    expect(localStorage.getItem('world-id-staging-registration-v1:ab')).toBeNull();
    expect(f.calls.register).toBe(0);
    expect(f.calls.create).toBe(0);
    expect(f.calls.terminate).toBe(1);
    expectErased(f);
  } finally { f.restore(); }
});

test('aborted recovery erases secrets and leaves no recoverable profile or registration', async () => {
  const abort = new AbortController();
  const f = fixture({ onInitialize: () => abort.abort() });
  try {
    await expect(openAuthenticator(abort.signal, () => {}, 'open')).rejects.toThrow();
    expect(localStorage.getItem(profileKey)).toBeNull();
    expect(localStorage.getItem('world-id-staging-registration-v1:ab')).toBeNull();
    expect(f.calls.register).toBe(0);
    expect(f.calls.terminate).toBeGreaterThan(0);
    expectErased(f);
  } finally { f.restore(); }
});

test('recovery timeout cannot persist a profile or fall back to registration', async () => {
  const timeout = spyOn(AbortSignal, 'timeout').mockReturnValue(AbortSignal.abort(new DOMException('Timed out', 'TimeoutError')));
  const f = fixture();
  try {
    await expect(open()).rejects.toThrow('Could not recover the existing authenticator');
    expect(localStorage.getItem(profileKey)).toBeNull();
    expect(localStorage.getItem('world-id-staging-registration-v1:ab')).toBeNull();
    expect(f.calls.register).toBe(0);
    expect(f.calls.terminate).toBe(1);
    expectErased(f);
  } finally { f.restore(); timeout.mockRestore(); }
});

test('failed face initialization erases seed material and terminates the worker', async () => {
  const f = fixture({ faceError: true });
  try {
    await expect(open()).rejects.toThrow('Face initialization failed');
    expect(localStorage.getItem(profileKey)).toBeNull();
    expect(f.calls.terminate).toBe(1);
    expectErased(f);
  } finally { f.restore(); }
});

for (const failure of ['cancel', 'unsupported', 'mismatch'] as const) {
  test(`${failure} cannot create or replace an identity`, async () => {
    const passkey = new Passkey(new Uint8Array([172]).buffer);
    if (failure === 'unsupported') Object.defineProperty(passkey, 'prf', { value: undefined });
    if (failure === 'mismatch') localStorage.setItem(profileKey, '{"version":1,"credentialId":"ab"}');
    const f = fixture({ passkey, cancel: failure === 'cancel' });
    try {
      await expect(open()).rejects.toThrow(failure === 'cancel' ? 'Cancelled' : failure === 'unsupported' ? 'did not provide the PRF' : 'does not match');
      expect(localStorage.getItem(profileKey)).toBe(failure === 'mismatch' ? '{"version":1,"credentialId":"ab"}' : null);
      expect(f.calls.create).toBe(0);
      expect(f.calls.initialize).toBe(0);
      expect(f.calls.face).toHaveLength(0);
      if (failure !== 'cancel') expectErased(f);
    } finally { f.restore(); }
  });
}

test('existing legacy profiles retain their PRF inputs, wallet keys and storage namespace', async () => {
  const raw = JSON.stringify({ version: 1, passkey: { credentialId: 'qw', prfSupported: true }, registration: 'finalized' });
  localStorage.setItem('world-id-passkey-registration-v1', raw);
  const expected = await derivePasskeySecrets(new Uint8Array(32).fill(7).buffer, new Uint8Array(32).fill(8).buffer);
  const f = fixture({ passkey: new Passkey(new Uint8Array([171]).buffer, new Uint8Array(32).fill(7), new Uint8Array(32).fill(8)) });
  try {
    await open();
    const extensions = f.calls.get[0]?.publicKey?.extensions as { prf: { eval: { first: Uint8Array; second: Uint8Array } } };
    expect(new TextDecoder().decode(extensions.prf.eval.first)).toBe(AUTHENTICATOR_SALT);
    expect(new TextDecoder().decode(extensions.prf.eval.second)).toBe(STORAGE_SALT);
    expect(f.secretCopies.seed).toBe(Buffer.from(expected.seed).toString('hex'));
    expect(f.secretCopies.database).toBe(Buffer.from(expected.databaseKey).toString('hex'));
    expect(f.calls.roots[0]).toStartWith('/walletkit/passkey-');
    expect(localStorage.getItem('world-id-passkey-registration-v1')).toBe(raw);
    expect(f.calls.register).toBe(0);
    expectErased(f);
  } finally { f.restore(); }
});

test('discovery uses the versioned current PRF contract', async () => {
  const f = fixture();
  try {
    await open();
    const extensions = f.calls.get[0]?.publicKey?.extensions as { prf: { eval: { first: Uint8Array; second?: Uint8Array } } };
    expect(new TextDecoder().decode(extensions.prf.eval.first)).toBe(PRF_INPUT_LABEL);
    expect(extensions.prf.eval.second).toBeUndefined();
  } finally { f.restore(); }
});
