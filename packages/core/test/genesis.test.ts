import type { Output } from '@bitauth/libauth';
import { describe, expect, it } from 'vitest';

import {
  type ControllerState,
  IdentityValidationError,
  buildTransaction,
  controllerOutput,
  controllerScript,
  followController,
  p2pkhInput,
  p2pkhLockingBytecode,
  validateGenesis,
} from '../src/index.js';
import { activeState, key, newOwner, owner, pendingState } from './harness.js';

/**
 * Acceptance test CT10 of the proposal: a client refuses an identity whose creation was not valid.
 * The controller's script does not check its own first state, so this check is the client's.
 */

const funder = key(0x0f);
/** The identity is the transaction whose output 0 the creating transaction spends. */
const identity = new Uint8Array(32).fill(0xd1);
const otherIdentity = new Uint8Array(32).fill(0xd2);

const create = (outputs: Output[], spentIndex = 0) =>
  buildTransaction({
    inputs: [p2pkhInput({ transactionHash: identity, index: spentIndex, output: { lockingBytecode: p2pkhLockingBytecode(funder.keyHash), valueSatoshis: 20_000n } }, funder)],
    outputs,
    changeLockingBytecode: p2pkhLockingBytecode(funder.keyHash),
  });
const check = (outputs: Output[], spentIndex = 0) => {
  const built = create(outputs, spentIndex);
  return validateGenesis(built.transaction, built.transactionHash, identity);
};
const controller = (state: ControllerState = activeState) => controllerOutput(identity, state, 1_000n);
const withToken = (output: Output, token: Partial<NonNullable<Output['token']>>): Output => ({ ...output, token: { ...(output.token as NonNullable<Output['token']>), ...token } });

describe('the creation of an identity', () => {
  it('CT10: a valid creation is accepted, and gives the first state', () => {
    const snapshot = check([controller()]);
    expect(snapshot.state).toEqual(activeState);
    expect(snapshot.utxo.index).toBe(0);
    // The controller need not be the first output of the creating transaction.
    expect(check([{ lockingBytecode: p2pkhLockingBytecode(owner.keyHash), valueSatoshis: 2_000n }, controller()]).utxo.index).toBe(1);
  });

  const refused: [string, () => unknown, RegExp][] = [
    ['a token that can mint', () => check([withToken(controller(), { nft: { capability: 'minting', commitment: controller().token?.nft?.commitment ?? new Uint8Array(0) } })]), /mutable capability/],
    ['a token that cannot change', () => check([withToken(controller(), { nft: { capability: 'none', commitment: controller().token?.nft?.commitment ?? new Uint8Array(0) } })]), /mutable capability/],
    ['a fungible amount on the identity token', () => check([withToken(controller(), { amount: 5n })]), /fungible amount/],
    ['a second token of the category', () => check([controller(), { lockingBytecode: p2pkhLockingBytecode(owner.keyHash), valueSatoshis: 1_000n, token: { amount: 10n, category: identity } }]), /exactly one identity token output/],
    ['two controllers', () => check([controller(), controller()]), /exactly one identity token output/],
    ['no token at all', () => check([{ lockingBytecode: controllerScript(identity).lockingBytecode, valueSatoshis: 1_000n }]), /exactly one identity token output/],
    ['the token at a plain address', () => check([{ ...controller(), lockingBytecode: p2pkhLockingBytecode(owner.keyHash) }]), /not held by this wallet's controller script/],
    ['the token at another wallet\'s controller', () => check([{ ...controller(), lockingBytecode: controllerScript(otherIdentity).lockingBytecode }]), /not held by this wallet's controller script/],
    ['a first state with a request pending', () => check([controller(pendingState)]), /without a pending recovery claim/],
    ['a first state that is not epoch 0', () => check([controller({ ...activeState, ownerEpoch: 1 })]), /owner epoch 0/],
    ['a malformed first state', () => check([withToken(controller(), { nft: { capability: 'mutable', commitment: Uint8Array.of(1, 0, 0) } })]), /./],
    ['a transaction that does not spend output 0 of the identity', () => check([controller()], 1), /does not create this identity/],
  ];
  it.each(refused)('CT10: refused: %s', (_name, attempt, reason) => {
    expect(attempt).toThrow(reason);
  });

  it('CT10: the refusals are of the kind a client can tell apart from other failures', () => {
    expect(() => check([controller(pendingState)])).toThrow(IdentityValidationError);
  });

  it('CT10: from a valid creation, each step of the controller is followed and named', () => {
    const created = create([controller()]);
    const genesis = validateGenesis(created.transaction, created.transactionHash, identity);
    const next = { ...activeState, status: 'pending' as const, proposedOwnerKeyHash: newOwner.keyHash };
    // Only the shape of the step is read here; the network has already enforced the controller's rules.
    const step = { version: 2, locktime: 0, inputs: [{ outpointTransactionHash: created.transactionHash, outpointIndex: 0, sequenceNumber: 0, unlockingBytecode: new Uint8Array(0) }], outputs: [controller(next)] };
    const transition = followController(genesis, step, new Uint8Array(32).fill(7));
    expect(transition.kind).toBe('requestRecovery');
    expect(transition.state).toEqual(next);
    // A transaction that does not spend the controller first is not a step of this identity.
    expect(() => followController(genesis, { ...step, inputs: [{ ...step.inputs[0], outpointIndex: 5 }] } as typeof step, new Uint8Array(32).fill(8))).toThrow(IdentityValidationError);
  });
});
