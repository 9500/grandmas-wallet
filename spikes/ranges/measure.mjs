// How long does it take to look up every address of a range?
//
//   node spikes/ranges/measure.mjs <endpoint> <mode> [counts...]
//     mode  full      history lookups and subscriptions for each count (own servers only)
//           polite    a small fixed sample, at most about 270 requests in all (public servers)
//           limit     subscribe until the server refuses (the local server only)
//   node spikes/ranges/measure.mjs derive [count]     time to compute addresses, no network
//
// Addresses asked for are ones nobody has used, which is what nearly every
// address of a range is.
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as L from '@bitauth/libauth';

import { electrum } from '../local-node/rpc.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const resultsFile = join(here, 'results.json');
const save = (key, value) => {
  mkdirSync(here, { recursive: true });
  const all = existsSync(resultsFile) ? JSON.parse(readFileSync(resultsFile, 'utf8')) : {};
  all[key] = { ...(all[key] ?? {}), ...value, ...(value.runs ? { runs: { ...(all[key]?.runs ?? {}), ...value.runs } } : {}), date: new Date().toISOString() };
  writeFileSync(resultsFile, `${JSON.stringify(all, null, 2)}\n`);
};

/** Script hashes of addresses that do not exist; `salt` keeps runs apart. */
const hashes = (count, salt) => Array.from({ length: count }, (_, n) => L.binToHex(L.sha256.hash(L.utf8ToBin(`${salt}:${n}`))));
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const clock = async (work) => { const started = performance.now(); const value = await work(); return { ms: performance.now() - started, value }; };

/** All calls, with at most `window` waiting for an answer at a time. */
const pipelined = async (server, calls, window) => {
  let next = 0, errors = 0;
  const worker = async () => {
    while (next < calls.length) {
      const call = calls[next++];
      try { await server.request(...call); } catch { errors += 1; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(window, calls.length) }, worker));
  return errors;
};
const batched = async (server, calls, size) => {
  let errors = 0;
  for (let at = 0; at < calls.length; at += size) {
    try { await server.batch(calls.slice(at, at + size)); } catch { errors += 1; }
  }
  return errors;
};
const perThousand = (ms, count) => Math.round((ms / count) * 1000);
const line = (label, count, ms, extra = '') => console.log(`  ${label.padEnd(44)} ${String(count).padStart(7)} in ${(ms / 1000).toFixed(2).padStart(7)} s  = ${String(perThousand(ms, count)).padStart(6)} ms per 1,000 ${extra}`);

const roundTrip = async (server) => {
  const times = [];
  for (let n = 0; n < 10; n++) times.push((await clock(() => server.request('server.ping'))).ms);
  return median(times);
};

const derive = (count) => {
  // What a device computes for one address of section 7: the public key of
  // child (c, i), its hash, the secret, the tag, the script and its hashes.
  const seed = L.sha256.hash(L.utf8ToBin('trial'));
  const master = L.deriveHdPrivateNodeFromSeed(seed, { assumeValidity: true });
  const node = L.deriveHdPublicNode(L.deriveHdPath(master, "m/44'/1'/1'"));
  const chain = L.deriveHdPublicNodeChild(node, 0);
  const blinding = L.sha256.hash(seed), identity = L.hash256(seed);
  const rules = new Uint8Array(96);
  const started = performance.now();
  for (let i = 0; i < count; i++) {
    const child = L.deriveHdPublicNodeChild(chain, i);
    const keyHash = L.hash160(child.publicKey);
    const secret = L.hash256(L.flattenBinArray([blinding, Uint8Array.of(0), L.numberToBinUint32LE(i)]));
    const tag = L.hash256(L.flattenBinArray([identity, secret]));
    const redeem = L.flattenBinArray([L.encodeDataPush(keyHash), L.encodeDataPush(tag), rules]);
    L.sha256.hash(L.encodeLockingBytecodeP2sh32(L.hash256(redeem)));
  }
  return performance.now() - started;
};

const [target, mode, ...rest] = process.argv.slice(2);
if (target === 'derive') {
  const count = Number(mode ?? 10_000);
  const ms = derive(count);
  line('computing addresses (this machine, one thread)', count, ms);
  save('derive', { count, ms: Math.round(ms), msPerThousand: perThousand(ms, count) });
  process.exit(0);
}

