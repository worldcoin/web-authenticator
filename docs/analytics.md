# Web authenticator analytics

Web telemetry uses JSON events named `web_authenticator_step`. The browser sends
batches to `/api/analytics`; Bun and Cloudflare use the same validating handler to
forward them to the existing mobile PostHog fuzzy `/batch/` endpoint. There is no
browser SDK, automatic page capture, session replay, persistent analytics ID, or
new dependency.

For example, after a JPEG has been created in memory:

```json
{
  "uuid": "43d563dc-dc54-4afe-a2f6-0660a12e753d",
  "flow_id": "b3c4b7cf-57cc-4a9c-b5c3-f7e98bf68b03",
  "sequence": 3,
  "timestamp": "2026-11-03T12:00:00.000Z",
  "step": "selfie_capture",
  "status": "completed",
  "attempt": 1,
  "duration_ms": 2400
}
```

The server adds `surface=web_authenticator`, the destination's `environment`,
`analytics_version=1`, and anonymous PostHog settings. IDs are random, unrelated
to a wallet, credential, user account, or RP request. `step` and `status` are
properties of this event, not separate event names.

## Three measures

| Measure | Counting rule | Display |
| --- | --- | --- |
| Selfie capture completion | Distinct `(flow_id, attempt)` with `selfie_capture/completed` divided by attempts with `selfie_capture/started`. | Percentage and completed/started counts; Day/Week/Month trend; failure reasons. |
| Signup attempts | **Pending integration.** Count distinct real `PUT /api/v1/identity` enrollment operations, excluding GET polls, reauth and duplicate submissions. Track confirmed credential issuance independently of submission acceptance. | Enrollment attempts and success/failure/pending outcomes. Show N/A until connected. |
| Proofs delivered | Distinct flows with `proof_delivery/completed`; delivery rate uses flows with `proof_generation/completed` as its denominator. | Delivered count and percentage; generation/delivery failures. Show N/A when the public proof path is not connected. |

Deduplicate event UUIDs before aggregation. Restrict rate numerators to their
corresponding observed denominator; group attempts by their start period, keeping
pending attempts visible. A zero denominator gives a null rate, never 0%.
These are consented attempts/flows, not unique people or all visitors.

## Milestones implemented here

- `request/started`: a supported, validated `/verify` request is observed after
  consent. Invalid, unsupported and expired requests have fixed failure reasons.
- `selfie_capture`: starts before camera acquisition, completes only when the
  JPEG exists. Permission denial, timeout and cancellation cannot complete it.
  Standalone camera previews are excluded from the request funnel.
- `proof_generation`: completes after WalletKit returns a validated response.
- `proof_delivery`: completes only after the encrypted response upload succeeds.
  Bridge acceptance does not establish that the RP consumed the response.

Each operation emits `started` and at most one terminal `completed`, `failed`, or
`cancelled` event per attempt. Durations use a monotonic browser clock. Ordering
uses `sequence` because the fuzzy pipeline may alter timestamps.

Current main's public flow ends at local capture. Its success animation does not
emit verification, enrollment, issuance, or proof-sharing success. Proof hooks are
attached to the existing generation/delivery functions for when the public flow
calls them. This PR adds no synthetic issuance or PoseGuard integration.

## Consent and bounded delivery

Consent remains in localStorage as established by [#25](https://github.com/worldcoin/web-authenticator/pull/25).
Nothing is collected until `granted`; earlier operations are not replayed. Decline
immediately clears pending events and aborts sends, even if saving the preference
fails. Storage changes and returning to a visible tab recheck the preference.
Each new `/verify` visit rotates the flow ID; revocation/regrant also rotates it.

Each batch declares `X-Analytics-Consent: v1.granted`. The server requires that
declaration plus same-origin Fetch Metadata, Origin and JSON. This is a browser
assertion, not a server-verified record of localStorage or an authentication token.
The closed schema rejects all unrecognized fields. No photos, embeddings, face
scores, account/passkey/RP identifiers, proof payloads, URLs, raw errors, browser
user agent or client IP headers are forwarded. GeoIP and person processing are
disabled; the analytics service still sees the server's network connection.

The in-memory queue holds 128 events, sends up to 16 per batch, and drops events
after four failed sends with backoff and jitter. IDs and timestamps survive
retries. Page exit uses keepalive, prioritizing recent results. The server admits
four concurrent batches per handler, caps bodies at 16 KiB with a two-second read
deadline, and bounds forwarding to four seconds without server retries. Upstream
failures return 503 and safe operational warnings; raw failures are never logged.
Analytics failures do not block capture or proof work. Offline closure, crashes,
queue limits and consent refusal can leave gaps; delivery is best effort.

## Enable and display

Set server-only `POSTHOG_FUZZY_KEY` to the approved mobile project token and
`POSTHOG_FUZZY_HOST` to the matching environment:

| Environment | Host |
| --- | --- |
| Staging | `https://app-backend.worldcoin.dev/public/v1/posthog/fuzzy-capture` |
| Sandbox | `https://app-backend.sandbox.toolsforhumanity.com/public/v1/posthog/fuzzy-capture` |
| Production | `https://app-backend.toolsforhumanity.com/public/v1/posthog/fuzzy-capture` |

Bun reads process environment; Workers reads configured vars/secrets through
[`process.env`](https://developers.cloudflare.com/workers/runtime-apis/nodejs/process/#processenv)
under the existing compatibility configuration. Configure the token as a secret,
never a browser variable. Both absent deliberately disables forwarding (204);
partial/invalid configuration makes analytics return 503 without affecting other
routes. No configuration or deployment is performed by this PR.

Before enabling, verify a real consented sequence through staging ingestion,
including denial, retry deduplication and bridge failure. This has not been run.
Register `web_authenticator_step` and its properties in the warehouse intake;
build the three internal Metabase measures filtered by surface and environment.

The existing [portal exports](https://github.com/worldcoin/dbt-cloud/blob/main/models/consumers/dev_portal/selfie_check_metrics_daily.sql)
use partner sessions and anonymized partner user IDs and normalize OS to
iOS/Android/Unknown. These web events cannot populate those tables unchanged.
Per-app portal charts require validated partner attribution and an explicit web
surface dimension; this PR does not collect those identifiers or claim user counts.

## Native references checked November 3, 2026

- [iOS request telemetry](https://github.com/worldcoin/world-app-ios/blob/main/Sources/IDApp/Sources/SelfieCheck/Requests/Telemetry/SelfieCheckRequestTelemetry.swift)
  and [Android partner integration](https://github.com/worldcoin/wld-android/blob/main/docs/partner_integration.md)
  separate capture, issuance and actual response delivery.
- [Vincent's Proof of Presence fact (#6457)](https://github.com/worldcoin/dbt-cloud/pull/6457)
  merged October 30. It selects native event families; web events need explicit ingestion.
- [iOS enrollment events (#8896)](https://github.com/worldcoin/world-app-ios/pull/8896)
  remains open as of this review; do not present it as shipped instrumentation.
- [Signup identity handler](https://github.com/worldcoin/signup-service/blob/main/face/app-api/handlers/put_identity.go)
  distinguishes enrollment/reauth and returns 202 before asynchronous completion.
- [Zoom's HTTP transport](https://github.com/worldcoin/world-id-zoom/blob/main/packages/observability/src/partner-analytics-transport.ts)
  provides the existing direct-batch precedent. Web events stay separate from
  `partner_analytics_*` and native FaceAuth events.
