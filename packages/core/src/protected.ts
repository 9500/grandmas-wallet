import {
  bigIntToVmNumber,
  encodeDataPush,
  encodeLockingBytecodeP2sh32,
  flattenBinArray,
  hash256,
  hexToBin,
} from '@bitauth/libauth';
import { assetBytecodeHex } from '@grandmas-wallet/contracts/asset';
import { savingsJarBytecodeHex } from '@grandmas-wallet/contracts/savingsJar';

import type { KeyAuthorization } from './controller.js';

/**
 * Outputs protected by the shared authorization interface: spendable only
 * with the approval of the current owner of a wallet identity.
 */

const IDENTITY_LENGTH = 32;

const assertIdentity = (identity: Uint8Array): void => {
  if (identity.length !== IDENTITY_LENGTH) {
    throw new Error(`A wallet identity is ${IDENTITY_LENGTH} bytes, got ${identity.length}.`);
  }
};

/** Constructor arguments precede the contract body, last argument first. */
const instantiate = (bytecodeHex: string, constructorArguments: Uint8Array[]): Uint8Array =>
  flattenBinArray([...[...constructorArguments].reverse().map((arg) => encodeDataPush(arg)), hexToBin(bytecodeHex)]);

const lockingBytecodeOf = (redeemBytecode: Uint8Array): Uint8Array =>
  encodeLockingBytecodeP2sh32(hash256(redeemBytecode));

const ownerUnlocking = ({ publicKey, signature }: KeyAuthorization, redeemBytecode: Uint8Array): Uint8Array =>
  flattenBinArray([encodeDataPush(signature), encodeDataPush(publicKey), encodeDataPush(redeemBytecode)]);

export interface ProtectedScript {
  redeemBytecode: Uint8Array;
  lockingBytecode: Uint8Array;
  /** Unlocking bytecode for a spend approved by the wallet owner. */
  unlock: (authorization: KeyAuthorization) => Uint8Array;
}

const protectedScript = (redeemBytecode: Uint8Array): ProtectedScript => ({
  redeemBytecode,
  lockingBytecode: lockingBytecodeOf(redeemBytecode),
  unlock: (authorization) => ownerUnlocking(authorization, redeemBytecode),
});

/**
 * The asset covenant of a wallet: holds its BCH and tokens. Its locking
 * bytecode is the wallet's receiving address for the life of the identity.
 * `identity` is the identity token category in the byte order contracts see
 * (the reverse of the order shown by explorers).
 */
export const assetScript = (identity: Uint8Array): ProtectedScript => {
  assertIdentity(identity);
  return protectedScript(instantiate(assetBytecodeHex, [identity]));
};

/**
 * A Savings Jar position: funds locked until `unlockTime`, then withdrawable
 * by the wallet owner. `unlockTime` is a block height below 500,000,000 and a
 * Unix timestamp from there on; a withdrawing transaction needs a locktime of
 * the same kind at or after it, and a non-final sequence number on the jar input.
 */
export const savingsJarScript = (identity: Uint8Array, unlockTime: number): ProtectedScript => {
  assertIdentity(identity);
  if (!Number.isInteger(unlockTime) || unlockTime < 0 || unlockTime > 0xffffffff) {
    throw new Error('Unlock time must be an integer from 0 to 4294967295.');
  }
  return protectedScript(instantiate(savingsJarBytecodeHex, [identity, bigIntToVmNumber(BigInt(unlockTime))]));
};
