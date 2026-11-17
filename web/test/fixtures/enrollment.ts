import type { EnrollmentCapture, EnrollmentChallenge } from "../../lib/enrollment-contract";

export const CAPTURE_ID = "6f9619ff-8b86-4d01-b42d-00cf4fc964ff";
export const CHALLENGE_ID = "fc863f88-844d-4e7b-8d06-ecb993b4dfb0";

/** Synthetic v2 fields matching the TEE/signup contract; no real biometric or Nitro evidence. */
export function enrollmentCapture(): EnrollmentCapture {
  return {
    fields: Object.entries({
      contract_version: "2",
      sub: "0x1f",
      capture_id: CAPTURE_ID,
      timestamp: "1700000000",
      face_embedding_shares_0: btoa(String.fromCharCode(...new Uint8Array(80).fill(1))),
      face_embedding_shares_1: btoa(String.fromCharCode(...new Uint8Array(96).fill(2))),
      face_embedding_shares_2: btoa(String.fromCharCode(...new Uint8Array(128).fill(3))),
      face_embedding_version: "2.0.0",
      face_embedding_type: "ghostfacenet_flipped_mean",
      face_embedding_inference_backend: "face-engine",
      pcp_version: "1",
      associated_data_hash: `0x${"01".repeat(32)}`,
    }).map(([name, value]) => ({ name, value })),
    attestation_header: btoa("synthetic-document"),
  };
}

export function enrollmentChallenge(): EnrollmentChallenge {
  return {
    challenge_id: CHALLENGE_ID,
    nonce: `0x${"00".repeat(31)}01`,
    challenge_type: "enrollment",
    expires_at: new Date(Date.now() + 600_000).toISOString(),
  };
}
