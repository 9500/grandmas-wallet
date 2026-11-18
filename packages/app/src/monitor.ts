import { hexToBin } from '@bitauth/libauth';
import { type ChainReader, type ControllerHistory, readControllerHistory } from '@grandmas-wallet/core';
import { ChainPool } from '@grandmas-wallet/chipnet/pool';

import { hex } from './support.js';

/**
 * Watching a wallet for a recovery request its owner did not ask for.
 *
 * Every check reads the wallet's whole history again from all the servers
 * given and works the status out from nothing, so a change of history (a
 * reorganization, or a transaction replaced by a conflicting one) is followed
 * without any bookkeeping. A script's history is the combination of what the
 * servers report, so one server leaving a request out does not hide it.
 */

export type WatchStatus =
  /** Nothing is asked of the owner. */
  | { kind: 'quiet' }
  /** Someone has asked for the wallet to go to a key this device does not hold. */
  | { kind: 'recovery-requested'; proposedOwnerKeyHash: string; requestedIn: string; confirmed: boolean }
  /** A request is open to a key this device holds: its own takeover. */
  | { kind: 'own-request'; requestedIn: string }
  /** The wallet names an owner key this device does not hold. */
  | { kind: 'owned-elsewhere'; ownerKeyHash: string; ownerEpoch: number }
  /** The owner closed the wallet: its identity no longer exists and nothing can be asked of it. */
  | { kind: 'closed'; closedIn: string; confirmed: boolean };

/** The status that follows from a wallet's history for a device holding the given keys. */
export const assess = (history: ControllerHistory, ownKeyHashes: string[]): WatchStatus => {
  if (history.closed !== undefined) {
    return { kind: 'closed', closedIn: history.closed.transactionId, confirmed: history.closed.confirmed };
  }
  const { state } = history.current;
  const own = new Set(ownKeyHashes);
  if (!own.has(hex(state.ownerKeyHash))) {
    // A device waiting to take over sees its own request before it owns the wallet.
    if (state.proposedOwnerKeyHash !== undefined && own.has(hex(state.proposedOwnerKeyHash))) {
      return { kind: 'own-request', requestedIn: history.transactions.at(-1)?.transactionId ?? '' };
    }
    return { kind: 'owned-elsewhere', ownerKeyHash: hex(state.ownerKeyHash), ownerEpoch: state.ownerEpoch };
  }
  if (state.proposedOwnerKeyHash === undefined) return { kind: 'quiet' };
  const last = history.transactions.at(-1);
  if (own.has(hex(state.proposedOwnerKeyHash))) return { kind: 'own-request', requestedIn: last?.transactionId ?? '' };
  return {
    kind: 'recovery-requested',
    proposedOwnerKeyHash: hex(state.proposedOwnerKeyHash),
    requestedIn: last?.transactionId ?? '',
    confirmed: last?.confirmed ?? false,
  };
};

const sameStatus = (a: WatchStatus | undefined, b: WatchStatus): boolean => a !== undefined && JSON.stringify(a) === JSON.stringify(b);

export interface MonitorOptions {
  /** Two or more servers, so that no single one decides what the owner sees. */
  servers: ChainReader[];
  identity: string;
  genesisTransactionId: string;
  /** Hashes of the keys this device holds for the wallet, as hex. */
  ownKeyHashes: string[];
  /** Called when the status changes, and once at the first check. */
  onStatus: (status: WatchStatus, history: ControllerHistory) => void;
  /** Called when a check could not be made; the previous status stands. */
  onError?: (error: Error) => void;
  /**
   * When set, a request to someone else's key is cancelled without asking. Called once for a request;
   * if the request still shows after `retryAfterMs`, because the cancellation did not stay in the chain,
   * it is called again.
   */
  autoCancel?: () => Promise<unknown>;
  /**
   * Whether `autoCancel` is to be used, asked each time a request is seen, so that a setting the user changes
   * takes effect at the next check. Without it, `autoCancel` is always used.
   */
  autoCancelOn?: () => boolean;
  /** Default 90 seconds. */
  retryAfterMs?: number;
  /** Milliseconds; for tests. */
  now?: () => number;
  /** How often to check when nothing prompts a check. Default 20 seconds. */
  intervalMs?: number;
}

export class Monitor {
  private readonly chain: ChainPool;
  private status: WatchStatus | undefined;
  private timer: ReturnType<typeof setInterval> | undefined;
  private running: Promise<WatchStatus | undefined> | undefined;
  /** Where the controller was when a cancellation was last attempted, and when. */
  private cancelled: { place: string; at: number } | undefined;

  constructor(private readonly options: MonitorOptions) {
    this.chain = new ChainPool(options.servers);
  }

  get current(): WatchStatus | undefined {
    return this.status;
  }

  /** Read the chain and report any change. Checks asked for while one is running join it. */
  check(): Promise<WatchStatus | undefined> {
    this.running ??= this.checkNow().finally(() => {
      this.running = undefined;
    });
    return this.running;
  }

  private async checkNow(): Promise<WatchStatus | undefined> {
    const { options } = this;
    let history: ControllerHistory;
    try {
      history = await readControllerHistory(this.chain, hexToBin(options.identity), options.genesisTransactionId);
    } catch (error) {
      options.onError?.(error as Error);
      return this.status;
    }
    const status = assess(history, options.ownKeyHashes);
    if (!sameStatus(this.status, status)) {
      this.status = status;
      options.onStatus(status, history);
    }
    if (status.kind === 'recovery-requested' && options.autoCancel !== undefined && (options.autoCancelOn?.() ?? true)) {
      // The request is identified by where the controller is now. A cancellation moves the controller on;
      // a request that shows at another place is a new one, and one that stays is tried again after a while.
      const place = `${hex(history.current.utxo.transactionHash)}:${history.current.utxo.index}`;
      const now = options.now?.() ?? Date.now();
      const tried = this.cancelled;
      if (tried === undefined || tried.place !== place || now - tried.at >= (options.retryAfterMs ?? 90_000)) {
        this.cancelled = { place, at: now };
        try {
          await options.autoCancel();
        } catch (error) {
          this.cancelled = undefined;
          options.onError?.(error as Error);
        }
      }
    }
    return this.status;
  }

  /** Check now, and keep checking. */
  start(): void {
    if (this.timer !== undefined) return;
    void this.check();
    this.timer = setInterval(() => void this.check(), this.options.intervalMs ?? 20_000);
  }

  stop(): void {
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
  }
}
