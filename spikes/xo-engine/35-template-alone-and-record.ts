// Trial of stage 11 (IMPLEMENTATION_PLAN_v0.6.md): an application from its XO template alone, and a position
// back from a record under a new seed. No recovery declaration is read anywhere.
//
// 1. A variant of the Savings Jar's template: the jar's key is a template input of its own that names the key's
//    token category, has no unlocking script and sits at input 0 of the withdrawal; the jar's unlocking gives
//    that 0 as a constant instead of the variable `keyInput`. XO's validator must accept it.
// 2. Seed A opens a jar through the unmodified engine. The values are filled as proposal section 13.3 says, from
//    the template's role requirements: the request's (the date, the amount), then the wallet's own (the key's
//    address, the new category from a coin of the wallet's as input 0). Before the transaction is sent, the
//    position record of section 10.2 is written to a file.
// 3. Seed B, in an account with no history, is sent the key NFT by an ordinary transfer and is handed the record
//    and the template's text (the template record of section 10.2). From these alone it makes the jar's script
//    known to its engine and, after the jar's date, empties the jar.
// 4. The check of section 10.4 from the script's side, with the local Fulcrum alone.
//
// Each phase is a process of its own with an empty engine state, as a device would have; what one phase tells
// the next goes through files in .data/. Seed B's phase reads only the template text, the record and its own
// words; the facts file is read there for nothing but the run's bookkeeping, which the code below says.
//
// usage (from packages/app): [REGTEST_INSTANCE=2] npx tsx ../../spikes/xo-engine/35-template-alone-and-record.ts
import 'fake-indexeddb/auto';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { type Output, binToHex, decodeTransactionBch, hexToBin, sha256, bigIntToVmNumber } from '@bitauth/libauth';
import {
  type AccountCoin,
  type TemplateValues,
  ADDRESS_KIND,
  INPUT_BYTES,
  deriveSeedKeys,
  readTemplate,
  requiredFee,
  templateLockingBytecode,
  templateOutput,
  templateTransaction,
  templateUnlockingBytecode,
  transactionBytes,
  typedValues,
  walletAddress,
} from '@grandmas-wallet/core';
import type { XOTemplate } from '@xo-cash/types';
import { Account } from '../../packages/app/src/account.ts';
import { walletTemplateNumbers } from '../../packages/app/src/templates.ts';
// @ts-expect-error plain script
import { openEngineRegtest, mine, rpc, BURN, regtestAddress } from './regtest.mjs';
// @ts-expect-error plain script
import { mnemonicFor, DATA } from './common.mjs';

const engineErrors: string[] = [];
console.error = (...args: unknown[]) => engineErrors.push(String(args[0]).slice(0, 300));
const hex = binToHex;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const waitFor = async <T>(what: string, check: () => Promise<T | undefined>, attempts = 60): Promise<T> => {
  for (let attempt = 0; attempt < attempts; attempt++) { const found = await check(); if (found !== undefined) return found; await wait(500); }
  throw new Error(`timed out waiting for ${what}`);
};
const json = (value: unknown) => JSON.stringify(value, (_k, v: unknown) => (typeof v === 'bigint' ? String(v) : v instanceof Uint8Array ? hex(v) : v), 1);

const [run = String(Date.now()), phase] = process.argv.slice(2);
const FACTS = `${DATA}trial35-${run}.json`;
const TEMPLATE_RECORD = `${DATA}trial35-${run}-template.json`;
const POSITION_RECORD = `${DATA}trial35-${run}-record.json`;
const facts: Record<string, unknown> = existsSync(FACTS) ? JSON.parse(readFileSync(FACTS, 'utf8')) : {};
const remember = (entries: Record<string, unknown>) => { Object.assign(facts, entries); writeFileSync(FACTS, json(facts)); };

