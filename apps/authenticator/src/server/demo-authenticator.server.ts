import {
  INJECTED_AUTHENTICATOR_PORT_V0,
  INJECTED_AUTHENTICATOR_REQUEST_V0,
  SIMULATION_ENVIRONMENT,
  SIMULATION_MODE,
  STAGING_DEMO_AUTHENTICATOR_ERROR_V0,
  STAGING_DEMO_AUTHENTICATOR_READY_V0,
  base64UrlToBytes,
  bytesToArrayBuffer,
  bytesToBase64Url,
  canonicalizeJsonV0,
  isInjectedAuthenticatorRequestV0,
  type InjectedAuthenticatorPortV0,
  type InjectedAuthenticatorRequestV0,
  type InjectedAuthenticatorResultV0,
  type StagingDemoAuthenticatorReadyV0,
} from "@clean-start/contracts";
import type { PurposeEd25519KeyV0 } from "./crypto.server";

const HANDLE_DOMAIN = "world-id-web-authenticator:demo-completion:v0";

interface CachedDemoResultV0 {
  readonly sessionId: string;
  readonly idempotencyKey: string;
  readonly accountPublicMaterialDigestSha256: string;
  readonly result: StagingDemoAuthenticatorReadyV0;
}

export type StagingDemoAuthenticatorOutcomeV0 =
  | "ready"
  | "unavailable"
  | "invalid_response";

export interface DemoCompletionCeremonyV0 {
  readonly kind: "staging_demo_completion_ceremony_v0";
  readonly completionHandle: string;
  readonly sessionId: string;
  readonly idempotencyKey: string;
  readonly accountPublicMaterialDigestSha256: string;
}

function completionPreimage(
  token: string,
  fields: Omit<StagingDemoAuthenticatorReadyV0, "completionHandle">,
): Uint8Array {
  return new TextEncoder().encode(canonicalizeJsonV0({
    domain: HANDLE_DOMAIN,
    kind: "staging_demo_completion_ceremony_v0",
    token,
    requestId: fields.requestId,
    sessionId: fields.sessionId,
    idempotencyKey: fields.idempotencyKey,
    accountPublicMaterialDigestSha256: fields.accountPublicMaterialDigestSha256,
    claims: fields.claims,
    issuedAt: fields.issuedAt,
    expiresAt: fields.expiresAt,
  }));
}

export class StagingDemoAuthenticatorServiceV0 implements InjectedAuthenticatorPortV0 {
  readonly #byIdempotency = new Map<string, CachedDemoResultV0>();
  readonly #byHandle = new Map<string, CachedDemoResultV0>();

  constructor(
    private readonly key: PurposeEd25519KeyV0,
    private readonly ttlMs: number,
    private readonly now: () => Date,
    private readonly forcedOutcome: StagingDemoAuthenticatorOutcomeV0 = "ready",
  ) {}

  readiness(): boolean {
    return this.key.privateKey.algorithm.name === "Ed25519" &&
      this.key.publicKey.algorithm.name === "Ed25519" &&
      this.key.keyId.length > 0 &&
      Number.isSafeInteger(this.ttlMs) &&
      this.ttlMs > 0;
  }

  async begin(request: InjectedAuthenticatorRequestV0): Promise<InjectedAuthenticatorResultV0> {
    if (!isInjectedAuthenticatorRequestV0(request) || !this.readiness()) {
      return Object.freeze({
        kind: STAGING_DEMO_AUTHENTICATOR_ERROR_V0,
        version: INJECTED_AUTHENTICATOR_PORT_V0,
        mode: SIMULATION_MODE,
        environment: SIMULATION_ENVIRONMENT,
        requestId: "invalid",
        sessionId: "invalid",
        idempotencyKey: "invalid",
        reasonCode: "invalid_response",
      });
    }
    if (this.forcedOutcome !== "ready") {
      return Object.freeze({
        kind: STAGING_DEMO_AUTHENTICATOR_ERROR_V0,
        version: INJECTED_AUTHENTICATOR_PORT_V0,
        mode: SIMULATION_MODE,
        environment: SIMULATION_ENVIRONMENT,
        requestId: request.requestId,
        sessionId: request.sessionId,
        idempotencyKey: request.idempotencyKey,
        reasonCode: this.forcedOutcome,
      });
    }
    this.purgeExpired();
    const cacheKey = `${request.sessionId}\u0000${request.idempotencyKey}`;
    const cached = this.#byIdempotency.get(cacheKey);
    if (cached !== undefined) {
      if (cached.accountPublicMaterialDigestSha256 !== request.accountPublicMaterialDigestSha256) {
        return Object.freeze({
          kind: STAGING_DEMO_AUTHENTICATOR_ERROR_V0,
          version: INJECTED_AUTHENTICATOR_PORT_V0,
          mode: SIMULATION_MODE,
          environment: SIMULATION_ENVIRONMENT,
          requestId: request.requestId,
          sessionId: request.sessionId,
          idempotencyKey: request.idempotencyKey,
          reasonCode: "invalid_response",
        });
      }
      return cached.result;
    }

    const issuedAt = this.now();
    const expiresAtMs = Math.min(
      Date.parse(request.expiresAt),
      issuedAt.getTime() + this.ttlMs,
    );
    if (expiresAtMs <= issuedAt.getTime()) {
      return Object.freeze({
        kind: STAGING_DEMO_AUTHENTICATOR_ERROR_V0,
        version: INJECTED_AUTHENTICATOR_PORT_V0,
        mode: SIMULATION_MODE,
        environment: SIMULATION_ENVIRONMENT,
        requestId: request.requestId,
        sessionId: request.sessionId,
        idempotencyKey: request.idempotencyKey,
        reasonCode: "interrupted",
      });
    }

    const token = bytesToBase64Url(crypto.getRandomValues(new Uint8Array(24)));
    const readyFields = Object.freeze({
      kind: STAGING_DEMO_AUTHENTICATOR_READY_V0,
      version: INJECTED_AUTHENTICATOR_PORT_V0,
      mode: SIMULATION_MODE,
      environment: SIMULATION_ENVIRONMENT,
      requestId: request.requestId,
      sessionId: request.sessionId,
      idempotencyKey: request.idempotencyKey,
      accountPublicMaterialDigestSha256: request.accountPublicMaterialDigestSha256,
      claims: Object.freeze({
        webauthnPerformed: false,
        prfEvaluated: false,
        worldIdCreated: false,
      }),
      issuedAt: issuedAt.toISOString(),
      expiresAt: new Date(expiresAtMs).toISOString(),
    });
    const signature = await this.key.sign(completionPreimage(token, readyFields));
    const completionHandle = `${token}.${signature}`;
    const result: StagingDemoAuthenticatorReadyV0 = Object.freeze({
      ...readyFields,
      completionHandle,
    });
    const entry = Object.freeze({
      sessionId: request.sessionId,
      idempotencyKey: request.idempotencyKey,
      accountPublicMaterialDigestSha256: request.accountPublicMaterialDigestSha256,
      result,
    });
    this.#byIdempotency.set(cacheKey, entry);
    this.#byHandle.set(completionHandle, entry);
    return result;
  }

