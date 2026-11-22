// Trial: every action of version 3 of the ParyonUSD loan template, carried out on the local node by the wallet with
// Paryon's service app (apps/paryon-service) over the real protocol, xo_service_v1, over HTTP.
//
// - Paryon's contracts, as published, are deployed on the local node (packages/paryon/src/local-deployment.ts), with
//   periods of 20 blocks so that a borrowing contract can be brought up to date during the run.
// - The service app is started from its command line with a configuration of the local chain that names this
//   deployment (`paryon`) and a loan page at http://localhost:8104/: the template is version 3 for this deployment, made
//   by the service, naming the service at http://localhost:8104/service/v1, where deploy/serve.mjs would forward it.
// - The wallet (this process, an XO engine of its own) asks the service for a hello, and before each action what is
//   possible, taking the action's `ref` from the answer; it starts each invitation with its share, sends it with a join,
//   checks that the answer adds exactly one commit, and finishes as in trial 38: its own outputs, its coins for the fee
//   (and PUSD for a repayment), its change at the exact fee; every input checked in the virtual machine, its own signed;
//   sent and mined. Each transaction is compared with what the plain builders (transactions.ts) make for the same coins.
// - All seven actions directly at the service's own address; then collateral is added once more through
//   deploy/serve.mjs --forward, the loan page's server on a spare port, with the preflight and the hello through it too.
// - After closing: what is possible holds nothing for the key, and a join for the closed loan is refused.
//
// usage (from the repository's root): timeout 600 node --import tsx spikes/xo-engine/39-paryon-service-app.ts
// Block rewards halve every 150 blocks on regtest: when the local chain has grown too long to fund a loan, start it
// again first (deploy/regtest/regtest.sh reset).
import 'fake-indexeddb/auto';
import { type ChildProcess, spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

import { type Output, type TransactionCommon, binToHex, decodeTransactionBch, encodeTransactionBch, hexToBin } from '@bitauth/libauth';
import { type BuiltTransaction, type InputSpec, type Utxo, buildTransaction, checkBeforeSending, keyPairFromPrivateKey, p2pkhInput, p2pkhLockingBytecode, typedValues } from '@grandmas-wallet/core';
import { type Engine } from '@xo-cash/engine';
import { p2pkhTemplate } from '@xo-cash/templates';
import type { XOInvitation, XOTemplate } from '@xo-cash/types';
import { deserializeInvitation, serializeInvitation } from '@xo-cash/utils';
import { Electrum } from '../../packages/chipnet/src/electrum.ts';
import {
  type ServiceMadeCategory,
  type ServiceToken,
  buildServiceHello,
  buildServiceJoinRequest,
  buildServicePossibleRequest,
  checkJoinedInvitation,
  readInvitationOutline,
  serviceExchange,
} from '../../packages/connect/src/index.ts';
import {
  type ParyonAction,
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
  paryonAddressesAt,
  paryonTemplateAlone,
  periodStart,
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
const note = (key: string, value: unknown) => console.log(`${key}:`, json(value));
const ELECTRUM = 'ws://127.0.0.1:60403';
const NETWORK = 'regtest';
const LOAN_PAGE = 'http://localhost:8104/';
type AppendData = Parameters<Engine['appendInvitation']>[1];
const RUN = String(Date.now());

// --- The servers: the service app, and the loan page's server forwarding to it ----------------------------------
const serviceLog: string[] = [];
const started: ChildProcess[] = [];
const startServer = (name: string, args: string[], ready: RegExp, keep?: string[]) =>
  new Promise<ChildProcess>((resolve, reject) => {
    const child = spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    started.push(child);
    const timer = setTimeout(() => reject(new Error(`${name} did not start`)), 30_000);
    const read = (line: string) => {
      keep?.push(line);
      if (ready.test(line)) {
        clearTimeout(timer);
        resolve(child);
      }
    };
    createInterface({ input: child.stdout! }).on('line', read);
    createInterface({ input: child.stderr! }).on('line', (line) => console.log(`${name} (stderr) | ${line}`));
    child.on('exit', (code) => reject(new Error(`${name} ended with ${code}`)));
  });

const engine: Engine = await openEngineRegtest(`trial39-wallet-${RUN}`);
const server = await Electrum.connect(ELECTRUM);
const outcome: Record<string, string> = {};
const joins: Record<string, number> = {};
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
  const split = buildTransaction({
    inputs: money.map((coin) => p2pkhInput(coin, funder)),
    outputs: [{ lockingBytecode: walletAddress, valueSatoshis: COLLATERAL + 500_000n }, ...Array.from({ length: 8 }, () => ({ lockingBytecode: walletAddress, valueSatoshis: 100_000n }))],
    changeLockingBytecode: funderLocking,
  });
  await rpc('sendrawtransaction', hex(split.encoded));
  await mine(1, BURN);

  // The service app for this chain and this deployment; the loan page's server in front of it.
  const configFile = `${DATA}trial39-${RUN}-config.json`;
  writeFileSync(configFile, json({ network: NETWORK, loanUrl: LOAN_PAGE, chain: [ELECTRUM], relays: [], stores: [], paryon: deployment }));
  const servicePort = 18_200 + Math.floor(Math.random() * 300);
  const pagePort = servicePort + 400;
  await startServer('service', ['--import', 'tsx', 'apps/paryon-service/src/cli.ts', '--config', configFile, '--port', String(servicePort)], /^Paryon's service at/, serviceLog);
  await startServer('loan page', ['deploy/serve.mjs', '--root', 'deploy/placeholder/jar', '--config', configFile, '--port', String(pagePort), '--forward', `/service/=http://127.0.0.1:${servicePort}`], / at http:/);
  const DIRECT = `http://127.0.0.1:${servicePort}/service/v1`;
  const FORWARDED = `http://127.0.0.1:${pagePort}/service/v1`;

  const held = async (predicate: (coins: Awaited<ReturnType<Engine['listUnspentOutputs']>>) => boolean, what: string) => {
    for (let i = 0; i < 80; i++) {
      const coins = await engine.listUnspentOutputs();
      if (predicate(coins)) return coins;
      await wait(250);
    }
    throw new Error(`the wallet's engine does not show ${what}`);
  };
  await held((coins) => coins.length >= 9, 'its nine coins');
  const plainCoins = (coins: Awaited<ReturnType<Engine['listUnspentOutputs']>>) => coins.filter((u) => u.tokenCategory === undefined && BigInt(u.valueSatoshis) === 100_000n);

  // The template: version 3 for this deployment, as the service makes it; the wallet imports the same text.
  const templateText = paryonTemplateAlone(contracts, 3, paryonAddressesAt(LOAN_PAGE)).texts.template;
  const templateIdentifier = (await engine.importTemplate(templateText)).templateIdentifier;
  const definition = (await engine.getTemplate(templateIdentifier)) as XOTemplate;
  const { identifier, contentHash } = (await import('../../packages/core/src/index.ts')).readTemplate(templateText);
  const template = { identifier, contentHash };
  note('deployment', { start, periodLengthBlocks: 20, templateIdentifier, debt: DEBT, collateral: COLLATERAL, direct: DIRECT, forwarded: FORWARDED });

  // --- The protocol, from the wallet's side ---
  let messages = 0;
  const id = (what: string) => `${what}-${(messages += 1)}`;
  const hello = async (via: string) => {
    const answer = await serviceExchange(via, buildServiceHello({ network: NETWORK, id: id('hello'), template, role: 'borrower' }));
    if (!answer.carried || !answer.answer.ok) throw new Error(`hello: ${json(answer)}`);
    if (answer.answer.serves[0]?.template.identifier !== templateIdentifier || answer.answer.serves[0]?.role !== 'service') throw new Error(`hello serves something else: ${json(answer.answer)}`);
    return answer.answer;
  };
  const possible = async (via: string, tokens: ServiceToken[], made: ServiceMadeCategory[]) => {
    const answer = await serviceExchange(via, buildServicePossibleRequest({ network: NETWORK, id: id('possible'), template, role: 'borrower', tokens, made }));
    if (!answer.carried || !answer.answer.ok) throw new Error(`possible: ${json(answer)}`);
    return answer.answer;
  };
  /** The `ref` for an action under a token, from what is possible; a starting action must be available and has none. */
  const refFor = async (via: string, action: ParyonAction, holdings: { tokens?: ServiceToken[]; made?: ServiceMadeCategory[] }, category?: string) => {
    const answer = await possible(via, holdings.tokens ?? [], holdings.made ?? []);
    if (category === undefined) {
      const entry = answer.start.find((s) => s.action === action);
      if (entry?.available !== true) throw new Error(`${action} is not available: ${json(entry)}`);
      return undefined;
    }
    const item = answer.items.find((i) => i.action === action && i.category === category);
    if (item === undefined) throw new Error(`no item for ${action}: ${json(answer.items)}`);
    return item.ref;
  };
  const join = async (via: string, action: string, invitation: XOInvitation, ref: string | undefined) => {
    const sent = serializeInvitation(invitation);
    const t = Date.now();
    const result = await serviceExchange(via, buildServiceJoinRequest({ network: NETWORK, id: id(`join-${action}`), invitation: sent, ...(ref === undefined ? {} : { ref }) }));
    const ms = Date.now() - t;
    if (!result.carried) throw new Error(`join ${action}: not carried: ${json(result)}`);
    if (!result.answer.ok) return { refused: { code: result.answer.code, error: result.answer.error }, ms };
    const added = readInvitationOutline(result.answer.invitation).commits.length - readInvitationOutline(sent).commits.length;
    if (added !== 1) throw new Error(`join ${action}: the answer adds ${added} commits`);
    const checked = checkJoinedInvitation(sent, result.answer.invitation);
    if (!checked.ok) throw new Error(`join ${action}: ${checked.reason}`);
    const joined = deserializeInvitation(result.answer.invitation);
    const commit = joined.commits.at(-1)!;
    return { invitation: joined, ms, commit: { role: commit.data.roleIdentifier, variables: (commit.data.variables ?? []).map((v) => v.variableIdentifier), inputs: (commit.data.inputs ?? []).map((i) => i.inputIdentifier), outputs: (commit.data.outputs ?? []).map((o) => o.outputIdentifier) } };
  };

  note('hello, directly', await hello(DIRECT));

  const outpointOf = (u: { outpointTransactionHash: string; outpointIndex: number }) => ({ outpointTransactionHash: hexToBin(u.outpointTransactionHash), outpointIndex: u.outpointIndex });
  const sourceOutput = async (transactionHash: Uint8Array, index: number): Promise<Output> => {
    const decoded = decodeTransactionBch(hexToBin((await server.getTransaction(hex(transactionHash)))!));
    if (typeof decoded === 'string') throw new Error(decoded);
    return decoded.outputs[index]!;
  };
  const placeholder = (utxo: Utxo): InputSpec => ({ utxo, unlock: () => new Uint8Array(100) });

  /** One action: possible, the wallet's first commit, the join, then the wallet's part, the transaction checked, sent and mined. */
  const act = async (
    label: string,
    action: ParyonAction,
    via: string,
    holdings: { tokens?: ServiceToken[]; made?: ServiceMadeCategory[]; category?: string },
    borrower: Record<string, string>,
    first: { outpointTransactionHash: Uint8Array; outpointIndex: number; transactionIndex?: number }[],
    later: { inputs: { outpointTransactionHash: Uint8Array; outpointIndex: number }[]; outputs: Record<string, unknown>[]; changeIndex?: number },
    plain: (transaction: TransactionCommon, spent: (index: number) => Utxo, wallet: (from: number) => InputSpec[]) => { built: BuiltTransaction },
  ) => {
    const begun = Date.now();
    const ref = await refFor(via, action, holdings, holdings.category);
    const variables = Object.entries(typedValues(definition as never, borrower)).map(([variableIdentifier, value]) => ({ variableIdentifier, roleIdentifier: 'borrower', value }));
    const created = await engine.createInvitation({ templateIdentifier, actionIdentifier: action, roleIdentifier: 'borrower', variables, inputs: first } as Parameters<Engine['createInvitation']>[0]);
    const invitationId = created.invitation.invitationIdentifier;
    const answer = await join(via, action, created.invitation, ref);
    if (answer.invitation === undefined) throw new Error(`${label}: the service refused: ${json(answer.refused)}`);
    joins[label] = answer.ms;
    await engine.updateInvitation(answer.invitation);
    const ownOutputs = outputsOfRole(definition as never, action, 'borrower').map((outputIdentifier) => ({ outputIdentifier, roleIdentifier: 'borrower' }));
    if (later.inputs.length > 0 || ownOutputs.length > 0 || later.outputs.length > 0) {
      await engine.appendInvitation(invitationId, { inputs: later.inputs, outputs: [...ownOutputs, ...later.outputs] } as unknown as AppendData);
    }
    const preview = decodeTransactionBch(hexToBin((await engine.buildInvitationTransactionFromMergedCommit(invitationId)).serializedTransaction));
    if (typeof preview === 'string') throw new Error(preview);
    const own = await engine.listOwnInputIndexes(invitationId);
    const changeAddress = hexToBin(await engine.generateLockingBytecodeFromDefaultPolicy('change'));
    const changeAt = later.changeIndex ?? preview.outputs.length;
    const sizedOutputs = [...preview.outputs];
    sizedOutputs.splice(changeAt, 0, { lockingBytecode: changeAddress, valueSatoshis: 0n });
    const sized = { ...preview, inputs: preview.inputs.map((input, i) => (own.includes(i) ? { ...input, unlockingBytecode: new Uint8Array(100) } : input)), outputs: sizedOutputs };
    const previewSources = await Promise.all(preview.inputs.map((input) => sourceOutput(input.outpointTransactionHash, input.outpointIndex)));
    const fee = BigInt(encodeTransactionBch(sized).length);
    const change = previewSources.reduce((s, o) => s + o.valueSatoshis, 0n) - preview.outputs.reduce((s, o) => s + o.valueSatoshis, 0n) - fee;
    await engine.appendInvitation(invitationId, { outputs: [{ lockingBytecode: changeAddress, valueSatoshis: change, ...(later.changeIndex === undefined ? {} : { transactionIndex: later.changeIndex }) }] } as unknown as AppendData);
    for (const index of own) await engine.signInvitation(invitationId, index);
    const { builtTransaction } = await engine.executeAction(invitationId, { broadcastTransaction: false });
    const transaction = decodeTransactionBch(hexToBin(builtTransaction.serializedTransaction));
    if (typeof transaction === 'string') throw new Error(transaction);
    const sourceOutputs = await Promise.all(transaction.inputs.map((input) => sourceOutput(input.outpointTransactionHash, input.outpointIndex)));
    const check = checkBeforeSending({ transaction, sourceOutputs });
    const spent = (i: number): Utxo => ({ transactionHash: transaction.inputs[i]!.outpointTransactionHash, index: transaction.inputs[i]!.outpointIndex, output: sourceOutputs[i]! });
    const expected = plain(transaction, spent, (from) => transaction.inputs.slice(from).map((_, i) => placeholder(spent(from + i)))).built;
    const normalised: TransactionCommon = { ...transaction, inputs: transaction.inputs.map((input, i) => (own.includes(i) ? { ...input, unlockingBytecode: new Uint8Array(100), sequenceNumber: 0 } : input)) };
    const sameAsPlainBuilder = hex(encodeTransactionBch(normalised)) === hex(expected.encoded);
    if (check !== true) throw new Error(`${label}: the transaction does not pass: ${check}`);
    await rpc('sendrawtransaction', builtTransaction.serializedTransaction);
    await mine(1, BURN);
    const confirmations = (await rpc('getrawtransaction', builtTransaction.transactionHash, true)).confirmations;
    note(label, {
      via: via === DIRECT ? 'directly' : 'through serve.mjs --forward',
      ref: ref ?? null,
      joinMs: answer.ms,
      serviceCommit: answer.commit,
      sameAsPlainBuilder,
      transactionId: builtTransaction.transactionHash,
      confirmations,
      ms: Date.now() - begun,
    });
    outcome[label] = check === true && confirmations >= 1 ? (sameAsPlainBuilder ? 'confirmed; the plain builders\' transaction' : 'confirmed; differs from the plain builders\' transaction') : 'failed';
    return { transaction, transactionId: builtTransaction.transactionHash };
  };
  const P = contracts.paryonCategory;
  const WALLET = hex(walletAddress);
  const keyToken = (transactionId: string, index: number): ServiceToken => ({ category: keyCategory, commitment: '', capability: 'minting', outpoint: `${transactionId}:${index}` });

  // 1. Make a key: the wallet's first coin defines its category, at input 0; its change is output 0.
  const all = await engine.listUnspentOutputs();
  const defining = all.find((u) => BigInt(u.valueSatoshis) === COLLATERAL + 500_000n)!;
  const keyCategory = defining.outpointTransactionHash;
  const made = await act('createKey', 'createKey', DIRECT, {}, borrowerShare('createKey', { keyCategory }), [{ ...outpointOf(defining), transactionIndex: 0 }], { inputs: [], outputs: [], changeIndex: 0 }, (t, spent) =>
    createLoanKey({ contracts, factory: spent(1), defining: placeholder(spent(0)), changeTo: t.outputs[0]!.lockingBytecode }),
  );

  // 2. Bring Paryon up to date: mine into period 1 first.
  while (Number(await rpc('getblockcount')) - 1 < periodStart(deployment, 1)) await mine(1, BURN);
  const fee1 = plainCoins(await held((coins) => plainCoins(coins).length >= 8, 'eight fee coins'))[0]!;
  await act('movePeriod', 'movePeriod', DIRECT, {}, borrowerShare('movePeriod', {}), [outpointOf(fee1)], { inputs: [], outputs: [] }, (t, spent, wallet) =>
    updateBorrowingPeriod({ contracts, borrowing: spent(0), wallet: wallet(1), height: t.locktime, changeTo: t.outputs[1]!.lockingBytecode }),
  );

  // 3. Borrow 200.00 PUSD at a starting rate of 256, with the change of the key's creation as collateral.
  const big = (await held((coins) => coins.some((u) => u.outpointTransactionHash === made.transactionId && u.outpointIndex === 0), 'the change of the key\'s creation')).find((u) => u.outpointTransactionHash === made.transactionId && u.outpointIndex === 0)!;
  const opened = await act(
    'borrow',
    'borrow',
    DIRECT,
    { made: [{ category: keyCategory, transactionId: made.transactionId }], category: keyCategory },
    borrowerShare('borrow', { keyCategory, debt: DEBT, collateral: COLLATERAL, rate: 256, keyHolder: WALLET, tokensHolder: WALLET }),
    [outpointOf(big)],
    { inputs: [], outputs: [] },
    (t, spent, wallet) => borrow({ contracts, borrowing: spent(0), price: spent(1), enforcer: spent(2), proof: spent(3), wallet: wallet(4), debt: DEBT, collateral: COLLATERAL, startingInterest: 256, keyTo: t.outputs[5]!.lockingBytecode, tokensTo: t.outputs[6]!.lockingBytecode, changeTo: t.outputs[7]!.lockingBytecode }),
  );

  const keyCoin = async (transactionId: string, index: number) => (await held((coins) => coins.some((u) => u.outpointTransactionHash === transactionId && u.outpointIndex === index), `the key at ${transactionId.slice(0, 8)}:${index}`)).find((u) => u.outpointTransactionHash === transactionId && u.outpointIndex === index)!;
  const feeCoin = async () => plainCoins(await held((coins) => plainCoins(coins).length >= 1, 'a fee coin'))[0]!;

  // 4. Add 30,000 satoshis of collateral.
  let key = await keyCoin(opened.transactionId, 5);
  let fee = await feeCoin();
  const managed = await act('manage', 'manage', DIRECT, { tokens: [keyToken(opened.transactionId, 5)], category: keyCategory }, borrowerShare('manage', { keyCategory, collateral: COLLATERAL + 30_000n, keyHolder: WALLET }), [outpointOf(key)], { inputs: [outpointOf(fee)], outputs: [] }, (t, spent, wallet) =>
    manageLoan({ contracts, price: spent(0), loan: spent(1), sidecar: spent(2), manageFunction: spent(3), key: placeholder(spent(4)), wallet: wallet(5), repay: 0n, collateral: COLLATERAL + 30_000n, changeTo: t.outputs.at(-1)!.lockingBytecode }),
  );

  // 5. Change the interest rate to 100.
  key = await keyCoin(managed.transactionId, 4);
  fee = await feeCoin();
  const changed = await act('changeInterest', 'changeInterest', DIRECT, { tokens: [keyToken(managed.transactionId, 4)], category: keyCategory }, borrowerShare('changeInterest', { keyCategory, rate: 100, keyHolder: WALLET }), [outpointOf(key)], { inputs: [outpointOf(fee)], outputs: [] }, (t, spent, wallet) =>
    changeInterestRate({ contracts, loan: spent(0), sidecar: spent(1), interestFunction: spent(2), key: placeholder(spent(3)), wallet: wallet(4), rate: 100, changeTo: t.outputs.at(-1)!.lockingBytecode }),
  );

  // 5b. Through the loan page's server: the preflight and a hello as a browser sends them, then 10,000 satoshis more.
  const preflight = await fetch(FORWARDED, { method: 'OPTIONS', headers: { origin: 'https://wallet.example', 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type' } });
  const posted = await fetch(FORWARDED, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://wallet.example' }, body: JSON.stringify({ xo_service_v1: buildServiceHello({ network: NETWORK, id: id('hello'), template, role: 'borrower' }) }) });
  note('through serve.mjs --forward', {
    preflight: { status: preflight.status, allowOrigin: preflight.headers.get('access-control-allow-origin'), allowMethods: preflight.headers.get('access-control-allow-methods'), contentSecurityPolicy: preflight.headers.get('content-security-policy') },
    hello: { status: posted.status, allowOrigin: posted.headers.get('access-control-allow-origin'), contentSecurityPolicy: posted.headers.get('content-security-policy'), ok: ((await posted.json()) as { xo_service_v1: { ok: boolean } }).xo_service_v1.ok },
  });
  key = await keyCoin(changed.transactionId, 3);
  fee = await feeCoin();
  const managedAgain = await act('manage (again, through the forward)', 'manage', FORWARDED, { tokens: [keyToken(changed.transactionId, 3)], category: keyCategory }, borrowerShare('manage', { keyCategory, collateral: COLLATERAL + 40_000n, keyHolder: WALLET }), [outpointOf(key)], { inputs: [outpointOf(fee)], outputs: [] }, (t, spent, wallet) =>
    manageLoan({ contracts, price: spent(0), loan: spent(1), sidecar: spent(2), manageFunction: spent(3), key: placeholder(spent(4)), wallet: wallet(5), repay: 0n, collateral: COLLATERAL + 40_000n, changeTo: t.outputs.at(-1)!.lockingBytecode }),
  );

  // 6. Repay 100.00 PUSD; the other 100.00 come back to the wallet.
  key = await keyCoin(managedAgain.transactionId, 4);
  fee = await feeCoin();
  const pusd = (await held((coins) => coins.some((u) => u.tokenCategory === hex(P)), 'its PUSD')).find((u) => u.tokenCategory === hex(P))!;
  const repaid = await act(
    'repay',
    'repay',
    DIRECT,
    { tokens: [keyToken(managedAgain.transactionId, 4)], category: keyCategory },
    borrowerShare('repay', { keyCategory, repay: 100_00n, keyHolder: WALLET }),
    [outpointOf(key)],
    { inputs: [outpointOf(pusd), outpointOf(fee)], outputs: [{ lockingBytecode: walletAddress, valueSatoshis: 1000n, token: { category: P, amount: DEBT - 100_00n } }] },
    (t, spent, wallet) => manageLoan({ contracts, price: spent(0), loan: spent(1), sidecar: spent(2), manageFunction: spent(3), key: placeholder(spent(4)), wallet: wallet(5), repay: 100_00n, collateral: COLLATERAL + 40_000n, tokensChangeTo: t.outputs[6]!.lockingBytecode, changeTo: t.outputs.at(-1)!.lockingBytecode }),
  );
  let loanNow = await findLoan(server, contracts, hexToBin(keyCategory));
  for (let i = 0; loanNow?.state.borrowed !== DEBT - 100_00n && i < 40; i++) { await wait(250); loanNow = await findLoan(server, contracts, hexToBin(keyCategory)); }
  note('the loan after the repayment', loanNow === undefined ? 'none' : { collateral: loanNow.loan.output.valueSatoshis, ...decodeLoanState(loanNow.loan.output.token!.nft!.commitment) });

  // 7. Close: the other 100.00 PUSD repaid, the collateral back.
  key = await keyCoin(repaid.transactionId, 4);
  fee = await feeCoin();
  const rest = await keyCoin(repaid.transactionId, 6);
  const closed = await act('close', 'close', DIRECT, { tokens: [keyToken(repaid.transactionId, 4)], category: keyCategory }, borrowerShare('close', { keyCategory, keyHolder: WALLET }), [outpointOf(key)], { inputs: [outpointOf(rest), outpointOf(fee)], outputs: [] }, (t, spent, wallet) =>
    closeLoan({ contracts, price: spent(0), loan: spent(1), sidecar: spent(2), manageFunction: spent(3), key: placeholder(spent(4)), wallet: wallet(5), keyTo: t.outputs[4]!.lockingBytecode, changeTo: t.outputs.at(-1)!.lockingBytecode }),
  );
  let gone = await findLoan(server, contracts, hexToBin(keyCategory));
  for (let i = 0; gone !== undefined && i < 40; i++) { await wait(250); gone = await findLoan(server, contracts, hexToBin(keyCategory)); }

  // After the closing: nothing is possible for the key, and a join for the closed loan is refused.
  const after = await possible(DIRECT, [keyToken(closed.transactionId, 4)], []);
  note('possible, with the loan closed', { start: after.start, itemsForTheKey: after.items.filter((item) => item.category === keyCategory) });
  const closedKey = await keyCoin(closed.transactionId, 4);
  const late = await engine.createInvitation({
    templateIdentifier,
    actionIdentifier: 'manage',
    roleIdentifier: 'borrower',
    variables: Object.entries(typedValues(definition as never, borrowerShare('manage', { keyCategory, collateral: COLLATERAL, keyHolder: WALLET }))).map(([variableIdentifier, value]) => ({ variableIdentifier, roleIdentifier: 'borrower', value })),
    inputs: [outpointOf(closedKey)],
  } as Parameters<Engine['createInvitation']>[0]);
  const refusedJoin = await join(DIRECT, 'manage', late.invitation, undefined);
  note('a join for the closed loan', { refused: refusedJoin.refused ?? 'NOT REFUSED', ms: refusedJoin.ms });
  outcome['join for the closed loan'] = refusedJoin.refused?.code === 'not-possible' ? `refused: ${refusedJoin.refused.error}` : 'NOT REFUSED';
  note('join times (ms)', joins);
  note('OUTCOME', outcome);
} catch (error) {
  console.log('FAILED:', errorText(error), (error as Error).cause ?? '');
  console.log('engine errors:', [...new Set(engineErrors)].slice(0, 5));
  note('OUTCOME', outcome);
  process.exitCode = 1;
} finally {
  await wait(300);
  console.log('the service\'s log:');
  for (const line of serviceLog) console.log(`  ${line}`);
  for (const child of started) child.kill('SIGTERM');
  await server.disconnect().catch(() => undefined);
  await engine.stop().catch(() => undefined);
  await wait(300);
  process.exit();
}
