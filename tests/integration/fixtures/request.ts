import type { Page } from "@playwright/test";
import { encodeFunctionResult, keccak256, parseAbi, stringToHex, hexToBytes, zeroAddress, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { WORLD_CHAIN_RPC_URL } from "../../../config/environment";
import type { Payload } from "../../../web/lib/proof-request";

// Public, deterministic test-only signing key. Never used against an actual registry.
const signer = privateKeyToAccount(`0x${"1".padStart(64, "0")}`);
export async function signedRequest(schema = 11, { age = 0, ttl = 600 } = {}) {
  const now = Math.floor(Date.now() / 1000) - age;
  const actionLabel = "test-action";
  const action = `0x${(BigInt(keccak256(stringToHex(actionLabel))) >> 8n).toString(16).padStart(64, "0")}` as Hex;
  const nonce = `0x${"12".repeat(32)}` as Hex;
  const bytes = new Uint8Array(81);
  bytes[0] = 1; bytes.set(hexToBytes(nonce), 1);
  new DataView(bytes.buffer).setBigUint64(33, BigInt(now));
  new DataView(bytes.buffer).setBigUint64(41, BigInt(now + ttl));
  bytes.set(hexToBytes(action), 49);
  const payload: Payload = {
    app_id: `app_${"0".repeat(32)}`, action: actionLabel, environment: "staging",
    proof_request: { id: "test-request", version: 1, proof_type: "uniqueness", rp_id: "rp_1", oprf_key_id: "0x1", nonce,
      created_at: now, expires_at: now + ttl, action, session_id: null, signature: await signer.signMessage({ message: { raw: bytes } }),
      proof_requests: [{ identifier: "credential", issuer_schema_id: schema }], constraints: "credential" },
  };
  return { payload, registry: { signer: signer.address, oprfKeyId: "0x1", active: true } };
}
export type RegistryEntry = Awaited<ReturnType<typeof signedRequest>>["registry"];

const rpRegistryAbi = parseAbi([
  "function getRp(uint64 rpId) view returns ((bool initialized, bool active, address manager, address signer, uint160 oprfKeyId, string unverifiedWellKnownDomain))",
]);
/** What World Chain answers to the `getRp` call in `rpcRequest`, and the registry contract it was sent to. */
export function rpRegistryReply(rpcRequest: string, entry: RegistryEntry) {
  const { id, method, params } = JSON.parse(rpcRequest) as { id: number; method: string; params: [{ to: Hex }] };
  if (method !== "eth_call") throw new Error(`Unexpected RPC method ${method}`);
  const result = encodeFunctionResult({ abi: rpRegistryAbi, functionName: "getRp", result: {
    initialized: true, active: entry.active, manager: zeroAddress, signer: entry.signer,
    oprfKeyId: BigInt(entry.oprfKeyId), unverifiedWellKnownDomain: "",
  } });
  return { registry: params[0].to, body: { jsonrpc: "2.0", id, result } };
}
/** Answers the page's RP registry reads; resolves to the registry contracts it queried. */
export async function routeRpRegistry(page: Page, entry: RegistryEntry) {
  const queried: Hex[] = [];
  const headers = { "access-control-allow-origin": "*", "access-control-allow-headers": "*" };
  await page.route(WORLD_CHAIN_RPC_URL, async route => {
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers });
    const reply = rpRegistryReply(route.request().postData() ?? "", entry);
    queried.push(reply.registry);
    await route.fulfill({ json: reply.body, headers });
  });
  return queried;
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

/** A verified, encrypted app request, with all bridge traffic confined to fixtures. */
export async function openSelfieRequest(page: Page, query = "", origin = "") {
  const { payload, registry } = await signedRequest(11);
  const encrypted = await encryptedRequest(payload);
  await page.route("https://staging-bridge.worldcoin.org/request/*", route => route.fulfill({ json: encrypted.body, headers: { "access-control-allow-origin": "*" } }));
  await page.route("https://staging-bridge.worldcoin.org/response/*", route => route.fulfill({ json: {}, headers: { "access-control-allow-origin": "*" } }));
  await routeRpRegistry(page, registry);
  await page.goto(origin + "/verify" + encrypted.query + (query ? "&" + query.replace(/^\?/, "") : ""));
  await page.getByRole("button", { name: "Continue" }).click();
}

/** Isolates capture/UI checks from passkey providers and live account services. */
export async function installRequestWallet(page: Page) {
  await installFixturePasskey(page);
  await installFixtureWalletWorker(page);
}

/** A passkey provider that always succeeds with a fixed PRF output. */
export async function installFixturePasskey(page: Page) {
  await page.addInitScript(() => {
    class FixtureCredential {
      static async getClientCapabilities() { return {}; }
      type = "public-key";
      rawId = Uint8Array.of(0xab).buffer;
      getClientExtensionResults() { return { prf: { enabled: true, results: { first: new Uint8Array(32).fill(7).buffer } } }; }
    }
    Object.defineProperty(window, "PublicKeyCredential", { configurable: true, value: FixtureCredential });
    Object.defineProperty(navigator, "credentials", { configurable: true, value: {
      create: async () => new FixtureCredential(), get: async () => new FixtureCredential(),
    } });
  });
}

async function installFixtureWalletWorker(page: Page) {
  await page.addInitScript(() => {
    class WalletWorker {
      onmessage?: (event: { data: unknown }) => void;
      private nextHandle = 0;
      postMessage(data: { id: number; op: string; target?: { class?: string; static?: string; method?: string; function?: string } }) {
        const target = data.target;
        let result: unknown;
        let error: { name: string; message: string } | undefined;
        if (data.op === "call") {
          if (target?.class && ["StorageKeys", "StoragePaths", "CredentialStore", "EmbeddedZkArtifacts", "Authenticator"].includes(target.class)) result = { $ref: ++this.nextHandle };
          else if (target?.function === "recoveryDataFromSeed") result = {};
          else if (target?.method === "listCredentials") result = [];
          else if (target?.method !== "initStorage") error = { name: "Error", message: "Unexpected fixture wallet operation" };
        }
        queueMicrotask(() => this.onmessage?.({ data: error ? { id: data.id, ok: false, error } : { id: data.id, ok: true, result } }));
      }
      terminate() { this.onmessage = undefined; }
    }
    const NativeWorker = window.Worker;
    window.Worker = new Proxy(NativeWorker, {
      construct(target, args) {
        return String(args[0]).includes("walletkit.worker") ? new WalletWorker() : Reflect.construct(target, args);
      },
    });
  });
}
