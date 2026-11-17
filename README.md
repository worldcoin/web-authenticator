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
web/         React UI, browser logic and public assets
api/         Bun HTTP server and API routes
packages/    Shared contracts and browser admission policy
tests/       Browser tests and integration fixtures
```

`web/` and `api/` own their dependencies. Bun serves both from one origin.

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
bun run start
```

## 🚢 Deployment

`VITE_APP_ENV` configures the browser build and `APP_ENV` configures the API/Worker.
Both accept `staging` or `production`; the browser origin must match the selected environment.

- **Staging:** When configured, the [staging workflow](.github/workflows/cloudflare-staging.yml) tests and deploys `main` to [authenticator.toolsforhumanity.dev](https://authenticator.toolsforhumanity.dev).
- **Production:** The [production workflow](.github/workflows/cloudflare-release.yml) promotes a staging-reviewed `main` commit to [web.world.org](https://web.world.org) after CI and environment approval.

## 🔗 Related projects

- [WalletKit](https://github.com/worldcoin/walletkit)
- [Biometrics TEE](https://github.com/worldcoin/biometrics-tee)

## 📄 Documentation

- [Web app and request format](web/README.md)
- [API and container](api/README.md)
