// Trial: every action of version 3 of the ParyonUSD loan template, carried out on the local node by the wallet with a
// real second participant, Paryon's service: two XO engines, each with a seed of its own, in separate processes.
//
// - Paryon's contracts, as published, are deployed on the local node (packages/paryon/src/local-deployment.ts), with
//   periods of 20 blocks so that a borrowing contract can be brought up to date during the run.
// - The template is the real version 3 for this deployment (packages/paryon, `paryonTemplateAlone(contracts, 3,
//   addresses)`), with addresses given at run time, as for any deployment on a chain of one's own.
// - The wallet (this process) starts each invitation with its share (`borrowerShare`): the key's category, the amounts
//   and the rate it chooses, where its tokens go; and, for an action on the loan, its key coin.
// - The service (a child process per action, an empty engine, nothing kept afterwards) reads what the wallet committed
//   from the invitation, works out its share with packages/paryon's library (`serviceShare`) from the local chain, and
//   adds its variables, Paryon's coins with the unlocking compiled from the template, and the outputs that put them back.
// - The wallet takes the service's commit, adds the outputs that go to its own scripts, its coins for the fee (and PUSD
//   for a repayment), and its change at the exact fee; checks every input in the virtual machine, signs its own inputs,
//   and sends. Each transaction is compared with what the plain builders (transactions.ts) make for the same coins.
//
// Actions: createKey, movePeriod, borrow (at a starting rate of 256), manage (add collateral), changeInterest (to 100),
// repay (100.00 of 200.00 PUSD), close. Then the library's "what is possible" and one refusal, on the same chain.
//
// usage (from packages/app): timeout 600 npx tsx ../../spikes/xo-engine/38-paryon-service-v3.ts
// Block rewards halve every 150 blocks on regtest: when the local chain has grown too long to fund a loan, start it
// again first (deploy/regtest/regtest.sh reset).
import 'fake-indexeddb/auto';
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { type Output, type TransactionCommon, binToHex, decodeTransactionBch, encodeTransactionBch, hexToBin } from '@bitauth/libauth';
import { type BuiltTransaction, type InputSpec, type Utxo, buildTransaction, checkBeforeSending, keyPairFromPrivateKey, p2pkhInput, p2pkhLockingBytecode, typedValues } from '@grandmas-wallet/core';
import { type Engine, XO_SUPPORTED_NETWORKS, validateInvitation } from '@xo-cash/engine';
import { p2pkhTemplate } from '@xo-cash/templates';
import type { XOInvitation, XOTemplate } from '@xo-cash/types';
import { deserializeInvitation, serializeInvitation } from '@xo-cash/utils';
import { Electrum } from '../../packages/chipnet/src/electrum.ts';
import {
  type ParyonAction,
  type ParyonDeployment,
  borrow,
  borrowerShare,
  changeInterestRate,
  closeLoan,
  createLoanKey,
  decodeLoanState,
  findLoan,
  manageLoan,
  minimumCollateral,
  outputsOfRole,
  paryonContracts,
  paryonService,
  paryonTemplateAlone,
  periodStart,
  possibleActions,
  serviceShare,
  updateBorrowingPeriod,
} from '../../packages/paryon/src/index.ts';
import { localDeployment } from '../../packages/paryon/src/local-deployment.ts';
// @ts-expect-error plain script
import { openEngineRegtest, mine, rpc, BURN } from './regtest.mjs';
// @ts-expect-error plain script
import { DATA } from './common.mjs';

const engineErrors: string[] = [];
console.error = (...args: unknown[]) => engineErrors.push(String(args[0]).slice(0, 300));
const hex = binToHex;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const errorText = (error: unknown) => `${(error as Error).name}: ${String((error as Error).message).replace(/\s+/g, ' ').slice(0, 800)}`;
const json = (value: unknown) => JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? String(v) : v instanceof Uint8Array ? hex(v) : v));
const SELF = fileURLToPath(import.meta.url);
const ELECTRUM = 'ws://127.0.0.1:60403';
/** Addresses for the local deployment, given at run time: nothing listens there in this trial. */
const ADDRESSES = { service: 'http://127.0.0.1:8787/service/v1', page: 'http://127.0.0.1:8787/' };
const NETWORK = 'regtest';
type AppendData = Parameters<Engine['appendInvitation']>[1];

