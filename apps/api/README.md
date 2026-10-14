# Authenticator API

Bun serves the web build and `/api/staging-rp` from the same origin. The RP lookup
reads the staging registry; passkeys, WalletKit and proof generation run in the
browser. Promon sessions and Redis are not implemented yet.

Run `bun run dev` from the repo root to watch both apps. For the compiled app,
run `bun run build` followed by `bun run start`.

## Configuration

[`src/config.ts`](src/config.ts) reads the listener settings and defines response
security headers. `AUTHENTICATOR_HOST` defaults to `127.0.0.1`; `PORT` defaults to
`4173` (`AUTHENTICATOR_PORT` is also accepted). Invalid ports fail startup.

The CSP allows the official World ID bridges and WalletKit's staging endpoints.
Review it when changing SDK versions or network destinations. Server configuration
and credentials must never be imported by `apps/web`.

## Container

From the repo root:

```sh
docker build -t web-authenticator .
docker run --rm -p 127.0.0.1:4173:4173 web-authenticator
```

The image runs as a non-root user and contains the compiled API and web assets.
It listens on `0.0.0.0:4173` inside the container. Hosting beyond localhost requires
HTTPS for camera and passkey access. Install the [RGBNet model](../../docs/rgbnet-browser.md)
before building if camera guidance is needed.

This packages the app; AWS hosting, Redis and secrets belong in deployment
configuration and are not provisioned by this Dockerfile.