// --- 1. The template variant -------------------------------------------------------------------------------
// Made from the frozen text of version 3, field order kept. Nothing of its declaration is read.
const variantText = (): string => {
  const t = JSON.parse(readFileSync(fileURLToPath(new URL('../../packages/savings-jar/frozen/savings-jar-v3.json', import.meta.url)), 'utf8'));
  t.version = '4-trial';
  t.actions.withdraw.roles.saver.requirements.variables = ['keyCategory', 'unlockTime', 'unlockTimeBytes', 'keyHolder'];
  // The key at input 0, the jar's coins after it.
  t.transactions.withdrawTransaction.inputs = [{ input: 'jarKeyInput', inputIndex: 0 }, { input: 'savingsJarInput' }];
  // An input that names the key's category and has no unlocking script: the wallet's own coin goes there.
  t.inputs.jarKeyInput = { name: 'Jar key', description: 'The jar\'s key, spent and given back. It opens the jar.', token: { category: '$(<keyCategory>)' } };
  // The number of the input that spends the key, as a constant.
  t.scripts.unlockSavingsJar = '<0>';
  delete t.variables.keyInput;
  return JSON.stringify(t);
};

// --- 13.3: where a value comes from --------------------------------------------------------------------------
type Source = 'request' | 'record' | 'wallet: an address' | 'wallet: the coin at input 0' | 'user';
interface PositionRecord {
  token: { category: string; commitment: string };
  templateIdentifier: string;
  lockingScriptIdentifier: string;
  roleIdentifier: string;
  variables: Record<string, string>;
  values: Record<string, string>;
  applicationPage: string | null;
}
interface Transaction { inputs?: { input: string }[]; outputs?: { output: string }[] }
/** Whether an action's transaction makes a token of the category the variable names: an output names it, and no input does. */
const creates = (definition: XOTemplate, action: string, variable: string): boolean => {
  const transaction = (definition.transactions as Record<string, Transaction>)[definition.actions[action]?.transaction ?? ''];
  const names = (item: { token?: { category?: string } | null } | undefined) => item?.token?.category === `$(<${variable}>)`;
  const inputs = (transaction?.inputs ?? []).map(({ input }) => definition.inputs?.[input]);
  const outputs = (transaction?.outputs ?? []).map(({ output }) => definition.outputs?.[output]);
  return outputs.some(names) && !inputs.some(names);
};
/**
 * Fill each variable the role has to provide from the first source that has it (section 13.3): the request, the
 * record, the wallet itself, the user. `recordFirst: false` applies the order with one change: a locking script
 * is never taken from the record, because the record's is an address of the seed that wrote it.
 */
const fill = async (
  definition: XOTemplate, action: string, role: string,
  sources: { request?: Record<string, string>; record?: PositionRecord; address?: () => Promise<Uint8Array>; definingCoin?: AccountCoin; user?: Record<string, string>; scriptsFromRecord?: boolean },
): Promise<{ values: Record<string, string>; from: Record<string, Source> }> => {
  const required = definition.actions[action]?.roles?.[role]?.requirements?.variables ?? [];
  const values: Record<string, string> = {};
  const from: Record<string, Source> = {};
  for (const name of required) {
    const type = definition.variables?.[name]?.type;
    const recorded = sources.record?.variables[name] ?? sources.record?.values[name];
    if (sources.request?.[name] !== undefined) { values[name] = sources.request[name]; from[name] = 'request'; continue; }
    if (recorded !== undefined && (type !== 'locking_script' || sources.scriptsFromRecord !== false)) { values[name] = recorded; from[name] = 'record'; continue; }
    if (type === 'locking_script' && sources.address !== undefined) { values[name] = hex(await sources.address()); from[name] = 'wallet: an address'; continue; }
    if (type === 'token_category' && creates(definition, action, name) && sources.definingCoin !== undefined) {
      if (sources.definingCoin.utxo.index !== 0) throw new Error('A coin that defines a category is output 0 of its transaction.');
      values[name] = hex(sources.definingCoin.utxo.transactionHash); from[name] = 'wallet: the coin at input 0'; continue;
    }
    if (sources.user?.[name] !== undefined) { values[name] = sources.user[name]; from[name] = 'user'; continue; }
    throw new Error(`No source fills the variable "${name}" of the action "${action}"; the action stops here.`);
  }
  return { values, from };
};

