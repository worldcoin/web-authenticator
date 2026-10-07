# Physical-device evidence status

Product revision under test: `b7d3949099b175ae41e1a95f4f65ee3c2714d98b`

Status: **all physical cells unexecuted**. W09 had no physical iPhone, deployed
staging URL, camera operator, provider accounts, or protected user gestures.
Desktop Chromium and desktop WebKit results must not be relabeled as these cells.

| OS | Safari | Chrome |
|---|---|---|
| iOS 15 | Unexecuted: update-only/zero-sensitive-operations | Unexecuted: update-only/zero-sensitive-operations |
| iOS 16 | Unexecuted: update-only/zero-sensitive-operations | Unexecuted: update-only/zero-sensitive-operations |
| iOS 17 | Unexecuted: update-only/zero-sensitive-operations | Unexecuted: update-only/zero-sensitive-operations |
| iOS 18 | Unexecuted: Apple Passwords candidate/provider | Unexecuted: Apple Passwords and GPM candidate/provider |
| Current production iOS | Unexecuted: provider/device matrix | Unexecuted: provider/device matrix |

Also unexecuted for every applicable OS/browser/provider: private tab, PWA,
in-app handoff, iframe, permission allow/deny/revoke, camera settings/MIME,
app switch, lock, call, track end, offline/restore, timeout, repeated attempts,
VoiceOver, 200% Dynamic Type, safe-area/browser chrome, memory, battery, thermal,
real passkey/PRF, and protected user-presence behavior.

Real camera provenance, biometric spoof detection, TEE behavior, real issuance,
uniqueness, AMPC, and proof are outside this simulator milestone and remain
unproven regardless of any future physical UI run.
