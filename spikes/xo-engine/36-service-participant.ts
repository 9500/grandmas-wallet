// Trial: a second participant. An application's service, with an XO engine and a seed of its own in a process of
// its own, joins an invitation of the wallet's in a role of its own (`service`): it supplies a value only it knows
// and a coin at a shared script the engine does not follow, given with its unlocking. The wallet then adds its coin
// for the fee and its change, checks the transaction, signs its own input and sends it.
//
// A minimal two-role template of this script's own. The main process is the wallet; every service step is a child
// process with an empty engine state, which reads the invitation from a file and writes it back (a stateless
// service: nothing of the service's is kept between requests). Experiments:
//
//   1  wallet first: the wallet creates, the service joins, the wallet finishes and sends
//   2  service first: the service creates, the wallet joins, finishes and sends
//   3  identity: the service's entity identifier per invitation, recomputed from the service's seed
//   4  an impostor seed joins as the service: what the wallet's engine says
//   5  tampering: a commit changed after it was signed, on either side; the expiry changed after signing
//   6  an expiry in the past: sent all the same
//   7  the service sets a value the template gives to the wallet's role
//   8  the service tags an item with the wallet's role (one role with a follow-up per entity)
//   9  the service gives the same shared coin to two invitations
//  10  a second engine in the same process
//  11  the service gives a template output another script and amount than the template's
//
// usage (from packages/app): timeout 600 npx tsx ../../spikes/xo-engine/36-service-participant.ts
import 'fake-indexeddb/auto';
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { binToHex, decodeTransactionBch, deriveHdPath, deriveHdPrivateNodeFromSeed, deriveHdPublicNode, encodeHdPublicKey, hexToBin, sha256, type Output } from '@bitauth/libauth';
import { type Utxo, buildTransaction, checkBeforeSending, keyPairFromPrivateKey, p2pkhInput, p2pkhLockingBytecode, templateLockingBytecode, templateUnlockingBytecode, verifyTransaction } from '@grandmas-wallet/core';
import { convertMnemonicToSeedBytes, createPathIndexFromHash } from '@xo-cash/crypto';
import { type Engine, XO_SUPPORTED_NETWORKS, validateInvitation } from '@xo-cash/engine';
import { p2pkhTemplate } from '@xo-cash/templates';
import type { XOInvitation, XOTemplate } from '@xo-cash/types';
import { deserializeInvitation, serializeInvitation } from '@xo-cash/utils';
// @ts-expect-error plain script
import { openEngineRegtest, mine, rpc, BURN } from './regtest.mjs';
// @ts-expect-error plain script
import { mnemonicFor, DATA } from './common.mjs';

const engineErrors: string[] = [];
console.error = (...args: unknown[]) => engineErrors.push(String(args[0]).slice(0, 300));
const hex = binToHex;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const errorText = (error: unknown) => `${(error as Error).name}: ${String((error as Error).message).replace(/\s+/g, ' ').slice(0, 400)}`;
const SELF = fileURLToPath(import.meta.url);

