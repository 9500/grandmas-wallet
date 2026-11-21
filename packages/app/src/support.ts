import {
  type TransactionCommon,
  binToHex,
  cashAddressToLockingBytecode,
  decodeTransactionBch,
  hexToBin,
  lockingBytecodeToCashAddress,
} from '@bitauth/libauth';
import { type ChainReader, type ChallengeDelay, type Utxo, encodeChallengeDelay, testAddressPrefix } from '@grandmas-wallet/core';

/**
 * What the wallet's and the recoverer's actions share: amounts, addresses and
 * reading spent outputs.
 */

/** What the applications need from a server besides a wallet's history. */
export interface AppChain extends ChainReader {
  tip(): Promise<{ height: number; time: number }>;
  /** Timestamp of the block at a height, Unix seconds. */
  headerTime(height: number): Promise<number>;
  /**
   * How many of this network's blocks make up one block of a block-counted delay: 1 with ten-minute blocks,
   * 10 with one-minute blocks. Default 1.
   */
  blocksPerDelayBlock?: number;
}

export const CONTROLLER_SATOSHIS = 1_000n;
/** The smallest output the network relays. */
export const DUST = 546n;

export const hex = (bytes: Uint8Array): string => binToHex(bytes);
export const sats = (amount: bigint): string => `${amount}n`;
export const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

export const delayHex = (delay: ChallengeDelay): string => {
  const sequence = encodeChallengeDelay(delay);
  return hex(Uint8Array.of(sequence & 0xff, (sequence >> 8) & 0xff, (sequence >> 16) & 0xff));
};

export const addressOf = (lockingBytecode: string | Uint8Array, network = 'chipnet'): string => {
  const bytecode = typeof lockingBytecode === 'string' ? hexToBin(lockingBytecode) : lockingBytecode;
  const result = lockingBytecodeToCashAddress({ prefix: network === 'mainnet' ? 'bitcoincash' : testAddressPrefix(), bytecode });
  return typeof result === 'string' ? result : result.address;
};

/** @throws if the text is not an address of the given network */
export const lockingBytecodeOf = (address: string, network = 'chipnet'): Uint8Array => {
  const prefix = network === 'mainnet' ? 'bitcoincash' : testAddressPrefix();
  const decoded = cashAddressToLockingBytecode(address.includes(':') ? address.trim() : `${prefix}:${address.trim()}`);
  if (typeof decoded === 'string') throw new Error('That is not a valid address.');
  if (decoded.prefix !== prefix) throw new Error(`That address is for another network; this wallet is on ${network}.`);
  return decoded.bytecode;
};

export const decodeTransaction = (transactionHex: string): TransactionCommon => {
  const transaction = decodeTransactionBch(hexToBin(transactionHex));
  if (typeof transaction === 'string') throw new Error(transaction);
  return transaction;
};

export const fetchUtxo = async (chain: ChainReader, transactionId: string, index: number): Promise<Utxo> => {
  const source = await chain.getTransaction(transactionId);
  if (source === undefined) throw new Error(`Transaction ${transactionId} could not be found.`);
  const output = decodeTransaction(source).outputs[index];
  if (output === undefined) throw new Error(`Transaction ${transactionId} has no output ${index}.`);
  return { transactionHash: hexToBin(transactionId), index, output };
};

export const outpointOf = (utxo: Utxo): { transactionId: string; index: number } => ({ transactionId: hex(utxo.transactionHash), index: utxo.index });

/** The network refused a transaction because a time lock or waiting period has not yet passed. */
export class NotYetValidError extends Error {
  /** @param detail - what the network or the engine said */
  constructor(readonly detail: string) {
    super('The network does not accept this yet: a waiting period has not passed.');
    this.name = 'NotYetValidError';
  }
}

/** Small values kept between sessions, such as a receiving address. */
export interface Memory {
  get(name: string): string | undefined;
  set(name: string, value: string): void;
}
