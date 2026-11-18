import {
  binToHex,
  binToUtf8,
  decodeBip39Mnemonic,
  decodeHdPublicKey,
  encodeBip39Mnemonic,
  encodeHdPublicKey,
  flattenBinArray,
  hash160,
  hexToBin,
  sha256,
  utf8ToBin,
} from '@bitauth/libauth';
import {
  type JsonValue,
  type SignedMessage,
  type ViewingKeyRecord,
  canonicalJson,
  readViewingKeyRecord,
  signMessage,
  verifyMessage,
  viewingKeyRecordText,
} from '@grandmas-wallet/archive';
import { type ChallengeDelay, type KeyPair, type XoNetwork, decodeChallengeDelay, deriveXoTemplateKey, encodeChallengeDelay } from '@grandmas-wallet/core';

import { EnrollmentError, openBytes, sealBytes } from './envelope.js';

/**
 * The recovery kit (proposal section 9.4): what the recoverer keeps for a wallet for as long as it serves
 * it. The enrollment message delivers the first one: the kit, signed by the owner's controller key and
 * sealed to the recoverer's encryption key, in a link or a QR code.
 *
 * The kit lets the recoverer read the wallet and gives no power to spend.
 */

export const KIT_FORMAT = 'grandmas-wallet/recovery-kit';
export const KIT_VERSION = 1;
const KIT_PURPOSE = 'grandmas-wallet/enrollment/v1';

/**
 * The longest enrollment link, counted in characters of the whole link as text.
 *
 * A QR code of version 27 (125 modules a side) holds 1,465 bytes at the lowest level of error correction.
 * With its quiet zone it is 133 modules wide: on a phone screen 360 points wide that is 2.7 points a
 * module, which phone cameras read at arm's length. The largest code, version 40, holds 2,953 bytes on 177
 * modules a side; a link that needs it is not one to rely on. The figure is to be confirmed with phones
 * when the pages exist.
 */
export const ENROLLMENT_LINK_BUDGET = 1_465;

/** One of the wallet's templates, named by the identifier the XO engine gives it and by the hash of its text. */
export interface TemplateReference {
  /** The name the wallet's code uses: `controller`, `givenOut`, `change`, `actions`, `coins`. */
  name: string;
  identifier: string;
  contentHash: string;
}

/** A signed text, in the form it has inside another text. */
export interface SignedJson {
  message: string;
  publicKey: string;
  signature: string;
}

/** A viewing-key record in a kit: whole, or named by its hash for the recoverer to fetch from the stores. */
export type KitViewingKey = SignedJson | { reference: string };

/** Where an archive is kept and how to read it, as hex. */
export interface KitArchive {
  stores: string[];
  archiveId: string;
  contentKey: string;
}

/** The recoverer's credential: its own twelve words, or a statement that it holds its own key. */
export type KitCredential = { words: string } | { heldByRecoverer: true; recoveryKeyHash: string };

export interface RecoveryKit {
  format: typeof KIT_FORMAT;
  version: typeof KIT_VERSION;
  network: XoNetwork;
  /** Wallet identity, in the byte order shown by explorers. */
  identity: string;
  /** The transaction that created the identity. It is fetched and checked, not taken on the kit's word. */
  creationTransactionId: string;
  rules: {
    /** Version of the controller rules: the version byte of the controller's state. */
    controller: number;
    addressScheme: number;
    templates: TemplateReference[];
  };
  credential: KitCredential;
  /** The viewing-key record of the current seed first, then those of earlier seeds. */
  viewingKeyRecords: KitViewingKey[];
  /** The current archive first, then earlier ones. */
  archives: KitArchive[];
  /** The policy as the owner saw it, for the recoverer to compare with the chain. */
  policy: {
    ownerKeyHash: string;
    recovererKeyHash: string;
    challengeDelay: ChallengeDelay;
    /** Who the kit is for, as the owner saw it. */
    recipient: string;
    /** Unix seconds. A note, not evidence. */
    madeAt: number;
  };
}

/** What the owner supplies; the owner key hash and the recovery key hash follow from the keys. */
export type KitInput = Omit<RecoveryKit, 'format' | 'version' | 'policy'> & { policy: Pick<RecoveryKit['policy'], 'challengeDelay' | 'recipient' | 'madeAt'> };

const fail = (message: string): never => {
  throw new EnrollmentError(message);
};
const hex = binToHex;
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isHex = (value: unknown, bytes: number): value is string => typeof value === 'string' && value.length === bytes * 2 && /^[0-9a-f]*$/.test(value);

