# World ID Web Authenticator

Unlock your World ID wallet with a passkey and approve requests from apps.
Currently uses **staging** contracts for enrollment. 
## Dependencies

- [WalletKit](https://github.com/worldcoin/walletkit) — `@worldcoin/walletkit-web@0.27.1` for wallet storage, registration and proofs.
- [Biometrics TEE](https://github.com/worldcoin/biometrics-tee) — intended for face processing; not integrated yet.

## Local Development

Install [Bun](https://bun.sh) **1.4.2**, then:

```sh
bun install --frozen-lockfile
bun run dev
```

Open [localhost:4173](http://localhost:4173) in a browser with WebAuthn PRF support.

## Repository Structure

```text
web/         React UI, browser logic and public assets
api/         Bun HTTP server and API routes
packages/    Shared contracts and browser admission policy
tests/       Browser tests and integration fixtures
```

`web/` and `api/` own their dependencies. Bun serves both from one origin.

## Running Tests

```sh
bun run test
bun x playwright install chromium webkit # First run only
bun run test:browser
```

Static checks:

```sh
bun run lint
bun run typecheck
```

## Build and Run

```sh
bun run build
bun run start
```

[Container instructions](api/README.md#container) · [App request format](web/README.md#app-requests)
