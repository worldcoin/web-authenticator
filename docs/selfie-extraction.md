# Attested selfie extraction (draft)

Review stack: [#15](https://github.com/worldcoin/web-authenticator/pull/15)
→ [#19](https://github.com/worldcoin/web-authenticator/pull/19) → this draft.
The challenge API and step components already live in
[#18](https://github.com/worldcoin/web-authenticator/pull/18); this draft does not
duplicate that implementation.

## Merge dependency

Blocked on [WalletKit #604](https://github.com/worldcoin/walletkit/pull/604).
The checked-in SDK stays at the published `0.27.1` version, which does not expose
the extraction operation. Enabling extraction with that version fails closed.
Before merging, pin a published SDK containing #604, replace the temporary RPC
contract with the SDK's exported types, and validate against the staging enclave.
No local SDK tarball belongs in this PR.

## Boundary

- The server reads a reviewed `tee-apps` release policy from
  `SELFIE_ENROLLMENT_POLICY_FILE`. Invalid configuration stops startup; an unset
  policy explicitly keeps capture local. Never populate allowed measurements
  from the enclave's own response.
- WalletKit owns attestation verification and encryption. The web app supplies
  the cropped JPEG and release policy, then keeps only model metadata and encoded
  length. It does not persist the image or embedding.
- Capture releases the camera immediately. Extraction shows only the H1
  “Checking your selfie”; acceptance allows confirmation and the save choice.
  Rejection, transport errors, timeout, and cancellation cannot mark it complete.
- One extraction owns one worker, terminated on completion or abort. Other tabs
  can still hold WalletKit's origin-wide OPFS lock; a storage error must never
  trigger deletion of an existing authenticator.

This is extraction only. It provides no trusted camera-origin or liveness claim,
credential issuance, or RP proof delivery. Synthetic issuers, temporary accounts,
subject preparation, and staging-token orchestration remain outside this PR.
Future issuer/proof integration should use the owning SDK/service contracts.

## Validation

Unit and browser fixtures cover the application boundary and UI. Mock acceptance
is not evidence of live attestation or face-engine acceptance. The published SDK
upgrade and live staging validation remain required before merge.
