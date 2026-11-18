import { type Output, binToHex, decodeTransactionBch, hexToBin } from '@bitauth/libauth';
import type { Utxo } from '@grandmas-wallet/core';
import { type ListedOutput, type ParyonChain, findLoan, latestOraclePrice, readParyonState } from '@grandmas-wallet/paryon';

import { type LoanView, type Market, CONTRACTS, DEPLOYMENT, finalLockHeight, lowerPrice, periodOf } from './loan.js';

/**
 * What the page reads from the chain and from the oracle: Paryon's contracts and prices, a loan from its key,
 * and a loan key it made. Every output is read from its own transaction; a server's listing only finds candidates.
 */

/** What the page needs of a server. */
export interface PageChain extends ParyonChain {
  tip(): Promise<{ height: number }>;
}

/** The oracle's latest price; `undefined` where it is not used (on a chain of one's own). */
export type OracleReader = () => Promise<{ price: bigint; time: number }>;

export const generalProtocolsOracle: OracleReader = () => latestOraclePrice(DEPLOYMENT);

export class MarketProblem extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MarketProblem';
  }
}

/**
 * Paryon's contracts and prices as they stand.
 * @throws MarketProblem if the deployment shows no contract of a kind a loan needs
 */
export const readMarket = async (chain: PageChain, network: string, oracle: OracleReader | undefined): Promise<Market & { oracleProblem?: string }> => {
  const [{ height }, state] = await Promise.all([chain.tip(), readParyonState(chain, CONTRACTS)]);
  if (state.borrowing.length === 0 || state.price.length === 0) throw new MarketProblem('Paryon\'s contracts could not be found on the chain just now. Try again in a minute.');
  const priceThread = state.price.slice().sort((a, b) => (b.state.price > a.state.price ? 1 : b.state.price < a.state.price ? -1 : 0))[0] as Market['priceThread'];
  const stored = state.price.reduce((lowest, thread) => (thread.state.price < lowest ? thread.state.price : lowest), priceThread.state.price);
  let signed: { price: bigint; time: number } | undefined;
  let oracleProblem: string | undefined;
  if (oracle !== undefined) {
    try {
      signed = await oracle();
    } catch (error) {
      oracleProblem = `The oracle's latest price could not be read (${(error as Error).message}).`;
    }
  }
  const lockHeight = finalLockHeight(network, height);
  return {
    height,
    lockHeight,
    period: periodOf(lockHeight),
    borrowing: state.borrowing,
    priceThread,
    stored,
    ...(signed === undefined ? {} : { oracle: { price: signed.price, time: signed.time } }),
    lower: lowerPrice(stored, signed?.price),
    ...(oracleProblem === undefined ? {} : { oracleProblem }),
  };
};

/** A loan the wallet reported, with what the chain says of it. */
export const readLoan = async (chain: PageChain, category: string, reported: { status: string; satoshis: bigint }): Promise<LoanView> => {
  if (reported.status !== 'open') return { category, status: reported.status === 'closed' ? 'closed' : 'unknown', satoshis: reported.satoshis };
  const found = await findLoan(chain, CONTRACTS, hexToBin(category));
  if (found === undefined) return { category, status: 'closed', satoshis: 0n };
  return { category, status: 'open', satoshis: found.loan.output.valueSatoshis, debt: found.state.borrowed, beingRedeemed: found.state.beingRedeemed, interestRate: found.state.currentInterestRate, found };
};

/** A loan key the page had the wallet make, read back from the transaction that made it. */
export interface MadeKey {
  category: string;
  transactionId: string;
  /** Outputs 2 and 3 of that transaction: the new key, waiting in Paryon's contract, and its proof of origin. */
  enforcer: Utxo;
  proof: Utxo;
}

/** The key a transaction made: its category is the identifier of the transaction whose output the wallet spent first. */
export const readMadeKey = async (chain: PageChain, transactionId: string): Promise<MadeKey> => {
  const text = await chain.getTransaction(transactionId);
  if (text === undefined) throw new Error('The transaction that made the loan key is not known to the server yet.');
  const transaction = decodeTransactionBch(hexToBin(text));
  if (typeof transaction === 'string') throw new Error(transaction);
  const [first] = transaction.inputs;
  if (first === undefined) throw new Error('The transaction that made the loan key has no inputs.');
  const at = (index: number): Utxo => ({ transactionHash: hexToBin(transactionId), index, output: transaction.outputs[index] as Output });
  return { category: binToHex(first.outpointTransactionHash), transactionId, enforcer: at(2), proof: at(3) };
};

/** Whether a key the page made is still waiting to be used: its two outputs unspent. */
export const keyWaiting = async (chain: PageChain, key: MadeKey): Promise<boolean> => {
  const listed = async (utxo: Utxo): Promise<boolean> =>
    (await chain.listUnspent(utxo.output.lockingBytecode)).some((entry: ListedOutput) => entry.transactionId === binToHex(utxo.transactionHash) && entry.index === utxo.index);
  const [enforcer, proof] = await Promise.all([listed(key.enforcer), listed(key.proof)]);
  return enforcer && proof;
};
