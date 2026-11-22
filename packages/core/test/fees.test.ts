import { type Output, encodeLockingBytecodeP2sh32, encodeTransactionBch } from '@bitauth/libauth';
import { describe, expect, it } from 'vitest';

import {
  type BuildParameters,
  type ControllerAction,
  ADDRESS_KIND,
  SMALLEST_CHANGE,
  buildTransaction,
  checkBeforeSending,
  controllerOutput,
  InsufficientFundsError,
  p2pkhLockingBytecode,
  requiredFee,
  readTemplate,
  smallestOutputValue,
  templateGivenToFee,
  templateOmittedSatoshis,
  verifyTransaction,
} from '../src/index.js';
import { activeState, identity, newOwner, owner, pendingState, recoverer, stranger } from './harness.js';
import { coinAt, controllerStep, payment, plainCoin } from './wallet.js';

/**
 * Acceptance tests FE01 to FE03 of the proposal: the exact fee, the smallest value of each kind of output,
 * and the check before sending.
 */

const changeAddress = (): Uint8Array => coinAt(40, { kind: ADDRESS_KIND.change }).script.lockingBytecode;
const tokenCategory = new Uint8Array(32).fill(0x70);

/** The fee equals the signed size times the rate, the transaction passes the network's rules, and it may be sent. */
const expectExact = (parameters: BuildParameters): ReturnType<typeof buildTransaction> => {
  const built = buildTransaction(parameters);
  const rate = parameters.feeRate ?? 1;
  expect(built.encoded).toEqual(encodeTransactionBch(built.transaction));
  expect(built.feeSatoshis).toBe(BigInt(Math.ceil(built.encoded.length * rate)));
  expect(built.requiredFeeSatoshis).toBe(built.feeSatoshis);
  expect(built.remainderSatoshis).toBe(0n);
  expect(verifyTransaction(built)).toBe(true);
  expect(checkBeforeSending(built, rate)).toBe(true);
  return built;
};

