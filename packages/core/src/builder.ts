import {
  type Output,
  type TransactionCommon,
  binToHex,
  createVirtualMachineBch2026,
  encodeDataPush,
  encodeLockingBytecodeP2pkh,
  encodeLockingBytecodeP2sh32,
  encodeTransactionBch,
  flattenBinArray,
  getDustThreshold,
  hash160,
  hashTransactionUiOrder,
  secp256k1,
} from '@bitauth/libauth';

import type { RecoverableAddressScript, VaultAddressScript } from './addresses.js';
import { CONTROLLER_INDEX, CONTROLLER_SIGHASH_TYPE, controllerScript, signInput } from './controller.js';
import type { ProtectedScript } from './protected.js';
import { type ControllerState, encodeChallengeDelay, encodeControllerState } from './state.js';
import {
  type ControllerUpdate,
  afterFinalizeRecovery,
  afterOwnerAuthorize,
  afterOwnerUpdate,
  afterRequestRecovery,
} from './transitions.js';

export interface KeyPair {
  privateKey: Uint8Array;
  publicKey: Uint8Array;
  keyHash: Uint8Array;
}

export const keyPairFromPrivateKey = (privateKey: Uint8Array): KeyPair => {
  const publicKey = secp256k1.derivePublicKeyCompressed(privateKey);
  if (typeof publicKey === 'string') {
    throw new Error(`Invalid private key: ${publicKey}`);
  }
  return { privateKey, publicKey, keyHash: hash160(publicKey) };
};

/** An unspent output. `transactionHash` is in the byte order shown by explorers. */
export interface Utxo {
  transactionHash: Uint8Array;
  index: number;
  output: Output;
}

/** Signs the input being unlocked with the given key, for the given script. */
export type InputSigner = (privateKey: Uint8Array, coveredBytecode: Uint8Array) => Uint8Array;

export interface InputSpec {
  utxo: Utxo;
  sequence?: number;
  unlock: (sign: InputSigner) => Uint8Array;
}

export const p2pkhLockingBytecode = (keyHash: Uint8Array): Uint8Array => encodeLockingBytecodeP2pkh(keyHash);

/** An ordinary pay-to-public-key-hash input, for example fee funding by the recoverer. */
export const p2pkhInput = (utxo: Utxo, key: KeyPair): InputSpec => ({
  utxo,
  unlock: (sign) =>
    flattenBinArray([encodeDataPush(sign(key.privateKey, utxo.output.lockingBytecode)), encodeDataPush(key.publicKey)]),
});

/**
 * Wallet funds or an application position. It needs no signature of its own: the transaction must also
 * spend the wallet's controller with the owner's approval, as its first input.
 */
export const protectedInput = (utxo: Utxo, script: ProtectedScript, sequence = 0): InputSpec => ({
  utxo,
  sequence,
  unlock: () => script.unlockingBytecode,
});

/** A coin at a recoverable address, spent by the key the address was made for. No controller is involved. */
export const recoverableInput = (utxo: Utxo, script: RecoverableAddressScript, key: KeyPair, sequence = 0): InputSpec => ({
  utxo,
  sequence,
  unlock: (sign) => script.unlock.spend({ publicKey: key.publicKey, signature: sign(key.privateKey, script.redeemBytecode) }),
});

/**
 * A coin at a recoverable address, released by the wallet's current owner. It carries no signature: the
 * transaction must spend the wallet's controller as its first input, with the owner's approval.
 */
export const sweptInput = (utxo: Utxo, script: RecoverableAddressScript, identity: Uint8Array, secret: Uint8Array): InputSpec => ({
  utxo,
  unlock: () => script.unlock.sweep(identity, secret),
});

/** A coin at a vault address. Like a swept input, it needs the controller as the first input, approved by the owner. */
export const vaultInput = (utxo: Utxo, script: VaultAddressScript, identity: Uint8Array, secret: Uint8Array): InputSpec => ({
  utxo,
  unlock: () => script.unlock.spend(identity, secret),
});

