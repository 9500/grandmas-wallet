import { binToHex } from '@bitauth/libauth';
import { type TemplateNumbers, ADDRESS_KIND, deriveSeedKeys, walletAddress } from '@grandmas-wallet/core';
import { describe, expect, it } from 'vitest';

import { canonicalJson, readViewingKeyRecord, signMessage, signViewingKeyRecord, viewingKeyRecordFromText, viewingKeyRecordHash, viewingKeyRecordToText, ViewingKeyRecordError } from '../src/index.js';

const numbers: TemplateNumbers = { controller: 11, givenOut: 22, change: 33, standardWallet: 44 };
const WORDS = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const OTHER_WORDS = 'legal winner thank year wave sausage worth useful legal winner thank yellow';
const seed = deriveSeedKeys(WORDS, 'testnet', numbers);
const identity = new Uint8Array(32).fill(0x41);

describe('the viewing-key record', () => {
  it('carries the viewing key, signed by the controller key of the same seed', () => {
    const signed = signViewingKeyRecord(seed);
    const record = readViewingKeyRecord(signed, 'testnet');
    expect(record.viewingKey).toEqual(seed.viewingKey);
    expect(record.controllerPublicKey).toEqual(seed.controllerKey.publicKey);
    // Whoever reads it finds the same addresses as the seed's owner.
    for (const kind of [ADDRESS_KIND.givenOut, ADDRESS_KIND.change, ADDRESS_KIND.vault]) {
      expect(walletAddress(identity, record.viewingKey, kind, 3).address).toBe(walletAddress(identity, seed.viewingKey, kind, 3).address);
    }
    // Nothing in it depends on a wallet's identity, and it holds no private key.
    expect(signed.message).not.toContain(binToHex(seed.controllerKey.privateKey));
    expect(signed.message).not.toContain(binToHex(seed.addressKey(ADDRESS_KIND.givenOut, 0).privateKey));
  });

  it('has one hash, which names it and does not depend on the signature', () => {
    const first = signViewingKeyRecord(seed);
    const second = signViewingKeyRecord(seed);
    expect(viewingKeyRecordHash(first)).toBe(viewingKeyRecordHash(second));
    expect(readViewingKeyRecord(first, 'testnet').hash).toBe(viewingKeyRecordHash(first));
    expect(viewingKeyRecordHash(first)).toMatch(/^[0-9a-f]{64}$/);
    expect(viewingKeyRecordHash(signViewingKeyRecord(deriveSeedKeys(OTHER_WORDS, 'testnet', numbers)))).not.toBe(viewingKeyRecordHash(first));
  });

  it('goes through its text form unchanged', () => {
    const signed = signViewingKeyRecord(seed);
    const text = viewingKeyRecordToText(signed);
    expect(text).toMatch(/^gwvk1:[A-Za-z0-9_-]+$/);
    expect(viewingKeyRecordFromText(text)).toEqual(signed);
    expect(readViewingKeyRecord(viewingKeyRecordFromText(text), 'testnet').viewingKey).toEqual(seed.viewingKey);
    expect(() => viewingKeyRecordFromText('something else')).toThrow(ViewingKeyRecordError);
    expect(() => viewingKeyRecordFromText('gwvk1:not base64!')).toThrow(ViewingKeyRecordError);
  });

  it('is refused when it is altered, signed by another key, or for another network', () => {
    const signed = signViewingKeyRecord(seed);
    const other = deriveSeedKeys(OTHER_WORDS, 'testnet', numbers);
    const altered = { ...signed, message: signed.message.replace(binToHex(seed.viewingKey.blindingSeed), '00'.repeat(32)) };
    expect(() => readViewingKeyRecord(altered, 'testnet')).toThrow(/signature is not valid/);
    // Someone else's signature over this seed's record.
    expect(() => readViewingKeyRecord({ ...signed, publicKey: other.controllerKey.publicKey }, 'testnet')).toThrow(/not signed by the controller key it names/);
    // A valid signature by another key over a record that names this seed's controller key.
    const forged = signMessage('grandmas-wallet/viewing-key-record/v1', signed.message, other.controllerKey);
    expect(() => readViewingKeyRecord(forged, 'testnet')).toThrow(/not signed by the controller key it names/);
    // A signature made for another kind of message.
    const repurposed = signMessage('grandmas-wallet/something-else', signed.message, seed.controllerKey);
    expect(() => readViewingKeyRecord(repurposed, 'testnet')).toThrow(/signature is not valid/);
    expect(() => readViewingKeyRecord(signed, 'mainnet')).toThrow(/for testnet, not for mainnet/);
    expect(() => readViewingKeyRecord(signViewingKeyRecord(deriveSeedKeys(WORDS, 'mainnet', numbers)), 'testnet')).toThrow(/for mainnet, not for testnet/);
  });

  it('is refused in an unknown version, form or encoding', () => {
    const signed = signViewingKeyRecord(seed);
    const fields = JSON.parse(signed.message) as Record<string, unknown>;
    const resigned = (change: Record<string, unknown>) => signMessage('grandmas-wallet/viewing-key-record/v1', canonicalJson({ ...fields, ...change } as never), seed.controllerKey);
    expect(() => readViewingKeyRecord(resigned({ version: 2 }), 'testnet')).toThrow(/version 2 are not known/);
    expect(() => readViewingKeyRecord(resigned({ addressScheme: 2 }), 'testnet')).toThrow(/Address scheme 2 is not known/);
    expect(() => readViewingKeyRecord(resigned({ format: 'something' }), 'testnet')).toThrow(/not a viewing-key record/);
    expect(() => readViewingKeyRecord(resigned({ blindingSeed: 'abcd' }), 'testnet')).toThrow(/blinding seed is not 32 bytes/);
    expect(() => readViewingKeyRecord(resigned({ addressNodes: { givenOut: 'xpub', change: 'xpub' } }), 'testnet')).toThrow(/not an extended public key/);
    // The same fields in another order or with spaces: a record has one encoding only.
    const spaced = signMessage('grandmas-wallet/viewing-key-record/v1', JSON.stringify(fields, null, 1), seed.controllerKey);
    expect(() => readViewingKeyRecord(spaced, 'testnet')).toThrow(/canonical form/);
    expect(() => readViewingKeyRecord({ ...signed, message: 'not json' }, 'testnet')).toThrow(/cannot be read/);
  });
});
