import { binToHex, hash160 } from '@bitauth/libauth';
import type { ControllerHistory, XoNetwork } from '@grandmas-wallet/core';

import { type Receipt, readReceipt } from './receipt.js';
import { type ArchiveRecord, type Blob, type LabelEntry, type TemplateEntry, type TokenNoteEntry, decodeBlob, encodeBlob, readRecord } from './records.js';
import { blobIdOf, seal, unseal } from './seal.js';
import type { SignedMessage } from './signing.js';
import type { ArchiveStore } from './store.js';
import { type ViewingKeyRecord, readViewingKeyRecord } from './viewing-key.js';

/**
 * A backup archive (proposal sections 10.3 to 10.6): sealed records on one or more stores, with a full copy
 * on the device.
 *
 * A store sees neither whose the blobs are nor what they hold. It can withhold, and it can hand back an
 * older set that was once genuine. What is read from stores is therefore assessed against the chain and
 * against the latest receipt, and what cannot be relied on is said, never passed over.
 */

/** What reads an archive: where it is kept, its identifier and its content key. Part of the recovery kit. */
export interface ArchiveAccess {
  /** Addresses of the backup stores. */
  stores: string[];
  archiveId: Uint8Array;
  contentKey: Uint8Array;
}

export interface WriteResult {
  /** The name of the sealed blob: the hash of its bytes. */
  blobId: string;
  /** The stores that answered with that name. Only these count as having stored the record. */
  confirmedBy: string[];
  failed: { store: string; reason: string }[];
}

const describe = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** The writer's side of an archive: seals each record, keeps a copy, and puts it on every store. */
export class Archive {
  /** The device's full copy, by blob name. A store can be filled or replaced from it without the old one taking part. */
  private readonly copy = new Map<string, Uint8Array>();

  constructor(
    readonly archiveId: Uint8Array,
    private readonly contentKey: Uint8Array,
    private readonly stores: ArchiveStore[],
    copy: Iterable<[string, Uint8Array]> = [],
  ) {
    for (const [blobId, sealed] of copy) this.copy.set(blobId, sealed);
  }

  private get id(): string {
    return binToHex(this.archiveId);
  }

  /**
   * Write one blob. It is kept on the device first, then put on every store. A store counts as having it
   * only when it answers with the blob's own name; before something comes to depend on a record, the caller
   * looks at `confirmedBy` (section 10.5).
   */
  async write(blob: Blob): Promise<WriteResult> {
    const sealed = seal(this.contentKey, this.archiveId, encodeBlob(blob));
    const blobId = blobIdOf(sealed);
    this.copy.set(blobId, sealed);
    return this.put(blobId, sealed, this.stores);
  }

  private async put(blobId: string, sealed: Uint8Array, stores: ArchiveStore[]): Promise<WriteResult> {
    const result: WriteResult = { blobId, confirmedBy: [], failed: [] };
    for (const store of stores) {
      try {
        const answer = await store.put(this.id, sealed);
        if (answer === blobId) result.confirmedBy.push(store.name);
        else result.failed.push({ store: store.name, reason: 'it answered with another name than the record\'s' });
      } catch (error) {
        result.failed.push({ store: store.name, reason: describe(error) });
      }
    }
    return result;
  }

  /** Put everything the device holds on a store: a new one, or one that was out of reach. */
  async fill(store: ArchiveStore): Promise<WriteResult[]> {
    const results: WriteResult[] = [];
    for (const [blobId, sealed] of this.copy) results.push(await this.put(blobId, sealed, [store]));
    return results;
  }

  /** The device's copy, for keeping between sessions. */
  get localCopy(): [string, Uint8Array][] {
    return [...this.copy];
  }

  /** The device's own copy as a store, so that it is read and assessed like any other. */
  get localStore(): ArchiveStore {
    const copy = this.copy;
    return {
      name: 'this device',
      put: async (_archiveId, sealed) => {
        const blobId = blobIdOf(sealed);
        copy.set(blobId, sealed);
        return blobId;
      },
      list: async () => [...copy.keys()],
      get: async (_archiveId, blobId) => copy.get(blobId),
    };
  }
}

export interface ReadBlob {
  blobId: string;
  blob: Blob;
  /** The stores that returned it intact. */
  stores: string[];
}