export type ControllerAction =
  | { kind: 'ownerClose' }
  | { kind: 'ownerAuthorize' }
  | { kind: 'requestRecovery'; proposedOwnerKeyHash: Uint8Array }
  | { kind: 'finalizeRecovery' }
  | { kind: 'ownerUpdate'; update: ControllerUpdate };

/** The controller state an action leads to. Throws if the action is not permitted in `state`. */
export const applyControllerAction = (state: ControllerState, action: ControllerAction): ControllerState => {
  switch (action.kind) {
    case 'ownerClose':
      throw new Error('Closing ends the identity: there is no state after it.');
    case 'ownerAuthorize':
      return afterOwnerAuthorize(state);
    case 'requestRecovery':
      return afterRequestRecovery(state, action.proposedOwnerKeyHash);
    case 'finalizeRecovery':
      return afterFinalizeRecovery(state);
    case 'ownerUpdate':
      return afterOwnerUpdate(state, action.update);
  }
};

const delayBytes = (sequence: number): Uint8Array =>
  Uint8Array.of(sequence & 0xff, (sequence >> 8) & 0xff, (sequence >> 16) & 0xff);

/** The controller output for a wallet identity in a given state. */
export const controllerOutput = (identity: Uint8Array, state: ControllerState, valueSatoshis: bigint): Output => ({
  lockingBytecode: controllerScript(identity).lockingBytecode,
  valueSatoshis,
  token: { amount: 0n, category: identity, nft: { capability: 'mutable', commitment: encodeControllerState(state) } },
});

/**
 * The controller input for an action, signed by `key`. Must be the first
 * input; the matching successor from {@link controllerSuccessor} must be the
 * first output.
 */
const identityOf = (utxo: Utxo): Uint8Array => {
  const identity = utxo.output.token?.category;
  if (identity === undefined) {
    throw new Error('The controller output carries no identity token.');
  }
  return identity;
};

export const controllerInput = (utxo: Utxo, state: ControllerState, action: ControllerAction, key: KeyPair): InputSpec => ({
  utxo,
  // Finalization must carry the challenge delay as its relative locktime.
  sequence: action.kind === 'finalizeRecovery' ? encodeChallengeDelay(state.challengeDelay) : 0,
  unlock: (sign) => {
    const script = controllerScript(identityOf(utxo));
    const authorization = { publicKey: key.publicKey, signature: sign(key.privateKey, script.redeemBytecode) };
    switch (action.kind) {
      case 'ownerClose':
        return script.unlock.ownerClose(authorization);
      case 'ownerAuthorize':
        return script.unlock.ownerAuthorize(authorization);
      case 'requestRecovery':
        return script.unlock.requestRecovery(authorization, action.proposedOwnerKeyHash);
      case 'finalizeRecovery':
        return script.unlock.finalizeRecovery(authorization);
      case 'ownerUpdate': {
        const next = afterOwnerUpdate(state, action.update);
        return script.unlock.ownerUpdate(authorization, {
          ownerKeyHash: next.ownerKeyHash,
          recovererKeyHash: next.recovererKeyHash,
          challengeDelay: delayBytes(encodeChallengeDelay(next.challengeDelay)),
        });
      }
    }
  },
});

/** The controller output that must follow `action`, keeping the controller's identity and value. */
export const controllerSuccessor = (utxo: Utxo, state: ControllerState, action: ControllerAction): Output => {
  return controllerOutput(identityOf(utxo), applyControllerAction(state, action), utxo.output.valueSatoshis);
};

export interface BuildParameters {
  inputs: InputSpec[];
  outputs: Output[];
  /**
   * Where BCH left over after outputs and fee goes. No change output is made when what is left is below the
   * smallest value nodes relay for it; that remainder then goes to the fee and is reported.
   */
  changeLockingBytecode?: Uint8Array;
  /**
   * Index of an output that receives everything left after the exact fee; its given value is ignored.
   * For sending everything, sweeping and closing. Not together with `changeLockingBytecode`.
   */
  remainderOutputIndex?: number;
  /** Satoshis per byte. Nodes require 1. */
  feeRate?: number;
  /** Signing type of every signature: `0x61` (default) or `0x41`. */
  signingType?: number;
  locktime?: number;
  /** Permit input tokens that do not reappear in the outputs. */
  allowTokenBurn?: boolean;
}

