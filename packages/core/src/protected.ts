import { encodeDataPush } from '@bitauth/libauth';
import { assetBytecodeHex } from '@grandmas-wallet/contracts/asset';

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

/** A script under the authorization interface, from its redeem bytecode. Applications build their own with this. */
export const protectedScript = (redeemBytecode: Uint8Array): ProtectedScript => ({
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
