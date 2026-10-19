# Authenticator API

Bun serves the web build and `/api/staging-rp` from the same origin. The RP lookup
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
