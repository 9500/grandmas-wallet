import { readFileSync } from 'node:fs';

import { type Output, binToHex, createVirtualMachineBch2025, encodeLockingBytecodeP2pkh, encodeTransactionBch, hexToBin } from '@bitauth/libauth';
import {
  type BuiltTransaction,
  type InputSpec,
  type Utxo,
  buildTransaction,
  checkBeforeSending,
  deriveSeedKeys,
  recoverableInput,
  walletAddress,
} from '@grandmas-wallet/core';
import { describe, expect, it } from 'vitest';

import { walletTemplateNumbers } from '../../app/src/templates.js';
import {
  type ListedOutput,
  type ParyonChain,
  type ParyonDeployment,
  CHIPNET_FAST_PERIODS_6,
  MAINNET_V1,
  NO_INTEREST_MANAGER,
  borrow,
  borrowingFee,
  changeInterestRate,
  closeLoan,
  collateralAtRatio,
  createLoanKey,
  decodeBorrowingPeriod,
  decodeLoanState,
  decodePriceState,
  encodeLoanState,
  findLoan,
  manageLoan,
  maximumDebt,
  minimumCollateral,
  paryonContracts,
  periodAt,
  periodStart,
  updateBorrowingPeriod,
} from '../src/index.js';

/**
 * A borrower's five transactions on each of ParyonUSD's own deployments, chipnet's (periods of 3 blocks) and
 * mainnet's (periods of 144), built against their live outputs as they were recorded (`fixtures/chipnet-live.json`,
 * `fixtures/mainnet-live.json`, written by `src/snapshot.ts`), with the wallet's coins and the loan key at
 * recoverable addresses of a wallet of this project. Each is checked in the virtual machine, every input, under the
 * 2026 rules with this project's check before sending, and under the 2025 rules. Nothing is sent anywhere.
 */

