import { WalletOpenError } from './wallet-errors';

const FACE_IDENTITY_SALT = new TextEncoder().encode('world-id/web-authenticator/keys/v1');
export const FACE_IDENTITY_INFO = 'face-identity/v1';

export async function deriveFaceIdentitySeed(prf: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  if (prf.byteLength !== 32) throw new WalletOpenError('The passkey returned invalid PRF output.');
  const key = await crypto.subtle.importKey('raw', prf, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({
    name: 'HKDF', hash: 'SHA-256', salt: FACE_IDENTITY_SALT,
    info: new TextEncoder().encode(FACE_IDENTITY_INFO),
  }, key, 256));
}
