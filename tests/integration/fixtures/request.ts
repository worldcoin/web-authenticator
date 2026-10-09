import { keccak256, stringToHex, hexToBytes, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { Payload } from "../../../apps/authenticator/src/lib/requests/proof-request";

// Public, deterministic test-only signing key. Never used against an actual registry.
const signer = privateKeyToAccount(`0x${"1".padStart(64, "0")}`);
export async function signedRequest(schema = 11) {
  const now = Math.floor(Date.now() / 1000);
  const actionLabel = "test-action";
  const action = `0x${(BigInt(keccak256(stringToHex(actionLabel))) >> 8n).toString(16).padStart(64, "0")}` as Hex;
  const nonce = `0x${"12".repeat(32)}` as Hex;
  const bytes = new Uint8Array(81);
  bytes[0] = 1; bytes.set(hexToBytes(nonce), 1);
  new DataView(bytes.buffer).setBigUint64(33, BigInt(now));
  new DataView(bytes.buffer).setBigUint64(41, BigInt(now + 600));
  bytes.set(hexToBytes(action), 49);
  const payload: Payload = {
    app_id: `app_${"0".repeat(32)}`, action: actionLabel, environment: "staging",
    proof_request: { id: "test-request", version: 1, proof_type: "uniqueness", rp_id: "rp_1", oprf_key_id: "0x1", nonce,
      created_at: now, expires_at: now + 600, action, session_id: null, signature: await signer.signMessage({ message: { raw: bytes } }),
      proof_requests: [{ identifier: "credential", issuer_schema_id: schema }], constraints: "credential" },
  };
  return { payload, registry: { signer: signer.address, oprfKeyId: "0x1" } };
}
export const bridgeId = "00000000-0000-4000-8000-000000000001";
export async function encryptedRequest(payload: Payload) {
  const raw = new Uint8Array(32).fill(3);
  const key = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
  const iv = new Uint8Array(12).fill(4);
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(JSON.stringify(payload)));
  return {
    key,
    query: `?i=${bridgeId}&k=${encodeURIComponent(Buffer.from(raw).toString("base64"))}&b=https%3A%2F%2Fstaging-bridge.worldcoin.org`,
    body: { iv: Buffer.from(iv).toString("base64"), payload: Buffer.from(encrypted).toString("base64") },
  };
}
