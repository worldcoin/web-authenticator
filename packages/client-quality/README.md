# Client quality

W05-owned after explicit `GO`. Provides provisional capture UX only and emits no spoof, liveness, or verification result.

`evaluateClientQualityV0` consumes synchronous, ephemeral measurements and returns only the frozen policy version, policy identifier, one of `ready`/`adjust`/`retake`/`unavailable`, and allowlisted reason codes. It evaluates camera activity first and then only the checks explicitly present in the policy. Missing or unusable enabled measurements return `unavailable`; reaching `maxRetakes` cannot become `ready`.

This package loads no model or asset, makes no network or storage call, and does not serialize source measurements. Measurements such as face count, framing ratios, luma, and sharpness remain caller-owned transient values.

| Enabled check | Condition | Action / reason |
|---|---|---|
| `camera_active` | inactive or unreadable | `unavailable` / `camera_inactive` or `camera_unavailable` |
| `single_face` | none, multiple, or unreadable | `adjust` / `face_not_found` or `multiple_faces`; otherwise `unavailable` |
| `framing` | below/above area or outside center threshold | `adjust` / `move_closer`, `move_farther`, or `center_face` |
| `lighting` | below/above luma threshold | `adjust` / `improve_lighting` or `reduce_lighting` |
| `sharpness` | below threshold | `retake` / `image_blurry`; at the policy limit, `unavailable` / `retake_limit_reached` |

An unreadable enabled check returns its allowlisted `*_guidance_unavailable` reason. A valid policy with all enabled checks satisfied returns `ready` with no reason code.

## Proof

```bash
bun test clean-start/packages/client-quality/test
./node_modules/.bin/tsc -p clean-start/tsconfig.json --noEmit
```
