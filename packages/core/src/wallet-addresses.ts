import { lockingBytecodeToCashAddress } from '@bitauth/libauth';

import { type AddressKind, type RecoverableAddressScript, type VaultAddressScript, ADDRESS_KIND, addressSecret, addressTag, recoverableAddressScript, vaultAddressScript } from './addresses.js';
import { type KeyedAddressKind, type ViewingKey, viewingKeyHash } from './keys.js';
import type { XoNetwork } from './xo-keys.js';

/**
 * The addresses of a wallet (proposal sections 7.3 to 7.7): every address of a seed follows from the wallet's
 * identity and the seed's viewing key. No list of addresses is kept anywhere.
 */

/** The version of the address scheme: the scripts, the paths and the ranges below. */
export const ADDRESS_SCHEME_VERSION = 1;

/** How many addresses of each kind a seed has. Valid numbers are 0 to the size less one. */
export const ADDRESS_RANGE: Record<AddressKind, number> = {
  [ADDRESS_KIND.givenOut]: 10_000,
  [ADDRESS_KIND.change]: 10_000,
  [ADDRESS_KIND.vault]: 1_000,
};

/** How far past the last used address of its kind the wallet gives out, and a search looks. */
export const ADDRESS_WINDOW: Record<AddressKind, number> = {
  [ADDRESS_KIND.givenOut]: 20,
  [ADDRESS_KIND.change]: 5,
  [ADDRESS_KIND.vault]: 5,
};

export const ADDRESS_KINDS: AddressKind[] = [ADDRESS_KIND.givenOut, ADDRESS_KIND.change, ADDRESS_KIND.vault];

const CASH_ADDRESS_PREFIX: Record<XoNetwork, 'bitcoincash' | 'bchtest'> = { mainnet: 'bitcoincash', testnet: 'bchtest' };

interface AddressBase {
  number: number;
  /** What the controller path shows for this address, with the identity. */
  secret: Uint8Array;
  tag: Uint8Array;
  lockingBytecode: Uint8Array;
  /** The address as text, as a payer sees it. */
  address: string;
}

export interface RecoverableWalletAddress extends AddressBase {
  kind: KeyedAddressKind;
  keyHash: Uint8Array;
  script: RecoverableAddressScript;
}

export interface VaultWalletAddress extends AddressBase {
  kind: typeof ADDRESS_KIND.vault;
  script: VaultAddressScript;
}

export type WalletAddress = RecoverableWalletAddress | VaultWalletAddress;

/**
 * Address `number` of a kind, for a wallet identity and a seed's viewing key.
 *
 * @throws if the number is outside the range of its kind
 */
export const walletAddress = (identity: Uint8Array, viewingKey: ViewingKey, kind: AddressKind, number: number): WalletAddress => {
  if (!Number.isInteger(number) || number < 0 || number >= ADDRESS_RANGE[kind]) {
    throw new Error(`Addresses of this kind are numbered 0 to ${ADDRESS_RANGE[kind] - 1}, got ${number}.`);
  }
  const secret = addressSecret(viewingKey.blindingSeed, kind, number);
  const tag = addressTag(identity, secret);
  const text = (lockingBytecode: Uint8Array): string => {
    const encoded = lockingBytecodeToCashAddress({ prefix: CASH_ADDRESS_PREFIX[viewingKey.network], bytecode: lockingBytecode });
    if (typeof encoded === 'string') throw new Error(encoded);
    return encoded.address;
  };
  if (kind === ADDRESS_KIND.vault) {
    const script = vaultAddressScript(tag);
    return { kind, number, secret, tag, script, lockingBytecode: script.lockingBytecode, address: text(script.lockingBytecode) };
  }
  const keyHash = viewingKeyHash(viewingKey, kind, number);
  const script = recoverableAddressScript(tag, keyHash);
  return { kind, number, secret, tag, keyHash, script, lockingBytecode: script.lockingBytecode, address: text(script.lockingBytecode) };
};
