import { type ChildProcess, spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { type IncomingHttpHeaders, type Server, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * The loan page's server (deploy/serve.mjs) forwarding the service's path, as on the public host: the headers the
 * service reads arrive as the client sent them, Cloudflare's client address among them, with the client's address in
 * X-Forwarded-For.
 */

const root = fileURLToPath(new URL('../../../', import.meta.url));
let behind: Server;
let page: ChildProcess;
let directory: string;
let address: string;
const received: IncomingHttpHeaders[] = [];

beforeAll(async () => {
  behind = createServer((request, response) => {
    received.push(request.headers);
    request.resume();
    request.on('end', () => response.writeHead(200, { 'content-type': 'application/json' }).end('{}'));
  });
  await new Promise<void>((resolve) => behind.listen(0, '127.0.0.1', resolve));
  directory = mkdtempSync(join(tmpdir(), 'forward-'));
  const config = join(directory, 'config.json');
  writeFileSync(config, JSON.stringify({ network: 'regtest', chain: [], relays: [], stores: [] }));
  const port = 20_000 + Math.floor(Math.random() * 20_000);
  page = spawn(process.execPath, [`${root}deploy/serve.mjs`, '--root', `${root}deploy/placeholder/jar`, '--config', config, '--host', '127.0.0.1', '--port', String(port), '--forward', `/service/=http://127.0.0.1:${(behind.address() as AddressInfo).port}`], { stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('the page\'s server did not start')), 10_000);
    createInterface({ input: page.stdout as NodeJS.ReadableStream }).on('line', (line) => {
      if (/ at http:/.test(line)) {
        clearTimeout(timer);
        resolve();
      }
    });
    page.on('exit', (code) => reject(new Error(`the page's server ended with ${code}`)));
  });
  address = `http://127.0.0.1:${port}/service/v1`;
}, 20_000);

afterAll(async () => {
  page?.kill('SIGTERM');
  await new Promise<void>((resolve) => behind.close(() => resolve()));
  rmSync(directory, { recursive: true, force: true });
});

describe('the loan page\'s server forwarding to the service', () => {
  it('passes Cloudflare\'s client address through unchanged, with the headers it passed before and X-Forwarded-For', async () => {
    const answer = await fetch(address, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://wallet.example', 'cf-connecting-ip': '203.0.113.7', 'x-forwarded-for': '198.51.100.1, 172.64.0.9', cookie: 'not=passed' }, body: '{}' });
    expect(answer.status).toBe(200);
    const [headers] = received.slice(-1);
    expect(headers).toMatchObject({ 'content-type': 'application/json', origin: 'https://wallet.example', 'cf-connecting-ip': '203.0.113.7', 'x-forwarded-for': '198.51.100.1, 172.64.0.9' });
    expect(headers?.cookie).toBeUndefined();
  });

  it('passes no such header where the client sent none, and gives the connection\'s address in X-Forwarded-For', async () => {
    expect((await fetch(address, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status).toBe(200);
    const [headers] = received.slice(-1);
    expect(headers?.['cf-connecting-ip']).toBeUndefined();
    expect(headers?.['x-forwarded-for']).toBe('127.0.0.1');
  });
});
