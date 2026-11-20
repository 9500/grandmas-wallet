import { type Output, decodeTransactionBch, hexToBin } from '@bitauth/libauth';
import type { ChainReader, Utxo } from '@grandmas-wallet/core';

/** The coins at a script, read whole from the chain: the coins of a position the wallet's record names (section 13.3). */

const outputsOf = async (chain: ChainReader, transactionId: string): Promise<Output[]> => {
  const raw = await chain.getTransaction(transactionId);
  if (raw === undefined) throw new Error(`The servers do not have transaction ${transactionId}.`);
  const transaction = decodeTransactionBch(hexToBin(raw));
  if (typeof transaction === 'string') throw new Error(`Transaction ${transactionId} cannot be read: ${transaction}`);
  return transaction.outputs;
};

/**
 * The unspent coins at a script, whole.
 * @param category - only coins with a token of this category; a server that lists tokens saves reading the others
 */
export const coinsAt = async (chain: ChainReader, lockingBytecode: Uint8Array, category?: string): Promise<Utxo[]> => {
  const coins: Utxo[] = [];
  const outputs = new Map<string, Output[]>();
  for (const entry of await chain.listUnspent(lockingBytecode)) {
    if (category !== undefined && (!entry.hasToken || (entry.token !== undefined && entry.token.category !== category))) continue;
    const known = outputs.get(entry.transactionId) ?? (await outputsOf(chain, entry.transactionId));
    outputs.set(entry.transactionId, known);
    const output = known[entry.index];
    if (output !== undefined) coins.push({ transactionHash: hexToBin(entry.transactionId), index: entry.index, output });
  }
  return coins;
};
