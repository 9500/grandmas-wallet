import { readTemplate } from '@grandmas-wallet/core';
import {
  type BorrowingThread,
  type FoundLoan,
  type ParyonContracts,
  type ParyonDeployment,
  type ParyonTemplateAlone,
  type PriceThread,
  CHIPNET_FAST_PERIODS_6,
  MAINNET_V1,
  MAXIMUM_INTEREST_RATE,
  MINIMUM_DEBT,
  borrowingFee,
  borrowingFor,
  collateralAtRatio,
  collateralRatio,
  contractCollateralProblem,
  formatPrice,
  formatPusd,
  interestPerPeriod,
  interestRateProblem,
  paryonAddressesAt,
  paryonChipnetTemplateText,
  paryonContracts,
  paryonMainnetTemplateText,
  paryonTemplateAlone,
  periodAt,
  repaymentAllowed,
} from '@grandmas-wallet/paryon';

// What Paryon's service checks too lives in packages/paryon; the page uses it from there.
export { CHIPNET_FASTER_BLOCKS_FROM, borrowingFor, finalLockHeight, formatPrice, formatPusd, interestRateProblem } from '@grandmas-wallet/paryon';

/**
 * What the loan page works out by itself: the template it sends, the prices it reckons with, whether the
 * contracts need bringing up to date, how much collateral a loan takes, and which repayments the contracts
 * allow. Nothing here reads the chain or speaks to a wallet; `market.ts` and `xo.ts` do.
 *
 * Amounts: debts and repayments in PUSD cents, prices in US cents per BCH, collateral and fees in satoshis.
 */

/**
 * A deployment of Paryon's contracts, with what the page makes from it: the contracts, and the template as a wallet
 * is sent it, with the names a request gives it. The template goes alone, with no recovery declaration (proposal
 * section 15.3). It is version 3, which names Paryon's loan service (`xo_service_v1`): the page's requests carry only
 * what the borrower decides, and the service brings Paryon's coins and what is read from them.
 */
export interface Desk {
  deployment: ParyonDeployment;
  contracts: ParyonContracts;
  template: ParyonTemplateAlone;
  /** Whether it is Paryon's own deployment, whose prices General Protocols' oracle signs. */
  paryons: boolean;
}

/** A frozen text of the template, with the names a request gives it. */
const frozen = (text: string): ParyonTemplateAlone => {
  const read = readTemplate(text);
  return { names: { identifier: read.identifier, contentHash: read.contentHash }, texts: { template: text } };
};

/** One of Paryon's own deployments, with the frozen text of version 3, which names Paryon's own service and page. */
const paryonsDesk = (deployment: ParyonDeployment, text: string): Desk => ({ deployment, contracts: paryonContracts(deployment), template: frozen(text), paryons: true });

/**
 * A deployment a configuration names, with the template made for it, as Paryon's service makes it for the same
 * configuration: naming the loan page at `page` and the service beside it (`service/v1`). The template is made when it
 * is first used, so that a desk without a page address still gives the contracts.
 */
const configuredDesk = (deployment: ParyonDeployment, page: string | undefined): Desk => {
  const contracts = paryonContracts(deployment);
  let made: ParyonTemplateAlone | undefined;
  return {
    deployment,
    contracts,
    paryons: false,
    get template(): ParyonTemplateAlone {
      if (page === undefined) throw new Error(`The configuration names Paryon's deployment ${deployment.name} but not the loan page's address ("loanUrl"), beside which the template names the loan service.`);
      made ??= paryonTemplateAlone(contracts, 3, paryonAddressesAt(page));
      return made;
    },
  };
};

/** Paryon's public contracts through their test deployment on chipnet: what the page uses on chipnet. */
export const CHIPNET_DESK = paryonsDesk(CHIPNET_FAST_PERIODS_6, paryonChipnetTemplateText);
export const DEPLOYMENT: ParyonDeployment = CHIPNET_DESK.deployment;
export const CONTRACTS = CHIPNET_DESK.contracts;
export const LOAN_TEMPLATE = CHIPNET_DESK.template;
/** Paryon's public contracts through their deployment on mainnet, `mainnet-v1`: what the page uses on mainnet. */
export const MAINNET_DESK = paryonsDesk(MAINNET_V1, paryonMainnetTemplateText);

