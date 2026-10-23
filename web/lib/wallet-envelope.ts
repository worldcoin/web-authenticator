export type TemporaryWalletMaterial = {
  seed: Uint8Array<ArrayBuffer>;
  databaseKey: Uint8Array<ArrayBuffer>;
  storageRoot: string;
  credentialId?: string;
  persisted: boolean;
};

export type WrappedWalletProfile = {
  version: 2;
  credentialId: string;
  storageRoot: string;
  iv: string;
  ciphertext: string;
};

const hex = (bytes: Uint8Array) => Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
const bytes = (value: string) => Uint8Array.from(value.match(/../g)!, pair => Number.parseInt(pair, 16));
const aad = (profile: Pick<WrappedWalletProfile, "credentialId" | "storageRoot">) =>
  new TextEncoder().encode(JSON.stringify(["world-id/temporary-wallet/v2", profile.credentialId, profile.storageRoot]));

export function parseWrappedProfile(value: Record<string, unknown>): WrappedWalletProfile {
  if (value.version !== 2 || typeof value.credentialId !== "string" || !/^(?:[0-9a-f]{2}){1,1024}$/.test(value.credentialId) ||
    typeof value.storageRoot !== "string" || !/^\/walletkit\/temporary-[0-9a-f-]{36}$/.test(value.storageRoot) ||
    typeof value.iv !== "string" || !/^[0-9a-f]{24}$/.test(value.iv) ||
    typeof value.ciphertext !== "string" || !/^[0-9a-f]{160}$/.test(value.ciphertext)) {
    throw new Error("Saved wallet envelope is invalid.");
  }
  return value as WrappedWalletProfile;
}

async function wrappingKey(prf: Uint8Array<ArrayBuffer>) {
  if (prf.length !== 32) throw new Error("Invalid passkey PRF output.");
  const key = await crypto.subtle.importKey("raw", prf, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256",
    salt: new TextEncoder().encode("world-id/web-authenticator/keys/v1"),
    info: new TextEncoder().encode("temporary-wallet-envelope/v2"),
  }, key, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

export async function wrapTemporaryWallet(material: TemporaryWalletMaterial, credentialId: string, prf: Uint8Array<ArrayBuffer>): Promise<WrappedWalletProfile> {
  if (material.seed.length !== 32 || material.databaseKey.length !== 32) throw new Error("Invalid temporary wallet keys.");
  const plaintext = new Uint8Array(64);
  plaintext.set(material.seed); plaintext.set(material.databaseKey, 32);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const binding = { credentialId, storageRoot: material.storageRoot };
  try {
    const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad(binding) }, await wrappingKey(prf), plaintext);
    return parseWrappedProfile({ version: 2, ...binding, iv: hex(iv), ciphertext: hex(new Uint8Array(ciphertext)) });
  } finally { plaintext.fill(0); }
}

export async function unwrapTemporaryWallet(profile: WrappedWalletProfile, prf: Uint8Array<ArrayBuffer>) {
  const plaintext = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes(profile.iv), additionalData: aad(profile) },
    await wrappingKey(prf), bytes(profile.ciphertext)));
  try {
    if (plaintext.length !== 64) throw new Error("Invalid saved wallet material.");
    return { seed: plaintext.slice(0, 32), databaseKey: plaintext.slice(32) };
  } finally { plaintext.fill(0); }
}
