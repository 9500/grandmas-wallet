import { binToHex, hash160 } from '@bitauth/libauth';
import { type JsonValue, type SignedMessage, type ViewingKeyRecord, canonicalJson, readViewingKeyRecord, signMessage, signViewingKeyRecord, verifyMessage } from '@grandmas-wallet/archive';
import type { ChallengeDelay, KeyPair, SeedKeys, XoNetwork } from '@grandmas-wallet/core';

import { EnrollmentError } from './envelope.js';
import { type KitArchive, type SignedJson, fromSignedJson, messageHash, toSignedJson } from './kit.js';

/**
 * The messages that pass between a device and the recoverer after enrollment (proposal sections 9.7 and 11.1).
 *
 * - The takeover message: from a new device to the recoverer, before a recovery is requested. Nothing in
 *   it needs the wallet's identity, which the new device has not been told.
 * - The update message: from the owner to the recoverer, before a move to a new seed or a change of settings.
 * - The hand-over: from the recoverer to the new device, after the recovery is complete.
 *
 * Each is a signed text, sealed to the encryption key of whoever is to read it.
 */

const fail = (message: string): never => {
  throw new EnrollmentError(message);
};
const hex = binToHex;
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isHex = (value: unknown, bytes: number): value is string => typeof value === 'string' && value.length === bytes * 2 && /^[0-9a-f]*$/.test(value);

/** Read a signed text of one kind: its one encoding, its format and network, and its signature. */
const readSigned = (signed: SignedMessage, format: string, purpose: string, network: XoNetwork, what: string): Record<string, unknown> => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(signed.message);
  } catch {
    return fail(`The ${what} cannot be read.`);
  }
  if (!isObject(parsed) || canonicalJson(parsed as JsonValue) !== signed.message) return fail(`The ${what} is not in its canonical form.`);
  if (parsed['format'] !== format || parsed['version'] !== 1) return fail(`This is not a ${what} of a known version.`);
  if (parsed['network'] !== network) return fail(`The ${what} is for ${String(parsed['network'])}, not for ${network}.`);
  if (!verifyMessage(purpose, signed)) return fail(`The ${what}'s signature is not valid.`);
  return parsed;
};

const archiveOf = (value: unknown, what: string): KitArchive => {
  if (!isObject(value) || !Array.isArray(value['stores']) || !value['stores'].every((store) => typeof store === 'string') || !isHex(value['archiveId'], 16) || !isHex(value['contentKey'], 32)) {
    return fail(`The ${what} does not say where its backup is kept and how to read it.`);
  }
  return { stores: value['stores'] as string[], archiveId: value['archiveId'], contentKey: value['contentKey'] };
};

/** A short form of a key hash for two people to compare, e.g. `3f9a 01bc 77d2 e480`. */
export const keyFingerprint = (keyHash: Uint8Array | string): string => ((typeof keyHash === 'string' ? keyHash : hex(keyHash)).slice(0, 16).match(/.{4}/g) ?? []).join(' ');

// ---------------------------------------------------------------- takeover

export const TAKEOVER_FORMAT = 'grandmas-wallet/takeover';
const TAKEOVER_PURPOSE = 'grandmas-wallet/takeover/v1';

export interface Takeover {
  network: XoNetwork;
  /** hash160 of the new device's controller key: the key a recovery is to be requested for. */
  proposedKeyHash: string;
  viewingKeyRecord: SignedJson;
  /** The access to the new device's own, new backup archive. */
  archive: KitArchive;
  /** An encryption key of the new device's own, for the recoverer's answer after completion. */
  answerKey: string;
}

/**
 * The new device's message to the recoverer (section 11.1, step 1): the hash of its controller key, its
 * viewing-key record signed with that key, the access to a new archive, and a key for the answer. It is
 * signed with the same controller key.
 */
export const signTakeover = (seed: Pick<SeedKeys, 'network' | 'viewingKey' | 'controllerKey'>, archive: KitArchive, answerPublicKey: Uint8Array): SignedMessage =>
  signMessage(
    TAKEOVER_PURPOSE,
    canonicalJson({
      format: TAKEOVER_FORMAT,
      version: 1,
      network: seed.network,
      proposedKeyHash: hex(seed.controllerKey.keyHash),
      viewingKeyRecord: { ...toSignedJson(signViewingKeyRecord(seed)) },
      archive: { ...archive },
      answerKey: hex(answerPublicKey),
    }),
    seed.controllerKey,
  );

