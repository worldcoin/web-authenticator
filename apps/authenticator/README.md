# Browser app

See the [root README](../../README.md) for setup, current behavior and limitations.

`src/wallet/session.ts` owns passkey PRF evaluation, key derivation and the real
WalletKit worker/vault. `src/App.tsx` prevents capture progression until that vault
opens successfully. The session controller and `src/server` retain the migrated
metadata-only simulator; they do not issue real credentials or attest biometrics.
