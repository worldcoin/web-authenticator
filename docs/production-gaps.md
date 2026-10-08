# Demo → production gaps

## Validated milestone

The user reported completing **synthetic selfie enrollment → staging credential
issuance → encrypted browser storage → IDKit selfie request → proof generation →
successful staging contract verification** on October 1, 2026. This is user-run
end-to-end validation, not an agent-run functional test or a security assessment.

The passkey PRF derivation, WalletKit authenticator, encrypted credential vault,
AMPC share generation/sealing, staging issuer signature, and credential proof are
real. The face embedding is synthetic. Share creation is **not** simulated: the
helper uses the AMPC library and seals shares to staging party public keys.

## 0 — Directly missing relative to the mobile authenticator flow

Comparison baseline is the reviewed iOS implementation, not a claim that every
Android path was checked. These are mobile-parity gaps in the authenticator or
its end-to-end issuer/RP integration; ownership is identified separately.

| Gap                                                   | Current demo → mobile-parity work                                                                                                                                                                                                        | Owner                                     |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| Real enrollment biometrics                            | Synthetic embedding → real capture, quality checks, PAD/liveness and model output.                                                                                                                                                       | Biometric SDK + authenticator             |
| Enrollment integrity and data binding                 | Staging exception, synthetic associated-data hash and omitted attested share hashes → authenticated capture/model/share/PCP binding. Web needs an issuer-approved mechanism; native App Attest is not directly available to a website.   | Integrity/issuer services + authenticator |
| PCP creation, custody and recovery                    | Credential vault only → complete attested package, encrypted PCP persistence/backup, recovery and its deletion/update lifecycle.                                                                                                         | Oxide/PCP SDK + authenticator             |
| Local enrollment identity custody                     | Helper stores a separate enrollment identity seed on the localhost server → custody on the intended user-device boundary. Having a separate face/enrollment identity is not itself a mobile-parity gap; its current custody location is. | Enrollment SDK + authenticator            |
| Live presence when sharing                            | `require_user_presence: false`; presence-required requests blocked → actual selfie/presence verification bound to the request. Passkey unlock does not substitute for it.                                                                | Biometric SDK + authenticator             |
| Proof-response integrity and trusted disclosed claims | Actual score attached, but no mobile-style response integrity bundle → bind the disclosed score and any presence result to the proof/request through the accepted integrity protocol.                                                    | Authenticator + integrity service         |
| Equivalent RP acceptance policy                       | Direct contract verification only → Developer Portal verify or an approved equivalent that enforces required integrity/claims/presence policy. This is an **RP-side integration gap**, not code the mobile authenticator itself owns.    | RP + verifier                             |

## 1 — Missing, but not immediately necessary for the next staging milestone

These are follow-up work, design decisions, or items removed from the immediate
mobile-parity gap list. Completed items are explicitly marked. "Not immediately necessary" does **not** mean optional
before exposing a production system to real users/data.

| Work                                                 | Why it is in category 1                                                                                                                                                                                                                                                   | Owner                              |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| `proveCredentialSub` in enrollment                   | Current iOS exposes it for developer tooling but does not send it in live selfie enrollment. Confirm issuer protocol/enforcement before adding it as a requirement.                                                                                                       | WalletKit + issuer + authenticator |
| RP nullifier replay protection — **implemented**     | RP-owned, not an authenticator gap. The Worker now atomically consumes nullifiers across fresh requests for the same staging RP/action/credential schema, in addition to single-use nonces. Kept here to track the item removed from the missing-parity list.             | RP Worker                          |
| Supported browser SDK and removing the native helper | The experimental WASM package already performs the validated wallet/proof flow. Upstream worker APIs, supported releases and browser-compatible enrollment primitives are packaging/runtime work; the custody boundary remains category 0.                                | WalletKit + enrollment SDK         |
| Expanded session/account UX                          | Explicit sign-out/lock, idle policy, authenticator removal, account discovery and multi-tab handling can follow the current single-browser test. Do not assert a particular mobile idle/session policy without tracing it. PCP custody/recovery is separately category 0. | Authenticator + WalletKit          |
| Production passkey domain and web hardening          | Localhost works for staging. Production RP-ID/origin selection, provider compatibility, script/dependency policy and XSS defenses must be resolved before production rollout.                                                                                             | Web authenticator                  |
| Production service operations and privacy            | Replace local-process assumptions with appropriate backend authorization, durable operation handling, abuse controls, restricted debug surfaces, privacy-aware telemetry, retention and incident handling before public use.                                              | Each deployed service              |
| RP business-action completion                        | Nonce replay protection and atomic persistent nullifier consumption across fresh requests are now implemented. Coupling verification to a real product action, idempotent fulfillment and retention policy is subsequent RP application work.                             | RP application                     |

Not missing: real AMPC share generation/sealing, browser credential encryption,
issuer-signature checking, credential proof generation/contract verification, and
RP nullifier reuse protection. The RP ledger covers new verifications only; old
demo successes cannot be backfilled because their nullifiers were not retained.

## Important distinctions

Latest iOS `main` checked at `94fed50fe740123065f8b9fd6e24dea827381347`
(October 1, 2026) exposes `proveCredentialSub` in AuthenticatorClient and calls it
from the developer ownership-proof action. Its live selfie issuer currently calls
`enrollFacePcpWithIntegritySigner` with `faceIdentity` and `sub`, without supplying
a v4 ownership proof. Therefore ownership proof is category 1: a protocol/design integration
question, not a claim that the current iOS selfie flow already sends that proof. Determine issuer enforcement requirements before calling it mandatory.

- A successful proof establishes the contract's credential/account/request
  conditions. It does not turn synthetic input into verified human biometrics.
- A zero score is the issuer-returned claim, not a locally fabricated score. This
  demo still does not authenticate that disclosed value for RP policy decisions.
- Local PRF evaluation is a vault-unlock ceremony, not a backend login assertion.
  If a production backend authenticates sessions using WebAuthn, that requires its
  own server-issued challenges and assertion validation. Such a backend login is
  not automatically necessary for a purely local vault unlock.
- Clearing browser storage, deleting a password-manager passkey, removing an
  on-chain authenticator, and deleting issuer-side biometric enrollment are
  separate operations.
- The current proof-response path lacks the native app integrity bundle accepted
  by Developer Portal. A production web integrity policy is an integration/design
  requirement, not merely a missing hardcoded field.

Implementation references: [selfie enrollment](selfie-enrollment.md),
[enrollment adapter](../src/lib/selfie-issuer-server.ts), and
[WalletKit wrapper patch](../walletkit-patches/walletkit-web@0.22.1.patch).

The RP verifier and replay ledger described above belong to the separate local
playground under ignored `demo/`; their implementation is not included in this branch.
