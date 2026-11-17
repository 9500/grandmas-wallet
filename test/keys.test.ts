import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  bigIntToBinUint256BEClamped,
  binToBigIntUint256BE,
  binToHex,
  decodeHdPublicKey,
  deriveHdPath,
  deriveHdPrivateNodeFromSeed,
  deriveSeedFromBip39Mnemonic,
  flattenBinArray,
  hash160,
  hash256,
  hexToBin,
  hmacSha512,
  secp256k1,
  sha256,
} from '@bitauth/libauth';
import {
  type TemplateNumbers,
  ADDRESS_KIND,
  ADDRESS_SCHEME_VERSION,
  BLINDING_BRANCH,
  addressSecret,
  addressTag,
  deriveCredentialKeys,
  deriveSeedKeys,
  deriveXoTemplateKey,
  templateKeyPath,
  viewingKeyPublicKey,
  walletAddress,
  xoTemplateIndex,
} from '@grandmas-wallet/core';
import { describe, expect, it } from 'vitest';

/**
 * Acceptance tests KV05 and KV07 of the proposal: the keys of a seed.
 */

const WORDS = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const numbers: TemplateNumbers = { controller: 11, givenOut: 22, change: 33, standardWallet: 44 };
const identity = hexToBin('4111cd75889c049062892a4e3907b20a0ffe758d9bd95313e15fd5349e82507a');
const fixture = (name: string): string => fileURLToPath(new URL(`./vectors/${name}`, import.meta.url));

/** The order of the secp256k1 group. */
const ORDER = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;

/**
 * BIP32: from an extended public key and the private key of one of its plain children, the parent's
 * private key follows, and with it every other child's.
 */
const parentPrivateKey = (extendedPublicKey: string, childNumber: number, childPrivateKey: Uint8Array): Uint8Array => {
  const decoded = decodeHdPublicKey(extendedPublicKey);
  if (typeof decoded === 'string') throw new Error(decoded);
  const { node } = decoded;
  const index = Uint8Array.of(childNumber >>> 24, (childNumber >> 16) & 0xff, (childNumber >> 8) & 0xff, childNumber & 0xff);
  const left = hmacSha512(node.chainCode, flattenBinArray([node.publicKey, index])).slice(0, 32);
  return bigIntToBinUint256BEClamped((binToBigIntUint256BE(childPrivateKey) - binToBigIntUint256BE(left) + ORDER) % ORDER);
};
const childPrivateKey = (extendedPublicKey: string, parent: Uint8Array, childNumber: number): Uint8Array => {
  const decoded = decodeHdPublicKey(extendedPublicKey);
  if (typeof decoded === 'string') throw new Error(decoded);
  const index = Uint8Array.of(childNumber >>> 24, (childNumber >> 16) & 0xff, (childNumber >> 8) & 0xff, childNumber & 0xff);
  const left = hmacSha512(decoded.node.chainCode, flattenBinArray([decoded.node.publicKey, index])).slice(0, 32);
  return bigIntToBinUint256BEClamped((binToBigIntUint256BE(parent) + binToBigIntUint256BE(left)) % ORDER);
};