export interface ReadTakeover {
  takeover: Takeover;
  viewingKey: ViewingKeyRecord;
  viewingKeyRecord: SignedMessage;
  /** The hash that names this message in the recoverer's receipt. */
  hash: string;
}

/** @throws EnrollmentError if the message does not hold together: it proposes one key and is signed, or its record is signed, by another */
export const readTakeover = (signed: SignedMessage, network: XoNetwork): ReadTakeover => {
  const parsed = readSigned(signed, TAKEOVER_FORMAT, TAKEOVER_PURPOSE, network, 'takeover message');
  if (!isHex(parsed['proposedKeyHash'], 20) || !isHex(parsed['answerKey'], 32)) return fail('The takeover message is incomplete.');
  if (hex(hash160(signed.publicKey)) !== parsed['proposedKeyHash']) return fail('The takeover message is not signed by the key it proposes.');
  const viewingKeyRecord = fromSignedJson(parsed['viewingKeyRecord'], 'viewing-key record');
  let viewingKey: ViewingKeyRecord;
  try {
    viewingKey = readViewingKeyRecord(viewingKeyRecord, network);
  } catch (error) {
    return fail(`The viewing-key record in the takeover message does not hold: ${(error as Error).message}`);
  }
  if (hex(hash160(viewingKey.controllerPublicKey)) !== parsed['proposedKeyHash']) return fail('The viewing-key record is not of the seed whose key the takeover message proposes.');
  return {
    takeover: { network, proposedKeyHash: parsed['proposedKeyHash'], viewingKeyRecord: toSignedJson(viewingKeyRecord), archive: archiveOf(parsed['archive'], 'takeover message'), answerKey: parsed['answerKey'] },
    viewingKey,
    viewingKeyRecord,
    hash: messageHash(signed),
  };
};

// ---------------------------------------------------------------- update

export const UPDATE_FORMAT = 'grandmas-wallet/update';
const UPDATE_PURPOSE = 'grandmas-wallet/update/v1';

export interface Update {
  network: XoNetwork;
  identity: string;
  /** A move to a new seed while the old device still works: the new device's key, record and archive. */
  newSeed?: { proposedKeyHash: string; viewingKeyRecord: SignedJson; archive: KitArchive };
  /** Settings that are to change: the waiting period. A new recoverer gets a kit of its own, not an update. */
  challengeDelay?: ChallengeDelay;
}

/** The owner's message to the recoverer before a change (section 9.7), signed by the owner's controller key. */
export const signUpdate = (update: Update, ownerControllerKey: KeyPair): SignedMessage =>
  signMessage(
    UPDATE_PURPOSE,
    canonicalJson({
      format: UPDATE_FORMAT,
      version: 1,
      network: update.network,
      identity: update.identity,
      ...(update.newSeed === undefined ? {} : { newSeed: { proposedKeyHash: update.newSeed.proposedKeyHash, viewingKeyRecord: { ...update.newSeed.viewingKeyRecord }, archive: { ...update.newSeed.archive } } }),
      ...(update.challengeDelay === undefined ? {} : { challengeDelay: { ...update.challengeDelay } }),
    }),
    ownerControllerKey,
  );

export interface ReadUpdate {
  update: Update;
  /** hash160 of the key that signed the message, as hex: it has to be the owner on chain. */
  signerKeyHash: string;
  viewingKey?: ViewingKeyRecord;
  viewingKeyRecord?: SignedMessage;
  hash: string;
}

