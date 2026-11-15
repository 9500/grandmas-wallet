import { bigIntToVmNumber, encodeDataPush } from '@bitauth/libauth';
import { assetBytecodeHex } from '@grandmas-wallet/contracts/asset';
import { savingsJarBytecodeHex } from '@grandmas-wallet/contracts/savingsJar';

import { identityForScript, instantiate, lockingBytecodeOf } from './script.js';

/**
 * Outputs protected by the shared authorization interface: spendable only in
 * a transaction that the current owner of a wallet identity approves through
 * the wallet's controller. They hold no key of their own.
 */

export interface ProtectedScript {
  redeemBytecode: Uint8Array;
  lockingBytecode: Uint8Array;
  /**
   * Unlocking bytecode: only the script itself. A protected output checks no signature; it is released by
   * the wallet's controller being spent with the owner's approval in the same transaction.
   */
  unlockingBytecode: Uint8Array;
}

const protectedScript = (redeemBytecode: Uint8Array): ProtectedScript => ({
  redeemBytecode,
  lockingBytecode: lockingBytecodeOf(redeemBytecode),
  unlockingBytecode: encodeDataPush(redeemBytecode),
});

/**
 * The asset covenant of a wallet: holds its BCH and tokens. Its locking
 * bytecode is the wallet's receiving address for the life of the identity.
 */
export const assetScript = (identity: Uint8Array): ProtectedScript =>
  protectedScript(instantiate(assetBytecodeHex, [identityForScript(identity)]));

/**
 * A Savings Jar position: funds locked until `unlockTime`, then withdrawable
 * in a transaction the wallet owner approves. `unlockTime` is a block height below 500,000,000 and a
 * Unix timestamp from there on; a withdrawing transaction needs a locktime of
 * the same kind at or after it, and a non-final sequence number on the jar input.
 */
export const savingsJarScript = (identity: Uint8Array, unlockTime: number): ProtectedScript => {
  const scriptIdentity = identityForScript(identity);
  if (!Number.isInteger(unlockTime) || unlockTime < 0 || unlockTime > 0xffffffff) {
    throw new Error('Unlock time must be an integer from 0 to 4294967295.');
  }
  return protectedScript(instantiate(savingsJarBytecodeHex, [scriptIdentity, bigIntToVmNumber(BigInt(unlockTime))]));
};
