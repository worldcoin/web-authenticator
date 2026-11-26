<a href="https://docs.world.org/idkit">
  <img src="https://raw.githubusercontent.com/worldcoin/world-id-docs/main/public/images/shared-readme/readme-header.png" alt="" />
</a>

# World ID Web Authenticator

A standalone web authenticator for accessing a World ID wallet with a passkey and handling requests from apps.

Requires Git, [Bun](https://bun.sh) 1.4.2 and a browser with WebAuthn PRF support.

## 🚀 Quick start

```bash
git clone https://github.com/worldcoin/web-authenticator.git
cd web-authenticator
bun install --frozen-lockfile
bun run dev
```

Open [localhost:4173](http://localhost:4173). Local development uses staging by default.

By default, IDKit requests route to `<base_url>/verify`. To test the full IDKit request flow, please set the `override_connector_base_url` field in your IDKit request builder to http://localhost:4173/verify to test locally

## Repository Structure

```text
web/         React UI, browser logic, public assets and Vite build plugins (web/build/)
config/      Per-environment services and security headers
packages/    Shared contracts and browser admission policy
scripts/     Production deployment smoke check
tests/       Browser tests, deployment tests and integration fixtures
```

## 🧑‍💻 Developing locally

### Testing

```bash
bun run test
bun x playwright install chromium webkit # First run only
bun run test:browser
```

Static checks:

```bash
bun run lint
bun run typecheck
```

### Building and running

```bash
bun run build
bun run preview
```

`bun run build` writes the static bundle to `web/dist`. `bun run preview` serves `web/dist` at `http://localhost:4173` with the production security headers.

## 🚢 Deployment

The app deploys to Cloudflare Workers static assets (`web-authenticator-dev` and `web-authenticator-prod`) with no Worker script. Deep links such as `/verify` and `/authenticator` resolve to `index.html` via `not_found_handling: "single-page-application"` in `wrangler.jsonc`.

`VITE_APP_ENV` (`staging` or `production`) is read at build time and selects the environment's service endpoints and CSP `connect-src`. The browser origin must match the selected environment.

`bun run build` writes the complete deployable to `web/dist`, including:

- `_headers` — CSP, COOP, CORP, `Permissions-Policy`, `Referrer-Policy` and `X-Content-Type-Options: nosniff` from `config/security-headers.ts`. No `Cache-Control` header is set, so Cloudflare's default ETag revalidation applies.
- `release.json` — the target environment and `RELEASE_COMMIT`, checked after production deploys by `scripts/smoke-cloudflare.ts`.
- `assets/walletkit-<hash>.wasm.gzip.bin` — `walletkit.wasm` gzipped to stay under Cloudflare's 25 MiB per-file limit (the build fails if any asset exceeds 25 MiB).

Workflows:

- **Staging:** When configured, the [staging workflow](.github/workflows/cloudflare-staging.yml) tests and deploys `main` to [authenticator.toolsforhumanity.dev](https://authenticator.toolsforhumanity.dev).
- **Production:** The [production workflow](.github/workflows/cloudflare-release.yml) promotes a staging-reviewed `main` commit to [web.world.org](https://web.world.org) after CI and environment approval.

## 🔗 Related projects

- [WalletKit](https://github.com/worldcoin/walletkit)
- [Biometrics TEE](https://github.com/worldcoin/biometrics-tee)

## 📄 Documentation

- [Web app and request format](web/README.md)
