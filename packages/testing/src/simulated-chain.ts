import {
  type Output,
  binToHex,
  decodeTransactionBch,
  encodeTransactionBch,
  hashTransactionUiOrder,
  hexToBin,
} from '@bitauth/libauth';
import { type ChainReader, type HistoryEntry, type UnspentOutputEntry, type Utxo, verifyTransaction } from '@grandmas-wallet/core';

export type BroadcastResult = { accepted: true; transactionId: string } | { accepted: false; reason: string };

/**
 * A stand-in for the network: keeps a set of unspent outputs, checks every
 * submitted transaction with the same rules as the real network scripts, and
 * enforces relative and absolute time locks against a clock the test controls.
 */
export class SimulatedChain implements ChainReader {
  nowMs = 1_800_000_000_000;
  broadcasts = 0;
  /** Fail the n-th broadcast: 'before' loses the transaction, 'after' accepts it but loses the reply. */
  failure?: { at: number; when: 'before' | 'after' };
  private readonly unspent = new Map<string, { output: Output; createdMs: number }>();
  private readonly transactions = new Map<string, string>();
  private readonly history = new Map<string, Set<string>>();

  private remember(lockingBytecode: Uint8Array, transactionId: string): void {
    const script = binToHex(lockingBytecode);
    this.history.set(script, (this.history.get(script) ?? new Set<string>()).add(transactionId));
  }

  /**
   * Put coins at a script, as an output of a new transaction. Returns that transaction's identifier.
   * @param outputIndex - the position of the output; the outputs before it carry data only
   */
  fund(lockingBytecode: Uint8Array, valueSatoshis: bigint, outputIndex = 0): string {
    const encoded = encodeTransactionBch({
      version: 2,
      locktime: 0,
      inputs: [
        {
          outpointTransactionHash: new Uint8Array(32).fill(this.transactions.size + 1),
          outpointIndex: 3,
          sequenceNumber: 0,
          unlockingBytecode: new Uint8Array(0),
        },
      ],
      outputs: [
        ...Array.from({ length: outputIndex }, () => ({ lockingBytecode: Uint8Array.of(0x6a), valueSatoshis: 0n })),
        { lockingBytecode, valueSatoshis },
      ],
    });
    const transactionId = binToHex(hashTransactionUiOrder(encoded));
    this.transactions.set(transactionId, binToHex(encoded));
    this.unspent.set(`${transactionId}:${outputIndex}`, { output: { lockingBytecode, valueSatoshis }, createdMs: this.nowMs });
    this.remember(lockingBytecode, transactionId);
    return transactionId;
  }

  /**
   * Take in outputs that exist elsewhere, such as a recorded snapshot of another chain, under their own
   * outpoints. Each is given a transaction of its own here, made of data outputs and the output at its index;
   * reading that transaction gives the output, though it does not hash to the outpoint's identifier.
   */
  adopt(outputs: { transactionId: string; index: number; output: Output }[]): void {
    const byTransaction = new Map<string, { index: number; output: Output }[]>();
    for (const { transactionId, index, output } of outputs) byTransaction.set(transactionId, [...(byTransaction.get(transactionId) ?? []), { index, output }]);
    for (const [transactionId, entries] of byTransaction) {
      const length = Math.max(...entries.map(({ index }) => index)) + 1;
      const all = Array.from({ length }, (_, index): Output => entries.find((entry) => entry.index === index)?.output ?? { lockingBytecode: Uint8Array.of(0x6a), valueSatoshis: 0n });
      const encoded = encodeTransactionBch({
        version: 2,
        locktime: 0,
        inputs: [{ outpointTransactionHash: hexToBin(transactionId), outpointIndex: 0xffff, sequenceNumber: 0, unlockingBytecode: new Uint8Array(0) }],
        outputs: all,
      });
      this.transactions.set(transactionId, binToHex(encoded));
      for (const { index, output } of entries) {
        this.unspent.set(`${transactionId}:${index}`, { output, createdMs: this.nowMs });
        this.remember(output.lockingBytecode, transactionId);
      }
    }
  }

  balanceOf(lockingBytecode: Uint8Array): bigint {
    const wanted = binToHex(lockingBytecode);
    return [...this.unspent.values()]
      .filter(({ output }) => binToHex(output.lockingBytecode) === wanted)
      .reduce((sum, { output }) => sum + output.valueSatoshis, 0n);
  }

