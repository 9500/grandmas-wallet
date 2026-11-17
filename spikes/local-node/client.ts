// Does this project's own Electrum client (packages/chipnet) work against the
// local Fulcrum, over TCP and over WebSocket?
//
//   node --experimental-transform-types spikes/local-node/client.ts
import { Electrum } from '../../packages/chipnet/src/electrum.ts';
// @ts-expect-error plain JavaScript helpers of the trials
import { L, build, key, p2pkh, p2pkhInput, state, wallet } from '../addresses/lib.mjs';
// @ts-expect-error plain JavaScript helpers of the trials
import { mine, reward, rpc, startClock } from './chain.mjs';

const funder = key(0x61), owner = key(1), recoverer = key(2);
await startClock();
for (const endpoint of process.argv.slice(2).length > 0 ? process.argv.slice(2) : ['ws://127.0.0.1:60403', 'tcp://127.0.0.1:60401']) {
  let chain: Electrum;
  try {
    chain = await Promise.race([Electrum.connect(endpoint), new Promise<never>((_, reject) => setTimeout(() => reject(new Error('no connection within 10 seconds')), 10_000))]);
  } catch (error) {
    console.log(endpoint, 'cannot connect:', (error as Error).message);
    continue;
  }
  const { coin } = await reward(funder);
  const w = wallet(L.hexToBin(coin.txid), L.sha256.hash(Uint8Array.of(1)));
  const create = build([p2pkhInput(coin, funder)], [w.controllerOutput(state({ owner: owner.keyHash, recoverer: recoverer.keyHash })), { lockingBytecode: p2pkh(funder), valueSatoshis: 0n }], { remainder: 1 });
  const sent = await chain.broadcast(create.hex);
  const again = await chain.broadcast(create.hex);
  await new Promise((resolve) => setTimeout(resolve, 1500));
  const controller = await chain.listUnspent(w.controller.locking);
  const change = await chain.listUnspent(p2pkh(funder));
  const history = await chain.getHistory(w.controller.locking);
  const fetched = await chain.getTransaction(create.txid);
  await mine(1);
  await new Promise((resolve) => setTimeout(resolve, 1500));
  console.log(endpoint, JSON.stringify({
    software: chain.software,
    tip: (await chain.tip()).height === (await rpc('getblockcount')),
    relayFeePerKilobyte: await chain.relayFeePerKilobyte(),
    broadcast: sent.accepted, broadcastAgain: again.accepted ? 'accepted' : again.reason,
    controllerListed: controller.map((u) => ({ sat: Number(u.valueSatoshis), hasToken: u.hasToken })),
    changeListed: change.filter((u) => u.transactionId === create.txid).length,
    historyOfController: history.length,
    transactionFetched: fetched === create.hex,
  }));
  await chain.disconnect();
}
await rpc('setmocktime', 0);
// A failed connection leaves the client's timers running.
process.exit(0);