describe('the exact fee', () => {
  it.each([0x41, 0x61])('FE01: a payment by key, with change and without (signing type 0x%s)', (signingType) => {
    const withChange = expectExact({ inputs: [coinAt(0).byKey()], outputs: [payment(3_000n)], changeLockingBytecode: changeAddress(), signingType });
    expect(withChange.encoded.length).toBe(384);
    expect(withChange.changeIndex).toBe(1);
    const everything = expectExact({ inputs: [coinAt(1).byKey()], outputs: [payment(0n)], remainderOutputIndex: 0, signingType });
    expect(everything.encoded.length).toBe(340);
    expect(everything.transaction.outputs[0]?.valueSatoshis).toBe(10_000n - 340n);
  });

  it('FE01: a payment of tokens', () => {
    const token = { amount: 500n, category: tokenCategory };
    const holding = coinAt(0, { token, valueSatoshis: 1_000n });
    const built = expectExact({
      inputs: [holding.byKey(), coinAt(1).byKey()],
      outputs: [payment(1_000n, stranger, token)],
      changeLockingBytecode: changeAddress(),
    });
    expect(built.transaction.outputs[0]?.token).toEqual(token);
  });

  const actions: [string, typeof activeState, ControllerAction, typeof owner][] = [
    ['an approval', activeState, { kind: 'ownerAuthorize' }, owner],
    ['a cancellation', pendingState, { kind: 'ownerAuthorize' }, owner],
    ['a request', activeState, { kind: 'requestRecovery', proposedOwnerKeyHash: newOwner.keyHash }, recoverer],
    ['a completion', pendingState, { kind: 'finalizeRecovery' }, recoverer],
    ['a change of settings', activeState, { kind: 'ownerUpdate', update: { recovererKeyHash: stranger.keyHash } }, owner],
  ];
  it.each(actions)('FE01: %s, paid by an ordinary coin with change', (_name, state, action, signer) => {
    const step = controllerStep(state, action, signer);
    expectExact({ inputs: [step.input, plainCoin().input], outputs: [step.successor], changeLockingBytecode: p2pkhLockingBytecode(signer.keyHash) });
  });

  it('FE01: the sizes of a request, a completion and a cancellation are the ones the proposal records', () => {
    const size = (state: typeof activeState, action: ControllerAction, signer: typeof owner, feeInput = plainCoin().input, change = p2pkhLockingBytecode(signer.keyHash)): number => {
      const step = controllerStep(state, action, signer);
      return buildTransaction({ inputs: [step.input, feeInput], outputs: [step.successor], changeLockingBytecode: change }).encoded.length;
    };
    expect(size(activeState, { kind: 'requestRecovery', proposedOwnerKeyHash: newOwner.keyHash }, recoverer)).toBe(991);
    expect(size(pendingState, { kind: 'finalizeRecovery' }, recoverer)).toBe(970);
    // A cancellation paid by a coin of the wallet, with change to the wallet.
    expect(size(pendingState, { kind: 'ownerAuthorize' }, owner, coinAt(0).byKey(), changeAddress())).toBe(1_135);
  });

  it('FE01: closing, with everything going to one output', () => {
    const step = controllerStep(activeState, { kind: 'ownerClose' }, owner);
    const coin = coinAt(0);
    const built = expectExact({ inputs: [step.input, coin.byKey()], outputs: [payment(0n)], remainderOutputIndex: 0, allowTokenBurn: true });
    expect(built.encoded.length).toBe(977);
    expect(built.transaction.outputs[0]?.valueSatoshis).toBe(1_000n + coin.utxo.output.valueSatoshis - 977n);
  });

  it('FE01: at another rate the fee follows the rate', () => {
    const built = expectExact({ inputs: [coinAt(0).byKey()], outputs: [payment(3_000n)], changeLockingBytecode: changeAddress(), feeRate: 2 });
    expect(built.feeSatoshis).toBe(768n);
    expect(requiredFee(1_000, 1.5)).toBe(1_500n);
    expect(requiredFee(333, 1.5)).toBe(500n);
  });

  it('FE01: what is too small to return goes to the fee, and is reported', () => {
    // 10,000 in, 9,200 out: 800 left. A change output would cost 44 bytes more and hold less than it may.
    const built = buildTransaction({ inputs: [coinAt(0).byKey()], outputs: [payment(9_200n)], changeLockingBytecode: changeAddress() });
    expect(built.changeIndex).toBeUndefined();
    expect(built.transaction.outputs).toHaveLength(1);
    expect(built.requiredFeeSatoshis).toBe(340n);
    expect(built.remainderSatoshis).toBe(460n);
    expect(built.feeSatoshis).toBe(800n);
    expect(checkBeforeSending(built)).toBe(true);
  });

  it('FE01: sending everything is refused with the figures when too little is left', () => {
    const small = coinAt(0, { valueSatoshis: 576n });
    try {
      buildTransaction({ inputs: [small.byKey()], outputs: [payment(0n)], remainderOutputIndex: 0 });
      expect.unreachable('a coin of 576 satoshis cannot be sent on');
    } catch (error) {
      expect(error).toBeInstanceOf(InsufficientFundsError);
      const figures = error as InsufficientFundsError;
      expect([figures.totalSatoshis, figures.feeSatoshis, figures.neededSatoshis]).toEqual([576n, 340n, 886n]);
    }
    // One satoshi short of the smallest output, and exactly enough.
    expect(() => buildTransaction({ inputs: [coinAt(1, { valueSatoshis: 885n }).byKey()], outputs: [payment(0n)], remainderOutputIndex: 0 })).toThrow(InsufficientFundsError);
    const enough = buildTransaction({ inputs: [coinAt(2, { valueSatoshis: 886n }).byKey()], outputs: [payment(0n)], remainderOutputIndex: 0 });
    expect(enough.transaction.outputs[0]?.valueSatoshis).toBe(546n);
  });
});

