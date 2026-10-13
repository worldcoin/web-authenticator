# Browser authenticator

See the [root README](../../README.md) for setup, external RP integration and limits.

- `src/App.tsx`: request review, wallet unlock, enrollment and explicit proof approval.
- `src/wallet/session.ts`: PR #9 passkey derivation and encrypted WalletKit vault.
- `src/wallet/registration.ts`: register once or reopen an existing staging account.
- `src/lib/requests`: bridge encryption, request validation, credential routing and proof generation.
- `src/lib/selfie-issuance.ts`: resumable staging issuance and vault storage.
- `src/server`: static assets, RP registry lookup and localhost-only staging issuer.
- `src/components/CameraPreview.tsx`: local camera guidance, separate from synthetic issuance.
