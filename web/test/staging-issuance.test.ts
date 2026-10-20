import { afterAll, beforeAll, expect, spyOn, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { issueStagingCredential } from '../lib/staging-issuance';
import type { WalletKit } from '../lib/walletkit';

beforeAll(() => GlobalRegistrator.register({ url: 'http://localhost:4173/' }));
afterAll(() => GlobalRegistrator.unregister());
const sub = '0x' + 'a'.repeat(64);
const credential = (schema: number, subject = sub) => `{"sub":"${subject}","issuer_schema_id":${schema},"expires_at":9999999999,"id":90071992547409931234}`;
function fixture() {
  const stored: string[] = [];
  let terminated = 0;
  let schema = 128n;
  const wallet = {
    listCredentials: async () => [],
    prepareCredential: async (value: bigint) => { schema = value; return { sub, blindingFactor: 'factor' }; },
    storeCredential: async (bytes: Uint8Array) => { stored.push(new TextDecoder().decode(bytes)); return { issuerSchemaId: schema }; },
    terminate: () => { terminated++; },
  } as unknown as WalletKit;
  return { wallet, stored, terminated: () => terminated };
}

test('Faux issuance preserves signed large integers and stores only the expected subject/schema', async () => {
  const f = fixture();
  const request = spyOn(globalThis, 'fetch').mockImplementation((async (url: RequestInfo | URL, options?: RequestInit) => {
    expect(url).toBe('/api/faux-credential');
    expect(JSON.parse(String(options?.body))).toEqual({ sub });
    return new Response(`{"credential":${credential(128)}}`);
  }) as typeof fetch);
  try {
    await issueStagingCredential(f.wallet, 128, new AbortController().signal, () => {});
    expect(f.stored).toEqual([credential(128)]);
    expect(f.terminated()).toBe(0);
  } finally { request.mockRestore(); }
});

for (const body of [credential(11), credential(128, '0x' + 'b'.repeat(64)), credential(128).replace('9999999999', '1')]) {
  test('Faux issuance rejects a wrong or expired credential before storage', async () => {
    const f = fixture();
    const request = spyOn(globalThis, 'fetch').mockResolvedValue(new Response(`{"credential":${body}}`));
    try {
      await expect(issueStagingCredential(f.wallet, 128, new AbortController().signal, () => {})).rejects.toThrow('wrong subject/schema or is expired');
      expect(f.stored).toEqual([]);
      expect(f.terminated()).toBe(1);
    } finally { request.mockRestore(); }
  });
}

test('Selfie retry reuses the saved operation token and stores the returned credential', async () => {
  window.localStorage.clear();
  const tokens: string[] = [];
  const request = spyOn(globalThis, 'fetch').mockImplementation((async (_url: RequestInfo | URL, options?: RequestInit) => {
    tokens.push(JSON.parse(String(options?.body)).token);
    return tokens.length === 1 ? Response.json({ error: 'Staging unavailable' }, { status: 502 })
      : Response.json({ status: 'issued', credential: btoa(credential(11)) });
  }) as typeof fetch);
  try {
    await expect(issueStagingCredential(fixture().wallet, 11, new AbortController().signal, () => {})).rejects.toThrow('Staging unavailable');
    const f = fixture();
    await issueStagingCredential(f.wallet, 11, new AbortController().signal, () => {});
    expect(tokens).toHaveLength(2);
    expect(tokens[0]).toMatch(/^[0-9a-f]{64}$/);
    expect(tokens[1]).toBe(tokens[0]);
    expect(f.stored).toEqual([credential(11)]);
  } finally { request.mockRestore(); window.localStorage.clear(); }
});

test('cancelling pending Selfie polling stops without storing or resubmitting', async () => {
  window.localStorage.clear();
  const f = fixture();
  const controller = new AbortController();
  const request = spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ status: 'pending', stage: 'Waiting' }));
  try {
    await expect(issueStagingCredential(f.wallet, 11, controller.signal, message => {
      if (message === 'Waiting') controller.abort();
    })).rejects.toThrow();
    expect(request).toHaveBeenCalledTimes(1);
    expect(f.stored).toHaveLength(0);
    expect(f.terminated()).toBeGreaterThan(0);
  } finally { request.mockRestore(); window.localStorage.clear(); }
});

test('disabled issuer endpoints produce an actionable error without storing a credential', async () => {
  const f = fixture();
  const request = spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ error: 'Not found' }, { status: 404 }));
  try {
    await expect(issueStagingCredential(f.wallet, 128, new AbortController().signal, () => {})).rejects.toThrow('ENABLE_STAGING_ISSUERS=1');
    expect(f.stored).toHaveLength(0);
  } finally { request.mockRestore(); }
});
