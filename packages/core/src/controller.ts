import {
  type Output,
  type TransactionCommon,
  bigIntToVmNumber,
  encodeDataPush,
  flattenBinArray,
  generateSigningSerializationBch,
  hash256,
  secp256k1,
} from '@bitauth/libauth';
import { controllerBytecodeHex } from '@grandmas-wallet/contracts/controller';

import { identityForScript, instantiate, lockingBytecodeOf } from './script.js';

/**
 * SIGHASH_ALL | SIGHASH_UTXOS | SIGHASH_FORKID — the signing type this library uses. It covers every input,
 * every output, and the amount and script of every spent output.
 */
export const CONTROLLER_SIGHASH_TYPE = 0x61;

/**
 * Signing types the contracts accept. `0x41` (SIGHASH_ALL | SIGHASH_FORKID) covers every input and output
 * but not the other inputs' spent outputs; it is accepted so that signers which cannot provide those, such
 * as the current XO engine, can still authorize a transaction.
 */
export const ACCEPTED_SIGHASH_TYPES = [0x41, 0x61] as const;

/** Position of the controller in every transaction that spends it. */
export const CONTROLLER_INDEX = 0;

const SELECTOR = {
  ownerAuthorize: 0n,
  requestRecovery: 1n,
  finalizeRecovery: 2n,
  ownerUpdate: 3n,
} as const;

export interface KeyAuthorization {
  publicKey: Uint8Array;
  /** Signature followed by its one-byte signing type. */
  signature: Uint8Array;
}

/** The controller covenant of one wallet. */
export interface ControllerScript {
  identity: Uint8Array;
  redeemBytecode: Uint8Array;
  /** Pay-to-script-hash (32-byte) locking bytecode: the wallet's controller address. */
  lockingBytecode: Uint8Array;
  /** Unlocking bytecode for each controller transition. */
  unlock: {
    ownerAuthorize: (authorization: KeyAuthorization) => Uint8Array;
    requestRecovery: (authorization: KeyAuthorization, proposedOwnerKeyHash: Uint8Array) => Uint8Array;
    finalizeRecovery: (authorization: KeyAuthorization) => Uint8Array;
    ownerUpdate: (
      authorization: KeyAuthorization,
      update: { ownerKeyHash: Uint8Array; recovererKeyHash: Uint8Array; challengeDelay: Uint8Array },
    ) => Uint8Array;
  };
}

/**
 * The controller covenant for a wallet identity. The identity is part of the
 * script, so every wallet has its own controller address, and only that
 * wallet's identity token can act as the controller there.
 */
export const controllerScript = (identity: Uint8Array): ControllerScript => {
  const redeemBytecode = instantiate(controllerBytecodeHex, [identityForScript(identity)]);
  /** Function arguments are pushed in reverse order, then the function selector, then the redeem script. */
  const unlock = (selector: bigint, args: Uint8Array[]): Uint8Array =>
    flattenBinArray([
      ...[...args].reverse().map((arg) => encodeDataPush(arg)),
      encodeDataPush(bigIntToVmNumber(selector)),
      encodeDataPush(redeemBytecode),
    ]);
  return {
    identity,
    redeemBytecode,
    lockingBytecode: lockingBytecodeOf(redeemBytecode),
    unlock: {
      ownerAuthorize: ({ publicKey, signature }) => unlock(SELECTOR.ownerAuthorize, [publicKey, signature]),
      requestRecovery: ({ publicKey, signature }, proposedOwnerKeyHash) =>
        unlock(SELECTOR.requestRecovery, [publicKey, signature, proposedOwnerKeyHash]),
      finalizeRecovery: ({ publicKey, signature }) => unlock(SELECTOR.finalizeRecovery, [publicKey, signature]),
      ownerUpdate: ({ publicKey, signature }, update) =>
        unlock(SELECTOR.ownerUpdate, [
          publicKey,
          signature,
          update.ownerKeyHash,
          update.recovererKeyHash,
          update.challengeDelay,
        ]),
    },
  };
};

export interface SignInputParameters {
  transaction: TransactionCommon;
  /** The outputs spent by the transaction's inputs, in input order. */
  sourceOutputs: Output[];
  inputIndex: number;
  /** The script being satisfied: the redeem script for pay-to-script-hash inputs. */
  coveredBytecode: Uint8Array;
  privateKey: Uint8Array;
  /** Defaults to the type the controller requires. */
  signingType?: number;
}

/**
 * Produce a Schnorr signature for one input, followed by its signing type byte.
 * The unlocking bytecode of the inputs is not covered by the signature, so the
 * transaction may carry placeholders there while signing.
 */
export const signInput = ({
  transaction,
  sourceOutputs,
  inputIndex,
  coveredBytecode,
  privateKey,
  signingType = CONTROLLER_SIGHASH_TYPE,
}: SignInputParameters): Uint8Array => {
  const serialization = generateSigningSerializationBch(
    { inputIndex, sourceOutputs, transaction },
    { coveredBytecode, signingSerializationType: Uint8Array.of(signingType) },
  );
  const signature = secp256k1.signMessageHashSchnorr(privateKey, hash256(serialization));
  if (typeof signature === 'string') {
    throw new Error(`Signing failed: ${signature}`);
  }
  return flattenBinArray([signature, Uint8Array.of(signingType)]);
};
