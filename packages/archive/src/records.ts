import { binToHex, binToUtf8, hexToBin, sha256 } from '@bitauth/libauth';
import type { KeyPair } from '@grandmas-wallet/core';

import { type JsonValue, canonicalBytes, canonicalJson } from './canonical.js';
import { type SignedMessage, signMessage, verifyMessage } from './signing.js';

/**
 * What an archive holds.
 *
 * A restoration record describes one position of the wallet: enough to find
 * it on chain and operate it again. Records form a chain, each naming the
 * one before it, and each is signed by the key that owned the wallet when it
 * was written. Templates are kept whole beside the records that need them.
 */

export const RECORD_FORMAT = 'grandmas-wallet/archive-record';
export const RECORD_VERSION = 1;
const RECORD_PURPOSE = 'grandmas-wallet/archive-record/v1';

/**
 * - `prepared`: the wallet is about to sign; the position may or may not come to exist
 * - `confirmed`: the creating transaction was sent
 * - `closed`: the position was spent by its owner
 */
export type PositionStatus = 'prepared' | 'confirmed' | 'closed';

export interface TemplateReference {
  /** The template's identifier in the application that uses it. */
  identifier: string;
  /** SHA-256 of the template's canonical encoding, as stored in the archive. */
  contentHash: string;
}

export interface PositionDescription {
  /** Stays the same across the records about one position. */
  positionId: string;
  /** Names the rules for rebuilding and checking the position, e.g. `savings-jar`. */
  kind: string;
  /** Version of the owner-approval interface the position's contract uses. */
  interfaceVersion: number;
  /** The values the position's script was built from. */
  parameters: { [name: string]: string | number };
  /** The script holding the position's funds, as hex. */
  lockingBytecode: string;
  template?: TemplateReference;
  /** Things a restoring wallet must have or understand; anything it does not know makes the position unsupported. */
  requires: string[];
  label?: string;
}

export interface PositionEntry {
  type: 'position';
  status: PositionStatus;
  position: PositionDescription;
  /** The creating transaction, or for `closed` the spending one, when known. */
  transactionId?: string;
}

/** An entry of a type this version does not know. Kept so that it is reported, not skipped. */
export interface UnknownEntry {
  type: string;
}

export interface ArchiveRecord {
  format: typeof RECORD_FORMAT;
  version: typeof RECORD_VERSION;
  network: string;
  /** Wallet identity, in the byte order shown by explorers. */
  identity: string;
  /** Position in the chain of records, from 0. */
  sequence: number;
  /** Name of the previous record's blob; `null` for the first. */
  previous: string | null;
  /** The owner epoch of the key that signed this record. */
  ownerEpoch: number;
  /** Unix seconds, as claimed by the writer. */
  createdAt: number;
  entry: PositionEntry | UnknownEntry;
}

export type Blob =
  | { type: 'record'; signed: SignedMessage }
  | { type: 'template'; template: JsonValue }
  | { type: 'acknowledgment'; signed: SignedMessage };

export class RecordError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RecordError';
  }
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isHex = (value: unknown, bytes?: number): value is string =>
  typeof value === 'string' && /^([0-9a-f]{2})*$/.test(value) && (bytes === undefined || value.length === bytes * 2);
const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

export const templateContentHash = (template: JsonValue): string => binToHex(sha256.hash(canonicalBytes(template)));

const signedToJson = (signed: SignedMessage): { [key: string]: JsonValue } => ({
  message: signed.message,
  publicKey: binToHex(signed.publicKey),
  signature: binToHex(signed.signature),
});

const signedFromJson = (value: Record<string, unknown>): SignedMessage => {
  const { message, publicKey, signature } = value;
  if (typeof message !== 'string' || !isHex(publicKey, 33) || !isHex(signature, 64)) {
    throw new RecordError('The blob does not hold a signed message.');
  }
  return { message, publicKey: hexToBin(publicKey), signature: hexToBin(signature) };
};

export const encodeBlob = (blob: Blob): Uint8Array =>
  canonicalBytes(blob.type === 'template' ? { type: 'template', template: blob.template } : { type: blob.type, ...signedToJson(blob.signed) });

