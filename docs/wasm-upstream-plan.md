# Browser/WASM dependencies and upstream PR plan

Checked October 1, 2026 against this authenticator's source, dependency pins,
and the linked GitHub PRs. Proposed PR titles below are a plan, not opened PRs.

**Decided plan for web enrollment:** the TEE produces the accepted embedding,
quantizes it, generates AMPC shares, encrypts them to authenticated party keys,
and attests the bound enrollment output. The browser handles capture, encrypted
transport and user custody. This is the implementation target agreed for this
project, not a claim that the upstream services already implement it.

## What the authenticator uses today

| Capability                                                     | Current implementation                                                                                                 | Upstream action                                                                                                                                                                                                                                               |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Registration, credential preparation/storage, proof generation | `walletkit-web@0.22.1`, from the open WalletKit #480 → #522 → #523 stack                                               | Finish/rebase the existing stack and support package releases; do not duplicate it.                                                                                                                                                                           |
| Binding generation                                             | The package build pins UniFFI 0.31.2 and patches UBRN's wasm-bindgen processing/generated TypeScript                   | Track UBRN #409, then update and validate WalletKit's generator/toolchain together. This is a build compatibility workaround, not new cryptography.                                                                                                           |
| Credential listing/deletion                                    | Our `walletkit-patches/` patch adds worker messages and TypeScript methods around existing Rust APIs                   | WalletKit: add the missing public worker APIs above #523. No new Rust implementation is needed just to expose these methods.                                                                                                                                  |
| Credential subject binding on import                           | Our worker patch checks the imported credential's subject against this authenticator and its blinding factor           | WalletKit: preserve this invariant in the supported import API.                                                                                                                                                                                               |
| Selfie score disclosure                                        | Our worker patch fetches schema 11 and attaches its first claim to proof JSON                                          | WalletKit/authenticator: expose deliberate claim access tied to the selected credential. Keep disclosure policy in the authenticator and provide accepted response integrity. Appended JSON is not authenticated by the ZK proof.                             |
| AMPC share creation/encryption                                 | Native helper creates a synthetic vector, secret-shares it using `ampc-secret-sharing`, and seals shares to party keys | Flamingo/TEE: replace this job with attested enrollment output using existing Rust AMPC primitives. Quantization, share generation and party encryption are not browser/WASM requirements. Preserve the exact same shares in enrollment and PCP custody data. |
| Enrollment authentication                                      | Native helper calls Oxide's `ZkpAuthentication::create_header`; enrollment identity state lives on the local server    | Oxide/WalletKit: settle the intended browser auth contract before porting. Reuse the v4 ownership-proof path where required; do not assume the current demo's legacy identity/header flow is the target.                                                      |
| Issued credential verification                                 | Native helper validates schema, subject, issuer key and signature with protocol primitives                             | WalletKit: expose/reuse verified credential import or verification through the worker. Preserve trusted issuer-key selection and all binding checks.                                                                                                          |
| Enrollment submission/polling                                  | Next.js routes and a staging-only integrity exception; associated-data hash is currently synthetic                     | Oxide + face signup service: implement the real evidence/binding contract. This is not solved by compiling the helper to WASM. Browser networking/CORS or a deliberate relay also needs integration.                                                          |

Sources: [helper](../src/server/face-enrollment-helper/src/main.rs),
[helper pins](../src/server/face-enrollment-helper/Cargo.toml),
[server adapter](../src/lib/selfie-issuer-server.ts),
[worker patch](../walletkit-patches/walletkit-web@0.22.1.patch).

Passkeys, PRF/HKDF derivation, bridge AES-GCM and request UI use browser APIs and
TypeScript. They are not missing WASM ports. Encrypted browser credential storage
already works through WalletKit; it is not a Face PCP implementation.

## Needed next, but not integrated into this authenticator

