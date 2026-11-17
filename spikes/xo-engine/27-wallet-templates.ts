// Trial: the wallet's draft templates (packages/app/src/templates.ts) through the engine on the local node,
// with the library's own keys, addresses and states beside the engine's.
//
// Phases, each a process of its own with an empty engine state:
//   new-key    the new device makes its controller key
//   owner-1    create; make and check addresses; receive; pay by key with change
//   recoverer-1  request
//   owner-2    cancel, paid by a coin of the wallet
//   recoverer-2  request again, wait, complete
//   new        take over, sweep, spend the vault coin, send everything and close
// usage: npx tsx 27-wallet-templates.ts [run] [phase]
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { binToHex, hexToBin, hash160 } from '@bitauth/libauth';
import {
  type ControllerState, ADDRESS_KIND, INPUT_BYTES, afterFinalizeRecovery, afterOwnerAuthorize, afterRequestRecovery, decodeControllerState,
  deriveCredentialKeys, deriveSeedKeys, encodeChallengeDelay, encodeControllerState, p2pkhLockingBytecode, requiredFee, transactionBytes, walletAddress,
} from '@grandmas-wallet/core';
import { WALLET_TEMPLATES, walletTemplateNumbers } from '../../packages/app/src/templates.ts';
// @ts-expect-error plain script
import { openEngineRegtest, rpc, mine, BURN } from './regtest.mjs';
// @ts-expect-error plain script
import { mnemonicFor, DATA } from './common.mjs';

