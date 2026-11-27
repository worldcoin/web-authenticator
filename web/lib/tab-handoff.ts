import { WalletBusyElsewhereError, WalletTakenOverError } from "./wallet-errors";

/**
 * Which tab owns the open wallet. WalletKit keeps its vault in the origin private file system
 * behind an exclusive sync access handle, so only one tab at a time can run its worker.
 *
 * - `world-id-wallet-open-v1` is held for as long as a tab's WalletKit worker runs. A tab that
 *   opens the wallet takes it with `steal`; the previous holder's request rejects, and that tab
 *   terminates its worker, which releases the storage handle.
 * - `world-id-wallet-busy-v1` is held by the owner while a capture, issuance or proof runs, and
 *   by a claiming tab while it steals. A tab never steals from a busy owner, and an owner whose
 *   takeover has started cannot become busy.
 *
 * Only locks cross tabs: no wallet secret or state is shared.
 */
const OPEN_LOCK = "world-id-wallet-open-v1";
const BUSY_LOCK = "world-id-wallet-busy-v1";

export interface WalletTenure {
  /** Aborts with a `WalletTakenOverError` when another tab takes the wallet. */
  readonly lost: AbortSignal;
  /** Whether another tab had the wallet open, so its worker may still be closing. */
  readonly displaced: boolean;
  /**
   * Makes other tabs refuse to take the wallet until the returned function is called, or the
   * tenure is released. Rejects with a `WalletTakenOverError` once a takeover has started or
   * the tenure is released.
   */
  holdBusy(): Promise<() => void>;
  /** Gives up the wallet and any busy hold. Call after terminating the worker. */
  release(): void;
}

/**
 * Whether another tab is in a capture, issuance or proof. Advisory, so a tab can refuse before
 * prompting for a passkey; `claimWallet` decides.
 */
export async function walletBusyElsewhere(): Promise<boolean> {
  const { held = [] } = await navigator.locks.query();
  return held.some(lock => lock.name === BUSY_LOCK);
}

/**
 * Takes the wallet from any tab that holds it. Resolves once this tab owns it; the caller can
 * then start WalletKit. Rejects with a `WalletBusyElsewhereError` if the owner is busy.
 */
export async function claimWallet(): Promise<WalletTenure> {
  return navigator.locks.request(BUSY_LOCK, { ifAvailable: true }, async gate => {
    if (gate === null) throw new WalletBusyElsewhereError();
    const lost = new AbortController();
    const { held: locks = [] } = await navigator.locks.query();
    const displaced = locks.some(lock => lock.name === OPEN_LOCK);
    let released = false;
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    let granted = false;
    let owned!: () => void;
    const ownership = new Promise<void>(resolve => { owned = resolve; });
    // After the grant this rejects only when another tab steals the lock; a release resolves it.
    const request = navigator.locks.request(OPEN_LOCK, { steal: true }, () => { granted = true; owned(); return held; });
    request.catch(() => { if (granted) lost.abort(new WalletTakenOverError()); });
    // A request that fails before its grant rejects the claim and frees the busy gate.
    await Promise.race([ownership, request]);
    const holds = new Set<() => void>();
    return {
      lost: lost.signal,
      displaced,
      holdBusy: async () => {
        if (released) throw new WalletTakenOverError();
        if (holds.size > 0) throw new Error("This tab is already busy.");
        let done!: () => void;
        const finished = new Promise<void>(resolve => { done = resolve; });
        let acquired!: () => void;
        const ready = new Promise<void>(resolve => { acquired = resolve; });
        const request = navigator.locks.request(BUSY_LOCK, { ifAvailable: true }, lock => {
          // The busy lock is free unless a tab is claiming: that tab takes the wallet next.
          if (lock === null || lost.signal.aborted) throw new WalletTakenOverError();
          acquired();
          return finished;
        });
        await Promise.race([ready, request]);
        const releaseHold = () => { holds.delete(releaseHold); done(); };
        // Released while acquiring: give the busy lock straight back.
        if (released) { done(); throw new WalletTakenOverError(); }
        holds.add(releaseHold);
        return releaseHold;
      },
      release: () => {
        released = true;
        for (const releaseHold of holds) releaseHold();
        release();
      },
    };
  });
}
