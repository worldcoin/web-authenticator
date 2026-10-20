# Synthetic staging Selfie helper

Restored from the original local demo. This server-side Rust helper creates and
encrypts synthetic AMPC shares, authenticates enrollment through Oxide, and
checks the returned Selfie credential signature and subject against the staging
issuer registry. It does not accept camera images or real biometric input.

Dependencies and native settings are pinned in `Cargo.toml`, `Cargo.lock`, and
`build-config.toml`. From the repository root:

```sh
cargo build --locked --config services/staging-issuance/face-enrollment-helper/build-config.toml --manifest-path services/staging-issuance/face-enrollment-helper/Cargo.toml
ENABLE_STAGING_ISSUERS=1 bun api/main.ts
```

The API uses `target/debug/staging-face-crypto` in this directory by default.
`STAGING_SELFIE_HELPER` can select another compiled executable. Missing or failed
helpers produce an actionable error; the API never silently simulates success.

Oxide transitively needs Face Engine/OpenCV assets. Its pinned build downloads
these assets. No Rust or native compilation is required to run the JavaScript
tests. The existing local executable was smoke-tested during restoration; the
helper was not rebuilt or used to submit a live enrollment.

Input and output use bounded JSON over stdin/stdout. Never log their payloads:
they contain enrollment identity material. The API stores private retry state
under `~/.local/state/web-authenticator/synthetic-selfie-issuance/`, with private
file permissions. The browser stores only the opaque resume capability. Keep
both to resume interrupted enrollment; an ambiguous submission is polled rather
than automatically resubmitted.
