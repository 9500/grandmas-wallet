import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { type IncomingMessage, type Server, type ServerResponse, createServer } from 'node:http';
import { join } from 'node:path';

/**
 * A backup store for restoration archives.
 *
 * Keeps sealed blobs under the archive they belong to and gives them back.
 * It holds no keys and cannot read what it keeps. A blob is named by the
 * SHA-256 of its bytes; the name returned from a write is the store's
 * acknowledgment that it has the blob on disk.
 *
 *   POST /v1/archives/{archive}/blobs          body: the blob     -> { "blobId": "..." }
 *   GET  /v1/archives/{archive}/blobs                             -> { "blobs": ["...", ...] }
 *   GET  /v1/archives/{archive}/blobs/{blob}                      -> the blob
 */

export interface StoreOptions {
  /** Directory the blobs are kept in. Without one, they are kept in memory only. */
  directory?: string;
  /** Web origins allowed to use the store from a browser; `*` for any. */
  allowedOrigins?: string[];
  maximumBlobBytes?: number;
  maximumBlobsPerArchive?: number;
}

const ARCHIVE = /^[0-9a-f]{32}$/;
const BLOB = /^[0-9a-f]{64}$/;

interface Backend {
  put(archive: string, blob: string, bytes: Uint8Array): void;
  list(archive: string): string[];
  get(archive: string, blob: string): Uint8Array | undefined;
}

const memoryBackend = (): Backend => {
  const archives = new Map<string, Map<string, Uint8Array>>();
  return {
    put: (archive, blob, bytes) => {
      archives.set(archive, (archives.get(archive) ?? new Map<string, Uint8Array>()).set(blob, bytes));
    },
    list: (archive) => [...(archives.get(archive)?.keys() ?? [])],
    get: (archive, blob) => archives.get(archive)?.get(blob),
  };
};

const directoryBackend = (directory: string): Backend => ({
  put: (archive, blob, bytes) => {
    const folder = join(directory, archive);
    mkdirSync(folder, { recursive: true });
    // Written under another name first, so a blob is either fully on disk or absent.
    const temporary = join(folder, `.${blob}.partial`);
    writeFileSync(temporary, bytes, { flush: true });
    renameSync(temporary, join(folder, blob));
  },
  list: (archive) => {
    const folder = join(directory, archive);
    return existsSync(folder) ? readdirSync(folder).filter((name) => BLOB.test(name)) : [];
  },
  get: (archive, blob) => {
    const file = join(directory, archive, blob);
    return existsSync(file) ? new Uint8Array(readFileSync(file)) : undefined;
  },
});

const readBody = (request: IncomingMessage, limit: number): Promise<Uint8Array | undefined> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size <= limit) chunks.push(chunk);
    });
    request.on('end', () => resolve(size > limit ? undefined : new Uint8Array(Buffer.concat(chunks))));
    request.on('error', reject);
  });

export const createStoreServer = (options: StoreOptions = {}): Server => {
  const backend = options.directory === undefined ? memoryBackend() : directoryBackend(options.directory);
  const allowedOrigins = options.allowedOrigins ?? ['*'];
  const maximumBlobBytes = options.maximumBlobBytes ?? 256 * 1024;
  const maximumBlobs = options.maximumBlobsPerArchive ?? 10_000;

  const send = (response: ServerResponse, status: number, body: object | Uint8Array): void => {
    const bytes = body instanceof Uint8Array ? body : Buffer.from(JSON.stringify(body));
    response.writeHead(status, {
      'content-type': body instanceof Uint8Array ? 'application/octet-stream' : 'application/json',
      'content-length': bytes.length,
      'cache-control': 'no-store',
    });
    response.end(bytes);
  };

  const handle = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const origin = request.headers.origin;
    if (allowedOrigins.includes('*')) response.setHeader('access-control-allow-origin', '*');
    else if (origin !== undefined && allowedOrigins.includes(origin)) {
      response.setHeader('access-control-allow-origin', origin);
      response.setHeader('vary', 'origin');
    }
    if (request.method === 'OPTIONS') {
      response.writeHead(204, { 'access-control-allow-methods': 'GET, POST', 'access-control-allow-headers': 'content-type', 'access-control-max-age': '86400' });
      response.end();
      return;
    }

    const [, version, collection, archive, blobs, blob, ...rest] = new URL(request.url ?? '/', 'http://store').pathname.split('/');
    if (version !== 'v1' || collection !== 'archives' || archive === undefined || !ARCHIVE.test(archive) || blobs !== 'blobs' || rest.length > 0) {
      send(response, 404, { error: 'not found' });
      return;
    }

    if (request.method === 'POST' && blob === undefined) {
      const bytes = await readBody(request, maximumBlobBytes);
      if (bytes === undefined || bytes.length === 0) {
        send(response, 413, { error: `a blob is between 1 and ${maximumBlobBytes} bytes` });
        return;
      }
      const blobId = createHash('sha256').update(bytes).digest('hex');
      if (backend.get(archive, blobId) === undefined) {
        if (backend.list(archive).length >= maximumBlobs) {
          send(response, 507, { error: 'this archive is full' });
          return;
        }
        backend.put(archive, blobId, bytes);
      }
      send(response, 200, { blobId });
      return;
    }
    if (request.method === 'GET' && blob === undefined) {
      send(response, 200, { blobs: backend.list(archive) });
      return;
    }
    if (request.method === 'GET' && blob !== undefined && BLOB.test(blob)) {
      const bytes = backend.get(archive, blob);
      if (bytes === undefined) send(response, 404, { error: 'not found' });
      else send(response, 200, bytes);
      return;
    }
    send(response, 405, { error: 'method not allowed' });
  };

  return createServer((request, response) => {
    handle(request, response).catch(() => {
      if (!response.headersSent) send(response, 500, { error: 'the store failed' });
      else response.end();
    });
  });
};