export const toSignedJson = (signed: SignedMessage): SignedJson => ({ message: signed.message, publicKey: hex(signed.publicKey), signature: hex(signed.signature) });
export const fromSignedJson = (value: unknown, what: string): SignedMessage => {
  if (!isObject(value) || typeof value['message'] !== 'string' || !isHex(value['publicKey'], 33) || !isHex(value['signature'], 64)) return fail(`The ${what} is not a signed text.`);
  return { message: value['message'], publicKey: hexToBin(value['publicKey']), signature: hexToBin(value['signature']) };
};

const templateNamed = (templates: TemplateReference[], name: string): string =>
  templates.find((template) => template.name === name)?.identifier ?? fail(`The kit does not name the wallet's ${name} template.`);

/**
 * The keys of a credential (proposal section 9.2): the recovery key is the first key under the controller
 * template of the credential's own words. The first key under XO's standard wallet template is the key of the fee
 * address, where the recoverer kept coins for its fees until 18 November 2026; it is derived so that what is
 * still there can be brought into the recoverer's balance.
 */
export const credentialKeys = (words: string, network: XoNetwork, templates: TemplateReference[]): { recoveryKey: KeyPair; feeKey: KeyPair } => ({
  recoveryKey: deriveXoTemplateKey(words, templateNamed(templates, 'controller'), 0, network),
  feeKey: deriveXoTemplateKey(words, templateNamed(templates, 'coins'), 0, network),
});

/** The recovery key hash a credential stands for, as hex. */
const recoveryKeyHashOf = (credential: KitCredential, network: XoNetwork, templates: TemplateReference[]): string =>
  'words' in credential ? hex(credentialKeys(credential.words, network, templates).recoveryKey.keyHash) : credential.recoveryKeyHash;

const kitText = (kit: RecoveryKit): string => canonicalJson(kit as unknown as JsonValue);

/** Make the kit and sign it with the owner's controller key: the enrollment message before sealing. */
export const signKit = (input: KitInput, ownerControllerKey: KeyPair): SignedMessage => {
  const kit: RecoveryKit = {
    ...input,
    format: KIT_FORMAT,
    version: KIT_VERSION,
    policy: { ...input.policy, ownerKeyHash: hex(ownerControllerKey.keyHash), recovererKeyHash: recoveryKeyHashOf(input.credential, input.network, input.rules.templates) },
  };
  return signMessage(KIT_PURPOSE, kitText(kit), ownerControllerKey);
};

/** The hash that names a kit message in receipts: SHA-256 of its signed text. */
export const messageHash = (signed: Pick<SignedMessage, 'message'>): string => hex(sha256.hash(utf8ToBin(signed.message)));

/** A kit that was read: its form, its signature and what it holds agree. Nothing here is checked against the chain. */
export interface ReadKit {
  kit: RecoveryKit;
  hash: string;
  signed: SignedMessage;
  /** The viewing-key records the kit carries whole, checked. */
  viewingKeys: { record: ViewingKeyRecord; signed: SignedMessage }[];
  /** The hashes of the records the kit only refers to. */
  references: string[];
}

const parseArchive = (value: unknown): KitArchive => {
  if (!isObject(value) || !Array.isArray(value['stores']) || !value['stores'].every((store) => typeof store === 'string') || !isHex(value['archiveId'], 16) || !isHex(value['contentKey'], 32)) {
    return fail('The kit does not say where a backup is kept and how to read it.');
  }
  return { stores: value['stores'] as string[], archiveId: value['archiveId'], contentKey: value['contentKey'] };
};

/**
 * Read a kit message: its form, its one encoding, its signature, and that its parts agree with each other.
 *
 * @throws EnrollmentError
 */
