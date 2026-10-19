import type { Base64Url, HexSha256, Identifier } from "./common";

export const WEB_AUTHN_PRF_AUTHENTICATOR_V1 = "webauthn_prf_authenticator_v1" as const;
// The exact UTF-8 bytes passed as the passkey PRF `first` input; the digest identifies them.
export const PRF_INPUT_V1_LABEL = "world-id/web-authenticator/prf/v1" as const;
export const PRF_INPUT_V1_SHA256 =
  "98c8c3d877f05acf6f741759ae90d9353f08bced5fd199d8127b6539eb0feec5" as const;
// The 32-byte first PRF result is HKDF-SHA256 input key material (salt
// "world-id/web-authenticator/keys/v1"): info "authenticator-seed" yields the
// World ID 4 signer seed, info "credential-store" the encrypted vault key.
export const PRF_OUTPUT_MAPPING_V1 =
  "hkdf_sha256_first_result_to_world_id_4_signer_seed_and_vault_key" as const;
export const PRF_RESULT_LENGTH_BYTES_V1 = 32 as const;

export interface WebAuthnPrfAuthenticatorPolicyV1 {
  readonly version: typeof WEB_AUTHN_PRF_AUTHENTICATOR_V1;
  readonly rpId: string;
  readonly allowedOrigins: readonly string[];
  readonly userVerification: "required";
  readonly prfInputSha256: typeof PRF_INPUT_V1_SHA256;
  readonly prfOutputMapping: typeof PRF_OUTPUT_MAPPING_V1;
  readonly secretLifecycle: "browser_memory_only";
}

export interface WorldIdPublicAuthenticatorMaterialV1 {
  readonly managementAddress: `0x${string}`;
  readonly provingPublicKeyCompressedLeHex: string;
  readonly keySetCommitmentHex: string;
}

export interface WebAuthnPrfPublicResultV1 {
  readonly version: typeof WEB_AUTHN_PRF_AUTHENTICATOR_V1;
  readonly ceremonyId: Identifier;
  readonly credentialIdBase64Url: Base64Url;
  readonly credentialPublicKeyDigestSha256: HexSha256;
  readonly worldIdPublicMaterial: WorldIdPublicAuthenticatorMaterialV1;
}

// No wire type in this contract contains the PRF result, seed, or either private key.
