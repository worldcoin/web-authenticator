export interface EnrollmentSecrets {
  seed: Uint8Array<ArrayBuffer>;
  databaseKey: Uint8Array<ArrayBuffer>;
  custodyPrivateKey: Uint8Array<ArrayBuffer>;
  custodyPublicKey: Uint8Array<ArrayBuffer>;
}

const SECRET_BYTES = 128;
const HEADER_BYTES = 13;

export function clearEnrollmentSecrets(secrets: EnrollmentSecrets): void {
  for (const bytes of Object.values(secrets)) bytes.fill(0);
}

export async function createEnrollmentSecrets(): Promise<EnrollmentSecrets> {
  const pair = await crypto.subtle.generateKey({ name: "X25519" }, true, ["deriveBits"]) as CryptoKeyPair;
  const privateKey = await crypto.subtle.exportKey("jwk", pair.privateKey);
  if (privateKey.kty !== "OKP" || privateKey.crv !== "X25519" || typeof privateKey.d !== "string") {
    throw new Error("Could not generate the PCP custody key.");
  }
  const raw = atob(privateKey.d.replace(/-/g, "+").replace(/_/g, "/"));
  if (raw.length !== 32) throw new Error("Invalid PCP custody key.");
  return {
    seed: crypto.getRandomValues(new Uint8Array(32)),
    databaseKey: crypto.getRandomValues(new Uint8Array(32)),
    custodyPrivateKey: Uint8Array.from(raw, byte => byte.charCodeAt(0)),
    custodyPublicKey: new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey)),
  };
}

/** Protects the existing keys; choosing a passkey must never replace the enrolled identity. */
export async function sealEnrollmentSecrets(secrets: EnrollmentSecrets, key: CryptoKey, binding: string): Promise<Uint8Array<ArrayBuffer>> {
  const plaintext = new Uint8Array(SECRET_BYTES);
  const fields = [secrets.seed, secrets.databaseKey, secrets.custodyPrivateKey, secrets.custodyPublicKey];
  if (!binding || fields.some(bytes => bytes.byteLength !== 32)) throw new Error("Invalid enrollment secrets.");
  fields.forEach((bytes, index) => plaintext.set(bytes, index * 32));
  const header = new Uint8Array(HEADER_BYTES);
  header[0] = 1;
  crypto.getRandomValues(header.subarray(1));
  try {
    const encrypted = new Uint8Array(await crypto.subtle.encrypt({
      name: "AES-GCM", iv: header.subarray(1), additionalData: new TextEncoder().encode(binding),
    }, key, plaintext));
    const result = new Uint8Array(header.length + encrypted.length);
    result.set(header); result.set(encrypted, header.length);
    return result;
  } finally {
    plaintext.fill(0);
  }
}

export async function openEnrollmentSecrets(envelope: Uint8Array<ArrayBuffer>, key: CryptoKey, binding: string): Promise<EnrollmentSecrets> {
  if (!binding || envelope.length !== HEADER_BYTES + SECRET_BYTES + 16 || envelope[0] !== 1) {
    throw new Error("Invalid saved enrollment keys.");
  }
  const plaintext = new Uint8Array(await crypto.subtle.decrypt({
    name: "AES-GCM", iv: envelope.subarray(1, HEADER_BYTES), additionalData: new TextEncoder().encode(binding),
  }, key, envelope.subarray(HEADER_BYTES)));
  try {
    return {
      seed: plaintext.slice(0, 32), databaseKey: plaintext.slice(32, 64),
      custodyPrivateKey: plaintext.slice(64, 96), custodyPublicKey: plaintext.slice(96, 128),
    };
  } finally {
    plaintext.fill(0);
  }
}
