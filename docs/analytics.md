# Authenticator analytics

The provider is **PostHog**, through the existing mobile **fuzzy-capture** pipeline. Browser events go to `/api/analytics`; the Bun server checks consent and validates the closed event schema before forwarding with `posthog-node`. No browser SDK, autocapture, replay, identity calls, feature flags or raw exception capture are enabled.

## Mobile references

Source reviewed on October 26, 2026:

- [Android PostHogAnalytics](https://github.com/worldcoin/wld-android/blob/0f5f08b22eb313cbe37cb60945d1b06d608264bd/common/src/main/java/com/worldcoin/common/analytics/service/PostHogAnalytics.kt): regular and fuzzy clients, anonymous property filtering, separate fuzzy queue, five-event/five-second flushing.
- [iOS PostHogConfigurator](https://github.com/worldcoin/world-app-ios/blob/main/Sources/WorldAppCore/Sources/WLDPostHog/PostHogConfigurator.swift): fuzzy host, separate storage namespace, no fuzzy lifecycle capture or feature-flag preloading.
- [iOS capture analytics](https://github.com/worldcoin/world-app-ios/blob/main/Sources/IDApp/Sources/SelfieCheck/SelfieCheckCaptureAnalytics.swift): regular events proceed immediately; partner attribution buffers at most 128 items without blocking capture.
- [iOS request telemetry](https://github.com/worldcoin/world-app-ios/blob/main/Sources/IDApp/Sources/SelfieCheck/Requests/Telemetry/SelfieCheckRequestTelemetry.swift): preserve attribution across retries, stable reasons, separate capture/issuance/delivery, flush after successful delivery and before redirect.
- Proposed enrollment fixes [iOS #8835](https://github.com/worldcoin/world-app-ios/pull/8835) and [Android #9452](https://github.com/worldcoin/wld-android/pull/9452) add regular fuzzy `selfie_check_succeeded` only after confirmed issuance, independently of partner attribution and proof delivery. **Both were open drafts when inspected**, not verified shipped behavior.
- [iOS #8141](https://github.com/worldcoin/world-app-ios/pull/8141) explains the move from raw error descriptions to stable failure categories.

The native code also has Statsig configuration and Datadog reliability metrics. Those are separate from the PostHog event transport used here. Partner analytics needs its own validated referral attribution; this change sends regular web events, never `partner_analytics_*` events.

## Event contract and milestones

All events use `web_authenticator_step`, with `surface=web_authenticator` and `analytics_version=1`. The web namespace avoids counting local browser capture as native FaceAuth verification. See [`analytics.ts`](../packages/contracts/src/analytics.ts) for the allowed properties and values.

| Step | Meaning of `completed` |
| --- | --- |
| `request` | A validated request is available after consent; not a successful verification. No request timing is inferred for work finished before consent. |
| `request_eligibility` | The request is supported by the current public flow. Unsupported requests emit `failed/unsupported`. |
| `camera` | Permission was granted and video playback started. |
| `face_guidance` | The detector first observed an aligned face. |
| `physical_challenge` | A fresh detector result confirmed the continuous hold. `challenge=hold_still`; progress animations cannot complete it. Hold resets remain part of this capture attempt. |
| `selfie_capture` | The JPEG exists in memory. This does **not** imply a credential or proof. |
| `save_decision` | The user saved access; `skipped` means Not now. |
| `save_access`, `authenticator_access` | Setup or explicit sign-in finished successfully. |
| `passkey_create`, `passkey_unlock`, `wallet_initialize` | The corresponding browser/WalletKit call resolved; later validation may still fail the overall operation. |
| `registration_submit`, `registration_poll`, `registration_initialize` | Submission acknowledgement, one status poll, or registered authenticator initialization. A successful poll alone is not finalized registration. |
| `credential_preparation` | Credential subject and blinding material were prepared. Neither is included in events. |
| `credential_storage` | A subject-matching credential was stored successfully. Importing/restoring it is not a new issuance. |
| `proof_generation` | WalletKit returned a validated proof response. |
| `proof_delivery` | The bridge accepted the encrypted response. This does not assert that the RP consumed it. |
| `request_dismissal`, `request_expiry` | The user closed the request, or its expiry was observed. |
| `request_cancellation` | The bridge accepted the rejection notification. |

Operations emit `started` and one of `completed`, `failed`, or `cancelled`, with a monotonic duration in milliseconds and a per-step attempt number. Request observations and user decisions use attempt `0`. Reasons come from a fixed vocabulary; error messages, causes and stacks are never sent.

### Current implementation boundary

`main` performs local selfie capture and an optional passkey save. It has **no issuer enrollment integration, server-issued physical challenges, or public-flow proof submission**. This PR instruments the existing hold-still challenge and the credential/proof library boundaries, which have automated fixture coverage but are not reached by public capture. It deliberately emits no `credential_issued` or `selfie_check_succeeded` event.

When the issuer integration lands, add a separate issuance step at the authoritative accepted-issuance callback, before proof generation, with a once-only outcome guard. Add returning-credential, resumed-enrollment, duplicate-callback and issuer-failure tests. Wire each server challenge's actual start/result through the same typed boundary; never derive success from indicator rendering. Do not reuse credential storage or the local completion animation as issuance evidence.

## Consent, privacy and delivery

- Nothing is queued or sent until the consent endpoint confirms `granted`. The current request state is observed after grant; earlier activity is not replayed.
- Declining stops collection immediately, clears the queue, aborts in-flight browser requests and invalidates old completion callbacks, even if saving the preference fails. The server rechecks the versioned HttpOnly consent cookie on every batch, including the existing GPC behavior. Requests already accepted upstream cannot be recalled.
- A random in-memory flow UUID is shared within one consented page visit and used as PostHog's distinct ID. It rotates on reload or regrant. No account/passkey/request IDs, photos, embeddings, face scores, proof contents, URLs, IP headers or user agents are forwarded from the browser. Person processing and GeoIP enrichment are disabled.
- Events retain UUID, `$insert_id`, timestamp and sequence across retries. Use `flow_id`, `step`, `attempt` and `sequence` to analyze order, since the fuzzy pipeline can change timestamps. Verify upstream deduplication in staging; exactly-once delivery is not claimed.
- The memory queue holds 128 events, sends at most 16 per request and drops a batch after four failed sends with bounded backoff. Hidden/closing pages use `fetch` keepalive and prioritize the newest outcomes. An online event prompts another send. Persistent browser storage and beacons are not used.
- The server limits bodies to 16 KiB and four concurrent batches. It requires same-origin JSON and rejects unknown properties. It acknowledges after SDK `flush()` succeeds; the pinned SDK's `captureImmediate()` swallows transport failures and is intentionally avoided. SDK retries/background timers are disabled so the browser owns retrying.
- Collection is best effort: crashes, offline closure, browser keepalive limits, queue saturation and consent refusal can leave gaps. Funnel denominators cover consented observed visits, not every visitor. Analytics availability never gates verification.

## Configuration and rollout

Set **server-only** `POSTHOG_FUZZY_KEY` to the existing mobile project token and `POSTHOG_FUZZY_HOST` to the matching environment's base URL:

| Environment | `POSTHOG_FUZZY_HOST` |
| --- | --- |
| Staging | `https://app-backend.worldcoin.dev/public/v1/posthog/fuzzy-capture` |
| Sandbox | `https://app-backend.sandbox.toolsforhumanity.com/public/v1/posthog/fuzzy-capture` |
| Production | `https://app-backend.toolsforhumanity.com/public/v1/posthog/fuzzy-capture` |

These hosts come from the [mobile app configuration](https://github.com/worldcoin/app-backend-app-config/blob/main/src/app-config/world-id/dev.ts) and [Android defaults](https://github.com/worldcoin/wld-android/blob/0f5f08b22eb313cbe37cb60945d1b06d608264bd/domain/src/main/java/com/worldcoin/domain/model/appMetadata/AppMetadata.kt). Use the token for the intended app/project/environment; don't copy credentials into source or use a personal API key. No deployment credentials are provisioned by this PR. With both variables absent, the endpoint discards events without forwarding; partial or unapproved configuration fails startup. Keep `POSTHOG_CAPTURE_MODE` unset or `v0` for the mobile `/batch/` endpoint. The browser CSP needs no new destination.

Before enabling production, configure staging, confirm that the fuzzy proxy and downstream warehouse allowlist accept `web_authenticator_step` and its properties, and inspect a consented capture/retry/cancellation sequence in PostHog. Verify stable IDs survive retries, person profiles are absent, and decline produces no outbound collection. Then exercise actual issuance/proof delivery once those integrations are connected. These live ingestion checks are still pending; automated tests use a mocked upstream and never send real analytics.

PostHog references: [Node SDK](https://posthog.com/docs/libraries/node), [anonymous event capture](https://posthog.com/docs/data/anonymous-vs-identified-events), [batch API](https://posthog.com/docs/api/capture).