interface RecordedOutput {
  transactionId: string;
  index: number;
  height: number;
  valueSatoshis: string;
  lockingBytecode: string;
  token?: { category: string; amount: string; nft?: { capability: 'none' | 'mutable' | 'minting'; commitment: string } };
}
const runOn = (deployment: ParyonDeployment): void => {
const contracts = paryonContracts(deployment);
const recorded = JSON.parse(readFileSync(new URL(`fixtures/${deployment.network}-live.json`, import.meta.url), 'utf8')) as {
  tip: { height: number };
  borrowing: RecordedOutput[];
  price: RecordedOutput[];
  loanKeyFactory: RecordedOutput[];
  manage: RecordedOutput[];
  changeInterest: RecordedOutput[];
};
const outputOf = (entry: RecordedOutput): Output => ({
  lockingBytecode: hexToBin(entry.lockingBytecode),
  valueSatoshis: BigInt(entry.valueSatoshis),
  ...(entry.token === undefined
    ? {}
    : { token: { category: hexToBin(entry.token.category), amount: BigInt(entry.token.amount), ...(entry.token.nft === undefined ? {} : { nft: { capability: entry.token.nft.capability, commitment: hexToBin(entry.token.nft.commitment) } }) } }),
});
const utxoOf = (entry: RecordedOutput): Utxo => ({ transactionHash: hexToBin(entry.transactionId), index: entry.index, output: outputOf(entry) });

/** A chain made of the recorded outputs and the transactions a test adds, for the loan finder. */
class LocalChain implements ParyonChain {
  private readonly transactions = new Map<string, string>();
  private readonly unspent = new Map<string, { utxo: Utxo; height: number }>();

  constructor(outputs: RecordedOutput[]) {
    for (const entry of outputs) this.unspent.set(`${entry.transactionId}:${entry.index}`, { utxo: utxoOf(entry), height: entry.height });
  }

  add(built: BuiltTransaction): void {
    for (const input of built.transaction.inputs) this.unspent.delete(`${binToHex(input.outpointTransactionHash)}:${input.outpointIndex}`);
    built.transaction.outputs.forEach((output, index) => this.unspent.set(`${built.transactionId}:${index}`, { utxo: { transactionHash: built.transactionHash, index, output }, height: 0 }));
    this.transactions.set(built.transactionId, binToHex(encodeTransactionBch(built.transaction)));
  }

  async getTransaction(transactionId: string): Promise<string | undefined> {
    return this.transactions.get(transactionId);
  }

  async listUnspent(lockingBytecode: Uint8Array): Promise<ListedOutput[]> {
    return [...this.unspent.values()]
      .filter(({ utxo }) => binToHex(utxo.output.lockingBytecode) === binToHex(lockingBytecode))
      .map(({ utxo, height }) => ({ transactionId: binToHex(utxo.transactionHash), index: utxo.index, valueSatoshis: utxo.output.valueSatoshis, height }));
  }
}

// The wallet: addresses of a seed of this project's wallet, for a made-up identity. Change addresses (kind 1).
const seed = deriveSeedKeys('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about', 'testnet', walletTemplateNumbers());
const identity = hexToBin('77'.repeat(32));
const address = (number: number) => walletAddress(identity, seed.viewingKey, 1, number);
const spend = (utxo: Utxo): InputSpec => {
  const at = binToHex(utxo.output.lockingBytecode);
  for (let number = 0; number < 50; number++) {
    const candidate = address(number);
    if (binToHex(candidate.lockingBytecode) === at && candidate.kind === 1) return recoverableInput(utxo, candidate.script, seed.addressKey(1, number));
  }
  throw new Error('not an address of the wallet');
};
const to = (number: number): Uint8Array => address(number).lockingBytecode;

const vm2025 = createVirtualMachineBch2025(true);
/** Every input passes, under both rule sets, and the fee is exact. */
const accepted = (built: BuiltTransaction): void => {
  expect(checkBeforeSending(built)).toBe(true);
  expect(vm2025.verify({ transaction: built.transaction, sourceOutputs: built.sourceOutputs })).toBe(true);
};
/** Refused, at the given input. */
const refused = (built: BuiltTransaction, input: number): void => {
  const verdict = checkBeforeSending(built);
  expect(verdict).not.toBe(true);
  expect(String(verdict)).toMatch(new RegExp(`error in evaluating input index ${input}:`, "i"));
};

const pick = <T>(items: T[]): T => {
  const [first] = items;
  if (first === undefined) throw new Error('none recorded');
  return first;
};
const highestPrice = recorded.price.slice().sort((a, b) => Number(decodePriceState(hexToBin(b.token?.nft?.commitment ?? '')).price - decodePriceState(hexToBin(a.token?.nft?.commitment ?? '')).price));
const PRICE = pick(highestPrice);
const STORED_PRICE = decodePriceState(hexToBin(PRICE.token?.nft?.commitment ?? '')).price;
const BORROWING = pick(recorded.borrowing);
const FACTORY = pick(recorded.loanKeyFactory);
const MANAGE = pick(recorded.manage);
const INTEREST = pick(recorded.changeInterest);
// A lock height at the chain's tip, or, where every Borrowing thread is already in the tip's period (as on mainnet,
// where Paryon's keepers move them on), the first height of the next period, so that a thread is moved on.
const tipPeriod = periodAt(deployment, recorded.tip.height);
const HEIGHT = recorded.borrowing.some((entry) => decodeBorrowingPeriod(hexToBin(entry.token?.nft?.commitment ?? '')) < tipPeriod) ? recorded.tip.height : periodStart(deployment, tipPeriod + 1);

/** The course from the wallet's first coin: a loan key, the Borrowing thread moved on, the loan. */
const open = (debt: bigint, collateral: bigint, startingInterest = 0) => {
  const funding: Utxo = { transactionHash: hexToBin('ab'.repeat(32)), index: 0, output: { lockingBytecode: to(0), valueSatoshis: collateral + 1_000_000n } };
  const created = createLoanKey({ contracts, factory: utxoOf(FACTORY), defining: spend(funding), changeTo: to(1) });
  const moved = updateBorrowingPeriod({ contracts, borrowing: utxoOf(BORROWING), wallet: [spend(created.change)], height: HEIGHT, changeTo: to(2) });
  const opened = borrow({
    contracts,
    borrowing: moved.borrowing,
    price: utxoOf(PRICE),
    enforcer: created.enforcer,
    proof: created.proof,
    wallet: [spend(moved.change)],
    debt,
    collateral,
    startingInterest,
    keyTo: to(3),
    tokensTo: to(4),
    changeTo: to(5),
  });
  return { funding, created, moved, opened };
};

describe('the deployment', () => {
  it('builds every contract at the address its live outputs are at', () => {
    for (const [entries, script] of [
      [recorded.borrowing, contracts.borrowing],
      [recorded.price, contracts.price],
      [recorded.loanKeyFactory, contracts.loanKeyFactory],
      [recorded.manage, contracts.manage],
      [recorded.changeInterest, contracts.changeInterest],
    ] as const) {
      expect(entries.length).toBeGreaterThan(0);
      for (const entry of entries) expect(entry.lockingBytecode).toBe(binToHex(script.lockingBytecode));
    }
    // Contracts without parameters are the same for every deployment, mainnet included; the key's enforcer names the
    // deployment's categories.
    if (deployment === CHIPNET_FAST_PERIODS_6) expect(binToHex(contracts.loanKeyOriginEnforcer.lockingBytecode)).toBe('aa20f2c7937ed76ca51f5c93e608ab702ad56cee8f9224e132b7411be33a62b1e38187');
    expect(binToHex(contracts.loan.lockingBytecode)).toBe('aa200e21a4c1f868fe858109296e53720c50045825ab58e49d5f43e0ba8576a7509287');
    expect(binToHex(contracts.loanSidecar.lockingBytecode)).toBe('aa207886a5ad284f5ae9f09af871df72f5107b7b9dce7452b852a54e5fc6652dfd0f87');
    expect(binToHex(contracts.loanKeyOriginProof.lockingBytecode)).toBe('aa207a30bbbf07a1cb3d7da2a270ab2c2a7c0fb1ed0dc092db9cd650ec3abd4a5b6e87');
  });
});

describe('the contracts\' arithmetic', () => {
  it('gives the least collateral to the satoshi, and the fee', () => {
    expect(minimumCollateral(100_00n, 27_498n)).toBe(40_002_911n);
    expect(borrowingFee(100_00n, 27_498n)).toBe(90_915n);
    expect(minimumCollateral(200_00n, 27_498n)).toBe(80_005_820n);
    expect(borrowingFee(200_00n, 27_498n)).toBe(181_831n);
    expect(minimumCollateral(100_00n, 20_861n)).toBe(52_729_976n);
    expect(maximumDebt(40_002_911n - 1n, 27_498n)).toBe(9_999n);
    expect(collateralAtRatio(100_00n, 20_000n, 115n)).toBe(57_500_000n);
  });

  it('writes and reads a loan\'s state as Borrowing.cash builds it', () => {
    const commitment = hexToBin('01204e00000000000000000000' + '00' + 'b4230000' + '0000' + '0000' + '00' + '0000' + 'ff7f');
    const state = decodeLoanState(commitment);
    expect(state).toEqual({ borrowed: 200_00n, beingRedeemed: 0n, status: 0, lastPeriodInterestPaid: 9140, currentInterestRate: 0, nextInterestRate: 0, interestManager: NO_INTEREST_MANAGER });
    expect(binToHex(encodeLoanState(state))).toBe(binToHex(commitment));
  });
});

describe('PY01, PY04: a loan from recoverable addresses, against the recorded live outputs', () => {
  const DEBT = 100_00n;
  const COLLATERAL = minimumCollateral(DEBT, STORED_PRICE);

  it('creates a loan key, moves the Borrowing thread on, and borrows; the key and the PUSD go to recoverable addresses', () => {
    const { funding, created, moved, opened } = open(DEBT, COLLATERAL);
    accepted(created.built);
    expect(binToHex(created.keyCategory)).toBe(binToHex(funding.transactionHash));
    expect(created.built.transaction.outputs.length).toBe(4);
    accepted(moved.built);
    expect(moved.period).toBe(periodAt(deployment, HEIGHT));
    expect(moved.built.transaction.locktime).toBe(HEIGHT);
    accepted(opened.built);
    expect(opened.built.transaction.outputs.length).toBe(8);
    expect(opened.state.lastPeriodInterestPaid).toBe(moved.period);
    expect(binToHex(opened.key.output.lockingBytecode)).toBe(binToHex(to(3)));
    expect(opened.key.output.token?.nft?.capability).toBe('minting');
    expect(binToHex(opened.tokens.output.lockingBytecode)).toBe(binToHex(to(4)));
    expect(opened.tokens.output.token?.amount).toBe(DEBT);
    expect(opened.borrowingFee).toBe(borrowingFee(DEBT, STORED_PRICE));
    // The wallet's input is the everyday path of a recoverable address: a key's signature.
    expect(opened.built.transaction.inputs[4]?.unlockingBytecode.length).toBeGreaterThan(200);
  });

  it('refuses a loan with one satoshi too little collateral, at the Borrowing contract', () => {
    refused(open(DEBT, COLLATERAL - 1n).opened.built, 0);
  });

  it('manages without a repayment, adding collateral, then closes: the PUSD and the loan\'s NFT burned', () => {
    const { opened } = open(DEBT, COLLATERAL);
    const added = manageLoan({
      contracts,
      price: opened.price,
      loan: opened.loan,
      sidecar: opened.sidecar,
      manageFunction: utxoOf(MANAGE),
      key: spend(opened.key),
      wallet: [spend(opened.change)],
      repay: 0n,
      collateral: COLLATERAL + 10_000n,
      changeTo: to(6),
    });
    accepted(added.built);
    expect(added.loan.output.valueSatoshis).toBe(COLLATERAL + 10_000n);
    expect(binToHex(added.key.output.lockingBytecode)).toBe(binToHex(opened.key.output.lockingBytecode));
    const closed = closeLoan({ contracts, price: added.price, loan: added.loan, sidecar: added.sidecar, manageFunction: added.manageFunction, key: spend(added.key), wallet: [spend(opened.tokens)], keyTo: to(7), changeTo: to(8) });
    accepted(closed.built);
    const outputs = closed.built.transaction.outputs;
    expect(binToHex(outputs[2]?.lockingBytecode ?? new Uint8Array())).toBe('6a');
    expect(outputs[2]?.token?.amount).toBe(DEBT);
    expect(binToHex(outputs[3]?.lockingBytecode ?? new Uint8Array())).toBe('6a');
    expect(outputs[3]?.token?.nft?.capability).toBe('mutable');
    expect(closed.key.output.token?.nft?.capability).toBe('minting');
    // The collateral comes back, less the network fee: the close needs no other coin of the wallet.
    expect(closed.change.output.valueSatoshis).toBe(COLLATERAL + 10_000n + 1000n + 1000n - closed.built.feeSatoshis);
  });

  it('withdraws collateral down to the contracts\' limit and no further', () => {
    const generous = COLLATERAL + 500_000n;
    const { opened } = open(DEBT, generous);
    const withdraw = (collateral: bigint) =>
      manageLoan({ contracts, price: opened.price, loan: opened.loan, sidecar: opened.sidecar, manageFunction: utxoOf(MANAGE), key: spend(opened.key), wallet: [spend(opened.change)], repay: 0n, collateral, changeTo: to(6) });
    accepted(withdraw(COLLATERAL).built);
    refused(withdraw(COLLATERAL - 1n).built, 3);
  });

  it('refuses a manage that sends the loan key to another address, at the manage contract', () => {
    const { opened } = open(DEBT, COLLATERAL);
    const elsewhere = manageLoan({
      contracts,
      price: opened.price,
      loan: opened.loan,
      sidecar: opened.sidecar,
      manageFunction: utxoOf(MANAGE),
      key: spend(opened.key),
      wallet: [spend(opened.change)],
      repay: 0n,
      collateral: COLLATERAL + 10_000n,
      keyTo: to(9),
      changeTo: to(6),
    });
    refused(elsewhere.built, 3);
    // Not even to a plain address of the same key.
    refused(manageLoan({ contracts, price: opened.price, loan: opened.loan, sidecar: opened.sidecar, manageFunction: utxoOf(MANAGE), key: spend(opened.key), wallet: [spend(opened.change)], repay: 0n, collateral: COLLATERAL, keyTo: encodeLockingBytecodeP2pkh(seed.addressKey(1, 3).keyHash), changeTo: to(6) }).built, 3);
  });

  it('refuses a partial repayment that would leave less than 100.00 PUSD', () => {
    const { opened } = open(DEBT, COLLATERAL);
    const half = manageLoan({ contracts, price: opened.price, loan: opened.loan, sidecar: opened.sidecar, manageFunction: utxoOf(MANAGE), key: spend(opened.key), wallet: [spend(opened.change), spend(opened.tokens)], repay: 50_00n, collateral: COLLATERAL, tokensChangeTo: to(10), changeTo: to(6) });
    refused(half.built, 3);
  });

  it('refuses a coin that carries a token as collateral, since the borrow would destroy it', () => {
    const { created, moved } = open(DEBT, COLLATERAL);
    const withToken: Utxo = { transactionHash: hexToBin('cd'.repeat(32)), index: 1, output: { lockingBytecode: to(2), valueSatoshis: COLLATERAL * 2n, token: { category: hexToBin('ef'.repeat(32)), amount: 5n } } };
    expect(() => borrow({ contracts, borrowing: moved.borrowing, price: utxoOf(PRICE), enforcer: created.enforcer, proof: created.proof, wallet: [spend(withToken)], debt: DEBT, collateral: COLLATERAL, startingInterest: 0, keyTo: to(3), tokensTo: to(4), changeTo: to(5) })).toThrow(/carry no token/);
  });
});

describe('PY04: managing with a repayment, on a loan of 200.00 PUSD (shown here, not sent: see the record)', () => {
  const DEBT = 200_00n;
  const COLLATERAL = minimumCollateral(DEBT, STORED_PRICE);

  it('repays 100.00 PUSD and keeps the loan open, the repaid PUSD burned and the rest back to the wallet; then closes', () => {
    const { opened } = open(DEBT, COLLATERAL);
    accepted(opened.built);
    const added = manageLoan({ contracts, price: opened.price, loan: opened.loan, sidecar: opened.sidecar, manageFunction: utxoOf(MANAGE), key: spend(opened.key), wallet: [spend(opened.change)], repay: 0n, collateral: COLLATERAL + 10_000n, changeTo: to(6) });
    accepted(added.built);
    const repaid = manageLoan({
      contracts,
      price: added.price,
      loan: added.loan,
      sidecar: added.sidecar,
      manageFunction: added.manageFunction,
      key: spend(added.key),
      wallet: [spend(added.change), spend(opened.tokens)],
      repay: 100_00n,
      collateral: added.loan.output.valueSatoshis,
      tokensChangeTo: to(7),
      changeTo: to(8),
    });
    accepted(repaid.built);
    const outputs = repaid.built.transaction.outputs;
    expect(binToHex(outputs[5]?.lockingBytecode ?? new Uint8Array())).toBe('6a');
    expect(outputs[5]?.token?.amount).toBe(100_00n);
    expect(repaid.tokens?.output.token?.amount).toBe(100_00n);
    expect(repaid.state.borrowed).toBe(100_00n);
    expect(decodeLoanState(repaid.loan.output.token?.nft?.commitment ?? new Uint8Array()).borrowed).toBe(100_00n);
    const closed = closeLoan({ contracts, price: repaid.price, loan: repaid.loan, sidecar: repaid.sidecar, manageFunction: repaid.manageFunction, key: spend(repaid.key), wallet: [spend(repaid.tokens as Utxo)], keyTo: to(9), changeTo: to(10) });
    accepted(closed.built);
    expect(closed.repaid).toBe(100_00n);
  });
});

describe('changing the interest rate (`changeInterest.cash`), by the loan\'s own key', () => {
  const DEBT = 200_00n;
  const COLLATERAL = minimumCollateral(DEBT, STORED_PRICE) + 50_000n;
  const change = (opened: ReturnType<typeof open>['opened'], rate: number, more: Partial<Parameters<typeof changeInterestRate>[0]> = {}) =>
    changeInterestRate({ contracts, loan: opened.loan, sidecar: opened.sidecar, interestFunction: utxoOf(INTEREST), key: spend(opened.key), wallet: [spend(opened.change)], rate, changeTo: to(6), ...more });

  it('the recorded coins of the interest function are NFTs of the deployment\'s category with commitment 08, of 1,000 satoshis', () => {
    expect(recorded.changeInterest.length).toBeGreaterThan(1);
    for (const entry of recorded.changeInterest) expect(entry).toMatchObject({ valueSatoshis: '1000', token: { category: deployment.tokenIds.paryon, amount: '0', nft: { capability: 'none', commitment: '08' } } });
  });

  it('sets the rate for the periods to come: only the next rate in the loan\'s record changes; the loan, its sidecar, the function and the key are recreated at outputs 0 to 3', () => {
    const { opened } = open(DEBT, COLLATERAL);
    const changed = change(opened, 1_096);
    accepted(changed.built);
    const before = hexToBin(binToHex(opened.loan.output.token?.nft?.commitment ?? new Uint8Array()));
    const after = changed.loan.output.token?.nft?.commitment ?? new Uint8Array();
    expect(changed.state).toEqual({ ...decodeLoanState(before), nextInterestRate: 1_096 });
    expect(binToHex(after.slice(0, 20))).toBe(binToHex(before.slice(0, 20)));
    expect(binToHex(after.slice(22))).toBe(binToHex(before.slice(22)));
    expect(changed.loan.output.valueSatoshis).toBe(COLLATERAL);
    const { inputs, outputs } = changed.built.transaction;
    // Inputs: 0 loan, 1 sidecar, 2 the function, 3 the key, 4 the wallet's coin.
    expect(inputs.map((input) => `${binToHex(input.outpointTransactionHash)}:${input.outpointIndex}`).slice(0, 4)).toEqual([opened.loan, opened.sidecar, utxoOf(INTEREST), opened.key].map((utxo) => `${binToHex(utxo.transactionHash)}:${utxo.index}`));
    expect(binToHex(outputs[1]?.lockingBytecode ?? new Uint8Array())).toBe(binToHex(contracts.loanSidecar.lockingBytecode));
    expect(binToHex(outputs[2]?.lockingBytecode ?? new Uint8Array())).toBe(binToHex(contracts.changeInterest.lockingBytecode));
    expect(binToHex(outputs[3]?.lockingBytecode ?? new Uint8Array())).toBe(binToHex(opened.key.output.lockingBytecode));
    expect(outputs).toHaveLength(5);
    // The lowest and the highest rate the key holder may set; the rate back to 0.
    accepted(change(opened, 0).built);
    accepted(change(opened, 32_767).built);
    expect(() => change(opened, 32_768)).toThrow(/from 0 to 32767/);
    expect(() => change(opened, -1)).toThrow(/from 0 to 32767/);
  });

  it('needs no price contract and no period, and may be done again at once; a loan with a changed rate is managed and closed as any other', () => {
    const { opened } = open(DEBT, COLLATERAL);
    const first = change(opened, 500);
    accepted(first.built);
    const again = changeInterestRate({ contracts, loan: first.loan, sidecar: first.sidecar, interestFunction: first.interestFunction, key: spend(first.key), wallet: [spend(first.change)], rate: 10, changeTo: to(7) });
    accepted(again.built);
    expect(again.state.nextInterestRate).toBe(10);
    expect(again.state.currentInterestRate).toBe(0);
    const repaid = manageLoan({ contracts, price: opened.price, loan: again.loan, sidecar: again.sidecar, manageFunction: utxoOf(MANAGE), key: spend(again.key), wallet: [spend(again.change), spend(opened.tokens)], repay: 100_00n, collateral: again.loan.output.valueSatoshis, tokensChangeTo: to(8), changeTo: to(9) });
    accepted(repaid.built);
    expect(repaid.state.nextInterestRate).toBe(10);
  });

  it('refuses at the interest function: the key sent elsewhere, a record that changes more than the rate, collateral taken out', () => {
    const { opened } = open(DEBT, COLLATERAL);
    const honest = change(opened, 100);
    // The key to another address of the wallet's.
    const tx = honest.built.transaction;
    const keyElsewhere = buildTransaction({
      inputs: [
        { utxo: opened.loan, unlock: () => tx.inputs[0]?.unlockingBytecode as Uint8Array },
        { utxo: opened.sidecar, unlock: () => tx.inputs[1]?.unlockingBytecode as Uint8Array },
        { utxo: utxoOf(INTEREST), unlock: () => tx.inputs[2]?.unlockingBytecode as Uint8Array },
        spend(opened.key),
        spend(opened.change),
      ],
      outputs: [tx.outputs[0] as Output, tx.outputs[1] as Output, tx.outputs[2] as Output, { ...(tx.outputs[3] as Output), lockingBytecode: to(9) }, { lockingBytecode: to(6), valueSatoshis: 0n }],
      remainderOutputIndex: 4,
    });
    refused(keyElsewhere, 2);
    // A record that also lowers the debt.
    const lowered = buildTransaction({
      inputs: keyElsewhere.transaction.inputs.map((_, index) => (index < 3 ? { utxo: [opened.loan, opened.sidecar, utxoOf(INTEREST)][index] as Utxo, unlock: () => tx.inputs[index]?.unlockingBytecode as Uint8Array } : index === 3 ? spend(opened.key) : spend(opened.change))),
      outputs: [{ ...(tx.outputs[0] as Output), token: { ...(tx.outputs[0]?.token as NonNullable<Output['token']>), nft: { capability: 'mutable', commitment: encodeLoanState({ ...honest.state, borrowed: 100_00n }) } } }, tx.outputs[1] as Output, tx.outputs[2] as Output, tx.outputs[3] as Output, { lockingBytecode: to(6), valueSatoshis: 0n }],
      remainderOutputIndex: 4,
    });
    refused(lowered, 2);
    expect(() => change(opened, 100, { collateral: COLLATERAL - 1n })).toThrow(/cannot take collateral out/);
  });
});

describe('finding a loan from its key', () => {
  it('finds the loan through its sidecar, follows it through a manage, ignores a look-alike, and finds nothing after closing', async () => {
    const DEBT = 100_00n;
    const COLLATERAL = collateralAtRatio(DEBT, STORED_PRICE, 120n);
    const chain = new LocalChain([...recorded.borrowing, ...recorded.price, ...recorded.loanKeyFactory, ...recorded.manage]);
    const { created, moved, opened } = open(DEBT, COLLATERAL);
    for (const built of [created.built, moved.built, opened.built]) chain.add(built);
    const found = await findLoan(chain, contracts, opened.keyCategory);
    expect(found?.state.borrowed).toBe(DEBT);
    expect(binToHex(found?.loan.transactionHash ?? new Uint8Array())).toBe(opened.built.transactionId);
    expect(found?.loan.output.valueSatoshis).toBe(COLLATERAL);

    // The key holder mints a look-alike sidecar NFT to the sidecar's script: no loan stands beside it.
    const lookAlike = buildTransaction({
      inputs: [spend(opened.key), spend(opened.change)],
      outputs: [
        { lockingBytecode: to(20), valueSatoshis: 1000n },
        { lockingBytecode: contracts.loanSidecar.lockingBytecode, valueSatoshis: 1000n, token: { category: opened.keyCategory, amount: 0n, nft: { capability: 'none', commitment: Uint8Array.of(1) } } },
        { lockingBytecode: opened.key.output.lockingBytecode, valueSatoshis: 1000n, token: opened.key.output.token as NonNullable<Output['token']> },
      ],
      changeLockingBytecode: to(21),
    });
    accepted(lookAlike);
    chain.add(lookAlike);
    const key = { transactionHash: lookAlike.transactionHash, index: 2, output: lookAlike.transaction.outputs[2] as Output };
    const change = { transactionHash: lookAlike.transactionHash, index: 3, output: lookAlike.transaction.outputs[3] as Output };
    expect(binToHex((await findLoan(chain, contracts, opened.keyCategory))?.loan.transactionHash ?? new Uint8Array())).toBe(opened.built.transactionId);

    const managed = manageLoan({ contracts, price: opened.price, loan: opened.loan, sidecar: opened.sidecar, manageFunction: utxoOf(MANAGE), key: spend(key), wallet: [spend(change)], repay: 0n, collateral: COLLATERAL + 5_000n, changeTo: to(22) });
    accepted(managed.built);
    chain.add(managed.built);
    const after = await findLoan(chain, contracts, opened.keyCategory);
    expect(binToHex(after?.loan.transactionHash ?? new Uint8Array())).toBe(managed.built.transactionId);
    expect(after?.loan.output.valueSatoshis).toBe(COLLATERAL + 5_000n);

    const closed = closeLoan({ contracts, price: managed.price, loan: managed.loan, sidecar: managed.sidecar, manageFunction: managed.manageFunction, key: spend(managed.key), wallet: [spend(opened.tokens)], keyTo: to(23), changeTo: to(24) });
    accepted(closed.built);
    chain.add(closed.built);
    expect(await findLoan(chain, contracts, opened.keyCategory)).toBeUndefined();
  });
});
};

for (const deployment of [CHIPNET_FAST_PERIODS_6, MAINNET_V1]) describe(deployment.name, () => runOn(deployment));
