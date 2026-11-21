// Trial: one real action of the ParyonUSD loan template, `manage` (add collateral), carried out by the wallet with a
// real second participant: Paryon's service, an XO engine with a seed of its own in a process of its own.
//
// - Paryon's contracts, as published, are deployed on the local node (packages/paryon/src/local-deployment.ts), and a
//   loan is opened with this project's plain builders (createLoanKey, borrow); its key goes to an address of the
//   wallet's engine (the standard P2PKH template).
// - The template is a trial copy of version 2 (packages/paryon is not changed): a `service` role is added, the
//   `manage` action splits its variables between the borrower and the service and requires both, and every Paryon
//   script declares the service role as one that need not be tracked.
// - The wallet starts the invitation with what only it knows: the key's category, the collateral it wants, what its
//   key coin holds, where the key goes back to; and its key coin as an input.
// - The service (child process, empty engine, nothing kept afterwards) reads the key's category from the invitation,
//   finds the loan and Paryon's shared coins on chain with packages/paryon's own code (live.ts, page-requests.ts),
//   and adds the price, the loan's record, the interest manager, the four shared coins with their unlocking, and the
//   four shared outputs.
// - The wallet takes the service's commits, adds the key's return output, a coin for the fee and its change at the
//   exact fee, checks every input in the virtual machine, signs its two inputs and sends.
//
// usage (from packages/app): timeout 600 npx tsx ../../spikes/xo-engine/37-paryon-service-manage.ts
import 'fake-indexeddb/auto';
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { type Output, binToHex, decodeTransactionBch, encodeTransactionBch, encodeTransactionOutput, hexToBin } from '@bitauth/libauth';
import { type Utxo, buildTransaction, checkBeforeSending, keyPairFromPrivateKey, p2pkhInput, p2pkhLockingBytecode, templateUnlockingBytecode } from '@grandmas-wallet/core';
import { type Engine, XO_SUPPORTED_NETWORKS, validateInvitation } from '@xo-cash/engine';
import { p2pkhTemplate } from '@xo-cash/templates';
import type { XOInvitation, XOTemplate } from '@xo-cash/types';
import { deserializeInvitation, serializeInvitation } from '@xo-cash/utils';
import { Electrum } from '../../packages/chipnet/src/electrum.ts';
import { type ParyonDeployment, borrow, createLoanKey, findLoan, loanCoins, manageLoan, manageRequestAlone, minimumCollateral, paryonContracts } from '../../packages/paryon/src/index.ts';
import { localDeployment } from '../../packages/paryon/src/local-deployment.ts';
import { paryonTemplateSource } from '../../packages/paryon/src/template-source.ts';
// @ts-expect-error plain script
import { openEngineRegtest, mine, rpc, BURN } from './regtest.mjs';
// @ts-expect-error plain script
import { DATA } from './common.mjs';

const engineErrors: string[] = [];
console.error = (...args: unknown[]) => engineErrors.push(String(args[0]).slice(0, 300));
const hex = binToHex;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const errorText = (error: unknown) => `${(error as Error).name}: ${String((error as Error).message).replace(/\s+/g, ' ').slice(0, 600)}`;
const json = (value: unknown) => JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? String(v) : v instanceof Uint8Array ? hex(v) : v));
const SELF = fileURLToPath(import.meta.url);
const ELECTRUM = 'ws://127.0.0.1:60403';

/** Which of Paryon's scripts each shared input of `manage` spends. */
const SHARED_INPUTS = { priceInput: 'priceContract', loanInput: 'loanContract', sidecarInput: 'sidecarContract', manageInput: 'manageContract' } as const;
const SHARED_OUTPUTS = ['priceOutput', 'loanOutput', 'sidecarOutput', 'manageOutput'];
const BORROWER_VARIABLES = ['keyCategory', 'collateral', 'keySatoshis', 'keyHolder'];
const SERVICE_VARIABLES = ['priceCommitment', 'loanCommitment', 'interestManagerConfiguration'];