/** @throws RecordError if the bytes are not a blob this version can read */
export const decodeBlob = (plaintext: Uint8Array): Blob => {
  let value: unknown;
  try {
    value = JSON.parse(binToUtf8(plaintext));
  } catch {
    throw new RecordError('The blob is not readable.');
  }
  if (!isObject(value)) throw new RecordError('The blob is not readable.');
  if (value['type'] === 'record' || value['type'] === 'acknowledgment') return { type: value['type'], signed: signedFromJson(value) };
  if (value['type'] === 'template' && value['template'] !== undefined) return { type: 'template', template: value['template'] as JsonValue };
  throw new RecordError(`Blobs of type "${String(value['type'])}" are not known to this version.`);
};

const parsePosition = (value: unknown): PositionDescription => {
  if (!isObject(value)) throw new RecordError('The record has no position description.');
  const { positionId, kind, interfaceVersion, parameters, lockingBytecode, template, requires, label } = value;
  if (typeof positionId !== 'string' || positionId === '' || typeof kind !== 'string' || !isCount(interfaceVersion)) {
    throw new RecordError('The position description is incomplete.');
  }
  if (!isObject(parameters) || Object.values(parameters).some((item) => typeof item !== 'string' && !isCount(item))) {
    throw new RecordError('The position parameters are not text or whole numbers.');
  }
  if (!isHex(lockingBytecode) || lockingBytecode === '') throw new RecordError('The position has no script.');
  if (!Array.isArray(requires) || requires.some((item) => typeof item !== 'string')) {
    throw new RecordError('The position requirements are not a list of names.');
  }
  if (template !== undefined && (!isObject(template) || typeof template['identifier'] !== 'string' || !isHex(template['contentHash'], 32))) {
    throw new RecordError('The template reference is incomplete.');
  }
  if (label !== undefined && typeof label !== 'string') throw new RecordError('The position label is not text.');
  return {
    positionId,
    kind,
    interfaceVersion,
    parameters: parameters as PositionDescription['parameters'],
    lockingBytecode,
    requires: requires as string[],
    ...(template === undefined ? {} : { template: { identifier: template['identifier'] as string, contentHash: template['contentHash'] as string } }),
    ...(label === undefined ? {} : { label }),
  };
};

const parseEntry = (value: unknown): PositionEntry | UnknownEntry => {
  if (!isObject(value) || typeof value['type'] !== 'string') throw new RecordError('The record has no entry.');
  if (value['type'] !== 'position') return { type: value['type'] };
  const { status, transactionId } = value;
  if (status !== 'prepared' && status !== 'confirmed' && status !== 'closed') throw new RecordError('The position status is not known.');
  if (transactionId !== undefined && !isHex(transactionId, 32)) throw new RecordError('The transaction identifier is malformed.');
  return {
    type: 'position',
    status,
    position: parsePosition(value['position']),
    ...(transactionId === undefined ? {} : { transactionId }),
  };
};

/** @throws RecordError if the text is not a record of this format and version */
export const parseRecord = (message: string): ArchiveRecord => {
  let value: unknown;
  try {
    value = JSON.parse(message);
  } catch {
    throw new RecordError('The record is not readable.');
  }
  if (!isObject(value) || value['format'] !== RECORD_FORMAT) throw new RecordError('This is not a restoration record.');
  if (value['version'] !== RECORD_VERSION) throw new RecordError(`Record version ${String(value['version'])} is not supported.`);
  const { network, identity, sequence, previous, ownerEpoch, createdAt } = value;
  if (typeof network !== 'string' || !isHex(identity, 32) || !isCount(sequence) || !isCount(ownerEpoch) || !isCount(createdAt)) {
    throw new RecordError('The record header is incomplete.');
  }
  if (previous !== null && !isHex(previous, 32)) throw new RecordError('The reference to the previous record is malformed.');
  if ((previous === null) !== (sequence === 0)) throw new RecordError('Only the first record may lack a previous record.');
  return { format: RECORD_FORMAT, version: RECORD_VERSION, network, identity, sequence, previous, ownerEpoch, createdAt, entry: parseEntry(value['entry']) };
};

export const signRecord = (record: ArchiveRecord, ownerKey: KeyPair): SignedMessage =>
  signMessage(RECORD_PURPOSE, canonicalJson(record as unknown as JsonValue), ownerKey);

/** Whether the record's signature is valid for the key it carries. The key must still be checked against the wallet's owners. */
export const verifyRecordSignature = (signed: SignedMessage): boolean => verifyMessage(RECORD_PURPOSE, signed);