describe('the keys of a seed', () => {
  const keys = deriveSeedKeys(WORDS, 'testnet', numbers);

  it('KV07: the wallet\'s own derivation gives the keys the XO engine makes', () => {
    const recorded = JSON.parse(readFileSync(fixture('engine-keys.json'), 'utf8')) as {
      mnemonic: string;
      network: 'testnet';
      templates: { templateIdentifier: string; keys: { number: number; publicKey: string; keyHash: string }[] }[];
    };
    const [controllerTemplate, addressTemplate] = recorded.templates;
    if (controllerTemplate === undefined || addressTemplate === undefined) throw new Error('vectors missing');
    for (const template of recorded.templates) {
      expect(template.keys.length).toBeGreaterThan(0);
      for (const key of template.keys) {
        expect(binToHex(deriveXoTemplateKey(recorded.mnemonic, template.templateIdentifier, key.number, recorded.network).publicKey)).toBe(key.publicKey);
      }
    }
    // The same through the seed's keys, with the engine's templates in the places of the controller and of addresses given out.
    const asEngine = deriveSeedKeys(recorded.mnemonic, recorded.network, {
      controller: xoTemplateIndex(controllerTemplate.templateIdentifier),
      givenOut: xoTemplateIndex(addressTemplate.templateIdentifier),
      change: 7,
      standardWallet: 8,
    });
    expect(binToHex(asEngine.controllerKey.publicKey)).toBe(controllerTemplate.keys[0]?.publicKey);
    for (const key of addressTemplate.keys) {
      expect(binToHex(asEngine.addressKey(ADDRESS_KIND.givenOut, key.number).publicKey)).toBe(key.publicKey);
      // And from the viewing key alone, with no private key.
      expect(binToHex(viewingKeyPublicKey(asEngine.viewingKey, ADDRESS_KIND.givenOut, key.number))).toBe(key.publicKey);
      expect(binToHex(hash160(viewingKeyPublicKey(asEngine.viewingKey, ADDRESS_KIND.givenOut, key.number)))).toBe(key.keyHash);
    }
  });

  it('KV07: the paths are as specified', () => {
    const master = deriveHdPrivateNodeFromSeed(deriveSeedFromBip39Mnemonic(WORDS));
    const publicKeyAt = (path: string): string => binToHex(secp256k1.derivePublicKeyCompressed(deriveHdPath(master, path).privateKey) as Uint8Array);
    expect(templateKeyPath('testnet', 22, 5)).toBe("m/42415'/22'/0'/5");
    expect(templateKeyPath('mainnet', 22, 5)).toBe("m/2415'/22'/0'/5");
    expect(binToHex(keys.controllerKey.publicKey)).toBe(publicKeyAt("m/42415'/11'/0'/0"));
    expect(binToHex(keys.fundingKey.publicKey)).toBe(publicKeyAt("m/42415'/44'/0'/0"));
    expect(binToHex(keys.addressKey(ADDRESS_KIND.givenOut, 3).publicKey)).toBe(publicKeyAt("m/42415'/22'/0'/3"));
    expect(binToHex(keys.addressKey(ADDRESS_KIND.change, 3).publicKey)).toBe(publicKeyAt("m/42415'/33'/0'/3"));
    expect(binToHex(keys.viewingKey.blindingSeed)).toBe(binToHex(sha256.hash(deriveHdPath(master, `m/42415'/22'/${BLINDING_BRANCH}'`).privateKey)));
    expect(BLINDING_BRANCH).toBe(1_651_272_046);
    // Keys differ between networks, and a credential's keys are at the places of the controller key and the funding key.
    expect(binToHex(deriveSeedKeys(WORDS, 'mainnet', numbers).controllerKey.publicKey)).toBe(publicKeyAt("m/2415'/11'/0'/0"));
    const credential = deriveCredentialKeys(WORDS, 'testnet', numbers);
    expect(binToHex(credential.recoveryKey.publicKey)).toBe(publicKeyAt("m/42415'/11'/0'/0"));
    expect(binToHex(credential.feeKey.publicKey)).toBe(publicKeyAt("m/42415'/44'/0'/0"));
    expect(credential.recoveryKey.keyHash).not.toEqual(credential.feeKey.keyHash);
  });

  it('KV07: an extended public key with one address private key gives every key of that kind, and no other', () => {
    const node = keys.viewingKey.addressNodes.givenOut;
    const leaked = keys.addressKey(ADDRESS_KIND.givenOut, 7);
    const parent = parentPrivateKey(node, 7, leaked.privateKey);
    // Every other address key given out follows.
    for (const number of [0, 1, 8, 500, 9_999]) {
      expect(binToHex(childPrivateKey(node, parent, number))).toBe(binToHex(keys.addressKey(ADDRESS_KIND.givenOut, number).privateKey));
    }
    // The change keys are children of another node: neither this parent nor the other extended public key with it gives them.
    const changeNode = keys.viewingKey.addressNodes.change;
    for (const number of [0, 1, 7]) {
      const change = binToHex(keys.addressKey(ADDRESS_KIND.change, number).privateKey);
      expect(binToHex(childPrivateKey(node, parent, number))).not.toBe(change);
      expect(binToHex(childPrivateKey(changeNode, parent, number))).not.toBe(change);
    }
    // The controller key is not a child of either address node.
    const controller = binToHex(keys.controllerKey.privateKey);
    expect(binToHex(parent)).not.toBe(controller);
    for (let number = 0; number < 50; number++) {
      expect(binToHex(childPrivateKey(node, parent, number))).not.toBe(controller);
    }
  });

  it('refuses template numbers that would put two kinds of key on one branch', () => {
    expect(() => deriveSeedKeys(WORDS, 'testnet', { ...numbers, change: numbers.givenOut })).toThrow(/different numbers/);
    expect(() => deriveSeedKeys(WORDS, 'testnet', { ...numbers, controller: 0 })).toThrow(/from 1 to/);
    expect(() => keys.addressKey(ADDRESS_KIND.givenOut, -1)).toThrow(/key number/);
  });
});