/** The trial copy of the loan template, version 2, with a service role. */
const trialTemplateText = (deployment: ParyonDeployment): string => {
  const t = paryonTemplateSource(paryonContracts(deployment), 2) as Record<string, any>;
  t.name = `${t.name} with a service (trial)`;
  t.version = '2-service-trial';
  t.roles.service = { name: 'Paryon\'s service', description: 'Brings the price, the loan\'s record and Paryon\'s shared coins.' };
  t.actions.manage.roles = { borrower: { requirements: { variables: BORROWER_VARIABLES } }, service: { requirements: { variables: SERVICE_VARIABLES } } };
  t.actions.manage.requirements = { participants: [{ role: 'borrower', slots: { min: 1, max: 1 } }, { role: 'service', slots: { min: 1, max: 1 } }] };
  // Every Paryon script: the service need not track it either. The borrower's follow-ups stay as they are.
  for (const script of Object.values(t.lockingScripts) as Record<string, any>[]) script.roles.service = { selectable: false, relevant: false };
  return JSON.stringify(t);
};

// --- The service ----------------------------------------------------------------------------------------------
interface ServiceJob { account: string; inFile: string; outFile: string; metaFile: string; deployment: ParyonDeployment; templateText: string }

const runService = async (job: ServiceJob) => {
  const started = Date.now();
  const meta: Record<string, unknown> = {};
  const engine: Engine = await openEngineRegtest(job.account);
  const server = await Electrum.connect(ELECTRUM);
  try {
    const contracts = paryonContracts(job.deployment);
    const { templateIdentifier } = await engine.importTemplate(job.templateText);
    const definition = (await engine.getTemplate(templateIdentifier)) as XOTemplate;
    const received = deserializeInvitation(readFileSync(job.inFile, 'utf8'));
    validateInvitation(received, definition, XO_SUPPORTED_NETWORKS.chipnet);
    if (received.actionIdentifier !== 'manage') throw new Error('this service answers manage only');
    const stored = await engine.acceptInvitation(received, { roleIdentifier: 'service' });
    const id = stored.invitation.invitationIdentifier;
    // What the wallet said, read from its commits.
    const said = Object.fromEntries(received.commits.flatMap((c) => c.data.variables ?? []).map((v) => [v.variableIdentifier, v.value]));
    const keyCategory = String(said.keyCategory);
    // Paryon's own code finds the loan from its key and picks the shared coins, as the loan's page does today.
    const coins = await loanCoins(server, contracts, hexToBin(keyCategory), BigInt(String(said.keySatoshis)));
    if (coins === undefined) throw new Error('the key opens no loan');
    const request = manageRequestAlone({ identifier: templateIdentifier, contentHash: '' }, { ...coins, keyCategory, collateral: BigInt(String(said.collateral)) });
    const values = { ...said, ...request.variables } as Record<string, unknown>;
    const typed = (name: string) => (definition.variables?.[name]?.type === 'satoshis' || definition.variables?.[name]?.type === 'token_amount' ? BigInt(String(values[name])) : values[name]);
    const byOutpoint = new Map([coins.price, coins.loan, coins.sidecar, coins.manageFunction].map((utxo) => [`${hex(utxo.transactionHash)}:${utxo.index}`, utxo]));
    const inputs = Object.entries(SHARED_INPUTS).map(([inputIdentifier, lockingScript]) => {
      const [transactionHash, index] = (request.inputs as Record<string, string>)[inputIdentifier]!.split(':') as [string, string];
      if (!byOutpoint.has(`${transactionHash}:${index}`)) throw new Error('unknown coin');
      const unlockingBytecode = templateUnlockingBytecode(definition, lockingScript, inputIdentifier, Object.fromEntries(Object.keys(values).map((k) => [k, typed(k)])) as never);
      return { outpointTransactionHash: hexToBin(transactionHash), outpointIndex: Number(index), inputIdentifier, unlockingBytecode, sequenceNumber: 0, roleIdentifier: 'service' };
    });
    await engine.appendInvitation(id, {
      variables: SERVICE_VARIABLES.map((variableIdentifier) => ({ variableIdentifier, roleIdentifier: 'service', value: typed(variableIdentifier) })),
      inputs,
      outputs: SHARED_OUTPUTS.map((outputIdentifier) => ({ outputIdentifier, roleIdentifier: 'service' })),
    } as unknown as Parameters<Engine['appendInvitation']>[1]);
    const after = (await engine.getInvitation(id))!;
    meta.entityIdentifier = after.entityIdentifier;
    meta.loan = { outpoint: `${hex(coins.loan.transactionHash)}:${coins.loan.index}`, collateralBefore: String(coins.loan.output.valueSatoshis), debt: String(coins.state.borrowed) };
    meta.serviceTracksScripts = (await engine.listScriptHashes()).filter((s) => s.templateIdentifier === templateIdentifier).length;
    meta.serviceHoldsReservations = (await engine.listUnspentOutputs()).length;
    meta.missingAfterService = JSON.parse(json(await engine.listMissingRequirements(id)));
    writeFileSync(job.outFile, serializeInvitation(after.invitation));
    meta.totalMs = Date.now() - started;
  } finally {
    writeFileSync(job.metaFile, json(meta));
    await server.disconnect().catch(() => undefined);
    await engine.stop().catch(() => undefined);
  }
};

