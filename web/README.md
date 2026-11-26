# Authenticator web app

Static client-side React SPA for passkey World ID access and relying party (`/verify`) proof requests. See the [root README](../README.md) for local setup, testing, and deployment.

## Routes

`web/App.tsx` mounts a TanStack Router with three routes. The static host answers any non-file path with `index.html` (`not_found_handling: "single-page-application"` in `wrangler.jsonc`; Vite does the same locally).

| Path | Behaviour |
| ---- | --------- |
| `/` | Standalone authenticator. Ignores request query parameters. |
| `/authenticator` | Standalone authenticator. |
| `/verify` | Relying party request links (`?i=…&k=…`). Without a valid request, shows the invalid-request screen. |

`/` and `/authenticator` share one layout so signing in or creating a World ID replaces the URL with `/authenticator` without unmounting the unlocked wallet. Reloading or leaving locks the wallet and requires signing in again.

The standalone authenticator lets a user create a World ID with a passkey (disabled when a wallet is already saved in this browser) or sign in to an existing one, and lists stored credentials. Linking an authenticator is unavailable. A signed-in user without an active Selfie Check credential can open a local camera preview that issues no credential.

The router keeps the query string opaque (`parseSearch`/`stringifySearch`) so TanStack Router does not re-encode `k` before `/verify` reads the raw URL. Request flow stages stay in memory rather than in the URL.

On a first visit, a cookie consent screen covers the active route until the user chooses; `/verify` continues loading and validating underneath it. World links and cookie settings are in the floating menu.

## Request links (`/verify`)

```text
/verify?i=<bridge-request-uuid>&k=<url-encoded-base64-key>[&b=<bridge-origin>][&t=wld][&return_to=<url>]
```

| Parameter | Required | Rules |
| --------- | -------- | ----- |
| `i` | Yes | Bridge request UUID. |
| `k` | Yes | Standard base64-encoded 32-byte AES-GCM key. |
| `b` | No | Bridge origin: `https://bridge.worldcoin.org` (default) or `https://staging-bridge.worldcoin.org`. Other origins are rejected. |
| `t` | No | Must be `wld` if present. |
| `return_to` | No | HTTPS or HTTP localhost URL (max 2048 chars). Alone it does not enable a return link; if the encrypted request also sets `return_to_url`, both must match. |

Duplicate `i`, `k`, `b`, `t`, or `return_to` parameters are rejected.

### Loading and validation

1. When `k` is present, `/verify` replaces the URL with `/verify` via router history to drop the bridge key from browser history. Reloading or restoring from back-forward cache drops the in-memory request; start a fresh request at the relying party.
2. The browser fetches `GET <bridge>/request/<i>` (15 s timeout, no credentials, no referrer, no redirects, 256 KiB response limit) and decrypts the AES-GCM payload (12-byte IV, up to 192 KiB ciphertext). HTTP 404 is treated as an expired request.
3. The payload (up to 128 KiB JSON) must be a World ID 4.0 uniqueness request (`version: 1`, `proof_type: "uniqueness"`, `session_id: null`) matching the build environment:
   - Staging build (`VITE_APP_ENV=staging`, default in dev): accepts `staging` and `sandbox` requests.
   - Production build (`VITE_APP_ENV=production`): accepts `production` requests only.
4. The browser checks `app_id`, `rp_id`, `oprf_key_id`, action hash (`keccak256(action) >> 8`), credential requirements (1–32 items), constraint tree (max 64 nodes, depth 8), and timestamps (`created_at <= current time + 30 s`, `expires_at > current time`, lifetime `<= 86400 s`).
5. The browser verifies the RP's signature and `oprf_key_id` against the environment's on-chain `RpRegistry` contract on World Chain (chain 480) by calling `getRp`. Unregistered or inactive RPs are rejected.
6. Only Selfie Check requests are supported: every entry in `proof_requests` must have `issuer_schema_id: 11`. Mixed requests (including OR branches with another schema), `require_user_presence: true`, and non-empty `identity_attributes` are rejected as unsupported.
7. Return navigation uses `return_to_url` from the encrypted payload only (HTTPS or HTTP localhost).

## Request flow by origin

Tapping **Continue** on the request screen unlocks an existing passkey wallet or creates and registers one in the browser. What happens next depends on `configuredPoseGuardSignup()` in `web/lib/poseguard/enrollment.ts`.

