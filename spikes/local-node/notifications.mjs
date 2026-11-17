// What Fulcrum on the local chain tells a wallet: notifications for an address,
// a chain of unconfirmed transactions, tokens in the list of unspent outputs,
// and the words it uses when the node refuses a transaction.
//
//   node spikes/local-node/notifications.mjs [tcp://127.0.0.1:60401 | ws://127.0.0.1:60403]
import { L, build, controllerInput, key, p2pkh, p2pkhInput, state, wallet, DELAY } from '../addresses/lib.mjs';
import { mine, reward, rpc, scriptHash, startClock } from './chain.mjs';
import { electrum, sleep } from './rpc.mjs';

const endpoint = process.argv[2] ?? 'tcp://127.0.0.1:60401';
const funder = key(0x31), watched = key(0x32), owner = key(1), recoverer = key(2), newOwner = key(3);
const to = (k, valueSatoshis = 0n) => ({ lockingBytecode: p2pkh(k), valueSatoshis });
const watchedHash = scriptHash(p2pkh(watched));

const events = [];
const t0 = Date.now();
const server = await electrum(endpoint, (method, params) => events.push({ at: Date.now() - t0, method, params }));
const waitFor = async (predicate, ms = 5000) => {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const found = events.find(predicate);
    if (found) return found;
    await sleep(20);
  }
  return undefined;
};
const say = (label, value) => console.log(`${label.padEnd(58)} ${typeof value === 'string' ? value : JSON.stringify(value)}`);

await startClock();
const { coin } = await reward(funder);
say('server', server.version);
say('status of a never-used address when subscribing', await server.request('blockchain.scripthash.subscribe', watchedHash));
await server.request('blockchain.headers.subscribe');

// ---- three transactions, each spending the one before, none confirmed
const first = build([p2pkhInput(coin, funder)], [to(watched, 50_000n), to(funder)], { remainder: 1 });
const second = build([p2pkhInput(first.coin(1), funder)], [to(watched, 60_000n), to(funder)], { remainder: 1 });
const third = build([p2pkhInput(first.coin(0), watched), p2pkhInput(second.coin(0), watched)], [to(watched)], { remainder: 0 });
for (const [label, tx] of [['first', first], ['second, spending the first', second], ['third, spending both payments', third]]) {
  const before = events.length, sentAt = Date.now();
  const txid = await server.request('blockchain.transaction.broadcast', tx.hex);
  const note = await waitFor((e) => events.indexOf(e) >= before && e.method === 'blockchain.scripthash.subscribe');
  say(`sent ${label} through Fulcrum`, `${txid === tx.txid ? 'accepted' : txid}; notification after ${note ? Date.now() - sentAt : 'none in 5 s'} ms`);
}
say('history while unconfirmed (height 0, or -1 with an unconfirmed parent)', (await server.request('blockchain.scripthash.get_history', watchedHash)).map((h) => h.height));
say('unspent while unconfirmed', (await server.request('blockchain.scripthash.listunspent', watchedHash)).map((u) => [u.height, u.value]));
say('balance', await server.request('blockchain.scripthash.get_balance', watchedHash));

const before = events.length, minedAt = Date.now();
await mine(1);
const header = await waitFor((e) => events.indexOf(e) >= before && e.method === 'blockchain.headers.subscribe');
const status = await waitFor((e) => events.indexOf(e) >= before && e.method === 'blockchain.scripthash.subscribe');
say('after a block: header notification, address notification', `${header ? header.at - (minedAt - t0) : 'none'} ms, ${status ? status.at - (minedAt - t0) : 'none'} ms`);
const tip = (await rpc('getblockcount'));
say('history after the block (all at the new height?)', (await server.request('blockchain.scripthash.get_history', watchedHash)).map((h) => h.height === tip));

// ---- a token: the controller's NFT in the list of unspent outputs
const { coin: second_reward } = await reward(funder);
const w = wallet(L.hexToBin(second_reward.txid), L.sha256.hash(Uint8Array.of(1)));
const active = state({ owner: owner.keyHash, recoverer: recoverer.keyHash });
const create = build([p2pkhInput(second_reward, funder)], [w.controllerOutput(active), to(funder)], { remainder: 1 });
await server.request('blockchain.transaction.broadcast', create.hex);
// Fulcrum learns of a transaction it relayed when it next reads the node's mempool, not at once.
const controllerHash = scriptHash(w.controller.locking);
const askedAt = Date.now();
let listed;
while (listed === undefined && Date.now() - askedAt < 5000) {
  [listed] = await server.request('blockchain.scripthash.listunspent', controllerHash, 'include_tokens');
  if (listed === undefined) await sleep(50);
}
say('time until a sent transaction shows in the list of unspent', `${Date.now() - askedAt} ms`);
// A client that negotiates a protocol version below 1.5 is not shown outputs with tokens unless it asks.
say('the controller, listed without asking for tokens (protocol 1.4)', (await server.request('blockchain.scripthash.listunspent', controllerHash)).length === 0 ? 'not listed' : 'listed');
say('the controller as Fulcrum lists it', { value: listed.value, category: listed.token_data?.category === second_reward.txid ? 'the identity' : listed.token_data?.category, capability: listed.token_data?.nft?.capability, commitmentBytes: (listed.token_data?.nft?.commitment ?? '').length / 2 });

// ---- refusals, as Fulcrum words them
const refused = async (label, tx) => {
  try { await server.request('blockchain.transaction.broadcast', tx.hex); say(label, 'accepted'); } catch (error) { say(label, error.message.replace(/\s*\n+\s*/g, ' ')); }
};
const pending = state({ status: 1, owner: owner.keyHash, recoverer: recoverer.keyHash, proposed: newOwner.keyHash });
const request = build([controllerInput(w, create.coin(0), 'requestRecovery', recoverer, [newOwner.keyHash]), p2pkhInput(create.coin(1), funder)], [w.controllerOutput(pending), to(funder)], { remainder: 1 });
await server.request('blockchain.transaction.broadcast', request.hex);
await refused('completion before its time', build([controllerInput(w, request.coin(0), 'finalizeRecovery', recoverer, [], DELAY), p2pkhInput(request.coin(1), funder)], [w.controllerOutput(state({ epoch: 1, owner: newOwner.keyHash, recoverer: recoverer.keyHash })), to(funder)], { remainder: 1 }));
await refused('fee one satoshi short', build([p2pkhInput(request.coin(1), funder)], [to(funder)], { remainder: 0, extraFee: -1n }));
await refused('an output below its smallest value', build([p2pkhInput(request.coin(1), funder)], [to(watched, 545n), to(funder)], { remainder: 1 }));
await refused('a transaction that is in the mempool already, sent again', request);
await mine(1);
await rpc('setmocktime', 0);
server.close();