/**
 * The deployment the page uses on a network: on mainnet and on chipnet, Paryon's own; elsewhere the one its
 * configuration names (`paryon`), which is how the page is served for a chain of one's own with Paryon's contracts
 * deployed on it. For such a deployment the template names the loan page at the configuration's `loanUrl`, as Paryon's
 * service does (apps/paryon-service), or else at `page`, the address the page is served from; the service is beside it.
 * @param page - where the page is, used only where the configuration gives no `loanUrl`
 * @returns `undefined` where the network has none
 */
export const deskFor = (environment: { network: string; paryon?: unknown; loanUrl?: unknown }, page?: string): Desk | undefined => {
  // On mainnet only Paryon's own deployment, named and checked in this code, is used; a configuration cannot name another.
  if (environment.network === 'mainnet') return MAINNET_DESK;
  const named = environment.paryon as Partial<ParyonDeployment> | undefined;
  if (named !== undefined && typeof named === 'object' && typeof named.name === 'string' && typeof named.tokenIds?.paryon === 'string' && typeof named.tokenIds.loanKeyFactory === 'string') {
    return configuredDesk(named as ParyonDeployment, typeof environment.loanUrl === 'string' ? environment.loanUrl : page);
  }
  return environment.network === 'chipnet' ? CHIPNET_DESK : undefined;
};

/**
 * On test networks: collateral worth 125% of the debt at the lower of the two prices is proposed, and less than
 * 115% refused. The coins have no value there, and the margin above the contracts' 110% is what a person needs to
 * see the course through: a fall of 12% in the price brings a loan at 125% to the line.
 */
export const DEFAULT_PERCENT = 125;
/** Below this, at the lower of the two prices, the page refuses to borrow or to take collateral out (test networks). */
export const SAFE_PERCENT = 115;
/**
 * On mainnet, with real BCH: 150% is proposed and less than 130% refused. A loan at 150% reaches the contracts'
 * 110% after a fall of about 27% in the price, one at 130% after about 15%; BCH has fallen that much within days.
 * Paryon's own application also asks for well above 110%.
 */
export const MAINNET_DEFAULT_PERCENT = 150;
export const MAINNET_SAFE_PERCENT = 130;
/** The collateral the page proposes, and the least it accepts, on a network. */
export const collateralPercents = (network: string): { proposed: number; least: number } =>
  network === 'mainnet' ? { proposed: MAINNET_DEFAULT_PERCENT, least: MAINNET_SAFE_PERCENT } : { proposed: DEFAULT_PERCENT, least: SAFE_PERCENT };
/** The contracts' line: a loan whose collateral is worth less than this share of its debt can be liquidated by anyone. */
export const LIQUIDATION_PERCENT = 110;
/** The price, in US cents per BCH, at which a loan's collateral would be worth only 110% of its debt. */
export const liquidationPrice = (collateral: bigint, debt: bigint): bigint => (collateral === 0n ? 0n : (debt * BigInt(LIQUIDATION_PERCENT) * 1_000_000n + collateral - 1n) / collateral);
/** What the coin that carries the loan key holds, and the one that carries the PUSD. They come with the loan. */
export const KEY_SATOSHIS = 1_000n;
export const TOKEN_SATOSHIS = 1_000n;
/** What one interest payment for a missed period may take from a loan's collateral (`payInterest.cash`). */
export const MISSED_PERIOD_FEE = 1_500n;

// ------------------------------------------------------------------ amounts as people type them

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
  /**
   * Set for a deployment no oracle signs prices for, as on a chain of one's own: the stored price is then the only
   * one, and `lower` is it.
   */
  withoutOracle?: true;
  /** The lower of the stored price and the oracle's: what the page reckons collateral with. */
  lower: bigint;
}

/**
 * The price the page reckons with, in words: "the lower price" where an oracle's price is read beside the stored one,
 * "the stored price" where the deployment has no oracle.
 */
