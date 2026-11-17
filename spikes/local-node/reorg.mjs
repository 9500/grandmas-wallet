// Undoing blocks on the local chain, and what Fulcrum reports while it happens:
// a confirmed payment returns to the mempool, is then dropped, and a different
// transaction spending the same coin is confirmed in its place.
//
// The coin is a block reward that has just become spendable. Undoing one block
// leaves the payment valid, so the node keeps it in its mempool. Undoing a
// second block makes the reward too young to spend, and the node drops the
// payment. That is the only way to get a transaction out of the mempool
// without restarting the node.
//
//   node spikes/local-node/reorg.mjs
import { build, key, p2pkh, p2pkhInput } from '../addresses/lib.mjs';
import { mine, reward, rpc, scriptHash, startClock } from './chain.mjs';
import { electrum, sleep } from './rpc.mjs';

const funder = key(0x51), first = key(0x52), second = key(0x53);
const to = (k) => ({ lockingBytecode: p2pkh(k), valueSatoshis: 0n });
const events = [];
const server = await electrum('tcp://127.0.0.1:60401', (method, params) => events.push({ method, params }));
const firstHash = scriptHash(p2pkh(first)), secondHash = scriptHash(p2pkh(second));
const say = (label, value) => console.log(`${label.padEnd(64)} ${typeof value === 'string' ? value : JSON.stringify(value)}`);

/** Waits until Fulcrum's answers stop changing, then reports them. */
const report = async (label) => {
  let last = '';
  for (let quiet = 0; quiet < 6; ) {
    await sleep(250);
    const now = JSON.stringify([await server.request('blockchain.headers.get_tip'), await server.request('blockchain.scripthash.get_history', firstHash), await server.request('blockchain.scripthash.get_history', secondHash)]);
    quiet = now === last ? quiet + 1 : 0;
    last = now;
  }
  const [tip, a, b] = JSON.parse(last);
  const heights = (history) => history.map((h) => h.height);
  say(label, { nodeTip: await rpc('getblockcount'), fulcrumTip: tip.height, firstAddress: heights(a), secondAddress: heights(b), mempool: (await rpc('getrawmempool')).length, notifications: events.splice(0).map((e) => (e.method.includes('headers') ? `header ${e.params[0].height}` : e.params[0] === firstHash ? 'first address' : 'second address')) });
};

await startClock();
const { coin } = await reward(funder, 99);            // spendable from the next block on
await server.request('blockchain.headers.subscribe');
await server.request('blockchain.scripthash.subscribe', firstHash);
await server.request('blockchain.scripthash.subscribe', secondHash);
events.length = 0;

const payment = build([p2pkhInput(coin, funder)], [to(first)], { remainder: 0 });
const replacement = build([p2pkhInput(coin, funder)], [to(second)], { remainder: 0 });
await rpc('sendrawtransaction', payment.hex);
const [paymentBlock] = await mine(1);
const parentBlock = (await rpc('getblockheader', paymentBlock)).previousblockhash;
await report('payment to the first address, confirmed');

await rpc('invalidateblock', paymentBlock);
await report('its block undone: the payment is back in the mempool');

await rpc('invalidateblock', parentBlock);
await report('one more block undone: the payment is dropped');
let known = true;
try { await server.request('blockchain.transaction.get', payment.txid); } catch { known = false; }
say('does Fulcrum still know the dropped payment?', known ? 'yes' : 'no');

await mine(1);
await rpc('sendrawtransaction', replacement.hex);
await mine(1);
await report('new blocks; the same coin now pays the second address');

let again = 'accepted';
try { await rpc('sendrawtransaction', payment.hex); } catch (error) { again = error.message; }
say('the first payment, sent again', again);
await rpc('setmocktime', 0);
server.close();
