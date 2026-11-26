import { abortable } from "./async";
import { checkRequestCredentials, type IncomingRequest } from "./incoming-request";
import { checkExpiry, RequestExpiredError } from "./proof-request";
import { WalletOpenError } from "./wallet-errors";
import type { WalletKit } from "./walletkit";

const ANSWER_TIMEOUT_MS = 120_000;

/** The wallet has already proved this action for this app; a second proof would repeat its nullifier. */
export class ProofReplayedError extends Error {}

/** Answers the request: proves it with the wallet's credentials and delivers the proof to the app. */
export async function proveAndDeliver(incoming: IncomingRequest, wallet: WalletKit, signal: AbortSignal): Promise<void> {
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(ANSWER_TIMEOUT_MS)]);
  const proof = await createProof(incoming, wallet, deadline);
  try {
    await incoming.deliver(proof, deadline);
  } catch (cause) {
    deadline.throwIfAborted();
    if (cause instanceof RequestExpiredError) throw cause;
    throw new WalletOpenError("Could not send the proof. Try again.", { cause });
  }
}

async function createProof(incoming: IncomingRequest, wallet: WalletKit, signal: AbortSignal): Promise<string> {
  if (incoming.unsupportedReason) throw new WalletOpenError(incoming.unsupportedReason);
  await revalidate(incoming, signal);
  const credentials = await checkRequestCredentials(incoming, wallet, signal);
  if (!credentials.satisfied) throw new WalletOpenError("This authenticator does not hold the credentials this request needs.");
  let proof: string;
  try {
    // The RP's requirements, signals, dates and constraints reach WalletKit verbatim.
    proof = await abortable(wallet.generateProof(JSON.stringify(incoming.proof)), signal);
  } catch (cause) {
    signal.throwIfAborted();
    if (isNullifierReplay(cause)) throw new ProofReplayedError("This action was already proved.", { cause });
    throw new WalletOpenError("Could not create the proof. Try again.", { cause });
  }
  checkExpiry(incoming.proof);
  return proof;
}

/** The RP may have been deactivated, or the request may have expired, since the request was opened. */
async function revalidate(incoming: IncomingRequest, signal: AbortSignal) {
  try {
    await incoming.validate(signal);
  } catch (cause) {
    signal.throwIfAborted();
    if (cause instanceof RequestExpiredError) throw cause;
    throw new WalletOpenError("This request could not be verified again. Start a new request at the requesting app.", { cause });
  }
}

function isNullifierReplay(error: unknown): boolean {
  return error instanceof Error && error.name === "WalletKitError" && "code" in error && error.code === "NullifierReplay";
}
