// A run of five third-party XO templates published at XO Grid (https://xogrid.vercel.app/explore), with an owner's
// wallet on the unmodified XO engine: Drip Mine, Revenue Split, Claim-Code Voucher, Token Burner and Block Points.
//
// The run proves on a real chain what the wallet was changed for, and had been shown only on the simulated chain with
// the test key holder:
//   1. a template whose starting actions are under several roles offers each under its own role (Drip Mine's `fund`,
//      from the wallet's own list of a template's actions);
//   2. a token category the request gives is an existing category: the wallet pays that many of its own fungible
//      tokens (Token Burner's `depositFungibleTokens`, Block Points' `fundThread`);
//   3. a template input marked `omitChangeAmounts` gives its coin's satoshis to the fee, with no change output for it
//      (Token Burner's `burn`, Drip Mine's `drip`);
//   4. a coin the request names is recognised and unlocked with the values the request gives for its script's state
//      (Claim-Code Voucher's `claimVoucher`).
//
// The templates' texts are taken from XO Grid when the run starts (`/api/templates/<identifier>/raw`), checked with the
// wallet's own reader to have the identifier asked for, and kept only in the run's git-ignored folder: they are not
// this project's, and are not committed. The wallet takes each in as a person adding a file does, and the run then
// asks as an application's page would, with a request naming the template, action, role and values and, for an
// action on a coin of the application's, the coin by outpoint. Drip Mine's `fund` is asked from the wallet's own
// screen path instead.
//
// One script, two chains, as the stage 17 runs (scripts/stage-17-chain.ts): on the local node the run makes its blocks;
// on chipnet it is paid from the saved funding key, never makes a block, and waits for one only where a confirmation or
// the Drip Mine's lock needs it. Each part is a process of its own with an empty engine state. What the run knows is in
// .local-runs/xo-grid-local.json (on chipnet .chipnet/xo-grid-chipnet.json), written once each step is carried out; the
// stores and the templates' texts are directories beside it. A run that stops is continued with the same command;
// `--new` starts again (on chipnet only once the earlier run has finished).
//
// usage (from packages/app):
//   npx tsx ../../scripts/xo-grid-run.ts [local]       with the local node running (deploy/regtest/regtest.sh)
//   npx tsx ../../scripts/xo-grid-run.ts chipnet       paid from the key in .chipnet/funder-design-2.json
//   npx tsx ../../scripts/xo-grid-run.ts chipnet --dry reads chipnet and says what a run would need; sends nothing
// The record is written to docs/runs/xo-grid-templates-local-node.md (on chipnet docs/runs/xo-grid-templates-chipnet.md).
import 'fake-indexeddb/auto';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { type Output, binToHex, decodeTransactionBch, generateBip39Mnemonic, hexToBin, sha256, utf8ToBin } from '@bitauth/libauth';
import { type ArchiveStore, blobIdOf } from '@grandmas-wallet/archive';
import { type ChainReader, type KeyPair, type Utxo, buildTransaction, checkBeforeSending, deriveCredentialKeys, deriveSeedKeys, keyPairFromPrivateKey, p2pkhInput, p2pkhLockingBytecode, quickPass, readControllerHistory, readTemplate } from '@grandmas-wallet/core';
import { Engine, XO_SUPPORTED_NETWORKS } from '@xo-cash/engine';

import { Electrum } from '../packages/chipnet/src/electrum.js';
import { invitationFiles, writeInvitationFiles } from './invitation-files.js';
import { chipnetFunder, coinsFor, electrumEndpoint, engineServers, runArguments, startOver } from './stage-17-chain.js';
import { type ActionPreview, type ApplicationAction, type OwnerWalletState, type RecoveryArrangement, Account, Applications, OwnerWallet, applicationArchive, newArchive, walletTemplateNumbers } from '../packages/app/src/index.js';
// @ts-expect-error a plain script: the node's RPC on the local chain
import { mine, BURN } from '../spikes/xo-engine/regtest.mjs';

const hex = binToHex;
const root = fileURLToPath(new URL('..', import.meta.url));
/** The exit code of a part that stopped at a step of its own and said why. */
const STOPPED = 3;
const PHASES = ['the wallet is set up', 'the templates are used', 'the wallet is closed', 'the run returns what is left'];
const { chainName, local, phase, dry, fresh } = runArguments(PHASES, 'xo-grid-run.ts');
const runDirectory = local ? `${root}.local-runs` : `${root}.chipnet`;
mkdirSync(runDirectory, { recursive: true });
const stateFile = `${runDirectory}/xo-grid-${local ? 'local' : 'chipnet'}.json`;
const storeDirectory = `${runDirectory}/xo-grid-${local ? '' : 'chipnet-'}stores`;
/** The templates' texts as XO Grid served them, a file each, outside git. */
const templateDirectory = `${runDirectory}/xo-grid-${local ? '' : 'chipnet-'}templates`;
/** The XO invitation behind every transaction the wallet sends: kept outside git, as they hold the templates' texts. */
const invitations = `${runDirectory}/invitations/xo-grid-${local ? 'local' : 'chipnet'}/`;
const logFile = `${root}docs/runs/xo-grid-templates-${local ? 'local-node' : 'chipnet'}.md`;
const XO_GRID = 'https://xogrid.vercel.app';

/** The templates, by the names the run uses, with their identifiers at XO Grid. */
const TEMPLATES = {
  dripMine: '346048b296ba8a35dc44caddd80d5387aba3e3a0be973a568af804699b7f1185',
  revenueSplit: 'b17ba2ee55b392f959155a9b86d58137ebfef783041c092496ddb887f9d8654e',
  voucher: '317c4947b5b9cc71d1fe01616cdc930b6ca3ef5808700c68d1cb0696e79b4911',
  tokenBurner: '1ef44c322bbcd2db0f376b9359a1255a6560e0365a21d8811c4d85b3b57247e0',
  blockPoints: '9941f723c962e64956c5dcbc9e97e6a735736e4a8e94b24d7d77e6b0eeee3e5a',
} as const;
type TemplateName = keyof typeof TEMPLATES;