export interface ArchiveContents {
  blobs: ReadBlob[];
  /** What went wrong on the way: a store out of reach, a blob that is not what its name says, one that cannot be opened. */
  problems: string[];
  /** The stores that answered. */
  answered: string[];
}

/**
 * Read an archive from its stores. Each blob is checked against its name before it is opened, so damaged
 * content is refused, and what one store lacks or spoils another copy supplies.
 */
export const readArchive = async (archiveId: Uint8Array, contentKey: Uint8Array, stores: ArchiveStore[]): Promise<ArchiveContents> => {
  const id = binToHex(archiveId);
  const found = new Map<string, ReadBlob>();
  const problems: string[] = [];
  const answered: string[] = [];
  for (const store of stores) {
    let names: string[];
    try {
      names = await store.list(id);
      answered.push(store.name);
    } catch (error) {
      problems.push(`${store.name} did not answer: ${describe(error)}`);
      continue;
    }
    for (const blobId of names) {
      const known = found.get(blobId);
      let sealed: Uint8Array | undefined;
      try {
        sealed = await store.get(id, blobId);
      } catch (error) {
        problems.push(`${store.name} did not return record ${blobId.slice(0, 12)}…: ${describe(error)}`);
        continue;
      }
      if (sealed === undefined) {
        problems.push(`${store.name} lists record ${blobId.slice(0, 12)}… and does not have it.`);
        continue;
      }
      if (blobIdOf(sealed) !== blobId) {
        problems.push(`${store.name} returned damaged data for record ${blobId.slice(0, 12)}…; it is refused.`);
        continue;
      }
      if (known !== undefined) {
        known.stores.push(store.name);
        continue;
      }
      try {
        found.set(blobId, { blobId, blob: decodeBlob(unseal(contentKey, archiveId, sealed)), stores: [store.name] });
      } catch (error) {
        problems.push(`Record ${blobId.slice(0, 12)}… from ${store.name} cannot be read: ${describe(error)}`);
      }
    }
  }
  return { blobs: [...found.values()], problems, answered };
};

/** What decides whether a record is genuine and current: the chain, and what the reader kept. */
export interface Authority {
  network: XoNetwork;
  /** The wallet's controller history, read and checked from the chain. */
  history: ControllerHistory;
  /**
   * The hash of the latest receipt, as this device or the recoverer kept it. Without it the newest set
   * cannot be established.
   */
  latestReceiptHash?: string;
  /**
   * The latest receipt itself, when the reader holds it: from a hand-over, or from the archive that is in
   * use now. An earlier archive, which was left when its seed stopped being the owner, does not hold it;
   * its viewing-key records are still judged by it.
   */
  latestReceipt?: SignedMessage;
}

/** Whose record it is: the key that owns the wallet now, or one that owned it earlier. */
export type Standing = 'current owner' | 'earlier owner';

export interface AssessedRecord<Entry> {
  entry: Entry;
  hash: string;
  signerKeyHash: string;
  standing: Standing;
}

export interface AssessedViewingKey {
  record: ViewingKeyRecord;
  signed: SignedMessage;
  /** hash160 of the controller key of the record's seed, as hex. */
  seedKeyHash: string;
  /** Whether the record is in force: the current receipt names it. Only then is it used to find coins. */
  inForce: boolean;
}

export interface Assessment {
  /** Viewing-key records of seeds that own or owned the wallet, or that a pending request proposes. */
  viewingKeys: AssessedViewingKey[];
  /**
   * Templates signed by an owner. One signed by the current owner is trusted; one from an earlier seed is
   * a suggestion from that time, and does not make a template trusted on this device.
   */
  templates: AssessedRecord<TemplateEntry>[];
  tokenNotes: AssessedRecord<TokenNoteEntry>[];
  labels: AssessedRecord<LabelEntry>[];
  /** Receipts signed with the recovery key the controller names now. */
  receipts: Receipt[];
  /** The receipt the assessment rests on. */
  currentReceipt?: Receipt;
  /** Records that were not accepted, with the reason. */
  refused: { blobId: string; reason: string }[];
  /** Records that disagree. The one a current receipt names is used; the rest is reported here. */
  conflicts: string[];
  /**
   * Whether this is the newest set:
   * - `current`: it holds the receipt this reader kept as the latest;
   * - `older`: that receipt is not in it, so a store handed back an older set, or withholds;
   * - `unknown`: the reader kept no receipt hash, so the newest set cannot be established.
   */
  currency: 'current' | 'older' | 'unknown';
  /** What the user has to be told. Never empty unless the set is established as current and nothing was amiss. */
  notices: string[];
}

