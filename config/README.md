# Main-owned application configuration

This directory contains non-secret, staging-only values frozen by Main for cs5. W01 may import these values but may not edit them.

- The browser cannot select simulator scenarios.
- Signing keys and completion-handle keys are generated or injected at server startup and never appear here.
- The local origin is a development/evidence surface, not deployment or physical-iPhone evidence.
- Security headers apply to the app-owned Bun server and keep camera permission limited to the same origin.
- Server binding and the two exact allowed browser origins come from the environment: `AUTHENTICATOR_HOST` (default `127.0.0.1`; `0.0.0.0` in containers), `PORT`/`AUTHENTICATOR_PORT` (default `4173`), `AUTHENTICATOR_PUBLIC_ORIGIN` (default `http://127.0.0.1:<port>`), and `AUTHENTICATOR_LOCAL_ORIGIN` (default `http://localhost:<port>`). Origins must be bare `http(s)://host[:port]` values; anything else fails startup. The RP identifier is the public origin's hostname.