describe('the smallest value of an output', () => {
  const walletAddress = encodeLockingBytecodeP2sh32(new Uint8Array(32).fill(3));
  const kinds: [string, Output, bigint][] = [
    ['a single-key address', { lockingBytecode: p2pkhLockingBytecode(stranger.keyHash), valueSatoshis: 0n }, 546n],
    ['an address of the wallet', { lockingBytecode: walletAddress, valueSatoshis: 0n }, 576n],
    ['an address of the wallet with fungible tokens', { lockingBytecode: walletAddress, valueSatoshis: 0n, token: { amount: 100n, category: tokenCategory } }, 681n],
    ['an address of the wallet with an NFT', { lockingBytecode: walletAddress, valueSatoshis: 0n, token: { amount: 0n, category: tokenCategory, nft: { capability: 'none', commitment: Uint8Array.of(1, 2) } } }, 687n],
    ['the controller', controllerOutput(identity, activeState, 0n), 888n],
  ];

  it.each(kinds)('FE02: %s', (_name, output, smallest) => {
    expect(smallestOutputValue(output)).toBe(smallest);
    // It follows from the output's own size: three times what 148 bytes more than the output cost to relay.
    const encodedLength = encodeTransactionBch({ version: 2, locktime: 0, inputs: [], outputs: [output] }).length - 10;
    expect(smallest).toBe(BigInt(3 * (encodedLength + 148)));

    const source = plainCoin(20_000n);
    const tokenSource = output.token === undefined ? [] : [coinAt(0, { token: output.token, valueSatoshis: 1_000n }).byKey()];
    const build = (valueSatoshis: bigint) =>
      buildTransaction({ inputs: [source.input, ...tokenSource], outputs: [{ ...output, valueSatoshis }], changeLockingBytecode: changeAddress() });
    // The wallet builds no output below it.
    expect(() => build(smallest - 1n)).toThrow(/nodes relay no such output below/);
    const atSmallest = build(smallest);
    // The network's relay rules accept the smallest value and refuse one satoshi less.
    expect(verifyTransaction(atSmallest)).toBe(true);
    const below = { ...atSmallest, transaction: { ...atSmallest.transaction, outputs: atSmallest.transaction.outputs.map((o, index) => (index === 0 ? { ...o, valueSatoshis: smallest - 1n } : o)) } };
    // Signatures no longer match either, but the relay rule on small outputs is checked first.
    expect(verifyTransaction(below)).toContain('dust');
    expect(checkBeforeSending(below)).toContain('nodes relay no such output below');
  });

  it('FE02: the smallest change at an address of the wallet is 576 satoshis', () => {
    expect(SMALLEST_CHANGE).toBe(576n);
  });
});

