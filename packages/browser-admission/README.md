# Browser admission

This package implements the frozen iPhone browser-admission policy for the clean-start
simulator milestone. It is a decision layer only: it never starts a WebAuthn ceremony,
evaluates PRF, or opens a camera.

## Frozen behavior

| Device / context | Outcome | May enter sensitive flow |
|---|---|---:|
| iPhone, iOS 18+, Safari normal top-level tab | `eligible_candidate` | yes, subject to the real ceremony |
| iPhone, iOS 18+, Chrome normal top-level tab | `eligible_candidate` | yes, subject to the real ceremony |
| iPhone, iOS 15–17, Safari or Chrome | `ios_update_required` | no |
| Confirmed/probable in-app browser or WKWebView | `embedded_browser_handoff` | no |
| Any framed document | `context_not_top_level` | no |
| Insecure context | `insecure_context` | no |
| Invalid origin, RP ID, Permissions Policy, signed handle, callback, or session | `origin_or_rp_invalid` | no |
| Explicitly unavailable platform UV | `uv_unavailable` | no |
| Private, installed/PWA, or unknown context | `private_or_unknown_context` | no |
| Non-iPhone, unsupported iOS, or unsupported browser | `unsupported` | no |

Safari and Chrome stay separate evidence cells. User-agent classification is coarse and
never establishes PRF, camera, provider, engine, or security capability. Missing optional
probes remain `unknown`; a candidate becomes enrolled only after downstream ceremonies.

`createExternalBrowserHandoffV1` accepts only server-validated opaque transaction and
return-target handles. It creates a same-origin HTTPS continuation URL and marks the old
challenge for invalidation and reissue after navigation.

## Physical-device evidence gap

Synthetic tests cover policy transitions only. Target-device evidence is still required
for iOS 18/current Safari and Chrome, private tabs, installed/PWA contexts, representative
in-app browsers/WKWebViews, managed restrictions, provider variants, and regional or
alternative-engine builds.
