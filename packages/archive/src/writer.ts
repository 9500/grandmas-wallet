import { binToHex, hexToBin } from '@bitauth/libauth';
import type { KeyPair } from '@grandmas-wallet/core';

import type { JsonValue } from './canonical.js';
import {
  type ArchiveRecord,
  type PositionDescription,
  type PositionEntry,
  RECORD_FORMAT,
  RECORD_VERSION,
  encodeBlob,
  signRecord,
  templateContentHash,
} from './records.js';
import { blobIdOf, seal } from './seal.js';
import type { ArchiveStore } from './store.js';

/**
 * The owner's side of the archive: writing records, and holding back any
 * signature or address that would make funds depend on a record until the
 * stores have confirmed they keep it.
 *
 * The device keeps a copy of the whole archive. Every blob is written there
 * first, and the stores are filled from it. A store that was away, or one
 * that is new, receives whatever it lacks the next time the stores are
 * written to, so the stores can be changed without the old ones taking part.
 */

/** What the wallet keeps on the device between sessions, next to its copy of the archive. Holds no keys. */
export interface WriterState {
  nextSequence: number;
  /** Name of the newest record's blob. */
  head: string | null;
  /** Content hashes of templates already written. */
  templates: string[];
  /** For each store, by name, the blobs it has acknowledged. */
  stored: Record<string, string[]>;
}

export const emptyWriterState = (): WriterState => ({ nextSequence: 0, head: null, templates: [], stored: {} });

/** The current owner key and the owner epoch it belongs to. */
export interface RecordSigner {
  key: KeyPair;
  ownerEpoch: number;
}

export interface ArchiveWriterOptions {
  network: string;
  /** Wallet identity as hex, in the byte order shown by explorers. */
  identity: string;
  archiveId: Uint8Array;
  contentKey: Uint8Array;
  /** The copy of the archive on the device. */
  local: ArchiveStore;
  /** One or more stores away from the device. */
  stores: ArchiveStore[];
  /** How many stores must hold the whole archive before anything depending on a new record is released. Default: all of them. */
  minimumAcknowledgments?: number;
  signer: () => RecordSigner;
  state?: WriterState;
  /** Called with the new state after every change, before anything is sent. */
  persist?: (state: WriterState) => void | Promise<void>;
  /** Unix seconds. */
  now?: () => number;
}

export class BackupUnavailableError extends Error {
  constructor(
    readonly acknowledged: number,
    readonly required: number,
    readonly failures: string[],
  ) {
    super(
      `The restoration record could not be saved: ${acknowledged} of the required ${required} backup store(s) confirmed it` +
        (failures.length === 0 ? '.' : ` (${failures.join('; ')}).`),
    );
    this.name = 'BackupUnavailableError';
  }
}

export class ArchiveWriter {
  private state: WriterState;
  private stores: ArchiveStore[] = [];
  private required = 0;

  constructor(private readonly options: ArchiveWriterOptions) {
    this.state = { ...emptyWriterState(), ...structuredClone(options.state ?? {}) };
    this.setStores(options.stores, options.minimumAcknowledgments);
  }

  /**
   * Change where the archive is kept. Nothing is sent yet: a store that is
   * new receives the whole archive from the device's copy the next time the
   * stores are written to, and a store that was dropped is not contacted again.
   *
   * @param minimumAcknowledgments - default: all of the stores
   */
  setStores(stores: ArchiveStore[], minimumAcknowledgments?: number): void {
    const required = minimumAcknowledgments ?? stores.length;
    if (stores.length === 0) throw new Error('At least one backup store is needed.');
    if (new Set(stores.map((store) => store.name)).size !== stores.length) throw new Error('Each backup store needs its own name.');
    if (!Number.isInteger(required) || required < 1 || required > stores.length) {
      throw new Error('The number of required acknowledgments must be between 1 and the number of stores.');
    }
    this.stores = [...stores];
    this.required = required;
  }

  /** A copy of the state to keep on the device. */
  snapshot(): WriterState {
    return structuredClone(this.state);
  }

  private async save(): Promise<void> {
    await this.options.persist?.(this.snapshot());
  }

  private async enqueue(plaintext: Uint8Array): Promise<string> {
    const sealed = seal(this.options.contentKey, this.options.archiveId, plaintext);
    const blobId = blobIdOf(sealed);
    const kept = await this.options.local.put(binToHex(this.options.archiveId), sealed);
    if (kept !== blobId) throw new Error('The copy on the device was not kept as written.');
    return blobId;
  }

