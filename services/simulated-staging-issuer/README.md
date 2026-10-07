# Simulated staging issuer

This staging-only service verifies the gateway signature and independently verifies the embedded `SimulationReceiptV0` against its own trust root, time, and bindings. Only a current authenticated `simulated_pass` can enter the three deterministic issuance scenarios. Success returns exactly `SimulatedStagingCredentialV0` with the frozen non-claims.

Configuration injects purpose-distinct gateway, receipt, and credential keys, a clock, TTL, and bounded idempotency-cache capacity. Audit events contain no request, receipt, signature, credential body, identifier, or free-text error. Production runtime configuration rejects before reading receipt outcome or authentication.
