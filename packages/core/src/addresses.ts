import { encodeDataPush, flattenBinArray, hash256 } from '@bitauth/libauth';
import { recoverableAddressBytecodeHex } from '@grandmas-wallet/contracts/recoverableAddress';
import { vaultAddressBytecodeHex } from '@grandmas-wallet/contracts/vaultAddress';

import type { KeyAuthorization } from './controller.js';
import { identityForScript, instantiate, lockingBytecodeOf } from './script.js';

const SECRET_LENGTH = 32;
const TAG_LENGTH = 32;
const KEY_HASH_LENGTH = 20;

/** The kinds of address a seed has. The number is the kind byte in an address secret. */
export const ADDRESS_KIND = { givenOut: 0, change: 1, vault: 2 } as const;
export type AddressKind = (typeof ADDRESS_KIND)[keyof typeof ADDRESS_KIND];

const exactly = (name: string, bytes: Uint8Array, length: number): Uint8Array => {
  if (bytes.length !== length) throw new Error(`${name} is ${length} bytes, got ${bytes.length}.`);
  return bytes;
};

/**
 * The secret of one address: hash256(blinding seed ‖ kind ‖ number as four bytes, little-endian).
 * Whoever holds the blinding seed can compute every secret of the seed.
 */
export const addressSecret = (blindingSeed: Uint8Array, kind: AddressKind, number: number): Uint8Array => {
  if (!Number.isInteger(number) || number < 0 || number > 0x7fffffff) {
    throw new Error(`An address number is a whole number from 0 to 2147483647, got ${number}.`);
  }
  const numberBytes = Uint8Array.of(number & 0xff, (number >> 8) & 0xff, (number >> 16) & 0xff, (number >> 24) & 0xff);
  return hash256(flattenBinArray([exactly('A blinding seed', blindingSeed, SECRET_LENGTH), Uint8Array.of(kind), numberBytes]));
};

/**
 * The tag of an address: hash256(identity ‖ secret), with the identity in the byte order contracts see.
 * It ties the address to a wallet without showing which.
 */
export const addressTag = (identity: Uint8Array, secret: Uint8Array): Uint8Array =>
  hash256(flattenBinArray([identityForScript(identity), exactly('An address secret', secret, SECRET_LENGTH)]));

/** Function selectors of `RecoverableAddress`, in the order the contract declares its functions. */
const RECOVERABLE_SELECTOR = { spend: Uint8Array.of(0x00), sweep: Uint8Array.of(0x51) } as const;

/** One recoverable address: spendable by its own key, or by the wallet's current owner through the controller. */
export interface RecoverableAddressScript {
  tag: Uint8Array;
  keyHash: Uint8Array;
  redeemBytecode: Uint8Array;
  /** Pay-to-script-hash (32-byte) locking bytecode: the address. */
  lockingBytecode: Uint8Array;
  unlock: {
    /** The everyday path: a signature of the address key. No controller in the transaction. */
    spend: (authorization: KeyAuthorization) => Uint8Array;
    /** The controller path: the identity and the address secret. The controller must be input 0, approved by the owner. */
    sweep: (identity: Uint8Array, secret: Uint8Array) => Uint8Array;
  };
}

export const recoverableAddressScript = (tag: Uint8Array, keyHash: Uint8Array): RecoverableAddressScript => {
  const redeemBytecode = instantiate(recoverableAddressBytecodeHex, [exactly('An address tag', tag, TAG_LENGTH), exactly('A key hash', keyHash, KEY_HASH_LENGTH)]);
  const push = encodeDataPush(redeemBytecode);
  return {
    tag,
    keyHash,
    redeemBytecode,
    lockingBytecode: lockingBytecodeOf(redeemBytecode),
    unlock: {
      // Function arguments are pushed in reverse order, then the selector, then the redeem script.
      spend: ({ publicKey, signature }) => flattenBinArray([encodeDataPush(signature), encodeDataPush(publicKey), RECOVERABLE_SELECTOR.spend, push]),
      sweep: (identity, secret) =>
        flattenBinArray([encodeDataPush(exactly('An address secret', secret, SECRET_LENGTH)), encodeDataPush(identityForScript(identity)), RECOVERABLE_SELECTOR.sweep, push]),
    },
  };
};

/** One vault address: no key; only the wallet's current owner can spend from it, through the controller. */
export interface VaultAddressScript {
  tag: Uint8Array;
  redeemBytecode: Uint8Array;
  lockingBytecode: Uint8Array;
  unlock: {
    /** The identity and the address secret. The controller must be input 0, approved by the owner. */
    spend: (identity: Uint8Array, secret: Uint8Array) => Uint8Array;
  };
}

export const vaultAddressScript = (tag: Uint8Array): VaultAddressScript => {
  const redeemBytecode = instantiate(vaultAddressBytecodeHex, [exactly('An address tag', tag, TAG_LENGTH)]);
  return {
    tag,
    redeemBytecode,
    lockingBytecode: lockingBytecodeOf(redeemBytecode),
    unlock: {
      // The contract has one function, so there is no selector.
      spend: (identity, secret) =>
        flattenBinArray([encodeDataPush(exactly('An address secret', secret, SECRET_LENGTH)), encodeDataPush(identityForScript(identity)), encodeDataPush(redeemBytecode)]),
    },
  };
};