export interface BuiltTransaction {
  transaction: TransactionCommon;
  sourceOutputs: Output[];
  encoded: Uint8Array;
  /** Transaction ID as shown by explorers. */
  transactionId: string;
  transactionHash: Uint8Array;
  /** What the transaction pays: inputs less outputs. */
  feeSatoshis: bigint;
  /** What nodes require for a transaction of this size at the fee rate. */
  requiredFeeSatoshis: bigint;
  /** Part of the fee beyond the required one: an amount that was too small to return as change. Zero otherwise. */
  remainderSatoshis: bigint;
  /** Index of the change output, when one was added. */
  changeIndex?: number;
}

/** Every transaction is version 2, which the controller requires and which makes relative time locks apply. */
const VERSION = 2;

export const DEFAULT_FEE_RATE = 1;

/** The fee nodes require for a transaction of `byteLength` bytes at `feeRate` satoshis per byte. */
export const requiredFee = (byteLength: number, feeRate = DEFAULT_FEE_RATE): bigint => BigInt(Math.ceil(byteLength * feeRate));

/** The smallest value nodes relay for this output. It depends on the output's own size, tokens included. */
export const smallestOutputValue = (output: Output): bigint => getDustThreshold(output);

/**
 * The smallest value of a change output at an address of this wallet. A leftover below it cannot be returned
 * to the wallet; this is the most a transaction's fee may exceed the required one.
 */
export const SMALLEST_CHANGE = smallestOutputValue({ lockingBytecode: encodeLockingBytecodeP2sh32(new Uint8Array(32)), valueSatoshis: 0n });

/** Fungible amount and NFT count per token category. */
const tokenHoldings = (outputs: Output[]): Map<string, { amount: bigint; nfts: number }> => {
  const holdings = new Map<string, { amount: bigint; nfts: number }>();
  for (const { token } of outputs) {
    if (token === undefined) continue;
    const category = binToHex(token.category);
    const held = holdings.get(category) ?? { amount: 0n, nfts: 0 };
    holdings.set(category, { amount: held.amount + token.amount, nfts: held.nfts + (token.nft === undefined ? 0 : 1) });
  }
  return holdings;
};

/**
 * Whether every token in the inputs reappears in the outputs. Creating tokens
 * is not checked here: the network rules decide whether that is permitted.
 */
const keepsAllTokens = (inputs: Output[], outputs: Output[]): boolean => {
  const after = tokenHoldings(outputs);
  return [...tokenHoldings(inputs).entries()].every(([category, before]) => {
    const kept = after.get(category) ?? { amount: 0n, nfts: 0 };
    return kept.amount >= before.amount && kept.nfts >= before.nfts;
  });
};

const assemble = (
  parameters: BuildParameters,
  outputs: Output[],
): { transaction: TransactionCommon; sourceOutputs: Output[]; encoded: Uint8Array } => {
  const sourceOutputs = parameters.inputs.map(({ utxo }) => utxo.output);
  const transaction: TransactionCommon = {
    version: VERSION,
    locktime: parameters.locktime ?? 0,
    inputs: parameters.inputs.map(({ utxo, sequence }) => ({
      outpointTransactionHash: utxo.transactionHash,
      outpointIndex: utxo.index,
      sequenceNumber: sequence ?? 0,
      unlockingBytecode: new Uint8Array(0),
    })),
    outputs,
  };
  const signingType = parameters.signingType ?? CONTROLLER_SIGHASH_TYPE;
  // Signatures do not cover unlocking bytecode, so every input can be signed against the same transaction.
  const unlocking = parameters.inputs.map(({ unlock }, inputIndex) =>
    unlock((privateKey, coveredBytecode) =>
      signInput({ transaction, sourceOutputs, inputIndex, coveredBytecode, privateKey, signingType }),
    ),
  );
  unlocking.forEach((unlockingBytecode, inputIndex) => {
    const input = transaction.inputs[inputIndex];
    if (input !== undefined) input.unlockingBytecode = unlockingBytecode;
  });
  return { transaction, sourceOutputs, encoded: encodeTransactionBch(transaction) };
};

