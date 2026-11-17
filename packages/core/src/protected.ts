/**
 * An output that the wallet's controller releases: spendable only in a
 * transaction that the current owner of a wallet identity approves through
 * the controller, which is that transaction's first input.
 */
export interface ProtectedScript {
  redeemBytecode: Uint8Array;
  lockingBytecode: Uint8Array;
  /** Everything the input carries: the script's arguments, if it takes any, and the script itself. No signature. */
  unlockingBytecode: Uint8Array;
}
