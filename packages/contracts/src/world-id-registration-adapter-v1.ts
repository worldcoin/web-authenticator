import type { HexSha256, Identifier, IsoDateTime } from "./common";
import { SIMULATION_ENVIRONMENT } from "./common";
import type { WorldIdPublicAuthenticatorMaterialV1 } from "./webauthn-prf-authenticator-v1";

export const WORLD_ID_REGISTRATION_ADAPTER_V1 = "world_id_registration_adapter_v1" as const;

export interface WorldIdRegistrationAdapterPolicyV1 {
  readonly version: typeof WORLD_ID_REGISTRATION_ADAPTER_V1;
  readonly environment: typeof SIMULATION_ENVIRONMENT;
  readonly sdkRevision: string;
  readonly gatewayBaseUrl: string;
  readonly chainId: number;
  readonly gatewayRecomputesOrRejectsCommitmentMismatch: true;
  readonly endpointConfigurationHasNoDefault: true;
}

export interface WorldIdRegistrationRequestV1 {
  readonly version: typeof WORLD_ID_REGISTRATION_ADAPTER_V1;
  readonly registrationId: Identifier;
  readonly idempotencyKey: Identifier;
  readonly recoveryAddress: `0x${string}`;
  readonly publicAuthenticator: WorldIdPublicAuthenticatorMaterialV1;
  readonly publicMaterialDigestSha256: HexSha256;
  readonly requestedAt: IsoDateTime;
}

export type WorldIdRegistrationResultV1 =
  | {
      readonly status: "registered";
      readonly accountId: Identifier;
      readonly leafIndex: string;
      readonly publicMaterialDigestSha256: HexSha256;
    }
  | { readonly status: "pending"; readonly registrationId: Identifier }
  | {
      readonly status: "rejected" | "unavailable";
      readonly reasonCode: string;
    };

export function validateWorldIdRegistrationAdapterPolicyV1(
  policy: WorldIdRegistrationAdapterPolicyV1,
): readonly string[] {
  const errors: string[] = [];
  if (policy.version !== WORLD_ID_REGISTRATION_ADAPTER_V1) errors.push("version");
  if (policy.environment !== SIMULATION_ENVIRONMENT) errors.push("environment");
  if (!policy.sdkRevision || policy.sdkRevision === "required-at-runtime") {
    errors.push("sdkRevision");
  }
  try {
    const gatewayUrl = new URL(policy.gatewayBaseUrl);
    if (gatewayUrl.protocol !== "https:") errors.push("gatewayBaseUrl");
  } catch {
    errors.push("gatewayBaseUrl");
  }
  if (!Number.isSafeInteger(policy.chainId) || policy.chainId <= 0) errors.push("chainId");
  if (!policy.gatewayRecomputesOrRejectsCommitmentMismatch) {
    errors.push("commitmentMismatchEnforcement");
  }
  if (!policy.endpointConfigurationHasNoDefault) errors.push("endpointDefault");
  return errors;
}

// The staging endpoint, chain, and SDK revision are required configuration; this contract invents none.