if (process.argv[2] === 'service') {
  const job = JSON.parse(readFileSync(process.argv[3]!, 'utf8')) as ServiceJob;
  try { await runService(job); } catch (error) { writeFileSync(job.metaFile, json({ failed: errorText(error), engineErrors: engineErrors.slice(0, 3) })); }
  process.exit(0);
}

// --- The wallet -----------------------------------------------------------------------------------------------
const RUN = String(Date.now());
const askService = async (job: Omit<ServiceJob, 'inFile' | 'outFile' | 'metaFile'>, invitation: XOInvitation) => {
  const base = `${DATA}trial37-${RUN}`;
  const full: ServiceJob = { ...job, inFile: `${base}-in.json`, outFile: `${base}-out.json`, metaFile: `${base}-meta.json` };
  writeFileSync(full.inFile, serializeInvitation(invitation));
  writeFileSync(`${base}-job.json`, JSON.stringify(full));
  await new Promise<void>((resolve, reject) => {
    const child = spawn('npx', ['tsx', SELF, 'service', `${base}-job.json`], { stdio: ['ignore', 'ignore', 'inherit'] });
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('the service took too long')); }, 90_000);
    child.on('exit', () => { clearTimeout(timer); resolve(); });
  });
  const meta = JSON.parse(readFileSync(full.metaFile, 'utf8')) as Record<string, unknown>;
  if (meta.failed !== undefined) throw new Error(`the service failed: ${String(meta.failed)}`);
  return { invitation: deserializeInvitation(readFileSync(full.outFile, 'utf8')), meta };
};
const note = (key: string, value: unknown) => console.log(`${key}:`, json(value));

