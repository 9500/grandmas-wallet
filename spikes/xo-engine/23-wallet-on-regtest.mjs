// Trial: the wallet of the v0.4 design through the engine, on the local regtest chain.
// Create a controller; make three addresses with our tags and the engine's keys, and one whose key the
// engine does not hold; receive at all four; pay from one by its key; sweep the other three with the controller.
import { binToHex, hexToBin, hash160, hash256, sha256, encodeLockingBytecodeP2sh32, encodeDataPush, flattenBinArray, secp256k1 } from '@bitauth/libauth';
import { readFileSync } from 'node:fs';
import { p2pkhTemplate } from '@xo-cash/templates';
import { openEngineRegtest, rpc, mine, BURN } from './regtest.mjs';
import { show } from './common.mjs';
import { walletTrialTemplate } from './wallet-trial-template.mjs';

const errors = [];
console.error = (...args) => errors.push(String(args[0]).slice(0, 200));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const idOf = (stored) => stored.invitation?.invitationIdentifier ?? stored.invitationIdentifier;
const v = (variableIdentifier, value) => ({ variableIdentifier, roleIdentifier: 'owner', value });
const outpoint = (u, inputIdentifier) => ({ outpointTransactionHash: hexToBin(u.outpointTransactionHash), outpointIndex: u.outpointIndex, ...(inputIdentifier ? { inputIdentifier } : {}) });

const engine = await openEngineRegtest(process.argv[2] ?? 'trial23');
const finish = async (id, label) => {
  const own = await engine.listOwnInputIndexes(id);
  for (const index of own) await engine.signInvitation(id, index);
  const missing = await engine.listMissingRequirements(id);
  let built;
  try {
    built = (await engine.executeAction(id, { broadcastTransaction: true })).builtTransaction;
  } catch (error) {
    if (error.name !== 'UnspentOutputNotFoundInStoreError') { show(`${label} missing requirements`, missing); throw error; }
    const first = Object.values((await engine.getInvitation(id)).invitation?.result?.transactions ?? {})[0] ?? {};
    built = { transactionHash: first.transactionHash, transactionByteLength: 0 };
  }
  console.log(`${label}: accepted by the node, ${built.transactionHash}, ${built.transactionByteLength} bytes, signed inputs ${JSON.stringify(own)}`);
  return built;
};
const waitFor = async (what, check) => {
  for (let attempt = 0; attempt < 40; attempt++) { const found = await check(); if (found) return found; await wait(500); }
  throw new Error(`timed out waiting for ${what}`);
};

