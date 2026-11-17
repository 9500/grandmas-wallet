import type { Output } from '@bitauth/libauth';
import { describe, expect, it } from 'vitest';

import { type ControllerState, ADDRESS_KIND, afterFinalizeRecovery, buildTransaction } from '../src/index.js';
import {
  activeState,
  anyoneCanSpend,
  expectAccepted,
  expectRejected,
  failingInput,
  identity,
  key,
  newOwner,
  owner,
  pendingState,
  recoverer,
  stranger,
} from './harness.js';
import { type Assembly, addressKey, assemble, coinAt, controllerStep, inputSizes, payment, plainCoin, vaultCoinAt } from './wallet.js';

/**
 * Acceptance tests AD01 to AD13 of the proposal: the recoverable address and the vault address.
 * Every transaction is checked under the 2026 rules with the network's relay rules on.
 */

const SIGNING_TYPES = [0x41, 0x61];
const otherIdentity = new Uint8Array(32).fill(0x99);
const otherOwner = key(0x05);
const tokenCategory = new Uint8Array(32).fill(0x70);

const authorize = (state: ControllerState = activeState, signer = owner) => controllerStep(state, { kind: 'ownerAuthorize' }, signer);
/** The state after a recovery to `newOwner`: epoch 1, and the earlier owner's controller key is no longer the owner. */
const recovered = afterFinalizeRecovery(pendingState);

/** A sweep of the given coins with the owner's approval, paying everything but a fee to one output. */
const sweepOf = (coins: { utxo: { output: Output } }[], inputs: Assembly['inputs'], step = authorize()): Assembly => {
  const total = coins.reduce((sum, { utxo }) => sum + utxo.output.valueSatoshis, 0n);
  return { inputs: [step.input, ...inputs], outputs: [step.successor, payment(total - 2_500n)] };
};

describe('spending a coin by its key', () => {
  it.each(SIGNING_TYPES)('AD01: accepted, with no controller in the transaction (signing type 0x%s)', (signingType) => {
    const coin = coinAt(0);
    expectAccepted(assemble({ inputs: [coin.byKey()], outputs: [payment(9_000n)], signingType }));
  });

  it('AD02: refused with another key', () => {
    const coin = coinAt(0);
    const withKeyOf = (holder: typeof stranger, signer: typeof stranger): Assembly => ({
      inputs: [{ utxo: coin.utxo, unlock: (sign) => coin.script.unlock.spend({ publicKey: holder.publicKey, signature: sign(signer.privateKey, coin.script.redeemBytecode) }) }],
      outputs: [payment(9_000n)],
    });
    expectAccepted(assemble(withKeyOf(coin.key, coin.key)));
    // Someone else's key and signature; the right public key with someone else's signature; the key of another address.
    expectRejected(assemble(withKeyOf(stranger, stranger)));
    expectRejected(assemble(withKeyOf(coin.key, stranger)));
    expectRejected(assemble(withKeyOf(addressKey(ADDRESS_KIND.givenOut, 1), addressKey(ADDRESS_KIND.givenOut, 1))));
  });

  it('AD08: after a recovery the earlier seed still spends a coin that was not swept (the stated cost of the design)', () => {
    // The address script knows nothing of the controller's state: its key works until the coin is moved.
    const coin = coinAt(3);
    expectAccepted(assemble({ inputs: [coin.byKey()], outputs: [payment(9_000n)] }));
    // The new owner can move the same coin through the controller; whichever is confirmed first has it.
    const step = authorize(recovered, newOwner);
    expectAccepted(assemble(sweepOf([coin], [coin.swept()], step)));
  });
});

