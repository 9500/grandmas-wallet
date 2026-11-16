import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { HttpStore, blobIdOf } from '@grandmas-wallet/archive';
import { afterEach, describe, expect, it } from 'vitest';

import { type StoreOptions, createStoreServer } from '../src/server.js';

const ARCHIVE = 'ab'.repeat(16);
const servers: Server[] = [];
const folders: string[] = [];

const start = async (options: StoreOptions = {}): Promise<string> => {
  const server = createStoreServer(options);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
};

const folder = (): string => {
  const created = mkdtempSync(join(tmpdir(), 'archive-store-'));
  folders.push(created);
  return created;
};

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
  folders.splice(0).forEach((created) => rmSync(created, { recursive: true, force: true }));
});

describe('backup store', () => {
  it('keeps a blob, acknowledges it by its hash, and returns it', async () => {
    const store = new HttpStore(await start());
    const blob = crypto.getRandomValues(new Uint8Array(300));
    expect(await store.put(ARCHIVE, blob)).toBe(blobIdOf(blob));
    expect(await store.put(ARCHIVE, blob)).toBe(blobIdOf(blob));
    expect(await store.list(ARCHIVE)).toEqual([blobIdOf(blob)]);
    expect(await store.get(ARCHIVE, blobIdOf(blob))).toEqual(blob);
    expect(await store.get(ARCHIVE, 'cd'.repeat(32))).toBeUndefined();
    expect(await store.list('ef'.repeat(16))).toEqual([]);
  });

  it('keeps blobs on disk across a restart', async () => {
    const directory = folder();
    const blob = crypto.getRandomValues(new Uint8Array(64));
    await new HttpStore(await start({ directory })).put(ARCHIVE, blob);
    // A file left half-written by a crash is not offered as a blob.
    writeFileSync(join(directory, ARCHIVE, `.${'00'.repeat(32)}.partial`), 'x');
    const again = new HttpStore(await start({ directory }));
    expect(await again.list(ARCHIVE)).toEqual([blobIdOf(blob)]);
    expect(await again.get(ARCHIVE, blobIdOf(blob))).toEqual(blob);
    expect(readdirSync(directory)).toEqual([ARCHIVE]);
  });

  it('refuses blobs that are too large, archives that are full, and paths outside its scheme', async () => {
    const url = await start({ maximumBlobBytes: 100, maximumBlobsPerArchive: 2 });
    const store = new HttpStore(url);
    await expect(store.put(ARCHIVE, new Uint8Array(101))).rejects.toThrow('413');
    await store.put(ARCHIVE, Uint8Array.of(1));
    await store.put(ARCHIVE, Uint8Array.of(2));
    await expect(store.put(ARCHIVE, Uint8Array.of(3))).rejects.toThrow('507');
    expect((await fetch(`${url}/v1/archives/..%2F..%2Fetc/blobs`)).status).toBe(404);
    expect((await fetch(`${url}/v1/archives/${ARCHIVE}/blobs/..%2Fsecret`)).status).toBe(405);
    expect((await fetch(`${url}/`)).status).toBe(404);
  });

  it('lets only the listed web origins use it from a browser', async () => {
    const url = await start({ allowedOrigins: ['https://wallet.example'] });
    const allowed = await fetch(`${url}/v1/archives/${ARCHIVE}/blobs`, { headers: { origin: 'https://wallet.example' } });
    const other = await fetch(`${url}/v1/archives/${ARCHIVE}/blobs`, { headers: { origin: 'https://elsewhere.example' } });
    expect(allowed.headers.get('access-control-allow-origin')).toBe('https://wallet.example');
    expect(other.headers.get('access-control-allow-origin')).toBeNull();
    const preflight = await fetch(`${url}/v1/archives/${ARCHIVE}/blobs`, { method: 'OPTIONS', headers: { origin: 'https://wallet.example' } });
    expect(preflight.status).toBe(204);
  });

  it('is reported as unreachable by the client when it is down', async () => {
    const url = await start();
    await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
    await expect(new HttpStore(url, 2_000).list(ARCHIVE)).rejects.toThrow();
  });
});
