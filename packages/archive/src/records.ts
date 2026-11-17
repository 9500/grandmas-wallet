import { binToHex, binToUtf8, hash160, hexToBin, sha256, utf8ToBin } from '@bitauth/libauth';
import type { KeyPair, XoNetwork } from '@grandmas-wallet/core';

import { type JsonValue, canonicalBytes, canonicalJson } from './canonical.js';
import { type SignedMessage, signMessage, verifyMessage } from './signing.js';

/**
 * The records of a backup archive (proposal section 10.2), besides the viewing-key record and the receipt,
 * which have files of their own: templates, token notes and labels.
 *
 * Each record is signed by the controller key of the seed that wrote it. The content key that seals a
 * record lets its holder read, and the recoverer and a lost phone hold it too, so it cannot be what makes
 * a record genuine: a reader accepts a record only if the controller's history shows the signing key as an
 * owner (section 10.3). A record is a hint, never an authority (section 10.4).
 */

export const RECORD_FORMAT = 'grandmas-wallet/record';
export const RECORD_VERSION = 1;
const RECORD_PURPOSE = 'grandmas-wallet/record/v1';

export class RecordError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RecordError';
  }
}

const fail = (message: string): never => {
  throw new RecordError(message);
};

/** A text kept whole, named by the hash of its bytes. */
export interface NamedText {
  /** SHA-256 of the text as it arrived, as hex. */
  contentHash: string;
  text: string;
}

/**
 * A template the user trusted, kept whole and as the text it arrived in: its identifier depends on the
 * order of its fields, and a registry or the application's site may not exist later.
 */
export interface TemplateEntry {
  kind: 'template';
  /** The identifier the XO engine gives the template. */
  identifier: string;
  contentHash: string;
  text: string;
  /** The recovery declaration that came with the template (section 13.3). */
  declaration?: NamedText;
  /** Anything else the template or its declaration refers to. */
  references?: NamedText[];
}

/** Which template made a token, and which authority entry of its declaration the token stands for. */
export interface TokenNoteEntry {
  kind: 'token-note';
  /** Token category, in the byte order shown by explorers. */
  category: string;
  templateIdentifier: string;
  authority: string;
}

/** A name the user gave to something. */
export interface LabelEntry {
  kind: 'label';
  /** What is named: an address, a token category, a transaction. */
  subject: string;
  name: string;
}

export type RecordEntry = TemplateEntry | TokenNoteEntry | LabelEntry;

/** A record as it was read: checked for form and signature, not yet for who signed it. */
export interface ArchiveRecord {
  network: XoNetwork;
  /** Wallet identity, in the byte order shown by explorers. */
  identity: string;
  entry: RecordEntry;
  /** hash160 of the key that signed the record, as hex. */
  signerKeyHash: string;
  /** SHA-256 of the signed text: the record's name. */
  hash: string;
}

export const contentHashOf = (text: string): string => binToHex(sha256.hash(utf8ToBin(text)));

const named = (text: string): NamedText => ({ contentHash: contentHashOf(text), text });

/** A template record for a template as the text it arrived in. */
export const templateEntry = (identifier: string, text: string, declaration?: string, references: string[] = []): TemplateEntry => ({
  kind: 'template',
  identifier,
  ...named(text),
  ...(declaration === undefined ? {} : { declaration: named(declaration) }),
  ...(references.length === 0 ? {} : { references: references.map(named) }),
});

/** Sign a record with the controller key of the seed that writes it. */
export const signRecord = (entry: RecordEntry, wallet: { network: XoNetwork; identity: string }, key: KeyPair): SignedMessage =>
  signMessage(RECORD_PURPOSE, canonicalJson({ format: RECORD_FORMAT, version: RECORD_VERSION, network: wallet.network, identity: wallet.identity, entry: entry as unknown as JsonValue }), key);

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isHash = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const text = (value: unknown, name: string): string => (typeof value === 'string' && value !== '' ? value : fail(`The record has no ${name}.`));