describe('test vectors', () => {
  interface Vectors {
    description: string;
    addressSchemeVersion: number;
    words: string;
    network: 'testnet' | 'mainnet';
    templateNumbers: TemplateNumbers;
    identity: string;
    controllerPublicKey: string;
    fundingPublicKey: string;
    viewingKey: { givenOut: string; change: string; blindingSeed: string };
    addresses: { kind: number; number: number; path?: string; publicKey?: string; keyHash?: string; secret: string; tag: string; lockingBytecode: string; address: string }[];
  }

  const compute = (network: 'testnet' | 'mainnet'): Vectors => {
    const seed = deriveSeedKeys(WORDS, network, numbers);
    const addresses: Vectors['addresses'] = [];
    for (const kind of [ADDRESS_KIND.givenOut, ADDRESS_KIND.change, ADDRESS_KIND.vault]) {
      for (const number of [0, 1, 2, 19, 999]) {
        const address = walletAddress(identity, seed.viewingKey, kind, number);
        addresses.push({
          kind,
          number,
          ...(address.kind === ADDRESS_KIND.vault
            ? {}
            : {
                path: templateKeyPath(network, kind === ADDRESS_KIND.givenOut ? numbers.givenOut : numbers.change, number),
                publicKey: binToHex(viewingKeyPublicKey(seed.viewingKey, address.kind, number)),
                keyHash: binToHex(address.keyHash),
              }),
          secret: binToHex(address.secret),
          tag: binToHex(address.tag),
          lockingBytecode: binToHex(address.lockingBytecode),
          address: address.address,
        });
      }
    }
    return {
      description: 'Test vectors of the address scheme: from twelve words, a network, the numbers of the templates and an identity to keys, secrets, tags and addresses. The template numbers are examples; a wallet uses those of its templates.',
      addressSchemeVersion: ADDRESS_SCHEME_VERSION,
      words: WORDS,
      network,
      templateNumbers: numbers,
      identity: binToHex(identity),
      controllerPublicKey: binToHex(seed.controllerKey.publicKey),
      fundingPublicKey: binToHex(seed.fundingKey.publicKey),
      viewingKey: { ...seed.viewingKey.addressNodes, blindingSeed: binToHex(seed.viewingKey.blindingSeed) },
      addresses,
    };
  };

  it.each(['testnet', 'mainnet'] as const)('KV05: words, numbers and identity give the recorded keys, secrets, tags and addresses (%s)', (network) => {
    const path = fixture(`address-scheme-v1-${network}.json`);
    const computed = compute(network);
    // The vectors are written once, with UPDATE_VECTORS=1, and never again: a change to them is a change of the scheme.
    if (process.env['UPDATE_VECTORS'] === '1' && !existsSync(path)) writeFileSync(path, `${JSON.stringify(computed, null, 1)}\n`);
    expect(computed).toEqual(JSON.parse(readFileSync(path, 'utf8')));
  });

  it('KV05: one vector worked out step by step, without the library', () => {
    const recorded = JSON.parse(readFileSync(fixture('address-scheme-v1-testnet.json'), 'utf8')) as Vectors;
    const vector = recorded.addresses.find((entry) => entry.kind === 1 && entry.number === 2);
    if (vector?.publicKey === undefined) throw new Error('vector missing');
    const master = deriveHdPrivateNodeFromSeed(deriveSeedFromBip39Mnemonic(recorded.words));
    const publicKey = secp256k1.derivePublicKeyCompressed(deriveHdPath(master, "m/42415'/33'/0'/2").privateKey) as Uint8Array;
    expect(binToHex(publicKey)).toBe(vector.publicKey);
    const blindingSeed = sha256.hash(deriveHdPath(master, "m/42415'/22'/1651272046'").privateKey);
    // secret = hash256(blinding seed ‖ kind ‖ number, four bytes, little-endian)
    const secret = hash256(flattenBinArray([blindingSeed, Uint8Array.of(1), Uint8Array.of(2, 0, 0, 0)]));
    expect(binToHex(secret)).toBe(vector.secret);
    // tag = hash256(identity as scripts see it ‖ secret)
    const tag = hash256(flattenBinArray([hexToBin(recorded.identity).reverse(), secret]));
    expect(binToHex(tag)).toBe(vector.tag);
    expect(binToHex(addressSecret(blindingSeed, 1, 2))).toBe(vector.secret);
    expect(binToHex(addressTag(hexToBin(recorded.identity), secret))).toBe(vector.tag);
    // The script: the key hash, the tag, then the rules; the address is its hash.
    expect(vector.lockingBytecode).toMatch(/^aa20[0-9a-f]{64}87$/);
    expect(vector.address.startsWith('bchtest:p')).toBe(true);
  });
});
