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

By default, the public flow uses capture as its completion signal without sending
a proof. The local staging mode described below waits for proof delivery instead.
The capture is the region the oval preview shows, not
the full camera frame. Framing guidance applies the face engine's VanillaSelfie
geometry to that region, as World App iOS does: face box between 0.52 and 0.80
of the image, at least 112 px, and 1.5% inside each edge (`ENGINE_FRAMING_V1`). The oval’s 64 dots fill gold clockwise during a 1.2-second
continuous hold and reset when alignment is lost. Once captured, the dots stretch
into a continuous green border over 300 ms while the face stays visible and the
guidance changes to “Selfie completed.” The completed border holds for 500 ms,
then cuts directly to the sigil confirmation, with no screen fade or scaling.
The camera stops at that cut, or immediately when the tab is hidden or closed.
Reduced motion shows the green border immediately with the same 500 ms hold.
The button-free sigil confirmation holds for
1.5 seconds, then automatically opens the one-time **Save with passkey / Not now**
decision. These timed stages pause while the tab is hidden and stop on exit;
reduced-motion users skip the movement. Shared footer controls are hidden during
the sequence without changing the layout. Declining ends the session; saving
uses the existing passkey setup and immediately closes the wallet. Both outcomes
are terminal. Interrupted setup may retain a passkey profile for recovery.
Without local staging issuance, the RP continues waiting until expiry;
cancellation attempts to notify it and reports failures.

When the server has a Selfie enrollment policy (see the API README), the captured
JPEG goes to WalletKit's `extractSelfieEmbedding` before completion. A one-shot
WalletKit worker verifies the enclave's Nitro measurements against that policy,
seals the image and waits up to 60 seconds. Only an accepted image reaches the
completed border. Image/quality rejections, attestation or transport failures and
timeouts show a retry, never completion. Hiding the page aborts the request and
terminates the worker. The page keeps only metadata (type, version, backend and
encoded length) and logs it as `selfie_extraction_succeeded`. It does not store
the vector. Without a policy, capture stays local, as above.

With a policy and the explicitly enabled local staging issuer (see the API README),
opening a supported request prepares a random temporary account and schema-11
subject in the background. After enclave acceptance, synthetic staging issuance,
credential storage and proof delivery must succeed before completion. Optional
passkey saving encrypts the same account seed and vault key using its PRF; it does
not register another account. Declining destroys the local vault, although remote
account and issuer records remain. Saving refuses to overwrite an existing saved
authenticator. The synthetic credential does not attest to the captured embedding.

Until WalletKit #604 is published, `@worldcoin/walletkit-web` resolves to a local
tarball built from #604 merged with WalletKit `main`, with the TEE client pinned to
biometrics-tee `main`. The `wasm-serial` build also patches `ark-ec` 0.6.0 to avoid
creating a native Rayon thread pool during browser MSM. Replace this local tarball
with a published SDK containing both fixes once available.

The app removes the key from the address bar; reloading loses the in-memory
request and does not reopen a camera or wallet. Start a fresh request at the RP.

Return navigation uses `return_to_url` from the encrypted request. A `return_to`
query parameter alone does not enable a return link.

## Local PoseGuard demo

Open `/poseguard` for a repeatable movement check without an IDKit request.
Camera access and the model start only after **Start**. The check uses the pinned
FacePAD algorithm 8 defaults: framing, four generated head movements and an eye
check. Keep looking at the stationary dot while following the arrow. Completing
the four movements can still produce a failed or inconclusive eye check.

This is the FacePAD research flow. It does not implement the mobile `POSE_GUARD`
production configuration's three-success policy or embedding similarity checks.
Those require the matching evaluator/model contract, not a constants-only update.

To try it within the existing request flow, append `&poseguard=1` to a fresh
`/verify?i=…&k=…` link. A local pass hands the initial frontal JPEG to the existing
enrollment flow when configured. The standalone demo never submits images or
issues credentials. Neither path has TEE challenge generation or evaluation yet;
the browser's result is not issuer-verifiable authorization.

The build prepares pinned MediaPipe assets locally; it checks the model hash and
serves runtime/model files from `/mediapipe/`. Source and adapter differences are
recorded in `lib/poseguard/PROVENANCE.md`. Completion logs appear in the browser
console under `poseguard_complete`, including outcome, timings and aggregate gaze
metrics. Images, landmarks, seeds and embeddings are not logged or persisted by
this adapter. Closing, hiding or retrying the capture releases camera and worker.
