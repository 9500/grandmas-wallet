// Sizes of inputs and whole transactions, measured on signed transactions that
// pass the 2026 rules with standardness in the libauth virtual machine, and
// the refusals of AD02, AD04, AD05 and AD06.
//
//   node spikes/addresses/measure.mjs            prints the tables
//   node spikes/addresses/measure.mjs --json     also writes results/vm.json
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CONTROLLER, DELAY, L, RECOVERABLE, VAULT, build, controllerInput, dust, failingInput, key, keyInput, p2pkh, p2pkhInput, state, sweepInput, vaultInput, verify, wallet } from './lib.mjs';

const owner = key(1), recoverer = key(2), newOwner = key(3), payee = key(4), feeKey = key(5), stranger = key(6);
const identity = L.hash256(Uint8Array.of(7));
const w = wallet(identity, L.sha256.hash(Uint8Array.of(8)));
const other = wallet(L.hash256(Uint8Array.of(9)), L.sha256.hash(Uint8Array.of(10)));

let counter = 0;
/** A coin that exists only for this measurement. */
const coinAt = (output) => ({ txid: L.binToHex(L.hash256(Uint8Array.of(counter & 0xff, counter++ >> 8))), index: 0, output });
const at = (address, valueSatoshis = 100_000n) => coinAt({ lockingBytecode: address.locking, valueSatoshis });
const addressKey = (n) => key(0x20 + n);
const address = (n) => w.recoverable(0, n, addressKey(n));
const changeAddress = (n) => w.recoverable(1, n, key(0x60 + n));

const active = state({ owner: owner.keyHash, recoverer: recoverer.keyHash });
const pending = state({ status: 1, owner: owner.keyHash, recoverer: recoverer.keyHash, proposed: newOwner.keyHash });
const recovered = state({ epoch: 1, owner: newOwner.keyHash, recoverer: recoverer.keyHash });
const ctl = (stateBytes, wal = w) => coinAt(wal.controllerOutput(stateBytes));

const results = { scripts: {}, inputs: {}, transactions: [], refusals: [], outputs: {} };
let failed = false;
const expectAccepted = (label, built) => {
  const verdict = verify(built);
  if (verdict !== true) {
    failed = true;
    console.log(`BAD  ${label}: ${verdict}`);
  }
  return built;
};

// ---- scripts
results.scripts = {
  'recoverable address, rules': RECOVERABLE.length,
  'recoverable address, with tag and key hash': address(0).redeem.length,
  'vault address, rules': VAULT.length,
  'vault address, with tag': w.vault(0).redeem.length,
  'controller with ownerClose, rules': CONTROLLER.length,
  'controller with ownerClose, with identity': w.controller.redeem.length,
};
results.outputs = {
  'P2PKH output': { bytes: 34, smallest: Number(dust({ lockingBytecode: p2pkh(payee), valueSatoshis: 0n })) },
  'output at an address of the wallet (P2SH32)': { bytes: L.encodeTransactionOutput({ lockingBytecode: address(0).locking, valueSatoshis: 0n }).length, smallest: Number(dust({ lockingBytecode: address(0).locking, valueSatoshis: 0n })) },
  'controller output': { bytes: L.encodeTransactionOutput(w.controllerOutput(active)).length, smallest: Number(dust(w.controllerOutput(active))) },
};

// ---- whole transactions
const transactions = [];
const record = (label, built, note = '') => {
  expectAccepted(label, built);
  transactions.push({ label, bytes: built.size, fee: Number(built.fee), inputs: built.labels.map((l, n) => `${l} ${built.inputSizes[n]}`), outputs: built.outputSizes, note });
  return built;
};