export const readKit = (signed: SignedMessage, network: XoNetwork): ReadKit => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(signed.message);
  } catch {
    return fail('The kit cannot be read.');
  }
  if (!isObject(parsed) || canonicalJson(parsed as JsonValue) !== signed.message) return fail('The kit is not in its canonical form.');
  if (parsed['format'] !== KIT_FORMAT) return fail('This is not a recovery kit.');
  if (parsed['version'] !== KIT_VERSION) return fail(`Recovery kits of version ${String(parsed['version'])} are not known.`);
  if (parsed['network'] !== network) return fail(`The kit is for ${String(parsed['network'])}, not for ${network}.`);
  const { identity, creationTransactionId, rules, credential, viewingKeyRecords, archives, policy } = parsed;
  if (!isHex(identity, 32) || !isHex(creationTransactionId, 32)) return fail('The kit does not name a wallet.');
  if (!isObject(rules) || typeof rules['controller'] !== 'number' || typeof rules['addressScheme'] !== 'number' || !Array.isArray(rules['templates'])) return fail('The kit does not say which rules the wallet follows.');
  const templates = rules['templates'].map((entry): TemplateReference => {
    if (!isObject(entry) || typeof entry['name'] !== 'string' || !isHex(entry['identifier'], 32) || !isHex(entry['contentHash'], 32)) return fail('The kit names a template without its identifier and content hash.');
    return { name: entry['name'], identifier: entry['identifier'], contentHash: entry['contentHash'] };
  });
  let kitCredential: KitCredential;
  if (isObject(credential) && typeof credential['words'] === 'string' && typeof decodeBip39Mnemonic(credential['words']) !== 'string') kitCredential = { words: credential['words'] };
  else if (isObject(credential) && credential['heldByRecoverer'] === true && isHex(credential['recoveryKeyHash'], 20)) kitCredential = { heldByRecoverer: true, recoveryKeyHash: credential['recoveryKeyHash'] };
  else return fail('The kit carries no recovery credential and no statement that the recoverer holds its own key.');
  if (!Array.isArray(viewingKeyRecords) || viewingKeyRecords.length === 0) return fail('The kit carries no viewing-key record.');
  if (!Array.isArray(archives) || archives.length === 0) return fail('The kit does not say where the backup is kept.');
  if (!isObject(policy) || !isHex(policy['ownerKeyHash'], 20) || !isHex(policy['recovererKeyHash'], 20) || typeof policy['recipient'] !== 'string' || typeof policy['madeAt'] !== 'number') return fail('The kit does not state the policy.');
  const delay = policy['challengeDelay'];
  if (!isObject(delay) || (delay['unit'] !== 'blocks' && delay['unit'] !== 'time512') || typeof delay['value'] !== 'number') return fail('The kit does not state the waiting period.');
  if (!verifyMessage(KIT_PURPOSE, signed)) return fail('The kit\'s signature is not valid.');
  if (hex(hash160(signed.publicKey)) !== policy['ownerKeyHash']) return fail('The kit is not signed by the owner key it names.');
  if (recoveryKeyHashOf(kitCredential, network, templates) !== policy['recovererKeyHash']) return fail('The kit\'s credential is not the recovery key it names.');

  const viewingKeys: ReadKit['viewingKeys'] = [];
  const references: string[] = [];
  const entries = viewingKeyRecords.map((entry): KitViewingKey => {
    if (isObject(entry) && isHex(entry['reference'], 32)) {
      references.push(entry['reference']);
      return { reference: entry['reference'] };
    }
    const record = fromSignedJson(entry, 'viewing-key record');
    try {
      viewingKeys.push({ record: readViewingKeyRecord(record, network), signed: record });
    } catch (error) {
      return fail(`A viewing-key record in the kit does not hold: ${(error as Error).message}`);
    }
    return toSignedJson(record);
  });
  const kit: RecoveryKit = {
    format: KIT_FORMAT,
    version: KIT_VERSION,
    network,
    identity,
    creationTransactionId,
    rules: { controller: rules['controller'], addressScheme: rules['addressScheme'], templates },
    credential: kitCredential,
    viewingKeyRecords: entries,
    archives: archives.map(parseArchive),
    policy: { ownerKeyHash: policy['ownerKeyHash'], recovererKeyHash: policy['recovererKeyHash'], challengeDelay: { unit: delay['unit'], value: delay['value'] }, recipient: policy['recipient'], madeAt: policy['madeAt'] },
  };
  return { kit, hash: messageHash(signed), signed, viewingKeys, references };
};

// ---------------------------------------------------------------- the enrollment message in few bytes

const WIRE_VERSION = 0x01;
const NETWORKS: XoNetwork[] = ['mainnet', 'testnet'];
/** Template names that take one byte in the message; any other name is written out. */
const TEMPLATE_NAMES = ['controller', 'givenOut', 'change', 'actions', 'coins'];

