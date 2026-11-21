import { binToHex, hexToBin } from '@bitauth/libauth';
import type { Memory } from '@grandmas-wallet/app';
import { type ArchiveStore, blobIdOf } from '@grandmas-wallet/archive';

import { type StorageNetwork, NETWORK_CHOICE_KEY, networkName, sideOfName, storageNetwork } from './network.js';

/**
 * What an application keeps in the browser. Everything is under the page's
 * own origin, which the browser keeps apart from every other site's.
 */

const encode = (value: unknown): string =>
  JSON.stringify(value, (_key, item: unknown) =>
    item instanceof Uint8Array ? { $bytes: binToHex(item) } : typeof item === 'bigint' ? { $whole: item.toString() } : item,
  );

const decode = <T>(text: string): T =>
  JSON.parse(text, (_key, item: unknown) => {
    if (typeof item === 'object' && item !== null) {
      const { $bytes, $whole } = item as { $bytes?: unknown; $whole?: unknown };
      if (typeof $bytes === 'string') return hexToBin($bytes);
      if (typeof $whole === 'string') return BigInt($whole);
    }
    return item;
  }) as T;

/**
 * Named values kept between visits. Byte arrays and whole numbers of any size survive the round trip. The names
 * are the page's network's (see network.ts): on mainnet the prefix has `-mainnet` added.
 */
export class Vault {
  constructor(
    private readonly base: string,
    private readonly network?: StorageNetwork,
  ) {}

  private get prefix(): string {
    return networkName(this.base, this.network ?? storageNetwork());
  }

  /** The same values on another network's side: only to carry a session over when the page changes network. */
  on(network: StorageNetwork): Vault {
    return new Vault(this.base, network);
  }

  get<T>(name: string): T | undefined {
    const text = localStorage.getItem(`${this.prefix}:${name}`);
    return text === null ? undefined : decode<T>(text);
  }

  set(name: string, value: unknown): void {
    localStorage.setItem(`${this.prefix}:${name}`, encode(value));
  }

  remove(name: string): void {
    localStorage.removeItem(`${this.prefix}:${name}`);
  }

  names(): string[] {
    return Object.keys(localStorage)
      .filter((key) => key.startsWith(`${this.prefix}:`))
      .map((key) => key.slice(this.prefix.length + 1));
  }

  /** A place for an account to keep small values, such as its receiving address. */
  memory(scope: string): Memory {
    return {
      get: (name) => this.get<string>(`${scope}/${name}`),
      set: (name, value) => this.set(`${scope}/${name}`, value),
    };
  }
}

const request = <T>(operation: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    operation.onsuccess = () => resolve(operation.result);
    operation.onerror = () => reject(operation.error ?? new Error('The browser\'s storage failed.'));
  });

/** The device's own copy of a wallet's archive, in the browser's database. */
export class DeviceStore implements ArchiveStore {
  readonly name = 'this device';
  private database: Promise<IDBDatabase> | undefined;

  constructor(private readonly databaseName: string) {}

  private open(): Promise<IDBDatabase> {
    this.database ??= new Promise((resolve, reject) => {
      const opening = indexedDB.open(networkName(this.databaseName), 1);
      opening.onupgradeneeded = () => opening.result.createObjectStore('blobs');
      opening.onsuccess = () => resolve(opening.result);
      opening.onerror = () => reject(opening.error ?? new Error('The browser\'s storage could not be opened.'));
    });
    return this.database;
  }

  private async blobs(mode: IDBTransactionMode): Promise<IDBObjectStore> {
    return (await this.open()).transaction('blobs', mode).objectStore('blobs');
  }

  async put(archiveId: string, sealed: Uint8Array): Promise<string> {
    const blobId = blobIdOf(sealed);
    await request((await this.blobs('readwrite')).put(sealed.slice(), `${archiveId}/${blobId}`));
    return blobId;
  }

  async list(archiveId: string): Promise<string[]> {
    const keys = await request((await this.blobs('readonly')).getAllKeys(IDBKeyRange.bound(`${archiveId}/`, `${archiveId}/￿`)));
    return keys.map((key) => String(key).slice(archiveId.length + 1));
  }

  async get(archiveId: string, blobId: string): Promise<Uint8Array | undefined> {
    const found = (await request((await this.blobs('readonly')).get(`${archiveId}/${blobId}`))) as Uint8Array | undefined;
    return found === undefined ? undefined : new Uint8Array(found);
  }
}

/**
 * Remove everything this site keeps in the browser for the page's network: what losing the device does. What the
 * other network's side keeps, and the choice of network, stay.
 */
export const eraseDevice = async (): Promise<void> => {
  const side = storageNetwork();
  const ours = (name: string): boolean => name !== NETWORK_CHOICE_KEY && sideOfName(name) === side;
  for (const key of Object.keys(localStorage).filter(ours)) localStorage.removeItem(key);
  const databases = (await indexedDB.databases?.()) ?? [];
  await Promise.all(
    databases.map(
      ({ name }) =>
        new Promise<void>((resolve) => {
          if (name === undefined || !ours(name)) return resolve();
          const deleting = indexedDB.deleteDatabase(name);
          deleting.onsuccess = deleting.onerror = deleting.onblocked = () => resolve();
        }),
    ),
  );
};