// --- The template -------------------------------------------------------------------------------------------
const view = (name: string, description: string) => ({ name, description });
export const trialTemplate = {
  $schema: 'https://libauth.org/schemas/wallet-template-v0.schema.json',
  ...view('Two-party trial', 'A user and a service: the service brings a coin at a shared script and a price; the user is paid an amount plus that price.'),
  version: '1',
  supported: ['BCH_2026_05'],
  roles: { user: view('User', 'The wallet.'), service: view('Service', 'The application\'s service.') },
  start: [{ action: 'act', role: 'user' }],
  actions: {
    act: {
      ...view('Act', 'The service brings its coin and price; the user is paid.'),
      roles: { user: { requirements: { variables: ['userAmount', 'userHolder'] } }, service: { requirements: { variables: ['servicePrice'] } } },
      requirements: { participants: [{ role: 'user', slots: { min: 1, max: 1 } }, { role: 'service', slots: { min: 1, max: 1 } }] },
      transaction: 'actTransaction',
    },
  },
  transactions: {
    actTransaction: {
      ...view('Acted', 'The user was paid.'),
      inputs: [{ input: 'sharedInput', inputIndex: 0 }],
      outputs: [{ output: 'sharedOutput', outputIndex: 0 }, { output: 'userOutput', outputIndex: 1 }],
      version: 2,
      locktime: 0,
    },
  },
  inputs: { sharedInput: { ...view('Shared coin', 'A coin at the shared script, brought by the service.'), unlockingScript: 'unlockShared' } },
  outputs: {
    sharedOutput: { ...view('Shared coin', 'Put back.'), lockingScript: 'sharedScript', valueSatoshis: '2000' },
    userOutput: { ...view('To the user', 'The amount plus the service\'s price.'), lockingScript: '$(<userHolder>)', valueSatoshis: '$(<userAmount> <servicePrice> OP_ADD)' },
  },
  lockingScripts: {
    // Shared by everyone, no key: like Paryon's contracts, a script neither side's engine should follow.
    sharedScript: {
      ...view('Shared script', 'Anyone may spend it with a positive number.'),
      lockingType: 'p2sh',
      lockingBytecode: 'sharedBytecode',
      selectable: false,
      roles: { user: { selectable: false, relevant: false }, service: { selectable: false, relevant: false } },
    },
  },
  scripts: { sharedBytecode: 'OP_0 OP_GREATERTHAN', unlockShared: '<servicePrice>' },
  variables: {
    userAmount: { ...view('Amount', 'Satoshis to the user.'), type: 'satoshis' },
    userHolder: { ...view('Holder', 'The user\'s address.'), type: 'locking_script' },
    servicePrice: { ...view('Price', 'The service\'s price.'), type: 'integer' },
  },
} as unknown as XOTemplate;
const TEMPLATE_TEXT = JSON.stringify(trialTemplate);
const SHARED_LOCKING = templateLockingBytecode(trialTemplate, 'sharedScript', {});

// --- The service, in a child process ------------------------------------------------------------------------
interface ServiceJob {
  account: string;
  /** The wallet's invitation, when the wallet started it; absent: the service starts. */
  inFile?: string;
  outFile: string;
  metaFile: string;
  shared: { transactionHash: string; index: number };
  price: number;
  /** A variation for the experiments. */
  mode?: 'plain' | 'tamperOwn' | 'expiryPast' | 'stretchExpiry' | 'override' | 'overrideUntagged' | 'tagUserRole' | 'forgeOutput';
  /** For override: where the service wants the user's output. */
  holder?: string;
}

