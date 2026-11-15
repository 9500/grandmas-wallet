// Experiment 11: the recovery lifecycle through the XO engine, one step per process.
// Each step starts from an empty engine state, as a Node process must with the pinned engine version.
// usage: node 11-flow.mjs <account> <step> [args]
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { binToHex, hexToBin, hash160, hash256, encodeLockingBytecodeP2sh32, decodeTransactionBch, cashAddressToLockingBytecode } from '@bitauth/libauth';
import { p2pkhTemplate } from '@xo-cash/templates';
// The template is frozen: keys are derived under its identifier, so any edit would orphan the wallet created with it.
const spikeTemplate = JSON.parse(readFileSync(new URL('./flow-template.json', import.meta.url), 'utf8'));
import { openEngine, address, show, DATA } from './common.mjs';

const [account, step, ...args] = process.argv.slice(2);
const FLOW = `${DATA}flow.json`;
const flow = existsSync(FLOW) ? JSON.parse(readFileSync(FLOW, 'utf8')) : {};
const remember = (entries) => { Object.assign(flow, entries); writeFileSync(FLOW, JSON.stringify(flow, null, 1)); };
const idOf = (stored) => stored.invitation?.invitationIdentifier ?? stored.invitationIdentifier;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const engine = await openEngine(account);
const noise = console.error;
console.error = () => undefined; // header verification noise, see experiment 5
const p2pkh = (await engine.importTemplate(p2pkhTemplate)).templateIdentifier;
const spike = (await engine.importTemplate(spikeTemplate)).templateIdentifier;
await engine.setDefaultPolicies({ change: { templateIdentifier: p2pkh }, receive: { templateIdentifier: p2pkh }, address: { templateIdentifier: p2pkh } });
// Re-create the first few addresses so their outputs are tracked again in this fresh state.
const ownLocking = [];
for (let i = 0; i < 12; i++) ownLocking.push(await engine.generateLockingBytecodeFromDefaultPolicy('receive'));
const template = await engine.getTemplate(spike);

const coins = async () => {
  for (let attempt = 0; attempt < 15; attempt++) {
    const found = await engine.listSpendableUnspentOutputs({ templateIdentifier: p2pkh });
    if (found.length > 0) return found;
    await wait(1500);
  }
  return [];
};
const asInputs = (outputs) => outputs.map((u) => ({ outpointTransactionHash: hexToBin(u.outpointTransactionHash), outpointIndex: u.outpointIndex }));
const total = (outputs) => outputs.reduce((sum, u) => sum + BigInt(u.valueSatoshis), 0n);
const variable = (roleIdentifier) => (variableIdentifier, value) => ({ variableIdentifier, roleIdentifier, value });
const ownKeyHash = async (secretIdentifier) => {
  const secret = (await engine.listSecretData()).find((s) => s.secretIdentifier === secretIdentifier && s.templateIdentifier === spike);
  return binToHex(hash160(hexToBin(await engine.getSecretPublicKey(secret.secretLookupKey))));
};
/** Sign every input this account owns, execute, and report. */
const finish = async (id, label) => {
  const own = await engine.listOwnInputIndexes(id);
  console.log(label, 'own input indexes', own);
  for (const index of own) await engine.signInvitation(id, index);
  show(`${label} missing`, await engine.listMissingRequirements(id));
  let built;
  if (process.env.DRY === '1') {
    built = (await engine.executeAction(id, { broadcastTransaction: false })).builtTransaction;
    writeFileSync(`${DATA}last-tx.hex`, built.serializedTransaction);
    console.log(label, 'DRY RUN, transaction saved, not broadcast');
    process.exit(0);
  }
  try {
    built = (await engine.executeAction(id, { broadcastTransaction: true })).builtTransaction;
  } catch (error) {
    // After a successful broadcast the engine can fail while clearing reservations, because the spent
    // output has already been removed from its store. The transaction is on the network in that case.
    if (error.name !== 'UnspentOutputNotFoundInStoreError') throw error;
    console.log(label, 'engine raised', error.name, 'after broadcasting');
    built = (await engine.getInvitation(id)).invitation?.result?.transactions ?? {};
    const first = Object.values(built)[0] ?? {};
    built = { transactionHash: first.transactionHash, serializedTransaction: first.serializedTransaction ?? first.transaction, transactionByteLength: 0 };
  }
  console.log(label, 'BROADCAST', built.transactionHash, `${built.transactionByteLength} bytes`);
  return built;
};