// --- The service ----------------------------------------------------------------------------------------------
interface ServiceJob { account: string; inFile: string; outFile: string; metaFile: string; deployment: ParyonDeployment; templateText: string; action: ParyonAction }

const runService = async (job: ServiceJob) => {
  const started = Date.now();
  const meta: Record<string, unknown> = {};
  const engine: Engine = await openEngineRegtest(job.account);
  const server = await Electrum.connect(ELECTRUM);
  try {
    const service = paryonService(paryonContracts(job.deployment), job.templateText, NETWORK);
    const { templateIdentifier } = await engine.importTemplate(job.templateText);
    const definition = (await engine.getTemplate(templateIdentifier)) as XOTemplate;
    const received = deserializeInvitation(readFileSync(job.inFile, 'utf8'));
    validateInvitation(received, definition, XO_SUPPORTED_NETWORKS.chipnet);
    if (received.actionIdentifier !== job.action) throw new Error(`asked for ${job.action}, the invitation is for ${received.actionIdentifier}`);
    const stored = await engine.acceptInvitation(received, { roleIdentifier: 'service' });
    const id = stored.invitation.invitationIdentifier;
    // What the wallet committed: its variables and its coins.
    const commits = received.commits;
    const committed = {
      variables: Object.fromEntries(commits.flatMap((c) => c.data.variables ?? []).map((v) => [v.variableIdentifier, v.value as string | number | bigint])),
      inputs: commits.flatMap((c) => c.data.inputs ?? []).flatMap((input) => (input.outpointTransactionHash === undefined ? [] : [`${hex(input.outpointTransactionHash)}:${input.outpointIndex}`])),
    };
    const share = await serviceShare(service, job.action, committed, server);
    if (!share.ok) {
      meta.refused = share;
      return;
    }
    const typed = typedValues(definition as never, share.variables);
    const variables = Object.entries(typed).map(([variableIdentifier, value]) => ({ variableIdentifier, roleIdentifier: 'service', value }));
    await engine.appendInvitation(id, {
      ...(variables.length === 0 ? {} : { variables }),
      inputs: share.inputs.map((input) => {
        const [transactionHash, index] = input.outpoint.split(':') as [string, string];
        return { outpointTransactionHash: hexToBin(transactionHash), outpointIndex: Number(index), inputIdentifier: input.inputIdentifier, unlockingBytecode: input.unlockingBytecode, sequenceNumber: input.sequenceNumber, roleIdentifier: 'service' };
      }),
      outputs: share.outputs.map((outputIdentifier) => ({ outputIdentifier, roleIdentifier: 'service' })),
    } as unknown as AppendData);
    const after = (await engine.getInvitation(id))!;
    meta.variables = share.variables;
    meta.inputs = share.inputs.map(({ inputIdentifier, outpoint, lockingScript }) => `${inputIdentifier} ${outpoint.slice(0, 8)}…:${outpoint.split(':')[1]} (${lockingScript})`);
    meta.outputs = share.outputs;
    meta.serviceTracksScripts = (await engine.listScriptHashes()).filter((s) => s.templateIdentifier === templateIdentifier).length;
    writeFileSync(job.outFile, serializeInvitation(after.invitation));
  } finally {
    meta.totalMs = Date.now() - started;
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
let asked = 0;
const askService = async (job: Omit<ServiceJob, 'inFile' | 'outFile' | 'metaFile' | 'account'>, invitation: XOInvitation) => {
  asked += 1;
  const base = `${DATA}trial38-${RUN}-${asked}`;
  const full: ServiceJob = { ...job, account: `trial38-service-${RUN}-${asked}`, inFile: `${base}-in.json`, outFile: `${base}-out.json`, metaFile: `${base}-meta.json` };
  writeFileSync(full.inFile, serializeInvitation(invitation));
  writeFileSync(`${base}-job.json`, json(full));
  await new Promise<void>((resolve, reject) => {
    const child = spawn('npx', ['tsx', SELF, 'service', `${base}-job.json`], { stdio: ['ignore', 'ignore', 'inherit'] });
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('the service took too long')); }, 90_000);
    child.on('exit', () => { clearTimeout(timer); resolve(); });
  });
  const meta = JSON.parse(readFileSync(full.metaFile, 'utf8')) as Record<string, unknown>;
  if (meta.failed !== undefined) throw new Error(`the service failed: ${String(meta.failed)} ${json(meta.engineErrors)}`);
  if (meta.refused !== undefined) throw new Error(`the service refused: ${json(meta.refused)}`);
  return { invitation: deserializeInvitation(readFileSync(full.outFile, 'utf8')), meta };
};
const note = (key: string, value: unknown) => console.log(`${key}:`, json(value));

