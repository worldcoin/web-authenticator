import { abortable } from "../async";
import type { WalletKit } from "../walletkit";
import { checkRequestCredentials, type IncomingRequest } from "./incoming-request";
import { checkExpiry } from "./proof-request";

export async function createProof(incoming: IncomingRequest, wallet: WalletKit, signal: AbortSignal, progress: (message: string) => void): Promise<string> {
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(120_000)]);
  const terminate = () => wallet.terminate();
  deadline.addEventListener("abort", terminate, { once: true });
  try {
    if (incoming.unsupportedReason) throw new Error(incoming.unsupportedReason);
    await incoming.validate(deadline);
    const available = await checkRequestCredentials(incoming, wallet, deadline);
    if (!available.satisfied) throw new Error("Required credentials are missing.");
    progress("Creating your proof with WalletKit…");
    // Preserve the RP's requirements, signals, dates and constraints verbatim.
    const proof = await abortable(wallet.generateProof(JSON.stringify(incoming.proof)), deadline);
    deadline.throwIfAborted();
    checkExpiry(incoming.proof);
    const response = JSON.parse(proof) as { id?: unknown; error?: unknown; responses?: unknown };
    if (response.id !== incoming.proof.id || response.error || !Array.isArray(response.responses) || !response.responses.length) {
      throw new Error("WalletKit returned an invalid proof response.");
    }
    return proof;
  } catch (cause) {
    wallet.terminate();
    throw new Error("Proof generation failed or timed out. Unlock to retry, or start a fresh request at the requesting app.", { cause });
  } finally {
    deadline.removeEventListener("abort", terminate);
  }
}
