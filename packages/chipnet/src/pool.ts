import type { ChainReader, HistoryEntry, UnspentOutputEntry } from '@grandmas-wallet/core';

/** Servers that do not agree on whether a transaction is in a block. */
export interface ConfirmationDisagreement {
  transactionId: string;
  /** What each server that answered said: the height, 0 or less for unconfirmed, or `undefined` when it did not list the transaction. */
  heights: (number | undefined)[];
}

/**
 * Several servers read as one.
 *
 * A wallet's history should not rest on a single server: one may be unable
 * to return older transactions, and one may leave things out. A transaction
 * is taken from the first server that has it; a script's history is the
 * combination of what every reachable server reports, so an entry is missed
 * only if all of them leave it out. Callers check each transaction against
 * its identifier.
 *
 * A transaction counts as confirmed only when every server that answered
 * lists it at the same height. When they disagree, it is reported as not
 * confirmed and the disagreement is kept for the caller: a confirmation that
 * one server claims and another does not is not treated as final.
 *
 * Unspent outputs come from the first server alone: they are what the caller
 * is about to act on, and are best read from the server it will send to.
 */
export class ChainPool implements ChainReader {
  /** Disagreements seen in the most recent reading of each script's history. */
  private readonly disagreementsByScript = new Map<string, ConfirmationDisagreement[]>();

  constructor(private readonly servers: ChainReader[]) {
    if (servers.length === 0) throw new Error('At least one server is needed.');
  }

  /** Every disagreement about a confirmation that the latest readings showed. */
  get disagreements(): ConfirmationDisagreement[] {
    return [...this.disagreementsByScript.values()].flat();
  }

  async getTransaction(transactionId: string): Promise<string | undefined> {
    for (const server of this.servers) {
      const found = await server.getTransaction(transactionId).catch(() => undefined);
      if (found !== undefined) return found;
    }
    return undefined;
  }

  async getHistory(lockingBytecode: Uint8Array): Promise<HistoryEntry[]> {
    const results = await Promise.allSettled(this.servers.map((server) => server.getHistory(lockingBytecode)));
    const answered = results.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []));
    if (answered.length === 0) throw new Error('No server returned the history.');
    const identifiers = new Set(answered.flat().map((entry) => entry.transactionId));
    const combined: HistoryEntry[] = [];
    const disagreements: ConfirmationDisagreement[] = [];
    for (const transactionId of identifiers) {
      const heights = answered.map((history) => history.find((entry) => entry.transactionId === transactionId)?.height);
      const [first] = heights;
      const agreed = first !== undefined && first > 0 && heights.every((height) => height === first);
      const anyConfirmed = heights.some((height) => height !== undefined && height > 0);
      if (anyConfirmed && !agreed) disagreements.push({ transactionId, heights });
      combined.push({ transactionId, height: agreed ? (first as number) : Math.min(0, ...heights.filter((height): height is number => height !== undefined && height <= 0)) });
    }
    this.disagreementsByScript.set(lockingBytecode.join(','), disagreements);
    return combined;
  }

  listUnspent(lockingBytecode: Uint8Array): Promise<UnspentOutputEntry[]> {
    return (this.servers[0] as ChainReader).listUnspent(lockingBytecode);
  }
}
