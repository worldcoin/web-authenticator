# World ID Web Authenticator

## Overview

A browser authenticator for World ID. Users unlock their credential vault with a
passkey, review requests from apps, and approve proofs sent through the World ID
bridge. It currently supports staging uniqueness proofs with existing Orb and
Selfie credentials. Selfie enrollment, user presence and recovery are not yet implemented.

Built with React, TypeScript and Vite, served by Bun. WalletKit handles account
registration, encrypted storage and proof generation; viem reads the RP registry.
ONNX Runtime Web runs RGBNet for local camera positioning. Dependencies are pinned in each app’s `package.json`.

The browser app lives in [apps/web](apps/web), and the Bun server lives in
[apps/api](apps/api). They have separate dependencies and builds, and ship together
from one origin.
[CI](.github/workflows/ci.yml) runs checks and builds; automatic Vercel deployments
are disabled in [vercel.json](vercel.json). Standalone demos live in `experiments/`
and are excluded from the app build.

## Quick Start

Install Bun 1.4.2, then run:

```sh
bun install --frozen-lockfile
bun run dev
```

Open **http://localhost:4173**. The command watches the browser build and Bun
server. Use a browser and passkey provider with WebAuthn PRF support.

The server binds to `127.0.0.1`. Override it with `AUTHENTICATOR_HOST`, or change
the port with `PORT=3100 bun run dev` (`AUTHENTICATOR_PORT` is also supported).
See [server settings](apps/api/src/config.ts) for security headers and
[the server entry point](apps/api/src/main.ts) for request limits.

To run a built version, use `bun run build` followed by `bun run start`.
Hosting outside localhost requires HTTPS for passkeys and camera access.

### Routes

- `GET /` opens the authenticator; `HEAD /` checks its response headers.
- `GET` and `HEAD` on asset paths serve the browser build.
- `GET /api/staging-rp?id=rp_<hex>` returns an active RP's `signer` and `oprfKeyId`.

```sh
curl -I http://localhost:4173/
curl -i 'http://localhost:4173/api/staging-rp?id=invalid' # Expected: 400
```

Registration, vault access and proof generation run in the browser through
WalletKit. The [HTTP handlers](apps/api/src/http.ts)
define the server routes.

### Trying a request

Set the requesting app's authenticator URL to `http://localhost:4173`, then open
its generated connector link:

```text
http://localhost:4173/?i=<request-uuid>&k=<url-encoded-base64-key>&b=https%3A%2F%2Fstaging-bridge.worldcoin.org
```

Unlock the wallet, review the request and approve the proof. The requesting app
verifies the response. Opening `/` without a request shows wallet management;
**Dev mode** adds credential inspection, refresh and local deletion. Reuse the same
browser origin to reopen its stored wallet.

For camera positioning, install the model before building with
`bun scripts/setup-rgbnet.ts /path/to/RGBNet.onnx`.
See [RGBNet setup](docs/rgbnet-browser.md).

## Testing

```sh
bun run lint
bun run typecheck
bun run test

bun x playwright install chromium webkit # First run
bun run test:browser
```

`test` runs product unit and integration tests. `test:browser` builds the app and
starts a separate server on port **4194**, testing request handling, passkeys,
camera workers and accessibility in Chromium and WebKit. Browser tests use
controlled upstream responses. Configure them in
[tests/e2e/playwright.config.ts](tests/e2e/playwright.config.ts).