try {
  const p2pkh = (await engine.importTemplate(p2pkhTemplate)).templateIdentifier;
  const wallet = (await engine.importTemplate(walletTrialTemplate)).templateIdentifier;
  const coinPolicies = { change: { templateIdentifier: p2pkh }, receive: { templateIdentifier: p2pkh }, address: { templateIdentifier: p2pkh } };
  await engine.setDefaultPolicies(coinPolicies);
  const coinLocking = await engine.generateLockingBytecodeFromDefaultPolicy('receive');
  await mine(1, coinLocking);
  await mine(100, BURN);
  const funding = await waitFor('a mature coin that is output 0', async () =>
    (await engine.listSpendableUnspentOutputs({ templateIdentifier: p2pkh })).find((u) => u.outpointIndex === 0));

  // --- create the controller; the identity is the transaction whose output 0 is spent
  const identity = funding.outpointTransactionHash;
  const recovererKeyHash = binToHex(hash160(Uint8Array.of(7)));
  const template = await engine.getTemplate(wallet);
  let id = idOf(await engine.createInvitation({
    templateIdentifier: wallet, actionIdentifier: 'create', intent: template.start[0],
    variables: [v('identity', identity), v('recovererKeyHash', recovererKeyHash)],
    inputs: [outpoint(funding)],
  }));
  const secretOf = async (name) => (await engine.listSecretData()).filter((s) => s.secretIdentifier === name && s.templateIdentifier === wallet);
  const controllerPublicKey = await engine.getSecretPublicKey((await secretOf('controllerKey'))[0].secretLookupKey);
  const ownerKeyHash = binToHex(hash160(hexToBin(controllerPublicKey)));
  await engine.appendInvitation(id, { variables: [v('ownerKeyHash', ownerKeyHash)] });
  await engine.appendInvitation(id, { outputs: [{ outputIdentifier: 'initialControllerOutput' }, { lockingBytecode: hexToBin(coinLocking), valueSatoshis: BigInt(funding.valueSatoshis) - 1000n - 1000n }] });
  const created = await finish(id, 'create');
  const state = `010000000000${ownerKeyHash}${recovererKeyHash}010040${'00'.repeat(20)}`;

  // --- addresses: our secrets and tags; the engine's keys for three, a key of our own for the fourth
  const identityInScript = hexToBin(identity).reverse();
  const secret = (n) => sha256.hash(Uint8Array.of(0x5e, n));
  const tagOf = (s) => hash256(flattenBinArray([identityInScript, s]));
  const body = hexToBin(readFileSync(new URL('../addresses/artifacts/recoverableAddress.hex', import.meta.url), 'utf8').trim());
  const expected = (keyHash, tag) => binToHex(encodeLockingBytecodeP2sh32(hash256(flattenBinArray([encodeDataPush(keyHash), encodeDataPush(tag), body]))));
  await engine.setDefaultPolicies({ ...coinPolicies, address: { templateIdentifier: wallet }, receive: { templateIdentifier: wallet } });
  const own = [];
  for (const n of [0, 1, 2]) {
    const values = { tag: binToHex(tagOf(secret(n))), identity, addressSecret: binToHex(secret(n)) };
    own.push({ n, locking: await engine.generateLockingBytecodeFromDefaultPolicy('address', values) });
  }
  const addressSecrets = await secretOf('addressKey');
  for (const entry of own) {
    const publicKeys = await Promise.all(addressSecrets.map((s) => engine.getSecretPublicKey(s.secretLookupKey)));
    entry.matchesOurs = publicKeys.some((pk) => expected(hash160(hexToBin(pk)), tagOf(secret(entry.n))) === entry.locking);
  }
  const foreignKeyHash = hash160(secp256k1.derivePublicKeyCompressed(new Uint8Array(32).fill(0x42)));
  const foreign = {
    locking: await engine.generateLockingBytecodeFromDefaultPolicy('receive', {
      keyHash: binToHex(foreignKeyHash), tag: binToHex(tagOf(secret(9))), identity, addressSecret: binToHex(secret(9)), sentSatoshis: 1000n,
    }),
  };
  foreign.matchesOurs = expected(foreignKeyHash, tagOf(secret(9))) === foreign.locking;
  await engine.setDefaultPolicies(coinPolicies);
  show('addresses equal our own computation', { own: own.map((e) => e.matchesOurs), foreign: foreign.matchesOurs });
  show('keys the engine used (derivation indexes)', (await engine.listSecretData()).filter((s) => s.templateIdentifier === wallet).map((s) => `${s.secretIdentifier} ${s.value}`).sort());

  // --- receive: nothing but a payment to each address
  for (const { locking } of [...own, foreign]) await mine(1, locking);
  await mine(100, BURN);
  // An unspent output is listed by script hash; the script hash list ties it to its locking bytecode.
  const scriptHashOf = new Map((await engine.listScriptHashes()).map((s) => [s.lockingBytecode, s.scriptHash]));
  for (const entry of [...own, foreign]) entry.scriptHash = scriptHashOf.get(entry.locking);
  const held = await waitFor('the four coins', async () => {
    const all = (await engine.listUnspentOutputs()).filter((u) => [...own, foreign].some((e) => e.scriptHash === u.scriptHash));
    return all.length === 4 ? all : undefined;
  });
  show('the engine follows', held.map((u) => `${u.scriptHash.slice(0, 12)}… ${u.valueSatoshis} sat, ${u.templateIdentifier === wallet ? 'wallet template' : u.templateIdentifier}, selectable ${u.selectable}`));
  const coinAt = (entry) => held.find((u) => u.scriptHash === entry.scriptHash);

  // --- pay from the first address by its key; no controller in the transaction
  const first = coinAt(own[0]);
  id = idOf(await engine.createInvitation({
    templateIdentifier: wallet, actionIdentifier: 'pay', intent: template.lockingScripts.ownAddressLockingScript.roles.owner.actions[0],
    variables: [v('sentSatoshis', BigInt(first.valueSatoshis) - 1000n), v('recipientLockingScript', coinLocking)],
    inputs: [outpoint(first, 'spendInput')],
  }));
  await engine.appendInvitation(id, { outputs: [{ outputIdentifier: 'paymentOutput' }] });
  await finish(id, 'pay by key');

  // --- sweep the other three with the controller: each input shows the identity and its own secret
  const swept = [own[1], own[2], foreign].map(coinAt);
  const total = swept.reduce((sum, u) => sum + BigInt(u.valueSatoshis), 0n);
  id = idOf(await engine.createInvitation({
    templateIdentifier: wallet, actionIdentifier: 'sweep', intent: template.lockingScripts.controllerLockingScript.roles.owner.actions[0],
    variables: [v('identity', identity), v('stateBody', state.slice(4, 98)), v('sentSatoshis', total - 2000n), v('recipientLockingScript', coinLocking)],
    inputs: [{ outpointTransactionHash: hexToBin(created.transactionHash), outpointIndex: 0, inputIdentifier: 'controllerOwnerInput' }, ...swept.map((u) => outpoint(u, 'sweptInput'))],
  }));
  await engine.appendInvitation(id, { outputs: [{ outputIdentifier: 'activeControllerOutput' }, { outputIdentifier: 'paymentOutput' }] });
  await finish(id, 'sweep of three coins, one of them under a key this account does not hold');
  await mine(1, BURN);
  show('blocks', await rpc('getblockcount'));
} catch (error) {
  console.log('FAILED:', error.name, String(error.message).slice(0, 600));
  show('engine errors', [...new Set(errors)].slice(0, 6));
  process.exitCode = 1;
} finally {
  await engine.stop().catch(() => {});
  process.exit();
}
