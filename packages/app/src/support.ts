import {
  type Output,
  type TransactionCommon,
  binToHex,
  cashAddressToLockingBytecode,
  decodeTransactionBch,
  hexToBin,
  lockingBytecodeToCashAddress,
} from '@bitauth/libauth';
import { type ChainReader, type ChallengeDelay, type Utxo, encodeChallengeDelay, verifyTransaction } from '@grandmas-wallet/core';

import type { Built, XoAccount } from './account.js';

/**
 * What the wallet's and the recoverer's actions share: fees, reading spent
 * outputs, and the check every engine-built transaction passes before it is
 * sent.
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
/** The least the wallet keeps at its own address, whose outputs are larger than ordinary ones and so have a higher minimum (576). */
export const FUNDS_MINIMUM = 600n;
// Fees are set per kind of transaction from their measured sizes, at a little over one satoshi per byte.
/** Owner actions that spend the controller and one output of wallet funds: about 1,100 bytes. */
export const OWNER_ACTION_FEE = 1_120n;
/** Each further output of wallet funds spent adds about 141 bytes. */
export const EXTRA_FUNDS_FEE = 150n;
/** Recoverer actions and changes of settings, which spend the controller and one ordinary coin: under 1,020 bytes. */
export const CONTROLLER_ONLY_FEE = 1_030n;
/** Creating the wallet: about 350 bytes. */
export const CREATE_FEE = 360n;
/** An ordinary one-input payment: under 200 bytes. */
export const COIN_FEE = 200n;
/** Each ordinary coin spent beyond the first adds about 141 bytes; each further output about 34. */
export const EXTRA_COIN_FEE = 150n;
export const EXTRA_OUTPUT_FEE = 40n;

/** Fee for a transaction that spends the controller and the given ordinary coins. */
export const controllerFee = (coins: unknown[]): bigint => CONTROLLER_ONLY_FEE + EXTRA_COIN_FEE * BigInt(Math.max(coins.length - 1, 0));

/**
 * What a wallet sets aside for its recoverer's fees: enough for three requests and one completion, so that
 * requests the owner cancels do not leave the recoverer unable to act. A recoverer can add to it at any time.
 */
export const RECOVERER_FEE_ALLOWANCE = 4n * CONTROLLER_ONLY_FEE + DUST;

export const hex = (bytes: Uint8Array): string => binToHex(bytes);
export const sats = (amount: bigint): string => `${amount}n`;
export const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

export const delayHex = (delay: ChallengeDelay): string => {
  const sequence = encodeChallengeDelay(delay);
  return hex(Uint8Array.of(sequence & 0xff, (sequence >> 8) & 0xff, (sequence >> 16) & 0xff));
};

export const addressOf = (lockingBytecode: string | Uint8Array, network = 'chipnet'): string => {
  const bytecode = typeof lockingBytecode === 'string' ? hexToBin(lockingBytecode) : lockingBytecode;
  const result = lockingBytecodeToCashAddress({ prefix: network === 'mainnet' ? 'bitcoincash' : 'bchtest', bytecode });
  return typeof result === 'string' ? result : result.address;
};

/** @throws if the text is not an address of the given network */
export const lockingBytecodeOf = (address: string, network = 'chipnet'): Uint8Array => {
  const prefix = network === 'mainnet' ? 'bitcoincash' : 'bchtest';
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

/** Wait until an account's engine has registered the given outputs, which lags the network slightly. */
export const waitUntilSeen = async (account: XoAccount, outpoints: { transactionId: string; index: number }[], attempts = 40): Promise<void> => {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const known = new Set((await account.unspent()).map(({ transactionId, index }) => `${transactionId}:${index}`));
    if (outpoints.every(({ transactionId, index }) => known.has(`${transactionId}:${index}`))) return;
    await sleep(1_500);
  }
  throw new Error('The wallet has not yet registered its latest coins. Please try again in a moment.');
};

/** The network refused a transaction because a time lock or waiting period has not yet passed. */
export class NotYetValidError extends Error {
  /** @param detail - what the network or the engine said */
  constructor(readonly detail: string) {
    super('The network does not accept this yet: a waiting period has not passed.');
    this.name = 'NotYetValidError';
  }
}

export interface Sent {
  transactionId: string;
  transaction: TransactionCommon;
  /** The finished invitation, serialized. */
  invitation: string;
  invitationIdentifier: string;
}

/**
 * Check a transaction the engine built against the network's script rules and the relay fee, then send it.
 * Nothing is sent unless every input is signed and the transaction passes this project's own evaluation.
 *
 * @throws NotYetValidError if the network refuses it only because it is early
 */
export const checkAndSend = async (account: XoAccount, chain: ChainReader, built: Built): Promise<Sent> => {
  try {
    return await checkAndSendNow(account, chain, built);
  } catch (error) {
    // What was not sent must not keep holding the coins it would have spent.
    await account.discard(built.invitationIdentifier);
    throw error;
  }
};

const checkAndSendNow = async (account: XoAccount, chain: ChainReader, built: Built): Promise<Sent> => {
  const transaction = decodeTransaction(built.transactionHex);
  const unsigned = (built.missing as { inputsMissingSignatures?: unknown[] } | undefined)?.inputsMissingSignatures ?? [];
  if (unsigned.length > 0) throw new Error(`${unsigned.length} input(s) were left unsigned.`);
  const sourceOutputs: Output[] = [];
  for (const input of transaction.inputs) {
    sourceOutputs.push((await fetchUtxo(chain, hex(input.outpointTransactionHash), input.outpointIndex)).output);
  }
  const check = verifyTransaction({ transaction, sourceOutputs });
  if (check !== true) throw new Error(`The transaction does not pass the wallet's own check: ${check}`);
  const fee = sourceOutputs.reduce((sum, output) => sum + output.valueSatoshis, 0n) - transaction.outputs.reduce((sum, output) => sum + output.valueSatoshis, 0n);
  const size = BigInt(built.transactionHex.length / 2);
  if (fee < size) throw new Error(`The fee of ${fee} satoshis is too low for a transaction of ${size} bytes.`);
  if (fee > size * 3n + 2_000n) throw new Error(`The fee of ${fee} satoshis is far more than a transaction of ${size} bytes needs.`);

  let invitation: string;
  try {
    ({ invitation } = await account.broadcast(built.invitationIdentifier));
  } catch (error) {
    if (/non-?final|bip68/i.test((error as Error).message)) throw new NotYetValidError((error as Error).message);
    throw error;
  }
  // The engine's list of coins trails a broadcast; wait until it no longer offers what was just spent.
  const spent = new Set(transaction.inputs.map((input) => `${hex(input.outpointTransactionHash)}:${input.outpointIndex}`));
  for (let attempt = 0; attempt < 40; attempt++) {
    const unspent = await account.unspent();
    if (!unspent.some((output) => spent.has(`${output.transactionId}:${output.index}`))) break;
    await sleep(1_000);
  }
  // The engine sends through its own servers; wait until the servers this application reads from show the
  // transaction too, so that what is read next is not the state from before it.
  const [first] = transaction.outputs;
  for (let attempt = 0; first !== undefined && attempt < 30; attempt++) {
    const history = await chain.getHistory(first.lockingBytecode).catch(() => []);
    if (history.some((entry) => entry.transactionId === built.transactionId)) break;
    await sleep(1_000);
  }
  return { transactionId: built.transactionId, transaction, invitation, invitationIdentifier: built.invitationIdentifier };
};