  totalValue(): bigint {
    return [...this.unspent.values()].reduce((sum, { output }) => sum + output.valueSatoshis, 0n);
  }

  listUnspent = async (lockingBytecode: Uint8Array): Promise<UnspentOutputEntry[]> => {
    const wanted = binToHex(lockingBytecode);
    return [...this.unspent.entries()]
      .filter(([, { output }]) => binToHex(output.lockingBytecode) === wanted)
      .map(([outpoint, { output }]) => {
        const [transactionId = '', index = '0'] = outpoint.split(':');
        return { transactionId, index: Number(index), valueSatoshis: output.valueSatoshis, height: 0, hasToken: output.token !== undefined, ...(output.token === undefined ? {} : { token: { category: binToHex(output.token.category) } }) };
      });
  };

  getHistory = async (lockingBytecode: Uint8Array): Promise<HistoryEntry[]> =>
    [...(this.history.get(binToHex(lockingBytecode)) ?? [])].map((transactionId) => ({ transactionId, height: 1 }));

  /** The unspent outputs at a script, with their full contents. */
  outputsAt(lockingBytecode: Uint8Array): Utxo[] {
    const wanted = binToHex(lockingBytecode);
    return [...this.unspent.entries()]
      .filter(([, { output }]) => binToHex(output.lockingBytecode) === wanted)
      .map(([outpoint, { output }]) => {
        const [transactionId = '', index = '0'] = outpoint.split(':');
        return { transactionHash: hexToBin(transactionId), index: Number(index), output };
      });
  }

  getTransaction = async (transactionId: string): Promise<string | undefined> => this.transactions.get(transactionId);

  broadcast = async (transactionHex: string): Promise<BroadcastResult> => {
    this.broadcasts += 1;
    const failing = this.failure?.at === this.broadcasts ? this.failure.when : undefined;
    if (failing === 'before') throw new Error('connection lost');
    const result = this.submit(transactionHex);
    if (failing === 'after') throw new Error('connection lost');
    return result;
  };

  /** Check a transaction as the network would and, if valid, apply it. */
  submit(transactionHex: string): BroadcastResult {
    const encoded = hexToBin(transactionHex);
    const transaction = decodeTransactionBch(encoded);
    if (typeof transaction === 'string') return { accepted: false, reason: transaction };
    const transactionId = binToHex(hashTransactionUiOrder(encoded));
    if (this.transactions.has(transactionId)) return { accepted: false, reason: 'transaction already in block chain' };

    const outpoints = transaction.inputs.map((input) => `${binToHex(input.outpointTransactionHash)}:${input.outpointIndex}`);
    const sources = outpoints.map((outpoint) => this.unspent.get(outpoint));
    if (sources.some((source) => source === undefined)) return { accepted: false, reason: 'bad-txns-inputs-missingorspent' };
    const spent = sources as { output: Output; createdMs: number }[];

    const check = verifyTransaction({ transaction, sourceOutputs: spent.map(({ output }) => output) });
    if (check !== true) return { accepted: false, reason: `mandatory-script-verify-flag-failed (${check})` };

    if (transaction.locktime >= 500_000_000 && transaction.locktime >= this.nowMs / 1000) {
      return { accepted: false, reason: 'non-final' };
    }
    for (const [index, input] of transaction.inputs.entries()) {
      const sequence = input.sequenceNumber;
      if ((sequence & 0x80000000) !== 0 || (sequence & 0x40ffff) === 0) continue;
      const seconds = (sequence & 0x400000) !== 0 ? (sequence & 0xffff) * 512 : (sequence & 0xffff) * 600;
      if (this.nowMs - (spent[index]?.createdMs ?? 0) < seconds * 1000) {
        return { accepted: false, reason: 'non-BIP68-final' };
      }
    }

    outpoints.forEach((outpoint) => this.unspent.delete(outpoint));
    spent.forEach(({ output }) => this.remember(output.lockingBytecode, transactionId));
    transaction.outputs.forEach((output, index) => {
      this.unspent.set(`${transactionId}:${index}`, { output, createdMs: this.nowMs });
      this.remember(output.lockingBytecode, transactionId);
    });
    this.transactions.set(transactionId, transactionHex);
    return { accepted: true, transactionId };
  }
}