const errors: string[] = [];
console.error = (...args: unknown[]) => errors.push(String(args[0]).slice(0, 300));
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const [run = String(Date.now()), phase] = process.argv.slice(2);
const FACTS = `${DATA}trial27-${run}.json`;
const facts: Record<string, any> = existsSync(FACTS) ? JSON.parse(readFileSync(FACTS, 'utf8')) : {};
const remember = (entries: Record<string, unknown>) => { Object.assign(facts, entries); writeFileSync(FACTS, JSON.stringify(facts, null, 1)); };
if (phase === undefined) {
  for (const next of ['new-key', 'owner-1', 'recoverer-1', 'owner-2', 'recoverer-2', 'new']) {
    const result = spawnSync('npx', ['tsx', fileURLToPath(import.meta.url), run, next], { stdio: 'inherit' });
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
  process.exit(0);
}

const idOf = (stored: any): string => stored.invitation?.invitationIdentifier ?? stored.invitationIdentifier;
const waitFor = async <T>(what: string, check: () => Promise<T | undefined>): Promise<T> => {
  for (let attempt = 0; attempt < 60; attempt++) { const found = await check(); if (found) return found; await wait(500); }
  throw new Error(`timed out waiting for ${what}`);
};
const numbers = walletTemplateNumbers();
const DELAY = { unit: 'time512', value: 1 } as const;
const hex = binToHex;

/** One account: an engine with the wallet's templates. */
const open = async (name: string) => {
  const account = `trial27-${run}-${name}`;
  const engine = await openEngineRegtest(account);
  // The engine drops what it hears about a transaction in a block it has not checked yet, and does not ask
  // again. Nothing is made known to it before its header check has reached the tip.
  await waitFor('the engine\'s header check to reach the tip', async () => { const status = await engine.getChainStatus(); return status.verifiedHeight >= status.currentHeight ? true : undefined; });
  const ids: Record<string, string> = {};
  for (const [key, template] of Object.entries(WALLET_TEMPLATES)) ids[key] = (await engine.importTemplate(template)).templateIdentifier;
  const coinPolicies = { change: { templateIdentifier: ids.coins }, receive: { templateIdentifier: ids.coins }, address: { templateIdentifier: ids.coins } };
  await engine.setDefaultPolicies(coinPolicies);
  const withPolicy = async <T>(policies: Record<string, unknown>, work: () => Promise<T>): Promise<T> => {
    await engine.setDefaultPolicies({ ...coinPolicies, ...policies });
    try { return await work(); } finally { await engine.setDefaultPolicies(coinPolicies); }
  };
  const act = async (label: string, invitationIdentifier: string, expectedBytes?: number) => {
    const own = await engine.listOwnInputIndexes(invitationIdentifier);
    for (const index of own) await engine.signInvitation(invitationIdentifier, index);
    let built: any;
    try { built = (await engine.executeAction(invitationIdentifier, { broadcastTransaction: true })).builtTransaction; }
    catch (error: any) {
      if (error.name !== 'UnspentOutputNotFoundInStoreError') { console.log(`${name}: ${label}: missing`, JSON.stringify(await engine.listMissingRequirements(invitationIdentifier).catch(() => 'n/a'))); throw error; }
      built = { transactionHash: Object.values((await engine.getInvitation(invitationIdentifier)).invitation?.result?.transactions ?? {})[0]?.transactionHash, transactionByteLength: 0 };
    }
    const sized = expectedBytes === undefined ? '' : built.transactionByteLength === expectedBytes ? ', the size worked out beforehand' : `, EXPECTED ${expectedBytes}`;
    console.log(`${name}: ${label}: accepted, ${built.transactionHash}, ${built.transactionByteLength} bytes${sized}`);
    if (expectedBytes !== undefined && built.transactionByteLength !== 0 && built.transactionByteLength !== expectedBytes) process.exitCode = 1;
    return built as { transactionHash: string; transactionByteLength: number };
  };
  const firstKey = async (template: string, secretIdentifier: string): Promise<string> => {
    const secrets = (await engine.listSecretData()).filter((s: any) => s.secretIdentifier === secretIdentifier && s.templateIdentifier === ids[template]).sort((a: any, b: any) => Number(a.value) - Number(b.value));
    return engine.getSecretPublicKey(secrets[0].secretLookupKey);
  };
  const scriptHashes = async () => new Map<string, string>((await engine.listScriptHashes()).map((s: any) => [s.lockingBytecode, s.scriptHash]));
  const coinsAt = async (lockings: string[]) => {
    const byLocking = await scriptHashes();
    const wanted = lockings.map((l) => byLocking.get(l));
    return (await engine.listUnspentOutputs()).filter((u: any) => wanted.includes(u.scriptHash));
  };
  const plainCoins = async () => waitFor('ordinary coins', async () => { const c = await engine.listSpendableUnspentOutputs({ templateIdentifier: ids.coins }); return c.length > 0 ? c : undefined; });
  return { name, account, engine, ids, withPolicy, act, firstKey, coinsAt, plainCoins, words: mnemonicFor(account) as string };
};
type Account = Awaited<ReturnType<typeof open>>;
const outpoint = (u: any, inputIdentifier?: string) => ({ outpointTransactionHash: hexToBin(u.outpointTransactionHash), outpointIndex: u.outpointIndex, ...(inputIdentifier ? { inputIdentifier } : {}) });
const v = (role: string) => (variableIdentifier: string, value: unknown) => ({ variableIdentifier, roleIdentifier: role, value });
const stateHex = (state: ControllerState): string => hex(encodeControllerState(state));
const controllerNow = async (account: Account, locking: string, createdIn?: string): Promise<{ coin: any; state: ControllerState }> => {
  // After a transaction of this account's own, the engine may still list the output it spent for a moment.
  const coin = await waitFor('the controller', async () => (await account.coinsAt([locking])).find((u: any) => createdIn === undefined || u.outpointTransactionHash === createdIn));
  return { coin, state: decodeControllerState(hexToBin(coin.tokenNftCommitment)) };
};
/** Mine a block with the chain's clock moved on by a number of seconds. */
const clock = async () => (await rpc('getblockheader', await rpc('getbestblockhash'))).time as number;

try {
  if (phase === 'new-key') {
    const fresh = await open('new');
    await fresh.engine.createInvitation({ templateIdentifier: fresh.ids.controller, actionIdentifier: 'create', intent: WALLET_TEMPLATES.controller.start[0] });
    const publicKey = await fresh.firstKey('controller', 'controllerKey');
    const ours = deriveSeedKeys(fresh.words, 'testnet', numbers);
    console.log('new: controller key made; equal to the library\'s:', hex(ours.controllerKey.publicKey) === publicKey);
    remember({ newOwnerKeyHash: hex(hash160(hexToBin(publicKey))), newWords: fresh.words });
  }

  if (phase === 'owner-1') {
    const owner = await open('owner');
    const seed = deriveSeedKeys(owner.words, 'testnet', numbers);
    // The owner's device makes the recoverer's credential: its own twelve words.
    const credentialWords = mnemonicFor(`trial27-${run}-recoverer`) as string;
    const credential = deriveCredentialKeys(credentialWords, 'testnet', numbers);
    const coinLocking = await owner.engine.generateLockingBytecodeFromDefaultPolicy('receive');
    console.log('owner: funding address equal to the library\'s funding key:', coinLocking === hex(p2pkhLockingBytecode(seed.fundingKey.keyHash)));
    await mine(1, coinLocking);
    await mine(100, BURN);
    const funding = (await owner.plainCoins()).find((u: any) => u.outpointIndex === 0);
    const identity: string = funding.outpointTransactionHash;
    const id = idOf(await owner.engine.createInvitation({ templateIdentifier: owner.ids.controller, actionIdentifier: 'create', intent: WALLET_TEMPLATES.controller.start[0], variables: [v('owner')('identity', identity)], inputs: [outpoint(funding)] }));
    console.log('owner: controller key equal to the library\'s:', (await owner.firstKey('controller', 'controllerKey')) === hex(seed.controllerKey.publicKey));
    const first: ControllerState = { version: 1, status: 'active', ownerEpoch: 0, ownerKeyHash: seed.controllerKey.keyHash, recovererKeyHash: credential.recoveryKey.keyHash, challengeDelay: DELAY };
    await owner.engine.appendInvitation(id, { variables: [v('owner')('nextState', stateHex(first))] });
    // The fee: one ordinary input, the controller output and the change.
    const controllerOutput = { lockingBytecode: new Uint8Array(35), valueSatoshis: 1000n, token: { amount: 0n, category: hexToBin(identity), nft: { capability: 'mutable' as const, commitment: encodeControllerState(first) } } };
    const change = { lockingBytecode: hexToBin(coinLocking), valueSatoshis: 0n };
    const bytes = transactionBytes([INPUT_BYTES.p2pkh], [controllerOutput, change]);
    // Part of the first coins goes to the recoverer's fee address: an allowance.
    const feeLocking = hex(p2pkhLockingBytecode(credential.feeKey.keyHash));
    const allowance = { lockingBytecode: hexToBin(feeLocking), valueSatoshis: 6_000n };
    const createBytes = transactionBytes([INPUT_BYTES.p2pkh], [controllerOutput, allowance, change]);
    await owner.engine.appendInvitation(id, { outputs: [{ outputIdentifier: 'controllerOutput' }, allowance, { ...change, valueSatoshis: BigInt(funding.valueSatoshis) - 1000n - 6_000n - requiredFee(createBytes) }] });
    void bytes;
    const created = await owner.act('create, with an allowance for the recoverer', id, createBytes);

    // Addresses: the engine's, beside the library's.
    const made: { kind: number; number: number; locking: string; equal: boolean }[] = [];
    for (const [kind, template, count] of [[ADDRESS_KIND.givenOut, 'givenOut', 2], [ADDRESS_KIND.change, 'change', 1]] as const) {
      await owner.withPolicy({ address: { templateIdentifier: owner.ids[template] } }, async () => {
        for (let number = 0; number < count; number++) {
          const ours = walletAddress(hexToBin(identity), seed.viewingKey, kind, number);
          const locking = await owner.engine.generateLockingBytecodeFromDefaultPolicy('address', { tag: hex(ours.tag) });
          made.push({ kind, number, locking, equal: locking === hex(ours.lockingBytecode) });
        }
      });
    }
    const vault = walletAddress(hexToBin(identity), seed.viewingKey, ADDRESS_KIND.vault, 0);
    const vaultLocking = await owner.withPolicy({ receive: { templateIdentifier: owner.ids.actions } }, () =>
      owner.engine.generateLockingBytecodeFromDefaultPolicy('receive', { tag: hex(vault.tag), identity, addressSecret: hex(vault.secret) }));
    made.push({ kind: 2, number: 0, locking: vaultLocking, equal: vaultLocking === hex(vault.lockingBytecode) });
    console.log('owner: addresses equal to the library\'s:', made.map((m) => `${m.kind}/${m.number} ${m.equal}`).join(', '));
    if (made.some((m) => !m.equal)) throw new Error('an address differs from the library\'s');

    // Receive: a payment to each of the two addresses given out and to the vault address.
    for (const { locking } of made.filter((m) => m.kind !== 1)) await mine(1, locking);
    await mine(100, BURN);
    const [first0, second0] = await waitFor('coins at the addresses given out', async () => { const c = await owner.coinsAt(made.filter((m) => m.kind === 0).map((m) => m.locking)); return c.length === 2 ? c : undefined; });

    // Pay by key from one address, with change to the change address; exact fee.
    const payee = hexToBin(BURN);
    const changeLocking = hexToBin(made.find((m) => m.kind === 1)!.locking);
    const payBytes = transactionBytes([INPUT_BYTES.byKey], [{ lockingBytecode: payee, valueSatoshis: 0n }, { lockingBytecode: changeLocking, valueSatoshis: 0n }]);
    const payId = idOf(await owner.engine.createInvitation({ templateIdentifier: owner.ids.actions, actionIdentifier: 'pay', intent: WALLET_TEMPLATES.actions.start[0], inputs: [outpoint(first0)] }));
    await owner.engine.appendInvitation(payId, { outputs: [{ lockingBytecode: payee, valueSatoshis: 50_000n }, { lockingBytecode: changeLocking, valueSatoshis: BigInt(first0.valueSatoshis) - 50_000n - requiredFee(payBytes) }] });
    await owner.act('pay by key, with change to a change address', payId, payBytes);
    await mine(1, BURN);
    remember({ identity, ownerWords: owner.words, credentialWords, controllerLocking: undefined, created: created.transactionHash, made, second: `${second0.outpointTransactionHash}:${second0.outpointIndex}` });
  }

  if (phase === 'recoverer-1' || phase === 'recoverer-2') {
    const recoverer = await open('recoverer');
    await recoverer.engine.createInvitation({ templateIdentifier: recoverer.ids.controller, actionIdentifier: 'takeUp', intent: WALLET_TEMPLATES.controller.start[1] });
    const credential = deriveCredentialKeys(recoverer.words, 'testnet', numbers);
    console.log('recoverer: recovery key equal to the one the owner derived from the credential:', (await recoverer.firstKey('controller', 'recovererKey')) === hex(credential.recoveryKey.publicKey));
    const feeLocking = await recoverer.engine.generateLockingBytecodeFromDefaultPolicy('receive');
    console.log('recoverer: fee address equal to the credential\'s fee key:', feeLocking === hex(p2pkhLockingBytecode(credential.feeKey.keyHash)));
    // The controller, made known to this account under its recovery key.
    const takeUp = idOf((await recoverer.engine.listInvitations())[0]);
    const read = await rpc('getrawtransaction', facts.controllerAt ?? facts.created, true);
    const commitment: string = read.vout[0].tokenData.nft.commitment;
    const controllerLocking = await recoverer.withPolicy({ receive: { templateIdentifier: recoverer.ids.controller } }, () =>
      recoverer.engine.generateLockingBytecodeFromDefaultPolicy('receive', { identity: facts.identity, nextState: commitment }, takeUp));
    const { coin, state } = await controllerNow(recoverer, controllerLocking);
    const feeCoins = await recoverer.plainCoins();
    const feeTotal = feeCoins.reduce((sum: bigint, u: any) => sum + BigInt(u.valueSatoshis), 0n);
    const R = v('recoverer');
    const request = async () => {
      const next = afterRequestRecovery(state, hexToBin(facts.newOwnerKeyHash));
      const id = idOf(await recoverer.engine.createInvitation({
        templateIdentifier: recoverer.ids.controller, actionIdentifier: 'requestRecovery', intent: WALLET_TEMPLATES.controller.lockingScripts.controllerLockingScript.roles.recoverer.actions[0],
        variables: [R('identity', facts.identity), R('nextState', stateHex(next)), R('proposedOwnerKeyHash', facts.newOwnerKeyHash)],
        inputs: [outpoint(coin, 'requestInput'), ...feeCoins.map((u: any) => outpoint(u))],
      }));
      const bytes = transactionBytes([INPUT_BYTES.controllerRequest, ...feeCoins.map(() => INPUT_BYTES.p2pkh)], [{ lockingBytecode: new Uint8Array(35), valueSatoshis: 1000n, token: { amount: 0n, category: hexToBin(facts.identity), nft: { capability: 'mutable' as const, commitment: encodeControllerState(next) } } }, { lockingBytecode: hexToBin(feeLocking), valueSatoshis: 0n }]);
      await recoverer.engine.appendInvitation(id, { outputs: [{ outputIdentifier: 'controllerOutput' }, { lockingBytecode: hexToBin(feeLocking), valueSatoshis: feeTotal - requiredFee(bytes) }] });
      return recoverer.act('request', id, bytes);
    };
    if (phase === 'recoverer-1') {
      const requested = await request();
      await mine(1, BURN);
      remember({ controllerAt: requested.transactionHash });
    } else {
      const requested = await request();
      await mine(1, BURN);
      // Wait: move the chain's clock past the waiting period.
      const pending = await controllerNow(recoverer, controllerLocking, requested.transactionHash);
      const before = await clock();
      await rpc('setmocktime', before + 700);
      await mine(11, BURN);
      const next = afterFinalizeRecovery(pending.state);
      const fee = await waitFor('the fee coin after the request', async () => { const c = await recoverer.engine.listSpendableUnspentOutputs({ templateIdentifier: recoverer.ids.coins }); return c.length > 0 && c.every((u: any) => u.outpointTransactionHash === requested.transactionHash) ? c : undefined; });
      const id = idOf(await recoverer.engine.createInvitation({
        templateIdentifier: recoverer.ids.controller, actionIdentifier: 'completeRecovery', intent: WALLET_TEMPLATES.controller.lockingScripts.controllerLockingScript.roles.recoverer.actions[1],
        variables: [R('identity', facts.identity), R('nextState', stateHex(next)), R('waitingSequence', encodeChallengeDelay(DELAY))],
        inputs: [outpoint(pending.coin, 'completeInput'), ...fee.map((u: any) => outpoint(u))],
      }));
      const bytes = transactionBytes([INPUT_BYTES.controller, INPUT_BYTES.p2pkh], [{ lockingBytecode: new Uint8Array(35), valueSatoshis: 1000n, token: { amount: 0n, category: hexToBin(facts.identity), nft: { capability: 'mutable' as const, commitment: encodeControllerState(next) } } }, { lockingBytecode: hexToBin(feeLocking), valueSatoshis: 0n }]);
      await recoverer.engine.appendInvitation(id, { outputs: [{ outputIdentifier: 'controllerOutput' }, { lockingBytecode: hexToBin(feeLocking), valueSatoshis: BigInt(fee[0].valueSatoshis) - requiredFee(bytes) }] });
      const completed = await recoverer.act('complete, after the waiting period', id, bytes);
      await mine(1, BURN);
      await rpc('setmocktime', 0);
      remember({ controllerAt: completed.transactionHash });
    }
  }

  const controllerOut = (identity: string, state: ControllerState) => ({ lockingBytecode: new Uint8Array(35), valueSatoshis: 1000n, token: { amount: 0n, category: hexToBin(identity), nft: { capability: 'mutable' as const, commitment: encodeControllerState(state) } } });
  const p2sh32 = { lockingBytecode: new Uint8Array(35), valueSatoshis: 0n };

  if (phase === 'owner-2') {
    // The owner's device again, with an empty engine state: it makes its keys and addresses known again, in order.
    const owner = await open('owner');
    const seed = deriveSeedKeys(owner.words, 'testnet', numbers);
    const identity: string = facts.identity;
    const createAgain = idOf(await owner.engine.createInvitation({ templateIdentifier: owner.ids.controller, actionIdentifier: 'create', intent: WALLET_TEMPLATES.controller.start[0] }));
    const controllerLocking = await owner.withPolicy({ address: { templateIdentifier: owner.ids.controller } }, () =>
      owner.engine.generateLockingBytecodeFromDefaultPolicy('address', { identity }, createAgain));
    const lockings: Record<string, string> = {};
    for (const [kind, template, count] of [[ADDRESS_KIND.givenOut, 'givenOut', 2], [ADDRESS_KIND.change, 'change', 1]] as const) {
      await owner.withPolicy({ address: { templateIdentifier: owner.ids[template] } }, async () => {
        for (let number = 0; number < count; number++) {
          lockings[`${kind}/${number}`] = await owner.engine.generateLockingBytecodeFromDefaultPolicy('address', { tag: hex(walletAddress(hexToBin(identity), seed.viewingKey, kind, number).tag) });
        }
      });
    }
    console.log('owner: the same addresses again after a restart:', facts.made.filter((m: any) => m.kind !== 2).every((m: any) => lockings[`${m.kind}/${m.number}`] === m.locking));
    const { coin, state } = await controllerNow(owner, controllerLocking);
    console.log('owner: sees a request for', state.status === 'pending' ? hex(state.proposedOwnerKeyHash!) : 'nothing');
    const [feeCoin] = await waitFor('a coin of the wallet', async () => { const c = await owner.coinsAt([lockings['0/1']!]); return c.length > 0 ? c : undefined; });
    const next = afterOwnerAuthorize(state);
    const O = v('owner');
    const id = idOf(await owner.engine.createInvitation({
      templateIdentifier: owner.ids.controller, actionIdentifier: 'approve', intent: WALLET_TEMPLATES.controller.lockingScripts.controllerLockingScript.roles.owner.actions[0],
      variables: [O('identity', identity), O('nextState', stateHex(next))],
      inputs: [outpoint(coin, 'approveInput'), outpoint(feeCoin)],
    }));
    const bytes = transactionBytes([INPUT_BYTES.controller, INPUT_BYTES.byKey], [controllerOut(identity, next), p2sh32]);
    await owner.engine.appendInvitation(id, { outputs: [{ outputIdentifier: 'controllerOutput' }, { lockingBytecode: hexToBin(lockings['1/0']!), valueSatoshis: BigInt(feeCoin.valueSatoshis) - requiredFee(bytes) }] });
    const cancelled = await owner.act('cancel, paid by a coin of the wallet spent by its key', id, bytes);
    await mine(1, BURN);
    remember({ controllerAt: cancelled.transactionHash });
  }

  if (phase === 'new') {
    // The new device: an empty engine state and its own seed. It is told the identity and the earlier viewing key.
    const fresh = await open('new');
    const identity: string = facts.identity;
    const own = deriveSeedKeys(fresh.words, 'testnet', numbers);
    const earlier = deriveSeedKeys(facts.ownerWords, 'testnet', numbers).viewingKey;
    const createAgain = idOf(await fresh.engine.createInvitation({ templateIdentifier: fresh.ids.controller, actionIdentifier: 'create', intent: WALLET_TEMPLATES.controller.start[0] }));
    const controllerLocking = await fresh.withPolicy({ address: { templateIdentifier: fresh.ids.controller } }, () =>
      fresh.engine.generateLockingBytecodeFromDefaultPolicy('address', { identity }, createAgain));
    const { coin, state } = await controllerNow(fresh, controllerLocking);
    console.log('new: owns the wallet:', hex(state.ownerKeyHash) === hex(own.controllerKey.keyHash), '| epoch', state.ownerEpoch);

    // The earlier seed's addresses, from its viewing key: followed and swept without their keys.
    const earlierLockings: string[] = [];
    await fresh.withPolicy({ address: { templateIdentifier: fresh.ids.actions } }, async () => {
      for (const [kind, count] of [[ADDRESS_KIND.givenOut, 2], [ADDRESS_KIND.change, 1]] as const) {
        for (let number = 0; number < count; number++) {
          const address = walletAddress(hexToBin(identity), earlier, kind, number);
          if (address.kind === ADDRESS_KIND.vault) continue;
          earlierLockings.push(await fresh.engine.generateLockingBytecodeFromDefaultPolicy('address', { keyHash: hex(address.keyHash), tag: hex(address.tag), identity, addressSecret: hex(address.secret) }));
        }
      }
    });
    const vault = walletAddress(hexToBin(identity), earlier, ADDRESS_KIND.vault, 0);
    const vaultLocking = await fresh.withPolicy({ receive: { templateIdentifier: fresh.ids.actions } }, () =>
      fresh.engine.generateLockingBytecodeFromDefaultPolicy('receive', { tag: hex(vault.tag), identity, addressSecret: hex(vault.secret) }));
    const earlierCoins = await waitFor('the earlier coins', async () => { const c = await fresh.coinsAt(earlierLockings); return c.length === 2 ? c : undefined; });
    const [vaultCoin] = await waitFor('the vault coin', async () => { const c = await fresh.coinsAt([vaultLocking]); return c.length === 1 ? c : undefined; });
    console.log('new: found', earlierCoins.length, 'coins at earlier addresses and the vault coin');

    // Its own first address.
    const mine0 = walletAddress(hexToBin(identity), own.viewingKey, ADDRESS_KIND.givenOut, 0);
    const destination = await fresh.withPolicy({ address: { templateIdentifier: fresh.ids.givenOut } }, () =>
      fresh.engine.generateLockingBytecodeFromDefaultPolicy('address', { tag: hex(mine0.tag) }));
    console.log('new: its own address equal to the library\'s:', destination === hex(mine0.lockingBytecode));

    // Sweep: the controller approves; each coin shows the identity and its secret.
    const O = v('owner');
    const next = afterOwnerAuthorize(state);
    const swept = [...earlierCoins, vaultCoin];
    const total = swept.reduce((sum: bigint, u: any) => sum + BigInt(u.valueSatoshis), 0n);
    const sweepId = idOf(await fresh.engine.createInvitation({
      templateIdentifier: fresh.ids.controller, actionIdentifier: 'approve', intent: WALLET_TEMPLATES.controller.lockingScripts.controllerLockingScript.roles.owner.actions[0],
      variables: [O('identity', identity), O('nextState', stateHex(next))],
      inputs: [outpoint(coin, 'approveInput'), ...swept.map((u: any) => outpoint(u))],
    }));
    const sweepBytes = transactionBytes([INPUT_BYTES.controller, INPUT_BYTES.swept, INPUT_BYTES.swept, INPUT_BYTES.vault], [controllerOut(identity, next), p2sh32]);
    await fresh.engine.appendInvitation(sweepId, { outputs: [{ outputIdentifier: 'controllerOutput' }, { lockingBytecode: hexToBin(destination), valueSatoshis: total - requiredFee(sweepBytes) }] });
    const sweep = await fresh.act('sweep of two earlier coins and the vault coin to its own address', sweepId, sweepBytes);
    await mine(1, BURN);

    // Send everything and close: the coin by its key and the controller, to one output.
    const after = await controllerNow(fresh, controllerLocking, sweep.transactionHash);
    const [ownCoin] = await waitFor('the swept coin at its own address', async () => { const c = await fresh.coinsAt([destination]); return c.length === 1 && c[0].outpointTransactionHash === sweep.transactionHash ? c : undefined; });
    const closeId = idOf(await fresh.engine.createInvitation({
      templateIdentifier: fresh.ids.controller, actionIdentifier: 'close', intent: WALLET_TEMPLATES.controller.lockingScripts.controllerLockingScript.roles.owner.actions[2],
      variables: [O('identity', identity)],
      inputs: [outpoint(after.coin, 'closeInput'), outpoint(ownCoin)],
    }));
    const closeBytes = transactionBytes([INPUT_BYTES.controller, INPUT_BYTES.byKey], [{ lockingBytecode: hexToBin(BURN), valueSatoshis: 0n }]);
    await fresh.engine.appendInvitation(closeId, { outputs: [{ lockingBytecode: hexToBin(BURN), valueSatoshis: BigInt(ownCoin.valueSatoshis) + 1000n - requiredFee(closeBytes) }] });
    await fresh.act('send everything and close', closeId, closeBytes);
    await mine(1, BURN);
    const left = await rpc('gettxout', after.coin.outpointTransactionHash, 0);
    console.log('new: the controller is gone:', left === null, '| blocks', await rpc('getblockcount'));
  }
} catch (error: any) {
  console.log('FAILED:', error.name, String(error.message).slice(0, 900));
  console.log('engine errors:', [...new Set(errors)].slice(0, 5));
  process.exitCode = 1;
} finally {
  process.exit();
}