for (const signingType of [0x61, 0x41]) {
  const suffix = signingType === 0x61 ? '' : ' (signing type 0x41)';
  const options = { signingType };
  const payment = build([keyInput(at(address(0)), address(0))], [{ lockingBytecode: p2pkh(payee), valueSatoshis: 50_000n }, { lockingBytecode: changeAddress(0).locking, valueSatoshis: 0n }], { remainder: 1, ...options });
  record(`payment by key, one input, change${suffix}`, payment);
  if (signingType === 0x41) continue;

  record('payment by key, one input, no change', build([keyInput(at(address(1)), address(1))], [{ lockingBytecode: p2pkh(payee), valueSatoshis: 0n }], { remainder: 0 }));
  record('for comparison: P2PKH payment, one input, P2PKH change', build([p2pkhInput(coinAt({ lockingBytecode: p2pkh(feeKey), valueSatoshis: 100_000n }), feeKey)], [{ lockingBytecode: p2pkh(payee), valueSatoshis: 50_000n }, { lockingBytecode: p2pkh(feeKey), valueSatoshis: 0n }], { remainder: 1 }));

  for (const count of [1, 5, 20]) {
    const coins = Array.from({ length: count }, (_, n) => sweepInput(w, at(address(n)), address(n)));
    record(`sweep of ${count} coin${count === 1 ? '' : 's'} into one output`, build([controllerInput(w, ctl(recovered), 'ownerAuthorize', newOwner), ...coins], [w.controllerOutput(recovered), { lockingBytecode: changeAddress(0).locking, valueSatoshis: 0n }], { remainder: 1 }));
  }
  record('sweep of 5 coins and a vault coin, one output each', build(
    [controllerInput(w, ctl(recovered), 'ownerAuthorize', newOwner), ...Array.from({ length: 5 }, (_, n) => sweepInput(w, at(address(n)), address(n))), vaultInput(w, at(w.vault(0)), w.vault(0))],
    [w.controllerOutput(recovered), ...Array.from({ length: 5 }, (_, n) => ({ lockingBytecode: changeAddress(n).locking, valueSatoshis: 90_000n })), { lockingBytecode: changeAddress(5).locking, valueSatoshis: 0n }],
    { remainder: 6 },
  ));
  record('spend from a vault address to a P2PKH address', build([controllerInput(w, ctl(active), 'ownerAuthorize', owner), vaultInput(w, at(w.vault(0)), w.vault(0))], [w.controllerOutput(active), { lockingBytecode: p2pkh(payee), valueSatoshis: 0n }], { remainder: 1 }));

  const feeCoin = () => keyInput(at(address(9), 5_000n), address(9));
  const feeChange = { lockingBytecode: changeAddress(9).locking, valueSatoshis: 0n };
  record('cancel, fee from a coin of the wallet, change', build([controllerInput(w, ctl(pending), 'ownerAuthorize', owner), feeCoin()], [w.controllerOutput(active), feeChange], { remainder: 1 }));
  record('change of settings (ownerUpdate), fee from a coin of the wallet, change', build(
    [controllerInput(w, ctl(active), 'ownerUpdate', owner, [newOwner.keyHash, recoverer.keyHash, Uint8Array.of(1, 0, 0x40)]), feeCoin()],
    [w.controllerOutput(recovered), feeChange], { remainder: 1 }));
  const recovererCoin = () => p2pkhInput(coinAt({ lockingBytecode: p2pkh(feeKey), valueSatoshis: 10_000n }), feeKey);
  const recovererChange = { lockingBytecode: p2pkh(feeKey), valueSatoshis: 0n };
  record('request, fee from the recoverer\'s P2PKH coin, change', build([controllerInput(w, ctl(active), 'requestRecovery', recoverer, [newOwner.keyHash]), recovererCoin()], [w.controllerOutput(pending), recovererChange], { remainder: 1 }));
  record('completion, fee from the recoverer\'s P2PKH coin, change', build([controllerInput(w, ctl(pending), 'finalizeRecovery', recoverer, [], DELAY), recovererCoin()], [w.controllerOutput(recovered), recovererChange], { remainder: 1 }),
    'the virtual machine does not check that the wait has passed');
  record('close with one coin of the wallet, to a P2PKH address', build([controllerInput(w, ctl(active), 'ownerClose', owner), keyInput(at(address(2), 10_000n), address(2))], [{ lockingBytecode: p2pkh(payee), valueSatoshis: 0n }], { remainder: 0 }));
}
results.transactions = transactions;

