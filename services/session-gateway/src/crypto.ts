import {
  base64UrlToBytes,
  bytesToBase64Url,
  canonicalizeJsonV0,
  type HexSha256,
} from "../../../packages/contracts/src";

export function randomOpaqueId(prefix: string, byteLength = 24): string {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  return `${prefix}_${bytesToBase64Url(bytes)}`;
}

export function randomNonce(): string {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

export async function sha256Text(value: string): Promise<HexSha256> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

interface HandlePayloadV0 {
  readonly v: 1;
  readonly sessionId: string;
  readonly rpId: string;
  readonly origin: string;
  readonly expiresAt: string;
}

function timingSafeEqual(left: Uint8Array, right: Uint8Array): boolean {
  let difference = left.byteLength ^ right.byteLength;
  const length = Math.max(left.byteLength, right.byteLength);
  for (let index = 0; index < length; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}

export class OpaqueBrowserHandleCodecV0 {
  constructor(private readonly key: CryptoKey) {}

  async seal(payload: Omit<HandlePayloadV0, "v">): Promise<string> {
    const encodedPayload = bytesToBase64Url(
      new TextEncoder().encode(canonicalizeJsonV0({ v: 1, ...payload })),
    );
    const signature = await crypto.subtle.sign(
      "HMAC",
      this.key,
      new TextEncoder().encode(encodedPayload),
    );
    return `${encodedPayload}.${bytesToBase64Url(new Uint8Array(signature))}`;
  }

  async open(handle: string): Promise<HandlePayloadV0 | null> {
    const parts = handle.split(".");
    if (parts.length !== 2) return null;
    try {
      const [encodedPayload, encodedSignature] = parts as [string, string];
      const expected = new Uint8Array(
        await crypto.subtle.sign("HMAC", this.key, new TextEncoder().encode(encodedPayload)),
      );
      const actual = base64UrlToBytes(encodedSignature);
      if (!timingSafeEqual(expected, actual)) return null;
      const parsed: unknown = JSON.parse(
        new TextDecoder().decode(base64UrlToBytes(encodedPayload)),
      );
      if (
        typeof parsed !== "object" ||
        parsed === null ||
        Array.isArray(parsed) ||
        Object.keys(parsed).sort().join(",") !== "expiresAt,origin,rpId,sessionId,v" ||
        (parsed as Record<string, unknown>).v !== 1 ||
        typeof (parsed as Record<string, unknown>).sessionId !== "string" ||
        typeof (parsed as Record<string, unknown>).rpId !== "string" ||
        typeof (parsed as Record<string, unknown>).origin !== "string" ||
        typeof (parsed as Record<string, unknown>).expiresAt !== "string"
      ) {
        return null;
      }
      return parsed as HandlePayloadV0;
    } catch {
      return null;
    }
  }
}

export async function signStagingArtifactV0<T extends { authentication: { keyId: string; signatureBase64Url: string } }>(
  artifact: T,
  signer: { readonly trustRoot: { readonly keyId: string }; sign(preimage: Uint8Array): Promise<string> },
  preimage: (value: Record<string, unknown>) => Uint8Array,
): Promise<T> {
  const unsigned = {
    ...artifact,
    authentication: {
      scheme: "staging-ed25519" as const,
      keyId: signer.trustRoot.keyId,
      signatureBase64Url: "pending",
    },
  };
  const signatureBase64Url = await signer.sign(preimage(unsigned as unknown as Record<string, unknown>));
  return {
    ...unsigned,
    authentication: { ...unsigned.authentication, signatureBase64Url },
  } as T;
}

export function bytesForBodyLimit(value: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}