export const priceBasis = (withoutOracle: boolean | undefined): { short: string; explained: string } =>
  withoutOracle === true
    ? { short: 'the stored price', explained: 'The stored price; no oracle is read here' }
    : { short: 'the lower price', explained: 'The lower of the stored price and the oracle\'s' };

/** The lower of the lowest stored price and the oracle's latest. */
export const lowerPrice = (stored: bigint, oracle: bigint | undefined): bigint => (oracle !== undefined && oracle < stored ? oracle : stored);

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

/** The period a lock height falls in, for a deployment. */
export const periodOf = (lockHeight: number, deployment: ParyonDeployment = DEPLOYMENT): number => periodAt(deployment, lockHeight);

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

export const borrowPlan = (debt: bigint, percent: number, market: Pick<Market, 'lower' | 'priceThread' | 'withoutOracle'>, least: number = SAFE_PERCENT): BorrowPlan => {
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
      : percent < least
        ? `This page does not borrow with less than ${least}% collateral at ${priceBasis(market.withoutOracle).short}. Below that a small fall in the price would put the loan near the contracts' limit of 110%, where it can be liquidated.`
        : percent > 1_000
          ? 'Choose a collateral of at most 1,000%.'
          : contractCollateralProblem(debt, collateral, used) !== undefined
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
  /** Per 10,000,000 of the debt's value per period: the rate charged now, and the one from the next interest payment on. */
  interestRate?: number;
  nextInterestRate?: number;
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
export const collateralProblem = (loan: Pick<LoanView, 'debt' | 'found'>, collateral: bigint, market: Pick<Market, 'lower' | 'priceThread'>, least: number = SAFE_PERCENT): string | undefined => {
  if (loan.debt === undefined || loan.found === undefined) return 'The loan could not be read from the chain.';
  const now = loan.found.loan.output.valueSatoshis;
  if (collateral === now) return 'That is what the loan holds now.';
  if (collateral > now) return undefined;
  const ratio = collateralRatio(collateral, loan.debt, market.lower);
  if (ratio < least) return `With that, the collateral would be worth ${ratio.toFixed(2)}% of the debt at ${formatPrice(market.lower)}. This page keeps a loan at ${least}% or more; take out less.`;
  if (contractCollateralProblem(loan.debt, collateral, market.priceThread.state.price) !== undefined) return 'The contracts would not take this little collateral.';
  return undefined;
};

// ------------------------------------------------------------------ the interest rate

/**
 * Paryon's periods in a year: they are counted in blocks of ten minutes, 52,560 a year (on chipnet, with its one-minute
 * blocks, in the heights the chain would have at ten-minute blocks). On mainnet a period is 144 blocks, a day.
 */
export const periodsPerYear = (deployment: ParyonDeployment = DEPLOYMENT): number => 52_560 / deployment.periodLengthBlocks;

/** A rate as a share of the debt's value in a year, in percent, as Paryon's own figures give it (1,096 on mainnet: 4.0%). */
export const yearlyPercent = (rate: number, deployment: ParyonDeployment = DEPLOYMENT): number => (rate / 10_000_000) * periodsPerYear(deployment) * 100;

/** What a rate costs a loan each period at a price, in satoshis taken from the collateral, as `payInterest.cash` reckons it; each payment also takes 1,500 for its fee. */
export const interestEachPeriod = (rate: number, debt: bigint, price: bigint): bigint => interestPerPeriod(rate, debt, price);

/** Blocks of ten minutes in a year, by which Paryon's periods are counted. */
const BLOCKS_A_YEAR = 52_560n;
/** A yearly percentage in hundred-thousandths of a percent, the unit in which the page reads and writes one. */
const PERCENT_PLACES = 5;
const PERCENT_UNIT = 10n ** BigInt(PERCENT_PLACES);

/** What a rate costs a loan in a year of periods at one price, in satoshis: the cost of a period, for each period of the year. */
export const interestEachYear = (rate: number, debt: bigint, price: bigint, deployment: ParyonDeployment = DEPLOYMENT): bigint =>
  (interestEachPeriod(rate, debt, price) * BLOCKS_A_YEAR) / BigInt(deployment.periodLengthBlocks);

/**
 * A rate as a share of the debt's value in a year, written as a percentage: 1,096 on mainnet is "4.0004%", 23 on chipnet
 * "4.0296%". Exact for Paryon's deployments (a period of 144 blocks or of 3), whose rates come to whole hundred-thousandths
 * of a percent; for another, rounded to the nearest. Trailing zeros are left out: 0 is "0%".
 */
export const formatYearlyPercent = (rate: number, deployment: ParyonDeployment = DEPLOYMENT): string => {
  const blocks = BigInt(deployment.periodLengthBlocks);
  const units = (2n * BigInt(rate) * BLOCKS_A_YEAR + blocks) / (2n * blocks);
  const fraction = (units % PERCENT_UNIT).toString().padStart(PERCENT_PLACES, '0').replace(/0+$/, '');
  return `${(units / PERCENT_UNIT).toLocaleString('en-US')}${fraction === '' ? '' : `.${fraction}`}%`;
};

/** A yearly rate as typed, and the rate the contracts take for it. */
export interface TypedRate {
  /** The whole number per 10,000,000 per period that is asked for: the nearest to what was typed. */
  rate: number;
  /** Whether what was typed lies between two of the rates the contracts take, so that the nearest is asked for. */
  rounded: boolean;
}

/**
 * A rate typed as a percentage a year, such as "4" or "4.5%", as the whole number per 10,000,000 per period the
 * contracts take: the nearest one, a half rounded up. From 0% to the yearly percentage of 32,767 (119.59955% on
 * mainnet), or the reason it cannot be asked for.
 */
export const parseYearlyRate = (text: string, deployment: ParyonDeployment = DEPLOYMENT): TypedRate | string => {
  const cleaned = text.trim().replace(/\s/g, '').replace(/%$/, '');
  if (cleaned === '') return 'Enter a rate.';
  const match = /^(\d*)(?:\.(\d*))?$/.exec(cleaned);
  if (match === null || (match[1] === '' && (match[2] ?? '') === '')) return 'Enter the rate as a percentage a year, for example 4 or 4.5.';
  const fraction = match[2] ?? '';
  if (fraction.length > PERCENT_PLACES) return 'Enter the rate with at most five decimal places.';
  const units = BigInt(match[1] === '' ? '0' : (match[1] as string)) * PERCENT_UNIT + BigInt(fraction.padEnd(PERCENT_PLACES, '0'));
  // rate = percent ÷ 100 × 10,000,000 ÷ (52,560 ÷ blocks a period) = hundred-thousandths × blocks ÷ 52,560
  const exact = units * BigInt(deployment.periodLengthBlocks);
  const rate = (2n * exact + BLOCKS_A_YEAR) / (2n * BLOCKS_A_YEAR);
  if (rate > BigInt(MAXIMUM_INTEREST_RATE)) return `Paryon takes a rate from 0% to ${formatYearlyPercent(MAXIMUM_INTEREST_RATE, deployment)} a year.`;
  const problem = interestRateProblem(Number(rate));
  if (problem !== undefined) return problem;
  return { rate: Number(rate), rounded: exact % BLOCKS_A_YEAR !== 0n };
};

/**
 * How long one of a deployment's periods lasts, in words: "about a day" on mainnet, "about 30 minutes" on chipnet (whose
 * heights are counted as at ten-minute blocks). On a chain of one's own, whose blocks come when they are made, in blocks.
 */
export const periodWords = (desk: Pick<Desk, 'deployment' | 'paryons'>): string => {
  const blocks = desk.deployment.periodLengthBlocks;
  if (!desk.paryons) return `${blocks.toLocaleString('en-US')} ${blocks === 1 ? 'block' : 'blocks'}`;
  const minutes = blocks * 10;
  if (minutes % 1_440 === 0) return minutes === 1_440 ? 'about a day' : `about ${minutes / 1_440} days`;
  if (minutes % 60 === 0) return minutes === 60 ? 'about an hour' : `about ${minutes / 60} hours`;
  return `about ${minutes} minutes`;
};
