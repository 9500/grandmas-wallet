import { encodeDataPush, encodeLockingBytecodeP2sh32, flattenBinArray, hash256, hexToBin } from '@bitauth/libauth';

const IDENTITY_LENGTH = 32;

/**
 * A wallet identity is the token category of its controller, in the byte order
 * shown by block explorers and used by libauth (`Output.token.category`).
 * Contracts see token categories in the reverse order, so the identity is
 * reversed when it is placed into a script.
 */
export const identityForScript = (identity: Uint8Array): Uint8Array => {
  if (identity.length !== IDENTITY_LENGTH) {
    throw new Error(`A wallet identity is ${IDENTITY_LENGTH} bytes, got ${identity.length}.`);
  }
  return identity.slice().reverse();
};

/** A compiled contract with its constructor arguments, which precede the contract body, last argument first. */
export const instantiate = (bytecodeHex: string, constructorArguments: Uint8Array[]): Uint8Array =>
  flattenBinArray([...[...constructorArguments].reverse().map((arg) => encodeDataPush(arg)), hexToBin(bytecodeHex)]);

/** Pay-to-script-hash (32-byte) locking bytecode for a redeem script. */
export const lockingBytecodeOf = (redeemBytecode: Uint8Array): Uint8Array =>
  encodeLockingBytecodeP2sh32(hash256(redeemBytecode));
