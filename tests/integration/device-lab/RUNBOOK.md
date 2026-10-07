# Physical iPhone evidence runbook

## Boundary

This runbook is for physical iPhones only. Desktop WebKit, device emulation, and
synthetic streams cannot fill a physical cell. Use staging accounts and the
staging simulator. Do not capture or commit a participant's face, camera stream,
passkey data, credential payload, signature, private key, bearer token, or raw
trace. Persist only a sanitized observation that validates
`observation.schema.json`.

## Prerequisites

1. Record the exact 40-character product revision and deployed staging build.
2. Record device model, iOS version/build, Safari or Chrome version/build,
   locale/region, tab context, provider, initial camera permission, battery, and
   thermal state.
3. Confirm the operator consents to the test and that no screen/video recording
   contains a real person or protected provider UI.
4. Use a network inspector that records operation names, status, sizes, and
   timing only. Redact bodies and headers that can contain handles.
5. Start with browser storage empty. Do not export browser profiles.

## Core cell procedure

1. Open the exact staging URL in the recorded browser/context and confirm the
   visible `Staging demo` label.
2. For iOS 15–17, confirm only update-required appears. Confirm authenticator,
   camera, session, and simulator operation counts are all zero, then stop.
3. For iOS 18/current normal tabs, record whether the candidate route appears
   and which provider is offered. A provider observation is not proof of PRF,
   protected presence, or World ID key creation.
4. Complete the protected gesture only when the cell explicitly requires it.
   Record start/end timing without recording provider content.
5. Confirm camera is not requested before the authenticator-ready gate. Exercise
   allow, deny, and revoke as separate cells.
6. On allow, record actual track settings, MIME if any, time to first preview,
   descriptor count/declared bytes, and whether every track stops at exit.
7. Confirm the browser request contains only one or two ordered metadata
   descriptors (or the named allowlisted synthetic fixture). Do not retain body
   contents.
8. Complete the staging scenario and record only the visible state and stable
   reason code. Never copy a receipt or credential body.
9. Verify return/cancel behavior, empty URL query/fragment, empty browser
   persistence, and no free-text upstream error.
10. Validate the observation against the schema and separately review it for
    accidental personal or secret data before committing it.

## Separate manual cells

- Context: normal tab, private tab, installed PWA, in-app browser/handoff, frame.
- Provider: Apple Passwords, Google Password Manager where actually offered,
  supported third party, unavailable/unknown.
- Camera: allow, deny, revoke during preview, no camera, busy/restricted camera.
- Interruption: app switch, lock, call, visibility loss, track end, offline and
  restore, timeout, repeated attempt.
- Accessibility: VoiceOver reading/order/actions, 200% text, safe areas, browser
  chrome, landscape/orientation invalidation, reduced motion.
- Reliability: at least ten repeated attempts per chosen current-production
  device; measure times, cleanup, memory if observable, battery delta, and
  thermal state. Do not set a product budget from this baseline.

## Failure and stop rules

Stop a cell if it needs product-code changes, unconsented biometric material,
production credentials, a real TEE/issuer/proof, an unavailable protected
gesture/provider, or evidence that would need to be mislabeled. Mark the exact
cell `blocked`; never replace it with emulation.
