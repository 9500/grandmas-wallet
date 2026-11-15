import {
  binToNumberUint32LE,
  deriveHdPath,
  deriveHdPrivateNodeFromSeed,
  deriveSeedFromBip39Mnemonic,
  hexToBin,
} from '@bitauth/libauth';

import { type KeyPair, keyPairFromPrivateKey } from './builder.js';

/**
 * Keys as the XO engine derives them.
 *
 * The engine derives a template's keys from the account mnemonic at
 * `m/{purpose}'/{template index}'/0'/{key index}`, where the purpose is 2415
 * on mainnet and 42415 on test networks, and the template index is the first
 * four bytes of the template identifier read as a little-endian number and
 * reduced to 31 bits.
 *
 * Deriving the same keys here lets the owner compute the recoverer's public
 * key from the recovery mnemonic it generated, without running a second
 * engine, and lets a wallet created through XO be handled by this library.
 */

export type XoNetwork = 'mainnet' | 'testnet';

const PURPOSE: Record<XoNetwork, number> = { mainnet: 2415, testnet: 42415 };
const SIGNING_AND_SPENDING = 0;
const INDEX_LIMIT = 0x80000000;

/** The hardened child index the engine uses for a template. */
export const xoTemplateIndex = (templateIdentifier: string): number => {
  if (!/^[0-9a-f]{64}$/.test(templateIdentifier)) {
    throw new Error('A template identifier is 64 lowercase hex characters.');
  }
  return binToNumberUint32LE(hexToBin(templateIdentifier).slice(0, 4)) & (INDEX_LIMIT - 1);
};

/** The derivation path of a template key. */
export const xoTemplateKeyPath = (templateIdentifier: string, keyIndex: number, network: XoNetwork): string => {
  if (!Number.isInteger(keyIndex) || keyIndex < 0 || keyIndex >= INDEX_LIMIT) {
    throw new Error('A key index is an integer from 0 to 2147483647.');
  }
  return `m/${PURPOSE[network]}'/${xoTemplateIndex(templateIdentifier)}'/${SIGNING_AND_SPENDING}'/${keyIndex}`;
};

/**
 * The key an XO account derives for a template.
 *
 * @param mnemonic - the account's BIP39 mnemonic
 * @param templateIdentifier - identifier of the template the key is used with
 * @param keyIndex - 0 for the first key the account generates under that template
 * @param network - `testnet` covers chipnet and the other test networks
 */
export const deriveXoTemplateKey = (
  mnemonic: string,
  templateIdentifier: string,
  keyIndex: number,
  network: XoNetwork,
): KeyPair => {
  const master = deriveHdPrivateNodeFromSeed(deriveSeedFromBip39Mnemonic(mnemonic));
  const node = deriveHdPath(master, xoTemplateKeyPath(templateIdentifier, keyIndex, network));
  if (typeof node === 'string') {
    throw new Error(`Key derivation failed: ${node}`);
  }
  return keyPairFromPrivateKey(node.privateKey);
};