const engine: Engine = await openEngineRegtest(`trial38-wallet-${RUN}`);
const server = await Electrum.connect(ELECTRUM);
const outcome: Record<string, string> = {};
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

  // Paryon on the local chain.
  const funder = keyPairFromPrivateKey(crypto.getRandomValues(new Uint8Array(32)));
  const funderLocking = p2pkhLockingBytecode(funder.keyHash);
  // Several coinbase coins pay for the wallet's coins: the local chain's rewards are small after many halvings.
  const hashes = (await mine(10, hex(funderLocking))) as string[];
  await mine(100, BURN);
  const coinbase = async (blockHash: string): Promise<Utxo> => {
    const tx = (await rpc('getblock', blockHash, 2)).tx[0];
    return { transactionHash: hexToBin(tx.txid), index: 0, output: { lockingBytecode: funderLocking, valueSatoshis: BigInt(Math.round(tx.vout[0].value * 1e8)) } };
  };
  const [paryonCoin, factoryCoin, ...money] = (await Promise.all(hashes.map(coinbase))) as [Utxo, Utxo, ...Utxo[]];
  const PRICE = 2_000_000n; // US cents per BCH
  const start = Number(await rpc('getblockcount'));
  const local = localDeployment({ funder, paryonCoin, factoryCoin, price: PRICE, period: 0, startBlockHeight: start, periodLengthBlocks: 20 });
  for (const built of local.transactions) await rpc('sendrawtransaction', hex(built.encoded));
  const { contracts, deployment } = local;
  const DEBT = 200_00n;
  const COLLATERAL = (minimumCollateral(DEBT, PRICE) * 125n) / 110n;
  // The wallet's coins: the first, output 0 of its transaction, defines the key's category and pays the collateral.
  const split = buildTransaction({
    inputs: money.map((coin) => p2pkhInput(coin, funder)),
    outputs: [{ lockingBytecode: walletAddress, valueSatoshis: COLLATERAL + 500_000n }, ...Array.from({ length: 6 }, () => ({ lockingBytecode: walletAddress, valueSatoshis: 100_000n }))],
    changeLockingBytecode: funderLocking,
  });
  await rpc('sendrawtransaction', hex(split.encoded));
  await mine(1, BURN);

  const held = async (predicate: (coins: Awaited<ReturnType<Engine['listUnspentOutputs']>>) => boolean, what: string) => {
    for (let i = 0; i < 80; i++) {
      const coins = await engine.listUnspentOutputs();
      if (predicate(coins)) return coins;
      await wait(250);
    }
    throw new Error(`the wallet's engine does not show ${what}`);
  };
  await held((coins) => coins.length >= 7, 'its seven coins');
  const plainCoins = (coins: Awaited<ReturnType<Engine['listUnspentOutputs']>>) => coins.filter((u) => u.tokenCategory === undefined && BigInt(u.valueSatoshis) === 100_000n);

  // The template: version 3 for this deployment, both sides import the same text.
  const templateText = paryonTemplateAlone(contracts, 3, ADDRESSES).texts.template;
  const templateIdentifier = (await engine.importTemplate(templateText)).templateIdentifier;
  const definition = (await engine.getTemplate(templateIdentifier)) as XOTemplate;
  const service = paryonService(contracts, templateText, NETWORK);
  note('deployment', { start, periodLengthBlocks: 20, templateIdentifier, debt: DEBT, collateral: COLLATERAL });

  const outpointOf = (u: { outpointTransactionHash: string; outpointIndex: number }) => ({ outpointTransactionHash: hexToBin(u.outpointTransactionHash), outpointIndex: u.outpointIndex });
  const sourceOutput = async (transactionHash: Uint8Array, index: number): Promise<Output> => {
    const decoded = decodeTransactionBch(hexToBin((await server.getTransaction(hex(transactionHash)))!));
    if (typeof decoded === 'string') throw new Error(decoded);
    return decoded.outputs[index]!;
  };
  const placeholder = (utxo: Utxo): InputSpec => ({ utxo, unlock: () => new Uint8Array(100) });

  /**
   * One action, as the wallet and the service carry it out: the wallet's first commit, the service's, the wallet's
   * own outputs and coins and its change at the exact fee; then the transaction, checked and sent.
   */
  const act = async (
    action: ParyonAction,
    borrower: Record<string, string>,
    first: { outpointTransactionHash: Uint8Array; outpointIndex: number; transactionIndex?: number }[],
    later: { inputs: { outpointTransactionHash: Uint8Array; outpointIndex: number }[]; outputs: Record<string, unknown>[]; changeIndex?: number },
    plain: (transaction: TransactionCommon, spent: (index: number) => Utxo, wallet: (from: number) => InputSpec[]) => { built: BuiltTransaction },
  ) => {
    const started = Date.now();
    const variables = Object.entries(typedValues(definition as never, borrower)).map(([variableIdentifier, value]) => ({ variableIdentifier, roleIdentifier: 'borrower', value }));
    const created = await engine.createInvitation({ templateIdentifier, actionIdentifier: action, roleIdentifier: 'borrower', variables, inputs: first } as Parameters<Engine['createInvitation']>[0]);
    const id = created.invitation.invitationIdentifier;
    const answer = await askService({ deployment, templateText, action }, created.invitation);
    await engine.updateInvitation(answer.invitation);
    const ownOutputs = outputsOfRole(definition as never, action, 'borrower').map((outputIdentifier) => ({ outputIdentifier, roleIdentifier: 'borrower' }));
    if (later.inputs.length > 0 || ownOutputs.length > 0 || later.outputs.length > 0) {
      await engine.appendInvitation(id, { inputs: later.inputs, outputs: [...ownOutputs, ...later.outputs] } as unknown as AppendData);
    }
    // The exact fee: the transaction as it stands, with 100 bytes for each of the wallet's P2PKH unlockings and a change
    // output of 34 bytes.
    const preview = decodeTransactionBch(hexToBin((await engine.buildInvitationTransactionFromMergedCommit(id)).serializedTransaction));
    if (typeof preview === 'string') throw new Error(preview);
    const own = await engine.listOwnInputIndexes(id);
    const changeAddress = hexToBin(await engine.generateLockingBytecodeFromDefaultPolicy('change'));
    const changeAt = later.changeIndex ?? preview.outputs.length;
    const sizedOutputs = [...preview.outputs];
    sizedOutputs.splice(changeAt, 0, { lockingBytecode: changeAddress, valueSatoshis: 0n });
    const sized = { ...preview, inputs: preview.inputs.map((input, i) => (own.includes(i) ? { ...input, unlockingBytecode: new Uint8Array(100) } : input)), outputs: sizedOutputs };
    const previewSources = await Promise.all(preview.inputs.map((input) => sourceOutput(input.outpointTransactionHash, input.outpointIndex)));
    const fee = BigInt(encodeTransactionBch(sized).length);
    const change = previewSources.reduce((s, o) => s + o.valueSatoshis, 0n) - preview.outputs.reduce((s, o) => s + o.valueSatoshis, 0n) - fee;
    await engine.appendInvitation(id, { outputs: [{ lockingBytecode: changeAddress, valueSatoshis: change, ...(later.changeIndex === undefined ? {} : { transactionIndex: later.changeIndex }) }] } as unknown as AppendData);
    for (const index of own) await engine.signInvitation(id, index);
    const { builtTransaction } = await engine.executeAction(id, { broadcastTransaction: false });
    const transaction = decodeTransactionBch(hexToBin(builtTransaction.serializedTransaction));
    if (typeof transaction === 'string') throw new Error(transaction);
    const sourceOutputs = await Promise.all(transaction.inputs.map((input) => sourceOutput(input.outpointTransactionHash, input.outpointIndex)));
    const check = checkBeforeSending({ transaction, sourceOutputs });
    // The plain builders' transaction for the same coins, with the wallet's unlocking as 100 bytes of placeholder.
    const spent = (i: number): Utxo => ({ transactionHash: transaction.inputs[i]!.outpointTransactionHash, index: transaction.inputs[i]!.outpointIndex, output: sourceOutputs[i]! });
    const expected = plain(transaction, spent, (from) => transaction.inputs.slice(from).map((_, i) => placeholder(spent(from + i)))).built;
    const normalised: TransactionCommon = { ...transaction, inputs: transaction.inputs.map((input, i) => (own.includes(i) ? { ...input, unlockingBytecode: new Uint8Array(100), sequenceNumber: 0 } : input)) };
    const sameAsPlainBuilder = hex(encodeTransactionBch(normalised)) === hex(expected.encoded);
    const walletSequenceNumbers = [...new Set(own.map((i) => transaction.inputs[i]!.sequenceNumber))];
    if (check !== true) throw new Error(`${action}: the transaction does not pass: ${check}`);
    await rpc('sendrawtransaction', builtTransaction.serializedTransaction);
    await mine(1, BURN);
    const confirmations = (await rpc('getrawtransaction', builtTransaction.transactionHash, true)).confirmations;
    note(action, {
      service: answer.meta,
      inputs: transaction.inputs.map((input, i) => `${i}: ${hex(input.outpointTransactionHash).slice(0, 8)}:${input.outpointIndex}${own.includes(i) ? ' (wallet)' : ''}`),
      outputs: transaction.outputs.map((o, i) => `${i}: ${o.valueSatoshis} sat${o.token === undefined ? '' : ` token ${hex(o.token.category).slice(0, 8)}${o.token.nft === undefined ? ` amount ${o.token.amount}` : ` ${o.token.nft.capability} ${hex(o.token.nft.commitment)}`}`}`),
      check,
      sameAsPlainBuilder,
      walletSequenceNumbers,
      transactionId: builtTransaction.transactionHash,
      confirmations,
      ms: Date.now() - started,
    });
    outcome[action] = check === true && confirmations >= 1 ? (sameAsPlainBuilder ? 'confirmed; the plain builders\' transaction' : 'confirmed; differs from the plain builders\' transaction') : 'failed';
    return { transaction, transactionId: builtTransaction.transactionHash };
  };
  const P = contracts.paryonCategory;
  const WALLET = hex(walletAddress);

  // 1. Make a key: the wallet's first coin defines its category, at input 0; its change is output 0.
  const all = await engine.listUnspentOutputs();
  const defining = all.find((u) => BigInt(u.valueSatoshis) === COLLATERAL + 500_000n)!;
  const keyCategory = defining.outpointTransactionHash;
  const made = await act(
    'createKey',
    borrowerShare('createKey', { keyCategory }),
    [{ ...outpointOf(defining), transactionIndex: 0 }],
    { inputs: [], outputs: [], changeIndex: 0 },
    (t, spent) => createLoanKey({ contracts, factory: spent(1), defining: placeholder(spent(0)), changeTo: t.outputs[0]!.lockingBytecode }),
  );
  note('possible, with the key waiting', await possibleActions(service, { made: [{ category: keyCategory, transactionId: made.transactionId }] }, server));

  // 2. Bring Paryon up to date: mine into period 1 first.
  while (Number(await rpc('getblockcount')) - 1 < periodStart(deployment, 1)) await mine(1, BURN);
  const fee1 = plainCoins(await held((coins) => plainCoins(coins).length >= 6, 'six fee coins'))[0]!;
  await act('movePeriod', borrowerShare('movePeriod', {}), [outpointOf(fee1)], { inputs: [], outputs: [] }, (t, spent, wallet) =>
    updateBorrowingPeriod({ contracts, borrowing: spent(0), wallet: wallet(1), height: t.locktime, changeTo: t.outputs[1]!.lockingBytecode }),
  );

  // 3. Borrow 200.00 PUSD at a starting rate of 256, with the change of the key's creation as collateral.
  const big = (await held((coins) => coins.some((u) => u.outpointTransactionHash === made.transactionId && u.outpointIndex === 0), 'the change of the key\'s creation')).find((u) => u.outpointTransactionHash === made.transactionId && u.outpointIndex === 0)!;
  const opened = await act(
    'borrow',
    borrowerShare('borrow', { keyCategory, debt: DEBT, collateral: COLLATERAL, rate: 256, keyHolder: WALLET, tokensHolder: WALLET }),
    [outpointOf(big)],
    { inputs: [], outputs: [] },
    (t, spent, wallet) => borrow({ contracts, borrowing: spent(0), price: spent(1), enforcer: spent(2), proof: spent(3), wallet: wallet(4), debt: DEBT, collateral: COLLATERAL, startingInterest: 256, keyTo: t.outputs[5]!.lockingBytecode, tokensTo: t.outputs[6]!.lockingBytecode, changeTo: t.outputs[7]!.lockingBytecode }),
  );
  note('possible, with the loan open', await possibleActions(service, { tokens: [{ category: keyCategory, commitment: '', capability: 'minting', outpoint: `${opened.transactionId}:5` }] }, server));

  const keyCoin = async (transactionId: string, index: number) => (await held((coins) => coins.some((u) => u.outpointTransactionHash === transactionId && u.outpointIndex === index), `the key at ${transactionId.slice(0, 8)}:${index}`)).find((u) => u.outpointTransactionHash === transactionId && u.outpointIndex === index)!;
  const feeCoin = async () => plainCoins(await held((coins) => plainCoins(coins).length >= 1, 'a fee coin'))[0]!;

  // 4. Add 30,000 satoshis of collateral.
  let key = await keyCoin(opened.transactionId, 5);
  let fee = await feeCoin();
  const managed = await act(
    'manage',
    borrowerShare('manage', { keyCategory, collateral: COLLATERAL + 30_000n, keyHolder: WALLET }),
    [outpointOf(key)],
    { inputs: [outpointOf(fee)], outputs: [] },
    (t, spent, wallet) => manageLoan({ contracts, price: spent(0), loan: spent(1), sidecar: spent(2), manageFunction: spent(3), key: placeholder(spent(4)), wallet: wallet(5), repay: 0n, collateral: COLLATERAL + 30_000n, changeTo: t.outputs.at(-1)!.lockingBytecode }),
  );

  // 5. Change the interest rate to 100.
  key = await keyCoin(managed.transactionId, 4);
  fee = await feeCoin();
  const changed = await act(
    'changeInterest',
    borrowerShare('changeInterest', { keyCategory, rate: 100, keyHolder: WALLET }),
    [outpointOf(key)],
    { inputs: [outpointOf(fee)], outputs: [] },
    (t, spent, wallet) => changeInterestRate({ contracts, loan: spent(0), sidecar: spent(1), interestFunction: spent(2), key: placeholder(spent(3)), wallet: wallet(4), rate: 100, changeTo: t.outputs.at(-1)!.lockingBytecode }),
  );

  // 6. Repay 100.00 PUSD; the other 100.00 come back to the wallet.
  key = await keyCoin(changed.transactionId, 3);
  fee = await feeCoin();
  const pusd = (await held((coins) => coins.some((u) => u.tokenCategory === hex(P)), 'its PUSD')).find((u) => u.tokenCategory === hex(P))!;
  const repaid = await act(
    'repay',
    borrowerShare('repay', { keyCategory, repay: 100_00n, keyHolder: WALLET }),
    [outpointOf(key)],
    { inputs: [outpointOf(pusd), outpointOf(fee)], outputs: [{ lockingBytecode: walletAddress, valueSatoshis: 1000n, token: { category: P, amount: DEBT - 100_00n } }] },
    (t, spent, wallet) => manageLoan({ contracts, price: spent(0), loan: spent(1), sidecar: spent(2), manageFunction: spent(3), key: placeholder(spent(4)), wallet: wallet(5), repay: 100_00n, collateral: COLLATERAL + 30_000n, tokensChangeTo: t.outputs[6]!.lockingBytecode, changeTo: t.outputs.at(-1)!.lockingBytecode }),
  );
  let loanNow = await findLoan(server, contracts, hexToBin(keyCategory));
  for (let i = 0; loanNow?.state.borrowed !== DEBT - 100_00n && i < 40; i++) { await wait(250); loanNow = await findLoan(server, contracts, hexToBin(keyCategory)); }
  note('the loan after the repayment', loanNow === undefined ? 'none' : { collateral: loanNow.loan.output.valueSatoshis, ...decodeLoanState(loanNow.loan.output.token!.nft!.commitment) });

  // 7. Close: the other 100.00 PUSD repaid, the collateral back.
  key = await keyCoin(repaid.transactionId, 4);
  fee = await feeCoin();
  const rest = await keyCoin(repaid.transactionId, 6);
  const closed = await act(
    'close',
    borrowerShare('close', { keyCategory, keyHolder: WALLET }),
    [outpointOf(key)],
    { inputs: [outpointOf(rest), outpointOf(fee)], outputs: [] },
    (t, spent, wallet) => closeLoan({ contracts, price: spent(0), loan: spent(1), sidecar: spent(2), manageFunction: spent(3), key: placeholder(spent(4)), wallet: wallet(5), keyTo: t.outputs[4]!.lockingBytecode, changeTo: t.outputs.at(-1)!.lockingBytecode }),
  );
  let gone = await findLoan(server, contracts, hexToBin(keyCategory));
  for (let i = 0; gone !== undefined && i < 40; i++) { await wait(250); gone = await findLoan(server, contracts, hexToBin(keyCategory)); }
  note('after the closing', { loanFound: gone !== undefined, keyBackAtWallet: hex(closed.transaction.outputs[4]!.lockingBytecode) === WALLET });
  note('possible, with the loan closed', await possibleActions(service, { tokens: [{ category: keyCategory, commitment: '', capability: 'minting', outpoint: `${closed.transactionId}:4` }] }, server));
  note('the service asked to manage the closed loan', await serviceShare(service, 'manage', { variables: borrowerShare('manage', { keyCategory, collateral: COLLATERAL, keyHolder: WALLET }), inputs: [`${closed.transactionId}:4`] }, server));
  note('OUTCOME', outcome);
} catch (error) {
  console.log('FAILED:', errorText(error), (error as Error).cause ?? '');
  console.log('engine errors:', [...new Set(engineErrors)].slice(0, 5));
  note('OUTCOME', outcome);
  process.exitCode = 1;
} finally {
  await server.disconnect().catch(() => undefined);
  await engine.stop().catch(() => undefined);
  process.exit();
}
