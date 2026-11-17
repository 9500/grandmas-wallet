import { describe, expect, it } from 'vitest';

import { afterFinalizeRecovery, decodeControllerState, encodeControllerState, MAX_OWNER_EPOCH } from '../src/index.js';
import {
  activeState,
  build,
  controllerOutput,
  expectAccepted,
  expectRejected,
  failingInput,
  newOwner,
  owner,
  pendingState,
  recoverer,
  stranger,
  verify,
} from './harness.js';
import { assemble, coinAt, controllerStep, payment, plainCoin, vaultCoinAt } from './wallet.js';

/**
 * Acceptance tests CT11 to CT15 of the proposal: requests that name the current owner, the end of the
 * epoch counter, and closing a wallet.
 */

const recovered = afterFinalizeRecovery(pendingState);
const close = (state = activeState, signer = owner) => controllerStep(state, { kind: 'ownerClose' }, signer);

describe('a request that names the current owner', () => {
  const sameOwnerRequest = { kind: 'requestRecovery' as const, proposedOwnerKeyHash: owner.keyHash };
  const pendingToSelf = { ...pendingState, proposedOwnerKeyHash: owner.keyHash };

  it('CT11: the controller takes it, and it raises the epoch on completion', () => {
    expectAccepted({ state: activeState, action: sameOwnerRequest, signer: recoverer });
    expectAccepted({ state: pendingToSelf, action: { kind: 'finalizeRecovery' }, signer: recoverer });
    const after = afterFinalizeRecovery(pendingToSelf);
    expect(after.ownerKeyHash).toEqual(owner.keyHash);
    expect(after.ownerEpoch).toBe(activeState.ownerEpoch + 1);
  });

  it('CT11: a sweep attached to the request, then to its completion, is refused both times', () => {
    const request = controllerStep(activeState, sameOwnerRequest, recoverer);
    const completion = controllerStep(pendingToSelf, { kind: 'finalizeRecovery' }, recoverer);
    for (const step of [request, completion]) {
      for (const attached of [coinAt(0).swept(), vaultCoinAt(0).input()]) {
        // The controller passes; the coin's script refuses, because the owner did not approve.
        expect(failingInput(assemble({ inputs: [step.input, attached], outputs: [step.successor, payment(8_000n)] }))).toBe(1);
      }
    }
  });
});

describe('the end of the epoch counter', () => {
  const lastEpoch = { ...activeState, ownerEpoch: MAX_OWNER_EPOCH };
  const lastEpochPending = { ...pendingState, ownerEpoch: MAX_OWNER_EPOCH };
  /** A state of the highest epoch with the four epoch bytes replaced. */
  const withEpochBytes = (state: typeof activeState, bytes: number[]): Uint8Array => {
    const commitment = encodeControllerState(state);
    commitment.set(bytes, 2);
    return commitment;
  };

  it('CT12: at the highest epoch the owner still approves and cancels, with the epoch unchanged', () => {
    expectAccepted({ state: lastEpoch, action: { kind: 'ownerAuthorize' }, signer: owner });
    expectAccepted({ state: lastEpochPending, action: { kind: 'ownerAuthorize' }, signer: owner });
    expectAccepted({ state: lastEpoch, action: { kind: 'ownerUpdate', update: { recovererKeyHash: stranger.keyHash } }, signer: owner });
  });

  it('CT12: no completion and no change of owner can follow, whatever epoch the successor claims', () => {
    const completed = { ...activeState, ownerKeyHash: newOwner.keyHash };
    // One more than the highest (which does not fit four bytes as a number), zero again, and the same epoch.
    for (const epochBytes of [[0x00, 0x00, 0x00, 0x80], [0, 0, 0, 0], [0xff, 0xff, 0xff, 0x7f]]) {
      expectRejected({
        state: lastEpochPending,
        action: { kind: 'finalizeRecovery' },
        signer: recoverer,
        nextCommitment: withEpochBytes(completed, epochBytes),
      });
      expectRejected({
        state: lastEpoch,
        action: { kind: 'ownerUpdate', update: { ownerKeyHash: newOwner.keyHash } },
        signer: owner,
        nextCommitment: withEpochBytes(completed, epochBytes),
      });
    }
  });

  it('CT12: a client refuses states that are malformed', () => {
    const good = encodeControllerState(activeState);
    expect(decodeControllerState(good)).toEqual(activeState);
    const altered = (change: (bytes: Uint8Array) => Uint8Array): Uint8Array => change(good.slice());
    const malformed: [string, Uint8Array][] = [
      ['too short', good.slice(0, 68)],
      ['too long', Uint8Array.from([...good, 0])],
      ['an unknown version', altered((bytes) => (bytes.set([2], 0), bytes))],
      ['an unknown status', altered((bytes) => (bytes.set([2], 1), bytes))],
      ['an epoch with the top bit set', altered((bytes) => (bytes.set([0x80], 5), bytes))],
      ['a zero owner', altered((bytes) => (bytes.fill(0, 6, 26), bytes))],
      ['a zero recoverer', altered((bytes) => (bytes.fill(0, 26, 46), bytes))],
      ['a waiting period of zero', altered((bytes) => (bytes.set([0, 0, 0], 46), bytes))],
      ['a waiting period with unknown bits', altered((bytes) => (bytes.set([1, 0, 0x80], 46), bytes))],
      ['active with a proposed owner', altered((bytes) => (bytes.fill(7, 49, 69), bytes))],
      ['pending without a proposed owner', altered((bytes) => (bytes.set([1], 1), bytes))],
    ];
    for (const [name, commitment] of malformed) {
      expect(() => decodeControllerState(commitment), name).toThrow();
    }
    // The contract itself refuses a state of the wrong length or version in every action.
    expectRejected({ state: activeState, action: { kind: 'ownerAuthorize' }, signer: owner, inputCommitment: good.slice(0, 68) });
    expectRejected(build({ state: activeState, action: { kind: 'ownerAuthorize' }, signer: owner, controllerSource: controllerOutput(malformed[2]?.[1] ?? good) }));
  });
});

