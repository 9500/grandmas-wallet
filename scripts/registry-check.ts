// Resolve one token category from the chain, as the wallet does (docs/token-registries.md, section 5.1), and say
// what came back, how many requests it took and how long. Read-only: it sends no transaction.
//
// usage (from packages/app):
//   npx tsx ../../scripts/registry-check.ts <category> [electrum endpoint ...]
// The endpoints default to the chipnet servers of deploy/config/production.json.
import { readFileSync } from 'node:fs';

import { type RegistryState, TokenRegistries, httpRegistryFetch } from '@grandmas-wallet/app';
import { connectChain } from '../packages/ui/src/environment.js';

const [category, ...given] = process.argv.slice(2);
if (category === undefined) {
  console.error('usage: registry-check.ts <category> [electrum endpoint ...]');
  process.exit(1);
}
const config = JSON.parse(readFileSync(new URL('../deploy/config/production.json', import.meta.url), 'utf8')) as { chain?: string[]; networks?: { chipnet?: { chain?: string[] } } };
const connection = await connectChain(given.length > 0 ? given : (config.networks?.chipnet?.chain ?? config.chain ?? []));
const counts = { getTransaction: 0, getHistory: 0, listUnspent: 0, fetch: 0 };
const chain = {
  getTransaction: (id: string) => ((counts.getTransaction += 1), connection.chain.getTransaction(id)),
  getHistory: (script: Uint8Array) => ((counts.getHistory += 1), connection.chain.getHistory(script)),
  listUnspent: (script: Uint8Array) => ((counts.listUnspent += 1), connection.chain.listUnspent(script)),
};
let state: RegistryState | undefined;
const registries = new TokenRegistries({
  chain,
  fetch: (url) => ((counts.fetch += 1), httpRegistryFetch(url)),
  kept: () => state,
  store: (next) => void (state = next),
  config: { mode: 'chain' },
});
const started = performance.now();
await registries.refresh([category]);
const first = Math.round(performance.now() - started);
const firstCounts = { ...counts };
// A second look, as on opening the wallet again: one question whether the head moved.
const again = new TokenRegistries({ chain, fetch: httpRegistryFetch, kept: () => state, store: (next) => void (state = next), config: { mode: 'chain' } });
const secondStarted = performance.now();
await again.refresh([category]);
const second = Math.round(performance.now() - secondStarted);
console.log(JSON.stringify({ kept: state?.entries[0], firstLook: { milliseconds: first, requests: firstCounts }, secondLook: { milliseconds: second, chainRequests: counts.getTransaction + counts.getHistory + counts.listUnspent - firstCounts.getTransaction - firstCounts.getHistory - firstCounts.listUnspent } }, null, 2));
process.exit(0);
