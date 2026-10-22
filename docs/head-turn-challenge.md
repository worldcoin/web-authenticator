# Head-turn challenge UI draft

The first commit on this branch fixes Cookie settings unmounting the request flow. The next change is a separate interaction draft; the public request flow still captures one local image.

## Review the draft

From the repository root:

```sh
bun x vite --config web/vite.config.ts --port 4180
```

Open http://127.0.0.1:4180/challenge-preview.html. Select a screen or play the walkthrough. The illustrated face and all feedback are simulated; the preview requests no camera access and does not submit images. The HTML is a separate Vite development entry and is excluded from the normal production build.

The sample sequence is **center → turn left → hold → turn right → hold → await evaluation → result**. The two directions illustrate the UI only. Copy and target cues describe the user's left/right in a mirrored preview. There is no return-to-center step between turns.

Screenshots: [left cue on mobile](review/head-turn-left-mobile.png), [right cue on desktop](review/head-turn-right-desktop.png). The walkthrough, retry/result screens and layout at widths 320, 393, 768 and 1280 were checked in Chromium and WebKit. Automated accessibility checks passed on the rejected-result screen; they are not a full accessibility audit of every state.

## Map the real flow

| State | UI | What permits advancement |
| --- | --- | --- |
| Prepare | Getting your check ready | Verified enclave assignment and a fresh, request-bound challenge |
| Center | Look straight ahead | Fresh face observations establish the reference pose |
| Turn | Turn your head left/right, with the target side lit | Local pose feedback reaches the current issued target |
| Hold | Hold it there; keep your eyes on the screen | The reference pose engine observes the required hold; then reveal the next target |
| Evaluate | Checking your capture | Bounded frame sequence and event transcript submitted over the attested encrypted channel |
| Passed | Check complete | The TEE returns a response bound to this request, challenge and evaluator version |
| Inconclusive | Let's try that again | A new challenge is required for another attempt |
| Expired / rejected | Start a fresh check / return to the app | Never fall through to capture success or credential issuance |

Camera loss, an unsupported device, challenge-fetch failure and evaluation timeout must surface a recoverable explanation. A brief loss of face can show "Keep your face in view"; the reference engine decides when that loss ends the attempt. Hiding the page stops capture; returning requires a fresh challenge. Cookie settings preserves the session and pending evaluation; it must not reconstruct the flow from the request link.

## Match face-pad before implementing acceptance

Reference: [face-pad `e5d9013`, pose core](https://github.com/worldcoin/face-pad/blob/e5d90133c0d24a89087f97594a8a00dcc8bdd318/web/static/core/posechallenge.js) and [browser engine](https://github.com/worldcoin/face-pad/blob/e5d90133c0d24a89087f97594a8a00dcc8bdd318/web/static/pose/engine.js).

- The pinned core exports algorithm version 8. Its normal sequence has **four randomized targets**, including directions other than horizontal left/right, with randomized pauses. It also evaluates whether the eyes counter-rotate as the head turns. Two fixed turns are not an equivalent verifier.
- Its center and target hold require 0.3 seconds and at least three observations. These constants belong to the pinned evaluator, not UI timers. The preview's delays are presentation choices only.
- The current RGBNet model supplies framing boxes and five landmarks. It does not supply face-pad's head-pose matrix or iris landmarks. Real local guidance needs the compatible face mesh/pose pipeline; final evaluation must derive its measurements from submitted images inside the measured worker.
- The TEE must generate the seed/parameters, retain the canonical challenge with a deadline and one-attempt semantics, and reject a browser-substituted challenge. Preserve reference generator behavior for parity; a seed's bit length alone is not a security claim about its generator or target sequence.
- Submit ordered image frames with bounded size/count/duration, capture timestamps, cue events and relevant camera metadata. Treat browser timestamps, landmarks and scores as untrusted input. Define the image representation against reference replay fixtures before introducing compression or frame dropping.
- Reuse the existing attested transport and sandbox boundary where practical. The existing `selfie-enrollment` protocol is embedding-only; it does not yet expose challenge issuance, capture submission or a pose evaluator. Those require an explicit versioned protocol and measured worker release.
- Passing the UI sequence does not prove a camera's origin or stop a fully injected adaptive stream. TEE execution authenticates the evaluator; camera authenticity remains a separate trust boundary.

## Implementation order

1. Agree the UI states using this preview, then pin a reference recording and expected verdict/metrics for parity.
2. Add a challenge-specific TEE operation with request binding, expiry, bounded evidence and replay rejection. Run the pinned pose pipeline against real frames in the measured worker.
3. Feed the browser UI the issued targets and advisory face-mesh feedback. Keep the result pending until the authoritative response arrives.
4. Gate the existing completion/save flow on that result. Verify recorded-data parity, wrong-challenge and replay handling, missing frames, face loss, timeout, page hiding and Cookie settings throughout.

Credential issuance and a production PAD/security claim are subsequent work; this draft does not implement either.