/** Thrown when the inputs do not cover the outputs and the fee, or leave less than an output may hold. */
export class InsufficientFundsError extends Error {
  constructor(
    readonly totalSatoshis: bigint,
    readonly feeSatoshis: bigint,
    readonly neededSatoshis: bigint,
    detail: string,
  ) {
    super(`Insufficient funds: ${detail} Inputs ${totalSatoshis}, fee ${feeSatoshis}, needed ${neededSatoshis}.`);
    this.name = 'InsufficientFundsError';
  }
}

/**
 * Build and sign a version 2 transaction that pays the exact fee.
 *
 * Signatures here have a fixed length, so the size of the signed transaction does not depend on the amounts
 * in it. The transaction is therefore signed once to measure it, and once more with the final amounts.
 *
 * - With `remainderOutputIndex`, that output receives everything left after the fee.
 * - With `changeLockingBytecode`, what is left returns there. If it is below the smallest value of that
 *   output, no change is made and the amount is reported as `remainderSatoshis`.
 * - With neither, the outputs are taken as given and must leave the required fee, and no more than
 *   `SMALLEST_CHANGE` beyond it.
 *
 * No output may be below the smallest value nodes relay for it.
 */
export const buildTransaction = (parameters: BuildParameters): BuiltTransaction => {
  const feeRate = parameters.feeRate ?? DEFAULT_FEE_RATE;
  if (parameters.inputs.length === 0) {
    throw new Error('A transaction needs at least one input.');
  }
  if (parameters.changeLockingBytecode !== undefined && parameters.remainderOutputIndex !== undefined) {
    throw new Error('A transaction returns what is left either as change or to one of its outputs, not both.');
  }
  const inputOutputs = parameters.inputs.map(({ utxo }) => utxo.output);
  if (parameters.allowTokenBurn !== true && !keepsAllTokens(inputOutputs, parameters.outputs)) {
    throw new Error('Tokens in the inputs would be destroyed: they do not all reappear in the outputs.');
  }

  const inputTotal = inputOutputs.reduce((sum, { valueSatoshis }) => sum + valueSatoshis, 0n);
  const finish = (outputs: Output[], changeIndex?: number): BuiltTransaction => {
    const assembled = assemble(parameters, outputs);
    const outputTotal = outputs.reduce((sum, { valueSatoshis }) => sum + valueSatoshis, 0n);
    const feeSatoshis = inputTotal - outputTotal;
    const requiredFeeSatoshis = requiredFee(assembled.encoded.length, feeRate);
    if (feeSatoshis < requiredFeeSatoshis) {
      throw new InsufficientFundsError(inputTotal, requiredFeeSatoshis, outputTotal + requiredFeeSatoshis, 'the outputs and the fee exceed the inputs.');
    }
    outputs.forEach((output, index) => {
      const smallest = smallestOutputValue(output);
      if (output.valueSatoshis < smallest) {
        throw new Error(`Output ${index} holds ${output.valueSatoshis} satoshis; nodes relay no such output below ${smallest}.`);
      }
    });
    const remainderSatoshis = feeSatoshis - requiredFeeSatoshis;
    if (remainderSatoshis >= SMALLEST_CHANGE && changeIndex === undefined) {
      throw new Error(
        `The fee of ${feeSatoshis} satoshis is ${remainderSatoshis} above the required ${requiredFeeSatoshis}; an amount that size is returned as change, not left to the fee.`,
      );
    }
    const transactionHash = hashTransactionUiOrder(assembled.encoded);
    return {
      ...assembled,
      transactionHash,
      transactionId: binToHex(transactionHash),
      feeSatoshis,
      requiredFeeSatoshis,
      remainderSatoshis,
      ...(changeIndex === undefined ? {} : { changeIndex }),
    };
  };
  const withValue = (outputs: Output[], index: number, valueSatoshis: bigint): Output[] =>
    outputs.map((output, position) => (position === index ? { ...output, valueSatoshis } : output));
  const totalExcept = (outputs: Output[], index: number): bigint =>
    outputs.reduce((sum, { valueSatoshis }, position) => (position === index ? sum : sum + valueSatoshis), 0n);

  if (parameters.remainderOutputIndex !== undefined) {
    const index = parameters.remainderOutputIndex;
    const target = parameters.outputs[index];
    if (target === undefined) throw new Error(`There is no output ${index} to receive what is left.`);
    // The size does not depend on the amount, so measure with a placeholder.
    const fee = requiredFee(assemble(parameters, withValue(parameters.outputs, index, 0n)).encoded.length, feeRate);
    const others = totalExcept(parameters.outputs, index);
    const value = inputTotal - others - fee;
    const smallest = smallestOutputValue(target);
    if (value < smallest) {
      throw new InsufficientFundsError(inputTotal, fee, others + fee + smallest, `what is left after the fee is below the ${smallest} satoshis an output of this kind must hold.`);
    }
    return finish(withValue(parameters.outputs, index, value));
  }

  if (parameters.changeLockingBytecode !== undefined) {
    const changeIndex = parameters.outputs.length;
    const withChange = (valueSatoshis: bigint): Output[] => [
      ...parameters.outputs,
      { lockingBytecode: parameters.changeLockingBytecode as Uint8Array, valueSatoshis },
    ];
    const fee = requiredFee(assemble(parameters, withChange(0n)).encoded.length, feeRate);
    const change = inputTotal - totalExcept(parameters.outputs, -1) - fee;
    if (change >= smallestOutputValue(withChange(0n)[changeIndex] as Output)) {
      return finish(withChange(change), changeIndex);
    }
    // Too little to return: no change output, and what is left goes to the fee, reported as the remainder.
    const built = finish(parameters.outputs, changeIndex);
    const { changeIndex: _none, ...withoutChange } = built;
    return withoutChange;
  }

  return finish(parameters.outputs);
};