| Capability                                                                          | Existing work                                                                                                                        | Remaining work / owner                                                                                                                                                                                                                                                 |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Verify enclave attestation and key; encrypt/decrypt channel messages                | Pontifex #47 is **merged** and enables browser clocks/randomness for attestation/channel APIs                                        | Reuse a compatible revision/release. Validate it with the current Flamingo dependency graph; do not open another portability PR without a demonstrated gap.                                                                                                            |
| Send encrypted matches from a browser and verify returned statements/input bindings | Flamingo #129 implemented browser WebSockets; **closed, unmerged**. #116 covered the older HTTP transport                            | Flamingo: adapt #129 to current main and the agreed browser authorization mechanism; run browser runtime tests. Native arbitrary upgrade headers cannot be copied to browser WebSockets.                                                                               |
| Expose Flamingo to `walletkit-web`                                                  | WalletKit #554 enabled UniFFI/WASM but explicitly left the handwritten TypeScript worker API for follow-up; **closed, unmerged**     | WalletKit: restore current-client WASM integration and add typed worker methods, lifecycle/cancellation handling and browser tests.                                                                                                                                    |
| TEE Selfie Check enrollment                                                         | Current Flamingo match API has DeepFace and GrayBadge; neither is a raw embedding/AMPC enrollment API                                | Flamingo: add accepted embedding generation, quantization, AMPC sharing, party encryption and attested output bound to enrollment/custody. Face signup service: verify that evidence before acceptance. Model execution support may require biometric-engines changes. |
| Returning Selfie Check against enrolled reference                                   | Current GrayBadge compares live and challenge images, not an enrolled Face PCP reference                                             | Flamingo/protocol: define and implement the requested reference comparison and result binding. Do not rename GrayBadge and assume semantic equivalence.                                                                                                                |
| Face PCP construction/encryption/readback                                           | Oxide has native implementations; no current browser PCP API identified                                                              | Oxide: isolate portable data/crypto/archive operations from Face Engine/OpenCV and native host services. WalletKit: expose only the agreed reusable surface; avoid copying the PCP format into a second implementation.                                                |
| PCP storage, backup and recovery                                                    | Oxide #1199 is merged for identity-scoped storage/backup. WalletKit #512 is open for credential-associated-data persistence/recovery | Reuse ownership and data-binding rules. Decide full-PCP storage vs credential-associated-data integration before adding a new vault. Browser persistence alone is not backup/recovery.                                                                                 |
| Browser capture guidance                                                            | Soam's experiments contain RGBNet via ONNX Runtime Web and capture helpers                                                           | Integrate the model harness in this authenticator. Model/runtime changes belong in biometric-engines or the runtime's repo if needed; this is not a WalletKit binding gap.                                                                                             |

Soam's native evaluator and encrypted face vault are reference implementations,
not dependencies currently integrated in this authenticator. Running a model via
ONNX Runtime Web is separate from exporting the complete native Face Engine to WASM.

## What the closed PRs covered

