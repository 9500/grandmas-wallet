// Trial: a new seed, in a new account, takes over an identity that another account created, then signs for
// its controller and sweeps the earlier seed's addresses. Controller and addresses are separate templates,
// so the sweep also shows one invitation with inputs and outputs of two templates.
// The owner is changed here with ownerUpdate; a recovery by request and completion changes it the same way on chain.
import { binToHex, hexToBin, hash160, hash256, sha256, flattenBinArray } from '@bitauth/libauth';
import { p2pkhTemplate } from '@xo-cash/templates';
import { openEngineRegtest, rpc, mine, BURN } from './regtest.mjs';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { show, DATA } from './common.mjs';
import { controllerTemplate, addressTemplate } from './split-templates.mjs';

const errors = [];
console.error = (...args) => errors.push(String(args[0]).slice(0, 200));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const idOf = (stored) => stored.invitation?.invitationIdentifier ?? stored.invitationIdentifier;
const v = (variableIdentifier, value) => ({ variableIdentifier, roleIdentifier: 'owner', value });
const outpoint = (u, inputIdentifier) => ({ outpointTransactionHash: hexToBin(u.outpointTransactionHash), outpointIndex: u.outpointIndex, ...(inputIdentifier ? { inputIdentifier } : {}) });
const waitFor = async (what, check) => {
  for (let attempt = 0; attempt < 40; attempt++) { const found = await check(); if (found) return found; await wait(500); }
  throw new Error(`timed out waiting for ${what}`);
};
// The engine can be opened once in a process, and its state here is kept in memory only. Each phase is
// therefore a process of its own with an empty engine state, as a new device would have; what one phase
// tells the next is written to a file.
const [run = String(Date.now()), phase] = process.argv.slice(2);
const FACTS = `${DATA}trial24-${run}.json`;
const facts = existsSync(FACTS) ? JSON.parse(readFileSync(FACTS, 'utf8')) : {};
const remember = (entries) => { Object.assign(facts, entries); writeFileSync(FACTS, JSON.stringify(facts, null, 1)); };
if (phase === undefined) {
  for (const next of ['new-key', 'old', 'new']) {
    const result = spawnSync(process.execPath, [new URL(import.meta.url).pathname, run, next], { stdio: 'inherit' });
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
  process.exit(0);
}

/** One account: an engine with the three templates and ordinary coins under the standard template. */
const open = async (name) => {
  const engine = await openEngineRegtest(`trial24-${run}-${name}`);
  const p2pkh = (await engine.importTemplate(p2pkhTemplate)).templateIdentifier;
  const controller = (await engine.importTemplate(controllerTemplate)).templateIdentifier;
  const addresses = (await engine.importTemplate(addressTemplate)).templateIdentifier;
  const coinPolicies = { change: { templateIdentifier: p2pkh }, receive: { templateIdentifier: p2pkh }, address: { templateIdentifier: p2pkh } };
  await engine.setDefaultPolicies(coinPolicies);
  const withPolicy = async (policies, work) => { await engine.setDefaultPolicies({ ...coinPolicies, ...policies }); try { return await work(); } finally { await engine.setDefaultPolicies(coinPolicies); } };
  const finish = async (id, label) => {
    const own = await engine.listOwnInputIndexes(id);
    for (const index of own) await engine.signInvitation(id, index);
    let built;
    try { built = (await engine.executeAction(id, { broadcastTransaction: true })).builtTransaction; }
    catch (error) {
      if (error.name !== 'UnspentOutputNotFoundInStoreError') { show(`${label}: missing`, await engine.listMissingRequirements(id).catch(() => 'n/a')); throw error; }
      built = { transactionHash: Object.values((await engine.getInvitation(id)).invitation?.result?.transactions ?? {})[0]?.transactionHash, transactionByteLength: 0 };
    }
    console.log(`${name}: ${label}: accepted by the node, ${built.transactionHash}, ${built.transactionByteLength} bytes, signed inputs ${JSON.stringify(own)}`);
    return built;
  };
  const publicKeyOf = async (templateIdentifier, secretIdentifier) => {
    const secrets = (await engine.listSecretData()).filter((s) => s.secretIdentifier === secretIdentifier && s.templateIdentifier === templateIdentifier);
    return Promise.all(secrets.map((s) => engine.getSecretPublicKey(s.secretLookupKey)));
  };
  const coinsAt = async (lockings) => {
    const scriptHashOf = new Map((await engine.listScriptHashes()).map((s) => [s.lockingBytecode, s.scriptHash]));
    const wanted = lockings.map((l) => scriptHashOf.get(l));
    return (await engine.listUnspentOutputs()).filter((u) => wanted.includes(u.scriptHash));
  };
  return { name, engine, templates: { p2pkh, controller, addresses }, withPolicy, finish, publicKeyOf, coinsAt, template: await engine.getTemplate(controller) };
};
const secret = (seed, n) => sha256.hash(Uint8Array.of(seed, n));
const tagOf = (identity, s) => hash256(flattenBinArray([hexToBin(identity).reverse(), s]));

try {
  if (phase === 'new-key') {
    // --- the new device first makes its controller key, before it knows any identity
    const fresh = await open('new');
    await fresh.engine.createInvitation({ templateIdentifier: fresh.templates.controller, actionIdentifier: 'create', intent: fresh.template.start[0] });
    const newOwnerKeyHash = binToHex(hash160(hexToBin((await fresh.publicKeyOf(fresh.templates.controller, 'controllerKey'))[0])));
    console.log('new: controller key made; its hash is', newOwnerKeyHash);
    remember({ newOwnerKeyHash });
  }

  if (phase === 'old') {
  const { newOwnerKeyHash } = facts;
  // --- the old device creates the wallet, receives at two addresses, and hands the wallet over
  const old = await open('old');
  const coinLocking = await old.engine.generateLockingBytecodeFromDefaultPolicy('receive');
  await mine(2, coinLocking);
  await mine(100, BURN);
  const coins = await waitFor('two mature coins', async () => { const c = await old.engine.listSpendableUnspentOutputs({ templateIdentifier: old.templates.p2pkh }); return c.length >= 2 ? c : undefined; });
  const funding = coins.find((u) => u.outpointIndex === 0);
  const feeCoin = coins.find((u) => u !== funding);
  const identity = funding.outpointTransactionHash;
  const recovererKeyHash = binToHex(hash160(Uint8Array.of(7)));
  let id = idOf(await old.engine.createInvitation({
    templateIdentifier: old.templates.controller, actionIdentifier: 'create', intent: old.template.start[0],
    variables: [v('identity', identity), v('recovererKeyHash', recovererKeyHash)], inputs: [outpoint(funding)],
  }));
  const oldOwnerKeyHash = binToHex(hash160(hexToBin((await old.publicKeyOf(old.templates.controller, 'controllerKey'))[0])));
  await old.engine.appendInvitation(id, { variables: [v('ownerKeyHash', oldOwnerKeyHash)] });
  await old.engine.appendInvitation(id, { outputs: [{ outputIdentifier: 'initialControllerOutput' }, { lockingBytecode: hexToBin(coinLocking), valueSatoshis: BigInt(funding.valueSatoshis) - 2000n }] });
  const created = await old.finish(id, 'create');

  const oldAddresses = [];
  await old.withPolicy({ address: { templateIdentifier: old.templates.addresses } }, async () => {
    for (const n of [0, 1]) {
      const s = secret(0xa0, n);
      oldAddresses.push({ secret: s, locking: await old.engine.generateLockingBytecodeFromDefaultPolicy('address', { tag: binToHex(tagOf(identity, s)), identity, addressSecret: binToHex(s) }) });
    }
  });
  // What a viewing key would give the new device: the public key of each address.
  const oldPublicKeys = await old.publicKeyOf(old.templates.addresses, 'addressKey');
  for (const { locking } of oldAddresses) await mine(1, locking);
  await mine(100, BURN);
  await waitFor('the old device to see its coins', async () => ((await old.coinsAt(oldAddresses.map((a) => a.locking))).length === 2 ? true : undefined));

  id = idOf(await old.engine.createInvitation({
    templateIdentifier: old.templates.controller, actionIdentifier: 'update', intent: old.template.lockingScripts.controllerLockingScript.roles.owner.actions[1],
    variables: [v('identity', identity), v('newEpoch', '01000000'), v('newOwnerKeyHash', newOwnerKeyHash), v('newRecovererKeyHash', recovererKeyHash), v('newDelay', '010040')],
    inputs: [{ outpointTransactionHash: hexToBin(created.transactionHash), outpointIndex: 0, inputIdentifier: 'controllerUpdateInput' }, outpoint(feeCoin)],
  }));
  await old.engine.appendInvitation(id, { outputs: [{ outputIdentifier: 'updatedControllerOutput' }, { lockingBytecode: hexToBin(coinLocking), valueSatoshis: BigInt(feeCoin.valueSatoshis) - 2000n }] });
  const updated = await old.finish(id, 'owner changed to the new device\'s key (ownerUpdate, with a coin of another template paying the fee)');
  await mine(1, BURN);
  remember({ identity, recovererKeyHash, updated: updated.transactionHash, oldPublicKeys, oldAddresses: oldAddresses.map((a) => ({ secret: binToHex(a.secret), locking: a.locking })) });
  }

  if (phase === 'new') {
  // --- the new device: an empty engine state. It never saw the creation. It is told the identity and the earlier addresses.
  const { newOwnerKeyHash, identity, recovererKeyHash, oldPublicKeys } = facts;
  const updated = { transactionHash: facts.updated };
  const oldAddresses = facts.oldAddresses.map((a) => ({ secret: hexToBin(a.secret), locking: a.locking }));
  const fresh = await open('new');
  // The same seed gives the same first key again; the invitation it was made for is the handle to it.
  const prepared = idOf(await fresh.engine.createInvitation({ templateIdentifier: fresh.templates.controller, actionIdentifier: 'create', intent: fresh.template.start[0] }));
  const sameKey = binToHex(hash160(hexToBin((await fresh.publicKeyOf(fresh.templates.controller, 'controllerKey'))[0]))) === newOwnerKeyHash;
  console.log('new: the seed gives the same controller key again:', sameKey);
  const controllerLocking = await fresh.withPolicy({ address: { templateIdentifier: fresh.templates.controller } }, () =>
    fresh.engine.generateLockingBytecodeFromDefaultPolicy('address', { identity }, prepared));
  const earlier = [];
  await fresh.withPolicy({ receive: { templateIdentifier: fresh.templates.addresses } }, async () => {
    for (const address of oldAddresses) {
      // The key hash comes from the earlier seed's public keys; find the one that reproduces the address.
      for (const publicKey of oldPublicKeys) {
        const candidate = await fresh.engine.generateLockingBytecodeFromDefaultPolicy('receive', {
          keyHash: binToHex(hash160(hexToBin(publicKey))), tag: binToHex(tagOf(identity, address.secret)), identity, addressSecret: binToHex(address.secret),
        });
        if (candidate === address.locking) earlier.push(candidate);
      }
    }
  });
  const destination = await fresh.withPolicy({ address: { templateIdentifier: fresh.templates.addresses } }, () => {
    const s = secret(0xb0, 0);
    return fresh.engine.generateLockingBytecodeFromDefaultPolicy('address', { tag: binToHex(tagOf(identity, s)), identity, addressSecret: binToHex(s) });
  });
  console.log('new: reproduced', earlier.length, 'of', oldAddresses.length, 'earlier addresses; keys used:', (await fresh.engine.listSecretData()).map((s) => `${s.secretIdentifier} ${s.value} ${s.templateIdentifier === fresh.templates.controller ? 'controller template' : 'address template'}`).sort());
  const controllerCoin = await waitFor('the new device to see the controller', async () => (await fresh.coinsAt([controllerLocking]))[0]);
  const found = await waitFor('the new device to see the earlier coins', async () => { const c = await fresh.coinsAt(earlier); return c.length === 2 ? c : undefined; });
  console.log('new: sees the controller', `${controllerCoin.outpointTransactionHash.slice(0, 12)}…`, controllerCoin.outpointTransactionHash === updated.transactionHash ? '(the output of the owner change)' : '(UNEXPECTED)', 'and', found.length, 'coins at earlier addresses');

  const total = found.reduce((sum, u) => sum + BigInt(u.valueSatoshis), 0n);
  const state = `010001000000${newOwnerKeyHash}${recovererKeyHash}010040${'00'.repeat(20)}`;
  const id = idOf(await fresh.engine.createInvitation({
    templateIdentifier: fresh.templates.controller, actionIdentifier: 'sweep', intent: fresh.template.lockingScripts.controllerLockingScript.roles.owner.actions[0],
    variables: [v('identity', identity), v('stateBody', state.slice(4, 98)), v('sentSatoshis', total - 2000n), v('recipientLockingScript', destination)],
    inputs: [outpoint(controllerCoin, 'controllerOwnerInput'), ...found.map((u) => outpoint(u))],
  }));
  await fresh.engine.appendInvitation(id, { outputs: [{ outputIdentifier: 'activeControllerOutput' }, { outputIdentifier: 'paymentOutput' }] });
  const sweep = await fresh.finish(id, 'sweep of the earlier seed\'s coins to an address of the new seed');
  await mine(1, BURN);
  const arrived = await waitFor('the swept coins at the new address', async () => (await fresh.coinsAt([destination]))[0]);
  console.log('new: holds', arrived.valueSatoshis, 'sat at its own address, spendable by its key:', arrived.outpointTransactionHash === sweep.transactionHash);

  console.log('done; blocks', await rpc('getblockcount'));
  }
} catch (error) {
  console.log('FAILED:', error.name, String(error.message).slice(0, 700));
  show('engine errors', [...new Set(errors)].slice(0, 6));
  process.exitCode = 1;
} finally {
  process.exit();
}