| Origin and build | Issuer configured | Behaviour after Continue |
| ---------------- | ----------------- | ------------------------ |
| `https://authenticator.toolsforhumanity.dev` (staging build) | Yes | Answers the request end to end: proves from an existing credential or enrolls a Selfie Check, then sends the proof to the bridge. |
| `http://localhost:4173` / loopback (staging build) | No (staging signup-service CORS allows only the staging origin) | Unlocks or registers the wallet, captures one selfie locally in the browser, and stops on "Selfie captured". Issues no credential, creates no proof, and sends nothing to the bridge. |
| `https://web.world.org` (production build) | No (`selfieEnrollment` is `null`; production has no reviewed TEE release policy) | Unlocks or registers the wallet, captures one selfie locally in the browser, and stops on "Selfie captured". Issues no credential, creates no proof, and sends nothing to the bridge. |

On origins without an issuer configuration, the requesting app receives no response and keeps waiting until the request expires.

### Staging origin flow

1. Wait for wallet readiness, inspect stored credentials, and check request expiry.
2. **Satisfying credential already in wallet:** skip the camera, revalidate RP signature and expiry, generate the proof in WalletKit (including the schema-11 score claim), and `PUT` the encrypted `proof_response` to `<bridge>/response/<i>`.
3. **No active Selfie Check credential, and Selfie Check satisfies the request:**
   - Prepare a schema-11 subject in WalletKit (retrying while the indexer syncs a fresh account, up to ~47 s).
   - Run PoseGuard attested TEE capture (`wss://selfie-enrollment-stage.worldcoin.dev/v1/embeddings`, verified against pinned Nitro PCR0/PCR1/PCR2 measurements in `config/environment.ts`).
   - Submit the attested capture to staging signup-service (`PUT https://app.stage.face.worldcoin.org/api/v2/identity` with `X-Nitro-Attestation`) and poll `GET /api/v2/identity?sub=<sub>` (1 s interval, 120 s timeout).
   - Store the issued schema-11 credential in the browser vault, revalidate RP signature and expiry, prove, and deliver through the bridge.
4. **Active Selfie Check credential outside the request's date bounds:** fails with an error; the flow does not re-enroll over an active Selfie Check credential.

### End states and cancellation

- **Success (staging origin):** shows "You’re all set" with a link to `/authenticator` and, when `return_to_url` is set, "Return to the app".
- **Nullifier replay:** when WalletKit reports `NullifierReplay`, stops without sending to the bridge and shows "Proof already created".
- **Enrollment outcomes:** polling timeout shows "Enrollment pending" with "Check status" to resume polling; `duplicate` shows "Face already enrolled" and `failed` shows "Enrollment failed", each with "Cancel check".
- **Errors:** wallet setup, capture, proving, or delivery failures show an error with "Try again".
- **Cancel:** cancelling sends an encrypted `{ error_code: "verification_rejected" }` response to the bridge (15 s timeout) and reports a notice if notification fails.

## Passkey wallet

- Requires a secure context, a visible top-level browser tab, the Web Locks API (`navigator.locks`), and a WebAuthn PRF-capable passkey provider.
- `navigator.locks` (`world-id-wallet-setup-v1`) prevents concurrent wallet setup across tabs.
- The 32-byte WebAuthn PRF output derives the authenticator seed and credential-store key via HKDF-SHA-256. `localStorage` stores only public metadata (credential ID, optional shared RP ID, and per-environment registration state).
- When the browser supports WebAuthn Related Origin Requests, passkeys created on `authenticator.toolsforhumanity.dev`, `web.sandbox.world.org`, and `web.world.org` use the shared World ID IdP RP ID (`auth.worldcoin.dev`, `sandbox.auth.world.org`, `auth.world.org`).
- Each build checks `window.location.origin` against `config/environment.ts`: staging allows `https://authenticator.toolsforhumanity.dev` and HTTP loopback; production allows only `https://web.world.org`.

## Runtime hosting notes

- **WalletKit WASM:** `walletkit.wasm` exceeds Cloudflare's 25 MiB static asset limit, so `web/build/static-hosting.ts` emits `assets/walletkit-<hash>.wasm.gzip.bin` and embeds its expected byte length and SHA-256 digest in the build. `web/lib/walletkit-wasm.ts` fetches it, decompresses with `DecompressionStream("gzip")`, verifies byte length and SHA-256, and passes a `blob:` URL (`application/wasm`) to the WalletKit worker (permitted by `connect-src ... blob:` and `script-src 'self' 'wasm-unsafe-eval'` in `config/security-headers.ts`).
- **On-chain RP lookup:** `web/lib/rp-registry.ts` calls `getRp` on World Chain `RpRegistry` directly from the browser via `https://worldchain-mainnet.g.alchemy.com/public` (5 s timeout per attempt, up to 3 attempts with jittered exponential backoff, 20 s overall deadline).
