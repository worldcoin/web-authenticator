import { expect, test } from 'bun:test';
import { parseLegacyProfile } from '../src/wallet/legacy-profile';
import { derivePasskeySecrets } from '../src/wallet/legacy-passkey-secrets';
import { createHmac } from 'node:crypto';

test('legacy passkey preserves credential bytes and registration status', () => {
  const result = parseLegacyProfile(JSON.stringify({version: 1, passkey: {credentialId: 'AQID_w', prfSupported: true}, registration: 'submitting'}));
  expect(result).toEqual({credentialId: '010203ff', originalCredentialId: 'AQID_w', registration: 'submitting'});
  expect(() => parseLegacyProfile('{"version":1}')).toThrow();
});

test('legacy identity and vault key retain the original HKDF-expand derivation', async () => {
  const first = new Uint8Array(32).fill(7);
  const second = new Uint8Array(32).fill(8);
  const expected = (byte: number, info: string) => createHmac('sha256', Buffer.alloc(32, byte)).update(info).update(Buffer.from([1])).digest();
  const keys = await derivePasskeySecrets(first.buffer, second.buffer);
  expect(Buffer.from(keys.seed)).toEqual(expected(7, 'web.world.org/v1/authenticator-secret'));
  expect(Buffer.from(keys.databaseKey)).toEqual(expected(8, 'web.world.org/v1/storage-secret'));
  expect(first.every(b => b === 0) && second.every(b => b === 0)).toBe(true);
});
