import { base64ToBin, binToBase64, binToHex, binToUtf8, decodeHdPublicKey, hexToBin, sha256, utf8ToBin } from '@bitauth/libauth';
import { type SeedKeys, type ViewingKey, type XoNetwork, ADDRESS_SCHEME_VERSION } from '@grandmas-wallet/core';

import { type JsonValue, canonicalJson } from './canonical.js';
import { type SignedMessage, signMessage, verifyMessage } from './signing.js';

/**
 * The viewing-key record (proposal section 7.6): how a seed's viewing key is passed on.
 *
 * It holds the viewing key, the network, the version of the address scheme, and the controller public key
 * of the same seed, and it is signed with that controller key, which shows that whoever made the record
 * holds the key. Nothing in it depends on a wallet's identity, so a new device can make one before it is
 * told which wallet it is taking over. A signature shows who signed, not when (section 10.3).
 */

export const VIEWING_KEY_RECORD_FORMAT = 'grandmas-wallet/viewing-key';
export const VIEWING_KEY_RECORD_VERSION = 1;
const PURPOSE = 'grandmas-wallet/viewing-key-record/v1';
const TEXT_PREFIX = 'gwvk1:';

export class ViewingKeyRecordError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ViewingKeyRecordError';
  }
}

const fail = (message: string): never => {
  throw new ViewingKeyRecordError(message);
};

/** A viewing-key record that has been checked. */
export interface ViewingKeyRecord {
  viewingKey: ViewingKey;
  addressScheme: number;
  /** The controller key of the seed the viewing key belongs to: the key that signed the record. */
  controllerPublicKey: Uint8Array;
  /** The hash that names this record in receipts: SHA-256 of its signed text, as hex. */
  hash: string;
}

/**
 * The text of a viewing-key record: the one encoding that is signed and hashed. Whoever holds the record's
 * values can write this text again, which is how a record travels in fewer bytes than its text.
 */
export const viewingKeyRecordText = (viewingKey: ViewingKey, controllerPublicKey: Uint8Array): string => {
  const body: JsonValue = {
    format: VIEWING_KEY_RECORD_FORMAT,
    version: VIEWING_KEY_RECORD_VERSION,
    network: viewingKey.network,
    addressScheme: ADDRESS_SCHEME_VERSION,
    addressNodes: { givenOut: viewingKey.addressNodes.givenOut, change: viewingKey.addressNodes.change },
    blindingSeed: binToHex(viewingKey.blindingSeed),
    controllerPublicKey: binToHex(controllerPublicKey),
  };
  return canonicalJson(body);
};

/** Make and sign the viewing-key record of a seed. */
export const signViewingKeyRecord = (keys: Pick<SeedKeys, 'network' | 'viewingKey' | 'controllerKey'>): SignedMessage =>
  signMessage(PURPOSE, viewingKeyRecordText(keys.viewingKey, keys.controllerKey.publicKey), keys.controllerKey);

const text = (value: unknown, name: string): string => (typeof value === 'string' ? value : fail(`The record has no ${name}.`));

const extendedPublicKey = (value: unknown, name: string, network: XoNetwork): string => {
  const encoded = text(value, name);
  const decoded = decodeHdPublicKey(encoded);
  if (typeof decoded === 'string') return fail(`The record's ${name} is not an extended public key.`);
  if (decoded.network !== network) return fail(`The record's ${name} is for another network.`);
  return encoded;
};

const hexOf = (value: unknown, name: string, length: number): Uint8Array => {
  const encoded = text(value, name);
  if (!new RegExp(`^[0-9a-f]{${length * 2}}$`).test(encoded)) return fail(`The record's ${name} is not ${length} bytes of hex.`);
  return hexToBin(encoded);
};

/**
 * Check a viewing-key record and read it.
 *
 * @throws ViewingKeyRecordError if the record is not of a known form, is for another network than `network`,
 * or is not signed by the controller key it names
 */