describe('closing a wallet', () => {
  it.each([
    ['active', activeState],
    ['pending', pendingState],
  ])('CT13: the owner closes from %s, in a transaction with one output that carries no token', (_name, state) => {
    const step = close(state);
    const coin = coinAt(0);
    const total = 1_000n + coin.utxo.output.valueSatoshis;
    const closing = assemble({ inputs: [step.input, coin.byKey()], outputs: [payment(total - 977n)] });
    expectAccepted(closing);
    // The controller's value is part of the one output, and no token of the identity is left.
    expect(closing.transaction.outputs).toHaveLength(1);
    expect(closing.transaction.outputs[0]?.token).toBeUndefined();
    expect(closing.transaction.outputs[0]?.valueSatoshis).toBeGreaterThan(coin.utxo.output.valueSatoshis);
  });

  it('CT13: the controller need not be the first input when closing', () => {
    const step = close();
    const coin = coinAt(0);
    expectAccepted(assemble({ inputs: [coin.byKey(), step.input], outputs: [payment(10_000n)] }));
  });

  it('CT13: closing alone leaves less than an output may hold, so it goes together with another coin', () => {
    const step = close();
    const alone = assemble({ inputs: [step.input], outputs: [payment(1_000n - 681n)] });
    expect(alone.transaction.inputs[0]?.unlockingBytecode.length).toBe(637 - 43);
    expect(verify(alone)).toContain('dust');
  });

  it('CT14: refused when signed by the recoverer, by another key, or by an earlier owner', () => {
    const coin = coinAt(0);
    const attempt = (state: typeof activeState, signer: typeof owner) => {
      const step = close(state, signer);
      return assemble({ inputs: [step.input, coin.byKey()], outputs: [payment(10_000n)] });
    };
    expectAccepted(attempt(activeState, owner));
    expect(failingInput(attempt(activeState, recoverer))).toBe(0);
    expect(failingInput(attempt(activeState, stranger))).toBe(0);
    // While a request is pending, the key it names is not yet the owner.
    expect(failingInput(attempt(pendingState, newOwner))).toBe(0);
    // After a recovery the earlier owner's key has no say; the new owner's has.
    expect(failingInput(attempt(recovered, owner))).toBe(0);
    expectAccepted(attempt(recovered, newOwner));
  });

  it('CT14: refused with two outputs, or with an output that carries a token', () => {
    const step = close();
    const coin = coinAt(0);
    const inputs = [step.input, coin.byKey()];
    expectAccepted(assemble({ inputs, outputs: [payment(10_000n)] }));
    expectRejected(assemble({ inputs, outputs: [payment(5_000n), payment(5_000n)] }));
    // Keeping the identity token: at the controller's own address, and at a plain address.
    expectRejected(assemble({ inputs, outputs: [{ ...step.utxo.output, valueSatoshis: 10_000n }] }));
    expectRejected(assemble({ inputs, outputs: [payment(10_000n, owner, step.utxo.output.token)] }));
    // Another token in the one output.
    const token = { amount: 5n, category: new Uint8Array(32).fill(0x70) };
    const holding = coinAt(1, { token, valueSatoshis: 1_000n });
    expectRejected(assemble({ inputs: [...inputs, holding.byKey()], outputs: [payment(10_000n, stranger, token)] }));
  });

  it('CT15: a sweep or a vault spend cannot be part of a closing transaction', () => {
    const step = close();
    const byKey = coinAt(0);
    for (const attached of [coinAt(1).swept(), vaultCoinAt(0).input()]) {
      // The controller and the coin spent by key pass; the coin that needs the controller to continue does not.
      expect(failingInput(assemble({ inputs: [step.input, byKey.byKey(), attached], outputs: [payment(18_000n)] }))).toBe(2);
    }
  });

  it('CT15: after closing, a vault coin and a sweep have nothing to go through; a coin is still spent by its key', () => {
    const coin = coinAt(0);
    const vault = vaultCoinAt(0);
    const fee = plainCoin();
    // No controller exists any more, so nothing can stand at input 0 for them.
    expect(failingInput(assemble({ inputs: [fee.input, coin.swept()], outputs: [payment(12_000n)] }))).toBe(1);
    expect(failingInput(assemble({ inputs: [fee.input, vault.input()], outputs: [payment(12_000n)] }))).toBe(1);
    // A token of another category at input 0 does not stand in for the identity.
    const imitation = plainCoin(1_000n);
    imitation.utxo.output.token = { amount: 0n, category: new Uint8Array(32).fill(0x66), nft: { capability: 'mutable', commitment: encodeControllerState(activeState) } };
    expect(failingInput(assemble({ inputs: [imitation.input, vault.input()], outputs: [{ ...imitation.utxo.output }, payment(8_000n)] }))).toBe(1);
    expectAccepted(assemble({ inputs: [coin.byKey()], outputs: [payment(9_000n)] }));
  });
});
