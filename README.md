# World ID Web Authenticator

Unlock your World ID wallet with a passkey and approve requests from apps.
Currently uses staging and supports proofs with existing Orb and Selfie
credentials. Selfie enrollment, user presence and recovery are still to come.

The app uses published packages, including WalletKit `0.27.1`.

## Run locally

Install [Bun](https://bun.sh) **1.4.2**, then:

```sh
bun install --frozen-lockfile
bun run dev
```

Open **http://localhost:4173** in a browser with WebAuthn PRF support.

For camera guidance, [install the RGBNet model](web/README.md#camera-guidance).
Wallet and proof flows work without it.

## Where things live

- [`web`](web): React UI, passkeys, wallet, camera and proof requests.
- [`api`](api): Bun server, API routes and server configuration.
- [`tests`](tests): browser tests and shared integration fixtures.

Each app owns its dependencies. Bun serves the frontend and API from one origin.

## Check your changes

```sh
bun run lint
bun run typecheck
bun run test
bun x playwright install chromium webkit # First run only
bun run test:browser
```

To run the compiled app: `bun run build && bun run start`.
[Container instructions](api/README.md#container) · [App request format](web/README.md#app-requests)
