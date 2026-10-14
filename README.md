# World ID Web Authenticator

Unlock your World ID wallet with a passkey and approve requests from apps.
Currently uses staging and supports proofs with existing Orb and Selfie
credentials. Selfie enrollment, user presence and recovery are still to come.

## Run locally

Install [Bun](https://bun.sh) **1.4.2**, then:

```sh
bun install --frozen-lockfile
bun run dev
```

Open **http://localhost:4173** in a browser with WebAuthn PRF support.

For camera guidance, [install the RGBNet model](docs/rgbnet-browser.md).
Wallet and proof flows work without it.

## Where things live

- [`apps/web`](apps/web): React UI, passkeys, wallet, camera and proof requests.
- [`apps/api`](apps/api): Bun server, API routes and server configuration.
- [`tests`](tests): browser tests and shared integration fixtures.
- [`experiments`](experiments): older demos, excluded from the app build.

Each app owns its dependencies. Bun serves the frontend and API from one origin.
See [code boundaries](docs/code-boundaries.md) for the remaining packages and planned work.

## Check your changes

```sh
bun run lint
bun run typecheck
bun run test
bun x playwright install chromium webkit # First run only
bun run test:browser
```

To run the compiled app: `bun run build && bun run start`.
[Container instructions](apps/api/README.md#container) · [App request format](docs/connector-bridge.md)
