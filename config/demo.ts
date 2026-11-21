export const DEMO_PATH = "/demo";
export const DEMO_ACTION = "web-authenticator-demo";
export const DEMO_REQUEST_PATH = "/api/demo/request";
export const DEMO_VERIFY_PATH = "/api/demo/verify";
export const DEMO_TTL_SECONDS = 600;
export const DEMO_MAX_BODY_BYTES = 16 * 1024;

export type DemoRpContext = {
  rp_id: string;
  nonce: `0x${string}`;
  created_at: number;
  expires_at: number;
  signature: `0x${string}`;
};

export type DemoRequest = { app_id: `app_${string}`; rp_context: DemoRpContext };

export function isDemoRequest(value: unknown): value is DemoRequest {
  return isRecord(value) && typeof value.app_id === "string" && /^app_[a-f0-9]{32}$/.test(value.app_id) &&
    isDemoRpContext(value.rp_context);
}

export function isDemoRpContext(value: unknown): value is DemoRpContext {
  return isRecord(value) && typeof value.rp_id === "string" && /^rp_[a-f0-9]{1,16}$/.test(value.rp_id) &&
    typeof value.nonce === "string" && /^0x[a-f0-9]{64}$/.test(value.nonce) &&
    typeof value.signature === "string" && /^0x[a-f0-9]{130}$/.test(value.signature) &&
    typeof value.created_at === "number" && Number.isSafeInteger(value.created_at) &&
    typeof value.expires_at === "number" && Number.isSafeInteger(value.expires_at);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
