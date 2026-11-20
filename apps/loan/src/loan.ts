import {
  type BorrowingThread,
  type FoundLoan,
  type ParyonDeployment,
  type PriceThread,
  CHIPNET_FAST_PERIODS_6,
  MINIMUM_DEBT,
  borrowingFee,
  collateralAtRatio,
  collateralRatio,
  minimumCollateral,
  paryonContracts,
  paryonTemplateAlone,
  periodAt,
  repaymentAllowed,
} from '@grandmas-wallet/paryon';

/**
 * What the loan page works out by itself: the template it sends, the prices it reckons with, whether the
 * contracts need bringing up to date, how much collateral a loan takes, and which repayments the contracts
 * allow. Nothing here reads the chain or speaks to a wallet; `market.ts` and `xo.ts` do.
 *
 * Amounts: debts and repayments in PUSD cents, prices in US cents per BCH, collateral and fees in satoshis.
 */

/** The deployment of Paryon's public contracts this page uses: their test deployment on chipnet. */
export const DEPLOYMENT: ParyonDeployment = CHIPNET_FAST_PERIODS_6;
export const CONTRACTS = paryonContracts(DEPLOYMENT);

/**
 * The template, as a wallet is sent it, and the names a request gives it. It goes alone, with no recovery
 * declaration (proposal section 15.3): what the declaration told the wallet, the page's requests now say.
 */
export const LOAN_TEMPLATE = paryonTemplateAlone(CONTRACTS);

/** What the page proposes: collateral worth 125% of the debt at the lower of the two prices. */
export const DEFAULT_PERCENT = 125;
/** Below this, at the lower of the two prices, the page refuses to borrow or to take collateral out. */
export const SAFE_PERCENT = 115;
/** What the coin that carries the loan key holds, and the one that carries the PUSD. They come with the loan. */
export const KEY_SATOSHIS = 1_000n;
export const TOKEN_SATOSHIS = 1_000n;
/** What one interest payment for a missed period may take from a loan's collateral (`payInterest.cash`). */
export const MISSED_PERIOD_FEE = 1_500n;

// ------------------------------------------------------------------ amounts as people type them

/** PUSD cents as dollars and cents: 10000 → "100.00". */
export const formatPusd = (cents: bigint): string => {
  const negative = cents < 0n;
  const value = negative ? -cents : cents;
  return `${negative ? '−' : ''}${(value / 100n).toLocaleString('en-US')}.${(value % 100n).toString().padStart(2, '0')}`;
};

/** A price in US cents as dollars: 20867 → "$208.67". */
export const formatPrice = (cents: bigint): string => `$${formatPusd(cents)}`;

/** An amount of PUSD as typed, in cents, or the reason it cannot be read. */
export const parsePusd = (text: string): bigint | string => {
  const cleaned = text.trim().replace(/[,\s]/g, '').replace(/^\$/, '');
  if (cleaned === '') return 'Enter an amount.';
  const match = /^(\d*)(?:\.(\d{0,2}))?$/.exec(cleaned);
  if (match === null) return 'Enter the amount as a number of PUSD, with at most two decimal places, for example 100 or 150.50.';
  const cents = BigInt(match[1] === '' ? '0' : (match[1] as string)) * 100n + BigInt((match[2] ?? '').padEnd(2, '0') || '0');
  return cents <= 0n ? 'Enter an amount above zero.' : cents;
};

/** A percentage as typed, a whole number, or the reason. */
export const parsePercent = (text: string): number | string => {
  const cleaned = text.trim().replace(/%$/, '');
  if (!/^\d{1,4}$/.test(cleaned)) return 'Enter a whole number, such as 125.';
  return Number(cleaned);
};

// ------------------------------------------------------------------ the chain's heights and Paryon's periods

/** From this height chipnet's blocks come every minute (the tentative upgrade of May 2027). */
export const CHIPNET_FASTER_BLOCKS_FROM = 332_451;

/**
 * The highest height a lock time may name for the network to take the transaction now, given the height of the
 * chain's last block. On chipnet a lock time given as a height is compared with the height the chain would have
 * at ten-minute blocks; elsewhere with the height itself. One block is kept in hand, for a server a block ahead
 * of the network's nodes.
 */
