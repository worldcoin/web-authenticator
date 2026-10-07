# Simulated biometric verifier

This staging-only service authenticates a gateway request, validates all server-owned bindings and the metadata-only or allowlisted synthetic artifact, then maps the authenticated scenario to one deterministic `SimulationReceiptV0` outcome.

Configuration injects the gateway trust root, a distinct Ed25519 receipt-signing key, clock, TTL, fixture allowlist, and bounded idempotency-cache capacity. Audit events contain only an event name and optional stable reason code. Production runtime configuration rejects before reading the request.

It does not inspect pixels and makes no camera-provenance, model, liveness, spoof-detection, or trusted-execution claim.