  async verifyCompletion(input: {
    readonly completionHandle: string;
    readonly sessionId: string;
    readonly idempotencyKey: string;
    readonly accountPublicMaterialDigestSha256: string;
  }): Promise<boolean> {
    this.purgeExpired();
    const entry = this.#byHandle.get(input.completionHandle);
    if (
      entry === undefined ||
      entry.sessionId !== input.sessionId ||
      entry.idempotencyKey !== input.idempotencyKey ||
      entry.accountPublicMaterialDigestSha256 !== input.accountPublicMaterialDigestSha256 ||
      Date.parse(entry.result.expiresAt) <= this.now().getTime()
    ) return false;

    const [token, signature, extra] = input.completionHandle.split(".");
    if (token === undefined || signature === undefined || extra !== undefined) return false;
    try {
      return crypto.subtle.verify(
        { name: "Ed25519" },
        this.key.publicKey,
        bytesToArrayBuffer(base64UrlToBytes(signature)),
        bytesToArrayBuffer(completionPreimage(token, {
          kind: entry.result.kind,
          version: entry.result.version,
          mode: entry.result.mode,
          environment: entry.result.environment,
          requestId: entry.result.requestId,
          sessionId: entry.result.sessionId,
          idempotencyKey: entry.result.idempotencyKey,
          accountPublicMaterialDigestSha256:
            entry.result.accountPublicMaterialDigestSha256,
          claims: entry.result.claims,
          issuedAt: entry.result.issuedAt,
          expiresAt: entry.result.expiresAt,
        })),
      );
    } catch {
      return false;
    }
  }

  private purgeExpired(): void {
    const nowMs = this.now().getTime();
    for (const [cacheKey, entry] of this.#byIdempotency) {
      if (Date.parse(entry.result.expiresAt) > nowMs) continue;
      this.#byIdempotency.delete(cacheKey);
      this.#byHandle.delete(entry.result.completionHandle);
    }
  }
}

export function isDemoCompletionCeremonyV0(value: unknown): value is DemoCompletionCeremonyV0 {
  return typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join(",") ===
      "accountPublicMaterialDigestSha256,completionHandle,idempotencyKey,kind,sessionId" &&
    (value as { readonly kind?: unknown }).kind === "staging_demo_completion_ceremony_v0" &&
    typeof (value as { readonly completionHandle?: unknown }).completionHandle === "string" &&
    typeof (value as { readonly sessionId?: unknown }).sessionId === "string" &&
    typeof (value as { readonly idempotencyKey?: unknown }).idempotencyKey === "string" &&
    typeof (value as { readonly accountPublicMaterialDigestSha256?: unknown })
      .accountPublicMaterialDigestSha256 === "string";
}

export function makeInjectedAuthenticatorRequestV0(input: {
  readonly requestId: string;
  readonly sessionId: string;
  readonly idempotencyKey: string;
  readonly accountPublicMaterialDigestSha256: string;
  readonly requestedAt: string;
  readonly expiresAt: string;
}): InjectedAuthenticatorRequestV0 {
  return Object.freeze({
    kind: INJECTED_AUTHENTICATOR_REQUEST_V0,
    version: INJECTED_AUTHENTICATOR_PORT_V0,
    mode: SIMULATION_MODE,
    environment: SIMULATION_ENVIRONMENT,
    ...input,
  });
}
