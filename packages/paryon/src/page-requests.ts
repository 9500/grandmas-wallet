import { binToHex } from '@bitauth/libauth';
import type { Utxo } from '@grandmas-wallet/core';

import { borrowingFee, repaymentAllowed } from './amounts.js';
import { type ParyonContracts, periodAt } from './deployment.js';
import {
  type InterestManagerConfiguration,
  type LoanState,
  NO_INTEREST_MANAGER,
  decodeBorrowingPeriod,
  decodeLoanState,
  decodePriceState,
  encodeBorrowingPeriod,
  encodeInterestManagerConfiguration,
  encodeInterestRate,
  encodeLoanState,
  newLoanState,
  withNextInterestRate,
} from './state.js';

/**
 * What the loan's page asks of a wallet of this project in `xo_v1` (proposal sections 14.2 and 15.3): an action of
 * the Paryon template, which is all the wallet is sent. What the wallet cannot know of Paryon, the page says itself:
 *
 * - **Paryon's coins.** Every coin of Paryon's an action spends is named by outpoint, for the template input it is
 *   spent as: the shared contracts (factory, Borrowing thread, price, manage function), the key waiting in the
 *   origin enforcer and its proof, and the loan and its sidecar. Paryon's template does not say which unlocking
 *   belongs to which of its scripts, and the wallet looks for none of them; it reads each named coin from the
 *   chain, finds which of the template's scripts it is at, and runs Paryon's own contracts on the transaction
 *   before the user is asked, which refuse a coin that does not belong.
 * - **The values read from those coins:** the Borrowing thread's supply and period, the price, the loan's record
 *   and its interest manager, the debt to repay.
 * - **The key.** Which loan an action is about, by its key's category, and that the action spends the key. The
 *   wallet takes the key's category from that for the variable an output names it by (section 13.3); the page does
 *   not repeat it. Borrowing gives the category of the key waiting in Paryon's contract, which the page names, so
 *   the wallet carries it on.
 * - **The key's coin.** What it holds, which Paryon's contracts require an action to repeat: the wallet's answer to
 *   a positions request gives it (`satoshis`), and the page sends it back.
 * - **Where the key goes.** Back to the script it left (`return`) where Paryon requires it, when managing and
 *   repaying; a fresh address of the wallet's when the loan is closed, where the contracts do not require it.
 * - **The page's own address,** which the wallet keeps in the record it writes when the key arrives.
 *
 * Amounts go as decimal text, so that no number loses digits on the way.
 */

/** The template as a request names it: by identifier and content hash. */
export interface TemplateNamesAlone {
  identifier: string;
  contentHash: string;
}

/** The details of an `xo_action_request`, as `packages/connect` sends them. */
export interface LoanRequestAlone {
  template: TemplateNamesAlone;
  templateAction: 'createKey' | 'movePeriod' | 'borrow' | 'manage' | 'repay' | 'close' | 'changeInterest';
  role: 'borrower';
  variables: Record<string, string | number>;
  bindings?: Record<string, string>;
  creates?: string;
  about?: { category: string; spent: boolean };
  inputs?: Record<string, string>;
  page?: string;
}

export interface BorrowChoice {
  borrowing: Utxo;
  price: Utxo;
  /** The origin enforcer and the origin proof a loan key's creation left: outputs 2 and 3 of that transaction. */
  enforcer: Utxo;
  proof: Utxo;
  /** PUSD cents. */
  debt: bigint;
  /** Satoshis the loan holds. */
  collateral: bigint;
  /** Per 10,000,000 per period. */
  startingInterest: number;
  interestManager?: InterestManagerConfiguration;
}

/** The loan's record when it is opened, as `Borrowing.cash` writes it. */
export const openingState = (choice: Pick<BorrowChoice, 'borrowing' | 'debt' | 'startingInterest' | 'interestManager'>): LoanState =>
  newLoanState(choice.debt, decodeBorrowingPeriod(commitmentOf(choice.borrowing, 'Borrowing thread')), choice.startingInterest, choice.interestManager ?? NO_INTEREST_MANAGER);

