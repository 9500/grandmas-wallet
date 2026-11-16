import type { ChainReader, HistoryEntry, UnspentOutputEntry } from '@grandmas-wallet/core';

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
 * Unspent outputs come from the first server alone: they are what the caller
 * is about to act on, and are best read from the server it will send to.
 */
export class ChainPool implements ChainReader {
  constructor(private readonly servers: ChainReader[]) {
    if (servers.length === 0) throw new Error('At least one server is needed.');
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
    const combined = new Map<string, HistoryEntry>();
    for (const entry of answered.flat()) {
      const known = combined.get(entry.transactionId);
      // Confirmed on any server counts as confirmed.
      if (known === undefined || entry.height > known.height) combined.set(entry.transactionId, entry);
    }
    return [...combined.values()];
  }

  listUnspent(lockingBytecode: Uint8Array): Promise<UnspentOutputEntry[]> {
    return (this.servers[0] as ChainReader).listUnspent(lockingBytecode);
  }
}