  private async append(entry: PositionEntry): Promise<string> {
    const { key, ownerEpoch } = this.options.signer();
    const record: ArchiveRecord = {
      format: RECORD_FORMAT,
      version: RECORD_VERSION,
      network: this.options.network,
      identity: this.options.identity,
      sequence: this.state.nextSequence,
      previous: this.state.head,
      ownerEpoch,
      createdAt: this.options.now?.() ?? Math.floor(Date.now() / 1000),
      entry,
    };
    const blobId = await this.enqueue(encodeBlob({ type: 'record', signed: signRecord(record, key) }));
    this.state.head = blobId;
    this.state.nextSequence += 1;
    await this.save();
    return blobId;
  }

  /**
   * Send each store whatever it lacks of the device's copy.
   * @throws BackupUnavailableError if fewer stores than required hold the whole archive afterwards
   */
  async flush(): Promise<void> {
    const archiveId = binToHex(this.options.archiveId);
    const names = await this.options.local.list(archiveId);
    const failures = new Set<string>();
    const stored: Record<string, string[]> = {};
    await Promise.all(
      this.stores.map(async (store) => {
        const held = new Set((this.state.stored[store.name] ?? []).filter((name) => names.includes(name)));
        stored[store.name] = [...held];
        for (const name of names) {
          if (held.has(name)) continue;
          try {
            const sealed = await this.options.local.get(archiveId, name);
            if (sealed === undefined) throw new Error(`${name} is missing from the copy on the device`);
            const acknowledged = await store.put(archiveId, sealed);
            if (acknowledged !== name) throw new Error(`${store.name} acknowledged different content`);
            stored[store.name]?.push(name);
          } catch (error) {
            failures.add((error as Error).message);
            // The rest would fail the same way; they are sent the next time.
            break;
          }
        }
      }),
    );
    // Stores no longer in use are forgotten, so one that is added again is filled from the start.
    this.state.stored = stored;
    await this.save();
    const complete = this.stores.filter((store) => stored[store.name]?.length === names.length).length;
    if (complete < this.required) throw new BackupUnavailableError(complete, this.required, [...failures]);
  }

  /** Whether each store in use holds everything the device does, as of the last time the stores were written to. */
  async status(): Promise<{ name: string; held: number; total: number }[]> {
    const names = await this.options.local.list(binToHex(this.options.archiveId));
    return this.stores.map((store) => ({
      name: store.name,
      held: (this.state.stored[store.name] ?? []).filter((name) => names.includes(name)).length,
      total: names.length,
    }));
  }

  /** Keep a complete template in the archive. Returns its content hash, for position descriptions to refer to. */
  async putTemplate(template: JsonValue): Promise<string> {
    const contentHash = templateContentHash(template);
    if (!this.state.templates.includes(contentHash)) {
      await this.enqueue(encodeBlob({ type: 'template', template }));
      this.state.templates.push(contentHash);
      await this.save();
    }
    return contentHash;
  }

  /**
   * The write-before-sign rule. Records the positions an action is about to
   * create, waits for the stores to confirm, and only then runs `release` —
   * the signing, or the handing out of an address. If the stores do not
   * confirm, `release` is never run.
   *
   * @throws BackupUnavailableError without running `release`
   */
  async protect<T>(positions: PositionDescription[], release: () => Promise<T>): Promise<T> {
    for (const position of positions) await this.append({ type: 'position', status: 'prepared', position });
    await this.flush();
    return release();
  }

  /** Note that a prepared position's creating transaction was sent. Saved to the stores when they can be reached. */
  async confirm(position: PositionDescription, transactionId: string): Promise<void> {
    await this.append({ type: 'position', status: 'confirmed', position, transactionId });
    await this.flush().catch(() => undefined);
  }

  /** Note that a position was spent by its owner. */
  async close(position: PositionDescription, transactionId: string): Promise<void> {
    await this.append({ type: 'position', status: 'closed', position, transactionId });
    await this.flush().catch(() => undefined);
  }
}

/** Parse the archive identifier and key as carried in an enrollment package. */
export const archiveKeysFromHex = (archiveId: string, contentKey: string): { archiveId: Uint8Array; contentKey: Uint8Array } => ({
  archiveId: hexToBin(archiveId),
  contentKey: hexToBin(contentKey),
});
