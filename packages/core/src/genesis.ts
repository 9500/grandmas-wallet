import { type TransactionCommon, binToHex } from '@bitauth/libauth';

import type { ControllerAction, Utxo } from './builder.js';
import { controllerScript } from './controller.js';
import { type ControllerState, decodeControllerState, encodeControllerState } from './state.js';
import { afterFinalizeRecovery, afterOwnerAuthorize } from './transitions.js';

/**
 * Validation of a wallet identity from the chain.
 *
 * The controller contract keeps an identity unique and its state valid from
 * one transaction to the next, but it cannot check how the identity was
 * created. Before trusting an identity, a client validates its genesis
 * transaction with {@link validateGenesis} and then follows each spend of the
 * controller with {@link followController}.
 */

export class IdentityValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IdentityValidationError';
  }
}

const fail = (message: string): never => {
  throw new IdentityValidationError(message);
};

const sameBytes = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((byte, i) => byte === b[i]);

export interface ControllerSnapshot {
  /** The wallet identity: the controller's token category, as shown by explorers. */
  identity: Uint8Array;
  state: ControllerState;
  /** The unspent controller output holding this state. */
  utxo: Utxo;
}

const readController = (
  transaction: TransactionCommon,
  transactionHash: Uint8Array,
  outputIndex: number,
  identity: Uint8Array,
): ControllerSnapshot => {
  const output = transaction.outputs[outputIndex];
  if (output === undefined) {
    return fail('The transaction has no controller output.');
  }
  if (!sameBytes(output.lockingBytecode, controllerScript(identity).lockingBytecode)) {
    return fail('The identity token is not held by this wallet\'s controller script.');
  }
  const { token } = output;
  if (token === undefined || !sameBytes(token.category, identity)) {
    return fail('The controller output does not carry the identity token.');
  }
  if (token.nft?.capability !== 'mutable') {
    return fail('The identity token must be an NFT with mutable capability.');
  }
  if (token.amount !== 0n) {
    return fail('The identity token must not carry a fungible amount.');
  }
  const others = transaction.outputs.filter(
    (other, index) => index !== outputIndex && other.token !== undefined && sameBytes(other.token.category, identity),
  );
  if (others.length > 0) {
    return fail('More than one output carries the identity token category.');
  }
  return {
    identity,
    state: decodeControllerState(token.nft.commitment),
    utxo: { transactionHash, index: outputIndex, output },
  };
};

/**
 * Validate the transaction that created a wallet identity.
 *
 * Accepts only a transaction that creates the identity's token category and
 * puts exactly one token of it — a mutable NFT with no fungible amount — on
 * the controller script, in an Active state at owner epoch 0. Because a
 * category can only be created by the transaction that spends its genesis
 * outpoint, no other token of the category can exist.
 *
 * @param transaction - the decoded genesis transaction
 * @param transactionHash - its hash, in the byte order shown by explorers
 * @param identity - the expected identity (token category)
 */
export const validateGenesis = (
  transaction: TransactionCommon,
  transactionHash: Uint8Array,
  identity: Uint8Array,
): ControllerSnapshot => {
  // A token category is the hash of a transaction whose output 0 is spent by the creating transaction.
  const createsCategory = transaction.inputs.some(
    (input) => input.outpointIndex === 0 && sameBytes(input.outpointTransactionHash, identity),
  );
  if (!createsCategory) {
    return fail('The transaction does not create this identity.');
  }
  const holders = transaction.outputs.flatMap((output, index) =>
    output.token !== undefined && sameBytes(output.token.category, identity) ? [index] : [],
  );
  const [controllerIndex] = holders;
  if (controllerIndex === undefined || holders.length !== 1) {
    return fail(`The genesis must create exactly one identity token output, found ${holders.length}.`);
  }
  const snapshot = readController(transaction, transactionHash, controllerIndex, identity);
  if (snapshot.state.status !== 'active') {
    return fail('A new identity must start without a pending recovery claim.');
  }
  if (snapshot.state.ownerEpoch !== 0) {
    return fail('A new identity must start at owner epoch 0.');
  }
  return snapshot;
};

export type ControllerTransitionKind = ControllerAction['kind'];

export interface ControllerTransition extends ControllerSnapshot {
  kind: ControllerTransitionKind;
  previous: ControllerState;
}

const sameState = (a: ControllerState, b: ControllerState): boolean =>
  sameBytes(encodeControllerState(a), encodeControllerState(b));

const classify = (previous: ControllerState, next: ControllerState): ControllerTransitionKind => {
  if (sameState(next, afterOwnerAuthorize(previous))) return 'ownerAuthorize';
  if (previous.status === 'active' && next.status === 'pending') return 'requestRecovery';
  if (previous.status === 'pending' && sameState(next, afterFinalizeRecovery(previous))) return 'finalizeRecovery';
  return 'ownerUpdate';
};

/**
 * Read the next controller state from a transaction that spends the
 * controller. The controller is always the first input and its successor the
 * first output; the contract has already enforced the transition rules for
 * any transaction the network accepted, so this locates and decodes the
 * successor and names the kind of transition.
 */
export const followController = (
  previous: ControllerSnapshot,
  transaction: TransactionCommon,
  transactionHash: Uint8Array,
): ControllerTransition => {
  const [first] = transaction.inputs;
  if (
    first === undefined ||
    first.outpointIndex !== previous.utxo.index ||
    !sameBytes(first.outpointTransactionHash, previous.utxo.transactionHash)
  ) {
    return fail(`Transaction ${binToHex(transactionHash)} does not spend the controller as its first input.`);
  }
  const next = readController(transaction, transactionHash, 0, previous.identity);
  return { ...next, kind: classify(previous.state, next.state), previous: previous.state };
};