const server = await electrum(target);
const salt = `${Date.now()}`;
console.log(`${target}  ${JSON.stringify(server.version)}`);
const ping = await roundTrip(server);
console.log(`  round trip (median of 10 pings): ${ping.toFixed(1)} ms`);
const out = { software: server.version[0], roundTripMs: Math.round(ping * 10) / 10 };

if (mode === 'polite') {
  const lookups = hashes(100, salt).map((h) => ['blockchain.scripthash.get_history', h]);
  const a = await clock(() => pipelined(server, lookups, 20));
  line('history, 20 at a time', 100, a.ms, a.value ? `(${a.value} errors)` : '');
  const b = await clock(() => batched(server, hashes(100, `${salt}b`).map((h) => ['blockchain.scripthash.get_history', h]), 100));
  line('history, one batch of 100', 100, b.ms, b.value ? `(${b.value} errors)` : '');
  const subs = hashes(30, `${salt}s`);
  const c = await clock(() => pipelined(server, subs.map((h) => ['blockchain.scripthash.subscribe', h]), 10));
  line('subscribe, 10 at a time', 30, c.ms, c.value ? `(${c.value} errors)` : '');
  await pipelined(server, subs.map((h) => ['blockchain.scripthash.unsubscribe', h]), 10);
  Object.assign(out, { history20: perThousand(a.ms, 100), historyBatch100: perThousand(b.ms, 100), subscribe10: perThousand(c.ms, 30) });
} else if (mode === 'limit') {
  // Subscribe in batches until the server says no. The connection is closed afterwards, which drops them all.
  let accepted = 0, refusal;
  const all = hashes(120_000, salt);
  for (let at = 0; at < all.length && refusal === undefined; at += 300) {
    const results = await Promise.allSettled(all.slice(at, at + 300).map((h) => server.request('blockchain.scripthash.subscribe', h)));
    accepted += results.filter((r) => r.status === 'fulfilled').length;
    refusal = results.find((r) => r.status === 'rejected')?.reason.message;
  }
  console.log(`  subscriptions accepted before a refusal: ${accepted}${refusal ? `; then: ${refusal}` : ' (no refusal)'}`);
  Object.assign(out, { subscriptionsAccepted: accepted, refusal });
} else {
  const counts = rest.length > 0 ? rest.map(Number) : [1000, 10_000];
  out.runs = {};
  for (const count of counts) {
    console.log(`  -- ${count} addresses`);
    const run = {};
    const calls = (suffix) => hashes(count, `${salt}${suffix}${count}`).map((h) => ['blockchain.scripthash.get_history', h]);
    if (count <= 1000) {
      const a = await clock(() => pipelined(server, calls('one').slice(0, 200), 1));
      line('history, one at a time', 200, a.ms);
      run.oneAtATime = perThousand(a.ms, 200);
    }
    for (const window of [20, 100, 500]) {
      const a = await clock(() => pipelined(server, calls(`w${window}`), window));
      line(`history, ${window} at a time`, count, a.ms, a.value ? `(${a.value} errors)` : '');
      run[`window${window}`] = perThousand(a.ms, count);
    }
    for (const size of [100, 300]) {
      const a = await clock(() => batched(server, calls(`b${size}`), size));
      line(`history, batches of ${size}`, count, a.ms, a.value ? `(${a.value} batches refused)` : '');
      run[`batch${size}`] = a.value ? `refused (${a.value})` : perThousand(a.ms, count);
    }
    const subs = hashes(count, `${salt}s${count}`);
    const a = await clock(() => pipelined(server, subs.map((h) => ['blockchain.scripthash.subscribe', h]), 100));
    line('subscribe, 100 at a time', count, a.ms, a.value ? `(${a.value} errors)` : '');
    run.subscribe100 = a.value ? `errors (${a.value})` : perThousand(a.ms, count);
    const b = await clock(() => pipelined(server, subs.map((h) => ['blockchain.scripthash.unsubscribe', h]), 100));
    line('unsubscribe, 100 at a time', count, b.ms, b.value ? `(${b.value} errors)` : '');
    out.runs[count] = run;
  }
}
save(`${target} ${mode}`, out);
server.close();
