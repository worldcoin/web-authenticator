# Authenticator server configuration

This directory currently belongs only to `apps/authenticator`. Its server entry
point reads the listener settings; its HTTP handler applies the security headers
to every response. It contains no wallet secrets, biometric data or demo fixtures.
Vite, ESLint and TypeScript configuration live at the repository root. Playwright
configuration lives in `tests/e2e/`.

`AUTHENTICATOR_HOST` defaults to `127.0.0.1`; `PORT`/`AUTHENTICATOR_PORT` defaults
to 4173. Invalid ports fail startup.

Security headers apply to all responses. The browser CSP permits only this origin,
the two official World ID bridges and WalletKit's US staging gateway/indexer/OPRF
endpoints. Staging addresses and the WalletKit version are pinned together; review
that allowlist when upgrading the SDK. These are real staging trust configuration,
not production configuration.

There is no synthetic enrollment route or configuration switch in the product app.
The former `AUTHENTICATOR_PUBLIC_ORIGIN`, `AUTHENTICATOR_LOCAL_ORIGIN`,
`STAGING_FACE_HELPER` and `STAGING_SELFIE_STATE_DIR` settings are not used by it.
