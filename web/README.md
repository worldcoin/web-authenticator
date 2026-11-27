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

The standalone authenticator lets a user create a World ID with a passkey (disabled when a wallet is already saved in this browser) or sign in to an existing one, and lists stored credentials. Linking an authenticator is unavailable. A signed-in user without an active Selfie Check credential can set one up where the environment has an issuer: the same PoseGuard capture and enrollment as `/verify` stores the credential in the wallet, and the credentials list then shows it as Active. Without an issuer the entry reads "Not available yet".

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

## Request flow

Tapping **Continue** on the request screen unlocks an existing passkey wallet or creates and registers one in the browser. `/verify` runs the same flow in every environment; there is no origin check and no local-capture fallback. An environment can issue Selfie Checks only when `selfieEnrollment` in `config/environment.ts` configures an issuer policy (`selfieIssuer()` in `web/lib/poseguard/enrollment.ts`).

### After the wallet is ready

1. Inspect stored credentials and check request expiry.
2. **Satisfying credential already in wallet:** skip the camera, revalidate the RP signature and expiry, generate the proof in WalletKit, and `PUT` the encrypted `proof_response` to `<bridge>/response/<i>`. Works in every environment.
3. **No satisfying credential, Selfie Check can satisfy the request, and the environment has an issuer:**
   - Prepare a schema-11 subject in WalletKit (retrying while the indexer syncs a fresh account, up to ~47 s).
   - Run PoseGuard capture in the attested enclave (`selfieEnrollment.endpoint`, verified against pinned Nitro PCR0/PCR1/PCR2 measurements in `config/environment.ts`).
   - Submit the attested capture to the environment's signup-service (`PUT <signupServiceOrigin>/api/v2/identity` with `X-Nitro-Attestation`) and poll `GET /api/v2/identity?sub=<sub>` (1 s interval, 120 s timeout).
   - Store the issued schema-11 credential in the wallet, revalidate the RP signature and expiry, prove, and deliver through the bridge.
4. **Otherwise:** end on "This check can’t be completed here" and send an encrypted `{ error_code: "verification_rejected" }` response to the bridge (15 s timeout) so the requesting app stops waiting. This covers an environment without an issuer (`selfieEnrollment: null`) and a wallet whose active Selfie Check credential falls outside the request's date bounds (the flow does not re-enroll over an active Selfie Check credential).

### Behaviour by environment

| Environment and origin | Issuer configured | Behaviour after Continue |
| ---------------------- | ----------------- | ------------------------ |
| Staging (`https://authenticator.toolsforhumanity.dev`) | Yes (`selfie-enrollment-stage.worldcoin.dev` / `app.stage.face.worldcoin.org`) | Both paths work: saved credentials prove, and wallets without one enroll a Selfie Check and prove. |
| Production (`https://web.world.org`) | No (`selfieEnrollment: null`) | Saved credentials prove; without one, the request is declined with "This check can’t be completed here". |
| Local development (`http://localhost` / loopback, staging build) | Yes (staging config) | Both paths work under `bun run dev`: the dev server proxies `/api/v2/identity` to staging signup-service as `https://authenticator.toolsforhumanity.dev`, whose CORS and WAF admit only that origin. `bun run preview` calls signup-service directly, so enrollment fails CORS there. |

### End states and cancellation

- **Success:** shows "You’re all set" with "Return to authenticator" (`/authenticator`) and, when the request carried `return_to_url`, "Return to the app".
- **Nullifier replay:** when WalletKit reports `NullifierReplay`, stops without sending to the bridge and shows "Proof already created".
- **Unavailable:** shows "This check can’t be completed here", sends `{ error_code: "verification_rejected" }` to the bridge (15 s timeout), and shows a notice if notification fails.
- **Expired:** shows "This request has expired".
- **Cancel:** shows "Check cancelled", sends an encrypted `{ error_code: "verification_rejected" }` response to the bridge (15 s timeout), and shows a notice if notification fails.
- **Errors:** wallet setup, capture, proving, or delivery failures show "Something went wrong" (or the capture error inside the camera screen) with "Try again".
- **Enrollment outcomes (inside the camera screen):** polling timeout shows "Enrollment pending" with "Check status" to resume polling; `duplicate` shows "Face already enrolled" and `failed` shows "Enrollment failed", each with "Cancel check".

## Passkey wallet

- Requires a secure context, a visible top-level browser tab, the Web Locks API (`navigator.locks`), and a WebAuthn PRF-capable passkey provider.
- `navigator.locks` (`world-id-wallet-setup-v1`) prevents concurrent wallet setup across tabs.
- The 32-byte WebAuthn PRF output derives the authenticator seed and credential-store key via HKDF-SHA-256. `localStorage` stores only public metadata (credential ID, optional shared RP ID, and per-environment registration state).
- When the browser supports WebAuthn Related Origin Requests, passkeys created on `authenticator.toolsforhumanity.dev`, `web.sandbox.world.org`, and `web.world.org` use the shared World ID IdP RP ID (`auth.worldcoin.dev`, `sandbox.auth.world.org`, `auth.world.org`).
- Each build checks `window.location.origin` against `config/environment.ts`: staging allows `https://authenticator.toolsforhumanity.dev` and HTTP loopback; production allows only `https://web.world.org`.

## Runtime hosting notes

- **WalletKit WASM:** `walletkit.wasm` exceeds Cloudflare's 25 MiB static asset limit, so `web/build/static-hosting.ts` emits `assets/walletkit-<hash>.wasm.gzip.bin` and embeds its expected byte length and SHA-256 digest in the build. `web/lib/walletkit-wasm.ts` fetches it, decompresses with `DecompressionStream("gzip")`, verifies byte length and SHA-256, and passes a `blob:` URL (`application/wasm`) to the WalletKit worker (permitted by `connect-src ... blob:` and `script-src 'self' 'wasm-unsafe-eval'` in `config/security-headers.ts`).
- **On-chain RP lookup:** `web/lib/rp-registry.ts` calls `getRp` on World Chain `RpRegistry` directly from the browser via `https://worldchain-mainnet.g.alchemy.com/public` (5 s timeout per attempt, up to 3 attempts with jittered exponential backoff, 20 s overall deadline).
