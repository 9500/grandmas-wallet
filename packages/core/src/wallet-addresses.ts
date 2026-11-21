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

const CASH_ADDRESS_PREFIX: Record<XoNetwork, 'bitcoincash' | 'bchtest' | 'bchreg'> = { mainnet: 'bitcoincash', testnet: 'bchtest' };

/**
 * How addresses of a test network are written: `bchtest`, or `bchreg` on a chain of one's own whose addresses
 * should not be taken for chipnet's. The keys and the scripts are the same either way; only the text differs.
 * Set once when a page or a script starts, before any address is written.
 */
export const setTestAddressPrefix = (prefix: 'bchtest' | 'bchreg'): void => {
  CASH_ADDRESS_PREFIX.testnet = prefix;
};

/** The prefix addresses of a test network are written with now. */
export const testAddressPrefix = (): 'bchtest' | 'bchreg' => CASH_ADDRESS_PREFIX.testnet as 'bchtest' | 'bchreg';

interface AddressBase {
  number: number;
  /** What the controller path shows for this address, with the identity. */
  secret: Uint8Array;
  tag: Uint8Array;
  lockingBytecode: Uint8Array;
  /** The address as text, as a payer sees it. */
  address: string;
  /**
   * The same address in the CashAddress form that says it can receive tokens. It decodes to the same locking
   * bytecode; wallets that send tokens look for this form, so that tokens do not go to a wallet that does not
   * know them.
   */
  tokenAddress: string;
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
 * A locking bytecode as a CashAddress of the network: the plain form, or with `tokens` the form that says the
 * address can receive tokens. Both decode to the same locking bytecode.
 *
 * @throws for a locking bytecode that has no CashAddress
 */
export const cashAddressOf = (lockingBytecode: Uint8Array, network: XoNetwork, options: { tokens?: boolean } = {}): string => {
  const encoded = lockingBytecodeToCashAddress({ prefix: CASH_ADDRESS_PREFIX[network], bytecode: lockingBytecode, tokenSupport: options.tokens === true });
  if (typeof encoded === 'string') throw new Error(encoded);
  return encoded.address;
};

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
  const texts = (lockingBytecode: Uint8Array): { address: string; tokenAddress: string } => ({
    address: cashAddressOf(lockingBytecode, viewingKey.network),
    tokenAddress: cashAddressOf(lockingBytecode, viewingKey.network, { tokens: true }),
  });
  if (kind === ADDRESS_KIND.vault) {
    const script = vaultAddressScript(tag);
    return { kind, number, secret, tag, script, lockingBytecode: script.lockingBytecode, ...texts(script.lockingBytecode) };
  }
  const keyHash = viewingKeyHash(viewingKey, kind, number);
  const script = recoverableAddressScript(tag, keyHash);
  return { kind, number, secret, tag, keyHash, script, lockingBytecode: script.lockingBytecode, ...texts(script.lockingBytecode) };
};
