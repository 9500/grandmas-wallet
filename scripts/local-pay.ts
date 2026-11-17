// Pays an address on the local node (regtest), for trying the pages and the scripted runs by hand.
//
// usage (from the repository's root):
//   npx tsx scripts/local-pay.ts <address or locking script as hex> <satoshis>   pay, then make one block
//   npx tsx scripts/local-pay.ts <address> <satoshis> --no-block                 pay and leave it unconfirmed
//   npx tsx scripts/local-pay.ts mine <blocks>                                   make blocks
//   npx tsx scripts/local-pay.ts time <seconds>                                  move the chain's clock on and make the blocks that carry it
//
// The payer is a key of its own, kept in .chipnet/local-funder.json. It is given a block reward when it
// holds nothing, which takes 101 blocks; after `deploy/regtest/regtest.sh reset` that happens again.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { binToHex, cashAddressToLockingBytecode, hexToBin, lockingBytecodeToCashAddress } from '@bitauth/libauth';
import { type Utxo, buildTransaction, checkBeforeSending, keyPairFromPrivateKey, p2pkhInput, p2pkhLockingBytecode } from '@grandmas-wallet/core';

import { Electrum } from '../packages/chipnet/src/electrum.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const cli = (...parameters: string[]): string => execFileSync(`${root}deploy/regtest/regtest.sh`, ['cli', ...parameters], { encoding: 'utf8' }).trim();
const burnAddress = (): string => {
  const made = lockingBytecodeToCashAddress({ prefix: 'bchreg', bytecode: hexToBin(`76a914${'00'.repeat(20)}88ac`) });
  if (typeof made === 'string') throw new Error(made);
  return made.address;
};
const mine = (blocks: number, to = burnAddress()): void => void cli('generatetoaddress', String(blocks), to);

const [first, second, ...flags] = process.argv.slice(2);
if (first === undefined || second === undefined) {
  console.error('usage: npx tsx scripts/local-pay.ts <address> <satoshis> [--no-block] | mine <blocks> | time <seconds>');
  process.exit(2);
}

if (first === 'mine') {
  mine(Number(second));
  console.log(`height ${cli('getblockcount')}`);
  process.exit(0);
}
if (first === 'time') {
  // The chain's clock is the median of the last eleven block times: the node's clock is moved on, and eleven blocks carry it.
  const tip = JSON.parse(cli('getblockheader', cli('getbestblockhash'))) as { time: number };
  cli('setmocktime', String(tip.time + Number(second)));
  mine(11);
  cli('setmocktime', '0');
  console.log(`the chain's clock moved on by ${second} seconds; height ${cli('getblockcount')}`);
  process.exit(0);
}

mkdirSync(`${root}.chipnet`, { recursive: true });
const keyFile = `${root}.chipnet/local-funder.json`;
if (!existsSync(keyFile)) writeFileSync(keyFile, JSON.stringify({ privateKey: binToHex(crypto.getRandomValues(new Uint8Array(32))) }), { mode: 0o600 });
const funder = keyPairFromPrivateKey(hexToBin((JSON.parse(readFileSync(keyFile, 'utf8')) as { privateKey: string }).privateKey));
const funderLocking = p2pkhLockingBytecode(funder.keyHash);

const decoded = /^[0-9a-f]+$/.test(first) ? hexToBin(first) : cashAddressToLockingBytecode(first.includes(':') ? first : `bchtest:${first}`);
const lockingBytecode = decoded instanceof Uint8Array ? decoded : typeof decoded === 'string' ? undefined : decoded.bytecode;
if (lockingBytecode === undefined) {
  console.error(`not an address: ${first}`);
  process.exit(2);
}

const server = await Electrum.connect('ws://127.0.0.1:60403');
const coins = async (): Promise<Utxo[]> =>
  (await server.listUnspent(funderLocking, 'exclude'))
    // A block reward can be spent after 100 blocks; anything else at once.
    .map((entry) => ({ transactionHash: hexToBin(entry.transactionId), index: entry.index, output: { lockingBytecode: funderLocking, valueSatoshis: entry.valueSatoshis } }));
let held = await coins();
if (held.reduce((sum, coin) => sum + coin.output.valueSatoshis, 0n) < BigInt(second) + 10_000n) {
  const made = lockingBytecodeToCashAddress({ prefix: 'bchreg', bytecode: funderLocking });
  if (typeof made === 'string') throw new Error(made);
  mine(1, made.address);
  mine(100);
  for (let attempt = 0; attempt < 40 && held.length === 0; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    held = await coins();
  }
}
// The largest coin pays: a reward that is not yet 100 blocks old is refused, and the next attempt takes another.
held.sort((a, b) => (a.output.valueSatoshis > b.output.valueSatoshis ? -1 : 1));
let sent: string | undefined;
let refusal = 'the payer holds no coin';
for (const coin of held) {
  if (coin.output.valueSatoshis < BigInt(second) + 1_000n) continue;
  const built = buildTransaction({ inputs: [p2pkhInput(coin, funder)], outputs: [{ lockingBytecode, valueSatoshis: BigInt(second) }], changeLockingBytecode: funderLocking });
  const check = checkBeforeSending(built);
  if (check !== true) throw new Error(`the payment fails the check before sending: ${check}`);
  const result = await server.broadcast(binToHex(built.encoded));
  if (result.accepted) {
    sent = built.transactionId;
    break;
  }
  refusal = result.reason;
}
await server.disconnect();
if (sent === undefined) {
  console.error(`not paid: ${refusal}`);
  process.exit(1);
}
if (!flags.includes('--no-block')) mine(1);
console.log(`paid ${second} satoshis in ${sent}:0${flags.includes('--no-block') ? ', unconfirmed' : `, confirmed at height ${cli('getblockcount')}`}`);
process.exit(0);
