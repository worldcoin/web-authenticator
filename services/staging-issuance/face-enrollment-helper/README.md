# Local staging face enrollment helper

This Rust executable supports the localhost-only selfie issuance route. It creates
and encrypts AMPC shares from synthetic input, obtains enrollment authentication
through Oxide, and verifies returned credential signatures and subject binding.
It is a server-side process, not a browser/WASM module or a face capture engine.

Build from the repository root with `bun run build:selfie-helper`. The crate and
binary retain the name `staging-face-crypto`; the server invokes
`target/debug/staging-face-crypto` inside this directory. Build artifacts are ignored.

Dependencies are pinned in `Cargo.toml` and `Cargo.lock`. The build command supplies
`build-config.toml` for Oxide's native dependency settings. Requests are bounded JSON
on stdin; successful responses are JSON on stdout, with failures on stderr and a
nonzero exit status. Never log the input or output payloads: they can contain
identity material and enrollment authentication headers.