const runService = async (job: ServiceJob) => {
  const started = Date.now();
  const meta: Record<string, unknown> = {};
  const engine: Engine = await openEngineRegtest(job.account);
  meta.engineOpenMs = Date.now() - started;
  try {
    // No wait for the header check: the service reads nothing from the chain.
    const { templateIdentifier } = await engine.importTemplate(TEMPLATE_TEXT);
    let invitationIdentifier: string;
    if (job.inFile !== undefined) {
      const received = deserializeInvitation(readFileSync(job.inFile, 'utf8'));
      // acceptInvitation does not check the commits' signatures; the exported validator does.
      try {
        validateInvitation(received, (await engine.getTemplate(templateIdentifier))!, XO_SUPPORTED_NETWORKS.chipnet);
        meta.receivedValid = true;
      } catch (error) {
        meta.receivedValid = errorText(error);
      }
      const stored = await engine.acceptInvitation(received, { roleIdentifier: 'service' });
      invitationIdentifier = stored.invitation.invitationIdentifier;
      meta.walletValuesSeen = Object.fromEntries((received.commits.flatMap((c) => c.data.variables ?? [])).map((v) => [v.variableIdentifier, String(v.value instanceof Uint8Array ? hex(v.value) : v.value)]));
    } else {
      const stored = await engine.createInvitation({ templateIdentifier, actionIdentifier: 'act', roleIdentifier: 'service' } as Parameters<Engine['createInvitation']>[0]);
      invitationIdentifier = stored.invitation.invitationIdentifier;
    }
    const unlockingBytecode = templateUnlockingBytecode(trialTemplate, 'sharedScript', 'sharedInput', { servicePrice: BigInt(job.price) });
    const variables: { variableIdentifier: string; roleIdentifier?: string; value: unknown }[] = [{ variableIdentifier: 'servicePrice', roleIdentifier: 'service', value: job.price }];
    // Values the template gives to the user's role, which the wallet has set already.
    if (job.mode === 'override') variables.push({ variableIdentifier: 'userAmount', roleIdentifier: 'service', value: 1n }, { variableIdentifier: 'userHolder', roleIdentifier: 'service', value: job.holder });
    if (job.mode === 'overrideUntagged') variables.push({ variableIdentifier: 'userHolder', value: job.holder });
    const append = {
      variables,
      inputs: [{ outpointTransactionHash: hexToBin(job.shared.transactionHash), outpointIndex: job.shared.index, inputIdentifier: 'sharedInput', unlockingBytecode, sequenceNumber: 0 }],
      outputs: [
        job.mode === 'forgeOutput'
          ? // The template's output, with a script and an amount other than the template's.
            { outputIdentifier: 'sharedOutput', roleIdentifier: 'service', lockingBytecode: hexToBin(job.holder!), valueSatoshis: 1500n }
          : { outputIdentifier: 'sharedOutput', roleIdentifier: job.mode === 'tagUserRole' ? 'user' : 'service' },
      ],
      ...(job.mode === 'expiryPast' ? { expiresAtTimestamp: Date.now() - 60_000 } : {}),
    };
    try {
      await engine.appendInvitation(invitationIdentifier, append as unknown as Parameters<Engine['appendInvitation']>[1]);
    } catch (error) {
      meta.appendError = errorText(error);
      writeFileSync(job.metaFile, JSON.stringify(meta));
      return;
    }
    const stored = await engine.getInvitation(invitationIdentifier);
    if (stored === undefined) throw new Error('the service lost its invitation');
    meta.entityIdentifier = stored.entityIdentifier;
    meta.rootCommitIdentifier = stored.invitation.commits.find((c) => c.entityIdentifier === stored.entityIdentifier)?.commitIdentifier;
    meta.templateIdentifier = templateIdentifier;
    meta.ownCommits = stored.invitation.commits.filter((c) => c.entityIdentifier === stored.entityIdentifier).length;
    meta.expiresAt = stored.invitation.commits.map((c) => c.expiresAtTimestamp);
    meta.missing = await engine.listMissingRequirements(invitationIdentifier).then((m) => JSON.parse(JSON.stringify(m, (_k, v) => (typeof v === 'bigint' ? String(v) : v)))).catch(errorText);
    let invitation: XOInvitation = stored.invitation;
    if (job.mode === 'tamperOwn' || job.mode === 'stretchExpiry') {
      invitation = deserializeInvitation(serializeInvitation(invitation));
      const own = invitation.commits.filter((c) => c.entityIdentifier === stored.entityIdentifier).at(-1)!;
      if (job.mode === 'tamperOwn') (own.data.variables!.find((v) => v.variableIdentifier === 'servicePrice')!).value = 999 as never;
      else own.expiresAtTimestamp = Date.now() + 365 * 24 * 3600_000;
    }
    writeFileSync(job.outFile, serializeInvitation(invitation));
    meta.totalMs = Date.now() - started;
    writeFileSync(job.metaFile, JSON.stringify(meta));
  } finally {
    await engine.stop().catch(() => undefined);
  }
};

if (process.argv[2] === 'service') {
  try {
    await runService(JSON.parse(readFileSync(process.argv[3]!, 'utf8')) as ServiceJob);
  } catch (error) {
    writeFileSync(JSON.parse(readFileSync(process.argv[3]!, 'utf8')).metaFile, JSON.stringify({ failed: errorText(error), engineErrors: engineErrors.slice(0, 3) }));
  }
  process.exit(0);
}