const outpoint = (utxo: Utxo): string => `${binToHex(utxo.transactionHash)}:${utxo.index}`;
const commitmentOf = (utxo: Utxo, what: string): Uint8Array => {
  const commitment = utxo.output.token?.nft?.commitment;
  if (commitment === undefined) throw new Error(`The ${what} carries no NFT.`);
  return commitment;
};
const amountOf = (utxo: Utxo): bigint => utxo.output.token?.amount ?? 0n;
const base = (template: TemplateNamesAlone, templateAction: LoanRequestAlone['templateAction'], page: string | undefined) => ({
  template: { identifier: template.identifier, contentHash: template.contentHash },
  templateAction,
  role: 'borrower' as const,
  ...(page === undefined ? {} : { page }),
});

/**
 * What an action names of Paryon's: the values read from Paryon's coins or worked out as the contracts require, and
 * the coins by template input. The loan page's requests (versions 1 and 2) send all of it; Paryon's service (version 3,
 * `service.ts`) supplies its share of the same values, so that both come from one source.
 */
export interface ActionParts {
  variables: Record<string, string | number>;
  inputs: Record<string, string>;
  about?: { category: string; spent: boolean };
}
/** What an action on a loan names: as any action, and which loan it is about, by its key. */
export type LoanActionParts = ActionParts & { about: { category: string; spent: boolean } };

/** Making a loan key: Paryon's factory. */
export const createKeyParts = (factory: Utxo): ActionParts => ({ variables: {}, inputs: { factoryInput: outpoint(factory) } });

/** Make a loan key: the wallet's coin defines its category; Paryon's factory, which the page names, makes it. */
export const createKeyRequestAlone = (template: TemplateNamesAlone, chosen: { factory: Utxo; page?: string }): LoanRequestAlone => {
  const { variables, inputs } = createKeyParts(chosen.factory);
  return { ...base(template, 'createKey', chosen.page), variables, creates: 'keyCategory', inputs };
};

/** Moving a Borrowing thread on to the period of a height. */
export const movePeriodParts = (contracts: ParyonContracts, borrowing: Utxo, lockHeight: number): ActionParts => {
  const current = decodeBorrowingPeriod(commitmentOf(borrowing, 'Borrowing thread'));
  const period = periodAt(contracts.deployment, lockHeight);
  if (period <= current) throw new Error(`The thread is in period ${current} already; height ${lockHeight} is in period ${period}.`);
  return {
    variables: { borrowingSupply: String(amountOf(borrowing)), newBorrowingCommitment: binToHex(encodeBorrowingPeriod(period)), lockHeight },
    inputs: { periodBorrowingInput: outpoint(borrowing) },
  };
};

/**
 * Move a Borrowing thread on to the period of a height, so that a loan opened from it is charged no interest for
 * periods before. The lock time is that height; the thread's supply is put back as it is.
 */
export const movePeriodRequestAlone = (template: TemplateNamesAlone, contracts: ParyonContracts, chosen: { borrowing: Utxo; lockHeight: number; page?: string }): LoanRequestAlone => {
  const { variables, inputs } = movePeriodParts(contracts, chosen.borrowing, chosen.lockHeight);
  return { ...base(template, 'movePeriod', chosen.page), variables, inputs };
};

