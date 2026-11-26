# Authenticator web app

React UI for passkey wallet access and proof requests. Run `bun run dev` from the
repo root; Vite serves the app at `http://localhost:4173`.

## App requests

Open `/verify?i=REQUEST_ID&k=URL_ENCODED_KEY`. `/verify` serves the app directly.
`i` is the bridge request UUID; `k` is a base64-encoded 32-byte encryption
key. The optional `b` parameter selects the official production or staging bridge.
Requests currently must target staging.

The browser fetches and decrypts the request and checks its RP signature. Only Selfie requests (schema 11 in every requirement) can start the
temporary camera flow. Mixed requests, user-presence requirements and identity
attributes remain unsupported. Direct visits open the authenticator. A user can create a World ID with a passkey
or sign in to an existing authenticator in this browser. Linking is not available.
A signed-in user without an active Selfie Check can open the camera preview;
credential issuance is not yet connected. World links and cookie settings are available from the floating menu.

The public flow uses local capture as its completion signal; it does not send a
verified IDKit response. The oval’s 64 dots fill gold clockwise during a 1.2-second
continuous hold and reset when alignment is lost. Once captured, the dots stretch
into a continuous green border over 300 ms while the face stays visible and the
guidance changes to “Selfie completed.” The completed border holds for 500 ms,
then cuts directly to the sigil confirmation, with no screen fade or scaling.
The camera stops at that cut, or immediately when the tab is hidden or closed.
Reduced motion shows the green border immediately with the same 500 ms hold.
The button-free sigil confirmation holds for
1.5 seconds, then automatically opens the one-time **Save with passkey / Not now**
decision. These timed stages pause while the tab is hidden and stop on exit;
reduced-motion users skip the movement. The shared menu is hidden during
the sequence without changing the layout. Declining ends the session; saving
uses the existing passkey setup and immediately closes the wallet. Both outcomes
are terminal. Interrupted setup may retain a passkey profile for recovery.
The RP continues waiting until expiry; cancellation attempts to notify it and
reports failures. Real camera enrollment remains disconnected.

The app removes the key from the address bar; reloading loses the in-memory
request and does not reopen a camera or wallet. Start a fresh request at the RP.

Return navigation uses `return_to_url` from the encrypted request. A `return_to`
query parameter alone does not enable a return link.

## Routing

`web/App.tsx` mounts a TanStack Router with three routes. The host answers every path that is not an existing file with `index.html` (`not_found_handling: "single-page-application"` in `wrangler.jsonc`; Vite does the same locally), so a reload on any route works.

| Path | Screen |
| ---- | ------ |
| `/` | Authenticator access. Ignores request parameters. |
| `/verify` | Request links (`?i=…&k=…`). Loads and validates the request, then runs the selfie flow. Without a valid request it shows the invalid-request screen. |
| `/authenticator` | Authenticator access. |

After successful sign-in or creation, the app replaces the current URL with `/authenticator` and keeps the wallet open. Reloading requires sign-in again.

The request flow's stages (capture, confirmation, save) stay in memory rather than in the URL: a reload already drops the request. After saving, the flow navigates to `/authenticator` with `replace`, because the spent `/verify` URL is not worth returning to. The router keeps the query string opaque (`parseSearch`/`stringifySearch`), because `/verify` reads the request from the raw URL and the default JSON codec would re-encode the bridge key.

## Hosting notes

`walletkit.wasm` (44.5 MB) exceeds Cloudflare's 25 MiB static asset limit, so the build emits `assets/walletkit-<hash>.wasm.gzip.bin` (`web/build/static-hosting.ts`).
`web/lib/walletkit-wasm.ts` fetches the asset, decompresses it with `DecompressionStream("gzip")`, verifies its byte length and SHA-256 against the build manifest, and passes a `blob:` URL to the WalletKit worker.
`web/lib/rp-registry.ts` reads each request's RP directly from the browser by calling `getRp` on the World Chain `RpRegistry` contract via the public Alchemy RPC (5 s timeout per attempt, up to 3 attempts with jittered backoff).
