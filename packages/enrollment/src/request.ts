import { binToHex, hash160 } from '@bitauth/libauth';
import { type JsonValue, type SignedMessage, type ViewingKeyRecord, canonicalJson, readViewingKeyRecord, signMessage, signViewingKeyRecord, verifyMessage } from '@grandmas-wallet/archive';
import type { ChallengeDelay, SeedKeys, XoNetwork } from '@grandmas-wallet/core';

import { EnrollmentError } from './envelope.js';
import { type KitArchive, type ReadKit, type RecoveryKit, type SignedJson, KIT_FORMAT, KIT_VERSION, credentialKeys, fromSignedJson, messageHash, toSignedJson } from './kit.js';

/**
 * The enrollment request (proposal sections 7.9 and 9.3): what a phone sends whoever creates its wallet. The
 * recoverer creates the wallet on chain from its own coins, naming the owner's controller key from the request,
 * its own recovery key and the waiting period, and keeps a kit that it assembles from the request and from
 * what it created. Nothing in the request needs the identity, which does not exist yet.
 *
 * The request is signed with the phone's controller key and sealed to the recoverer's encryption key. Its hash
 * is what the recoverer's receipt answers, so that the phone can tell its own enrollment from any other.
 */

export const ENROLLMENT_REQUEST_FORMAT = 'grandmas-wallet/enrollment-request';
const PURPOSE = 'grandmas-wallet/enrollment-request/v1';

const fail = (message: string): never => {
  throw new EnrollmentError(message);
};
const hex = binToHex;
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isHex = (value: unknown, bytes: number): value is string => typeof value === 'string' && value.length === bytes * 2 && /^[0-9a-f]*$/.test(value);

export interface EnrollmentRequest {
  network: XoNetwork;
  /** Chosen by the phone, 16 bytes as hex. The same identifier is the same request, however often it arrives. */
  requestId: string;
  /** hash160 of the phone's controller key: the owner the creation is to name. */
  ownerKeyHash: string;
  /** The seed's viewing-key record, signed with the same controller key. */
  viewingKeyRecord: SignedJson;
  /** The access to the phone's backup archive, where the recoverer leaves its receipt. */
  archive: KitArchive;
  /** The waiting period the phone was told. A creation with another one is refused by the phone. */
  challengeDelay: ChallengeDelay;
  /** The number of the change address the starting balance is paid to. */
  firstAddress: number;
}

/** Make and sign an enrollment request with the seed's controller key. */
export const signEnrollmentRequest = (
  seed: Pick<SeedKeys, 'network' | 'viewingKey' | 'controllerKey'>,
  request: Pick<EnrollmentRequest, 'requestId' | 'archive' | 'challengeDelay' | 'firstAddress'>,
): SignedMessage =>
  signMessage(
    PURPOSE,
    canonicalJson({
      format: ENROLLMENT_REQUEST_FORMAT,
      version: 1,
      network: seed.network,
      requestId: request.requestId,
      ownerKeyHash: hex(seed.controllerKey.keyHash),
      viewingKeyRecord: { ...toSignedJson(signViewingKeyRecord(seed)) },
      archive: { ...request.archive },
      challengeDelay: { ...request.challengeDelay },
      firstAddress: request.firstAddress,
    } as unknown as JsonValue),
    seed.controllerKey,
  );

export interface ReadEnrollmentRequest {
  request: EnrollmentRequest;
  viewingKey: ViewingKeyRecord;
  viewingKeyRecord: SignedMessage;
  signed: SignedMessage;
  /** The hash that names this request in the recoverer's receipt. */
  hash: string;
}

/**
 * Read an enrollment request: its one encoding, its signature, and that it holds together (it is signed by the
 * key it names as the owner, and so is its viewing-key record).
 *
 * @throws EnrollmentError
 */
