import {
  type Output,
  type TransactionCommon,
  createVirtualMachineBch2026,
  hash160,
  hexToBin,
  secp256k1,
} from '@bitauth/libauth';
import { expect } from 'vitest';

import {
  type ControllerState,
  type ControllerUpdate,
  afterFinalizeRecovery,
  afterOwnerAuthorize,
  afterOwnerUpdate,
  afterRequestRecovery,
  controllerLockingBytecode,
  controllerRedeemBytecode,
  controllerUnlocking,
  encodeChallengeDelay,
  encodeControllerState,
  signInput,
} from '../src/index.js';

export interface Key {
  privateKey: Uint8Array;
  publicKey: Uint8Array;
  keyHash: Uint8Array;
}

export const key = (seed: number): Key => {
  const privateKey = new Uint8Array(32).fill(seed);
  const publicKey = secp256k1.derivePublicKeyCompressed(privateKey);
  if (typeof publicKey === 'string') throw new Error(publicKey);
  return { privateKey, publicKey, keyHash: hash160(publicKey) };
};

export const owner = key(0x01);
export const recoverer = key(0x02);
export const newOwner = key(0x03);
export const stranger = key(0x04);

export const identity = new Uint8Array(32).fill(0x1d);
export const anyoneCanSpend = hexToBin('51'); // OP_1
export const CONTROLLER_VALUE = 1_000n;

export const activeState: ControllerState = {
  version: 1,
  status: 'active',
  ownerEpoch: 0,
  ownerKeyHash: owner.keyHash,
  recovererKeyHash: recoverer.keyHash,
  challengeDelay: { unit: 'blocks', value: 3 },
};

export const pendingState: ControllerState = {
  ...activeState,
  status: 'pending',
  proposedOwnerKeyHash: newOwner.keyHash,
};

export const delayBytes = (sequence: number): Uint8Array =>
  Uint8Array.of(sequence & 0xff, (sequence >> 8) & 0xff, (sequence >> 16) & 0xff);

export const controllerOutput = (commitment: Uint8Array, valueSatoshis = CONTROLLER_VALUE): Output => ({
  lockingBytecode: controllerLockingBytecode,
  valueSatoshis,
  token: { amount: 0n, category: identity, nft: { capability: 'mutable', commitment } },
});

export type Action =
  | { kind: 'ownerAuthorize' }
  | { kind: 'requestRecovery'; proposedOwnerKeyHash: Uint8Array }
  | { kind: 'finalizeRecovery' }
  | { kind: 'ownerUpdate'; update: ControllerUpdate; rawDelay?: Uint8Array };

export interface Spend {
  /** Controller state being spent. */
  state: ControllerState;
  action: Action;
  signer: Key;

  // Everything below changes one aspect of an otherwise well-formed transaction.

  /** Raw commitment of the controller input, instead of the encoded `state`. */
  inputCommitment?: Uint8Array;
  /** Commitment of the controller output, instead of the one the transition rules give. */
  nextCommitment?: Uint8Array;
  /** Replace the controller input's spent output entirely. */
  controllerSource?: Output;
  /** Replace the controller output entirely; `null` omits it. */
  controllerSuccessor?: Output | null;
  /** Public key presented to the contract, instead of the signer's. */
  presentedPublicKey?: Uint8Array;
  signingType?: number;
  version?: number;
  /** Sequence number of the controller input. */
  sequence?: number;
  /** Place the funding input before the controller. */
  controllerSecond?: boolean;
  extraOutputs?: Output[];
}

export interface ResolvedSpend {
  sourceOutputs: Output[];
  transaction: TransactionCommon;
}

const expectedNext = (spend: Spend): ControllerState => {
  switch (spend.action.kind) {
    case 'ownerAuthorize':
      return afterOwnerAuthorize(spend.state);
    case 'requestRecovery':
      return afterRequestRecovery(spend.state, spend.action.proposedOwnerKeyHash);
    case 'finalizeRecovery':
      return afterFinalizeRecovery(spend.state);
    case 'ownerUpdate':
      return afterOwnerUpdate(spend.state, spend.action.update);
  }
};