export const readViewingKeyRecord = (signed: SignedMessage, network: XoNetwork): ViewingKeyRecord => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(signed.message);
  } catch {
    return fail('The record cannot be read.');
  }
  if (typeof parsed !== 'object' || parsed === null) return fail('The record cannot be read.');
  const fields = parsed as Record<string, unknown>;
  // Only the one encoding that signing produces is accepted, so that a record has one hash.
  if (canonicalJson(fields as JsonValue) !== signed.message) return fail('The record is not in its canonical form.');
  if (fields['format'] !== VIEWING_KEY_RECORD_FORMAT) return fail('This is not a viewing-key record.');
  if (fields['version'] !== VIEWING_KEY_RECORD_VERSION) return fail(`Viewing-key records of version ${String(fields['version'])} are not known.`);
  if (fields['addressScheme'] !== ADDRESS_SCHEME_VERSION) return fail(`Address scheme ${String(fields['addressScheme'])} is not known.`);
  if (fields['network'] !== network) return fail(`The record is for ${String(fields['network'])}, not for ${network}.`);
  const nodes = fields['addressNodes'];
  if (typeof nodes !== 'object' || nodes === null) return fail('The record has no address nodes.');
  const { givenOut, change } = nodes as Record<string, unknown>;
  const controllerPublicKey = hexOf(fields['controllerPublicKey'], 'controller public key', 33);
  if (binToHex(controllerPublicKey) !== binToHex(signed.publicKey)) return fail('The record is not signed by the controller key it names.');
  if (!verifyMessage(PURPOSE, signed)) return fail('The record\'s signature is not valid.');
  return {
    viewingKey: {
      network,
      addressNodes: {
        givenOut: extendedPublicKey(givenOut, 'node of addresses given out', network),
        change: extendedPublicKey(change, 'node of change addresses', network),
      },
      blindingSeed: hexOf(fields['blindingSeed'], 'blinding seed', 32),
    },
    addressScheme: ADDRESS_SCHEME_VERSION,
    controllerPublicKey,
    hash: viewingKeyRecordHash(signed),
  };
};

/** The hash that names a record in receipts: SHA-256 of the signed text. It does not depend on the signature. */
export const viewingKeyRecordHash = (signed: Pick<SignedMessage, 'message'>): string => binToHex(sha256.hash(utf8ToBin(signed.message)));

// Base64 with the two characters that are not safe in a link replaced, and without padding.
const toBase64Url = (bytes: Uint8Array): string => binToBase64(bytes).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
const fromBase64Url = (encoded: string): Uint8Array => {
  if (!/^[A-Za-z0-9_-]*$/.test(encoded)) return fail('The record cannot be read.');
  const standard = encoded.replaceAll('-', '+').replaceAll('_', '/');
  return base64ToBin(standard + '='.repeat((4 - (standard.length % 4)) % 4));
};

/** A record as one line of text, for a message, a file or a code. */
export const viewingKeyRecordToText = (signed: SignedMessage): string =>
  TEXT_PREFIX + toBase64Url(utf8ToBin(JSON.stringify({ message: signed.message, publicKey: binToHex(signed.publicKey), signature: binToHex(signed.signature) })));

/** Read a record from its text form. The record still has to be checked with {@link readViewingKeyRecord}. */
export const viewingKeyRecordFromText = (encoded: string): SignedMessage => {
  if (!encoded.startsWith(TEXT_PREFIX)) return fail('This is not a viewing-key record.');
  try {
    const parsed = JSON.parse(binToUtf8(fromBase64Url(encoded.slice(TEXT_PREFIX.length)))) as Record<string, unknown>;
    return { message: text(parsed['message'], 'text'), publicKey: hexToBin(text(parsed['publicKey'], 'public key')), signature: hexToBin(text(parsed['signature'], 'signature')) };
  } catch (error) {
    if (error instanceof ViewingKeyRecordError) throw error;
    return fail('The record cannot be read.');
  }
};