export const finalLockHeight = (network: string, height: number): number => {
  const counted = network === 'chipnet' && height >= CHIPNET_FASTER_BLOCKS_FROM ? CHIPNET_FASTER_BLOCKS_FROM - 1 + Math.floor((height - (CHIPNET_FASTER_BLOCKS_FROM - 1)) / 10) : height;
  return counted - 1;
};

/** What the page knows of Paryon's contracts and prices at one moment. */
export interface Market {
  /** The height of the chain's last block, and the highest height a lock time may name now. */
  height: number;
  lockHeight: number;
  /** The period a loan opened now belongs in. */
  period: number;
  borrowing: BorrowingThread[];
  /** The price thread a new loan is opened against: the one with the highest price, which the contracts check. */
  priceThread: PriceThread;
  /** The lowest price stored in any of the price contracts. */
  stored: bigint;
  /** The latest price the oracle signed, if it could be read. */
  oracle?: { price: bigint; time: number };
  /** The lower of the stored price and the oracle's: what the page reckons collateral with. */
  lower: bigint;
}

/** The lower of the lowest stored price and the oracle's latest. */
export const lowerPrice = (stored: bigint, oracle: bigint | undefined): bigint => (oracle !== undefined && oracle < stored ? oracle : stored);

/** The contract a loan of this debt is opened from: one that can lend it, the most recent period first, then the most it can still lend. */
export const borrowingFor = (threads: BorrowingThread[], debt: bigint): BorrowingThread | undefined =>
  threads.filter((thread) => thread.supply >= debt).sort((a, b) => b.period - a.period || (b.supply > a.supply ? 1 : b.supply < a.supply ? -1 : 0))[0];

/** Whether the contracts must be brought up to date before a loan is opened, and what that is about. */
export type PeriodNeed =
  | { needed: false; thread: BorrowingThread }
  | { needed: true; thread: BorrowingThread; behind: number; atMost: bigint }
  | { needed: 'impossible'; reason: string };

/**
 * A loan starts in the period of the contract it is opened from, and interest is due for each period from
 * then on. A contract more than one period behind is brought up to date first: otherwise anyone could charge the
 * new loan the fee of an interest payment for each period it missed. Moving it on costs only a network fee.
 */
export const periodNeed = (market: Pick<Market, 'borrowing' | 'period'>, debt: bigint = MINIMUM_DEBT): PeriodNeed => {
  const thread = borrowingFor(market.borrowing, debt);
  if (thread === undefined) return { needed: 'impossible', reason: 'None of Paryon\'s borrowing contracts can lend this much now.' };
  const behind = market.period - thread.period;
  if (behind <= 1) return { needed: false, thread };
  // The one moved on is the one that can still lend the most.
  const fullest = market.borrowing.filter((candidate) => candidate.supply >= debt).sort((a, b) => (b.supply > a.supply ? 1 : b.supply < a.supply ? -1 : 0))[0] ?? thread;
  return { needed: true, thread: fullest, behind: market.period - fullest.period, atMost: BigInt(market.period - fullest.period) * MISSED_PERIOD_FEE };
};

/** The period a lock height falls in, for this deployment. */
export const periodOf = (lockHeight: number): number => periodAt(DEPLOYMENT, lockHeight);

// ------------------------------------------------------------------ borrowing

export interface BorrowPlan {
  debt: bigint;
  percent: number;
  collateral: bigint;
  /** Paryon's borrowing fee, at the price of the thread used. */
  fee: bigint;
  /** What the collateral is worth, as a percentage of the debt, at the lower price and at the stored one. */
  ratioAtLower: number;
  ratioAtStored: number;
  /** About what leaves the wallet: the collateral, the fee and the two coins that carry the key and the PUSD, before the network fee. */
  total: bigint;
  /** Why the page will not ask for it. */
  problem?: string;
}

