# Staging session gateway

This package owns the short-lived `EnrollmentSessionV2` state machine and the staging-only orchestration boundary. It accepts only `FrameBundleV0` descriptors/digests or allowlisted synthetic fixture names, selects simulator scenarios from authenticated server context, and invokes the typed `BiometricVerificationPortV0` and `StagingIssuancePortV0` interfaces with server-owned expected bindings.

The browser handle is an HMAC-authenticated opaque capability returned in a response body. The HMAC key, Ed25519 signers, trust roots, RP request verifier, ceremony verifier, and simulator clients are required runtime dependencies; this package contains no private key material or network endpoint defaults.

The in-memory repository retains only reviewed transaction bindings with session TTL. It never retains ceremonies, simulator signatures, or simulated credential bodies. Stable request timestamps let deterministic downstream operations be reconstructed after response loss without storing signed requests. A separate process-local, TTL-bound response cache preserves the exact immutable result for lost-response idempotent retries without writing credential bodies through the repository. Creation and per-session singleflight serialize all state mutations. Readiness requires distinct public-key material for all four staging purposes. Production mode makes every route unavailable and the exported production-boundary guard rejects simulation artifacts before outcome or authentication fields are inspected.

Run focused proof with:

```bash
bun test clean-start/services/session-gateway/test
bun run --cwd clean-start/services/session-gateway lint
```
