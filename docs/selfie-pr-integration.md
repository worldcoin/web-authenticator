> **Historical demo/integration notes.** Synthetic enrollment and the TEE demo
> are preserved under `experiments/tee-demo`; they are not part of the default app.
> Paths and validation below describe that earlier implementation. For current
> runtime boundaries and readiness, see [code boundaries](code-boundaries.md).

# Selfie enrollment integration snapshot

Updated on 2026-10-09. The product now installs the locally built #604 candidate.
Original WalletKit and biometrics-tee working checkouts remain untouched.

## Isolated source checkouts

| Checkout                          | Baseline plus PR                            | Result                                                     |
| --------------------------------- | ------------------------------------------- | ---------------------------------------------------------- |
| `../biometrics-tee-integration`   | `main` at `c4cf511` plus biometrics-tee #70 | Fast-forward to `04481c5c9136ed2205e0d80d26ab495be6a2dd98` |
| `../walletkit-selfie-integration` | Published `v0.27.1` plus WalletKit #604     | Fast-forward to `61547ee3c9f861990b6baa52a13693f14c74ef96` |

Branches: `integration/selfie-pr70` and `integration/selfie-pr604` respectively.
WalletKit's enrollment dependency pins exactly the TEE revision above.

The WalletKit integration checkout also removes the obsolete assignment `nonce`
from `web/walletkit/tests/fixture/enrollment.worker.ts`. PR #70's assignment
schema rejects unknown fields; this stale fixture made the PR's browser CI
expect `Attestation` but receive `Protocol`. Admission challenge nonces remain.

## What these PRs provide

- #70: measured Nitro embedding extraction, a sandboxed real worker, encrypted
  transport, host admission tickets, and native/browser attestation verification.
- #604: WalletKit's `extractSelfieEmbedding(configJson, imageBytes, admissionPath)`
  wrapper around that verified TEE client.
- Verification covers enclave measurements, channel binding and worker identity.
  Neither PR generates or verifies AMPC enrollment shares, assembles a PCP, or
  issues a credential. Neither introduces an Oxide dependency for those jobs.

The current Oxide crate has native biometric-engine/OpenCV dependencies. Reusing
its narrow portable sharing/PCP primitives is a separate integration task; importing
the entire crate into browser WalletKit is not a drop-in replacement for the TEE
client. Share generation inside the TEE belongs after accepted inference, before
the result crosses back to the client.

## Product wiring

`/selfie-demo` captures one JPEG only on an explicit button click. The existing
WalletKit worker calls `extractSelfieEmbedding` with the trusted policy returned
by `GET /api/selfie-enclave` and same-origin `POST /api/selfie-admission` callback.
No attestation check is disabled. Cancellation/timeout terminates the worker
and locks the account because #604 has no per-call cancellation API.

The local-only backend checks the configured loopback origin, audience, exact
32-byte challenge, and private key file permissions. It signs the Rust admission
message with P256/SHA-256 and a 30-second expiry. This ticket authorizes a host
connection; it is separate from the proposed signup-service integrity JWT.

Successful extraction displays type/version/backend, drops the vector reference,
and shows an explicitly mocked `issuer_assurance = 2` preview. No real score,
PCP, match result, credential, or user-presence assertion is invented. The old
synthetic issuance helper remains separate from this extraction demo.

## Staging rollout

The existing service is healthy but runs the pre-#604 assignment protocol.
[tee-apps #16](https://github.com/worldcoin/tee-apps/pull/16) prepares the matching
`04481c5` build. It leaves live images, measurements, origins and keys unchanged.
It separates build source from deployed source so preparation does not require
turning off the existing service. Repository review is required before merge.

After review/merge:

1. Dispatch `.github/workflows/selfie-enrollment.yml` on main with `publish=true`.
2. Download that run's `selfie-enrollment-stage-release` artifact. Use the existing
   admission public key if its private key is available. Otherwise coordinate
   replacement with the existing staging signer owner.
3. Run `scripts/prepare-selfie-enrollment.py release.json
--admission-public-key-file /private/path/admission-public.hex` in tee-apps.
   Review/merge the generated paired release, measurements, values and manifests.
   Promotion retains harness port 8765 and adds localhost/127.0.0.1 port 3100.
4. After Argo finishes deploying, point the local app at that reviewed policy and
   the matching private key using `.env.local`:

```sh
TEE_ENROLLMENT_CONFIG_FILE=/absolute/path/to/tee-apps/releases/selfie-enrollment/client-stage.json
TEE_ADMISSION_KEY_FILE=/private/path/admission-private.hex
LOCAL_TEE_ORIGIN=http://localhost:3100
```

`bun run dev` enables the loopback test signer. Production disables it. Never put
private keys in `VITE_*` variables, source control, or browser storage. The existing
local bearer token and `VITE_TEE_BASE_URL` are not used by this new demo.

A candidate key pair was generated outside the repositories at
`~/.config/web-authenticator-selfie-staging/`; it is **not trusted by staging**.
The helper `bun scripts/create-selfie-admission-key.ts /new/private/directory`
creates another pair without overwriting an existing directory. Only the public
key can be copied into deployment values. Rotating it invalidates the old signer.

Real Nitro extraction and the wrong-PCR, wrong-worker, expired-ticket and
cancellation live checks remain pending deployment. No image has been uploaded
as part of this integration. Downstream AMPC sharing, PCP construction and real
credential issuance remain separate work.

## Validation

- Both source combinations merge cleanly.
- Existing local worker `/ready`: HTTP 200.
- WalletKit fixture formatting and `git diff --check`: passed.
- Upstream #604 browser CI at this revision: 18 passed, one stale-fixture failure.
- With the local fixture correction: all 19 browser tests passed in Chrome on
  port 14173. Consumer and fixture TypeScript checks also passed. These include
  mocked enrollment rejection tests, not live Nitro extraction.
- Web-authenticator with the installed candidate: typecheck, lint, Vite build
  and all 62 tests passed. Admission tests verify signatures, altered challenges,
  origin restrictions, malformed/oversized input, missing configuration and key permissions.
- tee-apps: four release-policy tests and source/activation checks passed. Full
  local Helm rendering was blocked by network access to the private chart server;
  CI must complete rendering and the measured enclave build.
- Candidate package built and packed successfully. Rust/WASM generation and
  optimization ran in the native ARM Nix Docker devshell; TypeScript and esbuild
  bundling completed on macOS after installing the host-platform JS dependencies.
- The prescribed Linux/amd64 Nix Docker build failed at `rustc -vV` with a QEMU
  segmentation fault, before project compilation. The ARM fallback completed
  WASM generation, but bundling initially reused the amd64 esbuild binary and
  crashed; native macOS bundling resolved that environment mismatch.