describe('the check before sending', () => {
  it('FE03: a fee above the required one by more than a remainder too small to return is not sent', () => {
    const coin = coinAt(0);
    const exact = buildTransaction({ inputs: [coin.byKey()], outputs: [payment(0n)], remainderOutputIndex: 0 });
    expect(checkBeforeSending(exact)).toBe(true);
    const lowered = (by: bigint) => ({
      ...exact,
      transaction: { ...exact.transaction, outputs: exact.transaction.outputs.map((o) => ({ ...o, valueSatoshis: o.valueSatoshis - by })) },
    });
    // 575 satoshis could not have been returned as change; 576 could.
    expect(checkBeforeSending(lowered(576n))).toContain('above the required');
    // The builder refuses to make such a transaction in the first place.
    expect(() => buildTransaction({ inputs: [coinAt(1).byKey()], outputs: [payment(9_000n)] })).toThrow(/returned as change, not left to the fee/);
    expect(() => buildTransaction({ inputs: [coinAt(2).byKey()], outputs: [payment(9_660n)] })).not.toThrow();
  });

  it('FE03: a fee below the required one is not sent', () => {
    const exact = buildTransaction({ inputs: [coinAt(0).byKey()], outputs: [payment(0n)], remainderOutputIndex: 0 });
    const raised = { ...exact, transaction: { ...exact.transaction, outputs: exact.transaction.outputs.map((o) => ({ ...o, valueSatoshis: o.valueSatoshis + 1n })) } };
    expect(checkBeforeSending(raised)).toContain('below the 340 that nodes require');
    expect(() => buildTransaction({ inputs: [coinAt(1).byKey()], outputs: [payment(9_700n)] })).toThrow(InsufficientFundsError);
  });

  it('FE03: a transaction with several hundred inputs is built; no limit in satoshis stands in its way', () => {
    const inputs = Array.from({ length: 300 }, () => plainCoin(1_000n).input);
    const built = buildTransaction({ inputs, outputs: [payment(0n)], remainderOutputIndex: 0 });
    expect(built.feeSatoshis).toBe(BigInt(built.encoded.length));
    expect(built.feeSatoshis).toBeGreaterThan(40_000n);
    expect(built.transaction.outputs[0]?.valueSatoshis).toBe(300_000n - built.feeSatoshis);
    expect(checkBeforeSending(built)).toBe(true);
  });
});

describe('satoshis a template input leaves out of the change', () => {
  const marked = (satoshis: unknown) =>
    readTemplate(
      JSON.stringify({
        $schema: 'https://libauth.org/schemas/wallet-template-v0.schema.json',
        name: 'Marked',
        description: 'An input that leaves satoshis out of the change.',
        version: '1',
        supported: ['BCH_2026_05'],
        roles: { anyone: { name: 'Anyone', description: 'Anyone.' } },
        start: [],
        actions: {},
        transactions: {},
        outputs: {},
        lockingScripts: {},
        inputs: { markedInput: { name: 'Marked', description: 'Marked.', unlockingScript: 'unlock', omitChangeAmounts: { satoshis } }, plainInput: { name: 'Plain', description: 'Plain.', unlockingScript: 'unlock' } },
        scripts: { unlock: '' },
        variables: { burned: { name: 'Burned', description: 'Satoshis burned.', type: 'satoshis' } },
      }),
    ).definition;

  it('FE04: all of the coin, an amount no larger than the coin, or an amount worked out from the values; nothing for an input without the mark', () => {
    expect(templateOmittedSatoshis(marked(true), 'markedInput', 5000n, {})).toBe(5000n);
    expect(templateOmittedSatoshis(marked('1200'), 'markedInput', 5000n, {})).toBe(1200n);
    expect(templateOmittedSatoshis(marked('9000'), 'markedInput', 5000n, {})).toBe(5000n);
    expect(templateOmittedSatoshis(marked('$(<burned>)'), 'markedInput', 5000n, { burned: 700n })).toBe(700n);
    expect(templateOmittedSatoshis(marked(true), 'plainInput', 5000n, {})).toBe(0n);
    expect(templateGivenToFee(marked(true), [{ inputIdentifier: 'markedInput', valueSatoshis: 5000n }, { inputIdentifier: 'plainInput', valueSatoshis: 3000n }, { valueSatoshis: 1000n }], {})).toBe(5000n);
  });

  it('FE04: the check before sending and the builder take a fee above the required one by what such coins give up to it, and no more', () => {
    const built = buildTransaction({ inputs: [coinAt(1).byKey()], outputs: [payment(5_000n)], givenToFee: 5_000n });
    expect(checkBeforeSending(built)).toContain('above the required');
    expect(checkBeforeSending(built, undefined, 5_000n)).toBe(true);
    expect(checkBeforeSending(built, undefined, 3_000n)).toContain('above the required');
    expect(() => buildTransaction({ inputs: [coinAt(1).byKey()], outputs: [payment(5_000n)] })).toThrow(/returned as change, not left to the fee/);
  });
});
