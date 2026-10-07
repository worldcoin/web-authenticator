export const GATEWAY_ERROR_CODES_V0 = [
  "gateway_disabled",
  "invalid_request",
  "body_too_large",
  "unauthorized",
  "origin_forbidden",
  "not_found",
  "expired",
  "invalid_state",
  "binding_mismatch",
  "replay_rejected",
  "artifact_invalid",
  "resource_busy",
] as const;

export type GatewayErrorCodeV0 = (typeof GATEWAY_ERROR_CODES_V0)[number];

export class GatewayErrorV0 extends Error {
  readonly code: GatewayErrorCodeV0;
  readonly httpStatus: number;

  constructor(code: GatewayErrorCodeV0, httpStatus: number) {
    super(code);
    this.name = "GatewayErrorV0";
    this.code = code;
    this.httpStatus = httpStatus;
  }

  toResponse(): { readonly code: GatewayErrorCodeV0 } {
    return { code: this.code };
  }
}
