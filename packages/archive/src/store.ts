import { blobIdOf } from './seal.js';

/**
 * Where sealed blobs are kept. A store holds no keys and cannot read what it
 * keeps. It answers a write with the name of the blob it stored, which the
 * writer compares with its own; that answer is the acknowledgment the wallet
 * waits for before it signs.
 */

export interface ArchiveStore {
  /** Shown to the user and used to tell stores apart. */
  readonly name: string;
  /** Keep a blob. Resolves to the name the store gave it. */
  put(archiveId: string, sealed: Uint8Array): Promise<string>;
  /** Names of all blobs kept for an archive. */
  list(archiveId: string): Promise<string[]>;
  get(archiveId: string, blobId: string): Promise<Uint8Array | undefined>;
}

/** A store in memory, for tests and for trying things out without a server. */
export class MemoryStore implements ArchiveStore {
  private readonly archives = new Map<string, Map<string, Uint8Array>>();
  /** While set, every request fails as if the store could not be reached. */
  unreachable = false;

  constructor(readonly name: string) {}

  private check(): void {
    if (this.unreachable) throw new Error(`${this.name} cannot be reached`);
  }

  async put(archiveId: string, sealed: Uint8Array): Promise<string> {
    this.check();
    const blobId = blobIdOf(sealed);
    const archive = this.archives.get(archiveId) ?? new Map<string, Uint8Array>();
    archive.set(blobId, sealed.slice());
    this.archives.set(archiveId, archive);
    return blobId;
  }

  async list(archiveId: string): Promise<string[]> {
    this.check();
    return [...(this.archives.get(archiveId)?.keys() ?? [])];
  }

  async get(archiveId: string, blobId: string): Promise<Uint8Array | undefined> {
    this.check();
    return this.archives.get(archiveId)?.get(blobId)?.slice();
  }

  /** Replace or remove what is kept under a name, as a faulty or dishonest store might. */
  tamper(archiveId: string, blobId: string, replacement: Uint8Array | undefined): void {
    const archive = this.archives.get(archiveId);
    if (archive === undefined) return;
    if (replacement === undefined) archive.delete(blobId);
    else archive.set(blobId, replacement);
  }
}

/** A store reached over HTTP; see the archive store application for the server side. */
export class HttpStore implements ArchiveStore {
  readonly name: string;
  private readonly base: string;

  /** @param url - the store's address, e.g. `https://store1.example` */
  constructor(url: string, private readonly timeoutMs = 15_000) {
    this.base = url.replace(/\/+$/, '');
    this.name = new URL(url).host;
  }

  private async request(path: string, init?: RequestInit): Promise<Response> {
    return fetch(`${this.base}${path}`, { ...init, signal: AbortSignal.timeout(this.timeoutMs) });
  }

  async put(archiveId: string, sealed: Uint8Array): Promise<string> {
    const response = await this.request(`/v1/archives/${archiveId}/blobs`, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: sealed.slice().buffer,
    });
    if (!response.ok) throw new Error(`${this.name} refused the record (${response.status})`);
    const { blobId } = (await response.json()) as { blobId?: unknown };
    if (typeof blobId !== 'string') throw new Error(`${this.name} gave no acknowledgment`);
    return blobId;
  }

  async list(archiveId: string): Promise<string[]> {
    const response = await this.request(`/v1/archives/${archiveId}/blobs`);
    if (!response.ok) throw new Error(`${this.name} could not list the archive (${response.status})`);
    const { blobs } = (await response.json()) as { blobs?: unknown };
    if (!Array.isArray(blobs) || blobs.some((item) => typeof item !== 'string')) throw new Error(`${this.name} gave an unreadable list`);
    return blobs as string[];
  }

  async get(archiveId: string, blobId: string): Promise<Uint8Array | undefined> {
    const response = await this.request(`/v1/archives/${archiveId}/blobs/${blobId}`);
    if (response.status === 404) return undefined;
    if (!response.ok) throw new Error(`${this.name} could not return a record (${response.status})`);
    return new Uint8Array(await response.arrayBuffer());
  }
}
