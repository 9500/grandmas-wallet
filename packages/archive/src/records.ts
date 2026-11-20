import { binToHex, binToUtf8, hash160, hexToBin, sha256, utf8ToBin } from '@bitauth/libauth';
import type { KeyPair, XoNetwork } from '@grandmas-wallet/core';

import { type JsonValue, canonicalBytes, canonicalJson } from './canonical.js';
import { type SignedMessage, signMessage, verifyMessage } from './signing.js';

/**
 * The records of a backup archive (proposal section 10.2), besides the viewing-key record and the receipt,
 * which have files of their own: templates, token notes, position records and labels.
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
 * order of its fields, and a registry or the application's site may not exist later. A record of the second
 * design may also hold the recovery declaration that came with the template; it stays in the signed text and is
 * not read.
 */
export interface TemplateEntry {
  kind: 'template';
  /** The identifier the XO engine gives the template. */
  identifier: string;
  contentHash: string;
  text: string;
  /**
   * How many times the user had stopped trusting the template before this record was written. Absent for
   * none. A withdrawal does not reach a record with a higher number: that is how trust given again is told
   * from the trust that was withdrawn, without a date.
   */
  renewal?: number;
}

/**
 * The user stopped trusting a template. The template's record stays in the archive, as a suggestion: a
 * position made with it can then still be operated once it is trusted again. Without this record, reading
 * the archive would trust the template again.
 */
export interface TemplateWithdrawalEntry {
  kind: 'template-withdrawal';
  identifier: string;
  contentHash: string;
  /** Template records of the same signer with this number or a lower one are withdrawn. */
  renewal: number;
}

/**
 * Which template made a token, as the second design noted it when an action created one. No longer written; read as
 * a hint of which template to show for the token (section 10.4).
 */
export interface TokenNoteEntry {
  kind: 'token-note';
  /** Token category, in the byte order shown by explorers. */
  category: string;
  templateIdentifier: string;
}

/** A name the user gave to something. */
export interface LabelEntry {
  kind: 'label';
  /** What is named: an address, a token category, a transaction. */
  subject: string;
  name: string;
}

/** The NFT a position belongs to, as it was when the record was written: compared whole, never by category alone. */
export interface PositionToken {
  /** Token category, in the byte order shown by explorers. */
  category: string;
  /** The NFT's commitment at that time, as hex; empty for none. */
  commitment: string;
  capability: 'none' | 'mutable' | 'minting';
}

/**
 * A position an action of an application left (proposal section 10.2): the wallet's own copy of what the
 * XO engine learns of a script when it builds the action, made from the transaction the wallet worked out,
 * before anything is signed. It is a hint, never an authority: it counts only once the chain bears it out
 * (section 10.4), and a record of an earlier seed is a suggestion.
 *
 * The script is named by the engine's own field names. A record names no script for a token of an
 * application whose scripts the wallet does not follow: it then only ties the token to the template. Values
 * are kept as the engine keeps them: text, whole numbers in decimal, bytes as hex. A record never holds a
 * locking script of the wallet's, a key or a secret.
 */
export interface PositionRecordEntry {
  kind: 'position';
  /**
   * Written in every record of this version: a record is due only where a token of the wallet's takes part.
   * Absent in some records an earlier build wrote; such a record is read, and never counts.
   */
  token?: PositionToken;
  templateIdentifier: string;
  /** The script the position is at. Present together with `roleIdentifier` and `variables`, or not at all. */
  lockingScriptIdentifier?: string;
  /** The wallet's role on the script. */
  roleIdentifier?: string;
  /** The values the script was made with: what the engine needs to follow it again. */
  variables?: Record<string, string>;
  /** The other values of the action that made the position, kept apart from the script's. */
  values: Record<string, string>;
  /** The address of the application's page, where the request came from one. */
  applicationPage?: string;
}

export type RecordEntry = TemplateEntry | TemplateWithdrawalEntry | TokenNoteEntry | LabelEntry | PositionRecordEntry;

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
export const templateEntry = (identifier: string, text: string, renewal = 0): TemplateEntry => ({
  kind: 'template',
  identifier,
  ...named(text),
  ...(renewal === 0 ? {} : { renewal }),
});

/** Sign a record with the controller key of the seed that writes it. */
export const signRecord = (entry: RecordEntry, wallet: { network: XoNetwork; identity: string }, key: KeyPair): SignedMessage =>
  signMessage(RECORD_PURPOSE, canonicalJson({ format: RECORD_FORMAT, version: RECORD_VERSION, network: wallet.network, identity: wallet.identity, entry: entry as unknown as JsonValue }), key);

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isHash = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const text = (value: unknown, name: string): string => (typeof value === 'string' && value !== '' ? value : fail(`The record has no ${name}.`));

const count = (value: unknown, what: string): number => (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < 1_000_000 ? value : fail(`The record's ${what} is not a count.`));

const namedText = (value: unknown, what: string): NamedText => {
  if (!isObject(value) || typeof value['text'] !== 'string' || !isHash(value['contentHash'])) return fail(`The record's ${what} is not a text with its hash.`);
  if (contentHashOf(value['text']) !== value['contentHash']) return fail(`The record's ${what} is not the text its hash names.`);
  return { contentHash: value['contentHash'], text: value['text'] };
};

/** A name of the template's: of a locking script, a role or a variable. */
const isName = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z_][A-Za-z0-9_.-]{0,99}$/.test(value);
const MOST_VALUES = 200;
const LONGEST_VALUE = 20_000;