/** What the run pays the wallet, and gives to the templates. */
const WALLET_FUNDING = 80_000n;
const TOKEN_COIN = 1_000n;
const TOKEN_SUPPLY = 1_000_000n;
const AMOUNTS = { drip: 1_500, split: 3_000, voucher: 3_000, burnSatoshis: 1_000, burnTokens: 200, burnTokenSatoshis: 1_000, threadTokens: 100_000, threadSatoshis: 1_000 };
/** What does not come back by design: the Drip Mine's coin, the burned coins, the Block Points thread's satoshis. */
const BY_DESIGN = BigInt(AMOUNTS.drip + AMOUNTS.burnSatoshis + AMOUNTS.burnTokenSatoshis + AMOUNTS.threadSatoshis);
/** What the run pays out at most at one time on chipnet: the wallet's funding, the token coin, and the fees. */
const CHIPNET_NEEDS = 100_000n;
/** The Drip Mine's relative lock of one block, in chain blocks: chipnet counts heights in tens for locks. */
const DRIP_BLOCKS = local ? 1 : 10;

interface Entry { step: string; transactionId: string; bytes: number; fee: string; note: string }
interface Facts {
  startedAt: string;
  words: { owner: string; credential: string };
  localFunder?: string;
  identity?: string;
  ownerState?: OwnerWalletState;
  arrangement?: RecoveryArrangement;
  /** When the templates' texts were taken from XO Grid, and their names and content hashes as the wallet read them. */
  templates?: { fetchedAt: string; read: Record<string, { name: string; identifier: string; contentHash: string }> };
  category?: string;
  /** The coins of the applications the run made, by step, as `<transaction id>:<index>`. */
  coins: Record<string, string>;
  steps: Record<string, { transactionIds: string[]; data?: Record<string, number | string> }>;
  pending?: Record<string, { transactionId: string; hex: string }>;
  /** The action being carried out, until its transaction is written down. */
  carrying?: string;
  finished: string[];
  funderAtStart?: string;
  funderAfter?: string;
  log: Entry[];
  notes: string[];
}

// ------------------------------------------------------------------ the driver: one process for each part

if (phase === undefined && dry) {
  const server = await Electrum.connect(electrumEndpoint(false));
  try {
    const funderLocking = p2pkhLockingBytecode(chipnetFunder().keyHash);
    const coins = await server.listUnspent(funderLocking, 'exclude');
    const tokens = await server.listUnspent(funderLocking, 'only');
    const balance = coins.reduce((sum, coin) => sum + coin.valueSatoshis, 0n);
    const tip = await server.tip();
    const servers = await engineServers(false);
    console.log(`chipnet at ${electrumEndpoint(false)}: tip ${tip.height}. The engine would be given ${servers.length} server: ${servers.map((entry) => entry.host).join(', ')}.`);
    console.log(`The funding key holds ${balance} satoshis in ${coins.length} coins without tokens, and ${tokens.length} coins with tokens (left alone by the run).`);
    console.log(`The run pays out at most about ${CHIPNET_NEEDS} satoshis at a time (${WALLET_FUNDING} to the wallet's funding address, ${TOKEN_COIN} with the test tokens, the fees). ${balance >= CHIPNET_NEEDS ? 'The key holds enough.' : 'The key holds TOO LITTLE.'}`);
    const fees = 20n * 500n;
    console.log(`Would not come back: ${BY_DESIGN} satoshis by design (the Drip Mine's coin ${AMOUNTS.drip}, the two burned coins ${AMOUNTS.burnSatoshis + AMOUNTS.burnTokenSatoshis}, the Block Points thread ${AMOUNTS.threadSatoshis}), and the network fees of about twenty transactions, at most about ${fees}: in all at most about ${BY_DESIGN + fees} satoshis.`);
    console.log(`The Drip Mine's coin can be dripped ${DRIP_BLOCKS} chain blocks after its own, about ${DRIP_BLOCKS} minutes on chipnet; the run does the other templates meanwhile.`);
    console.log(existsSync(stateFile) ? `A run is under way: ${stateFile.slice(root.length)} (finished: ${(JSON.parse(readFileSync(stateFile, 'utf8')) as Facts).finished.join(', ') || 'nothing yet'}). The same command without --dry continues it.` : `No run is under way; ${stateFile.slice(root.length)} does not exist.`);
  } finally {
    await server.disconnect().catch(() => undefined);
  }
  process.exit(0);
}