const namedText = (value: unknown, what: string): NamedText => {
  if (!isObject(value) || typeof value['text'] !== 'string' || !isHash(value['contentHash'])) return fail(`The record's ${what} is not a text with its hash.`);
  if (contentHashOf(value['text']) !== value['contentHash']) return fail(`The record's ${what} is not the text its hash names.`);
  return { contentHash: value['contentHash'], text: value['text'] };
};

const parseEntry = (value: unknown): RecordEntry => {
  if (!isObject(value)) return fail('The record has no entry.');
  switch (value['kind']) {
    case 'template': {
      const whole = namedText(value, 'template');
      return {
        kind: 'template',
        identifier: isHash(value['identifier']) ? value['identifier'] : fail('The template record has no identifier.'),
        ...whole,
        ...(value['declaration'] === undefined ? {} : { declaration: namedText(value['declaration'], 'declaration') }),
        ...(value['references'] === undefined ? {} : { references: Array.isArray(value['references']) ? value['references'].map((entry) => namedText(entry, 'reference')) : fail('The template record\'s references are not a list.') }),
      };
    }
    case 'token-note':
      return {
        kind: 'token-note',
        category: isHash(value['category']) ? value['category'] : fail('The token note names no token category.'),
        templateIdentifier: isHash(value['templateIdentifier']) ? value['templateIdentifier'] : fail('The token note names no template.'),
        authority: text(value['authority'], 'authority entry'),
      };
    case 'label':
      return { kind: 'label', subject: text(value['subject'], 'subject'), name: text(value['name'], 'name') };
    default:
      return fail(`Records of kind "${String(value['kind'])}" are not known.`);
  }
};

/**
 * Read a record: its form, its one encoding and its signature. Whether the signing key has ever owned the
 * wallet is a question for the chain, answered when an archive is assessed.
 *
 * @throws RecordError
 */
export const readRecord = (signed: SignedMessage, network: XoNetwork): ArchiveRecord => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(signed.message);
  } catch {
    return fail('The record cannot be read.');
  }
  if (!isObject(parsed) || canonicalJson(parsed as JsonValue) !== signed.message) return fail('The record is not in its canonical form.');
  if (parsed['format'] !== RECORD_FORMAT) return fail('This is not a backup record.');
  if (parsed['version'] !== RECORD_VERSION) return fail(`Backup records of version ${String(parsed['version'])} are not known.`);
  if (parsed['network'] !== network) return fail(`The record is for ${String(parsed['network'])}, not for ${network}.`);
  if (!isHash(parsed['identity'])) return fail('The record names no wallet.');
  const entry = parseEntry(parsed['entry']);
  if (!verifyMessage(RECORD_PURPOSE, signed)) return fail('The record\'s signature is not valid.');
  return { network, identity: parsed['identity'], entry, signerKeyHash: binToHex(hash160(signed.publicKey)), hash: contentHashOf(signed.message) };
};

/** What a sealed blob holds: a signed text of one of three kinds. */
export interface Blob {
  type: 'record' | 'viewing-key' | 'receipt';
  signed: SignedMessage;
}

export const encodeBlob = (blob: Blob): Uint8Array =>
  canonicalBytes({ type: blob.type, message: blob.signed.message, publicKey: binToHex(blob.signed.publicKey), signature: binToHex(blob.signed.signature) });

/** @throws RecordError if the bytes are not a blob this version can read */
export const decodeBlob = (plaintext: Uint8Array): Blob => {
  let value: unknown;
  try {
    value = JSON.parse(binToUtf8(plaintext));
  } catch {
    return fail('The blob is not readable.');
  }
  if (!isObject(value)) return fail('The blob is not readable.');
  const { type, message, publicKey, signature } = value;
  if (type !== 'record' && type !== 'viewing-key' && type !== 'receipt') return fail(`Blobs of type "${String(type)}" are not known.`);
  if (typeof message !== 'string' || typeof publicKey !== 'string' || !/^[0-9a-f]{66}$/.test(publicKey) || typeof signature !== 'string' || !/^[0-9a-f]{128}$/.test(signature)) {
    return fail('The blob does not hold a signed text.');
  }
  return { type, signed: { message, publicKey: hexToBin(publicKey), signature: hexToBin(signature) } };
};