/** Borrowing: the values the contracts require for the choice, and Paryon's four coins. */
export const borrowParts = (choice: BorrowChoice): ActionParts => {
  const priceCommitment = commitmentOf(choice.price, 'price thread');
  const { price } = decodePriceState(priceCommitment);
  const key = choice.enforcer.output.token;
  if (key?.nft?.capability !== 'minting') throw new Error('The coin named as the waiting loan key carries no minting NFT.');
  return {
    variables: {
      keyCategory: binToHex(key.category),
      borrowingSupply: String(amountOf(choice.borrowing)),
      borrowingCommitment: binToHex(commitmentOf(choice.borrowing, 'Borrowing thread')),
      priceCommitment: binToHex(priceCommitment),
      debt: String(choice.debt),
      collateral: String(choice.collateral),
      loanCommitment: binToHex(encodeLoanState(openingState(choice))),
      borrowingFee: String(borrowingFee(choice.debt, price)),
      startingInterest: binToHex(encodeInterestRate(choice.startingInterest)),
      interestManagerConfiguration: binToHex(encodeInterestManagerConfiguration(choice.interestManager ?? NO_INTEREST_MANAGER)),
    },
    inputs: { borrowingInput: outpoint(choice.borrowing), priceInput: outpoint(choice.price), enforcerInput: outpoint(choice.enforcer), proofInput: outpoint(choice.proof) },
  };
};

/** Borrow: the key waiting in Paryon's contract and the PUSD go to fresh addresses of the wallet's. */
export const borrowRequestAlone = (template: TemplateNamesAlone, choice: BorrowChoice & { page?: string }): LoanRequestAlone => {
  const { variables, inputs } = borrowParts(choice);
  return { ...base(template, 'borrow', choice.page), variables, bindings: { keyHolder: 'receive', tokensHolder: 'receive' }, inputs };
};

/**
 * An open loan as an action on it needs it: the key, as the wallet reports it; the loan and its sidecar, found from
 * the key on chain (`findLoan`); and the shared contracts the page chose (`loanCoins`).
 */
export interface LoanCoins {
  /** The loan key's category, explorer order, hex. */
  keyCategory: string;
  /** What the coin that holds the key holds, from the wallet's answer to a positions request. */
  keySatoshis: bigint;
  loan: Utxo;
  sidecar: Utxo;
  price: Utxo;
  manageFunction: Utxo;
}

/** What every action on an open loan names and reads. */
const onLoan = (coins: LoanCoins, functionInput: 'manageInput' | 'repayInput') => {
  const record = commitmentOf(coins.loan, 'loan');
  decodeLoanState(record);
  return {
    about: { category: coins.keyCategory, spent: true },
    inputs: { priceInput: outpoint(coins.price), loanInput: outpoint(coins.loan), sidecarInput: outpoint(coins.sidecar), [functionInput]: outpoint(coins.manageFunction) },
    variables: {
      keySatoshis: String(coins.keySatoshis),
      priceCommitment: binToHex(commitmentOf(coins.price, 'price thread')),
      // Who may change the loan's interest, as the loan's record holds it (bytes 22 to 27).
      interestManagerConfiguration: binToHex(record.slice(22, 27)),
    },
    record,
  };
};

/** Adding or taking out collateral: the loan then holds `collateral`; its record stays as it is. */
export const manageParts = (coins: LoanCoins, collateral: bigint): LoanActionParts => {
  const { about, inputs, variables, record } = onLoan(coins, 'manageInput');
  return { variables: { ...variables, collateral: String(collateral), loanCommitment: binToHex(record) }, about, inputs };
};

/** Add or take out collateral: the loan then holds `collateral`. The key goes back to the script it left. */
export const manageRequestAlone = (template: TemplateNamesAlone, coins: LoanCoins & { collateral: bigint; page?: string }): LoanRequestAlone => {
  const { variables, about, inputs } = manageParts(coins, coins.collateral);
  return { ...base(template, 'manage', coins.page), variables, bindings: { keyHolder: 'return' }, about, inputs };
};

/**
 * Repaying part of the debt: the loan stays open, holds `collateral`, and its record says the debt less the repayment.
 * @throws when Paryon would not take the repayment, or it would close the loan
 */
export const repayParts = (coins: LoanCoins, repay: bigint, collateral: bigint): LoanActionParts => {
  const { about, inputs, variables, record } = onLoan(coins, 'repayInput');
  const state = decodeLoanState(record);
  if (!repaymentAllowed(repay, state.borrowed, state.beingRedeemed) || repay === 0n || repay === state.borrowed) {
    throw new Error(`A repayment of ${repay} PUSD cents that leaves the loan open is not one Paryon takes from a debt of ${state.borrowed}.`);
  }
  return {
    variables: { ...variables, collateral: String(collateral), repayAmount: String(repay), loanCommitment: binToHex(encodeLoanState({ ...state, borrowed: state.borrowed - repay })) },
    about,
    inputs,
  };
};

