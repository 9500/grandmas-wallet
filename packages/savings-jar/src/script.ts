import { bigIntToVmNumber, encodeDataPush, flattenBinArray, vmNumberToBigInt } from '@bitauth/libauth';
import { savingsJarBytecodeHex } from '@grandmas-wallet/contracts/savingsJar';
import { identityForScript, instantiate, lockingBytecodeOf } from '@grandmas-wallet/core';

/**
 * The Savings Jar's script, built without an XO engine: for the application's page when it serves an
 * ordinary wallet, and for tests. It is the same script the template's `savingsJarLockingScript` gives.
 */

export interface SavingsJarScript {
  redeemBytecode: Uint8Array;
  /** Pay-to-script-hash (32-byte) locking bytecode: the jar's address. */
  lockingBytecode: Uint8Array;
  /** Unlocks one coin of the jar, in a transaction whose input `keyInput` spends the jar's key. */
  unlock: (keyInput: number) => Uint8Array;
}

/** The date of a jar as it is written on its key: the number as scripts write it. */
export const unlockTimeBytes = (unlockTime: number): Uint8Array => {
  if (!Number.isInteger(unlockTime) || unlockTime < 0 || unlockTime > 0xffffffff) throw new Error('A jar\'s date is a whole number from 0 to 4294967295.');
  return bigIntToVmNumber(BigInt(unlockTime));
};

/** The date written on a jar's key. */
export const unlockTimeOf = (commitment: Uint8Array): number => {
  const number = vmNumberToBigInt(commitment, { requireMinimalEncoding: true });
  if (typeof number !== 'bigint' || number < 0n || number > 0xffffffffn) throw new Error('This is not the date of a savings jar.');
  return Number(number);
};

/**
 * The jar that a key opens.
 * @param keyCategory - the token category of the jar's key, in the byte order shown by explorers
 * @param unlockTime - a Unix time (500,000,000 or above) or a block height
 */
export const savingsJarScript = (keyCategory: Uint8Array, unlockTime: number): SavingsJarScript => {
  const redeemBytecode = instantiate(savingsJarBytecodeHex, [identityForScript(keyCategory), unlockTimeBytes(unlockTime)]);
  return {
    redeemBytecode,
    lockingBytecode: lockingBytecodeOf(redeemBytecode),
    unlock: (keyInput) => flattenBinArray([encodeDataPush(bigIntToVmNumber(BigInt(keyInput))), encodeDataPush(redeemBytecode)]),
  };
};

/** The sequence number of a jar's input in a withdrawal: below the highest, so that the lock time counts. */
export const WITHDRAW_SEQUENCE = 0xfffffffe;
