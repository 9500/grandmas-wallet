import { hexToBin } from '@bitauth/libauth';
import type { Utxo } from '@grandmas-wallet/core';
import { type InterestCoins, type LoanCoins, type ParyonChain, findLoan, firstFactory, interestCoins, latestOraclePrice, loanCoins, readParyonState } from '@grandmas-wallet/paryon';

import { type Desk, type LoanView, type Market, CHIPNET_DESK, DEPLOYMENT, finalLockHeight, lowerPrice, periodOf } from './loan.js';

// What Paryon's service reads too lives in packages/paryon; the page uses it from there.
export { type MadeKey, keyWaiting, readMadeKey } from '@grandmas-wallet/paryon';

/**
 * What the page reads from the chain and, for Paryon's own deployment, from the oracle: Paryon's contracts and
 * prices, a loan from its key, and a loan key it made. Every output is read from its own transaction; a server's listing only finds candidates.
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
export const readMarket = async (chain: PageChain, network: string, oracle: OracleReader | undefined, desk: Desk = CHIPNET_DESK): Promise<Market & { oracleProblem?: string }> => {
  const [{ height }, state] = await Promise.all([chain.tip(), readParyonState(chain, desk.contracts)]);
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
    period: periodOf(lockHeight, desk.deployment),
    borrowing: state.borrowing,
    priceThread,
    stored,
    ...(signed === undefined ? {} : { oracle: { price: signed.price, time: signed.time } }),
    ...(oracle === undefined ? { withoutOracle: true as const } : {}),
    lower: lowerPrice(stored, signed?.price),
    ...(oracleProblem === undefined ? {} : { oracleProblem }),
  };
};

/**
 * A loan key the wallet reported, with what the chain says of its loan. The wallet says only that it holds the key
 * under this page's template; whether the loan is open the page finds out itself, through the loan's sidecar
 * (`findLoan`), which takes a look-alike sidecar beside anything but a genuine loan for none.
 */
export const readLoan = async (chain: PageChain, category: string, keySatoshis: bigint | undefined, desk: Desk = CHIPNET_DESK): Promise<LoanView> => {
  const key = keySatoshis === undefined ? {} : { keySatoshis };
  let found: Awaited<ReturnType<typeof findLoan>>;
  try {
    found = await findLoan(chain, desk.contracts, hexToBin(category));
  } catch {
    return { category, status: 'unknown', satoshis: 0n, ...key };
  }
  if (found === undefined) return { category, status: 'closed', satoshis: 0n, ...key };
  return { category, status: 'open', satoshis: found.loan.output.valueSatoshis, ...key, debt: found.state.borrowed, beingRedeemed: found.state.beingRedeemed, interestRate: found.state.currentInterestRate, nextInterestRate: found.state.nextInterestRate, found };
};

/**
 * What a request on an open loan names: the loan and its sidecar, found from the key, and the price and manage
 * coins of Paryon's the page chose, with what the key's coin holds as the wallet reported it.
 * @throws when the key opens no open loan
 */
export const readLoanCoins = async (chain: PageChain, category: string, keySatoshis: bigint, desk: Desk = CHIPNET_DESK): Promise<LoanCoins> => {
  const coins = await loanCoins(chain, desk.contracts, hexToBin(category), keySatoshis);
  if (coins === undefined) throw new Error('This key opens no loan on the chain just now. It may have been closed.');
  return { keyCategory: category, keySatoshis, loan: coins.loan, sidecar: coins.sidecar, price: coins.price, manageFunction: coins.manageFunction };
};

/**
 * What a request to change a loan's interest rate names: the loan and its sidecar, found from the key, and a coin of
 * Paryon's interest function the page chose, with what the key's coin holds as the wallet reported it.
 * @throws when the key opens no open loan
 */
export const readInterestCoins = async (chain: PageChain, category: string, keySatoshis: bigint, desk: Desk = CHIPNET_DESK): Promise<InterestCoins> => {
  const coins = await interestCoins(chain, desk.contracts, hexToBin(category), keySatoshis);
  if (coins === undefined) throw new Error('This key opens no loan on the chain just now. It may have been closed.');
  return { keyCategory: category, keySatoshis, loan: coins.loan, sidecar: coins.sidecar, interestFunction: coins.interestFunction };
};

/** A coin of Paryon's key factories, for making a key; the first by outpoint. */
export const readFactory = async (chain: PageChain, desk: Desk = CHIPNET_DESK): Promise<Utxo> => {
  const factory = firstFactory(await readParyonState(chain, desk.contracts));
  if (factory === undefined) throw new MarketProblem('Paryon\'s key factory could not be found on the chain just now. Try again in a minute.');
  return factory;
};