// --- The wallet ---------------------------------------------------------------------------------------------
const RUN = String(Date.now());
let jobs = 0;
/** Ask the service: a child process with an empty engine, by files. */
const askService = async (job: Omit<ServiceJob, 'outFile' | 'metaFile'>, invitation?: XOInvitation): Promise<{ invitation?: XOInvitation; meta: Record<string, unknown> }> => {
  const n = ++jobs;
  const base = `${DATA}trial36-${RUN}-${n}`;
  const full: ServiceJob = { ...job, outFile: `${base}-out.json`, metaFile: `${base}-meta.json` };
  if (invitation !== undefined) {
    full.inFile = `${base}-in.json`;
    writeFileSync(full.inFile, serializeInvitation(invitation));
  }
  writeFileSync(`${base}-job.json`, JSON.stringify(full));
  await new Promise<void>((resolve, reject) => {
    const child = spawn('npx', ['tsx', SELF, 'service', `${base}-job.json`], { stdio: ['ignore', 'ignore', 'inherit'] });
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('the service took too long')); }, 60_000);
    child.on('exit', () => { clearTimeout(timer); resolve(); });
  });
  const meta = JSON.parse(readFileSync(full.metaFile, 'utf8')) as Record<string, unknown>;
  let out: XOInvitation | undefined;
  try { out = deserializeInvitation(readFileSync(full.outFile, 'utf8')); } catch { out = undefined; }
  return { ...(out === undefined ? {} : { invitation: out }), meta };
};

const results: Record<string, unknown> = {};
const note = (key: string, value: unknown) => {
  results[key] = value;
  console.log(`${key}:`, JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? String(v) : v instanceof Uint8Array ? hex(v) : v)));
};