const vm = createVirtualMachineBch2026(true);

/**
 * Check a transaction against the 2026 network rules, including standardness,
 * without any network access. Returns `true` or the reason for rejection.
 * Relative and absolute locktimes are checked only as far as the transaction
 * itself shows; whether enough time has passed on chain is up to the network.
 */
export const verifyTransaction = ({ transaction, sourceOutputs }: Pick<BuiltTransaction, 'transaction' | 'sourceOutputs'>): string | true =>
  vm.verify({ transaction, sourceOutputs });

/**
 * The check before sending. `true` when the transaction passes the network's rules, pays the required fee
 * and no more than a remainder too small to return, and has no output below its smallest value; otherwise
 * the reason. It works from the signed transaction alone, whoever built it.
 */
export const checkBeforeSending = (
  { transaction, sourceOutputs }: Pick<BuiltTransaction, 'transaction' | 'sourceOutputs'>,
  feeRate = DEFAULT_FEE_RATE,
): string | true => {
  if (sourceOutputs.length !== transaction.inputs.length) return 'The spent outputs do not match the inputs.';
  const inputTotal = sourceOutputs.reduce((sum, { valueSatoshis }) => sum + valueSatoshis, 0n);
  const outputTotal = transaction.outputs.reduce((sum, { valueSatoshis }) => sum + valueSatoshis, 0n);
  const fee = inputTotal - outputTotal;
  const required = requiredFee(encodeTransactionBch(transaction).length, feeRate);
  if (fee < required) return `The fee of ${fee} satoshis is below the ${required} that nodes require.`;
  if (fee - required >= SMALLEST_CHANGE) {
    return `The fee of ${fee} satoshis is ${fee - required} above the required ${required}: more than a remainder too small to return.`;
  }
  for (const [index, output] of transaction.outputs.entries()) {
    const smallest = smallestOutputValue(output);
    if (output.valueSatoshis < smallest) return `Output ${index} holds ${output.valueSatoshis} satoshis; nodes relay no such output below ${smallest}.`;
  }
  return verifyTransaction({ transaction, sourceOutputs });
};

export { CONTROLLER_INDEX };