/** Repay part of the debt; the loan stays open and holds `collateral`. Paryon takes at least 100.00 PUSD and leaves at least 100.00. */
export const repayRequestAlone = (template: TemplateNamesAlone, coins: LoanCoins & { repay: bigint; collateral: bigint; page?: string }): LoanRequestAlone => {
  const { variables, about, inputs } = repayParts(coins, coins.repay, coins.collateral);
  return { ...base(template, 'repay', coins.page), variables, bindings: { keyHolder: 'return' }, about, inputs };
};

/** Closing: the whole debt repaid; the loan's record goes to a data output as it is. */
export const closeParts = (coins: LoanCoins): LoanActionParts => {
  const { about, inputs, variables, record } = onLoan(coins, 'repayInput');
  return { variables: { ...variables, loanCommitment: binToHex(record), repayAmount: String(decodeLoanState(record).borrowed) }, about, inputs };
};

/**
 * Repay the whole debt and close the loan. The loan's record goes to a data output as it is; the key comes back to
 * a fresh address of the wallet's, since the contracts do not require it to continue at all.
 */
export const closeRequestAlone = (template: TemplateNamesAlone, coins: LoanCoins & { page?: string }): LoanRequestAlone => {
  const { variables, about, inputs } = closeParts(coins);
  return { ...base(template, 'close', coins.page), variables, bindings: { keyHolder: 'receive' }, about, inputs };
};

/**
 * A loan as changing its interest rate needs it: the key, as the wallet reports it; the loan and its sidecar, found
 * from the key (`interestCoins`); and the coin of Paryon's interest function the page chose. No price is named.
 */
export interface InterestCoins {
  /** The loan key's category, explorer order, hex. */
  keyCategory: string;
  /** What the coin that holds the key holds, from the wallet's answer to a positions request. */
  keySatoshis: bigint;
  loan: Utxo;
  sidecar: Utxo;
  /** One of the coins of Paryon's interest function (`changeInterest.cash`, commitment `08`). */
  interestFunction: Utxo;
}

/**
 * Changing the interest rate: the loan's new record as the contract writes it (only the next rate changes), the
 * collateral as it is, and the rate as the two bytes the contract takes.
 * @throws when the rate is not one the contracts take
 */
export const changeInterestParts = (coins: InterestCoins, rate: number): LoanActionParts => {
  const record = commitmentOf(coins.loan, 'loan');
  return {
    variables: {
      keySatoshis: String(coins.keySatoshis),
      collateral: String(coins.loan.output.valueSatoshis),
      loanCommitment: binToHex(withNextInterestRate(record, rate)),
      nextInterestRate: binToHex(encodeInterestRate(rate)),
    },
    about: { category: coins.keyCategory, spent: true },
    inputs: { loanInput: outpoint(coins.loan), sidecarInput: outpoint(coins.sidecar), changeInterestInput: outpoint(coins.interestFunction) },
  };
};

/**
 * Change the loan's interest rate for the periods to come: `rate` per 10,000,000 of the debt's value per period, a
 * whole number from 0 to 32,767, which the loan's own key may set without limits. The page writes the loan's new
 * record as the contract does (only the next rate changes); the collateral stays as it is; the key goes back to the
 * script it left. The rate charged now stays until the next interest payment makes the new one current.
 */
export const changeInterestRequestAlone = (template: TemplateNamesAlone, coins: InterestCoins & { rate: number; page?: string }): LoanRequestAlone => {
  const { variables, about, inputs } = changeInterestParts(coins, coins.rate);
  return { ...base(template, 'changeInterest', coins.page), variables, bindings: { keyHolder: 'return' }, about, inputs };
};
