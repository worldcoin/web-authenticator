# Code boundaries and readiness

The default app is a staging-only product implementation. No directory is labeled
“production ready”: production enrollment, recovery and deployment validation are
still incomplete. A file's location states its role, not its security approval.

| Location | Role | Current status |
| --- | --- | --- |
| `web` | React UI, browser wallet, camera and proof requests | Real staging registration, vault, bridge and proof flow; no Selfie enrollment |
| `api` | Bun server, routes and server configuration | Serves web assets and staging RP lookup; Promon and Redis are not implemented |
| `packages` | Shared libraries and contracts | Per-package validation required; current admission policy/contracts are not wired into the app |
| `tests` and `*/test` | Regression tests and fixtures | Mocks are test inputs, not live-service validation |
| `experiments/tee-demo` | Preserved standalone demo | Synthetic enrollment, placeholder integrity, local TEE integration; never a product dependency |
| `docs` | Current architecture and historical investigations | Historical enrollment/integration notes are explicitly marked |

## Enforced separation

- Root tests use explicit directory paths, so Bun does not also select experiment tests by substring.
- `web` and `api` have separate dependencies, TypeScript configurations and builds. Bun serves both outputs from one origin.
- Root build/start commands target these two apps; experiments are outside workspaces.
- ESLint rejects product imports from experiments and fixture directories.
- ESLint rejects browser imports of API modules and server imports of browser implementation code.
- Vite rejects API, experiment and test modules in browser and worker builds, including dynamic imports.
- HTTP regression tests require the removed synthetic enrollment/capability routes to return 404, including on localhost.
- UI regression tests require missing Selfie credentials to leave proof approval unavailable, without offering synthetic issuance.

The synthetic adapter and identical Rust helper were removed from product paths;
the existing experiment retains them. Root commands cannot enable them via an
environment flag. Existing vaults, operation files, resume tokens and backend
records are not deleted. Previously issued staging credentials remain usable under
the existing staging verification rules.

## Where new code belongs

Promon validation, session storage and rate limiting belong in `api`.
Browser integration belongs in `web`. Add shared API schemas under
`packages` only when both apps need them; neither app currently depends on the
legacy admission/contracts packages. Those packages retain their own regression
coverage. The root package owns shared development tools and cross-app tests.

One container contains both builds. Separate workspaces do not require separate
services. Deployment infrastructure belongs in the deployment repo.

## Requirements before real enrollment can enter product code

- Resolve a durable enrollment identity and its ownership proof separately from the WalletKit credential subject.
- Obtain accepted capture/model output and exact encrypted AMPC shares with verified binding.
- Construct actual PCP associated data and its canonical hash; implement custody and recovery.
- Agree and implement signup-service verification of the Gateway/TEE integrity bundle, expiry and replay protection.
- Take embedding metadata from the verified pipeline output rather than fixture constants.
- Validate real enrollment, failure/recovery paths and production trust configuration before enabling issuance.

Endpoint addresses, schema identifiers, protocol versions and resource limits may
legitimately be fixed. Synthetic biometric input, fabricated hashes and test
integrity tokens may not stand in for missing production behavior.

Keeping experiments tracked means a merge still contains demo source, even though
it is excluded from runtime builds. If main must contain no demo source at all,
remove `experiments/` in a separate, explicit cleanup; do not call this separation
production certification.
