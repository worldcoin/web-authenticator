# World ID Web Authenticator

Staging authenticator built on PR #9 with published `@worldcoin/walletkit-web@0.27.1`.
The relying-party demo belongs in its own website. This repository consumes its
requests; it does not host an RP demo, generate RP requests, or verify proofs for the RP.

## Run

```sh
bun install --frozen-lockfile
bun run build
bun run start
```

Open **http://localhost:4173**. Use localhost or HTTPS for passkeys.
`bun run dev` watches the browser build and Bun server. Use `PORT=4193 bun run dev`
when another checkout already occupies the default port.

## Request and proof flow

The external website sends its normal World ID connector link to this authenticator:

```text
http://localhost:4173/?i=<bridge-request-uuid>&k=<URL-encoded-base64-key>&b=https%3A%2F%2Fstaging-bridge.worldcoin.org
```

`b` is optional and defaults to `https://bridge.worldcoin.org`. Only those two
World ID bridge origins are accepted. `t=wld` and a validated `return_to` URL are
also supported. The encrypted request's callback takes precedence and conflicting
callbacks are rejected. Configure the external demo's authenticator base URL;
request creation and final verification remain on that website/server.

1. Fetch and decrypt the bridge request. Validate staging environment, timestamps,
   action binding, RP signer and OPRF key against the staging registry.
2. Show the RP ID, action and exact AND/OR credential requirements before opening
   a passkey. New wallets register on staging; existing wallets unlock their vault.
3. Check the requested issuer schemas and date bounds. Selfie-only requests can
   enter enrollment; Orb-only requests require an existing Orb credential. An
   either-credential request asks the user to choose, without selecting Selfie automatically.
4. On explicit approval, revalidate the request and use WalletKit to generate the
   proof from the original requirements. Selfie proofs include the existing
   schema-11 uniqueness-score disclosure.
5. Encrypt and upload the response to the bridge. Failed delivery retains the same
   proof in memory for retry. The UI reports delivery, not successful RP verification.

Only staging World ID 4 uniqueness requests are supported. User-presence and
identity-attribute requests fail closed. Orb enrollment/import, recovery, and
production requests are not implemented. Closing/reloading the page discards the
bridge response capability; reopen a fresh request from the RP. Bridge keys are
removed from browser history and never persisted by the app.

## Selfie issuance

The local flow uses the **existing real staging issuer with synthetic face input**.
It obtains a schema-11 subject/blinding factor through WalletKit, creates encrypted
synthetic AMPC shares in a native helper, submits/polls Face staging, verifies the
issuer signature and subject, and stores the issued credential in the encrypted vault.

```sh
bun run build:selfie-helper
```

The helper has pinned private Oxide/AMPC dependencies and needs their repository
access and native dependencies. See its [README](services/staging-issuance/face-enrollment-helper/README.md).
`STAGING_FACE_HELPER=/absolute/path/to/staging-face-crypto` can select an existing
build of this same helper for local development. Missing helpers return an actionable
503; there is no fake-success fallback. The web build does not build the native helper.

Issuance is allowed only with a loopback server binding, an allowed localhost
request origin, and matching `Origin` header. Remote deployments cannot enable
this synthetic enrollment route by changing browser input. Interrupted submissions
are saved and polled instead of automatically submitted again. The server retains
operations under `~/.local/state/web-authenticator/synthetic-selfie-issuance` with
private filesystem permissions; the browser retains an opaque resume capability.
Set `STAGING_SELFIE_STATE_DIR` to a separate persistent directory when running
multiple local checkouts. Run one issuer process per directory; the in-memory
concurrency guard is not a distributed lock.

The optional MediaPipe camera preview stays local and provides framing guidance.
It uses Face Landmarker through CPU/WASM, not ONNX.
It does **not** supply the issuer input or establish liveness. TEE capture, challenge
verification and production Selfie Check issuance remain separate integrations.

The **Dev mode** switch is off by default and resets on reload. It opens a side
panel (below the authenticator on narrow screens) with credential descriptions,
IDs, dates, vault refresh and confirmed local deletion, plus request and runtime
details. Unlock the wallet before inspecting credentials. Vault mutations are
disabled during active operations and pending proof delivery. The inspector never
shows secret keys, PRF output, blinding factors or proof payloads. Deleting a local
credential does not delete the passkey, account registration or issuer record.

## Storage

PR #9's public profile (`world-id-wallet-v1`), PRF input, HKDF labels and OPFS path
are unchanged. Reloading at the **same origin** reopens that passkey's encrypted
WalletKit vault. PRF output and seed/database-key buffers are erased after opening.
No plaintext key fallback is available. Close other wallet tabs before unlocking.

Registration status and the opaque issuance resume capability are additional
browser metadata. A submission of unknown outcome is never automatically
registered again; unlocking checks whether that account became available.

Ports/hostnames are separate browser origins. The earlier development checkout
also used a different key derivation/storage format; this branch does not import
its vault. A synced passkey alone does not back up OPFS. Clearing site data loses
local vault/profile data; cross-device backup, passkey rotation and recovery are
not implemented.

## Validation

```sh
bun run lint
bun run typecheck
bun run build
bun test
bun x playwright install chromium webkit
bun run test:browser
cargo fmt --manifest-path services/staging-issuance/face-enrollment-helper/Cargo.toml -- --check
```

Browser tests run a separate server on port 4194. Unit and browser tests use fixture
RP signatures, mocked upstream registry/bridge responses and mocked account/issuer
boundaries; they do not submit staging registrations or enrollments. Chromium also
exercises a virtual PRF passkey and the real WalletKit worker/vault against a failed
upstream registration. This is not physical-passkey or live end-to-end issuance evidence.

No automatic deployment is configured. PR #9's `vercel.json` keeps Vercel Git
publishing disabled. Server bindings/origins and the explicit CSP allowlist live in
[`config/authenticator-app-v0.ts`](config/authenticator-app-v0.ts).

## Provenance

PR #9 migrated the browser UX from `worldcoin/web-authenticator-experiments`
commit `b4139268da213a680e89bf5877c29fcafb145f25`. This branch replaces its embedded
RP scenario, simulated session gateway and simulated issuers with the existing
development checkout's WalletKit, bridge and staging issuance integrations.
The original asset/model provenance and passkey vault format are retained.