export const borrowPlan = (debt: bigint, percent: number, market: Pick<Market, 'lower' | 'priceThread'>): BorrowPlan => {
  const used = market.priceThread.state.price;
  const collateral = collateralAtRatio(debt, market.lower, BigInt(percent));
  const fee = borrowingFee(debt, used);
  const plan = {
    debt,
    percent,
    collateral,
    fee,
    ratioAtLower: collateralRatio(collateral, debt, market.lower),
    ratioAtStored: collateralRatio(collateral, debt, used),
    total: collateral + fee + KEY_SATOSHIS + TOKEN_SATOSHIS,
  };
  const problem =
    debt < MINIMUM_DEBT
      ? `Paryon lends at least ${formatPusd(MINIMUM_DEBT)} PUSD.`
      : percent < SAFE_PERCENT
        ? `This page does not borrow with less than ${SAFE_PERCENT}% collateral at the lower price. Below that a small fall in the price would put the loan near the contracts' limit of 110%, where it can be liquidated.`
        : percent > 1_000
          ? 'Choose a collateral of at most 1,000%.'
          : collateral < minimumCollateral(debt, used)
            ? 'The contracts would not take this little collateral.'
            : undefined;
  return problem === undefined ? plan : { ...plan, problem };
};

// ------------------------------------------------------------------ a loan

export interface LoanView {
  /** The loan key's category, explorer order. Names the loan. */
  category: string;
  /**
   * Where the loan stands, as the page reads it from the chain: `open`; `closed` once the key opens no loan;
   * `unknown` when the chain could not say.
   */
  status: 'open' | 'closed' | 'unknown';
  /** The loan's collateral, read from the chain; 0 for a loan that is not open. */
  satoshis: bigint;
  /** What the coin that holds the key holds, as the wallet reports it: Paryon's contracts require an action to repeat it. */
  keySatoshis?: bigint;
  /** Read from the chain, for an open loan. */
  debt?: bigint;
  beingRedeemed?: bigint;
  interestRate?: number;
  /** The loan's coin, for an open loan. */
  found?: FoundLoan;
}

/** The loan's collateral as a percentage of its debt at a price. */
export const ratioOf = (loan: Pick<LoanView, 'debt' | 'found'>, price: bigint): number | undefined =>
  loan.debt === undefined || loan.debt === 0n || loan.found === undefined ? undefined : collateralRatio(loan.found.loan.output.valueSatoshis, loan.debt, price);

/** What can be repaid without closing: at least 100.00 PUSD, leaving at least 100.00. */
export const partRepayment = (loan: Pick<LoanView, 'debt' | 'beingRedeemed'>): { smallest: bigint; largest: bigint } | undefined => {
  if (loan.debt === undefined) return undefined;
  const largest = loan.debt - (loan.beingRedeemed ?? 0n) - MINIMUM_DEBT;
  return largest >= MINIMUM_DEBT ? { smallest: MINIMUM_DEBT, largest } : undefined;
};

/** Why a repayment that leaves the loan open is not one Paryon takes, or `undefined`. */
export const repaymentProblem = (loan: Pick<LoanView, 'debt' | 'beingRedeemed'>, repay: bigint): string | undefined => {
  const range = partRepayment(loan);
  if (range === undefined || loan.debt === undefined) return 'This loan is too small to repay in part: Paryon takes at least 100.00 PUSD and leaves at least 100.00. Repay all of it instead.';
  if (repay < range.smallest || repay > range.largest || !repaymentAllowed(repay, loan.debt, loan.beingRedeemed ?? 0n)) {
    return `Repay between ${formatPusd(range.smallest)} and ${formatPusd(range.largest)} PUSD. Paryon takes at least 100.00 and leaves at least 100.00 owing; to repay more, close the loan.`;
  }
  return undefined;
};

/** Why the loan cannot hold this much collateral, or `undefined`. Adding is always allowed; taking out keeps it safe. */
export const collateralProblem = (loan: Pick<LoanView, 'debt' | 'found'>, collateral: bigint, market: Pick<Market, 'lower' | 'priceThread'>): string | undefined => {
  if (loan.debt === undefined || loan.found === undefined) return 'The loan could not be read from the chain.';
  const now = loan.found.loan.output.valueSatoshis;
  if (collateral === now) return 'That is what the loan holds now.';
  if (collateral > now) return undefined;
  const ratio = collateralRatio(collateral, loan.debt, market.lower);
  if (ratio < SAFE_PERCENT) return `With that, the collateral would be worth ${ratio.toFixed(2)}% of the debt at ${formatPrice(market.lower)}. This page keeps a loan at ${SAFE_PERCENT}% or more; take out less.`;
  if (collateral < minimumCollateral(loan.debt, market.priceThread.state.price)) return 'The contracts would not take this little collateral.';
  return undefined;
};
