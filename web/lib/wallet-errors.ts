/** Deliberate UI-safe failures; raw worker/provider errors may contain sensitive data. */
export class WalletOpenError extends Error {}

export class WalletRegistrationError extends WalletOpenError {
  constructor(message: string, readonly timedOut: boolean, options?: ErrorOptions) {
    super(message, options);
  }
}

/** Another tab is in a capture, issuance or proof, so this tab does not take the wallet. */
export class WalletBusyElsewhereError extends WalletOpenError {
  constructor(options?: ErrorOptions) {
    super("Your authenticator is busy with a check in another tab. Finish or cancel it there, then try again.", options);
  }
}

/** Another tab took the wallet; this tab's worker has been stopped. */
export class WalletTakenOverError extends WalletOpenError {
  constructor(options?: ErrorOptions) {
    super("Your authenticator continued in another tab.", options);
  }
}

/**
 * The encrypted wallet's storage is still held by a tab that did not hand it over: one that is
 * frozen in the background, or runs an older version of this app.
 */
export class WalletStorageBusyError extends WalletOpenError {
  constructor(options?: ErrorOptions) {
    super("Your authenticator is still open in another tab or window. Close it, then try again. If no other tab is open, reload this page.", options);
  }
}

/** WalletKit's worker gives up on the vault's exclusive file handle after its own retries. */
export function isWalletStorageBusy(cause: unknown): boolean {
  return cause instanceof Error && (cause as { code?: unknown }).code === "PersistentStorage" &&
    cause.message.includes("creating sync access handle");
}

export function walletOpenErrorMessage(cause: unknown): string {
  if (cause instanceof WalletOpenError) return cause.message;
  if (isWalletStorageBusy(cause)) return new WalletStorageBusyError().message;
  if (cause instanceof Error) {
    if (cause.name === "NotAllowedError") return "The passkey request was cancelled, timed out, or not permitted. Try again with your existing passkey provider.";
    if (cause.name === "AbortError" || cause.name === "TimeoutError") return "Opening the wallet was interrupted or timed out. Try unlocking again.";
    if (cause.name === "SecurityError") return "The browser blocked this operation. Open the authenticator on localhost or HTTPS in a top-level tab.";
    if (cause.name === "QuotaExceededError") return "The browser has insufficient storage for the encrypted wallet. Free some space and retry without clearing this wallet's site data.";
  }
  return "The encrypted wallet could not initialize. Try again.";
}