const hex = binToHex;

/**
 * Assess what was read from an archive (proposal section 10.3).
 *
 * - A record counts only if the controller's history shows its signing key as an owner. The content key
 *   proves nothing: the recoverer and a lost phone hold it too.
 * - A receipt is checked against the recovery key it names and the controller's state.
 * - A viewing-key record is in force when the current receipt names it. A second record for the same seed
 *   does not replace the first; the conflict is reported.
 * - Records of an earlier seed never override the current owner's.
 * - Newest does not win by date: there are no dates here to go by.
 */
export const assessArchive = (contents: ArchiveContents, authority: Authority): Assessment => {
  const { history, network } = authority;
  const identity = hex(history.genesis.identity);
  const currentOwner = hex(history.current.state.ownerKeyHash);
  const owners = new Set(history.owners.map((period) => hex(period.ownerKeyHash)));
  const proposed = history.current.state.proposedOwnerKeyHash === undefined ? undefined : hex(history.current.state.proposedOwnerKeyHash);
  const assessment: Assessment = { viewingKeys: [], templates: [], tokenNotes: [], labels: [], receipts: [], refused: [], conflicts: [], currency: 'unknown', notices: [...contents.problems] };
  const refuse = (blobId: string, reason: string): void => {
    assessment.refused.push({ blobId, reason });
  };

  const viewingKeys: { blobId: string; record: ViewingKeyRecord; signed: SignedMessage; seedKeyHash: string }[] = [];
  for (const { blobId, blob } of contents.blobs) {
    try {
      if (blob.type === 'receipt') {
        const receipt = readReceipt(blob.signed, network);
        if (receipt.identity !== identity) refuse(blobId, 'The receipt is for another wallet.');
        else if (receipt.recoveryKeyHash !== hex(history.current.state.recovererKeyHash) && receipt.prepared === undefined) refuse(blobId, 'The receipt is signed with a recovery key the controller does not name.');
        else assessment.receipts.push(receipt);
      } else if (blob.type === 'viewing-key') {
        const record = readViewingKeyRecord(blob.signed, network);
        const seedKeyHash = hex(hash160(record.controllerPublicKey));
        // A record that a new device writes before it becomes the owner is signed by the proposed key.
        if (!owners.has(seedKeyHash) && seedKeyHash !== proposed) refuse(blobId, 'The viewing-key record is of a seed that has never owned this wallet.');
        else viewingKeys.push({ blobId, record, signed: blob.signed, seedKeyHash });
      } else {
        const record: ArchiveRecord = readRecord(blob.signed, network);
        if (record.identity !== identity) {
          refuse(blobId, 'The record is for another wallet.');
          continue;
        }
        if (!owners.has(record.signerKeyHash)) {
          refuse(blobId, 'The record is not signed by a key that has owned this wallet. Holding the content key does not make a record genuine.');
          continue;
        }
        const assessed = { hash: record.hash, signerKeyHash: record.signerKeyHash, standing: (record.signerKeyHash === currentOwner ? 'current owner' : 'earlier owner') as Standing };
        if (record.entry.kind === 'template') assessment.templates.push({ entry: record.entry, ...assessed });
        else if (record.entry.kind === 'token-note') assessment.tokenNotes.push({ entry: record.entry, ...assessed });
        else assessment.labels.push({ entry: record.entry, ...assessed });
      }
    } catch (error) {
      refuse(blobId, describe(error));
    }
  }

  // Which receipt is the latest is not for a store to say, and not for a date: it is the one the reader kept.
  const plain = assessment.receipts.filter((receipt) => receipt.recoveryKeyHash === hex(history.current.state.recovererKeyHash));
  let held: Receipt | undefined;
  if (authority.latestReceipt !== undefined) {
    try {
      const receipt = readReceipt(authority.latestReceipt, network);
      if (receipt.identity === identity) held = receipt;
    } catch {
      assessment.notices.push('The receipt this device holds cannot be read.');
    }
  }
  const keptHash = held?.hash ?? authority.latestReceiptHash;
  if (keptHash !== undefined) {
    const kept = assessment.receipts.find((receipt) => receipt.hash === keptHash);
    const relied = kept ?? held;
    if (relied !== undefined) assessment.currentReceipt = relied;
    if (kept !== undefined) {
      assessment.currency = 'current';
    } else if (held !== undefined) {
      assessment.notices.push('This archive does not hold the latest receipt, so whether the stores returned all of it cannot be told: it may be out of date.');
    } else {
      assessment.currency = 'older';
      assessment.notices.push('The stores did not return the latest receipt this device knows of. They may have handed back an older set: the backup may be out of date.');
    }
  } else {
    assessment.notices.push('This device has kept no receipt to compare with, so it cannot tell whether the stores returned the newest set: the backup may be out of date.');
    if (plain.length === 1) assessment.currentReceipt = plain[0] as Receipt;
    else if (plain.length > 1) assessment.conflicts.push(`${plain.length} receipts of the current recoverer were found and nothing settles which is the latest; none is relied on.`);
  }

  const named = new Set(assessment.currentReceipt?.viewingKeyRecords ?? []);
  const bySeed = new Map<string, typeof viewingKeys>();
  for (const entry of viewingKeys) bySeed.set(entry.seedKeyHash, [...(bySeed.get(entry.seedKeyHash) ?? []), entry]);
  for (const [seedKeyHash, entries] of bySeed) {
    const distinct = new Set(entries.map((entry) => entry.record.hash));
    if (distinct.size > 1) {
      const inForce = entries.find((entry) => named.has(entry.record.hash));
      assessment.conflicts.push(
        `${distinct.size} different viewing-key records were found for the seed of key ${seedKeyHash.slice(0, 12)}…. ${
          inForce === undefined ? 'The receipt names none of them, so none is used.' : 'The one the receipt names stays in force; the other does not replace it.'
        }`,
      );
    }
    for (const entry of entries) {
      if (assessment.viewingKeys.some((known) => known.record.hash === entry.record.hash)) continue;
      assessment.viewingKeys.push({ record: entry.record, signed: entry.signed, seedKeyHash, inForce: named.has(entry.record.hash) });
    }
  }
  for (const template of assessment.templates) {
    if (template.standing === 'earlier owner') {
      assessment.notices.push(`Template ${template.entry.identifier.slice(0, 12)}… was stored by an earlier seed. It is kept as a suggestion and is not trusted on this device.`);
    }
  }
  if (assessment.refused.length > 0) assessment.notices.push(`${assessment.refused.length} record${assessment.refused.length === 1 ? ' was' : 's were'} refused.`);
  assessment.notices.push(...assessment.conflicts);
  return assessment;
};

