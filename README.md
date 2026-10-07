# World ID Web Authenticator

Browser application migrated from the clean-start experiment. It uses the published
`@worldcoin/walletkit-web@0.27.1` package; no Rust checkout or WASM build is required.

## Run

```sh
nix shell nixpkgs#bun --command bun install --frozen-lockfile
nix shell nixpkgs#bun --command bun run build
nix shell nixpkgs#bun --command bun run start
```

Open **http://localhost:4173**. Use localhost (not an IP address) or HTTPS for
WebAuthn. `bun run dev` watches both the browser build and Bun server.

## What works

- Migrated request, consent, passkey, camera guidance, retake and completion screens.
- A PRF-capable passkey creates/unlocks an encrypted WalletKit OPFS credential store.
  HKDF derives distinct authenticator seed and database keys. Only the public
  credential ID is saved in localStorage; PRF output and derived key buffers are
  cleared after initialization. Reload and unlock uses the same passkey and store.
- WalletKit runs in its packaged worker. Vite emits its worker and WASM assets.
- Public MediaPipe model provides transient camera guidance. Camera pixels stay
  in the browser; the migrated simulator receives metadata only.

This is a **development preview**, not production enrollment. Biometric checks,
credential issuance and the partner return flow remain explicitly simulated.
Opening a local wallet does not register a World ID on chain. The simulator's
account is separate from the local vault; no simulated artifact is imported as a
real credential. The Zoom return screen sends no proof to Zoom.

The private native biometric lab, model downloader, internal models/configs,
Orb Tools patches, staging integrity exception, and Deep-Live-Cam tooling were
not migrated. Real TEE enrollment and the agreed TFH detection/QA/glasses browser
pipeline are follow-up integrations.

## Storage and recovery

Web Locks serialize passkey/profile setup across tabs so concurrent creation cannot
overwrite another attempt’s credential ID. One WalletKit worker owns OPFS per origin. Close other tabs before unlocking. A
cancelled/unsupported passkey or failed wallet initialization blocks progression;
there is no plaintext key fallback. Passkeys can remain in the user's provider
when an attempt fails. The local credential ID is saved before opening storage so
an interrupted unlock retries the same passkey instead of replacing the wallet.

The PRF derivation labels, metadata version and credential-based OPFS path are
persistent-format contracts. Changing them requires a migration. This local
profile supports one passkey; passkey rotation, cross-device vault recovery and
backup are not implemented. Clearing site data loses the vault and its local
profile; a synced passkey alone does not back up OPFS.

## Validation

```sh
bun run typecheck
bun run lint
bun run build
bun test
bunx playwright install chromium webkit
bun run test:browser
```

Build before running unit tests: HTTP regression tests exercise the built shell.
Browser tests cover responsive layout, accessibility, capture cleanup and actual
WalletKit loading with a Chromium virtual PRF passkey. That is not evidence of
physical-passkey/provider compatibility. For Nix Chromium, set
`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to its executable and provide a fontconfig
configuration with installed fonts. CI installs both Playwright browser targets.

`bun run build:static-demo` retains the standalone preview build. No deployment
project or automatic publishing target is configured. Automatic Vercel Git
deployments are disabled in the root `vercel.json`; the existing GitHub integration
does not need to build this app.

## Migration provenance

The migrated `clean-start/` source comes from
`worldcoin/web-authenticator-experiments` commit
`b4139268da213a680e89bf5877c29fcafb145f25` (Soam's UX/hosting branch, PR #5), moved
to this repository root. The existing contracts, simulator boundaries, tests and
asset provenance are preserved. Changes on top add WalletKit, protected storage,
explicit simulation labels and updated CI. Historical test evidence under
`tests/integration/reports` describes the source experiment, not this migration.
