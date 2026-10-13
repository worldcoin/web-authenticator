# Preserved TEE experiment

`tee-demo/` preserves the earlier localhost demo, including the local WalletKit
#604 adapter and TEE routes. It is not the default application. Its source and
local-package dependency are retained for the next TEE integration step.

The canonical UI and registration flow now live in `apps/authenticator`.
Use the repository-root commands for that app. The pre-convergence checkpoint is
`ae0b178`; no legacy passkey state or local secrets were deleted.
