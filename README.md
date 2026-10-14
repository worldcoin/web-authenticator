# World ID Web Authenticator

Staging-only product implementation built on PR #9 with published `@worldcoin/walletkit-web@0.27.1`.
Production enrollment is not yet available.
The relying-party demo belongs in its own website. This repository consumes its
requests; it does not host an RP demo, generate RP requests, or verify proofs for the RP.

## Repository layout

- `apps/authenticator/`: browser app, its HTML entry point and server.
- `config/`: authenticator runtime settings and HTTP security policy.
- `tooling/`: Vite, ESLint and environment-specific TypeScript configuration.
- `tests/e2e/playwright.config.ts`: browser test runner configuration.
- `tests/integration/`: integration fixtures and browser tests.
- `experiments/`: isolated demo implementations, excluded from the product build.

Package metadata, lockfile, ignore files and shared `tsconfig.json` stay at the root.
`vercel.json` also stays at the root to keep automatic Vercel deployments disabled.

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
3. Check the requested issuer schemas and date bounds. Selfie-only requests with
   missing credentials show that enrollment is unavailable; Orb-only requests
   require an existing Orb credential. An
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

## Selfie enrollment status

The default app does not issue Selfie credentials. Missing-credential requests show
an unavailable enrollment state; existing eligible staging credentials can still be
used for proofs. Camera positioning remains available as local guidance only.

Synthetic enrollment is isolated in [`experiments/tee-demo`](experiments/README.md).
It submits random face embeddings to the real staging signup service using its
integrity exception. The main app has no synthetic submission route, native helper,
or integrity placeholders. Root build/start commands do not include the experiment.

Previously saved vaults, enrollment-operation files and resume tokens are left in
place. This cleanup does not delete server enrollments or revoke credentials.

The optional camera preview runs Face Engine’s RGBNet detector locally through
ONNX Runtime Web (CPU/WASM, dedicated worker). It provides face-count, centering
and distance guidance. MediaPipe and its head-turn/lighting heuristics are removed.
Install the pinned model before using the preview:

```sh
bun scripts/setup-rgbnet.ts /path/to/RGBNet.onnx
```

The model is ignored by Git; install it before building a deployable preview.
See [RGBNet setup and processing](docs/rgbnet-browser.md).
It does **not** submit an enrollment or establish liveness. TEE capture, challenge
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

Registration status is additional browser metadata. Legacy synthetic-issuance
resume tokens may remain in storage but are no longer read by this app. A
submission of unknown outcome is never automatically
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
bun run test
bun x playwright install chromium webkit
bun run test:browser
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
commit `b4139268da213a680e89bf5877c29fcafb145f25`. The product app uses WalletKit
and the bridge; embedded RP scenarios, simulated sessions and synthetic enrollment are isolated in the experiment.
The original UI assets and passkey vault format are retained. Camera guidance now uses the pinned RGBNet model described above.

## Local integration branch

`integration/authenticator-demo` is the consolidated working branch. The default
app is `apps/authenticator`, with the responsive UI and published WalletKit 0.27.1.
Run `bun run build` then `PORT=3100 bun run start` for localhost:3100.

The earlier TEE experiment is preserved under `experiments/tee-demo`; its local
WalletKit #604 integration is not yet wired into the main UI. Existing legacy
demo passkeys retain their original derivation, vault namespace, and registration
status. Registration and initialization share one unlocked session.

Browser diagnostics use `authenticator_step` events with step names, timings, and
safe failure categories; they omit key material and raw dependency errors.
