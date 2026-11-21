import { type Output, binToHex } from '@bitauth/libauth';
import { type BuiltTransaction, type InputSpec, type Utxo, buildTransaction } from '@grandmas-wallet/core';

import { borrowingFee } from './amounts.js';
import { type ParyonContracts, periodAt } from './deployment.js';
import {
  type InterestManagerConfiguration,
  type LoanState,
  BURN_LOCKING_BYTECODE,
  NO_INTEREST_MANAGER,
  SIDECAR_COMMITMENT,
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
 * A borrower's transactions, in the layouts the contracts require (proposal section 15.2). The wallet's own
 * parts come in as inputs it has already said how to unlock, and as the scripts its outputs go to: nothing
 * here knows what kind of address the wallet uses. Every transaction pays the exact fee; what is left over
 * goes to one output of the wallet's.
 *
 * The builders put together what they are given; they do not decide whether the contracts will take it.
 * That is the virtual machine's to say, before anything is sent.
 */

/** Every Paryon output that is recreated or created holds this. */
const THREAD_SATOSHIS = 1000n;

/** Output `index` of a built transaction, as a coin a later transaction can spend. */
export const outputOf = (built: Pick<BuiltTransaction, 'transactionHash' | 'transaction'>, index: number): Utxo => {
  const output = built.transaction.outputs[index];
  if (output === undefined) throw new Error(`The transaction has no output ${index}.`);
  return { transactionHash: built.transactionHash, index, output };
};

const contractInput = (utxo: Utxo, unlockingBytecode: Uint8Array): InputSpec => ({ utxo, unlock: () => unlockingBytecode });

/** The same output again: a shared thread or function NFT that a transaction must recreate as it was. */
const recreated = (utxo: Utxo): Output => ({ ...utxo.output });

const commitmentOf = (utxo: Utxo, what: string): Uint8Array => {
  const commitment = utxo.output.token?.nft?.commitment;
  if (commitment === undefined) throw new Error(`The ${what} carries no NFT.`);
  return commitment;
};

/** The wallet's coins pay; they must carry no token the transaction has nowhere to put. */
const plainCoins = (inputs: InputSpec[], what: string): void => {
  if (inputs.some(({ utxo }) => utxo.output.token !== undefined)) throw new Error(`The wallet's coins for ${what} must carry no token: it would be destroyed.`);
};

// ------------------------------------------------------------------------------------------ create a loan key

export interface CreateLoanKeyParameters {
  contracts: ParyonContracts;
  /** A LoanKeyFactory thread. */
  factory: Utxo;
  /** A coin of the wallet that is output 0 of its transaction. That transaction's identifier becomes the key's category. */
  defining: InputSpec;
  /** More of the wallet's coins, when the first does not pay for everything. */
  funding?: InputSpec[];
  /** Output 0, the category's "authhead": a plain coin of the wallet's, which receives what is left after the fee. */
  changeTo: Uint8Array;
  feeRate?: number;
}

export interface CreatedLoanKey {
  built: BuiltTransaction;
  /** The new loan key's category, explorer order. */
  keyCategory: Uint8Array;
  /** The origin enforcer, holding the minting NFT of the new category, and the origin proof beside it. */
  enforcer: Utxo;
  proof: Utxo;
  change: Utxo;
}

/**
 * Inputs: 0 the defining coin · 1 the factory · 2… the wallet's further coins.
 * Outputs: 0 the wallet's change, without a token · 1 the factory · 2 the origin enforcer with the minting NFT
 * of the new category · 3 the origin proof (`LoanKeyFactory.cash`).
 */
export const createLoanKey = (parameters: CreateLoanKeyParameters): CreatedLoanKey => {
  const { contracts, factory, defining } = parameters;
  if (defining.utxo.index !== 0) throw new Error('A loan key\'s category comes from a coin that is output 0 of its transaction; this one is not.');
  plainCoins([defining, ...(parameters.funding ?? [])], 'a loan key');
  const keyCategory = defining.utxo.transactionHash;
  const built = buildTransaction({
    inputs: [defining, contractInput(factory, contracts.loanKeyFactory.unlock('create')), ...(parameters.funding ?? [])],
    outputs: [
      { lockingBytecode: parameters.changeTo, valueSatoshis: 0n },
      recreated(factory),
      { lockingBytecode: contracts.loanKeyOriginEnforcer.lockingBytecode, valueSatoshis: THREAD_SATOSHIS, token: { category: keyCategory, amount: 0n, nft: { capability: 'minting', commitment: new Uint8Array() } } },
      { lockingBytecode: contracts.loanKeyOriginProof.lockingBytecode, valueSatoshis: THREAD_SATOSHIS, token: { category: contracts.loanKeyFactoryCategory, amount: 0n, nft: { capability: 'none', commitment: new Uint8Array() } } },
    ],
    remainderOutputIndex: 0,
    ...(parameters.feeRate === undefined ? {} : { feeRate: parameters.feeRate }),
  });
  return { built, keyCategory, enforcer: outputOf(built, 2), proof: outputOf(built, 3), change: outputOf(built, 0) };
};

// ------------------------------------------------------------------------------ move a Borrowing thread on

export interface UpdatePeriodParameters {
  contracts: ParyonContracts;
  borrowing: Utxo;
  wallet: InputSpec[];
  /** The height of the chain's last block: the transaction's lock time, from which the new period follows. */
  height: number;
  changeTo: Uint8Array;
  feeRate?: number;
}

/**
 * `Borrowing.updatePeriodState`: anyone may move a thread to the period of the transaction's lock time. A
 * loan opened from it then starts in the current period, and no interest can be charged for periods before.
 *
 * Inputs: 0 the Borrowing thread · 1… the wallet's coins. Outputs: 0 the thread, with the new period · 1 change.
 * The lock time is a height, and the wallet's inputs are not final, as the contract requires.
 */
export const updateBorrowingPeriod = (parameters: UpdatePeriodParameters): { built: BuiltTransaction; borrowing: Utxo; change: Utxo; period: number } => {
  const { contracts, borrowing, height } = parameters;
  plainCoins(parameters.wallet, 'moving a Borrowing thread on');
  const current = decodeBorrowingPeriod(commitmentOf(borrowing, 'Borrowing thread'));
  const period = periodAt(contracts.deployment, height);
  if (period <= current) throw new Error(`The thread is in period ${current} already; height ${height} is in period ${period}.`);
  const token = borrowing.output.token as NonNullable<Output['token']>;
  const built = buildTransaction({
    inputs: [contractInput(borrowing, contracts.borrowing.unlock('updatePeriodState')), ...parameters.wallet],
    outputs: [
      { lockingBytecode: borrowing.output.lockingBytecode, valueSatoshis: THREAD_SATOSHIS, token: { ...token, nft: { capability: 'minting', commitment: encodeBorrowingPeriod(period) } } },
      { lockingBytecode: parameters.changeTo, valueSatoshis: 0n },
    ],
    remainderOutputIndex: 1,
    locktime: height,
    ...(parameters.feeRate === undefined ? {} : { feeRate: parameters.feeRate }),
  });
  return { built, borrowing: outputOf(built, 0), change: outputOf(built, 1), period };
};

// ------------------------------------------------------------------------------------------------- borrow

export interface BorrowParameters {
  contracts: ParyonContracts;
  borrowing: Utxo;
  price: Utxo;
  /** The origin enforcer and the origin proof a loan key's creation left, adjacent outputs of one transaction. */
  enforcer: Utxo;
  proof: Utxo;
  /** The wallet's coins: the collateral, the fee and the network fee. Any number, any script. */
  wallet: InputSpec[];
  /** PUSD cents. */
  debt: bigint;
  /** Satoshis the loan holds. */
  collateral: bigint;
  /** Per 10,000,000 per period. */
  startingInterest: number;
  interestManager?: InterestManagerConfiguration;
  /** Where the loan key goes (output 5) and the borrowed PUSD (output 6); no contract looks at either. */
  keyTo: Uint8Array;
  tokensTo: Uint8Array;
  /** Output 7: what is left after the fee. */
  changeTo: Uint8Array;
  feeRate?: number;
}

export interface Borrowed {
  built: BuiltTransaction;
  state: LoanState;
  keyCategory: Uint8Array;
  borrowingFee: bigint;
  loan: Utxo;
  sidecar: Utxo;
  key: Utxo;
  tokens: Utxo;
  change: Utxo;
  price: Utxo;
}

/**
 * `Borrowing.borrow` (`Borrowing.cash` 30–136).
 *
 * Inputs: 0 Borrowing · 1 price · 2 origin enforcer · 3 origin proof · 4… the wallet's coins.
 * Outputs: 0 Borrowing, less the debt · 1 price · 2 the loan · 3 its sidecar (the key's category, `01`) ·
 * 4 the borrowing fee · 5 the loan key · 6 the borrowed PUSD · 7 change. The origin proof is not carried on:
 * the guarded price contract leaves it nowhere to go, and it is burned.
 */
export const borrow = (parameters: BorrowParameters): Borrowed => {
  const { contracts, borrowing, price, enforcer, proof, debt } = parameters;
  plainCoins(parameters.wallet, 'a loan');
  const keyToken = enforcer.output.token;
  if (keyToken?.nft?.capability !== 'minting') throw new Error('The origin enforcer holds no minting NFT.');
  if (binToHex(enforcer.transactionHash) !== binToHex(proof.transactionHash) || proof.index !== enforcer.index + 1) throw new Error('The origin proof is not the output after the enforcer.');
  const keyCategory = keyToken.category;
  const { price: oraclePrice } = decodePriceState(commitmentOf(price, 'price thread'));
  const fee = borrowingFee(debt, oraclePrice);
  const state = newLoanState(debt, decodeBorrowingPeriod(commitmentOf(borrowing, 'Borrowing thread')), parameters.startingInterest, parameters.interestManager ?? NO_INTEREST_MANAGER);
  const supply = borrowing.output.token as NonNullable<Output['token']>;
  const P = contracts.paryonCategory;
  const built = buildTransaction({
    inputs: [
      contractInput(borrowing, contracts.borrowing.unlock('borrow', encodeInterestRate(parameters.startingInterest), encodeInterestManagerConfiguration(state.interestManager))),
      contractInput(price, contracts.price.unlock('sharePrice')),
      contractInput(enforcer, contracts.loanKeyOriginEnforcer.unlock('enforce')),
      contractInput(proof, contracts.loanKeyOriginProof.unlock('attach')),
      ...parameters.wallet,
    ],
    outputs: [
      { ...recreated(borrowing), token: { ...supply, amount: supply.amount - debt } },
      recreated(price),
      { lockingBytecode: contracts.loan.lockingBytecode, valueSatoshis: parameters.collateral, token: { category: P, amount: 0n, nft: { capability: 'mutable', commitment: encodeLoanState(state) } } },
      { lockingBytecode: contracts.loanSidecar.lockingBytecode, valueSatoshis: THREAD_SATOSHIS, token: { category: keyCategory, amount: 0n, nft: { capability: 'none', commitment: SIDECAR_COMMITMENT } } },
      { lockingBytecode: contracts.protocolFeeLockingBytecode, valueSatoshis: fee },
      { lockingBytecode: parameters.keyTo, valueSatoshis: THREAD_SATOSHIS, token: { category: keyCategory, amount: 0n, nft: { capability: 'minting', commitment: new Uint8Array() } } },
      { lockingBytecode: parameters.tokensTo, valueSatoshis: THREAD_SATOSHIS, token: { category: P, amount: debt } },
      { lockingBytecode: parameters.changeTo, valueSatoshis: 0n },
    ],
    remainderOutputIndex: 7,
    allowTokenBurn: true,
    ...(parameters.feeRate === undefined ? {} : { feeRate: parameters.feeRate }),
  });
  return { built, state, keyCategory, borrowingFee: fee, price: outputOf(built, 1), loan: outputOf(built, 2), sidecar: outputOf(built, 3), key: outputOf(built, 5), tokens: outputOf(built, 6), change: outputOf(built, 7) };
};

// ------------------------------------------------------------------------------------------ manage, close

export interface LoanInputs {
  contracts: ParyonContracts;
  price: Utxo;
  loan: Utxo;
  /** The output after the loan in the same transaction. */
  sidecar: Utxo;
  /** A manage function NFT. */
  manageFunction: Utxo;
  /** The loan key, unlocked by the wallet. It is input 4. */
  key: InputSpec;
  /** More of the wallet's coins: BCH, and PUSD for a repayment. */
  wallet: InputSpec[];
  /** Where PUSD the repayment does not use goes. */
  tokensChangeTo?: Uint8Array;
  /** What is left after the fee. */
  changeTo: Uint8Array;
  feeRate?: number;
}

export interface ManageParameters extends LoanInputs {
  /** PUSD cents to repay: 0, or at least 100.00 with at least 100.00 left. */
  repay: bigint;
  /** What the loan holds afterwards. More than before adds collateral; less withdraws it. */
  collateral: bigint;
  /** Unchanged unless given. */
  interestManager?: InterestManagerConfiguration;
  /**
   * Where the key goes. The contract requires the script it was spent from, which is the default; another is
   * refused, and is accepted here only to show that.
   */
  keyTo?: Uint8Array;
}

export interface Managed {
  built: BuiltTransaction;
  state: LoanState;
  price: Utxo;
  loan: Utxo;
  sidecar: Utxo;
  manageFunction: Utxo;
  key: Utxo;
  /** PUSD the repayment did not use. */
  tokens?: Utxo;
  change: Utxo;
}

/** The wallet's PUSD among its inputs, and a check that it brings no other token. */
const walletTokens = (inputs: LoanInputs, keyCategory: Uint8Array): bigint => {
  let amount = 0n;
  for (const { utxo } of inputs.wallet) {
    const { token } = utxo.output;
    if (token === undefined) continue;
    if (binToHex(token.category) !== binToHex(inputs.contracts.paryonCategory) || token.nft !== undefined) {
      throw new Error(`A coin of the wallet's carries a token (${binToHex(token.category) === binToHex(keyCategory) ? 'of the loan key\'s category' : binToHex(token.category)}) the transaction has nowhere to put.`);
    }
    amount += token.amount;
  }
  return amount;
};

const loanStateOf = (loan: Utxo): LoanState => decodeLoanState(commitmentOf(loan, 'loan'));

const keyCategoryOf = (inputs: LoanInputs): Uint8Array => {
  const sidecarToken = inputs.sidecar.output.token;
  const keyToken = inputs.key.utxo.output.token;
  if (sidecarToken === undefined || keyToken === undefined) throw new Error('The sidecar and the key each carry a token.');
  if (binToHex(sidecarToken.category) !== binToHex(keyToken.category) || keyToken.nft?.capability !== 'minting') throw new Error('The key is not the minting NFT of the sidecar\'s category.');
  if (binToHex(inputs.loan.transactionHash) !== binToHex(inputs.sidecar.transactionHash) || inputs.sidecar.index !== inputs.loan.index + 1) throw new Error('The sidecar is not the output after the loan.');
  return keyToken.category;
};

const loanInputSpecs = (inputs: LoanInputs, repay: bigint, interestManager: InterestManagerConfiguration): InputSpec[] => {
  const { contracts } = inputs;
  return [
    contractInput(inputs.price, contracts.price.unlock('sharePrice')),
    contractInput(inputs.loan, contracts.loan.unlock('interact')),
    contractInput(inputs.sidecar, contracts.loanSidecar.unlock('attach')),
    contractInput(inputs.manageFunction, contracts.manage.unlock('manage', repay, encodeInterestManagerConfiguration(interestManager))),
    inputs.key,
    ...inputs.wallet,
  ];
};

/**
 * `manageLoan.manage` on a loan that stays open: repay part of the debt, add or withdraw collateral, change the
 * interest manager. The loan key must come back to the script it was spent from, with the same value.
 *
 * Inputs: 0 price · 1 loan · 2 sidecar · 3 manage · 4 loan key · 5… the wallet's BCH and PUSD.
 * Outputs: 0 price · 1 loan · 2 sidecar · 3 manage · 4 the loan key, back · 5 the repaid PUSD, burned (when
 * repaying) · then PUSD change · then BCH change.
 */
export const manageLoan = (parameters: ManageParameters): Managed => {
  const { contracts, repay } = parameters;
  const keyCategory = keyCategoryOf(parameters);
  const held = walletTokens(parameters, keyCategory);
  if (held < repay) throw new Error(`The wallet brings ${held} PUSD cents; the repayment is ${repay}.`);
  const before = loanStateOf(parameters.loan);
  const interestManager = parameters.interestManager ?? before.interestManager;
  const state: LoanState = { ...before, borrowed: before.borrowed - repay, interestManager };
  const P = contracts.paryonCategory;
  const outputs: Output[] = [
    recreated(parameters.price),
    { ...recreated(parameters.loan), valueSatoshis: parameters.collateral, token: { category: P, amount: 0n, nft: { capability: 'mutable', commitment: encodeLoanState(state) } } },
    recreated(parameters.sidecar),
    recreated(parameters.manageFunction),
    { ...recreated(parameters.key.utxo), ...(parameters.keyTo === undefined ? {} : { lockingBytecode: parameters.keyTo }) },
  ];
  if (repay > 0n) outputs.push({ lockingBytecode: BURN_LOCKING_BYTECODE, valueSatoshis: 0n, token: { category: P, amount: repay } });
  let tokensIndex: number | undefined;
  if (held > repay) {
    if (parameters.tokensChangeTo === undefined) throw new Error('PUSD is left over and has no address to go to.');
    tokensIndex = outputs.length;
    outputs.push({ lockingBytecode: parameters.tokensChangeTo, valueSatoshis: THREAD_SATOSHIS, token: { category: P, amount: held - repay } });
  }
  outputs.push({ lockingBytecode: parameters.changeTo, valueSatoshis: 0n });
  const built = buildTransaction({
    inputs: loanInputSpecs(parameters, repay, interestManager),
    outputs,
    remainderOutputIndex: outputs.length - 1,
    ...(parameters.feeRate === undefined ? {} : { feeRate: parameters.feeRate }),
  });
  return {
    built,
    state,
    price: outputOf(built, 0),
    loan: outputOf(built, 1),
    sidecar: outputOf(built, 2),
    manageFunction: outputOf(built, 3),
    key: outputOf(built, 4),
    ...(tokensIndex === undefined ? {} : { tokens: outputOf(built, tokensIndex) }),
    change: outputOf(built, outputs.length - 1),
  };
};

export interface CloseParameters extends LoanInputs {
  /** Where the loan key goes. The contracts do not require it to continue; the wallet keeps it. */
  keyTo: Uint8Array;
}

export interface Closed {
  built: BuiltTransaction;
  /** The debt repaid and burned, in PUSD cents. */
  repaid: bigint;
  price: Utxo;
  manageFunction: Utxo;
  key: Utxo;
  tokens?: Utxo;
  /** The collateral, back to the wallet, less the fee. */
  change: Utxo;
}

/**
 * `manageLoan.manage` with the whole debt repaid and nothing being redeemed: the loan ends.
 *
 * Inputs: as for managing. Outputs: 0 price · 1 manage · 2 the repaid PUSD, burned · 3 the loan's own NFT,
 * burned · 4 the loan key, to the wallet · then PUSD change · then the collateral, less the fee. The sidecar's
 * NFT is not carried on, which nothing requires once the loan is gone; it is burned.
 */
export const closeLoan = (parameters: CloseParameters): Closed => {
  const { contracts } = parameters;
  const keyCategory = keyCategoryOf(parameters);
  const state = loanStateOf(parameters.loan);
  if (state.beingRedeemed !== 0n) throw new Error(`${state.beingRedeemed} PUSD cents of the loan are being redeemed; it cannot be closed until that ends.`);
  const repay = state.borrowed;
  const held = walletTokens(parameters, keyCategory);
  if (held < repay) throw new Error(`Closing repays ${repay} PUSD cents; the wallet brings ${held}.`);
  const P = contracts.paryonCategory;
  const outputs: Output[] = [
    recreated(parameters.price),
    recreated(parameters.manageFunction),
    { lockingBytecode: BURN_LOCKING_BYTECODE, valueSatoshis: 0n, token: { category: P, amount: repay } },
    { lockingBytecode: BURN_LOCKING_BYTECODE, valueSatoshis: 0n, token: parameters.loan.output.token as NonNullable<Output['token']> },
    { lockingBytecode: parameters.keyTo, valueSatoshis: parameters.key.utxo.output.valueSatoshis, token: parameters.key.utxo.output.token as NonNullable<Output['token']> },
  ];
  let tokensIndex: number | undefined;
  if (held > repay) {
    if (parameters.tokensChangeTo === undefined) throw new Error('PUSD is left over and has no address to go to.');
    tokensIndex = outputs.length;
    outputs.push({ lockingBytecode: parameters.tokensChangeTo, valueSatoshis: THREAD_SATOSHIS, token: { category: P, amount: held - repay } });
  }
  outputs.push({ lockingBytecode: parameters.changeTo, valueSatoshis: 0n });
  const built = buildTransaction({
    inputs: loanInputSpecs(parameters, repay, state.interestManager),
    outputs,
    remainderOutputIndex: outputs.length - 1,
    allowTokenBurn: true,
    ...(parameters.feeRate === undefined ? {} : { feeRate: parameters.feeRate }),
  });
  return {
    built,
    repaid: repay,
    price: outputOf(built, 0),
    manageFunction: outputOf(built, 1),
    key: outputOf(built, 4),
    ...(tokensIndex === undefined ? {} : { tokens: outputOf(built, tokensIndex) }),
    change: outputOf(built, outputs.length - 1),
  };
};

// -------------------------------------------------------------------------------------- change the interest

export interface ChangeInterestParameters {
  contracts: ParyonContracts;
  loan: Utxo;
  /** The output after the loan in the same transaction. */
  sidecar: Utxo;
  /** One of the interest function's coins (`changeInterest.cash`, commitment `08`). */
  interestFunction: Utxo;
  /** The loan key, unlocked by the wallet. It is input 3. */
  key: InputSpec;
  /** The wallet's coins that pay the fee. */
  wallet: InputSpec[];
  /** The rate from the next interest payment on, per 10,000,000 per period: 0 to 32,767. */
  rate: number;
  /** What the loan holds afterwards: at least what it holds now, which is the default. */
  collateral?: bigint;
  /** What is left after the fee. */
  changeTo: Uint8Array;
  feeRate?: number;
}

export interface InterestChanged {
  built: BuiltTransaction;
  state: LoanState;
  loan: Utxo;
  sidecar: Utxo;
  interestFunction: Utxo;
  key: Utxo;
  change: Utxo;
}

/**
 * `changeInterest.changeInterest(bytes2 nextInterestRate)`, by the loan's own key: the loan's rate for the periods to
 * come. The key holder may set any rate from 0 to 32,767; an interest manager the loan names only one within the
 * loan's limits. No price, period or waiting time is involved. The rate charged now stays until the next interest
 * payment, which makes the new one current (`payInterest.cash`).
 *
 * Inputs: 0 the loan · 1 its sidecar · 2 the interest function · 3 the loan key · 4… the wallet's coins.
 * Outputs: 0 the loan, with the new rate in its record and at least the same value · 1 the sidecar · 2 the interest
 * function · 3 the loan key, back to the script it was spent from, with the same value · 4 change.
 */
export const changeInterestRate = (parameters: ChangeInterestParameters): InterestChanged => {
  const { contracts, loan, sidecar, interestFunction, key } = parameters;
  plainCoins(parameters.wallet, 'changing the interest rate');
  const keyToken = key.utxo.output.token;
  if (keyToken?.nft?.capability !== 'minting' || binToHex(keyToken.category) !== binToHex(sidecar.output.token?.category ?? new Uint8Array())) throw new Error('The key is not the minting NFT of the sidecar\'s category.');
  if (binToHex(loan.transactionHash) !== binToHex(sidecar.transactionHash) || sidecar.index !== loan.index + 1) throw new Error('The sidecar is not the output after the loan.');
  const commitment = withNextInterestRate(commitmentOf(loan, 'loan'), parameters.rate);
  const collateral = parameters.collateral ?? loan.output.valueSatoshis;
  if (collateral < loan.output.valueSatoshis) throw new Error('Changing the interest rate cannot take collateral out.');
  const built = buildTransaction({
    inputs: [
      contractInput(loan, contracts.loan.unlock('interact')),
      contractInput(sidecar, contracts.loanSidecar.unlock('attach')),
      contractInput(interestFunction, contracts.changeInterest.unlock('changeInterest', encodeInterestRate(parameters.rate))),
      key,
      ...parameters.wallet,
    ],
    outputs: [
      { ...recreated(loan), valueSatoshis: collateral, token: { category: contracts.paryonCategory, amount: 0n, nft: { capability: 'mutable', commitment } } },
      recreated(sidecar),
      recreated(interestFunction),
      recreated(key.utxo),
      { lockingBytecode: parameters.changeTo, valueSatoshis: 0n },
    ],
    remainderOutputIndex: 4,
    ...(parameters.feeRate === undefined ? {} : { feeRate: parameters.feeRate }),
  });
  return { built, state: decodeLoanState(commitment), loan: outputOf(built, 0), sidecar: outputOf(built, 1), interestFunction: outputOf(built, 2), key: outputOf(built, 3), change: outputOf(built, 4) };
};
