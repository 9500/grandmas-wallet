import {
  type Output,
  type TransactionCommon,
  bigIntToVmNumber,
  encodeDataPush,
  encodeLockingBytecodeP2sh32,
  flattenBinArray,
  generateSigningSerializationBch,
  hash256,
  hexToBin,
  secp256k1,
} from '@bitauth/libauth';
import { controllerBytecodeHex } from '@grandmas-wallet/contracts/controller';

/** The controller covenant. Identical for every wallet; wallets differ by identity token category. */
export const controllerRedeemBytecode: Uint8Array = hexToBin(controllerBytecodeHex);

/** Pay-to-script-hash (32-byte) locking bytecode of the controller covenant. */
export const controllerLockingBytecode: Uint8Array = encodeLockingBytecodeP2sh32(hash256(controllerRedeemBytecode));

/** SIGHASH_ALL | SIGHASH_UTXOS | SIGHASH_FORKID — the only signing type the controller accepts. */
export const CONTROLLER_SIGHASH_TYPE = 0x61;

/** Position of the controller in every transaction that spends it. */
export const CONTROLLER_INDEX = 0;

const SELECTOR = {
  ownerAuthorize: 0n,
  requestRecovery: 1n,
  finalizeRecovery: 2n,
  ownerUpdate: 3n,
} as const;

/** Function arguments are pushed in reverse order, then the function selector, then the redeem script. */
const unlock = (selector: bigint, args: Uint8Array[]): Uint8Array =>
  flattenBinArray([
    ...[...args].reverse().map((arg) => encodeDataPush(arg)),
    encodeDataPush(bigIntToVmNumber(selector)),
    encodeDataPush(controllerRedeemBytecode),
  ]);

export interface KeyAuthorization {
  publicKey: Uint8Array;
  /** Signature followed by its one-byte signing type. */
  signature: Uint8Array;
}

/** Unlocking bytecode for each controller transition. */
export const controllerUnlocking = {
  ownerAuthorize: ({ publicKey, signature }: KeyAuthorization): Uint8Array =>
    unlock(SELECTOR.ownerAuthorize, [publicKey, signature]),

  requestRecovery: ({ publicKey, signature }: KeyAuthorization, proposedOwnerKeyHash: Uint8Array): Uint8Array =>
    unlock(SELECTOR.requestRecovery, [publicKey, signature, proposedOwnerKeyHash]),

  finalizeRecovery: ({ publicKey, signature }: KeyAuthorization): Uint8Array =>
    unlock(SELECTOR.finalizeRecovery, [publicKey, signature]),

  ownerUpdate: (
    { publicKey, signature }: KeyAuthorization,
    update: { ownerKeyHash: Uint8Array; recovererKeyHash: Uint8Array; challengeDelay: Uint8Array },
  ): Uint8Array =>
    unlock(SELECTOR.ownerUpdate, [
      publicKey,
      signature,
      update.ownerKeyHash,
      update.recovererKeyHash,
      update.challengeDelay,
    ]),
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
