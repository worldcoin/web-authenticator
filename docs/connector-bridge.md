# Native connector and bridge flow

The authenticator accepts World ID connector query parameters at `/verify` or `/`.
This code is independent of the relying-party demo's request generation.

- `src/lib/requests/connector.ts`: strict `i`/`k` parsing, official bridge allowlist,
  safe explicit return URLs. Only ordinary URL/QR links are supported, not invite codes.
- `bridge.ts`: bounded fetch, browser-only AES-256-GCM decryption, fresh-IV encrypted
  response upload with PUT. The bridge key never goes to our server or browser storage.
- `proof-request.ts`: staging-only V4 uniqueness payload parsing, action/hash binding,
  expiry, registry-backed RP signature validation, and vault credential matching.
- `/api/staging-rp`: fixed World Chain RPC / staging RP registry lookup. Caller controls
  only a uint64 RP ID. It returns the active RP signer and OPRF key, not secrets.
- `incoming-request.ts`: turns the bridge payload into a request the
  drawer can review. No signed request fields are rewritten to fit available credentials.
- `CredentialRequestSheet`: opens automatically, shows the actual requested schemas,
  blocks unsatisfied or unsupported requests, and requires approval before generation.
  The proof stays visible for review before explicit encrypted delivery/return.

The connector query is removed from browser history after capture, and the app uses
`Referrer-Policy: no-referrer`. Reloading that cleaned page loses the in-memory request;
open a fresh connector from the RP to continue. Logs include steps/status only.

## iOS reference

Read-only reference: worldcoin/world-app-ios at
`468ef889125c4bad28c4b0b27686a1f6f20ea454` (latest remote `main` checked on 2026-10-01).
The local checkout was on a different branch; referenced files were fetched through
the GitHub API at this exact commit without modifying that checkout.
Bridge parsing, preload, crypto, networking and response-envelope files match the
local checkout. The legacy shell routing files differ, and the latest versions were
read to confirm the same prepare → preload → credential-request sheet flow.

- `Sources/WorldAppLegacy/Sources/WorldIDAppLib/IDApp/IDAppReducer+UniversalLinks.swift`: incoming link routing.
- `Sources/WorldAppLegacy/Sources/RelyingPartyResponder/RelyingPartyResponderPreload.swift`:
  request loading, metadata and credential checks before presentation.
- `Sources/WorldAppLegacy/Sources/RelyingPartyResponderCore/WorldIDBridge/AnonymousWorldIDBridgeClient.swift`:
  allowlisted bridge fetch and response submission.
- The sibling `WorldIDBridgeCryptoService.swift`: AES-GCM, ciphertext followed by tag,
  base64 IV/payload wrapper.
- `Sources/WorldAppLegacy/Sources/RelyingPartyResponderCore/Networking/WorldIDAPI.swift`:
  GET request and PUT response routes.
- `WorldIDBridge/Models/WorldIDBridgeV2_1Response.swift`: `proof_response` response envelope.

## Scope

No iOS build or edits. No automated functional tests, per user preference.
User-presence/face-auth and identity attestation requests are visibly unsupported;
passkey user verification is not substituted for those protocol requirements.
Session proof types and legacy V3 requests are also rejected explicitly.
Native integrity bundles cannot be produced here. A staging RP verifier may reject
an otherwise returned proof if its policy requires such a bundle. Transport delivery
is shown separately from RP verification, which happens at the RP.

The staged registry deployment address comes from the local World ID protocol
`contracts/deployments/core/staging.json`. App ID/action presentation does not claim
a verified brand or domain; the RP signature establishes the registry signer only.

## Browser check

The hosted RP created a real IDKit request targeting localhost `/verify`. The
authenticator fetched/decrypted it and validated RP c8b34be5b84c6722 against the
staging registry. It then waited for the user's passkey unlock. Proof generation,
response upload and RP verifier acceptance were not confirmed by that check.