if (phase === undefined) {
  if (fresh) {
    startOver(local, stateFile, storeDirectory, PHASES);
    if (local) rmSync(templateDirectory, { recursive: true, force: true });
  }
  if (!existsSync(stateFile)) rmSync(invitations, { recursive: true, force: true });
  const finished = existsSync(stateFile) ? (JSON.parse(readFileSync(stateFile, 'utf8')) as Facts).finished : [];
  for (const next of PHASES) {
    if (finished.includes(next)) {
      console.log(`${next}: done before`);
      continue;
    }
    // A part that ends without saying why (the engine's packages can end the process) is continued, a few times.
    let result = spawnSync('npx', ['tsx', fileURLToPath(import.meta.url), chainName, next], { stdio: 'inherit' });
    for (let again = 0; again < 3 && result.status !== 0 && result.status !== STOPPED; again += 1) {
      console.log(`"${next}" ended unexpectedly; continuing it`);
      result = spawnSync('npx', ['tsx', fileURLToPath(import.meta.url), chainName, next], { stdio: 'inherit' });
    }
    if (result.status !== 0) {
      console.error(`Stopped in "${next}". The same command continues the run.`);
      process.exit(result.status ?? 1);
    }
  }
  const facts = JSON.parse(readFileSync(stateFile, 'utf8')) as Facts;
  const written = invitationFiles(invitations);
  const invitationOf = (transactionId: string): string => {
    const found = written.find((entry) => entry.transactionId === transactionId);
    return found === undefined ? '' : `${found.action} (${found.role})`;
  };
  const revision = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const changed = execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).split('\n').filter((line) => line.trim() !== '' && !line.includes('docs/runs/') && !line.includes('.chipnet'));
  const read = facts.templates?.read ?? {};
  writeFileSync(
    logFile,
    [
      `# Five XO Grid templates on ${local ? 'the local node' : 'chipnet'}`,
      '',
      `Written by the run itself (\`scripts/xo-grid-run.ts${local ? '' : ' chipnet'}\`). An owner's wallet on the unmodified XO engine, ${local ? 'against the local node in regtest mode with the public networks\' relay rules' : 'on chipnet, paid from the funding address and with everything that is not given away by design returned to it at the end; no block was made by the run'}. Each part ran in a process of its own with an empty engine state. The wallet has its recovery arrangement and two backup stores (directories of the run, read and written as a store server's are), and each template was stored in the backup before its first action.`,
      '',
      `The templates' texts were taken from XO Grid (${XO_GRID}/api/templates/<identifier>/raw) at run time, ${facts.templates?.fetchedAt ?? '?'}, and checked with the wallet's own reader to have the identifier asked for. They are not this project's and are kept only in the run's git-ignored folder, as are the engine's invitations, which hold them. The wallet took each in as a person adding a file does; the run then asked as an application's page would: a request naming the template, action, role and values, and for an action on a coin of the application's, the coin by outpoint. Drip Mine's \`fund\` was asked from the wallet's own list of the template's actions instead.`,
      '',
      ...Object.entries(TEMPLATES).map(([name, identifier]) => `- Template "${read[name]?.name ?? name}": \`${identifier}\`${read[name] === undefined || read[name].contentHash === identifier ? '' : ` (content hash \`${read[name].contentHash}\`)`}`),
      `- Wallet identity: \`${facts.identity}\``,
      `- Test token category: \`${facts.category}\`, ${TOKEN_SUPPLY} tokens made by the funder for the run`,
      `- Repository at commit \`${revision}\`${changed.length === 0 ? '' : `, with uncommitted changes to ${changed.map((line) => line.slice(3)).join(', ')}`}`,
      `- Started ${facts.startedAt}`,
      ...(local ? [] : ['- The engine ran as published, with no local change, given one server (chipnet.9500.cash), as in run B.']),
      '',
      '| Step | Transaction | Bytes | Fee (sat) | Note | Invitation |',
      '| --- | --- | --- | --- | --- | --- |',
      ...facts.log.map((entry) => `| ${entry.step} | \`${entry.transactionId}\` | ${entry.bytes} | ${entry.fee} | ${entry.note} | ${invitationOf(entry.transactionId)} |`),
      '',
      'Also observed:',
      '',
      ...facts.notes.map((line) => `- ${line}`),
      '',
    ].join('\n'),
  );
  console.log(`Run complete. Record written to ${logFile.slice(root.length)}`);
  process.exit(0);
}

// ------------------------------------------------------------------ what every part shares

const facts: Facts = existsSync(stateFile)
  ? (JSON.parse(readFileSync(stateFile, 'utf8')) as Facts)
  : { startedAt: new Date().toISOString(), words: { owner: generateBip39Mnemonic(), credential: generateBip39Mnemonic() }, coins: {}, steps: {}, finished: [], log: [], notes: [] };
const keep = (): void => writeFileSync(stateFile, JSON.stringify(facts, (_key, value: unknown) => (typeof value === 'bigint' ? String(value) : value), 1), { mode: 0o600 });
// The words are on disk before anything is paid.
keep();
const say = (line: string): void => console.log(line);
const note = (line: string, name?: string): void => {
  if (name !== undefined) {
    if (facts.steps[`observed: ${name}`] !== undefined) return;
    facts.steps[`observed: ${name}`] = { transactionIds: [] };
  }
  if (!facts.notes.includes(line)) facts.notes.push(line);
  keep();
  say(`  ${line}`);
};
const record = (step: string, sent: { transactionId: string; bytes: number; feeSatoshis: bigint }, about = ''): void => {
  if (!facts.log.some((entry) => entry.transactionId === sent.transactionId)) facts.log.push({ step, transactionId: sent.transactionId, bytes: sent.bytes, fee: String(sent.feeSatoshis), note: about });
  keep();
  say(`  ${step}: ${sent.transactionId}, ${sent.bytes} bytes, fee ${sent.feeSatoshis}${about === '' ? '' : `; ${about}`}`);
  if (sent.feeSatoshis < BigInt(sent.bytes)) throw new Error('a fee below the size');
};
const once = async (name: string, work: () => Promise<{ transactionIds?: string[]; data?: Record<string, number | string> } | undefined>): Promise<Record<string, number | string>> => {
  if (facts.steps[name] === undefined) {
    say(`  ${name}`);
    const done = (await work()) ?? {};
    facts.steps[name] = { transactionIds: done.transactionIds ?? [], ...(done.data === undefined ? {} : { data: done.data }) };
    keep();
    if (process.env['STOP_AFTER'] === name) throw new Error(`stopped after "${name}", as asked`);
  } else {
    say(`  (${name}: done before)`);
  }
  return facts.steps[name]?.data ?? {};
};
const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const PATIENCE_MS = local ? 60_000 : 5 * 60_000;
const BLOCK_PATIENCE_MS = local ? 60_000 : 15 * 60_000;
/** A wait, always bounded, and said with its end: one that runs out stops the part; the same command continues. */
const until = async <T>(what: string, check: () => Promise<T | undefined | false>, patienceMs = PATIENCE_MS, everyMs = local ? 500 : 5_000): Promise<T> => {
  const deadline = Date.now() + patienceMs;
  let announced = false;
  for (;;) {
    const found = await check();
    if (found !== undefined && found !== false) return found;
    if (Date.now() > deadline) throw new Error(`timed out after ${Math.round(patienceMs / 1000)} s waiting for ${what}; the same command continues the run`);
    if (!announced && !local) say(`  waiting for ${what} (at most until ${new Date(deadline).toISOString().slice(11, 19)} UTC)`);
    announced = true;
    await wait(everyMs);
  }
};
console.error = () => undefined;

const numbers = walletTemplateNumbers();
const credential = deriveCredentialKeys(facts.words.credential, 'testnet', numbers);
const ownerSeed = deriveSeedKeys(facts.words.owner, 'testnet', numbers);

