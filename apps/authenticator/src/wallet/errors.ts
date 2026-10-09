/** Deliberate UI-safe failures; raw worker/provider errors may contain sensitive data. */
export class WalletOpenError extends Error {}

export function walletOpenErrorMessage(cause: unknown): string {
  if (cause instanceof WalletOpenError) return cause.message;
  if (cause instanceof Error) {
    if (cause.name === "NotAllowedError") return "The passkey request was cancelled, timed out, or not permitted. Try again with your existing passkey provider.";
    if (cause.name === "AbortError" || cause.name === "TimeoutError") return "Opening the wallet was interrupted or timed out. Try unlocking again.";
    if (cause.name === "SecurityError") return "The browser blocked this operation. Open the authenticator on localhost or HTTPS in a top-level tab.";
    if (cause.name === "QuotaExceededError") return "The browser has insufficient storage for the encrypted wallet. Free some space and retry without clearing this wallet's site data.";
  }
  return "The encrypted wallet could not initialize. Close other authenticator tabs and retry.";
}
