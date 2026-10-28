# Authenticator web app

React UI for passkey wallet access and proof requests. Run `bun run dev` from the
repo root; Bun serves the app at `http://localhost:4173`.

## Styling

Tailwind CSS 4 runs through the Vite plugin, with its theme and utilities loaded
by `app.css`. Preflight is omitted to preserve the existing base styles. Use
utilities for new or migrated components and remove their replaced CSS rules;
unlayered legacy CSS takes precedence over Tailwind utilities. The capture
progress ring is the first migrated component.

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

The captured JPEG uses the centered `object-fit: cover` preview crop, not the full camera frame. Framing checks run against that same crop and match the face engine’s size, resolution, and edge-margin limits. Camera resolution requests use 1280×720.

The public flow uses local capture as its completion signal; it does not send a
verified IDKit response. The oval’s 64 dots fill clockwise in Human badge blue
(`#005CFF`) during a 1.2-second continuous hold and reset when alignment is lost.
Capture stops the camera and cuts directly to the sigil confirmation. There is no
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
