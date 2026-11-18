import {
  decodeHdPublicKey,
  deriveHdPath,
  deriveHdPrivateNodeFromSeed,
  deriveHdPublicNode,
  deriveHdPublicNodeChild,
  deriveSeedFromBip39Mnemonic,
  encodeHdPublicKey,
  hash160,
  sha256,
} from '@bitauth/libauth';

import { type AddressKind, ADDRESS_KIND } from './addresses.js';
import { type KeyPair, keyPairFromPrivateKey } from './builder.js';
import type { XoNetwork } from './xo-keys.js';

/**
 * The keys of one seed (proposal section 7.2).
 *
 * This is the key tree of the XO engine, reproduced here so that a viewing key, a recoverer's credential and
 * the blinding seed can be worked out without an engine, and so that what the engine does can be checked.
 * The engine places every key of a template at
 *
 *     m / P' / T' / 0' / n
 *
 * where `P` is 2415 on mainnet and 42415 on test networks, `T` is the template's number (see
 * `xoTemplateIndex`) and `n` counts up from 0 for the template.
 */

/** The numbers of the templates that hold a wallet's keys. They follow from the templates' content. */
export interface TemplateNumbers {
  /** The controller template: its first key is the controller key, or the recoverer's recovery key. */
  controller: number;
  /** The template of addresses given out to be paid. */
  givenOut: number;
  /** The template of change addresses and of outputs the wallet names in application transactions. */
  change: number;
  /** XO's standard single-key wallet template: the funding key, or the recoverer's fee key. */
  standardWallet: number;
}

const PURPOSE: Record<XoNetwork, number> = { mainnet: 2415, testnet: 42415 };
/** The engine's place for signing keys, the third step of every path. */
const SIGNING = 0;
/**
 * The third step of the blinding seed's path: the bytes of "blin" read as a number. It is this scheme's own
 * and lies outside the numbers XO uses at that step.
 */
export const BLINDING_BRANCH = 0x626c696e;
const HARDENED_LIMIT = 0x80000000;

/** The kinds of address that have a key. A vault address has none. */
export type KeyedAddressKind = typeof ADDRESS_KIND.givenOut | typeof ADDRESS_KIND.change;

const checkNumbers = (numbers: TemplateNumbers): void => {
  const values = [numbers.controller, numbers.givenOut, numbers.change, numbers.standardWallet];
  for (const value of values) {
    // Number 0 at that step is the engine's place for an account's own keys, not a template's.
    if (!Number.isInteger(value) || value < 1 || value >= HARDENED_LIMIT) {
      throw new Error(`A template number is a whole number from 1 to 2147483647, got ${value}.`);
    }
  }
  if (new Set(values).size !== values.length) {
    throw new Error('The four templates must have different numbers: keys of two templates with one number would share a branch.');
  }
};

const checkIndex = (index: number): number => {
  if (!Number.isInteger(index) || index < 0 || index >= HARDENED_LIMIT) {
    throw new Error(`A key number is a whole number from 0 to 2147483647, got ${index}.`);
  }
  return index;
};

/**
 * What finds every address of a seed and spends none (proposal section 7.6): the extended public keys of
 * the two address nodes, and the blinding seed.
 */
export interface ViewingKey {
  network: XoNetwork;
  /** Extended public keys in BIP32 text form: of addresses given out, and of change. */
  addressNodes: { givenOut: string; change: string };
  blindingSeed: Uint8Array;
}

/** Everything a device derives from its seed. */
export interface SeedKeys {
  network: XoNetwork;
  /** The owner entry in the controller. Used for nothing else. */
  controllerKey: KeyPair;
  /** An ordinary single-key address, used only to create the wallet. */
  fundingKey: KeyPair;
  /** The key of address `number` of a kind. */
  addressKey: (kind: KeyedAddressKind, number: number) => KeyPair;
  viewingKey: ViewingKey;
}

