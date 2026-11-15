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
  type ProtectedScript,
  type ControllerUpdate,
  afterFinalizeRecovery,
  afterOwnerAuthorize,
  afterOwnerUpdate,
  afterRequestRecovery,
  controllerScript,
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

export const identity = Uint8Array.from({ length: 32 }, (_, i) => i + 1);
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

export const controller = controllerScript(identity);

export const controllerOutput = (commitment: Uint8Array, valueSatoshis = CONTROLLER_VALUE): Output => ({
  lockingBytecode: controller.lockingBytecode,
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
  /** Identity whose controller script unlocks the input, instead of the one whose token the input carries. */
  unlockAsIdentity?: Uint8Array;
  /** Public key presented to the contract, instead of the signer's. */
  presentedPublicKey?: Uint8Array;
  signingType?: number;
  version?: number;
  /** Sequence number of the controller input. */
  sequence?: number;
  /** Place the funding input before the controller. */
  controllerSecond?: boolean;
  extraOutputs?: Output[];
  /** Protected inputs (assets, application positions) spent after the controller and funding inputs. */
  protectedInputs?: ProtectedInput[];
  locktime?: number;
}

/** An input guarded by the shared authorization interface. */
export interface ProtectedInput {
  source: Output;
  script: ProtectedScript;
  signer: Key;
  presentedPublicKey?: Uint8Array;
  signingType?: number;
  sequence?: number;
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

  // A controller input is unlocked with the script of the identity whose token it carries, so a
  // well-formed controller of a different wallet can be built too.
  const script = controllerScript(spend.unlockAsIdentity ?? controllerSource.token?.category ?? identity);

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
  const protectedInputs = spend.protectedInputs ?? [];
  const sourceOutputs = [
    ...(controllerIndex === 0 ? [controllerSource, funding] : [funding, controllerSource]),
    ...protectedInputs.map(({ source }) => source),
  ];
  const transaction: TransactionCommon = {
    version: spend.version ?? 2,
    locktime: spend.locktime ?? 0,
    inputs: [
      ...(controllerIndex === 0 ? [controllerInput, fundingInput] : [fundingInput, controllerInput]),
      ...protectedInputs.map(({ sequence }, index) => ({
        outpointTransactionHash: new Uint8Array(32).fill(0xa0 + index),
        outpointIndex: index,
        sequenceNumber: sequence ?? 0,
        unlockingBytecode: new Uint8Array(0),
      })),
    ],
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
      coveredBytecode: script.redeemBytecode,
      privateKey: spend.signer.privateKey,
      ...(spend.signingType === undefined ? {} : { signingType: spend.signingType }),
    }),
  };

  const { action } = spend;
  const unlockingBytecode = ((): Uint8Array => {
    switch (action.kind) {
      case 'ownerAuthorize':
        return script.unlock.ownerAuthorize(authorization);
      case 'requestRecovery':
        return script.unlock.requestRecovery(authorization, action.proposedOwnerKeyHash);
      case 'finalizeRecovery':
        return script.unlock.finalizeRecovery(authorization);
      case 'ownerUpdate':
        return script.unlock.ownerUpdate(authorization, {
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

  protectedInputs.forEach((protectedInput, index) => {
    const inputIndex = 2 + index;
    const target = transaction.inputs[inputIndex];
    if (target === undefined) throw new Error('missing protected input');
    target.unlockingBytecode = protectedInput.script.unlock({
      publicKey: protectedInput.presentedPublicKey ?? protectedInput.signer.publicKey,
      signature: signInput({
        transaction,
        sourceOutputs,
        inputIndex,
        coveredBytecode: protectedInput.script.redeemBytecode,
        privateKey: protectedInput.signer.privateKey,
        ...(protectedInput.signingType === undefined ? {} : { signingType: protectedInput.signingType }),
      }),
    });
  });

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
  const result = verify(spend);
  expect(result).toBeTypeOf('string');
  // A transaction that pays out more BCH than it takes in is rejected before
  // any script runs, which would hide what the test means to check.
  expect(result).not.toContain('sum of transaction output values');
};

/**
 * Assert that `base` is accepted and that the same transaction with `change`
 * applied is rejected, so a rejection is attributable to that change alone.
 */
export const expectChangeRejected = (base: Spend, change: Partial<Spend>): void => {
  expectAccepted(base);
  expectRejected({ ...base, ...change });
};

/** The index of the input whose evaluation failed, or `undefined` if the transaction is valid. */
export const failingInput = (spend: Spend | ResolvedSpend): number | undefined => {
  const result = verify(spend);
  if (result === true) return undefined;
  const match = /input index (\d+)/.exec(result);
  if (match?.[1] === undefined) throw new Error(`Rejected without naming an input: ${result}`);
  return Number(match[1]);
};

/**
 * Assert that the transaction is rejected by a protected input (index 2 or
 * later) while the controller input on its own is satisfied. Evaluation stops
 * at the first failing input, so a failure at index 2+ means inputs 0 and 1 passed.
 */
export const expectRejectedByProtectedInput = (spend: Spend | ResolvedSpend): void => {
  expect(failingInput(spend)).toBeGreaterThanOrEqual(2);
};
