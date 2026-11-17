// Measures what the full pass costs for a wallet with several seeds, at the sizes of the address scheme
// (acceptance test KV13). It only looks addresses up; nothing is sent.
//
// usage: npx tsx scripts/full-pass-cost.ts <name>=<endpoint> [<name>=<endpoint> ...] [--seeds 3]
//        e.g. npx tsx scripts/full-pass-cost.ts "local node=ws://127.0.0.1:60403" "the user's chipnet server=wss://chipnet.9500.cash:443"
import { generateBip39Mnemonic } from '@bitauth/libauth';
import { type ChainReader, ADDRESS_KIND, ADDRESS_RANGE, deriveSeedKeys, fullPass, quickPass } from '@grandmas-wallet/core';

import { Electrum } from '../packages/chipnet/src/electrum.js';

const args = process.argv.slice(2);
const seedsAt = args.indexOf('--seeds');
const seedCount = seedsAt < 0 ? 3 : Number(args[seedsAt + 1]);
const servers = args.filter((arg, index) => arg.includes('=') && (seedsAt < 0 || index !== seedsAt + 1)).map((arg) => {
  const at = arg.indexOf('=');
  return { name: arg.slice(0, at), endpoint: arg.slice(at + 1) };
});
if (servers.length === 0) {
  console.error('usage: npx tsx scripts/full-pass-cost.ts <name>=<endpoint> ... [--seeds 3]');
  process.exit(2);
}

// Example numbers of the templates: the cost does not depend on them.
const numbers = { controller: 11, givenOut: 22, change: 33, standardWallet: 44 };
const identity = new Uint8Array(32).fill(0x5a);
const seeds = Array.from({ length: seedCount }, () => deriveSeedKeys(generateBip39Mnemonic(), 'testnet', numbers).viewingKey);
const perSeed = ADDRESS_RANGE[ADDRESS_KIND.givenOut] + ADDRESS_RANGE[ADDRESS_KIND.change] + ADDRESS_RANGE[ADDRESS_KIND.vault];
const seconds = (ms: number): string => (ms / 1000).toFixed(1);

const rows: string[] = [];
for (const { name, endpoint } of servers) {
  const server = await Electrum.connect(endpoint);
  let requests = 0;
  const reader: ChainReader = {
    getHistory: (lockingBytecode) => { requests += 1; return server.getHistory(lockingBytecode); },
    listUnspent: async (lockingBytecode) => { requests += 1; return (await server.listUnspent(lockingBytecode)).map((entry) => ({ ...entry, hasToken: entry.token !== undefined })); },
    getTransaction: (transactionId) => { requests += 1; return server.getTransaction(transactionId); },
  };
  try {
    const quickStarted = Date.now();
    let quickLookups = 0;
    for (const viewingKey of seeds) quickLookups += (await quickPass(reader, identity, viewingKey)).lookups;
    const quickMs = Date.now() - quickStarted;

    requests = 0;
    const started = Date.now();
    let lookups = 0;
    let complete = true;
    for (const viewingKey of seeds) {
      const result = await fullPass(reader, identity, viewingKey);
      lookups += result.lookups;
      if (result.status !== 'complete') {
        complete = false;
        console.error(`${name}: the pass stopped: ${result.reason}`);
        break;
      }
    }
    const ms = Date.now() - started;
    rows.push(`| ${name} | ${seedCount} | ${lookups.toLocaleString('en')} | ${requests.toLocaleString('en')} | ${seconds(ms)} s | ${(ms / (lookups / 1000)).toFixed(0)} ms | ${complete ? 'complete' : '**stopped**'} | ${quickLookups} lookups, ${seconds(quickMs)} s |`);
  } finally {
    await server.disconnect();
  }
}

console.log(`Full pass over ${perSeed.toLocaleString('en')} addresses for each seed (10,000 given out, 10,000 change, 1,000 vault), for a wallet with no coins, in batches of 300 addresses.`);
console.log('The time includes working the addresses out on this machine.');
console.log('');
console.log('| Server | Seeds | Addresses looked up | Requests | Time | Per 1,000 addresses | Result | Quick pass, for comparison |');
console.log('| --- | --- | --- | --- | --- | --- | --- | --- |');
for (const row of rows) console.log(row);
process.exit(0);
