# Face signup-service v2 contract

The browser transport in `web/lib/signup-service.ts` uses `/api/v2/identity`.
Its public response models follow [Oxide's Face client](https://github.com/worldcoin/oxide/blob/7a3220f64be61f026bf0fe638185e6962374a9a8/oxide/src/api/pop_face_backend_api/mod.rs):
`FaceIdentityStatusResponse` and `FaceEnrollmentStatusResponse`.
`sub` replaces the v3 identity commitment.
The matching backend changes are tracked in
[worldcoin/signup-service#2400](https://github.com/worldcoin/signup-service/pull/2400).
Confirm that this response contract and browser routing are deployed before
enabling enrollment. No UI currently calls this transport.

## PUT: submit a capture

`PUT /api/v2/identity` has no query parameters. Send `multipart/form-data`
with these required fields:

| Field | Value |
| --- | --- |
| `contract_version` | `2` |
| `sub` | Canonical v4 subject, e.g. `0x1f` |
| `capture_id` | Enclave-generated canonical UUID |
| `timestamp` | Enclave capture time as decimal Unix seconds |
| `face_embedding_shares_0` / `_1` / `_2` | Base64 AMPC-encrypted shares |
| `face_embedding_version` | Enclave-provided embedding version |
| `face_embedding_type` | Enclave-provided embedding type |
| `face_embedding_inference_backend` | Enclave-provided inference backend |
| `pcp_version` | Enclave-provided custody format version |
| `associated_data_hash` | Lowercase, `0x`-prefixed 32-byte hash |
| `world_id_challenge_id` | Fresh enrollment-purpose challenge UUID |
| `world_id_ownership_proof` | File part containing raw CBOR proof |

Send the base64 Nitro attestation in `X-Nitro-Attestation`. Preserve all attested
field values and ciphertexts from the enclave; do not re-encrypt shares. Let
`FormData` set the multipart boundary. PUT requires both the attestation and v4
ownership proof, without v3 ZKP or device integrity headers.

Acceptance and a verified idempotent retry both return:

```http
HTTP/1.1 202 Accepted
Content-Type: application/json

{}
```

`submitEnrollment` returns `{sub, captureId}` from the validated input. This is a
local receipt, not a server-issued token. Submit once per ownership proof. An
unconfirmed submission retains the capture and requires fresh proof for another
PUT; the client never automatically replays it.

## GET: read identity status

```http
GET /api/v2/identity?sub=0x1f
```

GET sends no authentication headers or cookies. It returns `200` with the same
nested public body as Face v1 and Oxide. An unknown subject returns:

```json
{"status":"NEW"}
```

While the first enrollment is processing:

```json
{
  "status": "NEW",
  "enrollment_status": {
    "status": "ENROLLMENT_IN_PROGRESS",
    "capture_id": "6f9619ff-8b86-4d01-b42d-00cf4fc964ff"
  }
}
```

On success:

```json
{
  "status": "VERIFIED",
  "last_successful_capture_id": "6f9619ff-8b86-4d01-b42d-00cf4fc964ff",
  "enrollment_status": {
    "status": "ENROLLMENT_UNIQUE_SUCCESSFUL",
    "capture_id": "6f9619ff-8b86-4d01-b42d-00cf4fc964ff",
    "credential": "<base64 signed credential>"
  }
}
```

| Public enrollment status | Capture polling result |
| --- | --- |
| `ENROLLMENT_IN_PROGRESS` | `pending` |
| `ENROLLMENT_UNIQUE_SUCCESSFUL` | `completed`, with decoded credential bytes |
| `ENROLLMENT_NOT_UNIQUE` | `duplicate` |
| `ENROLLMENT_FAILED` | `failed` |

`getIdentityStatus(sub, options)` returns the identity DTO independently of a
capture. Top-level `status` is `NEW`, `VERIFIED`, or `UNVERIFIED` and describes
the identity, while `enrollment_status` describes its latest capture. Optional
fields may be omitted or null. Capture IDs in this public DTO are strings,
including existing mobile IDs. A credential may accompany a pending or failed
capture; consume it only on successful completion of the submitted capture.
Internal states such as `Received`, `Completed`, and `Expired` are not public
enrollment statuses.

`getEnrollmentStatus(receipt, options)` checks that the returned capture matches
the locally retained receipt. Deletion metadata or `UNVERIFIED` blocks enrollment,
as in Oxide. While waiting for an accepted capture, missing enrollment metadata
remains pending until the bounded polling deadline. A different capture is not
treated as this submission's result. The transport does not mutate PCP storage.

Polling retains the existing one-second cadence, two-minute overall deadline,
ten-second request deadline, response size limit, and cancellation. Failed GETs
surface to the caller without automatic retries.

## Errors

Most failures have an empty body: malformed requests (`400`), rejected proof or
attestation (`401`), canceled storage operations (`408`), conflicting operations
or evidence (`409`), oversized captures (`413`), missing reauth binding (`422`),
storage errors (`500`), and verification/admission unavailability (`503`).
GET uses `400`, `408`, `500`, and `503` for its corresponding failures.

Reauth quota exhaustion returns `429 {"error":"RATE_LIMIT_EXCEEDED"}`. A subject
binding conflict returns
`409 {"error":"subject_bound_to_other_identity","retryable":false}`.
`retryable` is not required on every error. The client uses an explicit boolean
when supplied, otherwise derives it from HTTP status (`408`, `429`, or `5xx`).
The flag informs caller recovery; it never automatically resubmits PUT. Error
messages do not copy arbitrary upstream response text.
