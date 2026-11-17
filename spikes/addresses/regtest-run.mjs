// One representative life of a wallet on the local regtest node: receive at
// three recoverable addresses and a vault address, pay by key, request,
// cancel, request, complete with the clock moved, sweep, spend from the
// vault, close. Each transaction is checked in the virtual machine first and
// then tried and sent on the node, so the two verdicts can be compared.
//
//   node spikes/addresses/regtest-run.mjs [--json]
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { nodeRpc } from '../local-node/rpc.mjs';
import { DELAY, L, build, controllerInput, key, keyInput, p2pkh, p2pkhInput, state, sweepInput, vaultInput, verify, wallet } from './lib.mjs';

const rpc = nodeRpc();
const funder = key(9), owner = key(1), recoverer = key(2), newOwner = key(3), payee = key(4), feeKey = key(5), stranger = key(6), miner = key(8);
const regtestAddress = (k) => L.lockingBytecodeToCashAddress({ bytecode: p2pkh(k), prefix: 'bchreg' }).address;
const mine = (count, k = miner) => rpc('generatetoaddress', count, regtestAddress(k));

const rows = [];
let failed = false;
/** `expect`: 'accept', 'refuse' (both agree) or 'node-only' (the node refuses what the virtual machine cannot judge). */
const step = async (label, built, expect = 'accept') => {
  const local = verify(built);
  const [dry] = await rpc('testmempoolaccept', [built.hex]);
  let sent = 'accepted';
  try { await rpc('sendrawtransaction', built.hex); } catch (error) { sent = error.message.replace('sendrawtransaction: ', ''); }
  const vmAccepts = local === true, nodeAccepts = sent === 'accepted';
  const ok = dry.allowed === nodeAccepts && (expect === 'accept' ? vmAccepts && nodeAccepts : expect === 'refuse' ? !vmAccepts && !nodeAccepts : vmAccepts && !nodeAccepts);
  if (!ok) failed = true;
  rows.push({ label, bytes: built.size, fee: Number(built.fee), txid: nodeAccepts ? built.txid : undefined, vm: vmAccepts ? 'accepted' : String(local).replace(/^Unable to verify (standard )?transaction: /, ''), dryRun: dry.allowed ? 'allowed' : dry['reject-reason'], node: sent, ok });
  console.log(`${ok ? 'ok ' : 'BAD'} ${label.padEnd(62)} ${String(built.size).padStart(5)} B  vm: ${vmAccepts ? 'accepted' : 'refused'}  node: ${nodeAccepts ? 'accepted' : sent}`);
  return built;
};

// ---- a mature coin for the funder; its transaction's identifier becomes the identity
const realStart = Date.now();
const tipTime = (await rpc('getblockchaininfo')).mediantime;
const start = Math.max(Math.floor(Date.now() / 1000), tipTime + 1);
await rpc('setmocktime', start);
const [fundingBlock] = await mine(1, funder);
await mine(100);
const coinbaseId = (await rpc('getblock', fundingBlock)).tx[0];
const coinbase = await rpc('getrawtransaction', coinbaseId, true);
const funding = { txid: coinbaseId, index: 0, output: { lockingBytecode: p2pkh(funder), valueSatoshis: BigInt(Math.round(coinbase.vout[0].value * 1e8)) } };

const identity = L.hexToBin(coinbaseId);
const w = wallet(identity, L.sha256.hash(Uint8Array.of(11)));          // the first seed's addresses
const w2 = wallet(identity, L.sha256.hash(Uint8Array.of(12)));         // the new seed's addresses, same identity
const addressKey = (n) => key(0x20 + n);
const address = (n) => w.recoverable(0, n, addressKey(n));
const change = (n) => w.recoverable(1, n, key(0x60 + n));
const newAddress = (n) => w2.recoverable(0, n, key(0x90 + n));
const at = (a, valueSatoshis = 0n) => ({ lockingBytecode: a.locking, valueSatoshis });
const to = (k, valueSatoshis = 0n) => ({ lockingBytecode: p2pkh(k), valueSatoshis });

const active = state({ owner: owner.keyHash, recoverer: recoverer.keyHash });
const pendingTo = (k) => state({ status: 1, owner: owner.keyHash, recoverer: recoverer.keyHash, proposed: k.keyHash });
const recovered = state({ epoch: 1, owner: newOwner.keyHash, recoverer: recoverer.keyHash });

// ---- create and receive
const create = await step('create the controller', build([p2pkhInput(funding, funder)], [w.controllerOutput(active), to(funder)], { remainder: 1 }));
const receive = await step('receive at three addresses, a vault address, and fee coins', build(
  [p2pkhInput(create.coin(1), funder)],
  [at(address(0), 100_000n), at(address(1), 60_000n), at(address(2), 40_000n), at(w.vault(0), 30_000n), at(change(0), 5_000n), to(feeKey, 10_000n), to(funder)],
  { remainder: 6 },
));
let controller = create.coin(0);

// ---- pay by key
await step('pay by key, signed by another key (AD02)', build([keyInput(receive.coin(0), address(0), stranger)], [to(payee, 50_000n), at(change(1))], { remainder: 1 }), 'refuse');
const payment = await step('pay by key, with change to a fresh address', build([keyInput(receive.coin(0), address(0))], [to(payee, 50_000n), at(change(1))], { remainder: 1 }));

// ---- request, cancel
await step('request with a sweep attached (AD05)', build(
  [controllerInput(w, controller, 'requestRecovery', recoverer, [stranger.keyHash]), sweepInput(w, receive.coin(1), address(1))],
  [w.controllerOutput(pendingTo(stranger)), to(stranger)], { remainder: 1 }), 'refuse');
