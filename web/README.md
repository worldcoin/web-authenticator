# Authenticator web app

React UI for passkey wallet access and proof requests. Run `bun run dev` from the
repo root; Bun serves the app at `http://localhost:4173`.

## App requests

Open `/verify?i=REQUEST_ID&k=URL_ENCODED_KEY`. `/verify` serves the app directly.
`i` is the bridge request UUID; `k` is a base64-encoded 32-byte encryption
key. The optional `b` parameter selects the official production or staging bridge.
Requests currently must target staging.

The browser fetches and decrypts the request and checks its RP signature. Outside
Dev mode, only Selfie requests (schema 11 in every requirement) can start the
temporary camera flow. Mixed requests, user-presence requirements and identity
attributes remain unsupported. Direct visits show the landing page, whose
**Go to authenticator** button opens a saved-authenticator access screen. The user
explicitly signs in with their saved passkey to view credentials. Browsers without
saved access are directed to start from an app request; this button never opens
the camera or creates an account.

The public flow currently ends with **Selfie captured**, not a verified IDKit
response. Capture is discarded on completion or exit. A one-time **Save with
passkey / Not now** decision follows capture. Declining ends the session without
opening or creating a wallet. Saving uses the existing passkey/account setup and
immediately closes the wallet; failures allow retry or closing. An interrupted
save can retain a passkey profile for recovery. This does not
issue a credential or a successful proof response. The RP continues waiting until
its request expires. Cancellation attempts to notify the RP and reports failure.
Dev mode replaces the public screen in place, without changing the URL. Its
single workspace contains passkey access, the credential vault, request proof
tools, and optional camera diagnostics. Turning it off aborts operations and
locks the developer wallet. Synthetic credential issuers are not part of this app.

The app removes the key from the address bar; reloading loses the in-memory
request and does not reopen a camera or wallet. Start a fresh request at the RP.

Return navigation uses `return_to_url` from the encrypted request. A `return_to`
query parameter alone does not enable a return link. The Dev-mode proof flow
delivers through the bridge even when no payload callback is provided.
