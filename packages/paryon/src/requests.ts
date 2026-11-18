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
} from './state.js';
import type { PresentedTemplate } from './template.js';

/**
 * What the loan's page asks of a wallet of this project: an action of the Paryon template (`xo_action_request`,
 * proposal section 14.2). The page reads Paryon's live outputs (`readParyonState`), chooses the contracts' coins
 * and works out what only Paryon's arithmetic gives: the loan's record, the borrowing fee, the period. The
 * wallet fills in its own parts (its coins, its addresses, the loan key) and reads from the chain what the
 * template's declaration tells it to; it checks every value the page gives in the virtual machine, with
 * Paryon's own contracts, before anything is signed.
 *
 * Amounts go as decimal text, so that no number loses digits on the way.
 */

/** The details of an `xo_action_request`, as `packages/connect` sends them. */
export interface LoanRequest {
  template: PresentedTemplate['names'];
  templateAction: 'createKey' | 'movePeriod' | 'borrow' | 'manage' | 'repay' | 'close';
  role: 'borrower';
  variables: Record<string, string | number>;
  bindings?: Record<string, string>;
  creates?: string;
  spends?: string[];
  inputs?: Record<string, string>;
}

const outpoint = (utxo: Utxo): string => `${binToHex(utxo.transactionHash)}:${utxo.index}`;
const commitmentOf = (utxo: Utxo, what: string): Uint8Array => {
  const commitment = utxo.output.token?.nft?.commitment;
  if (commitment === undefined) throw new Error(`The ${what} carries no NFT.`);
  return commitment;
};
const base = (template: PresentedTemplate, templateAction: LoanRequest['templateAction']) => ({ template: template.names, templateAction, role: 'borrower' as const });

/** Make a loan key: the wallet's coin defines its category; Paryon's factory makes it. */
export const createKeyRequest = (template: PresentedTemplate, chosen: { factory?: Utxo } = {}): LoanRequest => ({
  ...base(template, 'createKey'),
  variables: {},
  creates: 'keyCategory',
  ...(chosen.factory === undefined ? {} : { inputs: { factoryInput: outpoint(chosen.factory) } }),
});

/**
 * Move a Borrowing thread on to the period of a height, so that a loan opened from it is charged no interest
 * for periods before. The lock time is that height: on chipnet the highest height its node takes as final.
 */
export const movePeriodRequest = (template: PresentedTemplate, contracts: ParyonContracts, chosen: { borrowing: Utxo; lockHeight: number }): LoanRequest => {
  const current = decodeBorrowingPeriod(commitmentOf(chosen.borrowing, 'Borrowing thread'));
  const period = periodAt(contracts.deployment, chosen.lockHeight);
  if (period <= current) throw new Error(`The thread is in period ${current} already; height ${chosen.lockHeight} is in period ${period}.`);
  return {
    ...base(template, 'movePeriod'),
    variables: { newBorrowingCommitment: binToHex(encodeBorrowingPeriod(period)), lockHeight: chosen.lockHeight },
    inputs: { periodBorrowingInput: outpoint(chosen.borrowing) },
  };
};

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

/** Borrow: the key and the PUSD go to addresses the wallet gives. */
export const borrowRequest = (template: PresentedTemplate, choice: BorrowChoice): LoanRequest => {
  const { price } = decodePriceState(commitmentOf(choice.price, 'price thread'));
  const interestManager = choice.interestManager ?? NO_INTEREST_MANAGER;
  return {
    ...base(template, 'borrow'),
    variables: {
      debt: String(choice.debt),
      collateral: String(choice.collateral),
      loanCommitment: binToHex(encodeLoanState(openingState(choice))),
      borrowingFee: String(borrowingFee(choice.debt, price)),
      startingInterest: binToHex(encodeInterestRate(choice.startingInterest)),
      interestManagerConfiguration: binToHex(encodeInterestManagerConfiguration(interestManager)),
    },
    bindings: { keyHolder: 'receive', tokensHolder: 'receive' },
    inputs: { borrowingInput: outpoint(choice.borrowing), priceInput: outpoint(choice.price), enforcerInput: outpoint(choice.enforcer), proofInput: outpoint(choice.proof) },
  };
};

/** Shared contracts the page may choose for an action on a loan; the wallet finds them itself otherwise. */
export interface LoanChoice {
  /** The loan key's category, explorer order, hex. */
  keyCategory: string;
  price?: Utxo;
  manageFunction?: Utxo;
}
const shared = (choice: LoanChoice, manageInput: string): Pick<LoanRequest, 'inputs'> => {
  const inputs = {
    ...(choice.price === undefined ? {} : { priceInput: outpoint(choice.price) }),
    ...(choice.manageFunction === undefined ? {} : { [manageInput]: outpoint(choice.manageFunction) }),
  };
  return Object.keys(inputs).length === 0 ? {} : { inputs };
};

/** Add or take out collateral: the loan then holds `collateral`. The key goes back where it was. */
export const manageRequest = (template: PresentedTemplate, choice: LoanChoice & { collateral: bigint }): LoanRequest => ({
  ...base(template, 'manage'),
  variables: { collateral: String(choice.collateral) },
  spends: [choice.keyCategory],
  ...shared(choice, 'manageInput'),
});

/** Repay part of the debt; the loan stays open and holds `collateral`. Paryon takes at least 100.00 PUSD and leaves at least 100.00. */
export const repayRequest = (template: PresentedTemplate, choice: LoanChoice & { loan: Utxo; repay: bigint; collateral: bigint }): LoanRequest => {
  const state = decodeLoanState(commitmentOf(choice.loan, 'loan'));
  if (!repaymentAllowed(choice.repay, state.borrowed, state.beingRedeemed) || choice.repay === 0n || choice.repay === state.borrowed) {
    throw new Error(`A repayment of ${choice.repay} PUSD cents that leaves the loan open is not one Paryon takes from a debt of ${state.borrowed}.`);
  }
  return {
    ...base(template, 'repay'),
    variables: { repayAmount: String(choice.repay), collateral: String(choice.collateral), loanCommitment: binToHex(encodeLoanState({ ...state, borrowed: state.borrowed - choice.repay })) },
    spends: [choice.keyCategory],
    ...shared(choice, 'repayInput'),
  };
};

/** Repay the whole debt and close the loan. Everything else comes from the chain. */
export const closeRequest = (template: PresentedTemplate, choice: LoanChoice): LoanRequest => ({
  ...base(template, 'close'),
  variables: {},
  spends: [choice.keyCategory],
  ...shared(choice, 'repayInput'),
});
