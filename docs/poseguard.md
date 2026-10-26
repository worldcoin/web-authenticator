# PoseGuard request flow

This slice adds server-issued challenges and API verification of the local `codex/poseguard-demo` movement sequence to valid `/verify` requests. It is stacked on PR #15 and does not add a public demo route. The preview still does not issue a credential or deliver a proof.

## Flow

1. The browser decrypts and validates the IDKit request, explains the measurement upload, and waits for Start.
2. `POST /api/poseguard/challenge` independently validates the staging RP signature, registry status, signed expiry and supported Selfie requirements. It returns a random 64-bit seed, four generated targets, a run ID and a 256-bit bearer capability.
3. MediaPipe runs in a browser worker. Failed GPU startup or pre-challenge inference falls back to CPU; an active challenge never changes engines. The UI guides framing, head turns, holds and eye fixation. A single frontal image stays in memory until the attempt ends.
4. `POST /api/poseguard/verify` submits at most 1,000 observations. The server claims the challenge once, checks elapsed time, reconstructs six eye points and replays the unchanged algorithm with its own seed. It accepts no client verdict or target definitions.
5. The UI completes only when both the guide and API report `passed`. Failed, inconclusive, unavailable and malformed responses leave an actionable retry. Retrying creates a new challenge. Hiding or leaving the page stops capture and cancels the attempt; cancellation also runs for late creation responses.

## Demo parity

The shared core is FacePAD algorithm 8 at `e5d90133c0d24a89087f97594a8a00dcc8bdd318`. Targets, head-turn/hold thresholds and gaze-fit thresholds are unchanged. Browser integration uses the same 720px oval crop, 20 observations/second maximum, 15-second framing budget and 45-second movement budget as the local demo. Model version and SHA-256 are pinned during preparation and checked again in the worker. See [source provenance](../web/lib/poseguard/PROVENANCE.md).

Framing quality remains a browser guidance check. Server verification covers the target sequence, timing gaps and gaze decision. Synthetic fixtures exercise parity and failure paths; they do not establish real-device accuracy, spoof resistance or parity with the historical Android LightGuard debug report / production POSE_GUARD configuration.

## API and data limits

- Same-origin JSON requires a matching Origin and rejects conflicting Fetch Metadata when supplied. No CORS permission is granted to cross-origin callers.
- Challenges expire after at most 120 seconds and never outlive the signed request. The run store holds at most 64 active challenges, one per signed request binding; four requests may read bodies or consult the RP registry concurrently.
- Verification bodies are limited to 512 KiB, strictly bounded frame counts and values, increasing relative timestamps, and a 45-second trace. Uploads have a five-second read deadline. The consent endpoint retains its own 1 KiB limit.
- Evidence contains head angles, presence, dimensions and six eye x/y pairs. It is processed in memory, is not logged or persisted, and never goes to PostHog. There are no photos, embeddings, full face meshes or identity commitments in this endpoint.
- A matching capability is required to consume or cancel a challenge. A completed attempt cannot be replayed. A lost verification response requires a fresh attempt. Expiry releases abandoned challenges even when cancellation cannot reach the server.

## Before beta deployment

**This API verifies consistency of client-supplied measurements, not trusted biometric liveness.** Anyone controlling the browser can synthesize a passing trace after learning the challenge. No issuer may use this verdict alone to authorize a credential. Trusted image/challenge binding and issuer enforcement remain separate work.

The current run store belongs to one Bun process. A process restart invalidates its attempts. PR #16's Cloudflare Worker needs explicit routes and shared atomic challenge storage (for example, a Durable Object) before this flow can run reliably across worker instances. In-memory maps in Worker isolates are insufficient for single-use verification. Deployment wiring remains last.

Still outside this slice:

- The local demo's enrollment extraction, temporary wallet, staging credential issuance and proof-delivery changes.
- Adapting PR #17's funnel to challenge creation, each movement, submission and API outcomes, with existing mobile PostHog consent/configuration rules.
- A separately designed debug-report transport, retention policy and schema. This endpoint is transient verification input, not an Android-compatible stored debug report.
- Representative device/browser and human capture validation, including low frame rates, glasses, lighting and accessibility.

Review screenshots belong in local review artifacts or PR attachments, never `docs/review` on the main branch.
