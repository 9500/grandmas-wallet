import { bigIntToVmNumber } from '@bitauth/libauth';
import { savingsJarBytecodeHex } from '@grandmas-wallet/contracts/savingsJar';
import { type ProtectedScript, identityForScript, instantiate, protectedScript } from '@grandmas-wallet/core';

/**
 * A savings jar of a wallet identity: funds locked until `unlockTime`, then withdrawable in a transaction
 * the wallet's owner approves. `unlockTime` is a block height below 500,000,000 and a Unix timestamp from
 * there on; a withdrawing transaction needs a locktime of the same kind at or after it, and a non-final
 * sequence number on the jar input.
 *
 * The same script as the template's `savingsJarLockingScript`, built without an XO engine.
 */
export const savingsJarScript = (identity: Uint8Array, unlockTime: number): ProtectedScript => {
  const scriptIdentity = identityForScript(identity);
  if (!Number.isInteger(unlockTime) || unlockTime < 0 || unlockTime > 0xffffffff) {
    throw new Error('Unlock time must be an integer from 0 to 4294967295.');
  }
  return protectedScript(instantiate(savingsJarBytecodeHex, [scriptIdentity, bigIntToVmNumber(BigInt(unlockTime))]));
};
