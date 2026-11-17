import { describe, expect, it } from 'vitest';

import {
  type CoinChoice,
  type SpendableCoin,
  ADDRESS_KIND,
  INPUT_BYTES,
  InsufficientFundsError,
  buildTransaction,
  checkBeforeSending,
  chooseCoins,
  planSendEverything,
  transactionBytes,
} from '../src/index.js';
import { activeState, owner } from './harness.js';
import { type Coin, coinAt, controllerStep, payment, plainCoin, vaultCoinAt } from './wallet.js';

/**
 * Acceptance tests FE04 and FE05 of the proposal, and the planning behind FE06 and FE07: choosing coins for
 * a payment, and sending everything.
 */

const changeAddress = coinAt(90, { kind: ADDRESS_KIND.change }).script.lockingBytecode;
let next = 0;
/** Coins of the wallet with the given values, each at an address of its own. */
const coinsOf = (...values: bigint[]): { coins: Coin[]; spendable: SpendableCoin[] } => {
  const coins = values.map((valueSatoshis) => coinAt((next++ % 40) + 1, { valueSatoshis }));
  return { coins, spendable: coins.map((coin) => ({ utxo: coin.utxo, inputBytes: INPUT_BYTES.byKey })) };
};
const valuesOf = (choice: CoinChoice): bigint[] => choice.coins.map(({ utxo }) => utxo.output.valueSatoshis);

/** Build what was chosen, and check that the plan's size and fee are the ones the builder measures. */
const carryOut = (coins: Coin[], choice: CoinChoice, outputs: ReturnType<typeof payment>[]) => {
  const inputs = choice.coins.map(({ utxo }) => {
    const coin = coins.find((candidate) => candidate.utxo === utxo);
    if (coin === undefined) throw new Error('a coin was chosen that was not offered');
    return coin.byKey();
  });
  const built = buildTransaction({ inputs, outputs, changeLockingBytecode: changeAddress });
  expect(built.encoded.length).toBe(choice.bytes);
  expect(built.feeSatoshis).toBe(choice.feeSatoshis);
  expect(built.remainderSatoshis).toBe(choice.remainderSatoshis);
  expect(built.changeIndex === undefined ? undefined : built.transaction.outputs[built.changeIndex]?.valueSatoshis).toBe(choice.changeSatoshis);
  expect(checkBeforeSending(built)).toBe(true);
  return built;
};