/** The wallet (asset covenant) locking bytecode for the flow's identity, derived as packages/core does. */
const walletLocking = () => {
  const assetHex = /'([0-9a-f]+)'/.exec(readFileSync(new URL('../../contracts/artifacts/asset.ts', import.meta.url), 'utf8'))[1];
  const redeem = Uint8Array.from([0x20, ...hexToBin(flow.identity).reverse(), ...hexToBin(assetHex)]);
  return encodeLockingBytecodeP2sh32(hash256(redeem));
};
const outpoint = ({ hash, index }, inputIdentifier) => ({ outpointTransactionHash: hexToBin(hash), outpointIndex: index, inputIdentifier });
/** Bytes 2..49 of the state: epoch, owner, recoverer, delay. */
const stateBody = () => flow.state.slice(4, 98);
const CONTROLLER_FEE = 1100n;

const steps = {
  /** Show addresses and coins. */
  async status() {
    console.log('address', address(ownLocking[0]));
    show('coins', (await coins()).map((u) => `${u.outpointTransactionHash}:${u.outpointIndex} ${u.valueSatoshis}`));
    show('all unspent', (await engine.listUnspentOutputs()).map((u) => `${u.outpointTransactionHash}:${u.outpointIndex} ${u.valueSatoshis} ${u.tokenNftCommitment ?? ''}`));
  },

  /** Ordinary payment; used to fund the recoverer and to make an output at index 0 for the identity. */
  async pay([recipient, amount]) {
    const locking = recipient === 'self' ? ownLocking[0] : binToHex(cashAddressToLockingBytecode(recipient).bytecode);
    const spendable = await coins();
    const value = amount === 'all' ? total(spendable) - 400n : BigInt(amount);
    const intent = template && (await engine.getTemplate(p2pkh)).lockingScripts.receivingLockingScript.roles.receiver.actions.find((a) => a.action === 'sendSatoshis');
    const v = variable('sender');
    const stored = await engine.createInvitation({
      templateIdentifier: p2pkh, actionIdentifier: 'sendSatoshis', intent,
      variables: [v('transferredSatoshis', value), v('recipientLockingscript', locking)],
      inputs: asInputs(spendable),
    });
    const id = idOf(stored);
    await engine.appendInvitation(id, { outputs: [{ outputIdentifier: 'transferSatoshisOutput' }] });
    if (amount !== 'all') await engine.addChangeToInvitation(id);
    const built = await finish(id, 'pay');
    const paidIndex = decodeTransactionBch(hexToBin(built.serializedTransaction)).outputs.findIndex((o) => binToHex(o.lockingBytecode) === locking);
    console.log('paid output index', paidIndex);
    if (recipient === 'self') remember({ identity: built.transactionHash, identityOutputIndex: paidIndex });
  },

  /** Recoverer: derive its key (index 0 under the template) and record its hash for the owner. */
  async 'recoverer-key'() {
    const intent = template.lockingScripts.controllerLockingScript.roles.recoverer.actions[0];
    await engine.createInvitation({ templateIdentifier: spike, actionIdentifier: 'requestRecovery', intent });
    remember({ recovererKeyHash: await ownKeyHash('recovererKey') });
    console.log('recoverer key hash', flow.recovererKeyHash, 'address', address(ownLocking[0]));
  },

  /** Owner: create the identity, controller and wallet funds, paying from ordinary coins. */
  async initialize() {
    const spendable = await coins();
    const funding = spendable.find((u) => u.outpointTransactionHash === flow.identity && u.outpointIndex === 0);
    if (funding === undefined) throw new Error('identity outpoint not found among spendable coins');
    const v = variable('owner');
    const walletSatoshis = BigInt(funding.valueSatoshis) - 1000n - 700n;
    const stored = await engine.createInvitation({
      templateIdentifier: spike, actionIdentifier: 'initialize', intent: template.start[0],
      variables: [v('identity', flow.identity), v('recovererKeyHash', flow.recovererKeyHash), v('walletSatoshis', walletSatoshis)],
      inputs: asInputs([funding]),
    });
    const id = idOf(stored);
    const ownerKeyHash = await ownKeyHash('ownerKey');
    await engine.appendInvitation(id, { variables: [v('ownerKeyHash', ownerKeyHash)] });
    await engine.appendInvitation(id, { outputs: [{ outputIdentifier: 'initialControllerOutput' }, { outputIdentifier: 'walletOutput' }] });
    const built = await finish(id, 'initialize');
    remember({
      ownerKeyHash,
      controller: { hash: built.transactionHash, index: 0 },
      wallet: { hash: built.transactionHash, index: 1, value: walletSatoshis.toString() },
      state: `010000000000${ownerKeyHash}${flow.recovererKeyHash}010040${'00'.repeat(20)}`,
    });
  },

  /** Owner: spend the controller and a wallet output together, paying someone and returning change to the wallet. */
  async send([recipient = 'self', amount = '1000']) {
    const locking = recipient === 'self' ? ownLocking[0] : binToHex(cashAddressToLockingBytecode(recipient).bytecode);
    const v = variable('owner');
    const intent = template.lockingScripts.controllerLockingScript.roles.owner.actions[0];
    const stored = await engine.createInvitation({
      templateIdentifier: spike, actionIdentifier: 'send', intent,
      variables: [
        v('identity', flow.identity), v('stateBody', stateBody()), v('sentSatoshis', BigInt(amount)), v('recipientLockingScript', locking),
      ],
      inputs: [outpoint(flow.controller, 'controllerOwnerInput'), outpoint(flow.wallet, 'walletInput')],
    });
    const id = idOf(stored);
    const change = BigInt(flow.wallet.value) - BigInt(amount) - CONTROLLER_FEE;
    // Change goes back to the wallet through the template's wallet output. Resolving it inside this invitation
    // also makes the wallet script known to this fresh engine state, under the same key as the controller input.
    await engine.appendInvitation(id, { variables: [v('walletSatoshis', change)] });
    await engine.appendInvitation(id, {
      outputs: [{ outputIdentifier: 'activeControllerOutput' }, { outputIdentifier: 'paymentOutput' }, { outputIdentifier: 'walletOutput' }],
    });
    const built = await finish(id, 'send');
    remember({
      controller: { hash: built.transactionHash, index: 0 },
      wallet: { hash: built.transactionHash, index: 2, value: change.toString() },
      state: `0100${stateBody()}${'00'.repeat(20)}`,
    });
  },

  /** Recoverer: open a claim, paying the fee from its own ordinary coins. */
  async claim() {
    const spendable = await coins();
    const v = variable('recoverer');
    const intent = template.lockingScripts.controllerLockingScript.roles.recoverer.actions[0];
    const proposed = flow.proposedOwnerKeyHash ?? flow.ownerKeyHash;
    const stored = await engine.createInvitation({
      templateIdentifier: spike, actionIdentifier: 'requestRecovery', intent,
      variables: [v('identity', flow.identity), v('stateBody', stateBody()), v('proposedOwnerKeyHash', proposed)],
      inputs: [outpoint(flow.controller, 'controllerClaimInput'), ...asInputs(spendable)],
    });
    const id = idOf(stored);
    await engine.appendInvitation(id, {
      outputs: [{ outputIdentifier: 'pendingControllerOutput' }, { lockingBytecode: hexToBin(ownLocking[0]), valueSatoshis: total(spendable) - CONTROLLER_FEE }],
    });
    const built = await finish(id, 'claim');
    remember({ controller: { hash: built.transactionHash, index: 0 }, state: `0101${stateBody()}${proposed}`, claimedAt: new Date().toISOString() });
  },

  /** Recoverer: complete the claim after the challenge delay. */
  async finalize() {
    const spendable = await coins();
    const v = variable('recoverer');
    const intent = template.lockingScripts.controllerLockingScript.roles.recoverer.actions[1];
    const epoch = hexToBin(flow.state.slice(4, 12));
    epoch[0] += 1;
    const finalizedState = `0100${binToHex(epoch)}${flow.state.slice(98, 138)}${flow.state.slice(52, 98)}${'00'.repeat(20)}`;
    const stored = await engine.createInvitation({
      templateIdentifier: spike, actionIdentifier: 'finalizeRecovery', intent,
      variables: [v('identity', flow.identity), v('finalizedState', finalizedState), v('challengeSequence', 0x400001)],
      inputs: [outpoint(flow.controller, 'controllerFinalizeInput'), ...asInputs(spendable)],
    });
    const id = idOf(stored);
    await engine.appendInvitation(id, {
      outputs: [{ outputIdentifier: 'finalizedControllerOutput' }, { lockingBytecode: hexToBin(ownLocking[0]), valueSatoshis: total(spendable) - CONTROLLER_FEE }],
    });
    const built = await finish(id, 'finalize');
    remember({ controller: { hash: built.transactionHash, index: 0 }, state: finalizedState });
  },
};

try {
  if (steps[step] === undefined) throw new Error(`unknown step ${step}; have ${Object.keys(steps).join(', ')}`);
  await steps[step](args);
} catch (error) {
  console.log('FAILED:', error.name, error.message, (error.stack ?? '').split('\n').slice(1, 6).join(' <- ').replace(/file:[^ ]*index.mjs/g, '…'));
} finally {
  console.error = noise;
  await engine.stop().catch(() => undefined);
  process.exit(0);
}