const valueMap = (value: unknown, what: string): Record<string, string> => {
  if (!isObject(value)) return fail(`The position record's ${what} are not a list of named values.`);
  const entries = Object.entries(value);
  if (entries.length > MOST_VALUES) return fail(`The position record has too many ${what}.`);
  for (const [name, held] of entries) {
    if (!isName(name)) return fail(`The position record's ${what} have a name the template cannot have.`);
    if (typeof held !== 'string' || held.length > LONGEST_VALUE) return fail(`The position record's value "${name}" is not a text.`);
  }
  return Object.fromEntries(entries) as Record<string, string>;
};

const positionToken = (value: unknown): PositionToken => {
  if (!isObject(value)) return fail('The position record\'s token is not a token.');
  const { category, commitment, capability } = value;
  if (!isHash(category)) return fail('The position record\'s token has no category.');
  if (typeof commitment !== 'string' || !/^([0-9a-f]{2}){0,128}$/.test(commitment)) return fail('The position record\'s token has no commitment.');
  if (capability !== 'none' && capability !== 'mutable' && capability !== 'minting') return fail('The position record\'s token has no capability.');
  return { category, commitment, capability };
};

const pageAddress = (value: unknown): string => {
  if (typeof value !== 'string' || value.length > 2_000) return fail('The position record\'s page is not an address.');
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return fail('The position record\'s page is not an address.');
  }
  return url.protocol === 'https:' || url.protocol === 'http:' ? value : fail('The position record\'s page is not the address of a web page.');
};

const POSITION_FIELDS = new Set(['kind', 'token', 'templateIdentifier', 'lockingScriptIdentifier', 'roleIdentifier', 'variables', 'values', 'applicationPage']);

const positionEntryOf = (value: Record<string, unknown>): PositionRecordEntry => {
  const unknown = Object.keys(value).find((field) => !POSITION_FIELDS.has(field));
  if (unknown !== undefined) return fail(`The position record has a field "${unknown}" this version does not know.`);
  const script = [value['lockingScriptIdentifier'], value['roleIdentifier'], value['variables']];
  if (script.some((field) => field === undefined) && script.some((field) => field !== undefined)) {
    return fail('The position record names part of a script: its locking script, role and values go together.');
  }
  const names = script[0] === undefined ? undefined : { lockingScriptIdentifier: script[0], roleIdentifier: script[1] };
  if (names !== undefined && (!isName(names.lockingScriptIdentifier) || !isName(names.roleIdentifier))) return fail('The position record names its script or role in a form a template cannot have.');
  const variables = script[2] === undefined ? undefined : valueMap(script[2], 'script values');
  const values = valueMap(value['values'], 'other values');
  if (variables !== undefined && Object.keys(values).some((name) => name in variables)) return fail('The position record gives a value both as one of the script\'s and as another.');
  const token = value['token'] === undefined ? undefined : positionToken(value['token']);
  if (token === undefined && names === undefined) return fail('The position record names neither a token nor a script.');
  return {
    kind: 'position',
    ...(token === undefined ? {} : { token }),
    templateIdentifier: isHash(value['templateIdentifier']) ? value['templateIdentifier'] : fail('The position record names no template.'),
    ...(names === undefined ? {} : { lockingScriptIdentifier: names.lockingScriptIdentifier as string, roleIdentifier: names.roleIdentifier as string, variables: variables as Record<string, string> }),
    values,
    ...(value['applicationPage'] === undefined ? {} : { applicationPage: pageAddress(value['applicationPage']) }),
  };
};

/**
 * A position record, checked as a reader checks it: what is written is what can be read back.
 * @throws RecordError
 */
export const positionEntry = (fields: { [Field in keyof Omit<PositionRecordEntry, 'kind'>]: Omit<PositionRecordEntry, 'kind'>[Field] | undefined } & Pick<PositionRecordEntry, 'templateIdentifier' | 'values'>): PositionRecordEntry => {
  // Fields left undefined are left out: the record has one encoding.
  const defined = Object.fromEntries(Object.entries(fields).filter(([, field]) => field !== undefined));
  return positionEntryOf(defined);
};

const parseEntry = (value: unknown): RecordEntry => {
  if (!isObject(value)) return fail('The record has no entry.');
  switch (value['kind']) {
    case 'position':
      return positionEntryOf(value);
    case 'template': {
      // Whatever a record of the second design holds beside the template stays in its signed text, unread.
      const whole = namedText(value, 'template');
      return {
        kind: 'template',
        identifier: isHash(value['identifier']) ? value['identifier'] : fail('The template record has no identifier.'),
        ...whole,
        ...(value['renewal'] === undefined ? {} : { renewal: count(value['renewal'], 'renewal') }),
      };
    }
    case 'template-withdrawal':
      return {
        kind: 'template-withdrawal',
        identifier: isHash(value['identifier']) ? value['identifier'] : fail('The withdrawal names no template.'),
        contentHash: isHash(value['contentHash']) ? value['contentHash'] : fail('The withdrawal names no template text.'),
        renewal: count(value['renewal'], 'renewal'),
      };
    case 'token-note':
      return {
        kind: 'token-note',
        category: isHash(value['category']) ? value['category'] : fail('The token note names no token category.'),
        templateIdentifier: isHash(value['templateIdentifier']) ? value['templateIdentifier'] : fail('The token note names no template.'),
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

/**
 * What a record says, read for its form alone: neither its signature nor its wallet is checked. For copying
 * a record and deciding whether to, never for relying on it.
 */
export const peekRecordEntry = (signed: SignedMessage): RecordEntry | undefined => {
  try {
    const parsed: unknown = JSON.parse(signed.message);
    return isObject(parsed) ? parseEntry(parsed['entry']) : undefined;
  } catch {
    return undefined;
  }
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