// ---- one input of each kind, taken from the transactions above
const inputSize = (label) => {
  for (const t of transactions) for (const i of t.inputs) if (i.startsWith(label)) return Number(i.slice(label.length + 1));
  return undefined;
};
results.inputs = Object.fromEntries(['spent by key', 'swept', 'vault', 'controller ownerAuthorize', 'controller requestRecovery', 'controller finalizeRecovery', 'controller ownerUpdate', 'controller ownerClose', 'P2PKH'].map((l) => [l, inputSize(l)]));

// ---- refusals
const out = (n = 0) => ({ lockingBytecode: changeAddress(n).locking, valueSatoshis: 0n });
const refusal = (id, label, built, expectedInput) => {
  const verdict = verify(built);
  const index = failingInput(verdict);
  const ok = verdict !== true && index === expectedInput;
  if (!ok) failed = true;
  results.refusals.push({ id, label, refused: verdict !== true, byInput: index, expectedInput, reason: verdict === true ? 'accepted' : String(verdict).replace(/^.*input index \d+: /, '') });
};
const accepted = (id, label, built) => {
  const verdict = verify(built);
  if (verdict !== true) failed = true;
  results.refusals.push({ id, label, refused: verdict !== true, reason: verdict === true ? 'accepted' : String(verdict) });
};

accepted('AD01', 'a coin spent by its key, no controller in the transaction', build([keyInput(at(address(0)), address(0))], [out()], { remainder: 0 }));
refusal('AD02', 'the same with another key', build([keyInput(at(address(0)), address(0), stranger)], [out()], { remainder: 0 }), 0);
accepted('AD03', 'two coins and a vault coin swept with the owner\'s approval',
  build([controllerInput(w, ctl(active), 'ownerAuthorize', owner), sweepInput(w, at(address(0)), address(0)), sweepInput(w, at(address(1)), address(1)), vaultInput(w, at(w.vault(0)), w.vault(0))], [w.controllerOutput(active), out()], { remainder: 1 }));