// --- 10.4: the check from the script's side, with the local Fulcrum alone ----------------------------------------
const instance = process.env.REGTEST_INSTANCE ?? '1'; // as in regtest.mjs: a second local chain is instance 2
const fulcrumPort = Number(/ws = 127\.0\.0\.1:(\d+)/.exec(readFileSync(`${homedir()}/.local/share/grandmas-wallet/regtest/fulcrum${instance === '1' ? '' : instance}/fulcrum.conf`, 'utf8'))?.[1]);
const electrum = (method: string, ...params: unknown[]): Promise<unknown> =>
  new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${fulcrumPort}`);
    socket.onopen = () => socket.send(JSON.stringify({ id: 1, method, params }));
    socket.onmessage = (message) => { const body = JSON.parse(String(message.data)); socket.close(); if (body.error) reject(new Error(body.error.message)); else resolve(body.result); };
    socket.onerror = () => reject(new Error('local Fulcrum not reachable'));
  });
const scriptHashOf = (lockingBytecode: Uint8Array) => hex(sha256.hash(lockingBytecode).reverse());
const transactionOf = async (txid: string) => {
  const decoded = decodeTransactionBch(hexToBin(String(await electrum('blockchain.transaction.get', txid))));
  if (typeof decoded === 'string') throw new Error(decoded);
  return decoded;
};
/**
 * Section 10.4 for a record whose script is the position's own. `held` is the NFT coin the wallet holds, as the
 * wallet itself lists it; the rest is the template, the record and the chain as the local Fulcrum serves it.
 */
const checkRecord = async (definition: XOTemplate, record: PositionRecord, held: Output | undefined) => {
  const lines: string[] = [];
  // 1. An NFT of the record's category in the wallet. (Trust in the template is taken as given here.)
  const point1 = held?.token?.nft !== undefined && hex(held.token.category) === record.token.category;
  lines.push(`1. the wallet holds an NFT of the record's category: ${point1}`);
  // 2. The script from the template, the record's locking script and its values, by this project's own code.
  const script = templateLockingBytecode(definition, record.lockingScriptIdentifier, typedValues(definition, record.variables));
  const history = (await electrum('blockchain.scripthash.get_history', scriptHashOf(script))) as { tx_hash: string; height: number }[];
  const payers: { txid: string; height: number; carried: string | false }[] = [];
  for (const { tx_hash: txid, height } of history) {
    const transaction = await transactionOf(txid);
    if (!transaction.outputs.some((output) => hex(output.lockingBytecode) === hex(script))) continue; // spent the script, did not pay it
    const nftOf = (output: Output | undefined) => output?.token?.nft !== undefined && hex(output.token.category) === record.token.category;
    let carried: string | false = false;
    const outputAt = transaction.outputs.findIndex((output) => nftOf(output));
    if (outputAt >= 0) carried = `output ${outputAt}, commitment ${hex(transaction.outputs[outputAt]?.token?.nft?.commitment ?? new Uint8Array())}`;
    for (const [index, input] of transaction.inputs.entries()) {
      if (carried !== false || hex(input.outpointTransactionHash) === '00'.repeat(32)) break;
      const spent = (await transactionOf(hex(input.outpointTransactionHash))).outputs[input.outpointIndex];
      if (nftOf(spent)) carried = `input ${index}, commitment ${hex(spent?.token?.nft?.commitment ?? new Uint8Array())}`;
    }
    payers.push({ txid, height, carried });
  }
  const point2 = payers.some(({ carried }) => carried !== false);
  lines.push(`2. transactions that paid the script ${regtestAddress(hex(script))}: ${payers.length}`);
  for (const p of payers) lines.push(`   ${p.txid} at height ${p.height}: ${p.carried === false ? 'no NFT of the category' : `carried the NFT, ${p.carried}`}`);
  // 3. The template's open makes one NFT for each category (one output names `keyCategory`, and that category is
  // new in the transaction), so the category settles it; the commitment is compared as well.
  const point3 = point1 && hex(held?.token?.nft?.commitment ?? new Uint8Array()) === record.token.commitment;
  lines.push(`3. the NFT is the one the wallet holds: one NFT per category in this template; commitment as recorded: ${point3}`);
  const unspent = (await electrum('blockchain.scripthash.listunspent', scriptHashOf(script))) as { value: number }[];
  const counts = point1 && point2 && point3;
  lines.push(`=> the record ${counts ? 'counts' : 'does not count'}; the script holds ${unspent.length} coin(s), ${unspent.reduce((s, u) => s + u.value, 0)} sat${counts ? (unspent.length > 0 ? ': the position is shown and can be acted on' : ': the position is closed') : ''}`);
  return { counts, lines, script };
};

