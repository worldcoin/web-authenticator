# Authenticator web app

React UI for passkey wallet access and proof requests. Run `bun run dev` from the
repo root; Bun serves the app at `http://localhost:4173`.

## App requests

Open `/?i=REQUEST_ID&k=URL_ENCODED_KEY`. `/verify` redirects to `/` with the same
query. `i` is the bridge request UUID; `k` is a base64-encoded 32-byte encryption
key. The optional `b` parameter selects the official production or staging bridge.
Requests currently must target staging.

The browser fetches and decrypts the request, checks its RP signature and asks
for approval before generating a proof. It removes the key from the address bar;
reloading loses the in-memory request. Open the original connector link to resume.
