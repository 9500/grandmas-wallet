// Pays an address on chipnet from this project's funding key, for the scripted runs and for trying the
// public pages by hand.
//
// usage (from the repository's root):
//   npx tsx scripts/chipnet-pay.ts <address> <satoshis>   pay; the change returns to the funding address
//   npx tsx scripts/chipnet-pay.ts address                the funding address, to send coins back to
//   npx tsx scripts/chipnet-pay.ts balance                what the funding address holds
//
// The key is in .chipnet/funder-design-2.json, which is not in git.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { binToHex, cashAddressToLockingBytecode, hexToBin, lockingBytecodeToCashAddress } from '@bitauth/libauth';
import { type Utxo, buildTransaction, checkBeforeSending, keyPairFromPrivateKey, p2pkhInput, p2pkhLockingBytecode } from '@grandmas-wallet/core';

import { Electrum } from '../packages/chipnet/src/electrum.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const [first, second] = process.argv.slice(2);
if (first === undefined || (first !== 'address' && first !== 'balance' && second === undefined)) {
  console.error('usage: npx tsx scripts/chipnet-pay.ts <address> <satoshis> | address | balance');
  process.exit(2);
}

const funder = keyPairFromPrivateKey(hexToBin((JSON.parse(readFileSync(`${root}.chipnet/funder-design-2.json`, 'utf8')) as { privateKey: string }).privateKey));
const funderLocking = p2pkhLockingBytecode(funder.keyHash);
const funderAddress = (() => {
  const made = lockingBytecodeToCashAddress({ prefix: 'bchtest', bytecode: funderLocking });
  if (typeof made === 'string') throw new Error(made);
  return made.address;
})();
if (first === 'address') {
  console.log(funderAddress);
  process.exit(0);
}

const server = await Electrum.connect('wss://chipnet.9500.cash:443');
const listCoins = async (): Promise<Utxo[]> =>
  (await server.listUnspent(funderLocking, 'exclude')).map((entry) => ({
    transactionHash: hexToBin(entry.transactionId),
    index: entry.index,
    output: { lockingBytecode: funderLocking, valueSatoshis: entry.valueSatoshis },
  }));
let coins = await listCoins();
const holds = coins.reduce((sum, coin) => sum + coin.output.valueSatoshis, 0n);
if (first === 'balance') {
  console.log(`${holds} satoshis in ${coins.length} coin${coins.length === 1 ? '' : 's'} at ${funderAddress}`);
  await server.disconnect();
  process.exit(0);
}

const decoded = cashAddressToLockingBytecode(first.includes(':') ? first : `bchtest:${first}`);
if (typeof decoded === 'string' || decoded.prefix !== 'bchtest') {
  console.error(`not a chipnet address: ${first}`);
  process.exit(2);
}
const amount = BigInt(second as string);
if (holds < amount + 1_000n) {
  console.error(`not paid: the funding address holds ${holds} satoshis`);
  process.exit(1);
}
// Every coin goes in, so that the funding address ends with one coin again. Another run that paid from it at the same
// moment spends the same coins: the payment is built again from what it holds then, a few times.
let sent: string | undefined;
let refusal = '';
for (let attempt = 0; attempt < 5 && sent === undefined; attempt++) {
  if (attempt > 0) {
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    coins = await listCoins();
  }
  const built = buildTransaction({ inputs: coins.map((coin) => p2pkhInput(coin, funder)), outputs: [{ lockingBytecode: decoded.bytecode, valueSatoshis: amount }], changeLockingBytecode: funderLocking });
  const check = checkBeforeSending(built);
  if (check !== true) throw new Error(`the payment fails the check before sending: ${check}`);
  const result = await server.broadcast(binToHex(built.encoded));
  if (result.accepted) sent = built.transactionId;
  else refusal = result.reason;
}
await server.disconnect();
if (sent === undefined) {
  console.error(`not paid: ${refusal}`);
  process.exit(1);
}
console.log(`paid ${amount} satoshis in ${sent}:0, unconfirmed`);
process.exit(0);
