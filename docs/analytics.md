# Web authenticator analytics

The browser uses the PostHog web SDK and sends JSON directly to the existing
mobile fuzzy analytics backend. There is no authenticator `/api/analytics` route,
custom queue, new ingestion service, or warehouse/dashboard change in this PR.

## Three measures

| Measure | Tracking | Display |
| --- | --- | --- |
| Selfie capture completion | `selfie_capture_completed` / `selfie_capture_started`, joined by `session_id` and `n_attempts`. Completion means a JPEG exists in memory. | Percentage, completed/started counts and failure reasons, grouped by Day/Week/Month. |
| Signup attempts | Pending integration with real `PUT /api/v1/identity` enrollment operations. Exclude GET polls, reauthentication and duplicate submissions; distinguish accepted requests from confirmed credential issuance. | Attempts with success/failure/pending outcomes. Show N/A until connected. |
| Proofs delivered | `world_id_proof_sharing_success` after bridge upload succeeds; rate denominator is sessions with `world_id_proof_generation_completed`. | Delivered count and percentage, with generation/delivery failures. Show N/A until the public flow calls these functions. |

These are consented attempts/sessions, not unique people or all visitors. Group
attempts by their start period and restrict numerators to observed denominators.
A zero denominator gives a null rate, never 0%. Current main's public flow stops
at local capture: it does not verify a face, enroll an identity, issue a credential,
or share a proof. The existing proof functions are instrumented for future callers.
Bridge acceptance does not establish that the relying party consumed the response.

## Native naming and ownership

`analyticsService.track` wraps SDK configuration and consent. Request timing and
milestones live in `SelfieCheckRequestTelemetry`, following the iOS ownership
pattern. Local variables use `sessionID` and `nAttempts`; wire properties use
`session_id`, `n_attempts`, `duration` (milliseconds), `reason`, and `purpose`.

- `consentShown` records `$screen` with `$screen_name=selfie_check_data_controls`;
  `consentAccepted` records `selfie_check_data_controls_continued`.
- Capture emits `selfie_capture_started`, then `selfie_capture_completed` or
  `selfie_capture_failed`. Standalone camera previews are excluded.
- Proof generation emits `world_id_proof_generation_started`, then
  `world_id_proof_generation_completed` or `world_id_proof_generation_failed`.
- Delivery emits `world_id_proof_sharing_started`, then
  `world_id_proof_sharing_success` or `world_id_proof_sharing_failed`.
- Invalid, unsupported or expired requests can record a sharing failure without
  a delivery attempt. They must not be counted as attempted uploads.

Capture deliberately has distinct event names: a local JPEG must not emit the
native verified `selfie_check_succeeded` event. All events have
`source=web_authenticator` and intent `purpose=faceEnrollment`. No
`partner_analytics_*` events are emitted because this flow has no validated partner
attribution. Naming matches native concepts without claiming native outcomes.

## Existing backend compatibility

Use the existing fuzzy ingestion in
[app-backend-rest](https://github.com/worldcoin/app-backend-rest/blob/main/src/api-router/constructs/envoy/templates/routes-public.template.yaml).
It exposes POST/OPTIONS `/capture` and `/batch`, with browser CORS support. Its
catch-all returns 200 without ingestion, so the web SDK's default `/e/` path would
silently lose events. `createFuzzyConfiguration` rewrites the SDK request path to
`/batch`, matching the SDK's JSON batch envelope even for immediate captures.
Compression and beacon transport are disabled; requests use JSON fetch.

The existing
[consumer](https://github.com/worldcoin/app-backend-rest/blob/main/src/proxy-posthog/constructs/functions/schedule-event/handler/process-sqs-record.ts)
requires `api_key` in the JSON body; the SDK's normal `properties.token` alone is
insufficient for a raw single event. The SDK supplies the batch envelope's
`api_key` from `properties.token`, which the filter preserves. The `before_send`
filter rebuilds the other event properties after SDK enrichment. The SDK owns
timeouts, transport and retries.
The backend may rewrite UUIDs/timestamps: do not promise exactly-once delivery or
use upstream event UUIDs as a durable deduplication key. Aggregate capture attempts
by `(session_id, n_attempts)` and proof delivery by session.

## Consent and data limits

The established application consent preference remains authoritative. The SDK is
loaded lazily only after consent and valid configuration. Earlier operations are
not replayed. Revocation stops new captures and suppresses late operation callbacks,
even when saving the preference fails. Already accepted SDK requests can finish or
retry; revocation does not recall events already handed to transport. Storage
changes and returning to a visible tab recheck the preference.

Each request and revocation/regrant rotates the random in-memory `sessionID`.
Analytics identity persistence, person profiles, autocapture, page views, page
leave, replay, exception capture, performance capture and feature flags are disabled.
The SDK maintains its own consent flag; it is not an account identifier.

`before_send` only permits enumerated events, random UUID sessions, bounded attempt
counts/durations and fixed failure categories. It removes SDK URL/query/referrer,
account and device properties. No photos, embeddings, face scores, proof payloads,
RP identifiers or raw errors are sent. GeoIP/person processing is disabled. The
existing first-party backend still receives the browser's network connection and
may process peer IP internally. SDK/ad-blocker/offline failures can leave gaps;
analytics failure never replaces the capture or proof result.

## Configuration and release

Supply build-time browser variables `VITE_POSTHOG_API_KEY` (the approved publishable
project token, not a personal API key) and `VITE_POSTHOG_FUZZY_PROXY_URL`:

| Environment | URL |
| --- | --- |
| Staging | `https://app-backend.worldcoin.dev/public/v1/posthog/fuzzy-capture` |
| Sandbox | `https://app-backend.sandbox.toolsforhumanity.com/public/v1/posthog/fuzzy-capture` |
| Production | `https://app-backend.toolsforhumanity.com/public/v1/posthog/fuzzy-capture` |

Both variables absent deliberately disables analytics. Partial/unapproved
configuration surfaces a safe operational warning without contacting an arbitrary
host. CSP allows only these existing fuzzy path prefixes. This PR configures no
token, deploys nothing and creates no dashboard.

Before enabling, check the backend event allowlist and verify a real consented
sequence through staging ingestion, including denial, retry behavior and bridge
failure. The automated transport check uses the real SDK with mocked fetch; live
ingestion has not been tested. Add explicit warehouse intake for the web event
families, then build the three internal measures. The existing portal partner
exports cannot consume these events unchanged: per-app charts require validated
partner attribution and a web surface dimension.

## Repository evidence reviewed November 3, 2026

- [iOS request telemetry](https://github.com/worldcoin/world-app-ios/blob/main/Sources/IDApp/Sources/SelfieCheck/Requests/Telemetry/SelfieCheckRequestTelemetry.swift)
  and [PostHog configuration](https://github.com/worldcoin/world-app-ios/blob/main/Sources/WorldAppCore/Sources/WLDPostHog/PostHogConfigurator.swift).
- [Vincent's Proof of Presence fact (#6457)](https://github.com/worldcoin/dbt-cloud/pull/6457)
  merged October 30 and selects native event families explicitly.
- [Signup identity handler](https://github.com/worldcoin/signup-service/blob/main/face/app-api/handlers/put_identity.go)
  distinguishes enrollment/reauth and returns 202 before asynchronous completion.
- [Portal exports](https://github.com/worldcoin/dbt-cloud/blob/main/models/consumers/dev_portal/selfie_check_metrics_daily.sql)
  use partner sessions and partner user attribution; they are not a generic web funnel.
