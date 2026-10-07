export type LivePasskeyStatusV1 =
  | "idle"
  | "requesting"
  | "created"
  | "unsupported"
  | "cancelled"
  | "failed";

export type LivePrfCapabilityV1 = "unknown" | "available" | "unavailable";

export interface LivePasskeyResultV1 {
  readonly status: Exclude<LivePasskeyStatusV1, "idle" | "requesting">;
  readonly prfCapability: LivePrfCapabilityV1;
}

interface PrfExtensionResultV1 {
  readonly prf?: { readonly enabled?: boolean };
}

export interface LocalPasskeyRuntimeV1 {
  readonly secureContext: boolean;
  readonly hostname: string;
  readonly publicKeyCredentialAvailable: boolean;
  readonly createCredential?: (options: CredentialCreationOptions) => Promise<Credential | null>;
  readonly randomBytes: (length: number) => Uint8Array;
  readonly nowEpochMs: () => number;
}

function defaultRuntime(): LocalPasskeyRuntimeV1 {
  return {
    secureContext: window.isSecureContext,
    hostname: window.location.hostname,
    publicKeyCredentialAvailable: typeof PublicKeyCredential !== "undefined",
    createCredential: typeof navigator.credentials?.create === "function"
      ? (options) => navigator.credentials.create(options)
      : undefined,
    randomBytes: (length) => crypto.getRandomValues(new Uint8Array(length)),
    nowEpochMs: () => Date.now(),
  };
}

function result(
  status: LivePasskeyResultV1["status"],
  prfCapability: LivePrfCapabilityV1 = "unknown",
): LivePasskeyResultV1 {
  return Object.freeze({ status, prfCapability });
}

function safeErrorName(value: unknown): string {
  try {
    return typeof value === "object" && value !== null
      ? String((value as { readonly name?: unknown }).name ?? "")
      : "";
  } catch {
    return "";
  }
}

function ownedArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const result = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(result).set(bytes);
  return result;
}

export async function createLocalDemoPasskeyV1(
  runtime: LocalPasskeyRuntimeV1 = defaultRuntime(),
): Promise<LivePasskeyResultV1> {
  if (
    !runtime.secureContext ||
    !runtime.publicKeyCredentialAvailable ||
    runtime.createCredential === undefined
  ) {
    return result("unsupported");
  }

  const challengeBytes = runtime.randomBytes(32);
  const userIdBytes = runtime.randomBytes(32);
  const challenge = ownedArrayBuffer(challengeBytes);
  const userId = ownedArrayBuffer(userIdBytes);
  const rp = runtime.hostname === "localhost"
    ? { id: "localhost", name: "World ID" }
    : { name: "World ID" };
  const publicKey = {
    challenge,
    rp,
    user: {
      id: userId,
      name: "World ID",
      displayName: "World ID",
    },
    pubKeyCredParams: [
      { type: "public-key" as const, alg: -7 },
      { type: "public-key" as const, alg: -257 },
    ],
    authenticatorSelection: {
      residentKey: "required" as const,
      requireResidentKey: true,
      userVerification: "required" as const,
    },
    timeout: 60_000,
    attestation: "none" as const,
    extensions: { prf: {} },
  } satisfies PublicKeyCredentialCreationOptions & {
    readonly extensions: AuthenticationExtensionsClientInputs & {
      readonly prf: Record<string, never>;
    };
  };

  try {
    const credential = await runtime.createCredential({ publicKey });
    if (
      credential === null ||
      credential.type !== "public-key" ||
      typeof (credential as PublicKeyCredential).getClientExtensionResults !== "function"
    ) {
      return result("failed");
    }
    const extensions = (credential as PublicKeyCredential)
      .getClientExtensionResults() as AuthenticationExtensionsClientOutputs & PrfExtensionResultV1;
    return result(
      "created",
      extensions.prf?.enabled === true ? "available" : "unavailable",
    );
  } catch (cause) {
    const name = safeErrorName(cause);
    if (name === "NotAllowedError" || name === "AbortError") {
      return result("cancelled");
    }
    if (name === "NotSupportedError" || name === "SecurityError") {
      return result("unsupported");
    }
    return result("failed");
  } finally {
    challengeBytes.fill(0);
    userIdBytes.fill(0);
    new Uint8Array(challenge).fill(0);
    new Uint8Array(userId).fill(0);
  }
}
