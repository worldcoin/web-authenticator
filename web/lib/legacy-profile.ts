import { WalletOpenError } from './wallet-errors';

export function parseLegacyProfile(raw: string) {
  const value = JSON.parse(raw);
  const id = value?.passkey?.credentialId;
  if (value?.version !== 1 || typeof id !== 'string' ||
      !/^[A-Za-z0-9_-]{1,2048}$/.test(id) || id.length % 4 === 1 ||
      value.passkey.prfSupported !== true ||
      !['created', 'submitting', 'finalized'].includes(value.registration)) {
    throw new WalletOpenError('The existing demo passkey record is invalid. It has not been replaced.');
  }
  const bytes = Uint8Array.from(atob(id.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
  return {
    credentialId: Array.from(bytes, b => b.toString(16).padStart(2, '0')).join(''),
    originalCredentialId: id,
    registration: value.registration as 'created' | 'submitting' | 'finalized',
  };
}