const walletName = `trial36-wallet-${RUN}`;
const serviceName = `trial36-service-${RUN}`;
const engine: Engine = await openEngineRegtest(walletName);
try {
  for (let i = 0; ; i++) {
    const status = await engine.getChainStatus();
    if (status.verifiedHeight >= status.currentHeight) break;
    if (i > 120) throw new Error('header check did not reach the tip');
    await wait(500);
  }
  const p2pkh = (await engine.importTemplate(p2pkhTemplate)).templateIdentifier;
  await engine.setDefaultPolicies({ change: { templateIdentifier: p2pkh }, receive: { templateIdentifier: p2pkh }, address: { templateIdentifier: p2pkh } });
  const templateIdentifier = (await engine.importTemplate(TEMPLATE_TEXT)).templateIdentifier;
  const walletAddress = await engine.generateLockingBytecodeFromDefaultPolicy('receive');

  // Funding: a plain key's coinbase coin pays six coins to the wallet and eight to the shared script.
  const funder = keyPairFromPrivateKey(crypto.getRandomValues(new Uint8Array(32)));
  const funderLocking = p2pkhLockingBytecode(funder.keyHash);
  const [blockHash] = (await mine(1, hex(funderLocking))) as string[];
  await mine(100, BURN);
  const block = await rpc('getblock', blockHash, 2);
  const coinbase: Utxo = { transactionHash: hexToBin(block.tx[0].txid), index: 0, output: { lockingBytecode: funderLocking, valueSatoshis: BigInt(Math.round(block.tx[0].vout[0].value * 1e8)) } };
  const funding = buildTransaction({
    inputs: [p2pkhInput(coinbase, funder)],
    outputs: [
      ...Array.from({ length: 6 }, () => ({ lockingBytecode: hexToBin(walletAddress), valueSatoshis: 200_000n })),
      ...Array.from({ length: 8 }, () => ({ lockingBytecode: SHARED_LOCKING, valueSatoshis: 2000n })),
    ],
    changeLockingBytecode: funderLocking,
  });
  await rpc('sendrawtransaction', hex(funding.encoded));
  await mine(1, BURN);
  const fundingId = hex(funding.transactionHash);
  const shared = (n: number) => ({ transactionHash: fundingId, index: 6 + n });
  let walletCoins = await engine.listSpendableUnspentOutputs();
  for (let i = 0; walletCoins.length < 6 && i < 60; i++) { await wait(500); walletCoins = await engine.listSpendableUnspentOutputs(); }
  note('setup', { templateIdentifier, walletCoins: walletCoins.length, sharedScriptTrackedByWallet: (await engine.listScriptHashes()).some((s) => s.lockingBytecode === hex(SHARED_LOCKING)) });
  const nextWalletCoin = async () => {
    const coin = (await engine.listSpendableUnspentOutputs({ templateIdentifier: p2pkh } as never)).find((c) => c.outpointTransactionHash === fundingId);
    if (coin === undefined) throw new Error('no wallet coin left');
    return coin;
  };

  const sourceOutput = async (transactionHash: Uint8Array, index: number): Promise<Output> => {
    const decoded = decodeTransactionBch(hexToBin(await rpc('getrawtransaction', hex(transactionHash), false)));
    if (typeof decoded === 'string') throw new Error(decoded);
    return decoded.outputs[index]!;
  };

  /** The wallet's part after the service's: its coin, the output that depends on the service's price, change; sign; check. */
  const finish = async (invitationIdentifier: string, label: string, send: boolean) => {
    const coin = await nextWalletCoin();
    await engine.appendInvitation(invitationIdentifier, {
      inputs: [{ outpointTransactionHash: hexToBin(coin.outpointTransactionHash), outpointIndex: coin.outpointIndex }],
      outputs: [{ outputIdentifier: 'userOutput', roleIdentifier: 'user' }],
    } as unknown as Parameters<Engine['appendInvitation']>[1]);
    await engine.addChangeToInvitation(invitationIdentifier);
    const own = await engine.listOwnInputIndexes(invitationIdentifier);
    for (const index of own) await engine.signInvitation(invitationIdentifier, index);
    const missing = await engine.listMissingRequirements(invitationIdentifier);
    const { builtTransaction } = await engine.executeAction(invitationIdentifier, { broadcastTransaction: false });
    const transaction = decodeTransactionBch(hexToBin(builtTransaction.serializedTransaction));
    if (typeof transaction === 'string') throw new Error(transaction);
    const sourceOutputs = await Promise.all(transaction.inputs.map((input) => sourceOutput(input.outpointTransactionHash, input.outpointIndex)));
    const summary = {
      ownInputs: own,
      missingAfterSigning: JSON.parse(JSON.stringify(missing, (_k, v) => (typeof v === 'bigint' ? String(v) : v))),
      inputs: transaction.inputs.map((input, i) => `${i}: ${hex(input.outpointTransactionHash).slice(0, 8)}:${input.outpointIndex}${hex(sourceOutputs[i]!.lockingBytecode) === hex(SHARED_LOCKING) ? ' shared' : ''} unlocking ${input.unlockingBytecode.length} B`),
      outputs: transaction.outputs.map((output, i) => `${i}: ${output.valueSatoshis} sat ${hex(output.lockingBytecode) === hex(SHARED_LOCKING) ? 'shared' : hex(output.lockingBytecode) === walletAddress ? 'userHolder (wallet receive)' : hex(output.lockingBytecode).slice(0, 10)}`),
      vm: verifyTransaction({ transaction, sourceOutputs }),
      projectCheck: checkBeforeSending({ transaction, sourceOutputs }),
      bytes: builtTransaction.serializedTransaction.length / 2,
    };
    let sent: string | undefined;
    if (send) {
      try {
        await engine.executeAction(invitationIdentifier, { broadcastTransaction: true });
      } catch (error) {
        if ((error as Error).name !== 'UnspentOutputNotFoundInStoreError') throw error;
      }
      sent = builtTransaction.transactionHash;
    }
    note(label, { ...summary, sent });
    return { transaction, transactionId: builtTransaction.transactionHash, sent };
  };
  const confirmed = async (transactionId: string) => {
    await mine(1, BURN);
    const tx = await rpc('getrawtransaction', transactionId, true);
    return tx.confirmations as number;
  };

  // 1. Wallet first.
  const userValues = (holder = walletAddress) => [
    { variableIdentifier: 'userAmount', roleIdentifier: 'user', value: 10_000n },
    { variableIdentifier: 'userHolder', roleIdentifier: 'user', value: holder },
  ];
  const created = await engine.createInvitation({ templateIdentifier, actionIdentifier: 'act', roleIdentifier: 'user', variables: userValues() } as Parameters<Engine['createInvitation']>[0]);
  const id1 = created.invitation.invitationIdentifier;
  const wallet1Entity = created.entityIdentifier;
  const answer1 = await askService({ account: serviceName, shared: shared(0), price: 7 }, created.invitation);
  note('1 service answer', answer1.meta);
  const updated1 = await engine.updateInvitation(answer1.invitation!);
  note('1 wallet took the service\'s commits', { commits: updated1.invitation.commits.map((c) => (c.entityIdentifier === wallet1Entity ? 'wallet' : 'service')), walletEntityKept: updated1.entityIdentifier === wallet1Entity });
  const one = await finish(id1, '1 wallet first, built', true);
  note('1 confirmations', await confirmed(one.transactionId));
  const after1 = (await engine.getInvitation(id1))!.invitation;
  try { validateInvitation(after1, (await engine.getTemplate(templateIdentifier))!, XO_SUPPORTED_NETWORKS.chipnet); note('1 final invitation validates (service commit still valid after the wallet\'s additions)', true); } catch (error) { note('1 final invitation validates', errorText(error)); }
  writeFileSync(`${DATA}trial36-${RUN}-wallet-first-final.json`, serializeInvitation(after1));

  // 2. Service first.
  const answer2 = await askService({ account: serviceName, shared: shared(1), price: 11 });
  note('2 service created', answer2.meta);
  const accepted2 = await engine.acceptInvitation(answer2.invitation!, { roleIdentifier: 'user' });
  const id2 = accepted2.invitation.invitationIdentifier;
  await engine.appendInvitation(id2, { variables: userValues() } as unknown as Parameters<Engine['appendInvitation']>[1]);
  const two = await finish(id2, '2 service first, built', true);
  note('2 confirmations', await confirmed(two.transactionId));

  // 3. Identity.
  const recomputed = (meta: Record<string, unknown>) => {
    const root = deriveHdPrivateNodeFromSeed(convertMnemonicToSeedBytes(mnemonicFor(serviceName)) as never);
    if (typeof root === 'string') throw new Error(root);
    const index = createPathIndexFromHash(sha256.hash(hexToBin(String(meta.templateIdentifier) + String(meta.rootCommitIdentifier))));
    const node = deriveHdPath(root as never, `m/42415'/0'/0'/${index}'`);
    if (typeof node === 'string') throw new Error(node);
    return encodeHdPublicKey({ network: 'testnet', node: deriveHdPublicNode(node) }).hdPublicKey;
  };
  const again = await askService({ account: serviceName, shared: shared(0), price: 7 }, created.invitation);
  note('3 identity', {
    serviceEntityInvitation1: answer1.meta.entityIdentifier,
    serviceEntityInvitation2: answer2.meta.entityIdentifier,
    sameInvitationAcceptedAgainByTheSameSeed: again.meta.entityIdentifier,
    allDifferent: new Set([answer1.meta.entityIdentifier, answer2.meta.entityIdentifier, again.meta.entityIdentifier]).size === 3,
    recomputedFromSeedTemplateAndRootCommit: [answer1, answer2, again].map((a) => recomputed(a.meta) === a.meta.entityIdentifier),
  });

  // Each later experiment uses a fresh invitation of the wallet's, put aside afterwards.
  const freshWallet = async (variables = userValues()) => {
    const stored = await engine.createInvitation({ templateIdentifier, actionIdentifier: 'act', roleIdentifier: 'user', variables } as Parameters<Engine['createInvitation']>[0]);
    return stored;
  };
  const tryUpdate = async (invitation: XOInvitation | undefined) => {
    if (invitation === undefined) return 'no invitation came back';
    try { await engine.updateInvitation(invitation); return 'accepted'; } catch (error) { return errorText(error); }
  };

  // 4. An impostor seed as the service.
  {
    const mine4 = await freshWallet();
    const impostor = await askService({ account: `trial36-impostor-${RUN}`, shared: shared(2), price: 7 }, mine4.invitation);
    note('4 impostor seed joins as service; wallet updateInvitation', { result: await tryUpdate(impostor.invitation), impostorEntity: impostor.meta.entityIdentifier });
    await engine.archiveInvitation(mine4.invitation.invitationIdentifier);
  }

  // 5. Tampering.
  {
    const mine5 = await freshWallet();
    const changed = deserializeInvitation(serializeInvitation(mine5.invitation));
    (changed.commits[0]!.data.variables!.find((v) => v.variableIdentifier === 'userAmount')!).value = 99_999n as never;
    const a = await askService({ account: serviceName, shared: shared(2), price: 7 }, changed);
    note('5a wallet commit changed after signing, sent to the service', { serviceSawItValid: a.meta.receivedValid, serviceAccepted: a.invitation !== undefined && a.meta.appendError === undefined, appendError: a.meta.appendError, walletUpdate: await tryUpdate(a.invitation) });
    const b = await askService({ account: serviceName, shared: shared(2), price: 7, mode: 'tamperOwn' }, mine5.invitation);
    note('5b service commit changed after signing; wallet updateInvitation', await tryUpdate(b.invitation));
    const c = await askService({ account: serviceName, shared: shared(2), price: 7, mode: 'stretchExpiry' }, mine5.invitation);
    note('5c service commit expiry changed after signing; wallet updateInvitation', await tryUpdate(c.invitation));
    await engine.archiveInvitation(mine5.invitation.invitationIdentifier);
  }

  // 6. An expiry in the past.
  {
    const mine6 = await freshWallet();
    const answer = await askService({ account: serviceName, shared: shared(3), price: 7, mode: 'expiryPast' }, mine6.invitation);
    note('6 service commit expired a minute ago', { expiresAt: answer.meta.expiresAt, now: Date.now(), walletUpdate: await tryUpdate(answer.invitation) });
    const six = await finish(mine6.invitation.invitationIdentifier, '6 built and sent with an expired commit', true);
    note('6 confirmations', await confirmed(six.transactionId));
  }

  // 7. The service sets values the template gives to the wallet's role, after the wallet has set them.
  {
    const elsewhere = hex(p2pkhLockingBytecode(new Uint8Array(20).fill(0x66)));
    const mine7 = await freshWallet();
    const untagged = await askService({ account: serviceName, shared: shared(4), price: 7, mode: 'overrideUntagged', holder: elsewhere }, mine7.invitation);
    note('7a service gives userHolder untagged', { appendError: untagged.meta.appendError ?? 'none' });
    const tagged = await askService({ account: serviceName, shared: shared(4), price: 7, mode: 'override', holder: elsewhere }, mine7.invitation);
    note('7b service gives userAmount 1 and userHolder elsewhere, tagged as its own role', { appendError: tagged.meta.appendError ?? 'none', walletUpdate: await tryUpdate(tagged.invitation) });
    const built = await finish(mine7.invitation.invitationIdentifier, '7b built: the wallet adds userOutput after the override', false).catch((error) => ({ error: errorText(error) }));
    note('7b where the user output goes', 'transaction' in built ? { to: hex(built.transaction.outputs[1]!.lockingBytecode) === elsewhere ? 'the service\'s choice' : 'the wallet', satoshis: built.transaction.outputs[1]!.valueSatoshis } : built);
    await engine.archiveInvitation(mine7.invitation.invitationIdentifier);
    // The same, with the wallet giving its values again after taking the service's commits.
    const again7 = await freshWallet();
    const tagged2 = await askService({ account: serviceName, shared: shared(4), price: 7, mode: 'override', holder: elsewhere }, again7.invitation);
    await engine.updateInvitation(tagged2.invitation!);
    let restated: string;
    try {
      await engine.appendInvitation(again7.invitation.invitationIdentifier, { variables: userValues() } as unknown as Parameters<Engine['appendInvitation']>[1]);
      restated = 'accepted';
    } catch (error) { restated = errorText(error); }
    const built2 = await finish(again7.invitation.invitationIdentifier, '7c built after the wallet restated its values', false).catch((error) => ({ error: errorText(error) }));
    note('7c the wallet restates its values after the override', { restated, ...('transaction' in built2 ? { to: hex(built2.transaction.outputs[1]!.lockingBytecode) === elsewhere ? 'the service\'s choice' : 'the wallet', satoshis: built2.transaction.outputs[1]!.valueSatoshis } : built2) });
    await engine.archiveInvitation(again7.invitation.invitationIdentifier);
  }

  // 8. The service tags an item with the wallet's role.
  {
    const mine8 = await freshWallet();
    const answer = await askService({ account: serviceName, shared: shared(4), price: 7, mode: 'tagUserRole' }, mine8.invitation);
    note('8 service tags its shared output with role user', { appendError: answer.meta.appendError ?? 'none', walletUpdate: answer.invitation === undefined ? 'nothing came back' : await tryUpdate(answer.invitation) });
    await engine.archiveInvitation(mine8.invitation.invitationIdentifier);
  }

  // 9. One shared coin, two invitations.
  {
    const a = await freshWallet();
    const b = await freshWallet();
    const answerA = await askService({ account: serviceName, shared: shared(5), price: 7 }, a.invitation);
    const answerB = await askService({ account: serviceName, shared: shared(5), price: 7 }, b.invitation);
    await engine.updateInvitation(answerA.invitation!);
    await engine.updateInvitation(answerB.invitation!);
    // Both are built first, so that the wallet's own coins differ (each invitation holds its coin).
    const builtA = await finish(a.invitation.invitationIdentifier, '9a first of two with the same shared coin', false);
    const builtB = await finish(b.invitation.invitationIdentifier, '9b second of two with the same shared coin', false).catch((error) => ({ error: errorText(error) }));
    await engine.executeAction(a.invitation.invitationIdentifier, { broadcastTransaction: true }).catch((error) => { if ((error as Error).name !== 'UnspentOutputNotFoundInStoreError') throw error; });
    let secondSent: string;
    try {
      await engine.executeAction(b.invitation.invitationIdentifier, { broadcastTransaction: true });
      secondSent = 'sent';
    } catch (error) { secondSent = errorText(error); }
    note('9 second broadcast', { builtB: 'error' in builtB ? builtB.error : 'built and signed by the wallet', secondSent });
    note('9 confirmations of the first', await confirmed(builtA.transactionId));
    await engine.archiveInvitation(b.invitation.invitationIdentifier).catch(() => undefined);
  }

  // 11. The service gives a template output another script and amount than the template's.
  {
    const elsewhere = hex(p2pkhLockingBytecode(new Uint8Array(20).fill(0x77)));
    const mine11 = await freshWallet();
    const answer = await askService({ account: serviceName, shared: shared(6), price: 7, mode: 'forgeOutput', holder: elsewhere }, mine11.invitation);
    note('11 service forges sharedOutput', { appendError: answer.meta.appendError ?? 'none', walletUpdate: await tryUpdate(answer.invitation) });
    const built = await finish(mine11.invitation.invitationIdentifier, '11 built with the forged output', false).catch((error) => ({ error: errorText(error) }));
    note('11 output 0 as built', 'transaction' in built ? { to: hex(built.transaction.outputs[0]!.lockingBytecode) === elsewhere ? 'the forged script' : hex(built.transaction.outputs[0]!.lockingBytecode) === hex(SHARED_LOCKING) ? 'the template\'s script' : 'other', satoshis: built.transaction.outputs[0]!.valueSatoshis } : built);
    await engine.archiveInvitation(mine11.invitation.invitationIdentifier);
  }

  // 10. A second engine in this process.
  await engine.stop().catch(() => undefined);
  try {
    const second: Engine = await openEngineRegtest(`trial36-second-${RUN}`);
    note('10 second engine in one process after stop()', 'opened');
    await second.stop().catch(() => undefined);
  } catch (error) {
    note('10 second engine in one process after stop()', errorText(error));
  }
  writeFileSync(`${DATA}trial36-${RUN}-results.json`, JSON.stringify(results, (_k, v) => (typeof v === 'bigint' ? String(v) : v), 1));
} catch (error) {
  console.log('FAILED:', errorText(error), (error as Error).cause ?? '');
  console.log('engine errors:', [...new Set(engineErrors)].slice(0, 5));
  process.exitCode = 1;
} finally {
  await engine.stop().catch(() => undefined);
  process.exit();
}