/** Build and sign a transaction that spends the controller as described. */
export const build = (spend: Spend): ResolvedSpend => {
  const controllerSource =
    spend.controllerSource ?? controllerOutput(spend.inputCommitment ?? encodeControllerState(spend.state));
  const successor =
    spend.controllerSuccessor === undefined
      ? controllerOutput(spend.nextCommitment ?? encodeControllerState(expectedNext(spend)))
      : spend.controllerSuccessor;

  const funding: Output = { lockingBytecode: anyoneCanSpend, valueSatoshis: 5_000n };
  const defaultSequence =
    spend.action.kind === 'finalizeRecovery' ? encodeChallengeDelay(spend.state.challengeDelay) : 0;

  const controllerInput = {
    outpointTransactionHash: new Uint8Array(32).fill(0xc0),
    outpointIndex: 0,
    sequenceNumber: spend.sequence ?? defaultSequence,
    unlockingBytecode: new Uint8Array(0),
  };
  const fundingInput = {
    outpointTransactionHash: new Uint8Array(32).fill(0xf0),
    outpointIndex: 1,
    sequenceNumber: 0,
    unlockingBytecode: new Uint8Array(0),
  };

  const controllerIndex = spend.controllerSecond === true ? 1 : 0;
  const sourceOutputs = controllerIndex === 0 ? [controllerSource, funding] : [funding, controllerSource];
  const transaction: TransactionCommon = {
    version: spend.version ?? 2,
    locktime: 0,
    inputs: controllerIndex === 0 ? [controllerInput, fundingInput] : [fundingInput, controllerInput],
    outputs: [
      ...(successor === null ? [] : [successor]),
      { lockingBytecode: anyoneCanSpend, valueSatoshis: 3_000n },
      ...(spend.extraOutputs ?? []),
    ],
  };

  const authorization = {
    publicKey: spend.presentedPublicKey ?? spend.signer.publicKey,
    signature: signInput({
      transaction,
      sourceOutputs,
      inputIndex: controllerIndex,
      coveredBytecode: controllerRedeemBytecode,
      privateKey: spend.signer.privateKey,
      ...(spend.signingType === undefined ? {} : { signingType: spend.signingType }),
    }),
  };

  const { action } = spend;
  const unlockingBytecode = ((): Uint8Array => {
    switch (action.kind) {
      case 'ownerAuthorize':
        return controllerUnlocking.ownerAuthorize(authorization);
      case 'requestRecovery':
        return controllerUnlocking.requestRecovery(authorization, action.proposedOwnerKeyHash);
      case 'finalizeRecovery':
        return controllerUnlocking.finalizeRecovery(authorization);
      case 'ownerUpdate':
        return controllerUnlocking.ownerUpdate(authorization, {
          ownerKeyHash: action.update.ownerKeyHash ?? spend.state.ownerKeyHash,
          recovererKeyHash: action.update.recovererKeyHash ?? spend.state.recovererKeyHash,
          challengeDelay:
            action.rawDelay ?? delayBytes(encodeChallengeDelay(action.update.challengeDelay ?? spend.state.challengeDelay)),
        });
    }
  })();
  const input = transaction.inputs[controllerIndex];
  if (input === undefined) throw new Error('missing controller input');
  input.unlockingBytecode = unlockingBytecode;

  return { sourceOutputs, transaction };
};

const vm = createVirtualMachineBch2026(true);

/** `true` when every input of the transaction is valid under the 2026 rules, otherwise the reason. */
export const verify = (spend: Spend | ResolvedSpend): string | true =>
  vm.verify('transaction' in spend ? spend : build(spend));

export const expectAccepted = (spend: Spend | ResolvedSpend): void => {
  expect(verify(spend)).toBe(true);
};

export const expectRejected = (spend: Spend | ResolvedSpend): void => {
  expect(verify(spend)).toBeTypeOf('string');
};

/**
 * Assert that `base` is accepted and that the same transaction with `change`
 * applied is rejected, so a rejection is attributable to that change alone.
 */
export const expectChangeRejected = (base: Spend, change: Partial<Spend>): void => {
  expectAccepted(base);
  expectRejected({ ...base, ...change });
};