export const readEnrollmentRequest = (signed: SignedMessage, network: XoNetwork): ReadEnrollmentRequest => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(signed.message);
  } catch {
    return fail('The enrollment request cannot be read.');
  }
  if (!isObject(parsed) || canonicalJson(parsed as JsonValue) !== signed.message) return fail('The enrollment request is not in its canonical form.');
  if (parsed['format'] !== ENROLLMENT_REQUEST_FORMAT || parsed['version'] !== 1) return fail('This is not an enrollment request of a known version.');
  if (parsed['network'] !== network) return fail(`The enrollment request is for ${String(parsed['network'])}, not for ${network}.`);
  if (!verifyMessage(PURPOSE, signed)) return fail('The enrollment request\'s signature is not valid.');
  const { requestId, ownerKeyHash, archive, challengeDelay, firstAddress } = parsed;
  if (!isHex(requestId, 16) || !isHex(ownerKeyHash, 20)) return fail('The enrollment request is incomplete.');
  if (hex(hash160(signed.publicKey)) !== ownerKeyHash) return fail('The enrollment request is not signed by the key it names as the owner.');
  if (!isObject(challengeDelay) || (challengeDelay['unit'] !== 'blocks' && challengeDelay['unit'] !== 'time512') || typeof challengeDelay['value'] !== 'number') return fail('The enrollment request does not state the waiting period.');
  if (typeof firstAddress !== 'number' || !Number.isInteger(firstAddress) || firstAddress < 0) return fail('The enrollment request does not say where the starting balance goes.');
  if (!isObject(archive) || !Array.isArray(archive['stores']) || !archive['stores'].every((store) => typeof store === 'string') || !isHex(archive['archiveId'], 16) || !isHex(archive['contentKey'], 32)) {
    return fail('The enrollment request does not say where its backup is kept and how to read it.');
  }
  const viewingKeyRecord = fromSignedJson(parsed['viewingKeyRecord'], 'viewing-key record');
  let viewingKey: ViewingKeyRecord;
  try {
    viewingKey = readViewingKeyRecord(viewingKeyRecord, network);
  } catch (error) {
    return fail(`The viewing-key record in the enrollment request does not hold: ${(error as Error).message}`);
  }
  if (hex(hash160(viewingKey.controllerPublicKey)) !== ownerKeyHash) return fail('The viewing-key record is not of the seed whose key the enrollment request names.');
  return {
    request: {
      network,
      requestId,
      ownerKeyHash,
      viewingKeyRecord: toSignedJson(viewingKeyRecord),
      archive: { stores: archive['stores'] as string[], archiveId: archive['archiveId'], contentKey: archive['contentKey'] },
      challengeDelay: { unit: challengeDelay['unit'], value: challengeDelay['value'] },
      firstAddress,
    },
    viewingKey,
    viewingKeyRecord,
    signed,
    hash: messageHash(signed),
  };
};

/**
 * The kit the recoverer keeps for a wallet it created for a request, as a kit read from a message would be: it
 * names the request's hash as the message it answers, the recoverer's own credential, the request's viewing-key
 * record and archive, and the creation. Nothing in it is signed by the owner apart from the request it carries
 * the hash of and the viewing-key record; it is the recoverer's own record, checked against the chain like any
 * kit before the recoverer relies on it (`checkEnrollment`).
 */
export const kitForRequest = (
  read: ReadEnrollmentRequest,
  made: {
    identity: string;
    creationTransactionId: string;
    credentialWords: string;
    rules: RecoveryKit['rules'];
    /** The recoverer's own name for the wallet. */
    recipient: string;
    madeAt: number;
  },
): ReadKit => {
  const { request } = read;
  const recovererKeyHash = hex(credentialKeys(made.credentialWords, request.network, made.rules.templates).recoveryKey.keyHash);
  const kit: RecoveryKit = {
    format: KIT_FORMAT,
    version: KIT_VERSION,
    network: request.network,
    identity: made.identity,
    creationTransactionId: made.creationTransactionId,
    rules: made.rules,
    credential: { words: made.credentialWords },
    viewingKeyRecords: [request.viewingKeyRecord],
    archives: [request.archive],
    policy: { ownerKeyHash: request.ownerKeyHash, recovererKeyHash, challengeDelay: request.challengeDelay, recipient: made.recipient, madeAt: made.madeAt },
  };
  return { kit, hash: read.hash, signed: read.signed, viewingKeys: [{ record: read.viewingKey, signed: read.viewingKeyRecord }], references: [] };
};