const sweepWith = (override) => build([controllerInput(w, ctl(active), 'ownerAuthorize', owner), sweepInput(w, at(address(0)), address(0), override)], [w.controllerOutput(active), out()], { remainder: 1 });
refusal('AD04', 'a sweep with the wrong secret', sweepWith({ secret: address(1).secret }), 1);
refusal('AD04', 'a sweep that names another identity', sweepWith({ identity: other.forScript }), 1);
refusal('AD04', 'a vault spend with the wrong secret', build([controllerInput(w, ctl(active), 'ownerAuthorize', owner), vaultInput(w, at(w.vault(0)), w.vault(0), { secret: w.vault(1).secret })], [w.controllerOutput(active), out()], { remainder: 1 }), 1);
refusal('AD05', 'a sweep attached to a request', build([controllerInput(w, ctl(active), 'requestRecovery', recoverer, [stranger.keyHash]), sweepInput(w, at(address(0)), address(0))], [w.controllerOutput(state({ status: 1, owner: owner.keyHash, recoverer: recoverer.keyHash, proposed: stranger.keyHash })), out()], { remainder: 1 }), 1);
refusal('AD05', 'a sweep attached to a completion', build([controllerInput(w, ctl(pending), 'finalizeRecovery', recoverer, [], DELAY), sweepInput(w, at(address(0)), address(0))], [w.controllerOutput(recovered), out()], { remainder: 1 }), 1);
refusal('AD05', 'a vault spend attached to a request', build([controllerInput(w, ctl(active), 'requestRecovery', recoverer, [stranger.keyHash]), vaultInput(w, at(w.vault(0)), w.vault(0))], [w.controllerOutput(state({ status: 1, owner: owner.keyHash, recoverer: recoverer.keyHash, proposed: stranger.keyHash })), out()], { remainder: 1 }), 1);
refusal('AD06', 'the controller not at input 0', build([sweepInput(w, at(address(0)), address(0)), controllerInput(w, ctl(active), 'ownerAuthorize', owner)], [w.controllerOutput(active), out()], { remainder: 1 }), 0);
const otherActive = state({ owner: stranger.keyHash, recoverer: recoverer.keyHash });
refusal('AD06', 'another wallet\'s controller, the sweep naming this wallet', build([controllerInput(other, ctl(otherActive, other), 'ownerAuthorize', stranger), sweepInput(w, at(address(0)), address(0))], [other.controllerOutput(otherActive), out()], { remainder: 1 }), 1);
refusal('AD06', 'another wallet\'s controller, the sweep naming that wallet', build([controllerInput(other, ctl(otherActive, other), 'ownerAuthorize', stranger), sweepInput(w, at(address(0)), address(0), { identity: other.forScript })], [other.controllerOutput(otherActive), out()], { remainder: 1 }), 1);
const updated = (fields, args) => build([controllerInput(w, ctl(active), 'ownerUpdate', owner, args), sweepInput(w, at(address(0)), address(0))], [w.controllerOutput(state({ owner: owner.keyHash, recoverer: recoverer.keyHash, ...fields })), out()], { remainder: 1 });
const sameDelay = Uint8Array.of(1, 0, 0x40);
refusal('AD06', 'a successor with a changed owner', updated({ owner: newOwner.keyHash, epoch: 1 }, [newOwner.keyHash, recoverer.keyHash, sameDelay]), 1);
refusal('AD06', 'a successor with a changed recoverer', updated({ recoverer: stranger.keyHash }, [owner.keyHash, stranger.keyHash, sameDelay]), 1);
refusal('AD06', 'a successor with a changed waiting period', updated({ delay: 0x400002 }, [owner.keyHash, recoverer.keyHash, Uint8Array.of(2, 0, 0x40)]), 1);
accepted('AD12', 'a sweep beside an ownerUpdate that changes nothing', updated({}, [owner.keyHash, recoverer.keyHash, sameDelay]));

// ---- report
const table = (rows) => rows.forEach((r) => console.log('  ' + r.join('  ')));
console.log('Scripts (bytes)');
table(Object.entries(results.scripts).map(([k, v]) => [k.padEnd(46), String(v).padStart(4)]));
console.log('\nOutputs (bytes, smallest value in satoshis)');
table(Object.entries(results.outputs).map(([k, v]) => [k.padEnd(46), String(v.bytes).padStart(4), String(v.smallest).padStart(5)]));
console.log('\nInputs (bytes, outpoint and sequence number included)');
table(Object.entries(results.inputs).map(([k, v]) => [k.padEnd(46), String(v).padStart(4)]));
console.log('\nTransactions (bytes = fee in satoshis at one satoshi per byte)');
table(transactions.map((t) => [t.label.padEnd(74), String(t.bytes).padStart(5), t.fee === t.bytes ? '' : `fee ${t.fee}`]));
console.log('\nRefusals and acceptances');
table(results.refusals.map((r) => [r.id, r.label.padEnd(60), r.refused ? `refused by input ${r.byInput}: ${r.reason}` : 'accepted']));
console.log(failed ? '\nSOMETHING DID NOT GO AS EXPECTED' : '\nAll as expected.');

if (process.argv.includes('--json')) {
  const dir = join(dirname(fileURLToPath(import.meta.url)), 'results');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'vm.json'), `${JSON.stringify(results, null, 2)}\n`);
}
process.exitCode = failed ? 1 : 0;