describe('sweeping with the owner\'s approval', () => {
  it('AD03: one coin, several coins, and a vault coin in one transaction', () => {
    const [first, second, third] = [coinAt(0), coinAt(1), coinAt(2, { kind: ADDRESS_KIND.change })];
    const vault = vaultCoinAt(0);
    expectAccepted(assemble(sweepOf([first], [first.swept()])));
    expectAccepted(assemble(sweepOf([first, second, third], [first.swept(), second.swept(), third.swept()])));
    expectAccepted(assemble(sweepOf([first, second, vault], [first.swept(), second.swept(), vault.input()])));
  });

  it('AD04: refused by the address script with the wrong identity or the wrong secret', () => {
    const coin = coinAt(0);
    const other = coinAt(1);
    expectAccepted(assemble(sweepOf([coin], [coin.swept()])));
    // The identity shown is not the one whose controller is at input 0.
    expect(failingInput(assemble(sweepOf([coin], [coin.swept(otherIdentity)])))).toBe(1);
    // The right identity with the secret of another address of the same wallet.
    const wrongSecret = { utxo: coin.utxo, unlock: () => coin.script.unlock.sweep(identity, other.secret) };
    expect(failingInput(assemble(sweepOf([coin], [wrongSecret])))).toBe(1);
    // The same for a vault coin.
    const vault = vaultCoinAt(0);
    expect(failingInput(assemble(sweepOf([vault], [{ utxo: vault.utxo, unlock: () => vault.script.unlock.spend(otherIdentity, vault.secret) }])))).toBe(1);
  });

  it('AD05: refused by the address script when attached to a request or to a completion, while the controller alone is satisfied', () => {
    const request = controllerStep(activeState, { kind: 'requestRecovery', proposedOwnerKeyHash: newOwner.keyHash }, recoverer);
    const completion = controllerStep(pendingState, { kind: 'finalizeRecovery' }, recoverer);
    for (const step of [request, completion]) {
      const fee = plainCoin();
      // The controller's own transaction is valid.
      expectAccepted(assemble({ inputs: [step.input, fee.input], outputs: [step.successor, payment(3_000n)] }));
      // With a coin of the wallet attached, input 0 still passes and the coin's script refuses.
      for (const attached of [coinAt(0).swept(), vaultCoinAt(0).input()]) {
        expect(failingInput(assemble({ inputs: [step.input, attached], outputs: [step.successor, payment(8_000n)] }))).toBe(1);
      }
    }
  });

  it('AD06: refused without this wallet\'s controller at input 0, continuing unchanged', () => {
    const coin = coinAt(0);
    const fee = plainCoin();
    // No controller at all, and the controller in second place.
    expect(failingInput(assemble({ inputs: [fee.input, coin.swept()], outputs: [payment(12_000n)] }))).toBe(1);
    const step = authorize();
    expectRejected(assemble({ inputs: [fee.input, step.input, coin.swept()], outputs: [step.successor, payment(12_000n)] }));

    // Another wallet's controller, validly approved by its own owner.
    const theirs = controllerStep({ ...activeState, ownerKeyHash: otherOwner.keyHash }, { kind: 'ownerAuthorize' }, otherOwner, otherIdentity);
    expectAccepted(assemble({ inputs: [theirs.input, fee.input], outputs: [theirs.successor, payment(3_000n)] }));
    expect(failingInput(assemble({ inputs: [theirs.input, coin.swept()], outputs: [theirs.successor, payment(8_000n)] }))).toBe(1);
    expect(failingInput(assemble({ inputs: [theirs.input, coin.swept(otherIdentity)], outputs: [theirs.successor, payment(8_000n)] }))).toBe(1);

    // This wallet's controller, signed by its owner, but changing the owner, the recoverer or the waiting period.
    for (const update of [{ ownerKeyHash: newOwner.keyHash }, { recovererKeyHash: stranger.keyHash }, { challengeDelay: { unit: 'blocks' as const, value: 4 } }]) {
      const changing = controllerStep(activeState, { kind: 'ownerUpdate', update }, owner);
      expectAccepted(assemble({ inputs: [changing.input, fee.input], outputs: [changing.successor, payment(3_000n)] }));
      expect(failingInput(assemble({ inputs: [changing.input, coin.swept()], outputs: [changing.successor, payment(8_000n)] }))).toBe(1);
    }
  });

  it('AD12: accepted beside an ownerUpdate that changes nothing, refused beside one that changes anything', () => {
    const coin = coinAt(0);
    const unchanged = controllerStep(activeState, { kind: 'ownerUpdate', update: {} }, owner);
    expectAccepted(assemble({ inputs: [unchanged.input, coin.swept()], outputs: [unchanged.successor, payment(8_000n)] }));
    // An update that only clears a request leaves the same owner, epoch, recoverer and waiting period.
    const clearing = controllerStep(pendingState, { kind: 'ownerUpdate', update: {} }, owner);
    expectAccepted(assemble({ inputs: [clearing.input, coin.swept()], outputs: [clearing.successor, payment(8_000n)] }));
    const changing = controllerStep(activeState, { kind: 'ownerUpdate', update: { recovererKeyHash: stranger.keyHash } }, owner);
    expect(failingInput(assemble({ inputs: [changing.input, coin.swept()], outputs: [changing.successor, payment(8_000n)] }))).toBe(1);
  });
});

describe('after a recovery', () => {
  it('AD07: a sweep approved by the earlier owner\'s controller key is refused', () => {
    const coin = coinAt(0);
    expectAccepted(assemble(sweepOf([coin], [coin.swept()], authorize(recovered, newOwner))));
    // The controller refuses the earlier key, so nothing attached to it moves.
    expect(failingInput(assemble(sweepOf([coin], [coin.swept()], authorize(recovered, owner))))).toBe(0);
  });

  it('AD09: the earlier seed cannot move a vault coin; the new owner can', () => {
    const vault = vaultCoinAt(0);
    expectRejected(assemble(sweepOf([vault], [vault.input()], authorize(recovered, owner))));
    // A vault address has no key path to try: the only way in is the controller.
    expectRejected(assemble({ inputs: [vault.input()], outputs: [payment(9_000n)] }));
    expectAccepted(assemble(sweepOf([vault], [vault.input()], authorize(recovered, newOwner))));
  });
});