const server = await Electrum.connect(electrumEndpoint(local));
const chain: ChainReader = {
  getHistory: (lockingBytecode) => server.getHistory(lockingBytecode),
  getTransaction: (transactionId) => server.getTransaction(transactionId),
  listUnspent: async (lockingBytecode) => (await server.listUnspent(lockingBytecode)).map((entry) => ({ ...entry, hasToken: entry.token !== undefined })),
};

if (local && facts.localFunder === undefined) {
  facts.localFunder = hex(crypto.getRandomValues(new Uint8Array(32)));
  keep();
}
const funder: KeyPair = local ? keyPairFromPrivateKey(hexToBin(facts.localFunder as string)) : chipnetFunder();
const funderLocking = p2pkhLockingBytecode(funder.keyHash);
const block = async (): Promise<void> => {
  if (local) await mine(1, BURN);
};
const confirmed = async (transactionId: string): Promise<number> => {
  if (local) await mine(1, BURN);
  return until(`the first confirmation of ${transactionId.slice(0, 12)}… (a block, about a minute on chipnet)`, async () => { const count = (await server.confirmations(transactionId)) ?? 0; return count > 0 ? count : undefined; }, BLOCK_PATIENCE_MS, local ? 500 : 10_000);
};
const funderCoins = async (): Promise<Utxo[]> =>
  (await server.listUnspent(funderLocking, 'exclude')).map((entry) => ({ transactionHash: hexToBin(entry.transactionId), index: entry.index, output: { lockingBytecode: funderLocking, valueSatoshis: entry.valueSatoshis } }));
const tokenCoinsOfFunder = async (category: string): Promise<Utxo[]> =>
  (await server.listUnspent(funderLocking, 'only'))
    .filter((entry) => entry.token?.category === category)
    .map((entry) => ({ transactionHash: hexToBin(entry.transactionId), index: entry.index, output: { lockingBytecode: funderLocking, valueSatoshis: entry.valueSatoshis, token: { amount: entry.token?.amount ?? 0n, category: hexToBin(category) } } }));
/**
 * A payment of the funder, with its change back to the funder, written to the run's file before it is sent, so that a
 * part that stops right after sending it finds it there and does not pay again. `first` is spent as input 0 (a new
 * token category is made from it), with the funder's coins after it where it does not cover the payment.
 */
const funderPays = async (step: string, outputs: Output[], options: { burn?: boolean; first?: Utxo; extraInputs?: Utxo[] } = {}): Promise<string> => {
  const pending = facts.pending?.[step];
  if (pending !== undefined) {
    if ((await server.getTransaction(pending.transactionId)) === undefined) {
      const again = await server.broadcast(pending.hex);
      if (!again.accepted && !/already/i.test(again.reason)) throw new Error(`the funder's payment for "${step}", written down before it was sent, is not on the chain and was refused when sent again (${again.reason}); look at ${pending.transactionId} before continuing`);
    }
    return pending.transactionId;
  }
  const paying = outputs.reduce((sum, output) => sum + output.valueSatoshis, 0n);
  const coins = await until('the funder\'s coins', async () => { const found = await funderCoins(); return found.length > 0 ? found : undefined; });
  const first = options.first;
  const rest = coinsFor(local, coins.filter((coin) => first === undefined || hex(coin.transactionHash) !== hex(first.transactionHash) || coin.index !== first.index), paying);
  const inputs = first === undefined ? rest : first.output.valueSatoshis >= paying + 2_000n ? [first] : [first, ...rest];
  const built = buildTransaction({ inputs: [...inputs, ...(options.extraInputs ?? [])].map((coin) => p2pkhInput(coin, funder)), outputs, changeLockingBytecode: funderLocking, allowTokenBurn: options.burn === true });
  const check = checkBeforeSending(built);
  if (check !== true) throw new Error(`a payment of the funder fails the check before sending: ${check}`);
  facts.pending = { ...facts.pending, [step]: { transactionId: built.transactionId, hex: hex(built.encoded) } };
  keep();
  const result = await server.broadcast(hex(built.encoded));
  if (!result.accepted && !/already/i.test(result.reason)) {
    facts.pending = Object.fromEntries(Object.entries(facts.pending).filter(([name]) => name !== step));
    keep();
    throw new Error(`a payment of the funder was refused: ${result.reason}`);
  }
  await until('the funder\'s payment at the server', async () => (await server.getTransaction(built.transactionId)) !== undefined);
  await wait(local ? 1_200 : 2_000);
  return built.transactionId;
};

const decoded = async (transactionId: string) => {
  const read = decodeTransactionBch(hexToBin((await until(`the transaction ${transactionId.slice(0, 12)}…`, async () => server.getTransaction(transactionId))) as string));
  if (typeof read === 'string') throw new Error(read);
  return read;
};
/** What a transaction paid in fees, from its own inputs and outputs as the server gives them. */
const sentAs = async (transactionId: string): Promise<{ transactionId: string; bytes: number; feeSatoshis: bigint }> => {
  const transaction = await decoded(transactionId);
  let spent = 0n;
  for (const input of transaction.inputs) spent += (await decoded(hex(input.outpointTransactionHash))).outputs[input.outpointIndex]?.valueSatoshis ?? 0n;
  const paid = transaction.outputs.reduce((sum, output) => sum + output.valueSatoshis, 0n);
  return { transactionId, bytes: ((await server.getTransaction(transactionId)) as string).length / 2, feeSatoshis: spent - paid };
};
/** Inputs and outputs in a line: what the record says of a transaction's shape. */
const shapeOf = async (transactionId: string): Promise<string> => {
  const transaction = await decoded(transactionId);
  return `${transaction.inputs.length} input(s), ${transaction.outputs.length} output(s): ${transaction.outputs.map((output) => `${output.valueSatoshis}${output.lockingBytecode[0] === 0x6a ? ' (OP_RETURN)' : ''}${output.token === undefined ? '' : ` with ${output.token.amount} tokens`}`).join(', ')}`;
};
/** The application's coin a transaction made: the output of the value asked for at a script that is not a key's. */
const coinOf = async (transactionId: string, satoshis: number): Promise<string> => {
  const transaction = await decoded(transactionId);
  const index = transaction.outputs.findIndex((output) => output.valueSatoshis === BigInt(satoshis) && !(output.lockingBytecode[0] === 0x76 && output.lockingBytecode[1] === 0xa9));
  if (index < 0) throw new Error(`no output of ${satoshis} satoshis at a contract in ${transactionId}`);
  return `${transactionId}:${index}`;
};

