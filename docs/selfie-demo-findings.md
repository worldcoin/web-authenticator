# Selfie demo: findings and next steps

The next milestone is a real camera capture returning a successful embedding
from the staging enclave. Passkeys and credential issuance are separate work.

## Applied on PR #15's branch

- `568f686`: capture the previewed crop, request 1280×720 video, and apply
  the face engine's framing thresholds to the image being sent.
- `d5cd69e`: fetch the trusted enclave policy, use WalletKit for attested
  extraction, and wait for acceptance before showing completion. Rejections,
  transport failures and timeouts offer a retry.
- The two commits above are now applied as `b01dac1` and `1f8f355` on
  `kartike/redirect-root-remove-landing`, after #15's `12f4a34`.
- #15's root redirect, removed landing page, and `/recover` entry are preserved.
  Requests still enter through `/verify`.

## Where it is preserved

- `test/framing-enclave-e2e` still points to `d5cd69e` and was not changed.
- `integration/selfie-embedding-demo` combines that work with PR #15's
  `b871415` snapshot locally.
  Only the overlapping flow props needed manual conflict resolution.
- The current checkout uses #15's branch with capture/extraction added locally.
  Nothing has been pushed; the remote PR has not been changed.
- `kartike/selfie-tee-extraction` preserves the separate higher-resolution
  capture experiments and opt-in crop/resize diagnostic sweep. Those experiments
  have not been brought into the combined branch.

## What has been checked

On #15's branch with capture/extraction: 140 tests and 10 targeted Chromium/WebKit
browser checks passed. Lint, typecheck, the web/API production build and
`git diff --check` passed. Tests exercise simulated acceptance; this session has
not demonstrated a successful live embedding extraction.

## Live test

1. The dev server was started at `http://localhost:4173` with
   `SELFIE_ENROLLMENT_POLICY_FILE` pointing to the staging policy. The policy
   endpoint reports `enabled: true`; readiness, `/verify`, `/recover` and the
   camera model return 200.
2. Use a fresh real RP request pointing to this origin's `/verify` and a real
   camera. In the browser console, verify
   `selfie_extraction_succeeded` with a nonzero encoded length. If rejected,
   distinguish a quality verdict from attestation, transport or timeout failure
   before changing framing. Use the preserved diagnostic sweep only if needed.

The app sends an encrypted JPEG to the attested enclave and receives an embedding.
It returns only metadata to the flow and does not forward the embedding to an
issuer or RP, issue a credential, or deliver a proof response.

WalletKit currently comes from a sibling directory's local tarball. It works
for this local setup; CI or another machine needs that artifact or a published
compatible package. Do not change wallet identity or add issuance to establish
the embedding milestone.
