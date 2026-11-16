import { base64ToBin, binToBase64, binToHex, hexToBin } from '@bitauth/libauth';
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
 */

/** A blob written locally and how far it has been preserved. */
interface QueuedBlob {
  blobId: string;
  /** Sealed bytes, base64. */
  sealed: string;
  acknowledgedBy: string[];
}

/** What the wallet keeps on the device between sessions. Holds no keys. */
export interface WriterState {
  nextSequence: number;
  /** Name of the newest record's blob. */
  head: string | null;
  /** Blobs not yet acknowledged by every store. */
  queue: QueuedBlob[];
  /** Content hashes of templates already written. */
  templates: string[];
}

export const emptyWriterState = (): WriterState => ({ nextSequence: 0, head: null, queue: [], templates: [] });

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
  stores: ArchiveStore[];
  /** How many stores must acknowledge a record before anything depending on it is released. Default: all of them. */
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
      `The restoration record could not be saved: ${acknowledged} of the required ${required} backup stores confirmed it` +
        (failures.length === 0 ? '.' : ` (${failures.join('; ')}).`),
    );
    this.name = 'BackupUnavailableError';
  }
}

export class ArchiveWriter {
  private state: WriterState;
  private readonly required: number;

  constructor(private readonly options: ArchiveWriterOptions) {
    this.state = structuredClone(options.state ?? emptyWriterState());
    this.required = options.minimumAcknowledgments ?? options.stores.length;
    if (options.stores.length === 0) throw new Error('At least one backup store is needed.');
    if (!Number.isInteger(this.required) || this.required < 1 || this.required > options.stores.length) {
      throw new Error('The number of required acknowledgments must be between 1 and the number of stores.');
    }
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
    this.state.queue.push({ blobId, sealed: binToBase64(sealed), acknowledgedBy: [] });
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
   * Send every queued blob to every store that has not yet acknowledged it.
   * @throws BackupUnavailableError if any blob is still short of the required acknowledgments
   */
  async flush(): Promise<void> {
    const archiveId = binToHex(this.options.archiveId);
    const failures = new Set<string>();
    await Promise.all(
      this.state.queue.map(async (blob) => {
        const sealed = base64ToBin(blob.sealed);
        await Promise.all(
          this.options.stores
            .filter((store) => !blob.acknowledgedBy.includes(store.name))
            .map(async (store) => {
              try {
                const acknowledged = await store.put(archiveId, sealed);
                if (acknowledged !== blob.blobId) throw new Error(`${store.name} acknowledged different content`);
                blob.acknowledgedBy.push(store.name);
              } catch (error) {
                failures.add((error as Error).message);
              }
            }),
        );
      }),
    );
    const least = Math.min(this.options.stores.length, ...this.state.queue.map((blob) => blob.acknowledgedBy.length));
    // A blob stays queued until every store has it, so a store that was away catches up later.
    this.state.queue = this.state.queue.filter((blob) => blob.acknowledgedBy.length < this.options.stores.length);
    await this.save();
    if (least < this.required) throw new BackupUnavailableError(least, this.required, [...failures]);
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
