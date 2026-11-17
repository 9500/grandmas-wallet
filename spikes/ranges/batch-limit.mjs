// The largest JSON-RPC batch a server takes.
//   node spikes/ranges/batch-limit.mjs <endpoint> [sizes...]
import * as L from '@bitauth/libauth';

import { electrum } from '../local-node/rpc.mjs';

const [endpoint, ...sizes] = process.argv.slice(2);
for (const size of sizes.length > 0 ? sizes.map(Number) : [345, 346, 1000]) {
  const server = await electrum(endpoint);
  const calls = Array.from({ length: size }, (_, n) => ['blockchain.scripthash.get_history', L.binToHex(L.sha256.hash(L.utf8ToBin(`batch:${Date.now()}:${n}`)))]);
  const outcome = await Promise.race([
    server.batch(calls).then(() => 'answered', (error) => `refused: ${error.message}`),
    new Promise((resolve) => setTimeout(() => resolve('no answer within 10 seconds'), 10_000)),
  ]);
  console.log(`${endpoint}  batch of ${size}: ${outcome}`);
  server.close();
}
process.exit(0);