/** @throws EnrollmentError */
export const readUpdate = (signed: SignedMessage, network: XoNetwork): ReadUpdate => {
  const parsed = readSigned(signed, UPDATE_FORMAT, UPDATE_PURPOSE, network, 'update message');
  if (!isHex(parsed['identity'], 32)) return fail('The update message names no wallet.');
  const update: Update = { network, identity: parsed['identity'] };
  const result: ReadUpdate = { update, signerKeyHash: hex(hash160(signed.publicKey)), hash: messageHash(signed) };
  const newSeed = parsed['newSeed'];
  if (newSeed !== undefined) {
    if (!isObject(newSeed) || !isHex(newSeed['proposedKeyHash'], 20)) return fail('The update message does not name the new seed\'s key.');
    const viewingKeyRecord = fromSignedJson(newSeed['viewingKeyRecord'], 'viewing-key record');
    let viewingKey: ViewingKeyRecord;
    try {
      viewingKey = readViewingKeyRecord(viewingKeyRecord, network);
    } catch (error) {
      return fail(`The viewing-key record in the update message does not hold: ${(error as Error).message}`);
    }
    if (hex(hash160(viewingKey.controllerPublicKey)) !== newSeed['proposedKeyHash']) return fail('The viewing-key record is not of the seed whose key the update message names.');
    update.newSeed = { proposedKeyHash: newSeed['proposedKeyHash'], viewingKeyRecord: toSignedJson(viewingKeyRecord), archive: archiveOf(newSeed['archive'], 'update message') };
    result.viewingKey = viewingKey;
    result.viewingKeyRecord = viewingKeyRecord;
  }
  const delay = parsed['challengeDelay'];
  if (delay !== undefined) {
    if (!isObject(delay) || (delay['unit'] !== 'blocks' && delay['unit'] !== 'time512') || typeof delay['value'] !== 'number') return fail('The update message does not state the new waiting period.');
    update.challengeDelay = { unit: delay['unit'], value: delay['value'] };
  }
  if (update.newSeed === undefined && update.challengeDelay === undefined) return fail('The update message changes nothing.');
  return result;
};

// ---------------------------------------------------------------- hand-over

export const HAND_OVER_FORMAT = 'grandmas-wallet/hand-over';
const HAND_OVER_PURPOSE = 'grandmas-wallet/hand-over/v1';

export interface HandOver {
  network: XoNetwork;
  identity: string;
  creationTransactionId: string;
  /** The viewing-key record of every earlier seed. */
  viewingKeyRecords: SignedJson[];
  /** The access to earlier archives. */
  archives: KitArchive[];
  /** The recoverer's receipt for the kit as it now stands. */
  receipt: SignedJson;
}

/** The recoverer's answer to the new device after completion (section 11.1, step 6), signed with the recovery key. */
export const signHandOver = (handOver: HandOver, recoveryKey: KeyPair): SignedMessage =>
  signMessage(
    HAND_OVER_PURPOSE,
    canonicalJson({
      format: HAND_OVER_FORMAT,
      version: 1,
      network: handOver.network,
      identity: handOver.identity,
      creationTransactionId: handOver.creationTransactionId,
      viewingKeyRecords: handOver.viewingKeyRecords.map((record) => ({ ...record })),
      archives: handOver.archives.map((archive) => ({ ...archive })),
      receipt: { ...handOver.receipt },
    }),
    recoveryKey,
  );

export interface ReadHandOver {
  handOver: HandOver;
  /** hash160 of the key that signed the hand-over, as hex: it has to be the recoverer on chain. */
  signerKeyHash: string;
  viewingKeyRecords: SignedMessage[];
  receipt: SignedMessage;
}

/** @throws EnrollmentError */
export const readHandOver = (signed: SignedMessage, network: XoNetwork): ReadHandOver => {
  const parsed = readSigned(signed, HAND_OVER_FORMAT, HAND_OVER_PURPOSE, network, 'hand-over');
  if (!isHex(parsed['identity'], 32) || !isHex(parsed['creationTransactionId'], 32)) return fail('The hand-over names no wallet.');
  if (!Array.isArray(parsed['viewingKeyRecords']) || !Array.isArray(parsed['archives'])) return fail('The hand-over is incomplete.');
  const viewingKeyRecords = parsed['viewingKeyRecords'].map((record) => fromSignedJson(record, 'viewing-key record'));
  const receipt = fromSignedJson(parsed['receipt'], 'receipt');
  return {
    handOver: {
      network,
      identity: parsed['identity'],
      creationTransactionId: parsed['creationTransactionId'],
      viewingKeyRecords: viewingKeyRecords.map(toSignedJson),
      archives: parsed['archives'].map((archive) => archiveOf(archive, 'hand-over')),
      receipt: toSignedJson(receipt),
    },
    signerKeyHash: hex(hash160(signed.publicKey)),
    viewingKeyRecords,
    receipt,
  };
};
