import { readFileSync } from 'node:fs';

import { type Output, type TransactionCommon, binToHex, decodeTransactionBch, encodeTransactionBch, hexToBin } from '@bitauth/libauth';
import type { BuiltTransaction, Utxo } from '@grandmas-wallet/core';

import type { ListedOutput, ParyonServiceChain } from '../src/index.js';

/**
 * Paryon's live outputs as they were recorded from a server (fixtures/), and a chain made of them for tests of the
 * service: its library here, its server in apps/paryon-service.
 */

export interface RecordedOutput {
  transactionId: string;
  index: number;
  height: number;
  valueSatoshis: string;
  lockingBytecode: string;
  token?: { category: string; amount: string; nft?: { capability: 'none' | 'mutable' | 'minting'; commitment: string } };
}

export type RecordedDeployment = Record<'borrowing' | 'price' | 'loanKeyFactory' | 'manage' | 'changeInterest', RecordedOutput[]> & { tip: { height: number } };

/** The outputs recorded for one of Paryon's own deployments, by its network. */
export const recordedDeployment = (network: string): RecordedDeployment => JSON.parse(readFileSync(new URL(`fixtures/${network}-live.json`, import.meta.url), 'utf8')) as RecordedDeployment;

/** Every output recorded, of every kind. */
export const recordedOutputs = (recorded: RecordedDeployment): RecordedOutput[] => [...recorded.borrowing, ...recorded.price, ...recorded.loanKeyFactory, ...recorded.manage, ...recorded.changeInterest];

export const outputOf = (entry: RecordedOutput): Output => ({
  lockingBytecode: hexToBin(entry.lockingBytecode),
  valueSatoshis: BigInt(entry.valueSatoshis),
  ...(entry.token === undefined
    ? {}
    : { token: { category: hexToBin(entry.token.category), amount: BigInt(entry.token.amount), ...(entry.token.nft === undefined ? {} : { nft: { capability: entry.token.nft.capability, commitment: hexToBin(entry.token.nft.commitment) } }) } }),
});

/**
 * A chain of the recorded outputs and the transactions a test adds. A recorded output's transaction is not recorded: the
 * chain makes one up that has the output at its index, which is all a reader takes from it.
 */
export class FixtureChain implements ParyonServiceChain {
  private readonly transactions = new Map<string, string>();
  private readonly unspent = new Map<string, { utxo: Utxo; height: number }>();

  constructor(
    outputs: RecordedOutput[],
    readonly height: number,
  ) {
    for (const entry of outputs) this.adopt({ transactionHash: hexToBin(entry.transactionId), index: entry.index, output: outputOf(entry) }, entry.height);
  }

  /** A coin, with a made-up transaction that holds it. */
  adopt(utxo: Utxo, height = 1): void {
    const transactionId = binToHex(utxo.transactionHash);
    const known = this.transactions.get(transactionId);
    const outputs: Output[] = [];
    if (known !== undefined) {
      const decoded = this.decoded(known);
      outputs.push(...decoded.outputs);
    }
    while (outputs.length <= utxo.index) outputs.push({ lockingBytecode: Uint8Array.of(0x6a), valueSatoshis: 0n });
    outputs[utxo.index] = utxo.output;
    const transaction: TransactionCommon = { version: 2, inputs: [{ outpointTransactionHash: new Uint8Array(32), outpointIndex: 0, sequenceNumber: 0, unlockingBytecode: new Uint8Array() }], outputs, locktime: 0 };
    this.transactions.set(transactionId, binToHex(encodeTransactionBch(transaction)));
    this.unspent.set(`${transactionId}:${utxo.index}`, { utxo, height });
  }

  private decoded(text: string): TransactionCommon {
    const transaction = decodeTransactionBch(hexToBin(text));
    if (typeof transaction === 'string') throw new Error(transaction);
    return transaction;
  }

  add(built: BuiltTransaction): void {
    for (const input of built.transaction.inputs) this.unspent.delete(`${binToHex(input.outpointTransactionHash)}:${input.outpointIndex}`);
    built.transaction.outputs.forEach((output, index) => this.unspent.set(`${built.transactionId}:${index}`, { utxo: { transactionHash: built.transactionHash, index, output }, height: 0 }));
    this.transactions.set(built.transactionId, binToHex(encodeTransactionBch(built.transaction)));
  }

  async tip(): Promise<{ height: number }> {
    return { height: this.height };
  }

  async getTransaction(transactionId: string): Promise<string | undefined> {
    return this.transactions.get(transactionId);
  }

  async listUnspent(lockingBytecode: Uint8Array): Promise<ListedOutput[]> {
    return [...this.unspent.values()]
      .filter(({ utxo }) => binToHex(utxo.output.lockingBytecode) === binToHex(lockingBytecode))
      .map(({ utxo, height }) => ({ transactionId: binToHex(utxo.transactionHash), index: utxo.index, valueSatoshis: utxo.output.valueSatoshis, height }));
  }
}
