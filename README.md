# Web Authenticator

A browser authenticator for World ID. We will let users complete Selfie Check and respond to IDKit requests without downloading an app.

This repo contains the browser experience and the current staging demo. Real selfie enrollment through a TEE is still being built.

## Run locally

Use Bun to install dependencies and start the demo:

```sh
bun install --frozen-lockfile
bun run dev
```

Open [localhost:3100](http://localhost:3100). The development command starts Vite on port 3100 and the Bun API server on port 3101.

- `/`: authenticator setup, unlock and request entry.
- `/selfie-check`: Selfie Check request flow.
- `/selfie-demo`: camera preview and connection log.

Passkey setup requires a browser and provider that support the WebAuthn PRF extension. Camera access requires HTTPS or localhost.

The TEE target is configured in `.env.local`:

```dotenv
VITE_TEE_BASE_URL=http://localhost:8000
```

This only selects a target. It does not start a TEE, verify an enclave or enable uploads. The current `connect()` implementation reports that connection setup is unavailable.

## What works today

The demo has passkey-derived authenticator setup, WalletKit integration, an encrypted browser credential vault and a continuous camera preview.

The developer enrollment flow can issue a staging credential using synthetic face data. It does not use the camera image, create a real face PCP or verify TEE enrollment evidence.

We still need frame extraction, local capture guidance, a verified TEE connection, real enrollment and request-bound face matching.

## Responsibility Table

| Component                                                                                         | Responsibility                                                                                                                             |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| [web-authenticator](https://github.com/worldcoin/web-authenticator)                               | Consent, passkeys, camera, capture guidance, request handling and browser storage.                                                         |
| [walletkit](https://github.com/worldcoin/walletkit)                                               | Protocol registration, credential subjects, credential storage and proof generation. Browser TEE APIs still need integration.              |
| [di-migration-tee](https://github.com/worldcoin/di-migration-tee)                                 | Starting point for the biometrics TEE: admission API, host-to-enclave communication and attested keys. Selfie operations need to be added. |
| [signup-service](https://github.com/worldcoin/signup-service)                                     | Verify enrollment authorization and evidence, submit shares for uniqueness processing and request credential signing.                      |
| [signup-service-credential-signer](https://github.com/worldcoin/signup-service-credential-signer) | Sign the credential with the ordered claims supplied by the issuer.                                                                        |

We refer to the planned biometric service as `biometrics-tee`. The starting implementation is in `di-migration-tee`; its migration API is not a selfie enrollment API.

## Authenticator setup

```text
seed = HKDF-Expand(
  PRF("web.world.org/authenticator"),
  "web.world.org/v1/authenticator-secret", 32)

databaseKey = HKDF-Expand(
  PRF("web.world.org/storage"),
  "web.world.org/v1/storage-secret", 32)
```

## First enrollment — planned

1. Open an IDKit request or start enrollment from the authenticator. Show consent.
2. Prepare the schema-11 credential subject and blinding factor through WalletKit.
3. Start the camera and TEE session setup concurrently. Show local capture guidance while the connection is prepared.
4. Verify the enclave attestation and its public-key binding. Establish a session bound to the subject, challenge and expiry.
5. Capture the required images or video and encrypt them to the enclave.
6. The TEE runs the authoritative checks and generates the embedding, protected enrollment outputs and evidence binding those outputs to the enrollment.
7. The browser builds and encrypts the PCP from those outputs and the corresponding capture material. The exact output and PCP contracts still need implementation.
8. Submit the enrollment payload and TEE evidence to the Face issuer. The issuer verifies their binding and processes the uniqueness result.
9. Poll for the signed credential. Store it with its blinding factor and retain the associated encrypted PCP.
10. Complete the original IDKit request if enrollment started from one.

We intend to use the existing Face issuer endpoints:

- `PUT /api/v1/identity`: submit enrollment.
- `GET /api/v1/identity`: poll for its result and credential.

Keeping those routes still requires changes to accept and verify TEE evidence, and to authorize browser polling. The browser does not have a World App integrity token.

## Returning verification — planned

We will validate the incoming request, unlock the authenticator and check the stored credential's expiry and constraints.

When fresh user presence is required, we will capture a new selfie and ask the TEE to compare it with the credential-bound PCP reference. The match evidence must be bound to the current request. WalletKit and the RP verifier must carry and verify that binding before the response is accepted.

Having a stored credential alone does not prove fresh presence. If the credential or PCP is missing, we need reissuance or transfer from another authenticator.

## Browser and TEE checks

| Browser: capture feedback              | TEE: authoritative evaluation                                                     |
| -------------------------------------- | --------------------------------------------------------------------------------- |
| TFH face detection and QA models.      | The complete configured face-engine enrollment or verification pipeline.          |
| Lightweight glasses detector.          | Full required occlusion and image-quality checks, including non-model validators. |
| Our own orchestration and guidance UI. | Configured spoof checks, embedding generation and matching when required.         |

A capture can pass browser guidance and still fail in the TEE. We will surface the rejection and let the user retake it.

An encrypted connection does not prove that an image came from a live camera. Liveness guarantees depend on the capture protocol and the checks actually performed. We must not claim mobile LightGuard parity for the web flow.

## PCP storage and reissuance

The browser builds the PCP. The TEE supplies the verified biometric outputs needed to build it.

We will store the PCP encrypted in browser storage. Its binding to the signed credential must survive storage and later verification. The browser PCP API and storage format are still to be implemented.

A passkey can recover a storage key; it cannot recreate deleted vault files. If browser storage is lost, the intended recovery paths are:

- Transfer the credential and PCP from another authenticator.
- Prove control of the same World ID, capture a fresh selfie and request reissuance with a new PCP.

Reissuance requires issuer support and face continuity checks. Creating a new identity is not a reliable recovery path: the existing face enrollment can still match during uniqueness processing.

## Issuance claims — proposed

The existing signed claims occupy indices 0–2:

| Index | Claim          |
| ----- | -------------- |
| 0     | Z-score.       |
| 1     | Match count.   |
| 2     | Database size. |

We will extend the credential with verified issuance information:

| Proposed index | Claim                    | Meaning                                                                                          |
| -------------- | ------------------------ | ------------------------------------------------------------------------------------------------ |
| 3              | `issuance_assurance`     | `0`: unknown; `1`: app; `2`: TEE; `3`: app and TEE.                                              |
| 4              | `model_security_profile` | Versioned identifier for the checks and configuration that ran. Profile IDs remain to be agreed. |

These additions need a compatible schema rollout. The issuer derives and persists the values from verified evidence; it must not accept assurance values supplied by the browser.

## Admission and runtime protection

The public ingress must admit and rate-limit enrollment attempts before allocating expensive TEE work. IP and User-Agent can support abuse controls; they are not proof of identity or camera authenticity. We do not plan to request browser geolocation.

Promon Shield for Web is a proposed runtime-protection layer. Its session validation would need enforcement at ingress. It does not replace enclave attestation, biometric checks or issuer verification.

Logs should record operation status, timings and bounded failure codes. Do not log images, embeddings, PCP contents, secrets or authorization tokens.

## Next implementation steps

1. **Browser frame sampling.** Keep the native preview smooth; process sampled frames in a worker with bounded memory and no backlog of stale guidance frames.
2. **TEE enrollment session.** Add subject/challenge binding, expiry, attested channel setup and a bounded encrypted-capture receiver.
3. **Encrypted frame-set experiment.** Send selected captures and verify an authenticated enclave acknowledgement.
4. **Encrypted WebRTC experiment.** Add signaling and media reception, with frame encryption that remains intact until enclave decryption.
5. **Real enrollment.** Run the full biometric checks, return enrollment outputs, build the PCP on the client and wire issuer verification and polling.
6. **Returning presence and recovery.** Add request-bound matching, credential reissuance and cross-authenticator transfer.

Compare the two transport experiments using time to first accepted capture, bytes uploaded, guidance latency, UI responsiveness and enclave processing cost.

## References

- [Selfie Check via Web Authenticator — source spec](https://app.notion.com/p/worldcoin/Selfie-Check-via-Web-Authenticator-cfd0a1d9d6de45d49241382a36645c6b)
- [Soam's handover](https://github.com/worldcoin/web-authenticator-experiments/blob/0bd61a20b23ff0a778553ac1788bd3aa3c7b9404/docs/web-authenticator-handover.md)
- [WalletKit](https://github.com/worldcoin/walletkit)
- [TEE starting implementation](https://github.com/worldcoin/di-migration-tee)
- [Face signup service](https://github.com/worldcoin/signup-service)
