import { z } from "zod";

export const DEMO_PATH = "/demo";
export const DEMO_ACTION_PREFIX = "web-authenticator-demo-";
export const DEMO_REQUEST_PATH = "/api/demo/request";
export const DEMO_VERIFY_PATH = "/api/demo/verify";
export const DEMO_TTL_SECONDS = 600;
export const DEMO_MAX_BODY_BYTES = 16 * 1024;

export const DemoHex32Schema = z.templateLiteral(["0x", z.string().regex(/^[a-f0-9]{64}$/)]);

export const DemoRpContextSchema = z.object({
  rp_id: z.string().regex(/^rp_[a-f0-9]{1,16}$/),
  nonce: DemoHex32Schema,
  created_at: z.int(),
  expires_at: z.int(),
  signature: z.templateLiteral(["0x", z.string().regex(/^[a-f0-9]{130}$/)]),
});

export const DemoRequestSchema = z.object({
  app_id: z.templateLiteral(["app_", z.string().regex(/^[a-f0-9]{32}$/)]),
  action: z.templateLiteral([DEMO_ACTION_PREFIX, z.uuidv4()]),
  rp_context: DemoRpContextSchema,
});

export const DemoVerificationSuccessSchema = z.object({ success: z.literal(true) });

export type DemoRpContext = z.infer<typeof DemoRpContextSchema>;
export type DemoRequest = z.infer<typeof DemoRequestSchema>;
