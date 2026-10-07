# W09 deterministic evidence report

Product revision under test: `b7d3949099b175ae41e1a95f4f65ee3c2714d98b`

Evidence was integrated by Main through `ec55f231ddb027d7fd4d69b310b3b3e3bd76e4a8`.
The browser screenshot harness received its stable-paint guard at `7401092`.
The final scoped recovery re-review passed at `ec55f23`.

Final automated results at this product revision:

- Integration: 101 passed, 0 failed, 2,092 assertions.
- Browser: 10 passed, 0 failed across two separately named projects.
- Full clean-start: 362 passed, 0 failed, 5,139 assertions across 36 files.
- Typecheck: all client, server, test, and tool projects passed.
- ESLint: passed with zero warnings.
- Browser build: 299.96 kB JavaScript (87.06 kB gzip) and 5.76 kB CSS
  (1.96 kB gzip).
- Server build: 162.96 kB.
- Six targeted privacy/copy/isolation scans returned zero matches.

## Automated scope

- Bun contract/in-process integration: all 62 frozen UI states, every legal and
  illegal action, 19 explicit-cancel states, five lifecycle abort events,
  iOS 15–17 update-only classification, iOS 18+ Safari/Chrome candidate
  classification, rejected contexts, actual controller/server happy path,
  session/result bindings, replay negatives, nested receipt authentication,
  all 4 biometric x 3 issuance paths, HTTP strictness, and production isolation.
- Privacy: browser-visible responses, invalid-canary non-reflection, client
  persistence/API imports, server-module isolation, S1 import isolation,
  fixture types, safe simulator copy, and metadata-only request shape.
- Browser: actual production browser build and Bun server, separately executed as
  `desktop-chromium-synthetic` and `desktop-webkit-synthetic`; responsive
  320x568, 375x812, 390x844, 393x852, and 430x932 checks; enlarged-text,
  reduced-motion, focus, semantic, storage, URL, console, and network checks.
- Screenshot artifacts are synthetic/non-person. Playwright trace and video are
  disabled.

Browser tooling: Playwright 1.62.1, Chromium 151.0.7922.34, and desktop WebKit
26.5. The WebKit binary was installed through the pinned Playwright version; no
dependency or configuration changed.

## Defects found and closed

W09 found two product defects and stopped those paths instead of editing product:

1. `return_redirecting` exposed Cancel/lifecycle actions while retaining a stale
   terminal authoritative-session binding, causing the frozen transitions to
   return null. Main corrected this at `7d4b00ea63e00fd039067c44e3f2c48cdbd1c030`;
   all 19 cancel states and all five lifecycle events then passed.
2. Blocked admission outcomes were not announced as alerts in the built app.
   W01/Main corrected the explicit alert-state registry at
   `14dea2384fbc6bb63d0f8d0eef64232e43304d1e`; both browser projects then passed.
3. Retake reused the already-consumed capture idempotency key after the server
   issued a new nonce. W01/Main corrected key rotation at
   `b7d3949099b175ae41e1a95f4f65ee3c2714d98b`; W09 now drives two actual W06/W10
   submissions and proves the second uses a different key and is accepted.
4. An ambiguous submit transport failure had no authoritative status-recovery
   action. Main corrected the frozen recovery transition at
   `a311f683377f9d129d38a0d7804f4465ba3e194f`; W09 now proves a server-committed
   credential-ready result is recovered through status without resubmission.

No other product defect was reproduced by W09.

## Screenshot checksums

```text
8337244115300e1bb2206a5c411564ef6b16a0aced3c75195f71972d6b16499d  desktop-chromium-synthetic-admission-blocked.png
d4d5645e1be39eac464a1edccba043247b7e3c4e109b35142a163477a54c3e2d  desktop-chromium-synthetic-request-review-393x852.png
f44da597838657bb6d1598137aec75d54109a222950ba10eccbbffa976f9d855  desktop-chromium-synthetic-returned.png
3483e2a38d7c1b9fc6320342cd67a30f452a9d2c3011f4b499f6dcd9cc416fe4  desktop-webkit-synthetic-admission-blocked.png
146127a092ae75f3438e74f60677a21f86d95ad59e35145fac932d89859a2dcd  desktop-webkit-synthetic-request-review-393x852.png
36543aeca014c0f280d68d8a9175074b32105647b27180f3b43dbd3307abea15  desktop-webkit-synthetic-returned.png
```

## Evidence boundary

These results prove deterministic contracts and desktop rendering only. They do
not prove iOS Safari/Chrome behavior, Apple Passwords or GPM presentation, PRF,
protected user presence, camera provenance, physical camera cleanup, VoiceOver,
thermal behavior, biometric performance, TEE integration, real issuance,
uniqueness, AMPC, or proof. Every physical cell is explicitly unexecuted in
`device-lab/UNEXECUTED.md`.

## Reproduction

Run from the repository root:

```text
bun run --cwd clean-start test:integration
bun run --cwd clean-start test:browser
bun run --cwd clean-start test
bun run --cwd clean-start typecheck
bun run --cwd clean-start lint
bun run --cwd clean-start build
git diff --check
./bin/memory check
```

The exact counts, browser-project results, final evidence commit, and any external
browser-binary gaps are returned to Main after the final run.
