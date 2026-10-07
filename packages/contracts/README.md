# Shared contract freeze

The first eight Main-owned interfaces were approved at Gate 2 for the simulator-backed foundation. cs5 adds three versioned, staging-only UI/composition interfaces without changing or pretending to implement the blocked real contracts. These files define types and invariants, not an implementation.

## Frozen interfaces

1. `WebAuthnPrfAuthenticatorV1`
2. `EnrollmentSessionV2` (`V1` is retained as a superseded audit artifact and must not be implemented)
3. `SimulationCapturePolicyV0`
4. `FrameBundleV0`
5. `ClientQualityPolicyV0`
6. `BiometricVerificationPortV0` and `SimulationReceiptV0`
7. `StagingIssuancePortV0` and `SimulatedStagingCredentialV0`
8. `WorldIdRegistrationAdapterV1`

cs5 staging UI/composition interfaces:

9. `InjectedAuthenticatorPortV0` and `StagingDemoAuthenticatorReadyV0`
10. `SimulatorBrowserSessionPortV0` and its safe browser projections
11. `AuthenticatorUiFlowV1`, its categorical progress/error model, and frozen staging copy

The interface shape for item 8 is frozen, but W03 implementation remains blocked: no pinned browser-capable SDK revision, full deterministic World ID public-output/registration/returning-signature vectors, or real staging gateway/chain configuration has been supplied. Gate 2 records that gap instead of inventing values.

`EnrollmentSessionV2` supersedes V1 after the pre-implementation test plan exposed a missing issuance-result distinction. V2 separates biometric pending/reject/retry/unavailable from issuance pending/reject/unavailable and records both server-selected scenarios. Consumers must not map issuance rejection onto a biometric outcome.

## cs5 demo boundary

- `InjectedAuthenticatorPortV0` is a production-invalid staging compatibility seam. Its success result states that WebAuthn, PRF evaluation, and World ID creation were all **not** performed.
- The adapter may satisfy W06’s internal `passkey_complete` and W04’s internal `prfReady` gates only inside the named staging composition layer. Those inherited internal names are not factual claims about the demo.
- `SimulatorBrowserSessionPortV0` has no browser-controlled scenario input and omits simulator receipts, signatures, credential bodies, account identifiers, and raw return URLs. Every input has a strict runtime validator; every operation returns either a strict safe projection or a stable typed error envelope.
- The browser receives a fixed negative workflow-artifact summary only after `simulated_credential_ready`.
- `AuthenticatorUiFlowV1` freezes states, user actions, dependency events, legal transitions, ordered effects, server-state projection, error mapping, visual-source labels, and categorical progress. It has no percentage, ETA, arbitrary message, raw upstream error, secret, media, or credential field.
- Pre-session and explicit Close actions use `close_locally`; they never fabricate session fields or invoke the session-bound RP return port.
- User cancellation, page hide/unload, orientation invalidation, component unmount, and operation interruption use the frozen order: abort active effects, stop camera ownership, clear transient media, then request session cancellation only when an authenticated session exists.
- The frozen live policy is metadata-only capture with one or two frames and a camera-active-only UX check. Camera activity does not establish face position, so the safe UI copy says “Camera ready,” not “Great position.”

## V0 data decision

- Real camera bytes remain in browser memory and never cross the simulator boundary.
- `metadata_only` carries frame descriptors and digests.
- `synthetic_fixture` carries a named fixture reference, never user media.
- Array order is transport structure only and has no biometric meaning.
- Simulator outcomes are selected by an authenticated server-side staging scenario, never by pixels or browser scores.

## Change control

- Main is the sole writer.
- Any field, invariant, state, outcome, canonicalization, or trust-boundary change requires Main review and a version increment.
- Additive changes are not automatically compatible; a consumer must explicitly admit the new version.
- V0 simulation types can never be renamed or promoted into real TEE/issuer types.
- Future real TEE and issuer contracts start as new versions from owner-supplied interfaces; V0 does not promise wire compatibility.
- Workers stop and request a Main contract change instead of editing this package.

## Canonical digest

`FrameBundleV0.artifactDigestSha256` is lowercase hex SHA-256 over UTF-8 RFC 8785 JSON Canonicalization Scheme serialization of the bundle with `artifactDigestSha256` omitted. Frame digests use the same lowercase hex representation. The current contract defines the digest preimage; worker implementations must add deterministic vectors before integration.

## Staging signatures

Gateway-to-simulator requests, `SimulationReceiptV0`, and `SimulatedStagingCredentialV0` use Ed25519 with purpose-specific staging-only allowlisted keys and audiences. The signing preimage is UTF-8 RFC 8785 JSON Canonicalization Scheme serialization of every object field, including `authentication.scheme` and `authentication.keyId`, with only `authentication.signatureBase64Url` omitted. Consumers reject unknown keys, algorithms, environments, audiences, versions, expiries, scenario/outcome mismatches, nonce/idempotency/policy mismatches, and other binding failures. Production rejects the simulation discriminator before signature or outcome processing.
