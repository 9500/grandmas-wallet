import {
  type Output,
  type TransactionCommon,
  binToHex,
  createVirtualMachineBch2026,
  encodeDataPush,
  encodeLockingBytecodeP2pkh,
  encodeTransactionBch,
  flattenBinArray,
  hash160,
  hashTransactionUiOrder,
  secp256k1,
} from '@bitauth/libauth';

import { CONTROLLER_INDEX, controllerScript, signInput } from './controller.js';
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

export type ControllerAction =
  | { kind: 'ownerAuthorize' }
  | { kind: 'requestRecovery'; proposedOwnerKeyHash: Uint8Array }
  | { kind: 'finalizeRecovery' }
  | { kind: 'ownerUpdate'; update: ControllerUpdate };

/** The controller state an action leads to. Throws if the action is not permitted in `state`. */
export const applyControllerAction = (state: ControllerState, action: ControllerAction): ControllerState => {
  switch (action.kind) {
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
  /** Where BCH left over after outputs and fee goes. Omitted when the remainder is below `dustSatoshis`. */
  changeLockingBytecode?: Uint8Array;
  /** Satoshis per byte. */
  feeRate?: number;
  locktime?: number;
  dustSatoshis?: bigint;
  /** Refuse to build a transaction paying more than this in fees. */
  maximumFeeSatoshis?: bigint;
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
  feeSatoshis: bigint;
  /** Index of the change output, when one was added. */
  changeIndex?: number;
}

const DEFAULT_FEE_RATE = 1;
const DEFAULT_DUST = 546n;
const DEFAULT_MAXIMUM_FEE = 5_000n;
const VERSION = 2;

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
  // Signatures do not cover unlocking bytecode, so every input can be signed against the same transaction.
  const unlocking = parameters.inputs.map(({ unlock }, inputIndex) =>
    unlock((privateKey, coveredBytecode) =>
      signInput({ transaction, sourceOutputs, inputIndex, coveredBytecode, privateKey }),
    ),
  );
  unlocking.forEach((unlockingBytecode, inputIndex) => {
    const input = transaction.inputs[inputIndex];
    if (input !== undefined) input.unlockingBytecode = unlockingBytecode;
  });
  return { transaction, sourceOutputs, encoded: encodeTransactionBch(transaction) };
};

/**
 * Build and sign a version 2 transaction. The fee is set from the final size
 * and `feeRate`; the remainder goes to `changeLockingBytecode`.
 */
export const buildTransaction = (parameters: BuildParameters): BuiltTransaction => {
  const feeRate = parameters.feeRate ?? DEFAULT_FEE_RATE;
  const dust = parameters.dustSatoshis ?? DEFAULT_DUST;
  const maximumFee = parameters.maximumFeeSatoshis ?? DEFAULT_MAXIMUM_FEE;

  if (parameters.inputs.length === 0) {
    throw new Error('A transaction needs at least one input.');
  }
  const inputOutputs = parameters.inputs.map(({ utxo }) => utxo.output);
  if (parameters.allowTokenBurn !== true && !keepsAllTokens(inputOutputs, parameters.outputs)) {
    throw new Error('Tokens in the inputs would be destroyed: they do not all reappear in the outputs.');
  }

  const inputTotal = inputOutputs.reduce((sum, { valueSatoshis }) => sum + valueSatoshis, 0n);
  const outputTotal = parameters.outputs.reduce((sum, { valueSatoshis }) => sum + valueSatoshis, 0n);
  const feeFor = (encoded: Uint8Array): bigint => BigInt(Math.ceil(encoded.length * feeRate));
  const finish = (
    assembled: ReturnType<typeof assemble>,
    feeSatoshis: bigint,
    changeIndex?: number,
  ): BuiltTransaction => {
    if (feeSatoshis < feeFor(assembled.encoded)) {
      throw new Error(
        `Insufficient funds: inputs ${inputTotal}, outputs ${outputTotal}, fee needed ${feeFor(assembled.encoded)}.`,
      );
    }
    if (feeSatoshis > maximumFee) {
      throw new Error(`Fee of ${feeSatoshis} satoshis exceeds the maximum of ${maximumFee}.`);
    }
    const transactionHash = hashTransactionUiOrder(assembled.encoded);
    return {
      ...assembled,
      transactionHash,
      transactionId: binToHex(transactionHash),
      feeSatoshis,
      ...(changeIndex === undefined ? {} : { changeIndex }),
    };
  };

  if (parameters.changeLockingBytecode !== undefined) {
    const changeIndex = parameters.outputs.length;
    const withChange = (valueSatoshis: bigint): Output[] => [
      ...parameters.outputs,
      { lockingBytecode: parameters.changeLockingBytecode as Uint8Array, valueSatoshis },
    ];
    // The size does not depend on the change amount, so measure with a placeholder.
    const fee = feeFor(assemble(parameters, withChange(dust)).encoded);
    const change = inputTotal - outputTotal - fee;
    if (change >= dust) {
      return finish(assemble(parameters, withChange(change)), fee, changeIndex);
    }
  }
  return finish(assemble(parameters, parameters.outputs), inputTotal - outputTotal);
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

export { CONTROLLER_INDEX };
