import type { Base64Url, HexSha256, Identifier } from "./common";

export const WEB_AUTHN_PRF_AUTHENTICATOR_V1 = "webauthn_prf_authenticator_v1" as const;
export const PRF_INPUT_V1_LABEL = "world-id:web-authenticator:world-id-4:v1" as const;
export const PRF_INPUT_V1_SHA256 =
  "0b2ba181b397d6ac08ef7139cd2410c31fd416120d35f075420a4af38f3609e6" as const;
export const PRF_RESULT_LENGTH_BYTES_V1 = 32 as const;

export interface WebAuthnPrfAuthenticatorPolicyV1 {
  readonly version: typeof WEB_AUTHN_PRF_AUTHENTICATOR_V1;
  readonly rpId: string;
  readonly allowedOrigins: readonly string[];
  readonly userVerification: "required";
  readonly prfInputSha256: typeof PRF_INPUT_V1_SHA256;
  readonly prfOutputMapping: "verbatim_32_byte_first_result_to_world_id_4_signer_seed";
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