// --- the run ------------------------------------------------------------------------------------------------
const IDENTITY_A = new Uint8Array(32).fill(0xa1); // stands for each wallet's identity: only the address tags depend on it
const IDENTITY_B = new Uint8Array(32).fill(0xb2);
const seedKeys = (name: string) => deriveSeedKeys(mnemonicFor(name), 'testnet', walletTemplateNumbers());
const addressOf = (name: string, identity: Uint8Array, number: number) => walletAddress(identity, seedKeys(name).viewingKey, ADDRESS_KIND.change, number);
const NAME_A = `trial35-${run}-A`;
const NAME_B = `trial35-${run}-B`;

if (phase === undefined) {
  if ((await rpc('getblockcount')) === 0) await mine(1, BURN);
  // Seed B hands out an address for the key, as a person would: worked out from its words, no engine needed.
  remember({ keyGoesTo: hex(addressOf(NAME_B, IDENTITY_B, 0).lockingBytecode) });
  for (const next of ['first', 'second', 'check']) {
    console.log(`\n=== phase ${next} ===`);
    const result = spawnSync('npx', ['tsx', fileURLToPath(import.meta.url), run, next], { stdio: 'inherit' });
    if (result.status !== 0) { await rpc('setmocktime', 0); process.exit(result.status ?? 1); }
  }
  await rpc('setmocktime', 0);
  console.log(`\nrun ${run}: facts in ${FACTS}`);
  process.exit(0);
}

const startClock = async (): Promise<number> => {
  const { mediantime } = await rpc('getblockchaininfo');
  const start = Math.max(Math.floor(Date.now() / 1000), mediantime + 1);
  await rpc('setmocktime', start);
  return start;
};

/** An account on the local node, with its addresses made in order from 0 as the wallet's code tags them. */
const openAccount = async (name: string, identity: Uint8Array) => {
  const engine = await openEngineRegtest(name);
  const account = await Account.open(engine);
  let next = 0;
  const address = async () => {
    const ours = addressOf(name, identity, next);
    const made = await account.nextAddress(ADDRESS_KIND.change, ours.tag);
    if (made.number !== next || hex(made.lockingBytecode) !== hex(ours.lockingBytecode)) throw new Error('address differs from the wallet\'s own reckoning');
    next++;
    return made.lockingBytecode;
  };
  const stored = async (lockingBytecode: Uint8Array) => (await engine.listScriptHashes()).find((entry: { lockingBytecode: string }) => entry.lockingBytecode === hex(lockingBytecode));
  return { engine, account, address, stored };
};

const jarInputBytes = (definition: XOTemplate, values: TemplateValues) => {
  const unlocking = templateUnlockingBytecode(definition, 'savingsJarLockingScript', 'savingsJarInput', values);
  return 32 + 4 + 1 + unlocking.length + 4;
};

