# Frame capture

Metadata-only iPhone camera capture for the simulator-backed milestone. The runtime starts only
after a user action plus an approved iOS 18+ Safari/Chrome top-level context and successful PRF
setup. It requests video with a soft front-camera preference and never records audio.

## Boundary

- Camera pixels are transient RGBA8 application buffers. Each buffer is locally hashed, exposed
  to an optional local capture-guidance callback, cleared, and released.
- The only returned wire artifact is Main-owned `FrameBundleV0`: one to four descriptors, exact
  byte lengths, diagnostic offsets, per-frame SHA-256 digests, and the canonical artifact digest.
- Preview mirroring is CSS-only. Canvas sampling uses unmirrored source coordinates.
- No recording, video/JPEG encoding, media blob, upload, persistence, logging, analytics, object
  URL, service worker, or snapshot artifact exists in this package.
- Synthetic fixtures are descriptor-only and require both `testMode: true` and a
  `synthetic_fixture` policy. That path never opens a camera.

## Lifecycle

Every attempt owns its stream, tracks, canvas sampler, listeners, timers, and transient buffers.
Cancel, hidden/pagehide, unload, orientation or intrinsic-size change, track mute/end, expiry,
watchdog failure, acquisition error, local inspection error, and success all converge on cleanup.
Cleanup detaches preview, clears the canvas and buffers, stops every owned track, and requires a
fresh user-initiated attempt. A cancelled unresolved `getUserMedia()` request is tombstoned; if it
later resolves, every late track is immediately stopped and the stream is never attached.

## Evidence status

Unit tests cover lifecycle, exact digest vectors, bounds, interruption cleanup, late permission,
and network/storage/log sentinels. Safari and Chrome on iPhone remain separate unverified device
cells. Browser-process suspension can prevent page cleanup handlers, and application-level buffer
clearing is best effort rather than a claim of OS/browser/GPU zeroization or app-switcher snapshot
absence.
