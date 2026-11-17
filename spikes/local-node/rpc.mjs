// Access to the local regtest node and its Fulcrum, for the trials.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import net from 'node:net';

export const REGTEST_DIR = process.env.REGTEST_DIR ?? join(homedir(), '.local/share/grandmas-wallet/regtest');

const settings = (file) =>
  Object.fromEntries(
    readFileSync(file, 'utf8')
      .split('\n')
      .filter((line) => line.includes('=') && !line.trim().startsWith('#'))
      .map((line) => [line.slice(0, line.indexOf('=')).trim(), line.slice(line.indexOf('=') + 1).trim()]),
  );

/** A JSON-RPC caller for a node, from its bitcoin.conf (or explicit settings). */
export const nodeRpc = (conf = settings(join(REGTEST_DIR, 'node/bitcoin.conf'))) => {
  const url = conf.url ?? `http://127.0.0.1:${conf.rpcport}/`;
  const user = conf.rpcuser ?? conf.user;
  const password = conf.rpcpassword ?? conf.password;
  return async (method, ...params) => {
    const response = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}` },
      body: JSON.stringify({ id: 1, method, params }),
    });
    const body = await response.json();
    if (body.error) throw new Error(`${method}: ${body.error.message}`);
    return body.result;
  };
};

/**
 * A bare Electrum connection: newline-delimited JSON over TCP, or WebSocket.
 * `request` resolves with the result; notifications go to `onNotification`.
 */
export const electrum = async (endpoint, onNotification = () => {}) => {
  const url = new URL(endpoint);
  let nextId = 1;
  const waiting = new Map();
  const handle = (text) => {
    for (const line of text.split('\n')) {
      if (line.trim() === '') continue;
      const message = JSON.parse(line);
      for (const item of Array.isArray(message) ? message : [message]) {
        if (item.id !== undefined && item.id !== null && waiting.has(item.id)) {
          const { resolve, reject } = waiting.get(item.id);
          waiting.delete(item.id);
          if (item.error) reject(new Error(typeof item.error === 'string' ? item.error : item.error.message));
          else resolve(item.result);
        } else if (item.method !== undefined) {
          onNotification(item.method, item.params);
        }
      }
    }
  };
  let send, close;
  if (url.protocol === 'tcp:') {
    const socket = net.connect(Number(url.port), url.hostname);
    await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('error', reject); });
    let buffer = '';
    socket.on('data', (data) => {
      buffer += data;
      const end = buffer.lastIndexOf('\n');
      if (end >= 0) { handle(buffer.slice(0, end)); buffer = buffer.slice(end + 1); }
    });
    send = (text) => socket.write(`${text}\n`);
    close = () => socket.end();
  } else {
    const socket = new WebSocket(endpoint);
    await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = () => reject(new Error(`cannot connect to ${endpoint}`)); });
    socket.onmessage = (event) => handle(String(event.data));
    send = (text) => socket.send(text);
    close = () => socket.close();
  }
  const request = (method, ...params) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      waiting.set(id, { resolve, reject });
      send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
    });
  /** Several requests in one JSON-RPC batch. Resolves with results in order. */
  const batch = (calls) =>
    Promise.all(
      (() => {
        const promises = [];
        const messages = calls.map(([method, ...params]) => {
          const id = nextId++;
          promises.push(new Promise((resolve, reject) => waiting.set(id, { resolve, reject })));
          return { jsonrpc: '2.0', id, method, params };
        });
        send(JSON.stringify(messages));
        return promises;
      })(),
    );
  const version = await request('server.version', 'trial', '1.4');
  return { request, batch, close, version };
};

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
