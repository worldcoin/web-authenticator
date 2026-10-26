# Authenticator web app

React UI for passkey wallet access and proof requests. Run `bun run dev` from the
repo root; Bun serves the app at `http://localhost:4173`.

## App requests

Open `/verify?i=REQUEST_ID&k=URL_ENCODED_KEY`. `/verify` serves the app directly.
`i` is the bridge request UUID; `k` is a base64-encoded 32-byte encryption
key. The optional `b` parameter selects the official production or staging bridge.
Requests currently must target staging.

The browser fetches and decrypts the request and checks its RP signature. Only Selfie requests (schema 11 in every requirement) can start the
temporary camera flow. Mixed requests, user-presence requirements and identity
attributes remain unsupported. There is no landing page: `/` redirects (302) to
https://world.org/ without its query, and `/verify` without a request ends on
“This request can’t be verified”. **Go to authenticator** opens saved access,
where the user explicitly signs in with their passkey to view credentials. It is
offered after a request is saved and on `/recover` (“Retrieve your World ID
credentials”), which is also how a later visit recovers an interrupted setup.
**Back** returns to the screen that opened it. Neither entry opens the camera or
creates an account.

The public flow runs four server-issued PoseGuard movements and submits head/eye
measurements for API verification. Photos remain in browser memory. The oval’s
64 dots fill clockwise in Human badge blue (`#005CFF`) as movements complete;
a highlighted edge shows the requested direction and a red dot guides eye fixation.
Only an API `passed` verdict, together with local completion, opens the sigil
confirmation. This is a movement-check preview: it does not issue a credential
or send a verified IDKit response. Capture stops the camera before API verification. There is no
frozen-photo presentation, solid-border animation, or post-capture hold.
The page and fixed footer use a white background.
The button-free sigil confirmation holds for
1.5 seconds, then automatically opens the one-time **Save with passkey / Not now**
decision. These timed stages pause while the tab is hidden and stop on exit;
reduced-motion users skip the movement. Shared footer controls are hidden during
the sequence without changing the layout. Declining ends the session; saving
uses the existing passkey setup and immediately closes the wallet. Both outcomes
are terminal. Interrupted setup may retain a passkey profile for recovery.
The RP continues waiting until expiry; cancellation attempts to notify it and
reports failures. Real camera enrollment remains disconnected.

The app removes the key from the address bar; reloading loses the in-memory
request and does not reopen a camera or wallet. Start a fresh request at the RP.

Return navigation uses `return_to_url` from the encrypted request. A `return_to`
query parameter alone does not enable a return link.

## PoseGuard runtime

Development and web preparation copy the pinned MediaPipe runtime and download a
hash-verified model into ignored `web/public/mediapipe/`. These assets are served
from the app's origin; users do not contact a model CDN. No private RGBNet model
is needed for the public movement flow. See [the API boundary and beta
follow-ups](../docs/poseguard.md) before connecting an issuer or deployment.