| PR                                                                        | Coverage                                                                   | Why it does not finish this work                                                                                           |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| [Pontifex #47](https://github.com/worldcoin/pontifex/pull/47), merged     | Browser-compatible Nitro attestation verification and channel dependencies | A lower-level building block; no Flamingo transport or enrollment API.                                                     |
| [Flamingo #116](https://github.com/worldcoin/flamingo/pull/116), closed   | Attested client over browser Fetch, response limits, browser tests         | Older HTTP contract; main now uses WebSockets.                                                                             |
| [Flamingo #129](https://github.com/worldcoin/flamingo/pull/129), closed   | Browser WebSocket assignment and sealed match exchange                     | Closure cites different browser authorization requirements; PR reported compile checks but no local browser runtime tests. |
| [WalletKit #548](https://github.com/worldcoin/walletkit/pull/548), closed | Standalone wasm-bindgen client/worker for three-way matching               | Superseded integration approach; not enrollment, shares, PCPs or the current web-worker facade.                            |
| [WalletKit #554](https://github.com/worldcoin/walletkit/pull/554), closed | Existing matching API through UniFFI/WASM                                  | Handwritten `walletkit-web` client exposure was explicitly deferred; pins predate the current transport.                   |
| [WalletKit #567](https://github.com/worldcoin/walletkit/pull/567), closed | Portable request types and input validation                                | No networking, attestation execution, matching or enrollment.                                                              |
| [Oxide #303](https://github.com/worldcoin/oxide/pull/303), closed         | Historical broad WASM compilation attempt                                  | Not a merged/current browser enrollment and PCP SDK.                                                                       |
| [WalletKit #487](https://github.com/worldcoin/walletkit/pull/487), closed | Proof response claim disclosure from the same selected credentials         | Not a WASM portability fix or integrity solution; broad disclosure is not automatically the desired policy.                |

The Flamingo closures cite browser authorization or no expected browser use, not
proof that encrypted browser matching is technically impossible. Prior code is
reusable, but its API/dependencies must be updated and revalidated.

## Definite plan and upstream PR sequence

### Decision: generate enrollment shares in the TEE

This project's plan is TEE-side share generation. No earlier explicit decision
on that placement was found in the reviewed discussions; the following sources
support the reasoning, rather than establish cross-team approval:

- [Web enrollment design discussion](https://tfh.enterprise.slack.com/archives/C0ARSRLVCV7/p1790628584513719):
  TEE model execution, issuer acceptance of TEE integrity, and enrollment support
  were proposed; exact share-generation placement/binding was not specified.
- [Ertugrul's scoring proposal](https://tfh.enterprise.slack.com/archives/C0ARSRLVCV7/p1790681976318759):
  keep one AMPC set and distinguish web/mobile capture origins in signup-service
  metadata and scoring. Vincent and Pranav supported that direction in the thread.
  This does not decide where shares are generated.
- [Deep Identifier precedent](https://tfh.enterprise.slack.com/archives/C0AP0GJPYUF/p1789758405412779):
  generate shares and assemble/sign/encrypt the PCP inside the TEE, outside the
  biometric sandbox. This is a different product/PCP pipeline, not an approved
  web Selfie Check implementation or a drop-in dependency.

For the first TEE-backed enrollment, the TEE will generate the shares from the
accepted embedding, encrypt them to authenticated AMPC party keys and attest the
enrollment output. The browser will retain user-encrypted custody data and can
relay the per-party ciphertexts. The submission route and exact PCP assembly
location remain integration details; neither changes where shares are generated.

The security invariant is that the shares accepted for enrollment represent the
embedding produced by the approved pipeline on the bound capture. A signed hash
of an embedding plus unrelated browser-generated shares does not establish that
relationship. Browser generation would need an existing accepted correctness
proof, or a trusted component to verify/recompute the relationship before signing.
Do not add a new proof system just to preserve browser share generation in v1.

| Criterion             | TEE generates shares                                                                          | Browser generates shares                                                                        |
| --------------------- | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Output binding        | Pipeline can directly bind accepted embedding, generated shares and enrollment context        | Requires verification that the submitted shares encode the accepted embedding                   |
| Reuse                 | Reuse Rust AMPC primitives; integrate with enclave output/signing                             | Reuse AMPC primitives after WASM compatibility work, plus binding mechanism                     |
| Delivery dependencies | Enclave deployment, issuer verification, agreed custody output                                | Browser SDK work, issuer verification and a secure share-to-embedding binding path              |
| Privacy               | TEE already processes the image/embedding; keep host and issuer from plaintext via encryption | Browser needs the embedding; that may already be needed for custody, so assess actual data flow |
| Performance           | No extra image round trip inherently required; benchmark share generation                     | Some work moves to browser, but trusted verification may add work/round trips                   |

There is no measured schedule or performance comparison yet. The decision removes
browser share-generation work but adds a required enclave/service integration;
it is not a proven faster delivery estimate. Confirm with Flamingo/PoP owners
whether reusable enrollment output code already exists,
who owns the signer/key policy, and how account, capture, share/PCP commitments,
challenge/expiry and replay handling fit the issuer contract. Authenticate AMPC
recipient keys and the user's custody key rather than trusting arbitrary supplied
keys. Share generation in a TEE does not itself prove live camera provenance.

### Effect on the browser/WASM checklist

These are required work items, not claims that implementations have landed.

| Status in the plan                  | Capability                                                                                                        | Implementation boundary                                                                                                                   |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Removed from browser/WASM scope     | Embedding quantization, AMPC share generation and encryption to party keys                                        | TEE enrollment operation, reusing native Rust primitives                                                                                  |
| Required service work               | Bind accepted capture/model output, exact shares, custody commitments, account and challenge to verified evidence | Flamingo/TEE produces evidence; signup-service verifies it and enforces expiry/replay rules                                               |
| Still required in browser           | Encrypted enclave channel and trusted key/evidence verification path                                              | Reuse Pontifex portability; complete Flamingo transport/auth and WalletKit worker integration as appropriate to the agreed channel design |
| Still required in browser           | Enrollment authentication, credential verification/import and selected-claim access                               | Supported WalletKit/Oxide APIs replace remaining helper jobs and local patches                                                            |
| Still required for browser custody  | Canonical PCP parsing/serialization where needed, custody encryption/readback, storage and recovery               | Narrow Oxide portable surface plus WalletKit/browser storage adapters; consume TEE-produced data without generating new shares            |
| Browser work, not an AMPC WASM port | Camera capture, framing guidance and request UI                                                                   | Browser APIs and the model harness                                                                                                        |

Do not port the native helper wholesale or open an AMPC WASM PR for this v1 flow.
Retire the helper only after its share-generation job has moved to the TEE and
its authentication and credential-verification jobs have supported replacements.
The closed matching PRs remain useful transport/client work; they do not implement
this enrollment operation. Returning-user matching remains a separate requirement.

### Implementation order

1. **WalletKit: complete web credential worker APIs and verified import.** Build
   above #523; replace the local listing/deletion and subject-binding patches,
   expose credential verification, and provide deliberate claim access. Reuse
   existing core/protocol implementations. Keep claim integrity and disclosure
   policy explicit; do not silently make every proof disclose every claim.
2. **Flamingo: browser WebSocket client with agreed authorization.** Start from
   #129, use compatible Pontifex browser support, and test attestation/key
   binding, encrypted transport, result binding, timeouts and cancellation in a
   real browser with fixtures.
3. **WalletKit: Flamingo browser worker integration.** Follow the current UniFFI
   package architecture rather than #548's extra standalone wrapper. Depend on
   PR 2 and expose only operations supported by the service.
4. **Flamingo + signup-service: attested Selfie Check enrollment contract.**
   Implement TEE-side embedding quantization, share generation and party
   encryption. Specify and bind exact shares/PCP/account/challenge, authenticate
   recipient and custody keys, and define submission, expiry and replay handling.
   Add the operation and issuer verification in their owning repositories.
5. **Oxide: portable PCP custody and enrollment data primitives.** Extract or
   feature-isolate only the data/crypto operations needed by the browser under
   PR 4; retain the canonical package format and identity checks. Consume the
   TEE's exact embedding/share custody data. Test native/WASM equivalence with
   synthetic fixtures. Exclude browser quantization, share generation, party
   encryption and native model inference from this PR's scope.
6. **WalletKit: expose portable enrollment/PCP APIs and persistence.** Depend on
   PR 5, evaluate #512 for associated data, and supply browser host adapters.
   Coordinate credential import with PCP save/recovery. Remove the native helper
   only when shares, enrollment authentication and credential verification all
   have supported replacements.

PRs 2–3 are needed if the browser owns the existing Flamingo attested session.
If a trusted service certifies the enclave key instead, design that certificate
and channel integration explicitly; the certificate service is additional work,
not something established by the closed PRs.

New upstream PRs outside these three repos should be limited to demonstrated
dependencies: `signup-service` for issuer-side evidence verification,
`biometric-engines` for missing model operations, and UBRN for generator
compatibility. An `ampc-common` WASM port is not a dependency of this plan;
any required AMPC change must be justified by the TEE integration. Pontifex already
has the relevant merged portability work.

## Related open/merged work to reuse

- WalletKit [#480](https://github.com/worldcoin/walletkit/pull/480),
  [#522](https://github.com/worldcoin/walletkit/pull/522),
  [#523](https://github.com/worldcoin/walletkit/pull/523): open web package stack.
- WalletKit [#512](https://github.com/worldcoin/walletkit/pull/512): open
  credential-associated-data persistence/recovery work.
- WalletKit [#492](https://github.com/worldcoin/walletkit/pull/492): open claim
  accessor cleanup; removes `claims_hex`, which our current patch calls.
- Oxide [#1230](https://github.com/worldcoin/oxide/pull/1230): merged v4-proof face
  enrollment; our helper's pin includes it but the demo does not call that API.
- Oxide [#1199](https://github.com/worldcoin/oxide/pull/1199): merged identity-scoped
  PCP custody; our helper does not create or store a PCP.
- UBRN [#409](https://github.com/jhugman/uniffi-bindgen-react-native/pull/409): open
  UniFFI 0.32 update; dependency upgrades need generator/build validation.

This inventory is a source/PR review. No new browser, Rust or live-enclave tests
were run for it, and no new upstream PR was opened.