class Writer {
  private readonly parts: Uint8Array[] = [];
  byte(value: number): this {
    if (!Number.isInteger(value) || value < 0 || value > 255) fail('A value does not fit the enrollment message.');
    this.parts.push(Uint8Array.of(value));
    return this;
  }
  bytes(value: Uint8Array, length?: number): this {
    if (length !== undefined && value.length !== length) fail('A value has the wrong length for the enrollment message.');
    this.parts.push(value);
    return this;
  }
  hex(value: string, length: number): this {
    return this.bytes(hexToBin(value), length);
  }
  text(value: string): this {
    const encoded = utf8ToBin(value);
    return this.byte(encoded.length).bytes(encoded);
  }
  uint32(value: number): this {
    if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) fail('A value does not fit the enrollment message.');
    return this.bytes(Uint8Array.of(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, value >>> 24));
  }
  done(): Uint8Array {
    return flattenBinArray(this.parts);
  }
}

class Reader {
  private at = 0;
  constructor(private readonly data: Uint8Array) {}
  bytes(length: number): Uint8Array {
    if (this.at + length > this.data.length) fail('The enrollment message is incomplete.');
    this.at += length;
    return this.data.slice(this.at - length, this.at);
  }
  byte(): number {
    return this.bytes(1)[0] as number;
  }
  hex(length: number): string {
    return hex(this.bytes(length));
  }
  text(): string {
    return binToUtf8(this.bytes(this.byte()));
  }
  uint32(): number {
    const [a, b, c, d] = this.bytes(4) as unknown as [number, number, number, number];
    return (a | (b << 8) | (c << 16) | (d << 24)) >>> 0;
  }
  end(): void {
    if (this.at !== this.data.length) fail('The enrollment message has something after its end.');
  }
}

/** An extended public key as its 74 bytes of content; the text form follows from them and the network. */
const writeNode = (writer: Writer, text: string): void => {
  const decoded = decodeHdPublicKey(text);
  if (typeof decoded === 'string') return fail('A viewing-key record holds something that is not an extended public key.');
  const { node } = decoded;
  writer.byte(node.depth).uint32(node.childIndex).bytes(node.parentFingerprint, 4).bytes(node.chainCode, 32).bytes(node.publicKey, 33);
};
const readNode = (reader: Reader, network: XoNetwork): string => {
  const depth = reader.byte();
  const childIndex = reader.uint32();
  return encodeHdPublicKey({ network, node: { depth, childIndex, parentFingerprint: reader.bytes(4), chainCode: reader.bytes(32), publicKey: reader.bytes(33) } }).hdPublicKey;
};

/**
 * The enrollment message as bytes. It carries the kit's values, not its text: the text that was signed
 * follows from the values, and so does every viewing-key record's. The owner key hash and, with a
 * credential, the recovery key hash are not carried: they are the hashes of keys the message carries.
 */
export const encodeEnrollment = (signed: SignedMessage, network: XoNetwork): Uint8Array => {
  const { kit, viewingKeys } = readKit(signed, network);
  const writer = new Writer().byte(WIRE_VERSION).byte(NETWORKS.indexOf(kit.network)).hex(kit.identity, 32).hex(kit.creationTransactionId, 32);
  writer.byte(kit.rules.controller).byte(kit.rules.addressScheme).byte(kit.rules.templates.length);
  for (const template of kit.rules.templates) {
    const known = TEMPLATE_NAMES.indexOf(template.name);
    if (known >= 0) writer.byte(known);
    else writer.byte(255).text(template.name);
    writer.hex(template.identifier, 32).hex(template.contentHash, 32);
  }
  if ('words' in kit.credential) {
    const entropy = decodeBip39Mnemonic(kit.credential.words);
    if (typeof entropy === 'string') return fail('The credential is not a set of words.');
    writer.byte(1).byte(entropy.length).bytes(entropy);
  } else {
    writer.byte(0).hex(kit.credential.recoveryKeyHash, 20);
  }
  writer.bytes(signed.publicKey, 33).byte(kit.viewingKeyRecords.length);
  let inline = 0;
  for (const entry of kit.viewingKeyRecords) {
    if ('reference' in entry) {
      writer.byte(1).hex(entry.reference, 32);
      continue;
    }
    const { record, signed: recordSigned } = viewingKeys[inline++] as ReadKit['viewingKeys'][number];
    writer.byte(0);
    writeNode(writer, record.viewingKey.addressNodes.givenOut);
    writeNode(writer, record.viewingKey.addressNodes.change);
    writer.bytes(record.viewingKey.blindingSeed, 32).bytes(record.controllerPublicKey, 33).bytes(recordSigned.signature, 64);
  }
  writer.byte(kit.archives.length);
  for (const archive of kit.archives) {
    writer.byte(archive.stores.length);
    for (const store of archive.stores) writer.text(store);
    writer.hex(archive.archiveId, 16).hex(archive.contentKey, 32);
  }
  const delay = encodeChallengeDelay(kit.policy.challengeDelay);
  writer.bytes(Uint8Array.of(delay & 0xff, (delay >> 8) & 0xff, (delay >> 16) & 0xff)).text(kit.policy.recipient).uint32(kit.policy.madeAt);
  return writer.bytes(signed.signature, 64).done();
};