const nodeOf = (mnemonic: string) => deriveHdPrivateNodeFromSeed(deriveSeedFromBip39Mnemonic(mnemonic));

/** The path of key `n` of the template with number `template`. */
export const templateKeyPath = (network: XoNetwork, template: number, n: number): string =>
  `m/${PURPOSE[network]}'/${template}'/${SIGNING}'/${checkIndex(n)}`;

const addressTemplate = (numbers: TemplateNumbers, kind: KeyedAddressKind): number =>
  kind === ADDRESS_KIND.givenOut ? numbers.givenOut : numbers.change;

/**
 * Derive the keys of a seed.
 *
 * @param mnemonic - the twelve words
 * @param network - `testnet` covers chipnet and the other test networks
 * @param numbers - the numbers of the templates that hold the keys
 */
export const deriveSeedKeys = (mnemonic: string, network: XoNetwork, numbers: TemplateNumbers): SeedKeys => {
  checkNumbers(numbers);
  const master = nodeOf(mnemonic);
  const keyAt = (template: number, n: number): KeyPair => keyPairFromPrivateKey(deriveHdPath(master, templateKeyPath(network, template, n)).privateKey);
  const addressNode = (kind: KeyedAddressKind): string =>
    encodeHdPublicKey({
      network,
      node: deriveHdPublicNode(deriveHdPath(master, `m/${PURPOSE[network]}'/${addressTemplate(numbers, kind)}'/${SIGNING}'`)),
    }).hdPublicKey;
  const blindingNode = deriveHdPath(master, `m/${PURPOSE[network]}'/${numbers.givenOut}'/${BLINDING_BRANCH}'`);
  return {
    network,
    controllerKey: keyAt(numbers.controller, 0),
    fundingKey: keyAt(numbers.standardWallet, 0),
    addressKey: (kind, number) => keyAt(addressTemplate(numbers, kind), number),
    viewingKey: {
      network,
      addressNodes: { givenOut: addressNode(ADDRESS_KIND.givenOut), change: addressNode(ADDRESS_KIND.change) },
      blindingSeed: sha256.hash(blindingNode.privateKey),
    },
  };
};

/**
 * The public key of address `number` of a kind, from the viewing key alone. No private key is involved,
 * and none can be worked out from the result.
 */
export const viewingKeyPublicKey = (viewingKey: ViewingKey, kind: KeyedAddressKind, number: number): Uint8Array => {
  const text = kind === ADDRESS_KIND.givenOut ? viewingKey.addressNodes.givenOut : viewingKey.addressNodes.change;
  const decoded = decodeHdPublicKey(text);
  if (typeof decoded === 'string') throw new Error(`Not an extended public key: ${decoded}`);
  if (decoded.network !== viewingKey.network) {
    throw new Error(`The extended public key is for ${decoded.network}; the viewing key says ${viewingKey.network}.`);
  }
  return deriveHdPublicNodeChild(decoded.node, checkIndex(number)).publicKey;
};

/** The key hash of address `number` of a kind, from the viewing key alone. */
export const viewingKeyHash = (viewingKey: ViewingKey, kind: KeyedAddressKind, number: number): Uint8Array =>
  hash160(viewingKeyPublicKey(viewingKey, kind, number));

/**
 * The keys of a recoverer's credential (proposal section 9.2), from its own twelve words: the recovery key, whose
 * hash is in the controller, and the key of the fee address, where the recoverer kept coins for its fees until
 * 18 November 2026. They are at the places the owner's controller key and funding key have in the owner's tree,
 * and they differ so that the fee address cannot be computed from the controller's state.
 */
export const deriveCredentialKeys = (mnemonic: string, network: XoNetwork, numbers: TemplateNumbers): { recoveryKey: KeyPair; feeKey: KeyPair } => {
  const { controllerKey, fundingKey } = deriveSeedKeys(mnemonic, network, numbers);
  return { recoveryKey: controllerKey, feeKey: fundingKey };
};

export type { AddressKind };
