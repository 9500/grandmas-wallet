// Small helpers for trials on the local chain.
import { L, key, p2pkh } from '../addresses/lib.mjs';
import { nodeRpc } from './rpc.mjs';

export const rpc = nodeRpc();
export const miner = key(8);
export const regtestAddress = (k) => L.lockingBytecodeToCashAddress({ bytecode: p2pkh(k), prefix: 'bchreg' }).address;
export const mine = (count, k = miner) => rpc('generatetoaddress', count, regtestAddress(k));
export const scriptHash = (lockingBytecode) => L.binToHex(L.sha256.hash(lockingBytecode).reverse());

/**
 * Sets the node's clock to now, or to just after the chain's median time if
 * earlier trials have moved the chain ahead of the real clock. Returns it.
 */
export const startClock = async () => {
  const { mediantime } = await rpc('getblockchaininfo');
  const start = Math.max(Math.floor(Date.now() / 1000), mediantime + 1);
  await rpc('setmocktime', start);
  return start;
};

/** A block reward paid to `k`, as a coin. `confirmations` blocks are mined on top; 100 make it spendable. */
export const reward = async (k, confirmations = 100) => {
  const [block] = await mine(1, k);
  if (confirmations > 0) await mine(confirmations);
  const txid = (await rpc('getblock', block)).tx[0];
  const transaction = await rpc('getrawtransaction', txid, true);
  return { block, coin: { txid, index: 0, output: { lockingBytecode: p2pkh(k), valueSatoshis: BigInt(Math.round(transaction.vout[0].value * 1e8)) } } };
};