try {
  if (phase === 'first') {
    await startClock();
    // Step 1: the validator.
    const text = variantText();
    const template = readTemplate(text); // parseTemplate of @xo-cash/utils; throws if the validator refuses
    console.log('template variant accepted by parseTemplate; identifier', template.identifier);
    const { definition } = template;
    const A = await openAccount(NAME_A, IDENTITY_A);
    const identifier = await A.account.importTemplate(text);
    console.log('A: engine took the template; its identifier equals the reckoned one:', identifier === template.identifier);

    // A coin that is output 0 of its transaction: a block reward to A's first address.
    const first = await A.address();
    await mine(1, hex(first));
    await mine(100, BURN);
    const coin = await waitFor('A\'s first coin', async () => (await A.account.coinsAt(first)).find((c) => c.utxo.index === 0));

    // Step 2: open. The request, as an application would send it: action, role, the date and the amount.
    const { mediantime } = await rpc('getblockchaininfo');
    const unlockTime = mediantime + 3600;
    const request = { unlockTime: String(unlockTime), unlockTimeBytes: hex(bigIntToVmNumber(BigInt(unlockTime))), savedSatoshis: '200000' };
    const opened = await fill(definition, 'open', 'saver', { request, address: A.address, definingCoin: coin });
    console.log('A: open, values and where each came from:', json(opened.from));
    const values = typedValues(definition, opened.values);
    const changeAt = await A.address();
    const planned = templateTransaction(definition, 'open', values).outputs.map(({ output }) => templateOutput(definition, output, values));
    const bytes = transactionBytes([INPUT_BYTES.byKey], [...planned, { lockingBytecode: changeAt, valueSatoshis: 0n }]);
    const change = coin.utxo.output.valueSatoshis - planned.reduce((s, o) => s + o.valueSatoshis, 0n) - requiredFee(bytes);
    const prepared = await A.account.prepare({
      template: identifier, action: 'open', role: 'saver', variables: values,
      inputs: [{ coin }], outputs: [{ outputIdentifier: 'savingsJarOutput' }, { outputIdentifier: 'jarKeyOutput' }, { lockingBytecode: changeAt, valueSatoshis: change }],
    });
    const openTx = decodeTransactionBch(hexToBin(prepared.transactionHex));
    if (typeof openTx === 'string') throw new Error(openTx);

    // The record, from the transaction as built and the values it was built with, before it is sent (section 10.5).
    const lockingScriptIdentifier = 'savingsJarLockingScript';
    const scriptVariables = ((definition.lockingScripts[lockingScriptIdentifier] as { state?: { variables?: string[] } }).state?.variables ?? []);
    const jarAt = templateLockingBytecode(definition, lockingScriptIdentifier, values);
    const jarOutput = openTx.outputs.findIndex((o) => hex(o.lockingBytecode) === hex(jarAt));
    const keyOutput = openTx.outputs.find((o) => o.token?.nft !== undefined && hex(o.token.category) === opened.values.keyCategory);
    if (jarOutput < 0 || keyOutput?.token?.nft === undefined) throw new Error('the open does not pay the jar or make the key');
    const record: PositionRecord = {
      token: { category: hex(keyOutput.token.category), commitment: hex(keyOutput.token.nft.commitment) },
      templateIdentifier: identifier,
      lockingScriptIdentifier,
      roleIdentifier: 'saver',
      variables: Object.fromEntries(scriptVariables.map((name) => [name, opened.values[name] as string])),
      values: Object.fromEntries(Object.entries(opened.values).filter(([name]) => !scriptVariables.includes(name))),
      applicationPage: null, // the request came from this script, not from a page
    };
    writeFileSync(TEMPLATE_RECORD, text);
    writeFileSync(POSITION_RECORD, json(record));
    console.log('A: record written before sending:', json(record));
    const engineHolds = await A.stored(jarAt);
    console.log('A: what A\'s engine stores for the jar\'s script (ScriptHashData):', json(engineHolds));

    await A.account.send(prepared);
    await mine(1, BURN);
    console.log(`A: open sent, ${prepared.transactionId}, ${prepared.bytes} bytes; jar at output ${jarOutput}, ${regtestAddress(hex(jarAt))}`);

    // Anyone can pay in: a block reward straight to the jar's address, a payment that carries no key.
    await mine(1, hex(jarAt));
    // A script someone paid, with no key: what a record with another date would name. For the check's counter-example.
    const decoyRecord = { ...record, variables: { ...record.variables, unlockTime: String(unlockTime + 1) } };
    const decoyAt = templateLockingBytecode(definition, lockingScriptIdentifier, typedValues(definition, decoyRecord.variables));
    await mine(1, hex(decoyAt));

    // Step 3: an ordinary transfer of the key to seed B, with the wallet's payment action; A's change pays the fee.
    const keyCoin = await waitFor('the key at A', async () => (await A.account.coins()).find((c) => c.utxo.output.token !== undefined && hex(c.utxo.output.token.category) === record.token.category));
    const feeCoin = await waitFor('A\'s change', async () => (await A.account.coinsAt(changeAt))[0]);
    const keyGoesTo = hexToBin(facts.keyGoesTo as string);
    const backTo = await A.address();
    const transferOut: Output = { lockingBytecode: keyGoesTo, valueSatoshis: keyCoin.utxo.output.valueSatoshis, ...(keyCoin.utxo.output.token === undefined ? {} : { token: keyCoin.utxo.output.token }) };
    const transferBytes = transactionBytes([INPUT_BYTES.byKey, INPUT_BYTES.byKey], [transferOut, { lockingBytecode: backTo, valueSatoshis: 0n }]);
    const transfer = await A.account.prepare({
      template: 'actions', action: 'pay', role: 'owner', inputs: [{ coin: keyCoin }, { coin: feeCoin }],
      outputs: [transferOut, { lockingBytecode: backTo, valueSatoshis: feeCoin.utxo.output.valueSatoshis - requiredFee(transferBytes) }],
    });
    await A.account.send(transfer);
    console.log(`A: key sent to B by an ordinary payment, ${transfer.transactionId}, ${transfer.bytes} bytes`);
    await mine(100, BURN); // the block reward paid into the jar is spendable after 100 blocks
    remember({ unlockTime, open: prepared.transactionId, transfer: transfer.transactionId, jarAt: hex(jarAt), engineA: engineHolds, decoyRecord });
    await A.account.close();
  }

  if (phase === 'second') {
    // Seed B. It is given: its own words, the template's text, the record, and the key on chain. From the facts
    // file it reads nothing that A's engine knew; the date is taken from the record, the destination of the key was
    // its own address.
    await startClock();
    const text = readFileSync(TEMPLATE_RECORD, 'utf8');
    const record = JSON.parse(readFileSync(POSITION_RECORD, 'utf8')) as PositionRecord;
    const B = await openAccount(NAME_B, IDENTITY_B);
    console.log('B: engine state at the start: scripts', (await B.engine.listScriptHashes()).length, 'invitations', (await B.engine.listInvitations()).length, 'coins', (await B.engine.listUnspentOutputs()).length);
    const identifier = await B.account.importTemplate(text);
    if (identifier !== record.templateIdentifier) throw new Error('the template text is not the record\'s template');
    const definition = (await B.engine.getTemplate(identifier)) as XOTemplate;
    const keyAt = await B.address(); // address 0, where the key was sent

    // Make the jar's script known, from the record, the way the wallet does today.
    const jarAt = await B.account.followScript({ template: record.templateIdentifier, lockingScript: record.lockingScriptIdentifier, role: record.roleIdentifier, variables: record.variables });
    console.log('B: followScript gave', regtestAddress(hex(jarAt)), '| equals the template compiled with the record\'s values:', hex(jarAt) === hex(templateLockingBytecode(definition, record.lockingScriptIdentifier, typedValues(definition, record.variables))));
    const engineB = await B.stored(jarAt);
    console.log('B: what B\'s engine stores for the jar\'s script:', json(engineB));
    const engineA = facts.engineA as Record<string, unknown>; // A's, for comparison in the write-up only
    for (const field of ['lockingBytecode', 'templateIdentifier', 'lockingScriptIdentifier', 'outputIdentifier', 'roleIdentifier', 'variables', 'secrets']) {
      console.log(`   ${field}: ${JSON.stringify(engineA?.[field]) === JSON.stringify(engineB?.[field]) ? 'same as A\'s' : `A ${JSON.stringify(engineA?.[field])} / B ${JSON.stringify(engineB?.[field])}`}`);
    }
    const jarCoins = await waitFor('the jar\'s two coins at B', async () => { const c = await B.account.coinsAt(jarAt); return c.length >= 2 ? c : undefined; });
    const keyCoin = await waitFor('the key at B', async () => (await B.account.coinsAt(keyAt)).find((c) => c.utxo.output.token !== undefined));
    console.log('B: sees', jarCoins.length, 'jar coins,', jarCoins.reduce((s, c) => s + c.utxo.output.valueSatoshis, 0n), 'sat, under template', jarCoins[0]?.template === identifier ? 'the jar\'s' : jarCoins[0]?.template, '| the key under', keyCoin.template);

    const before = await checkRecord(definition, record, keyCoin.utxo.output);
    console.log('B: check of section 10.4 before emptying:\n  ' + before.lines.join('\n  '));

    // Section 13.3 taken word for word: request, record, wallet, user. The record holds `keyHolder` from the open.
    const literal = await fill(definition, 'withdraw', 'saver', { record, address: B.address });
    console.log('B: withdraw filled in the order of section 13.3 as written:', json(literal.from), '| keyHolder would be', regtestAddress(literal.values.keyHolder ?? ''), literal.values.keyHolder === record.values.keyHolder ? '= the address A gave at the open, an address of seed A' : '');
    const depositLiteral = await fill(definition, 'deposit', 'saver', { record, user: { savedSatoshis: '5000' } });
    console.log('B: deposit filled the same way, with the user typing 5000 sat:', json(depositLiteral.from), 'savedSatoshis =', depositLiteral.values.savedSatoshis);

    // The order with a locking script never taken from the record.
    const keyHolder = await B.address();
    const filled = await fill(definition, 'withdraw', 'saver', { record, address: async () => keyHolder, scriptsFromRecord: false });
    console.log('B: withdraw filled with locking scripts the wallet\'s own:', json(filled.from));
    // The token the action spends: the record's, which the wallet holds; it goes where the template places jarKeyInput.
    if (hex(keyCoin.utxo.output.token?.category ?? new Uint8Array()) !== record.token.category) throw new Error('not the record\'s token');
    const values = typedValues(definition, filled.values);
    const leftOverAt = await B.address();
    const withdraw = async () => {
      const keyBack = templateOutput(definition, 'jarKeyOutput', values);
      const total = [keyCoin, ...jarCoins].reduce((s, c) => s + c.utxo.output.valueSatoshis, 0n);
      const bytes = transactionBytes([INPUT_BYTES.byKey, ...jarCoins.map(() => jarInputBytes(definition, values))], [keyBack, { lockingBytecode: leftOverAt, valueSatoshis: 0n }]);
      return B.account.prepare({
        template: identifier, action: 'withdraw', role: 'saver', variables: values,
        inputs: [{ coin: keyCoin, inputIdentifier: 'jarKeyInput' }, ...jarCoins.map((coin) => ({ coin, inputIdentifier: 'savingsJarInput' }))],
        outputs: [{ outputIdentifier: 'jarKeyOutput' }, { lockingBytecode: leftOverAt, valueSatoshis: total - keyBack.valueSatoshis - requiredFee(bytes) }],
      });
    };
    // Before the date the network refuses it.
    const early = await withdraw();
    try { await B.account.send(early); console.log('B: UNEXPECTED: sent before the date'); } catch (error) { console.log("B: before the date the node refuses it:", String((error as Error).message).slice(0, 700), String((error as { cause?: unknown }).cause ?? "").slice(0, 300)); }

    // Move the chain's median time past the date.
    const unlockTime = Number(record.variables.unlockTime);
    await rpc('setmocktime', unlockTime + 120);
    await mine(12, BURN);
    console.log('B: median time now', (await rpc('getblockchaininfo')).mediantime, 'against the date', unlockTime);
    const prepared = await withdraw();
    const tx = decodeTransactionBch(hexToBin(prepared.transactionHex));
    if (typeof tx === 'string') throw new Error(tx);
    const keyIndex = tx.inputs.findIndex((input) => hex(input.outpointTransactionHash) === hex(keyCoin.utxo.transactionHash) && input.outpointIndex === keyCoin.utxo.index);
    console.log('B: withdraw built by the engine:', prepared.bytes, 'bytes, fee', prepared.feeSatoshis, 'sat | the same transaction as the one refused before the date:', prepared.transactionId === early.transactionId, '| key at input', keyIndex, '| its unlocking', tx.inputs[keyIndex]?.unlockingBytecode.length, 'bytes, signature type', hex(tx.inputs[keyIndex]?.unlockingBytecode.slice(65, 66) ?? new Uint8Array()),
      '| jar inputs unlock with first byte', tx.inputs.slice(1).map((input) => hex(input.unlockingBytecode.slice(0, 1))).join(','), '(00 pushes the number 0), then the redeem script | sequence', tx.inputs.map((input) => input.sequenceNumber), '| locktime', tx.locktime);
    await B.account.send(prepared);
    await mine(1, BURN);
    const paid = await waitFor('the savings at B', async () => (await B.account.coinsAt(leftOverAt))[0]);
    const keyAgain = await waitFor('the key back at B', async () => (await B.account.coinsAt(keyHolder))[0]);
    console.log(`B: jar emptied, ${prepared.transactionId}; ${paid.utxo.output.valueSatoshis} sat at B's own address; key back at B's address with the same token:`, hex(keyAgain.utxo.output.token?.category ?? new Uint8Array()) === record.token.category);
    remember({ withdraw: prepared.transactionId, early: early.transactionId, engineB, keyNowAt: hex(keyHolder) });
    await B.account.close();
  }

  if (phase === 'check') {
    // No engine: the template text, the record, the key's coin as the wallet would list it, and the local Fulcrum.
    const definition = readTemplate(readFileSync(TEMPLATE_RECORD, 'utf8')).definition;
    const record = JSON.parse(readFileSync(POSITION_RECORD, 'utf8')) as PositionRecord;
    const listed = (await electrum('blockchain.scripthash.listunspent', scriptHashOf(hexToBin(facts.keyNowAt as string)), 'include_tokens')) as { tx_hash: string; tx_pos: number }[];
    const held = listed[0] === undefined ? undefined : (await transactionOf(listed[0].tx_hash)).outputs[listed[0].tx_pos];
    const after = await checkRecord(definition, record, held);
    console.log('check of section 10.4 after emptying, chain data only:\n  ' + after.lines.join('\n  '));
    const decoy = await checkRecord(definition, facts.decoyRecord as PositionRecord, held);
    console.log('the same check for a record with another date, whose script someone paid without the key:\n  ' + decoy.lines.join('\n  '));
  }
} catch (error) {
  console.log('FAILED:', (error as Error).name, String((error as Error).message).slice(0, 1200));
  console.log('engine errors:', [...new Set(engineErrors)].slice(0, 8));
  process.exitCode = 1;
} finally {
  process.exit();
}
