# Local TEE connection

The demo supplies its configured access token automatically. There are no token
input fields. Clicking **Issue selfie credential** (or **Demo challenge**) opens
the camera and starts this independent connection sequence:

1. `POST /api/tee-admission` obtains the local demo token from the development backend.
2. `POST http://127.0.0.1:8010/v1/connect` sends it in the Authorization header.
3. The response appears in the **TEE connection** box, separate from **Camera / ONNX**.

**Retry TEE connection** fetches the configured token again without restarting
the camera. Leaving the demo cancels an in-flight admission/connection request.
Tokens are never put in logs, persistent browser storage, URLs or the JS bundle.

## Development setup

Generate the private ten-minute token and start `di-local-face-host` from the
sibling `biometrics-tee` repository using its `docs/local-face-images.md`.
Configure this demo's `.env.local` to use the **same file and browser origin**:

```sh
LOCAL_TEE_TOKEN_FILE=/private/path/token.json
LOCAL_TEE_ORIGIN=http://localhost:3100
VITE_TEE_BASE_URL=http://127.0.0.1:8010
```

Run `bun run dev`. The development launcher enables `LOCAL_TEE_DEMO_ADMISSION=1`
for its backend. The provider is disabled by default and always disabled when
`NODE_ENV=production`. It requires the exact configured HTTP loopback origin,
POST, JSON content type and `Sec-Fetch-Site: same-origin`. Responses are no-store.
Open `http://localhost:3100`, unlock, and use **Developer menu → Issue selfie credential**.

This local provider intentionally serves the shared demo credential to callers
on the configured demo origin. It is not the production proxy's user/device
authentication. Do not expose or tunnel this development provider publicly.
The production proxy will replace token provisioning and authenticate callers.

The provider reads the private token file on each request and refuses invalid,
expired or permissively readable files. It does not extend token expiry or mint
credentials the TEE has not accepted. To rotate, generate a new token file, point
both services at it, and restart them. Browser users do not need to paste tokens.
Never place the token itself in `VITE_*` or source code.

## Results

Each browser network operation has a five-second deadline and a 4 KiB response
limit. The client refuses redirects and invalid/expired responses. `connect`
also validates protocol version, local mode and face-processing capability.

- Admission provider **503**: local token is absent, invalid or expired; no TEE request is sent.
- TEE **403**: token is wrong/expired or the supplied Origin is not allowed.
- TEE **503**: authorization succeeded, but face processing is unavailable.
- TEE **200**: accepted only with a compatible response advertising a ready face worker.

The local host now launches the real biometric worker in Docker. Once the worker
is ready, authorized connect returns **200**; worker failure returns **503**.
The authenticated image API runs the vanilla-selfie pipeline and marks results
`mode: local-docker`, `attested: false`. No image is uploaded by the browser yet.
Production attestation, encryption, enclave integration and the camera upload
action remain pending.
Every eventual image upload must carry authorization again; the local host
already enforces that rule. Production builds keep uploads disabled.

Tests: `bun test tests/tee-admission.test.ts tests/tee-connection.test.ts`.
