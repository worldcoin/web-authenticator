# Authenticator API

Bun serves the web build, `/api/consent`, `/api/analytics` and `/api/staging-rp` from the same origin. The RP lookup
reads the staging registry; passkeys, [WalletKit](https://github.com/worldcoin/walletkit) and proof generation run in the
browser. Promon sessions and Redis are not implemented yet.

Run `bun run dev` from the repo root to watch both apps. For the compiled app,
run `bun run build` followed by `bun run start`.

## Layout

```
main.ts                    Bun.serve listener settings
server.ts                  wires the route table, static fallback and error handler
routes/index.ts            every server route, using Bun's built-in router
routes/<url-path>/index.ts one folder per endpoint, named after its URL
lib/                       config, security headers, static serving, registry client
test/                      runs against a real server on an ephemeral port
```

To add an endpoint, create `routes/<url-path>/index.ts` (for example
`routes/api/health/live/index.ts`) and register it in
[`routes/index.ts`](routes/index.ts). Security headers are applied to every route
centrally in [`lib/http.ts`](lib/http.ts). Unmatched `/api/*` paths and methods
return JSON 404; everything else falls through to the web build.

## Health

- `GET /api/health/live` returns 200 whenever the process can serve requests. It
  never checks dependencies.
- `GET /api/health/ready` returns 503 when the web build is missing. The staging
  RP registry is not part of readiness: when it fails, only `/api/staging-rp`
  degrades (502).

## Selfie enrollment

`SELFIE_ENROLLMENT_POLICY_FILE` points at the reviewed `client-stage.json` from
`worldcoin/tee-apps` (`releases/selfie-enrollment/`). It holds the endpoint and the
trusted PCR0/1/2 values. The server validates it at startup and refuses to start if
the file is unreadable or invalid. It adds exactly that WebSocket endpoint to the
CSP `connect-src`. `GET /api/selfie-enrollment` returns `{ "enabled": false }`
when the variable is unset, or `{ "enabled": true, "policy": … }`. The browser
treats any other response as an outage, not as "switched off". Unset the
variable to switch enrollment off. The enclave is not part of readiness, because
Selfie Check reports its own failures.

```sh
# Absolute path: `bun run dev` starts the API from api/.
SELFIE_ENROLLMENT_POLICY_FILE="$PWD/../tee-apps/releases/selfie-enrollment/client-stage.json" bun run dev
```

For local synthetic issuance, also set `ENABLE_STAGING_ISSUERS=1` and
`STAGING_SELFIE_HELPER` to the `staging-face-crypto` binary. This mode requires a
loopback listener and refuses production startup. It enables `/api/selfie-credential`
for the real staging Face issuer, using synthetic enrollment shares; the captured
embedding is not bound to this test credential. Issuance retries resume the same
operation using owner-only state under `~/.local/state/web-authenticator/`.

## Consent

`GET /api/consent` returns the analytics choice from the `__Host-wid_consent` cookie
(`unset` without one; Global Privacy Control reads as `denied`). `PUT /api/consent`
records `granted` or `denied`; only same-origin JSON requests may set it.

`POST /api/analytics` rechecks consent and accepts only the fixed web funnel schema.
Server-only `POSTHOG_FUZZY_KEY` and `POSTHOG_FUZZY_HOST` enable forwarding to the
existing mobile pipeline. Both unset means forwarding is disabled. See the
[event contract, mobile references and rollout checklist](../docs/analytics.md).

## Configuration

[`lib/config.ts`](lib/config.ts) reads the listener settings and defines response
security headers. `AUTHENTICATOR_HOST` defaults to `127.0.0.1`; `PORT` defaults to
`4173` (`AUTHENTICATOR_PORT` is also accepted). Invalid ports fail startup.

The CSP allows the official World ID bridges and WalletKit's staging endpoints.
Review it when changing SDK versions or network destinations. Server configuration
and credentials must never be imported by `web`.

## Container

From the repo root:

```sh
docker build -t web-authenticator .
docker run --rm -p 127.0.0.1:4173:4173 web-authenticator
```

The image runs as a non-root user and contains the compiled API and web assets.
It listens on `0.0.0.0:4173` inside the container. Hosting beyond localhost requires
HTTPS for camera and passkey access. Install the [RGBNet model](../web/README.md#camera-guidance)
before building if camera guidance is needed.

This packages the app; AWS hosting, Redis and secrets belong in deployment
configuration and are not provisioned by this Dockerfile.