/** Read an archive from its stores and assess it. */
export const restoreArchive = async (archiveId: Uint8Array, contentKey: Uint8Array, stores: ArchiveStore[], authority: Authority): Promise<Assessment> =>
  assessArchive(await readArchive(archiveId, contentKey, stores), authority);

/** The viewing keys that may be used to find coins: those in force. */
export const viewingKeysInForce = (assessment: Assessment): ViewingKeyRecord[] => assessment.viewingKeys.filter((entry) => entry.inForce).map((entry) => entry.record);

export interface TemplateStanding {
  /** A template record with this identifier and content hash is in the archive, signed by an owner. */
  stored: boolean;
  /** It was stored by the key that owns the wallet now, so the user's trust in it carries over. */
  trusted: boolean;
  /** hash160 of each owner key that signed such a record, as hex. */
  signedBy: string[];
  /** The template as the text it arrived in. */
  text?: string;
}

/** Whether a template with a given identifier and content hash is stored, and by whom it was signed. */
export const templateStanding = (assessment: Assessment, identifier: string, contentHash: string): TemplateStanding => {
  const matching = assessment.templates.filter((template) => template.entry.identifier === identifier && template.entry.contentHash === contentHash);
  const [first] = matching;
  return {
    stored: matching.length > 0,
    trusted: matching.some((template) => template.standing === 'current owner'),
    signedBy: [...new Set(matching.map((template) => template.signerKeyHash))],
    ...(first === undefined ? {} : { text: first.entry.text }),
  };
};

/**
 * Whether a write may be depended on (section 10.5): at least one of the configured stores confirmed it.
 * By default the wallet refuses a template's first action otherwise. The device's own copy does not count.
 */
export const safelyStored = (result: WriteResult): boolean => result.confirmedBy.length > 0;