describe('choosing coins for a payment', () => {
  it('FE04: a payment that some choice of coins makes without change is made without a change output', () => {
    // 5,000 to pay; the coin of 5,340 pays it and its own fee of 340 exactly.
    const { coins, spendable } = coinsOf(10_000n, 5_340n, 3_000n, 20_000n);
    const outputs = [payment(5_000n)];
    const choice = chooseCoins({ available: spendable, outputs, changeLockingBytecode: changeAddress });
    expect(valuesOf(choice)).toEqual([5_340n]);
    expect(choice.changeSatoshis).toBeUndefined();
    expect(choice.remainderSatoshis).toBe(0n);
    const built = carryOut(coins, choice, outputs);
    expect(built.transaction.outputs).toHaveLength(1);
  });

  it('FE04: two coins that together leave nothing are preferred to one coin with change', () => {
    // 3,000 + 2,636 pay 5,000 and the fee of 636 for two inputs and one output.
    const { coins, spendable } = coinsOf(50_000n, 3_000n, 2_636n, 700n);
    const outputs = [payment(5_000n)];
    const choice = chooseCoins({ available: spendable, outputs, changeLockingBytecode: changeAddress });
    expect(valuesOf(choice).sort()).toEqual([2_636n, 3_000n]);
    expect(choice.changeSatoshis).toBeUndefined();
    carryOut(coins, choice, outputs);
  });

  it('FE04: with no such choice, the fewest coins pay and the rest returns as change', () => {
    const { coins, spendable } = coinsOf(4_000n, 30_000n, 9_000n);
    const outputs = [payment(12_000n)];
    const choice = chooseCoins({ available: spendable, outputs, changeLockingBytecode: changeAddress });
    expect(valuesOf(choice)).toEqual([30_000n]);
    // One input, a payment and a change output: 384 bytes.
    expect(choice.bytes).toBe(384);
    expect(choice.changeSatoshis).toBe(30_000n - 12_000n - 384n);
    carryOut(coins, choice, outputs);
  });

  it('FE05: a small remainder is left to the fee when that is cheaper than a change output, and it is shown', () => {
    // 6,000 pays 5,400 and the fee of 340; 260 is left. Change would cost 44 bytes now and 296 later.
    const { coins, spendable } = coinsOf(6_000n, 2_000n);
    const outputs = [payment(5_400n)];
    const choice = chooseCoins({ available: spendable, outputs, changeLockingBytecode: changeAddress });
    expect(valuesOf(choice)).toEqual([6_000n]);
    expect(choice.changeSatoshis).toBeUndefined();
    expect(choice.remainderSatoshis).toBe(260n);
    expect(choice.feeSatoshis).toBe(600n);
    carryOut(coins, choice, outputs);
  });

  it('FE05: a larger remainder is returned by adding a coin, when that is cheaper than leaving it', () => {
    // 6,000 pays 5,150 and the fee of 340; 510 is left: too small for change from this coin alone,
    // and more than the 340 a change output costs. With the second coin, change is possible.
    const { coins, spendable } = coinsOf(6_000n, 2_000n);
    const outputs = [payment(5_150n)];
    const choice = chooseCoins({ available: spendable, outputs, changeLockingBytecode: changeAddress });
    expect(valuesOf(choice).sort()).toEqual([2_000n, 6_000n]);
    expect(choice.remainderSatoshis).toBe(0n);
    expect(choice.changeSatoshis).toBe(8_000n - 5_150n - 680n);
    carryOut(coins, choice, outputs);

    // With no second coin there is nothing to compare with: the remainder goes to the fee, and is shown.
    const alone = chooseCoins({ available: spendable.slice(0, 1), outputs, changeLockingBytecode: changeAddress });
    expect(alone.remainderSatoshis).toBe(510n);
    carryOut(coins, alone, outputs);
  });

  it('FE05: nothing goes to the fee unseen: the fee is always the required one plus the remainder', () => {
    for (const pay of [1_000n, 4_321n, 5_659n, 5_660n, 5_661n, 9_999n, 14_000n]) {
      const { coins, spendable } = coinsOf(6_000n, 2_000n, 9_000n, 800n);
      const outputs = [payment(pay)];
      const choice = chooseCoins({ available: spendable, outputs, changeLockingBytecode: changeAddress });
      expect(choice.feeSatoshis).toBe(BigInt(choice.bytes) + choice.remainderSatoshis);
      expect(choice.remainderSatoshis).toBeLessThan(620n);
      carryOut(coins, choice, outputs);
    }
  });

  it('never pays a fee from a coin that carries a token, and says when the coins do not suffice', () => {
    const token = coinAt(50, { token: { amount: 5n, category: new Uint8Array(32).fill(0x70) }, valueSatoshis: 50_000n });
    expect(() => chooseCoins({ available: [{ utxo: token.utxo, inputBytes: INPUT_BYTES.byKey }], outputs: [payment(1_000n)], changeLockingBytecode: changeAddress })).toThrow(/never comes from one/);
    const { spendable } = coinsOf(3_000n, 2_000n);
    try {
      chooseCoins({ available: spendable, outputs: [payment(5_000n)], changeLockingBytecode: changeAddress });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(InsufficientFundsError);
      expect((error as InsufficientFundsError).totalSatoshis).toBe(5_000n);
      expect((error as InsufficientFundsError).neededSatoshis).toBe(5_636n);
    }
  });

  it('a coin that holds no more than it costs to spend is not chosen', () => {
    const { spendable } = coinsOf(290n, 296n, 5_000n);
    const choice = chooseCoins({ available: spendable, outputs: [payment(600n)], changeLockingBytecode: changeAddress });
    expect(valuesOf(choice)).toEqual([5_000n]);
  });

  it('pays for a controller transaction with the controller as a fixed input', () => {
    const step = controllerStep(activeState, { kind: 'ownerAuthorize' }, owner);
    const { coins, spendable } = coinsOf(5_000n, 1_100n);
    const choice = chooseCoins({
      available: spendable,
      outputs: [step.successor],
      fixedInputs: [{ utxo: step.utxo, inputBytes: INPUT_BYTES.controller }],
      changeLockingBytecode: changeAddress,
    });
    // A cancellation paid by a coin of the wallet: 1,091 bytes without change.
    expect(valuesOf(choice)).toEqual([1_100n]);
    expect(choice.bytes).toBe(1_091);
    expect(choice.remainderSatoshis).toBe(9n);
    const coin = coins.find((candidate) => candidate.utxo === choice.coins[0]?.utxo);
    if (coin === undefined) throw new Error('coin missing');
    const built = buildTransaction({ inputs: [step.input, coin.byKey()], outputs: [step.successor], changeLockingBytecode: changeAddress });
    expect(built.encoded.length).toBe(1_091);
    expect(built.feeSatoshis).toBe(1_100n);
  });
});

