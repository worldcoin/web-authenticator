import { parse, stringify } from 'lossless-json';
import { abortable } from './async';
import { selfieIssuanceToken } from './wallet-persistence';
import type { WalletKit } from './walletkit';

async function responseText(response: Response): Promise<string> {
  if (!response.body) throw new Error('The staging issuer returned an empty response.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return text + decoder.decode();
      size += value.byteLength;
      if (size > 1_000_000) { await reader.cancel(); throw new Error('The staging issuer response exceeded its size limit.'); }
      text += decoder.decode(value, { stream: true });
    }
  } finally { reader.releaseLock(); }
}

function validateCredential(text: string, schema: 11 | 128, sub: string): void {
  const credential = parse(text) as { sub?: unknown; issuer_schema_id?: unknown; expires_at?: unknown } | null;
  if (!credential || typeof credential !== 'object' || String(credential.sub).toLowerCase() !== sub
    || String(credential.issuer_schema_id) !== String(schema)
    || !/^\d+$/.test(String(credential.expires_at))
    || BigInt(String(credential.expires_at)) <= BigInt(Math.floor(Date.now() / 1000))) {
    throw new Error('The issued credential has the wrong subject/schema or is expired.');
  }
}

/** Explicit developer action only. Both endpoints issue synthetic staging credentials, not camera proofs. */
export async function issueStagingCredential(wallet: WalletKit, schema: 11 | 128, signal: AbortSignal, progress: (message: string) => void): Promise<void> {
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(schema === 11 ? 300_000 : 60_000)]);
  const terminate = () => wallet.terminate();
  deadline.addEventListener('abort', terminate, { once: true });
  try {
    deadline.throwIfAborted();
    const records = await abortable(wallet.listCredentials(), deadline);
    if (records.some(record => record.issuerSchemaId === BigInt(schema) && !record.isExpired)) {
      progress('An active credential is already stored.');
      return;
    }
    progress('Preparing the credential subject with WalletKit…');
    const { sub, blindingFactor } = await abortable(wallet.prepareCredential(BigInt(schema)), deadline);
    if (!/^0x[0-9a-f]{64}$/.test(sub)) throw new Error('WalletKit returned an invalid credential subject.');
    const token = schema === 11 ? selfieIssuanceToken(sub) : undefined;
    for (;;) {
      deadline.throwIfAborted();
      progress(schema === 11 ? 'Requesting synthetic staging Selfie issuance…' : 'Requesting a staging Faux credential…');
      const response = await fetch(schema === 11 ? '/api/selfie-credential' : '/api/faux-credential', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sub, ...(token ? { token } : {}) }),
        signal: AbortSignal.any([deadline, AbortSignal.timeout(schema === 11 ? 175_000 : 25_000)]),
      });
      const text = await responseText(response);
      if (!response.ok) {
        if (response.status === 404) throw new Error('Staging issuers are disabled. Run the localhost API with ENABLE_STAGING_ISSUERS=1.');
        const failure = JSON.parse(text) as { error?: unknown };
        throw new Error(typeof failure.error === 'string' ? failure.error : `Staging issuer failed (HTTP ${response.status}).`);
      }
      let serialized: string;
      if (schema === 11) {
        const result = JSON.parse(text) as { status?: unknown; stage?: unknown; credential?: unknown };
        if (result.status === 'pending') {
          progress(typeof result.stage === 'string' ? result.stage : 'Waiting for staging issuance…');
          await new Promise<void>((resolve, reject) => {
            const abort = () => { clearTimeout(timer); reject(deadline.reason); };
            const timer = setTimeout(() => { deadline.removeEventListener('abort', abort); resolve(); }, 3000);
            deadline.addEventListener('abort', abort, { once: true });
            if (deadline.aborted) abort();
          });
          continue;
        }
        if (result.status !== 'issued' || typeof result.credential !== 'string'
          || !/^[A-Za-z0-9+/]+={0,2}$/.test(result.credential) || result.credential.length > 90_000) {
          throw new Error('Staging Selfie issuance returned an invalid credential.');
        }
        serialized = new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(atob(result.credential), c => c.charCodeAt(0)));
      } else {
        // Preserve signed integers larger than Number.MAX_SAFE_INTEGER.
        const result = parse(text) as { credential?: unknown } | null;
        if (!result || typeof result.credential !== 'object' || result.credential === null || Array.isArray(result.credential)) {
          throw new Error('Staging Faux issuance did not return a credential object.');
        }
        const encoded = stringify(result.credential);
        if (!encoded) throw new Error('The Faux credential could not be decoded.');
        serialized = encoded;
      }
      validateCredential(serialized, schema, sub);
      progress('Storing the issued credential in the encrypted vault…');
      const stored = await abortable(wallet.storeCredential(new TextEncoder().encode(serialized), blindingFactor), deadline);
      if (stored.issuerSchemaId !== BigInt(schema)) throw new Error('Unexpected stored credential schema.');
      progress('Credential stored in the encrypted vault.');
      return;
    }
  } catch (cause) {
    wallet.terminate();
    if (signal.aborted) throw signal.reason;
    if (deadline.aborted) throw new Error('Staging issuance timed out. Unlock and retry; Selfie issuance resumes its saved operation.');
    throw cause;
  } finally { deadline.removeEventListener('abort', terminate); }
}