describe('tokens', () => {
  const tokens: [string, NonNullable<Output['token']>][] = [
    ['fungible tokens', { amount: 1_000n, category: tokenCategory }],
    ['an NFT that cannot change', { amount: 0n, category: tokenCategory, nft: { capability: 'none', commitment: Uint8Array.of(1, 2, 3) } }],
    ['an NFT that can change', { amount: 0n, category: tokenCategory, nft: { capability: 'mutable', commitment: Uint8Array.of(4) } }],
    ['an NFT that can mint, with fungible tokens beside it', { amount: 7n, category: tokenCategory, nft: { capability: 'minting', commitment: new Uint8Array(0) } }],
  ];

  it.each(tokens)('AD10: %s are held and moved by both paths, unchanged', (_name, token) => {
    const byKey = coinAt(0, { token, valueSatoshis: 1_000n });
    const bch = coinAt(1);
    expectAccepted(assemble({ inputs: [byKey.byKey(), bch.byKey()], outputs: [payment(1_000n, stranger, token), payment(9_000n)] }));

    const swept = coinAt(2, { token, valueSatoshis: 1_000n });
    const vault = vaultCoinAt(0, { token, valueSatoshis: 1_000n });
    const step = authorize();
    expectAccepted(
      assemble({ inputs: [step.input, swept.swept(), vault.input(), bch.swept()], outputs: [step.successor, payment(1_000n, stranger, token), payment(1_000n, newOwner, token), payment(8_000n)] }),
    );
  });

  it('AD10: the builder refuses a transaction that would drop or shrink a token', () => {
    const token = { amount: 1_000n, category: tokenCategory };
    const holding = coinAt(0, { token, valueSatoshis: 1_000n });
    const bch = coinAt(1);
    const change = coinAt(9, { kind: ADDRESS_KIND.change }).script.lockingBytecode;
    const build = (outputs: Output[]) => buildTransaction({ inputs: [holding.byKey(), bch.byKey()], outputs, changeLockingBytecode: change });
    expect(() => build([payment(5_000n)])).toThrow(/Tokens in the inputs would be destroyed/);
    expect(() => build([payment(1_000n, stranger, { ...token, amount: 999n })])).toThrow(/Tokens in the inputs would be destroyed/);
    const kept = build([payment(1_000n, stranger, token)]);
    expect(kept.transaction.outputs[0]?.token).toEqual(token);
  });
});

describe('sizes', () => {
  it('AD11: the scripts and each kind of input have the sizes the proposal records', () => {
    const coin = coinAt(0);
    const vault = vaultCoinAt(0);
    expect(coin.script.redeemBytecode.length).toBe(150);
    expect(vault.script.redeemBytecode.length).toBe(108);

    const byKey = assemble({ inputs: [coin.byKey()], outputs: [payment(9_000n)] });
    expect(inputSizes(byKey)).toEqual([296]);
    const step = authorize();
    const sweep = assemble({ inputs: [step.input, coin.swept(), vault.input()], outputs: [step.successor, payment(17_000n)] });
    // The controller approving, a swept coin, a vault coin.
    expect(inputSizes(sweep)).toEqual([637, 260, 217]);
    const fee = plainCoin();
    expect(inputSizes(assemble({ inputs: [fee.input], outputs: [payment(4_000n)] }))).toEqual([141]);
  });
});

describe('everything in one transaction', () => {
  it.each(SIGNING_TYPES)('AD13: coins by key, swept coins, a vault coin and tokens; nothing can be added afterwards (signing type 0x%s)', (signingType) => {
    const token = { amount: 0n, category: tokenCategory, nft: { capability: 'none' as const, commitment: Uint8Array.of(9) } };
    const byKey = coinAt(0);
    const swept = coinAt(1);
    const tokenCoin = coinAt(2, { token, valueSatoshis: 1_000n });
    const vault = vaultCoinAt(0);
    const step = authorize();
    const whole: Assembly = {
      inputs: [step.input, byKey.byKey(), swept.swept(), vault.input(), tokenCoin.byKey()],
      outputs: [step.successor, payment(1_000n, stranger, token), payment(27_000n)],
      signingType,
    };
    expectAccepted(assemble(whole));

    // The owner's signature on the controller and each key's signature cover every input and output.
    const withOutput = assemble(whole);
    withOutput.transaction.outputs.push({ lockingBytecode: anyoneCanSpend, valueSatoshis: 600n });
    expectRejected(withOutput);

    const withInput = assemble(whole);
    const extra = plainCoin();
    withInput.transaction.inputs.push({ outpointTransactionHash: extra.utxo.transactionHash, outpointIndex: extra.utxo.index, sequenceNumber: 0, unlockingBytecode: Uint8Array.of(0x51) });
    withInput.sourceOutputs.push({ lockingBytecode: anyoneCanSpend, valueSatoshis: 5_000n });
    expectRejected(withInput);
  });
});