const openAccount = async (words: string, who: string): Promise<Account> =>
  Account.open(await Engine.create(words, { network: XO_SUPPORTED_NETWORKS.chipnet, electrumServers: await engineServers(local) }), { onSent: writeInvitationFiles(invitations, who) });
let account: Account | undefined;

/** A backup store kept as a directory of the run: sealed blobs under their own names, as a store server keeps them. */
const fileStore = (name: string): ArchiveStore => {
  const directory = (archiveId: string): string => {
    const path = `${storeDirectory}/${name}/${archiveId}`;
    mkdirSync(path, { recursive: true });
    return path;
  };
  return {
    name,
    put: async (archiveId, sealed) => {
      const blobId = blobIdOf(sealed);
      writeFileSync(`${directory(archiveId)}/${blobId}`, sealed);
      return blobId;
    },
    list: async (archiveId) => readdirSync(directory(archiveId)),
    get: async (archiveId, blobId) => (existsSync(`${directory(archiveId)}/${blobId}`) ? new Uint8Array(readFileSync(`${directory(archiveId)}/${blobId}`)) : undefined),
  };
};
const STORES = ['store-1', 'store-2'];
const stores = new Map(STORES.map((name) => [name, fileStore(name)]));
const storeAt = (name: string): ArchiveStore => stores.get(name) as ArchiveStore;