const engine: Engine = await openEngineRegtest(`trial37-wallet-${RUN}`);
const server = await Electrum.connect(ELECTRUM);
try {
  for (let i = 0; ; i++) {
    const status = await engine.getChainStatus();
    if (status.verifiedHeight >= status.currentHeight) break;
    if (i > 120) throw new Error('header check did not reach the tip');
    await wait(500);
  }
  const p2pkh = (await engine.importTemplate(p2pkhTemplate)).templateIdentifier;
  await engine.setDefaultPolicies({ change: { templateIdentifier: p2pkh }, receive: { templateIdentifier: p2pkh }, address: { templateIdentifier: p2pkh } });
  const walletAddress = hexToBin(await engine.generateLockingBytecodeFromDefaultPolicy('receive'));

  // Paryon on the local chain, and a loan opened by plain script whose key goes to the wallet's engine.
  const funder = keyPairFromPrivateKey(crypto.getRandomValues(new Uint8Array(32)));
  const funderLocking = p2pkhLockingBytecode(funder.keyHash);
  const hashes = (await mine(4, hex(funderLocking))) as string[];
  await mine(100, BURN);
  const coinbase = async (blockHash: string): Promise<Utxo> => {
    const tx = (await rpc('getblock', blockHash, 2)).tx[0];
    return { transactionHash: hexToBin(tx.txid), index: 0, output: { lockingBytecode: funderLocking, valueSatoshis: BigInt(Math.round(tx.vout[0].value * 1e8)) } };
  };
  const [paryonCoin, factoryCoin, keyCoin, money] = (await Promise.all(hashes.map(coinbase))) as [Utxo, Utxo, Utxo, Utxo];
  const PRICE = 2_000_000n; // US cents per BCH, so that a loan of 100 PUSD needs little collateral
  // One long period, so that no block mined during the run starts another.
  const local = localDeployment({ funder, paryonCoin, factoryCoin, price: PRICE, period: 0, periodLengthBlocks: 1_000_000 });
  for (const built of local.transactions) await rpc('sendrawtransaction', hex(built.encoded));
  const { contracts, deployment } = local;
  const key = createLoanKey({ contracts, factory: local.loanKeyFactory[0]!, defining: p2pkhInput(keyCoin, funder), changeTo: funderLocking });
  await rpc('sendrawtransaction', hex(key.built.encoded));
  const DEBT = 100_00n;
  const COLLATERAL = (minimumCollateral(DEBT, PRICE) * 125n) / 110n;
  // The funder's money: collateral for the loan, and two coins for the wallet's fees.
  const split = buildTransaction({ inputs: [p2pkhInput(money, funder)], outputs: [{ lockingBytecode: funderLocking, valueSatoshis: COLLATERAL + 100_000n }, { lockingBytecode: walletAddress, valueSatoshis: 50_000n }, { lockingBytecode: walletAddress, valueSatoshis: 50_000n }], changeLockingBytecode: funderLocking });
  await rpc('sendrawtransaction', hex(split.encoded));
  const opened = borrow({
    contracts, borrowing: local.borrowing[0]!, price: local.price[0]!, enforcer: key.enforcer, proof: key.proof,
    wallet: [p2pkhInput({ transactionHash: split.transactionHash, index: 0, output: split.transaction.outputs[0]! }, funder)],
    debt: DEBT, collateral: COLLATERAL, startingInterest: 0, keyTo: walletAddress, tokensTo: funderLocking, changeTo: funderLocking,
  });
  await rpc('sendrawtransaction', hex(opened.built.encoded));
  await mine(1, BURN);
  const keyCategory = hex(opened.keyCategory);
  note('loan opened by plain script', { loan: `${hex(opened.built.transactionHash)}:2`, collateral: COLLATERAL, debt: DEBT, keyCategory });

  // The wallet's engine holds the key coin and two plain coins.
  let held = await engine.listUnspentOutputs();
  for (let i = 0; held.length < 3 && i < 60; i++) { await wait(500); held = await engine.listUnspentOutputs(); }
  const keyEntry = held.find((u) => u.tokenCategory === keyCategory);
  const feeEntry = held.find((u) => u.tokenCategory === undefined);
  if (keyEntry === undefined || feeEntry === undefined) throw new Error(`the wallet's engine does not list the key and a coin (${held.length} coins)`);

  // The template: both sides import the same text.
  const templateText = trialTemplateText(deployment);
  const templateIdentifier = (await engine.importTemplate(templateText)).templateIdentifier;
  const definition = (await engine.getTemplate(templateIdentifier)) as XOTemplate;

  // 1. The wallet starts: its values, its key coin.
  const ADD = 30_000n;
  const variables = [
    { variableIdentifier: 'keyCategory', roleIdentifier: 'borrower', value: keyCategory },
    { variableIdentifier: 'collateral', roleIdentifier: 'borrower', value: COLLATERAL + ADD },
    { variableIdentifier: 'keySatoshis', roleIdentifier: 'borrower', value: BigInt(keyEntry.valueSatoshis) },
    { variableIdentifier: 'keyHolder', roleIdentifier: 'borrower', value: hex(walletAddress) },
  ];
  let created;
  try {
    created = await engine.createInvitation({
      templateIdentifier, actionIdentifier: 'manage', roleIdentifier: 'borrower', variables,
      inputs: [{ outpointTransactionHash: hexToBin(keyEntry.outpointTransactionHash), outpointIndex: keyEntry.outpointIndex }],
    } as Parameters<Engine['createInvitation']>[0]);
    note('1 wallet created manage, an action that is not a starting action of the template', 'accepted');
  } catch (error) {
    throw new Error(`createInvitation for manage: ${errorText(error)}`);
  }
  const id = created.invitation.invitationIdentifier;

  // 2–3. The service joins.
  const answer = await askService({ account: `trial37-service-${RUN}`, deployment, templateText }, created.invitation);
  note('3 service answer', answer.meta);

  // 4. The wallet takes the service's commits and finishes.
  const updated = await engine.updateInvitation(answer.invitation);
  note('4 wallet took the service\'s commits', { commits: updated.invitation.commits.map((c) => (c.entityIdentifier === created.entityIdentifier ? 'wallet' : 'service')) });
  await engine.appendInvitation(id, {
    inputs: [{ outpointTransactionHash: hexToBin(feeEntry.outpointTransactionHash), outpointIndex: feeEntry.outpointIndex }],
    outputs: [{ outputIdentifier: 'keyBackOutput', roleIdentifier: 'borrower' }],
  } as unknown as Parameters<Engine['appendInvitation']>[1]);
  // The exact fee: the transaction as it stands, with 100 bytes for each of the wallet's two P2PKH unlockings and a
  // change output of 34 bytes. The engine's own estimate (160 per input, 120 per output) is too low for Paryon's inputs.
  const preview = decodeTransactionBch(hexToBin((await engine.buildInvitationTransactionFromMergedCommit(id)).serializedTransaction));
  if (typeof preview === 'string') throw new Error(preview);
  const own = await engine.listOwnInputIndexes(id);
  const sized = { ...preview, inputs: preview.inputs.map((input, i) => (own.includes(i) ? { ...input, unlockingBytecode: new Uint8Array(100) } : input)), outputs: [...preview.outputs, { lockingBytecode: walletAddress, valueSatoshis: 0n }] };
  const sourceOutput = async (transactionHash: Uint8Array, index: number): Promise<Output> => {
    const decoded = decodeTransactionBch(hexToBin((await server.getTransaction(hex(transactionHash)))!));
    if (typeof decoded === 'string') throw new Error(decoded);
    return decoded.outputs[index]!;
  };
  const sourceOutputs = await Promise.all(preview.inputs.map((input) => sourceOutput(input.outpointTransactionHash, input.outpointIndex)));
  const fee = BigInt(encodeTransactionBch(sized).length);
  const change = sourceOutputs.reduce((s, o) => s + o.valueSatoshis, 0n) - preview.outputs.reduce((s, o) => s + o.valueSatoshis, 0n) - fee;
  const changeAddress = hexToBin(await engine.generateLockingBytecodeFromDefaultPolicy('change'));
  await engine.appendInvitation(id, { outputs: [{ lockingBytecode: changeAddress, valueSatoshis: change }] } as unknown as Parameters<Engine['appendInvitation']>[1]);
  for (const index of own) await engine.signInvitation(id, index);
  const { builtTransaction } = await engine.executeAction(id, { broadcastTransaction: false });
  const transaction = decodeTransactionBch(hexToBin(builtTransaction.serializedTransaction));
  if (typeof transaction === 'string') throw new Error(transaction);
  // What the plain builder makes for the same choice, outside the wallet's own signatures.
  // The plain builder is given the same coins the service chose (it picks a price thread and a manage coin itself).
  const spent = (i: number): Utxo => ({ transactionHash: transaction.inputs[i]!.outpointTransactionHash, index: transaction.inputs[i]!.outpointIndex, output: sourceOutputs[i]! });
  const expected = manageLoan({
    contracts, price: spent(0), loan: opened.loan, sidecar: opened.sidecar, manageFunction: spent(3),
    key: { utxo: opened.key, unlock: () => new Uint8Array(100) }, wallet: [{ utxo: { transactionHash: hexToBin(feeEntry.outpointTransactionHash), index: feeEntry.outpointIndex, output: sourceOutputs[5]! }, unlock: () => new Uint8Array(100) }],
    repay: 0n, collateral: COLLATERAL + ADD, changeTo: changeAddress,
  });
  // Outputs 0 to 4 (Paryon's and the key's); the change differs only by the plain builder's own fee reckoning.
  const sameOutputs = transaction.outputs.slice(0, 5).every((o, i) => hex(encodeTransactionOutput(o)) === hex(encodeTransactionOutput(expected.built.transaction.outputs[i]!)));
  const changeAsPlainBuilder = { engine: transaction.outputs[5]?.valueSatoshis, plainBuilder: expected.built.transaction.outputs[5]?.valueSatoshis };
  const names = ['price (service)', 'loan (service)', 'sidecar (service)', 'manage function (service)', 'loan key (wallet)', 'fee coin (wallet)'];
  note('4 built', {
    ownInputs: own,
    inputs: transaction.inputs.map((input, i) => `${i}: ${hex(input.outpointTransactionHash).slice(0, 8)}:${input.outpointIndex} ${names[i]} unlocking ${input.unlockingBytecode.length} B`),
    outputs: transaction.outputs.map((o, i) => `${i}: ${o.valueSatoshis} sat${o.token === undefined ? '' : ` token ${hex(o.token.category).slice(0, 8)}`}`),
    contractUnlockingAsPlainBuilder: [0, 1, 2, 3].every((i) => hex(transaction.inputs[i]!.unlockingBytecode) === hex(expected.built.transaction.inputs[i]!.unlockingBytecode)),
    outputs0to4AsPlainBuilder: sameOutputs,
    changeAsPlainBuilder,
    check: checkBeforeSending({ transaction, sourceOutputs }),
    bytes: builtTransaction.serializedTransaction.length / 2,
  });
  note('4 scripts the wallet\'s engine follows under the trial template', (await engine.listScriptHashes()).filter((s) => s.templateIdentifier === templateIdentifier).length);
  try {
    await engine.executeAction(id, { broadcastTransaction: true });
  } catch (error) {
    if ((error as Error).name !== 'UnspentOutputNotFoundInStoreError') throw error;
  }
  await mine(1, BURN);
  const tx = await rpc('getrawtransaction', builtTransaction.transactionHash, true);
  let loanNow = await findLoan(server, contracts, opened.keyCategory);
  for (let i = 0; loanNow?.loan.output.valueSatoshis !== COLLATERAL + ADD && i < 40; i++) { await wait(250); loanNow = await findLoan(server, contracts, opened.keyCategory); }
  note('4 sent', { transactionId: builtTransaction.transactionHash, confirmations: tx.confirmations, loanCollateralNow: loanNow?.loan.output.valueSatoshis, expected: COLLATERAL + ADD, keyBackAtWallet: hex(transaction.outputs[4]!.lockingBytecode) === hex(walletAddress) });
  writeFileSync(`${DATA}trial37-${RUN}-final.json`, serializeInvitation((await engine.getInvitation(id))!.invitation));
} catch (error) {
  console.log('FAILED:', errorText(error), (error as Error).cause ?? '');
  console.log('engine errors:', [...new Set(engineErrors)].slice(0, 5));
  process.exitCode = 1;
} finally {
  await server.disconnect().catch(() => undefined);
  await engine.stop().catch(() => undefined);
  process.exit();
}