/**
 * Read an enrollment message from its bytes. What comes out is the signed kit, checked as {@link readKit}
 * checks it: a message that was altered gives another text, which the signature does not fit.
 *
 * @throws EnrollmentError
 */
export const decodeEnrollment = (bytes: Uint8Array, network: XoNetwork): SignedMessage => {
  const reader = new Reader(bytes);
  if (reader.byte() !== WIRE_VERSION) return fail('This kind of enrollment message is not known.');
  const kitNetwork = NETWORKS[reader.byte()] ?? fail('The enrollment message names an unknown network.');
  if (kitNetwork !== network) return fail(`The kit is for ${kitNetwork}, not for ${network}.`);
  const identity = reader.hex(32);
  const creationTransactionId = reader.hex(32);
  const controller = reader.byte();
  const addressScheme = reader.byte();
  const templates = Array.from({ length: reader.byte() }, (): TemplateReference => {
    const tag = reader.byte();
    const name = tag === 255 ? reader.text() : (TEMPLATE_NAMES[tag] ?? fail('The enrollment message names an unknown template.'));
    return { name, identifier: reader.hex(32), contentHash: reader.hex(32) };
  });
  let credential: KitCredential;
  if (reader.byte() === 1) {
    const words = encodeBip39Mnemonic(reader.bytes(reader.byte()));
    credential = { words: typeof words === 'string' ? fail('The enrollment message carries a damaged credential.') : words.phrase };
  } else {
    credential = { heldByRecoverer: true, recoveryKeyHash: reader.hex(20) };
  }
  const publicKey = reader.bytes(33);
  const viewingKeyRecords = Array.from({ length: reader.byte() }, (): KitViewingKey => {
    if (reader.byte() === 1) return { reference: reader.hex(32) };
    const addressNodes = { givenOut: readNode(reader, network), change: readNode(reader, network) };
    const blindingSeed = reader.bytes(32);
    const controllerPublicKey = reader.bytes(33);
    return { message: viewingKeyRecordText({ network, addressNodes, blindingSeed }, controllerPublicKey), publicKey: hex(controllerPublicKey), signature: reader.hex(64) };
  });
  const archives = Array.from({ length: reader.byte() }, (): KitArchive => ({ stores: Array.from({ length: reader.byte() }, () => reader.text()), archiveId: reader.hex(16), contentKey: reader.hex(32) }));
  const [low, middle, high] = reader.bytes(3) as unknown as [number, number, number];
  const challengeDelay = decodeChallengeDelay(low | (middle << 8) | (high << 16));
  const recipient = reader.text();
  const madeAt = reader.uint32();
  const signature = reader.bytes(64);
  reader.end();
  const kit: RecoveryKit = {
    format: KIT_FORMAT,
    version: KIT_VERSION,
    network,
    identity,
    creationTransactionId,
    rules: { controller, addressScheme, templates },
    credential,
    viewingKeyRecords,
    archives,
    policy: { ownerKeyHash: hex(hash160(publicKey)), recovererKeyHash: recoveryKeyHashOf(credential, network, templates), challengeDelay, recipient, madeAt },
  };
  const signed: SignedMessage = { message: kitText(kit), publicKey, signature };
  readKit(signed, network);
  return signed;
};

/** Seal an enrollment message to the recoverer's encryption key. */
export const sealEnrollment = async (signed: SignedMessage, network: XoNetwork, recipientPublicKey: Uint8Array): Promise<Uint8Array> =>
  sealBytes(encodeEnrollment(signed, network), recipientPublicKey);

/**
 * Open an enrollment message with the recoverer's private key and read the kit.
 * @throws EnrollmentError if it is not for this key, was altered, or is for another network
 */
export const openEnrollment = async (envelope: Uint8Array, recipientPrivateKey: Uint8Array, network: XoNetwork): Promise<ReadKit> =>
  readKit(decodeEnrollment(await openBytes(envelope, recipientPrivateKey), network), network);
