# Demo and experimental code

`tee-demo/` preserves the earlier localhost demo, including the local WalletKit
#604 adapter and TEE routes. It is not the default application. Its source and
local-package dependency are retained for the next TEE integration step.
The published WalletKit `0.27.1` used by the product does not expose this demo's
`extractSelfieEmbedding` API, so the demo cannot use that release unchanged.

The canonical UI and registration flow now live in `web`.
Use the repository-root commands for that app. The pre-convergence checkpoint is
`ae0b178`; no legacy passkey state or local secrets were deleted.

## Boundary

Everything under this directory is **demo/experimental**, excluded from root
workspaces and the product build. It is still tracked source and would be included
in a merge unless explicitly removed. Keeping it here does not mark it ready for
production or make the entire branch production-ready.

`tee-demo` preserves the synthetic enrollment adapter, native helper, placeholder
integrity headers and simulated flows. The duplicate adapter/helper formerly in
`web` and `services/staging-issuance` have been removed. The Rust
helper source and lockfile were identical to the preserved copy.

To work on the experiment, explicitly change into `experiments/tee-demo` and use
its own README/package scripts. Its local WalletKit tarball dependency must be
available; root installation does not prepare it. Run its helper build command
from that directory if needed. No live enrollment was run during this separation.

Promote individual implementations only after replacing test inputs and evidence,
adding regression checks and documenting real integration validation. Product code
must not import this directory. Do not copy the synthetic adapter back as a
production enrollment implementation.