describe('sending everything', () => {
  it('every coin goes to one output, with no change and the exact fee', () => {
    const { coins, spendable } = coinsOf(10_000n, 576n, 3_000n, 40_000n);
    const destination = payment(0n);
    const plan = planSendEverything({ coins: spendable, destination });
    expect(plan.parts).toHaveLength(1);
    expect(plan.leftOut).toEqual([]);
    const [part] = plan.parts;
    if (part === undefined) throw new Error('part missing');
    expect(part.bytes).toBe(transactionBytes([296, 296, 296, 296], [destination]));
    expect(part.sentSatoshis).toBe(53_576n - BigInt(part.bytes));
    const built = buildTransaction({ inputs: coins.map((coin) => coin.byKey()), outputs: [destination], remainderOutputIndex: 0 });
    expect(built.encoded.length).toBe(part.bytes);
    expect(built.transaction.outputs[0]?.valueSatoshis).toBe(plan.sentSatoshis);
    expect(checkBeforeSending(built)).toBe(true);
  });

  it('coins that only the controller can move go with the controller, which keeps its value', () => {
    const vault = vaultCoinAt(0);
    const step = controllerStep(activeState, { kind: 'ownerAuthorize' }, owner);
    const { coins, spendable } = coinsOf(10_000n);
    const destination = payment(0n);
    const plan = planSendEverything({
      coins: [...spendable, { utxo: vault.utxo, inputBytes: INPUT_BYTES.vault }],
      destination,
      fixedInputs: [{ utxo: step.utxo, inputBytes: INPUT_BYTES.controller }],
      fixedOutputs: [step.successor],
    });
    const built = buildTransaction({ inputs: [step.input, vault.input(), ...coins.map((coin) => coin.byKey())], outputs: [step.successor, destination], remainderOutputIndex: 1 });
    expect(built.encoded.length).toBe(plan.parts[0]?.bytes);
    expect(built.transaction.outputs[1]?.valueSatoshis).toBe(plan.sentSatoshis);
    expect(built.transaction.outputs[0]?.valueSatoshis).toBe(1_000n);
    expect(plan.sentSatoshis).toBe(20_000n - plan.feeSatoshis);
  });

  it('more coins than one transaction holds go in several, each with its exact fee', () => {
    const many: SpendableCoin[] = Array.from({ length: 800 }, () => ({ utxo: plainCoin(2_000n).utxo, inputBytes: INPUT_BYTES.p2pkh }));
    const plan = planSendEverything({ coins: many, destination: payment(0n) });
    expect(plan.parts.length).toBe(2);
    for (const part of plan.parts) {
      expect(part.bytes).toBeLessThanOrEqual(100_000);
      expect(part.feeSatoshis).toBe(BigInt(part.bytes));
    }
    expect(plan.parts.reduce((count, part) => count + part.coins.length, 0)).toBe(800);
    expect(plan.sentSatoshis + plan.feeSatoshis).toBe(1_600_000n);
  });

  it('is refused with the figures when the total less the fee is below what the receiving output must hold', () => {
    const { spendable } = coinsOf(576n);
    try {
      planSendEverything({ coins: spendable, destination: payment(0n) });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(InsufficientFundsError);
      const figures = error as InsufficientFundsError;
      expect([figures.totalSatoshis, figures.feeSatoshis, figures.neededSatoshis]).toEqual([576n, 340n, 886n]);
    }
    // Two such coins are enough together: 1,152 less 636 leaves 516, still too little; three leave 796.
    expect(() => planSendEverything({ coins: coinsOf(576n, 576n).spendable, destination: payment(0n) })).toThrow(InsufficientFundsError);
    expect(planSendEverything({ coins: coinsOf(576n, 576n, 576n).spendable, destination: payment(0n) }).sentSatoshis).toBe(1_728n - 932n);
  });

  it('a coin that holds no more than it costs to spend is left out and listed; coins with tokens are not taken', () => {
    const { spendable } = coinsOf(10_000n, 296n, 100n);
    const plan = planSendEverything({ coins: spendable, destination: payment(0n) });
    expect(plan.leftOut.map(({ utxo }) => utxo.output.valueSatoshis).sort()).toEqual([100n, 296n]);
    expect(plan.sentSatoshis).toBe(10_000n - 340n);
    const token = coinAt(51, { token: { amount: 5n, category: new Uint8Array(32).fill(0x70) }, valueSatoshis: 1_000n });
    expect(() => planSendEverything({ coins: [{ utxo: token.utxo, inputBytes: INPUT_BYTES.byKey }], destination: payment(0n) })).toThrow(/stay with it/);
  });
});
