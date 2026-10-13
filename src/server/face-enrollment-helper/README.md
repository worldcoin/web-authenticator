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

OpenCV is a transitive dependency of Oxide's Face Engine dependency, even though
this helper does not run face inference. The pinned dependency downloads its native
assets during the build. If this directory is moved, Ignition's cached metadata may
still reference its old absolute path. From the repository root, clear that package's
cache and rebuild:

```sh
cargo clean --manifest-path src/server/face-enrollment-helper/Cargo.toml -p ignition
bun run build:selfie-helper
```