/** A template's text as XO Grid served it, from the run's folder once taken. */
const templateText = (name: TemplateName): string => readFileSync(`${templateDirectory}/${TEMPLATES[name]}.json`, 'utf8');
const namesOf = (name: TemplateName): { identifier: string; contentHash: string } => {
  const read = facts.templates?.read[name];
  if (read === undefined) throw new Error(`the template ${name} was not taken in`);
  return { identifier: read.identifier, contentHash: read.contentHash };
};
/** A request as an application's page makes it. */
const request = (name: TemplateName, action: string, role: string, variables: Record<string, string | number>, inputs?: Record<string, string>): ApplicationAction => ({
  template: namesOf(name),
  presented: { template: templateText(name) },
  action,
  role,
  variables,
  application: 'xo-grid-run',
  ...(inputs === undefined ? {} : { inputs }),
});
const figuresOf = (preview: ActionPreview): string => {
  const { figures } = preview;
  return `gives ${figures.givesSatoshis}, gets ${figures.getsSatoshis}, fee ${figures.feeSatoshis}${figures.feeFromApplicationSatoshis === undefined ? '' : ` (of it ${figures.feeFromApplicationSatoshis} from the application's coin)`}, into the application ${figures.intoApplicationSatoshis}, from the application ${figures.fromApplication.satoshis} in ${figures.fromApplication.coins} coin(s)${preview.tokensLeaving === undefined || preview.tokensLeaving.length === 0 ? '' : `; tokens leaving: ${preview.tokensLeaving.map((leaving) => `${leaving.token.amount ?? 'an NFT'} ${leaving.how}`).join(', ')}`}`;
};

// ------------------------------------------------------------------ the parts

try {
  say(phase);
  account = await openAccount(facts.words.owner, "the owner's device");
  const wallet = await OwnerWallet.open({ backend: account, chain, seed: ownerSeed, ...(facts.ownerState === undefined ? {} : { state: facts.ownerState }), save: (state) => { facts.ownerState = state; keep(); } });

  if (phase === 'the wallet is set up') {
    if (local) {
      await once('the funder gets a block reward', async () => {
        await mine(1, hex(funderLocking));
        await mine(100, BURN);
        return undefined;
      });
    }
    if (facts.funderAtStart === undefined) {
      const coins = await until('the funder\'s coins', async () => { const found = await funderCoins(); return found.length > 0 ? found : undefined; });
      facts.funderAtStart = String(coins.reduce((sum, coin) => sum + coin.output.valueSatoshis, 0n));
      keep();
      if (!local && BigInt(facts.funderAtStart) < CHIPNET_NEEDS) throw new Error(`The funding address holds ${facts.funderAtStart} satoshis; the run needs ${CHIPNET_NEEDS}. Nothing was paid.`);
    }
    // The templates, from XO Grid, before anything is paid: a template that cannot be had stops the run here.
    await once('the templates are taken from XO Grid', async () => {
      mkdirSync(templateDirectory, { recursive: true });
      const read: Record<string, { name: string; identifier: string; contentHash: string }> = {};
      for (const [name, identifier] of Object.entries(TEMPLATES)) {
        const response = await fetch(`${XO_GRID}/api/templates/${identifier}/raw`);
        if (!response.ok) throw new Error(`XO Grid answered ${response.status} for the template ${identifier}`);
        const text = await response.text();
        const template = readTemplate(text);
        if (template.identifier !== identifier) throw new Error(`XO Grid served a template of identifier ${template.identifier} for ${identifier}`);
        writeFileSync(`${templateDirectory}/${identifier}.json`, text);
        read[name] = { name: template.definition.name, identifier, contentHash: template.contentHash };
      }
      facts.templates = { fetchedAt: new Date().toISOString(), read };
      keep();
      note(`The five templates' texts were taken from XO Grid at ${facts.templates.fetchedAt}; the wallet's reader found each to have the identifier asked for: ${Object.values(read).map((entry) => `"${entry.name}"`).join(', ')}.`);
      return undefined;
    });
    const funding = await wallet.fundingAddress();
    await once('the wallet is funded', async () => {
      const transactionId = await funderPays('the wallet is funded', [{ lockingBytecode: funding, valueSatoshis: WALLET_FUNDING }]);
      record('fund the wallet', await sentAs(transactionId), `the funder pays ${WALLET_FUNDING} satoshis to the wallet's funding address`);
      return { transactionIds: [transactionId] };
    });
    if ((await wallet.creationStep()) !== 'created') {
      await until('the funding coin in the engine', async () => (await wallet.creationStep()) !== 'not funded');
      await wallet.create({ recovererKeyHash: credential.recoveryKey.keyHash, challengeDelay: { unit: 'time512', value: 1 } });
    }
    facts.identity = wallet.stored.identity as string;
    keep();
    for (const [step, transactionId, about] of [
      ['prepare', wallet.stored.creation.prepareTransactionId, 'the wallet pays itself, to have a coin that is output 0; this transaction is the identity'],
      ['create', wallet.stored.creation.createTransactionId, 'the controller and the rest'],
    ] as const) {
      if (transactionId === undefined) continue;
      record(step, await sentAs(transactionId), about);
    }
    await block();
    // The test tokens: a new fungible category, made by the funder from a coin that is output 0 of its transaction,
    // and paid to an address the wallet gave out.
    const given = await once('an address is given out', async () => ({ data: { number: (await wallet.receiveAddress()).address.number } }));
    const seedCoin = await once('a coin for a new token category', async () => {
      const transactionId = await funderPays('a coin for a new token category', [{ lockingBytecode: funderLocking, valueSatoshis: 3_000n }]);
      record('a coin for the test tokens', await sentAs(transactionId), 'the funder pays itself a coin that is output 0 of its transaction, to make a token category from');
      return { transactionIds: [transactionId], data: { transactionId } };
    });
    await once('the test tokens are made and paid to the wallet', async () => {
      const category = seedCoin['transactionId'] as string;
      facts.category = category;
      keep();
      const first: Utxo = { transactionHash: hexToBin(category), index: 0, output: { lockingBytecode: funderLocking, valueSatoshis: 3_000n } };
      const transactionId = await funderPays('the test tokens are made and paid to the wallet', [{ lockingBytecode: wallet.address(0, given['number'] as number).lockingBytecode, valueSatoshis: TOKEN_COIN, token: { amount: TOKEN_SUPPLY, category: hexToBin(category) } }], { first });
      record('make the test tokens', await sentAs(transactionId), `the funder makes ${TOKEN_SUPPLY} fungible tokens of a new category and pays them, with ${TOKEN_COIN} satoshis, to an address the wallet gave out`);
      return { transactionIds: [transactionId] };
    });
    await block();
    await until('the test tokens in the wallet', async () => (await wallet.balance()).tokens.some((coin) => coin.utxo.output.token !== undefined && hex(coin.utxo.output.token.category) === facts.category));

    if (facts.arrangement === undefined) {
      facts.arrangement = { archive: newArchive(STORES), earlierArchives: [], earlierViewingKeyRecords: [] };
      keep();
    }
    const applications = new Applications(wallet.parts, { archive: applicationArchive({ arrangement: () => facts.arrangement, storeAt, seed: ownerSeed, identity: hexToBin(facts.identity as string), chain }) });
    // Each template as a person adds a file: read, shown, trusted on the user's word, and stored in the backup.
    for (const name of Object.keys(TEMPLATES) as TemplateName[]) {
      await once(`the wallet takes in ${name}`, async () => {
        const file = applications.readTemplateFile(templateText(name));
        if (file.kind === 'trusted') return undefined;
        const kept = await applications.trustFile(file);
        note(`The wallet read "${kept.name}" from its file as "${file.kind}" and trusted it on the user's word; stored in the backup: ${kept.stored ? 'yes' : 'not yet'}.`);
        return undefined;
      });
    }
  }

  if (phase === 'the templates are used') {
    const applications = new Applications(wallet.parts, { archive: applicationArchive({ arrangement: () => facts.arrangement, storeAt, seed: ownerSeed, identity: hexToBin(facts.identity as string), chain }) });
    const category = facts.category as string;
    const carryOut = async (step: string, asked: ApplicationAction, about: string, satoshis?: number): Promise<{ transactionIds: string[]; data?: Record<string, string> }> => {
      // A part that ended while carrying an action out may have sent it: the run does not carry it out a second time.
      if (facts.carrying === step) throw new Error(`a part ended while carrying out "${step}", which may have been sent; look at the wallet's transactions and write the step down before continuing`);
      const preview = await applications.preview(asked);
      note(`${step}: the wallet's review ${figuresOf(preview)}.`);
      facts.carrying = step;
      keep();
      let outcome: Awaited<ReturnType<Applications['carryOut']>>;
      try {
        outcome = await applications.carryOut(asked, undefined, { tokensLeave: true });
      } catch (error) {
        // Refused by the network: nothing was sent.
        if (/non-?BIP68-final|rejected by network rules/i.test(String((error as Error).message))) {
          delete facts.carrying;
          keep();
        }
        throw error;
      }
      delete facts.carrying;
      keep();
      record(step, await sentAs(outcome.transactionId), `${about}; ${await shapeOf(outcome.transactionId)}`);
      if (satoshis !== undefined) {
        facts.coins[step] = await coinOf(outcome.transactionId, satoshis);
        keep();
      }
      return { transactionIds: [outcome.transactionId] };
    };

    // Drip Mine first, from the wallet's own list: its coin must be a block old (on chipnet ten chain blocks) before
    // the drip, and the other templates are used meanwhile.
    await once('Drip Mine: fund', async () => {
      const offered = await applications.templateActions(TEMPLATES.dripMine);
      note(`Drip Mine, from the wallet's own list of the template's actions: ${JSON.stringify(offered?.starting.map(({ action, role, needsApplication }) => ({ action, role, ...(needsApplication === undefined ? {} : { needsApplication }) })))}, the role names ${JSON.stringify(offered?.roleNames ?? null)}, no settled role (${offered?.role ?? 'none'}).`);
      if (offered?.starting.some((entry) => entry.action === 'fund' && entry.role === 'funder') !== true) throw new Error('the wallet does not offer Drip Mine\'s "fund" under the funder role');
      return carryOut('Drip Mine: fund', applications.startAction(TEMPLATES.dripMine, 'fund', { fundSatoshis: AMOUNTS.drip }, 'funder'), `from the wallet's own list, as the funder role (change 1): ${AMOUNTS.drip} satoshis into the Drip Mine, never to come back by design`, AMOUNTS.drip);
    });
    const dripFunded = facts.steps['Drip Mine: fund']?.transactionIds[0] as string;
    await block();

    // Revenue Split: the three shares go to the funding address's key hash, so that they return to the funder.
    const shares = { splitSatoshis: AMOUNTS.split, artistPublicKeyHash: hex(funder.keyHash), collaboratorPublicKeyHash: hex(funder.keyHash), platformPublicKeyHash: hex(funder.keyHash), artistBasisPoints: 5000, collaboratorBasisPoints: 3000 };
    await once('Revenue Split: fundSplit', async () => carryOut('Revenue Split: fundSplit', request('revenueSplit', 'fundSplit', 'payer', shares), `as the payer: ${AMOUNTS.split} satoshis into the split`, AMOUNTS.split));
    await once('Revenue Split: payout', async () => {
      await confirmed(facts.coins['Revenue Split: fundSplit']?.split(':')[0] as string);
      return carryOut('Revenue Split: payout', request('revenueSplit', 'payout', 'trigger', shares, { splitInput: facts.coins['Revenue Split: fundSplit'] as string }), 'as the trigger, the coin by outpoint: the three shares to the funding address, the wallet pays the fee');
    });

    // Claim-Code Voucher: the claim gives the code and the hash the coin's script holds in its state.
    const code = hex(utf8ToBin(`a claim code of the run started ${facts.startedAt}`));
    const codeHash = hex(sha256.hash(hexToBin(code)));
    await once('Claim-Code Voucher: createVoucher', async () => carryOut('Claim-Code Voucher: createVoucher', request('voucher', 'createVoucher', 'issuer', { voucherSatoshis: AMOUNTS.voucher, codeHash }), `as the issuer: ${AMOUNTS.voucher} satoshis locked to the hash of a code`, AMOUNTS.voucher));
    await once('Claim-Code Voucher: claimVoucher', async () => {
      await confirmed(facts.coins['Claim-Code Voucher: createVoucher']?.split(':')[0] as string);
      return carryOut('Claim-Code Voucher: claimVoucher', request('voucher', 'claimVoucher', 'claimer', { claimCode: code, codeHash }, { voucherInput: facts.coins['Claim-Code Voucher: createVoucher'] as string }), 'as the claimer, the coin by outpoint, with the code and the hash its script holds (change 4): the voucher\'s value back to the wallet');
    });

    // Token Burner with satoshis: the burn has one input and one OP_RETURN output, the coin's satoshis all fee.
    await once('Token Burner: depositSatoshis', async () => carryOut('Token Burner: depositSatoshis', request('tokenBurner', 'depositSatoshis', 'depositor', { depositSatoshis: AMOUNTS.burnSatoshis }), `as the depositor: ${AMOUNTS.burnSatoshis} satoshis to the burner`, AMOUNTS.burnSatoshis));
    await once('Token Burner: burn satoshis', async () => {
      await confirmed(facts.coins['Token Burner: depositSatoshis']?.split(':')[0] as string);
      return carryOut('Token Burner: burn satoshis', request('tokenBurner', 'burn', 'burner', { burnMessage: 'goodbye from a test run' }, { burnerInput: facts.coins['Token Burner: depositSatoshis'] as string }), 'as the burner, the coin by outpoint (change 3): the coin\'s satoshis to the fee, no change output');
    });

    // Fungible tokens the wallet holds, by the category the request gives.
    await once('Token Burner: depositFungibleTokens', async () => carryOut('Token Burner: depositFungibleTokens', request('tokenBurner', 'depositFungibleTokens', 'depositor', { tokenCategory: category, tokenAmount: AMOUNTS.burnTokens, depositSatoshis: AMOUNTS.burnTokenSatoshis }), `as the depositor, the category the request gives (change 2): ${AMOUNTS.burnTokens} of the wallet's test tokens with ${AMOUNTS.burnTokenSatoshis} satoshis to the burner, the rest back to the wallet`, AMOUNTS.burnTokenSatoshis));
    await once('Token Burner: burn tokens', async () => {
      await confirmed(facts.coins['Token Burner: depositFungibleTokens']?.split(':')[0] as string);
      return carryOut('Token Burner: burn tokens', request('tokenBurner', 'burn', 'burner', { burnMessage: 'goodbye from a test run' }, { burnerInput: facts.coins['Token Burner: depositFungibleTokens'] as string }), `as the burner, the coin by outpoint (changes 2 and 3): ${AMOUNTS.burnTokens} tokens destroyed, the coin's satoshis to the fee`);
    });
    await block();
    await once('Block Points: fundThread', async () => carryOut('Block Points: fundThread', request('blockPoints', 'fundThread', 'funder', { tokenCategory: category, threadTokenAmount: AMOUNTS.threadTokens, threadSatoshis: AMOUNTS.threadSatoshis }), `as the funder, the category the request gives (change 2): ${AMOUNTS.threadTokens} test tokens with ${AMOUNTS.threadSatoshis} satoshis into the shared vault, where they stay by design`));
    await block();

    // Back to the Drip Mine: its coin must be a block old by its contract's relative lock.
    await once('Drip Mine: drip', async () => {
      const count = await confirmed(dripFunded);
      const height = (await server.tip()).height - count + 1;
      const from = Date.now();
      // The lock counts chain blocks after the coin's own; on chipnet's one-minute blocks, about a minute each.
      await until(
        `the Drip Mine coin's lock: ${DRIP_BLOCKS} chain block(s) after its block ${height}, about until ${new Date(Date.now() + Math.max(0, DRIP_BLOCKS - count) * 60_000).toISOString().slice(11, 16)} UTC`,
        async () => {
          if (((await server.confirmations(dripFunded)) ?? 0) >= DRIP_BLOCKS) return true;
          if (local) await mine(1, BURN);
          return false;
        },
        local ? 60_000 : 20 * 60_000,
        local ? 500 : 15_000,
      );
      const waited = Math.round((Date.now() - from) / 60_000);
      const asked = request('dripMine', 'drip', 'dripper', { dripCoinSatoshis: AMOUNTS.drip }, { dripMineInput: facts.coins['Drip Mine: fund'] as string });
      // Should the network still count the lock as not passed, it is asked again at the next block, for a few minutes.
      const sent = await until(
        'the network to take the drip once the next block has come',
        async () => {
          try {
            return await carryOut('Drip Mine: drip', asked, `as the dripper, the coin by outpoint (change 3): the contract's payout of 164 satoshis is the fee, the rest back to the Drip Mine${local ? '' : `; the run waited ${waited} minute(s) for the coin's lock after the other steps`}`);
          } catch (error) {
            if (/non-?BIP68-final/i.test(String((error as Error).message))) {
              say(`  the network refused the drip as not final yet (${String((error as Error).message).slice(0, 160)}); asked again after the next block`);
              if (local) await mine(1, BURN);
              return undefined;
            }
            throw error;
          }
        },
        local ? 60_000 : 6 * 60_000,
        local ? 500 : 30_000,
      );
      note(`The Drip Mine's coin was funded in block ${height}; the drip was accepted with the tip at ${(await server.tip()).height}.`);
      return sent;
    });
    await block();
  }

  if (phase === 'the wallet is closed') {
    if ((await wallet.closed())) {
      say('  (the wallet is closed: done before)');
    } else {
      await once('the remaining test tokens go to the funder', async () => {
        const holding = await until('the test tokens in the wallet', async () => { const now = await wallet.balance(); const found = now.tokens.filter((coin) => coin.utxo.output.token !== undefined && hex(coin.utxo.output.token.category) === facts.category); return found.length > 0 ? found : undefined; });
        const ids: string[] = [];
        for (const coin of holding) {
          const sent = await wallet.sendToken(coin, funderLocking);
          record('send the test tokens on', sent, `${coin.utxo.output.token?.amount} test tokens, unchanged, to the funding address`);
          ids.push(sent.transactionId);
          await block();
          await wait(1_500);
        }
        return { transactionIds: ids };
      });
      await block();
      await until('the wallet without a token', async () => (await wallet.balance()).tokens.length === 0);
      // The wallet closes only once a full search over its seed has found every coin the controller may move.
      const search = await wallet.search();
      note(`Before closing, the wallet's full search over its seed ended as "${search.status}".`, 'the search');
      await wait(1_500);
      const closing = await wallet.close(funderLocking);
      for (const sent of closing.transactions) record('close', sent, 'everything, and the controller\'s value, back to the funding address');
      await block();
    }
    const history = await until('the closing', async () => { const read = await readControllerHistory(chain, hexToBin(facts.identity as string)); return read.closed === undefined ? undefined : read; });
    note(`The wallet is closed: its controller's history reads closed${history.transitions.length === 0 ? ', with no transition before' : ` after ${history.transitions.map((step) => step.kind).join(', ')}`}.`, 'the closing');
  }

  if (phase === 'the run returns what is left') {
    const category = facts.category as string;
    await once('the funder burns the remaining test tokens', async () => {
      const coins = await until('the test tokens at the funder', async () => { const found = await tokenCoinsOfFunder(category); return found.length > 0 ? found : undefined; });
      const amount = coins.reduce((sum, coin) => sum + (coin.output.token?.amount ?? 0n), 0n);
      const transactionId = await funderPays('the funder burns the remaining test tokens', [], { burn: true, extraInputs: coins });
      record('burn the remaining test tokens', await sentAs(transactionId), `the funder destroys the ${amount} test tokens that came back and keeps their coins' satoshis`);
      return { transactionIds: [transactionId] };
    });
    await block();
    const total = await until('the funder\'s coins', async () => { const coins = await funderCoins(); return coins.length > 0 ? coins.reduce((sum, coin) => sum + coin.output.valueSatoshis, 0n) : undefined; });
    facts.funderAfter = String(total);
    keep();
    const left: string[] = [];
    const funding = (await server.listUnspent(p2pkhLockingBytecode(ownerSeed.fundingKey.keyHash))).reduce((value, entry) => value + entry.valueSatoshis, 0n);
    if (funding > 0n) left.push(`${funding} at the wallet's funding address`);
    const found = (await quickPass(chain, hexToBin(facts.identity as string), ownerSeed.viewingKey)).found.flatMap((address) => address.coins);
    if (found.length > 0) left.push(`${found.length} coins at addresses of the wallet's seed`);
    const lost = BigInt(facts.funderAtStart as string) - total;
    const fees = facts.log.reduce((sum, entry) => sum + BigInt(entry.fee), 0n);
    note(
      `The funding address held ${facts.funderAtStart} satoshis before the run and holds ${total} after it: ${lost} satoshis did not come back${local ? '' : ' (if no other run paid from the same key meanwhile)'}. By design: the Drip Mine's coin (${AMOUNTS.drip} satoshis paid in, its drip's payout the fee and the rest still at the Drip Mine's address, where anyone may drip it to miners), the two burned coins (${AMOUNTS.burnSatoshis + AMOUNTS.burnTokenSatoshis} satoshis, all fee), and the Block Points thread (${AMOUNTS.threadSatoshis} satoshis and ${AMOUNTS.threadTokens} test tokens in the shared vault, for anyone to claim); the fees of the run's transactions in the table add up to ${fees} satoshis, the two burns' and the drip's included. Of the ${TOKEN_SUPPLY} test tokens, ${AMOUNTS.burnTokens} were burned at the Token Burner, ${AMOUNTS.threadTokens} are in the Block Points vault, and the rest came back to the funder, which destroyed them. ${left.length === 0 ? 'Nothing is left at the wallet.' : `LEFT BEHIND: ${left.join('; ')}.`}`,
    );
    if (left.length > 0) throw new Error(`coins were left behind: ${left.join('; ')}`);
  }
  if (!facts.finished.includes(phase)) facts.finished.push(phase);
  keep();
} catch (error) {
  say(`FAILED: ${(error as Error).name}: ${String((error as Error).message).slice(0, 1500)}\n${String((error as Error).stack).split('\n').slice(1, 6).join('\n')}`);
  process.exitCode = STOPPED;
} finally {
  await server.disconnect().catch(() => undefined);
  await account?.close();
  process.exit();
}