const request1 = await step('request recovery to a key of a stranger', build(
  [controllerInput(w, controller, 'requestRecovery', recoverer, [stranger.keyHash]), p2pkhInput(receive.coin(5), feeKey)],
  [w.controllerOutput(pendingTo(stranger)), to(feeKey)], { remainder: 1 }));
controller = request1.coin(0);
const cancel = await step('cancel, fee from the wallet\'s coin kept for it', build(
  [controllerInput(w, controller, 'ownerAuthorize', owner), keyInput(receive.coin(4), change(0))],
  [w.controllerOutput(active), at(change(2))], { remainder: 1 }));
controller = cancel.coin(0);

// ---- request again, wait, complete
const request2 = await step('request recovery to the new device\'s key', build(
  [controllerInput(w, controller, 'requestRecovery', recoverer, [newOwner.keyHash]), p2pkhInput(request1.coin(1), feeKey)],
  [w.controllerOutput(pendingTo(newOwner)), to(feeKey)], { remainder: 1 }));
controller = request2.coin(0);
const [requestBlock] = await mine(1);
const completion = build(
  [controllerInput(w, controller, 'finalizeRecovery', recoverer, [], DELAY), p2pkhInput(request2.coin(1), feeKey)],
  [w.controllerOutput(recovered), to(feeKey)], { remainder: 1 });
await step('complete right after the request', completion, 'node-only');
// The wait counts from the median time of the block before the one that holds the request. With a
// fixed clock, block times still creep forward (a block must be later than the median of the eleven
// before it), so the reference is read from the node, not assumed.
const before = await rpc('getblockheader', (await rpc('getblockheader', requestBlock)).previousblockhash);
const waitFrom = before.mediantime;
const medianNow = async () => (await rpc('getblockchaininfo')).mediantime;
await rpc('setmocktime', waitFrom + 511);
await mine(11);
await step(`complete at median time ${(await medianNow()) - waitFrom} seconds after the reference`, completion, 'node-only');
await rpc('setmocktime', waitFrom + 512);
while ((await medianNow()) < waitFrom + 512) await mine(1);
await step(`complete at median time ${(await medianNow()) - waitFrom} seconds after the reference`, completion);
controller = completion.coin(0);

// ---- the earlier owner is out; the new owner sweeps
await step('sweep approved by the earlier owner\'s key (AD07)', build(
  [controllerInput(w, controller, 'ownerAuthorize', owner), sweepInput(w, receive.coin(1), address(1))],
  [w.controllerOutput(recovered), at(newAddress(0))], { remainder: 1 }), 'refuse');
await step('sweep with a wrong secret (AD04)', build(
  [controllerInput(w, controller, 'ownerAuthorize', newOwner), sweepInput(w, receive.coin(1), address(1), { secret: address(2).secret })],
  [w.controllerOutput(recovered), at(newAddress(0))], { remainder: 1 }), 'refuse');
const sweep = await step('sweep four coins to an address of the new seed', build(
  [controllerInput(w, controller, 'ownerAuthorize', newOwner), sweepInput(w, receive.coin(1), address(1)), sweepInput(w, receive.coin(2), address(2)), sweepInput(w, payment.coin(1), change(1)), sweepInput(w, cancel.coin(1), change(2))],
  [w.controllerOutput(recovered), at(newAddress(0))], { remainder: 1 }));
controller = sweep.coin(0);

// ---- vault, close
await step('spend the vault coin, signed for by the earlier owner (AD09)', build(
  [controllerInput(w, controller, 'ownerAuthorize', owner), vaultInput(w, receive.coin(3), w.vault(0))],
  [w.controllerOutput(recovered), at(newAddress(1))], { remainder: 1 }), 'refuse');
const vault = await step('spend the vault coin to an address of the new seed', build(
  [controllerInput(w, controller, 'ownerAuthorize', newOwner), vaultInput(w, receive.coin(3), w.vault(0))],
  [w.controllerOutput(recovered), at(newAddress(1))], { remainder: 1 }));
controller = vault.coin(0);
await step('close with nothing else in the transaction', build([controllerInput(w, controller, 'ownerClose', newOwner)], [to(funder)], { remainder: 0 }), 'refuse');
await step('close signed by the recoverer', build([controllerInput(w, controller, 'ownerClose', recoverer), keyInput(sweep.coin(1), newAddress(0)), keyInput(vault.coin(1), newAddress(1))], [to(funder)], { remainder: 0 }), 'refuse');
const close = await step('close: the last coins and the controller\'s value in one output', build(
  [controllerInput(w, controller, 'ownerClose', newOwner), keyInput(sweep.coin(1), newAddress(0)), keyInput(vault.coin(1), newAddress(1))],
  [to(funder)], { remainder: 0 }));
await mine(1);

// ---- what is left
const unspent = async (coin) => (await rpc('gettxout', coin.txid, coin.index)) !== null;
const left = { controller: await unspent(controller), closingOutput: await unspent(close.coin(0)), closingOutputSatoshis: Number(close.transaction.outputs[0].valueSatoshis) };
await rpc('setmocktime', 0);
const summary = { date: new Date().toISOString(), node: (await rpc('getnetworkinfo')).subversion, blocks: await rpc('getblockcount'), secondsOfRealTime: (Date.now() - realStart) / 1000, left };
console.log(JSON.stringify(summary));
console.log(failed ? 'SOMETHING DID NOT GO AS EXPECTED' : 'All as expected.');
if (process.argv.includes('--json')) {
  const dir = join(dirname(fileURLToPath(import.meta.url)), 'results');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'regtest.json'), `${JSON.stringify({ ...summary, steps: rows }, null, 2)}\n`);
}
process.exitCode = failed ? 1 : 0;
