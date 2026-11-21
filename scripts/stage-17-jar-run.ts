// The stage 17 run on the local node for the Savings Jar (acceptance test PR19 of proposal v0.6, on the local node):
// the jar without a recovery declaration, through the loss of a device.
//
// An owner's wallet is created on the XO engine, with a recoverer. The jar's page, its own code (apps/jar/src/xo.ts)
// connected to the wallet's connector for applications over a session in memory, opens a jar with a request of
// version 2: the template of version 4 alone, the date, the amount and the page's address. The wallet works the
// opening out from the template and the request, writes the jar's record to two backup stores before the engine
// signs, and the page lists the jar from the wallet's records and reads its balance from the chain. The device is
// lost. The recoverer requests, waits and completes; a new device takes the wallet over with the project's recovery
// flow, sweeps the jar's key, copies the earlier archive and reads the record from a store. The user trusts the
// template the earlier owner stored; the record is checked against the chain, written again as the new owner's
// own, and its script handed to the engine with the record's values. The new device empties the jar by itself, from
// its own list of positions: no page, no session, no request. At the end the wallet is closed and every coin is back
// at the address that paid for the run.
//
// No recovery declaration is read anywhere: none is sent, stored or kept, and the run checks that.
//
// One script, two chains: the local node (regtest) and chipnet. Only what a chain needs differs, as in run B
// (scripts/run-b.ts): where the first coins come from, how a block comes about, and how the waiting period and the
// jar's date pass. On the local node the run makes its blocks and moves the chain's clock; on chipnet it is paid from
// the saved funding key, never makes a block, waits for one only where a confirmation is needed, and lets the
// waiting period and the jar's date pass on the chain's own clock.
//
// Each part is a process of its own with an empty engine state, as a device session would be. What the run knows
// between parts is in .local-runs/stage-17-jar-local.json (on chipnet .chipnet/stage-17-jar-chipnet.json); the
// stores are directories beside it. Every step is written to that file once it is carried out. A run that stops is
// continued with the same command; `--new` starts again (on chipnet only once the earlier run has finished, and its
// file is kept under another name).
//
// usage (from packages/app):
//   npx tsx ../../scripts/stage-17-jar-run.ts [local]       with the local node running (deploy/regtest/regtest.sh)
//   npx tsx ../../scripts/stage-17-jar-run.ts chipnet       paid from the key in .chipnet/funder-design-2.json
//   npx tsx ../../scripts/stage-17-jar-run.ts chipnet --dry reads chipnet and says what a run would need; sends nothing
// The log is written to docs/runs/stage-17-jar-local-node.md (on chipnet docs/runs/stage-17-jar-chipnet.md, with the
// invitations in docs/runs/invitations/stage-17-jar-chipnet/).
import 'fake-indexeddb/auto';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { type Output, binToHex, decodeTransactionBch, generateBip39Mnemonic, hexToBin } from '@bitauth/libauth';
import { type ArchiveStore, type PositionRecordEntry, blobIdOf } from '@grandmas-wallet/archive';
import { type ChainReader, type KeyPair, type Utxo, buildTransaction, checkBeforeSending, deriveCredentialKeys, deriveSeedKeys, keyPairFromPrivateKey, p2pkhInput, p2pkhLockingBytecode, readControllerHistory, readTemplate } from '@grandmas-wallet/core';
import { Engine, XO_SUPPORTED_NETWORKS } from '@xo-cash/engine';

import { Electrum } from '../packages/chipnet/src/electrum.js';
import { invitationDirectory, invitationFiles, writeInvitationFiles } from './invitation-files.js';
import { chipnetFunder, coinsFor, electrumEndpoint, engineServers, iso, medianTime as medianTimeAt, runArguments, startOver } from './stage-17-chain.js';
import {
  type OwnerWalletState,
  type RecordedPosition,
  type RecoveryArrangement,
  Account,
  Applications,
  OwnerWallet,
  RecovererFunds,
  RecovererWallet,
  actionSent,
  applicationArchive,
  checkPositionRecord,
  copyEarlierArchives,
  newArchive,
  recoveryFees,
  walletTemplateNumbers,
} from '../packages/app/src/index.js';
// The application's own definitions and its page's code. The wallet's code has none of them: the template reaches it
// as a text, in the page's requests.
import { savingsJarScript, savingsJarV4TemplateText } from '../packages/savings-jar/src/index.js';
import { JAR_TEMPLATE } from '../apps/jar/src/jar.js';
import { XoJars, memoryStore } from '../apps/jar/src/xo.js';
import { pageLink } from './stage-17-page-link.js';
// @ts-expect-error a plain script: the engine's settings for the local chain, and the node's RPC
import { rpc, mine, BURN } from '../spikes/xo-engine/regtest.mjs';

const hex = binToHex;
const root = fileURLToPath(new URL('..', import.meta.url));
/** The exit code of a part that stopped at a step of its own and said why. */
const STOPPED = 3;
const PHASES = ['the owner opens a jar', 'the recoverer recovers', 'the new device empties the jar from its record', 'the recoverer returns its balance', 'the run returns what is left'];
const { chainName, local, phase, dry, fresh } = runArguments(PHASES, 'stage-17-jar-run.ts');
const runDirectory = local ? `${root}.local-runs` : `${root}.chipnet`;
mkdirSync(runDirectory, { recursive: true });
const stateFile = `${runDirectory}/stage-17-jar-${local ? 'local' : 'chipnet'}.json`;
const storeDirectory = `${runDirectory}/stage-17-jar-${local ? '' : 'chipnet-'}stores`;
/** The XO invitation behind every transaction an account of the run sends, a file each (scripts/invitation-files.ts). */
const invitations = local ? `${runDirectory}/invitations/stage-17-jar/` : invitationDirectory('stage-17-jar-chipnet', false);
const logFile = `${root}docs/runs/stage-17-jar-${local ? 'local-node' : 'chipnet'}.md`;
/** Where the page says it is served from; the run has no web server, and the address is only kept in the record. */
const PAGE = 'https://jar.example/';
/** What the run pays out at most at one time on chipnet: the wallet's funding, the payment to it, and the fees. */
const CHIPNET_NEEDS = 200_000n;
/**
 * How far ahead the jar's date is set, in seconds: on the local chain of its last block's time, as before; on chipnet
 * of this machine's clock (or of the last block's, if that is ahead), the soonest that is still ahead when the jar is
 * opened. The chain's clock trails the blocks by about six of them, and the recovery after the opening takes ten
 * minutes or more, so on chipnet the date has passed, or nearly, by the time the new device empties the jar.
 */
const JAR_DATE_AHEAD = local ? 300 : 60;

interface Entry { step: string; transactionId: string; bytes: number; fee: string; note: string }
interface Facts {
  startedAt: string;
  words: { owner: string; next: string; credential: string };
  localFunder?: string;
  identity?: string;
  ownerState?: OwnerWalletState;
  newState?: OwnerWalletState;
  ownerArrangement?: RecoveryArrangement;
  newArrangement?: RecoveryArrangement;
  jar?: { unlockTime: number; category?: string };
  record?: PositionRecordEntry;
  steps: Record<string, { transactionIds: string[]; data?: Record<string, number | string> }>;
  /** A payment of the funder, written down before it is sent, by the step it belongs to. */
  pending?: Record<string, { transactionId: string; hex: string }>;
  finished: string[];
  held?: string;
  funderAtStart?: string;
  log: Entry[];
  notes: string[];
}

// ------------------------------------------------------------------ the driver: one process for each part

if (phase === undefined && dry) {
  // A look at chipnet before a run: what the funding key holds, the chain's clock, the date the jar would get, and
  // what the run would pay out. Nothing is written and nothing is sent.
  const server = await Electrum.connect(electrumEndpoint(false));
  try {
    const funderLocking = p2pkhLockingBytecode(chipnetFunder().keyHash);
    const coins = await server.listUnspent(funderLocking, 'exclude');
    const tokens = await server.listUnspent(funderLocking, 'only');
    const balance = coins.reduce((sum, coin) => sum + coin.valueSatoshis, 0n);
    const tip = await server.tip();
    const median = await medianTimeAt(server, tip.height);
    const now = Math.floor(Date.now() / 1000);
    const date = Math.max(now, tip.time) + JAR_DATE_AHEAD;
    const servers = await engineServers(false);
    console.log(`chipnet at ${electrumEndpoint(false)}: tip ${tip.height}, its time ${iso(tip.time)}, the chain's clock (median of eleven) ${iso(median)}, ${now - median} s behind this machine's.`);
    console.log(`The engine would be given ${servers.length} server: ${servers.map((entry) => `${entry.host} ${JSON.stringify(entry.transports)}`).join(', ')}.`);
    console.log(`The funding key holds ${balance} satoshis in ${coins.length} coins without tokens, and ${tokens.length} coins with tokens (left alone by the run).`);
    console.log(`The run pays out at most about ${CHIPNET_NEEDS} satoshis at a time (80,000 to the wallet's funding address, 60,000 to an address it gives out, the fees); everything but the network fees comes back. ${balance >= CHIPNET_NEEDS ? 'The key holds enough.' : 'The key holds TOO LITTLE.'}`);
    console.log(`A run started now would give the jar the date ${iso(date)}. The network accepts emptying it once the chain's clock has passed that date, about ${iso(date + (now - median) + 60)} by this machine's if the chain's clock keeps trailing by ${now - median} s; the emptying comes after the recovery, ten minutes or more after the opening, so a wait for the date of a few minutes at most is expected.`);
    console.log(existsSync(stateFile) ? `A run is under way: ${stateFile.slice(root.length)} (finished: ${(JSON.parse(readFileSync(stateFile, 'utf8')) as Facts).finished.join(', ') || 'nothing yet'}). The same command without --dry continues it.` : `No run is under way; ${stateFile.slice(root.length)} does not exist.`);
  } finally {
    await server.disconnect().catch(() => undefined);
  }
  process.exit(0);
}

if (phase === undefined) {
  if (fresh) startOver(local, stateFile, storeDirectory, PHASES);
  if (!existsSync(stateFile)) rmSync(invitations, { recursive: true, force: true });
  if (local && !existsSync(stateFile) && Number(execFileSync(`${root}deploy/regtest/regtest.sh`, ['cli', 'getblockcount'], { encoding: 'utf8' })) > 1500) {
    console.error('The local chain is long and its block rewards are small. Start a new one: deploy/regtest/regtest.sh reset');
    process.exit(1);
  }
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
    if (found === undefined) return '';
    // On chipnet the files are kept in git beside the record, and the table links each.
    return local ? `${found.action} (${found.templateName})` : `[${found.action}](invitations/stage-17-jar-chipnet/${found.file})`;
  };
  const revision = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const changed = execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).split('\n').filter((line) => line.trim() !== '' && !line.includes('docs/runs/') && !line.includes('.chipnet'));
  writeFileSync(
    logFile,
    [
      `# Stage 17 run on ${local ? 'the local node' : 'chipnet'}: the Savings Jar without a declaration, through the loss of a device (PR19)`,
      '',
      `Written by the run itself (\`scripts/stage-17-jar-run.ts${local ? '' : ' chipnet'}\`). The owner's wallet, the recoverer and the new device, each on the unmodified XO engine, ${local ? 'against the local node in regtest mode with the public networks\' relay rules' : 'on chipnet, paid from the funding address and with everything returned to it at the end; no block was made by the run, and the waiting period and the jar\'s date passed on the chain\'s own clock'}. Each part ran in a process of its own with an empty engine state. The Savings Jar reached the wallet as its template of version 4 alone, as a text, in the requests of the jar's page: the page's own code (\`apps/jar/src/xo.ts\`), connected to the wallet's connector for applications over a session in memory, every message through JSON and back as it travels; only the relay was left out. Every transaction of the jar is an invitation of that template, built and signed by the engine, and was compared with what the wallet's own code had worked out before it was sent. The backup stores are two directories of the run, read and written as a store server's are. No recovery declaration was sent, stored, kept or read anywhere in the run.`,
      '',
      `- Wallet identity: \`${facts.identity}\``,
      `- Jar key (token category): \`${facts.jar?.category}\`; the jar's date: ${new Date((facts.jar?.unlockTime ?? 0) * 1000).toISOString()}`,
      `- Template "Savings Jar", version 4, \`${readTemplate(savingsJarV4TemplateText).identifier}\`, with no declaration`,
      `- The page's address in its requests: ${PAGE}`,
      `- Repository at commit \`${revision}\`${changed.length === 0 ? '' : `, with uncommitted changes to ${changed.map((line) => line.slice(3)).join(', ')}`}`,
      `- Started ${facts.startedAt}`,
      ...(local
        ? []
        : [
            `- The XO invitation behind each transaction an account of the run sent, as the engine serializes it for sharing: \`${invitations.slice(root.length)}\`, with \`index.json\` naming the template, action and role of each.`,
            '- The engine ran as published, with no local change, given one server (chipnet.9500.cash), as in run B.',
          ]),
      '',
      'The position record the earlier device wrote before the opening was signed, as the new device read it from a store:',
      '',
      '```json',
      JSON.stringify(facts.record ?? null, null, 1),
      '```',
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
  console.log(`Run complete. Log written to ${logFile.slice(root.length)}`);
  process.exit(0);
}

// ------------------------------------------------------------------ what every part shares

const facts: Facts = existsSync(stateFile)
  ? (JSON.parse(readFileSync(stateFile, 'utf8')) as Facts)
  : { startedAt: new Date().toISOString(), words: { owner: generateBip39Mnemonic(), next: generateBip39Mnemonic(), credential: generateBip39Mnemonic() }, steps: {}, finished: [], log: [], notes: [] };
const keep = (): void => writeFileSync(stateFile, JSON.stringify(facts, (_key, value: unknown) => (typeof value === 'bigint' ? String(value) : value), 1), { mode: 0o600 });
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
/**
 * How long the run waits for a server or the engine to list what was just sent. On chipnet a confirmation is waited
 * for longer (`BLOCK_PATIENCE_MS`), and the waiting period and the jar's date as long as the chain's clock needs.
 */
const PATIENCE_MS = local ? 60_000 : 5 * 60_000;
const BLOCK_PATIENCE_MS = local ? 60_000 : 20 * 60_000;
/** A wait, always bounded: one that runs out stops the part, saying what it waited for; the same command continues. */
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
const RECOVERER_COINS = 5_000n;
const ownerSeed = deriveSeedKeys(facts.words.owner, 'testnet', numbers);
const newSeed = deriveSeedKeys(facts.words.next, 'testnet', numbers);

const server = await Electrum.connect(electrumEndpoint(local));
/** The chain as the wallet reads it, with every lookup counted. */
const lookups = { history: 0, transactions: 0, unspent: 0 };
const chain: ChainReader = {
  getHistory: (lockingBytecode) => ((lookups.history += 1), server.getHistory(lockingBytecode)),
  getTransaction: (transactionId) => ((lookups.transactions += 1), server.getTransaction(transactionId)),
  listUnspent: async (lockingBytecode) => ((lookups.unspent += 1), (await server.listUnspent(lockingBytecode)).map((entry) => ({ ...entry, hasToken: entry.token !== undefined }))),
};
const counted = async <T>(work: () => Promise<T>): Promise<{ result: T; history: number; transactions: number; unspent: number }> => {
  const before = { ...lookups };
  const result = await work();
  return { result, history: lookups.history - before.history, transactions: lookups.transactions - before.transactions, unspent: lookups.unspent - before.unspent };
};

// The key that pays for the run and gets everything back: on the local chain one of the run's own, paid by a block
// reward; on chipnet the saved funding key.
if (local && facts.localFunder === undefined) {
  facts.localFunder = hex(crypto.getRandomValues(new Uint8Array(32)));
  keep();
}
const funder: KeyPair = local ? keyPairFromPrivateKey(hexToBin(facts.localFunder as string)) : chipnetFunder();
const funderLocking = p2pkhLockingBytecode(funder.keyHash);
/** A block: made on demand on the local chain; on chipnet none is made, and one is awaited only where a confirmation is needed. */
const block = async (): Promise<void> => {
  if (local) await mine(1, BURN);
};
const confirmed = async (transactionId: string): Promise<void> => {
  if (local) await mine(1, BURN);
  await until(`the first confirmation of ${transactionId.slice(0, 12)}…`, async () => ((await server.confirmations(transactionId)) ?? 0) > 0, BLOCK_PATIENCE_MS, local ? 500 : 10_000);
};
const funderCoins = async (): Promise<Utxo[]> =>
  (await server.listUnspent(funderLocking, 'exclude')).map((entry) => ({ transactionHash: hexToBin(entry.transactionId), index: entry.index, output: { lockingBytecode: funderLocking, valueSatoshis: entry.valueSatoshis } }));
/**
 * A payment of the funder, with its change back to the funder. It is written to the run's file under the step's name
 * before it is sent, so that a part that stops right after sending it finds it there and does not pay again.
 */
const funderPays = async (step: string, outputs: Output[], options: { burn?: boolean; extraInputs?: Utxo[] } = {}): Promise<string> => {
  const pending = facts.pending?.[step];
  if (pending !== undefined) {
    if ((await server.getTransaction(pending.transactionId)) === undefined) {
      const again = await server.broadcast(pending.hex);
      if (!again.accepted && !/already/i.test(again.reason)) throw new Error(`the funder's payment for "${step}", written down before it was sent, is not on the chain and was refused when sent again (${again.reason}); look at ${pending.transactionId} before continuing`);
    }
    return pending.transactionId;
  }
  for (let attempt = 1; ; attempt += 1) {
    const coins = await until('the funder\'s coins', async () => { const found = await funderCoins(); return found.length > 0 ? found : undefined; });
    const chosen = coinsFor(local, coins, outputs.reduce((sum, output) => sum + output.valueSatoshis, 0n));
    const built = buildTransaction({ inputs: [...chosen, ...(options.extraInputs ?? [])].map((coin) => p2pkhInput(coin, funder)), outputs, changeLockingBytecode: funderLocking, allowTokenBurn: options.burn === true });
    const check = checkBeforeSending(built);
    if (check !== true) throw new Error(`a payment of the funder fails the check before sending: ${check}`);
    facts.pending = { ...facts.pending, [step]: { transactionId: built.transactionId, hex: hex(built.encoded) } };
    keep();
    const result = await server.broadcast(hex(built.encoded));
    if (!result.accepted && !/already/i.test(result.reason)) {
      // Refused: it was not sent, and is no longer pending.
      facts.pending = Object.fromEntries(Object.entries(facts.pending).filter(([name]) => name !== step));
      keep();
      // On chipnet another run may pay from the same key: a coin spent meanwhile is a reason to build the payment again.
      if (!local && /missing|spent|conflict/i.test(result.reason) && attempt < 4) {
        say(`  a payment of the funder was refused ("${result.reason.slice(0, 80)}"); building it again`);
        await wait(5_000);
        continue;
      }
      throw new Error(`a payment of the funder was refused: ${result.reason}`);
    }
    await until('the funder\'s change', async () => (await server.getTransaction(built.transactionId)) !== undefined);
    await wait(local ? 1_200 : 2_000);
    return built.transactionId;
  }
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

const jarNames = JAR_TEMPLATE.names;
/** What a transaction paid in fees, from its own inputs and outputs as the server gives them. */
const sentAs = async (transactionId: string): Promise<{ transactionId: string; bytes: number; feeSatoshis: bigint }> => {
  const read = async (id: string) => {
    const decoded = decodeTransactionBch(hexToBin((await until(`the transaction ${id.slice(0, 12)}…`, async () => server.getTransaction(id))) as string));
    if (typeof decoded === 'string') throw new Error(decoded);
    return decoded;
  };
  const transaction = await read(transactionId);
  let spent = 0n;
  for (const input of transaction.inputs) spent += (await read(hex(input.outpointTransactionHash))).outputs[input.outpointIndex]?.valueSatoshis ?? 0n;
  const paid = transaction.outputs.reduce((sum, output) => sum + output.valueSatoshis, 0n);
  return { transactionId, bytes: ((await server.getTransaction(transactionId)) as string).length / 2, feeSatoshis: spent - paid };
};
/** No declaration anywhere: what the wallet keeps of each template, and what the backup holds. */
const noDeclaration = async (applications: Applications, where: string): Promise<string> => {
  const kept = applications.templates.filter((template) => 'declaration' in template || template.identifier !== jarNames.identifier);
  if (kept.length > 0) throw new Error(`${where} keeps a template with a declaration, or another template`);
  return `${where} keeps ${applications.templates.length} template, the jar's of version 4, with no declaration`;
};
const medianTime = (height: number): Promise<number> => medianTimeAt(server, height);
const describePosition = (position: RecordedPosition | undefined): string =>
  position === undefined ? 'nothing' : `"${position.status}"${position.reason === undefined ? '' : ` (${position.reason})`}, ${position.satoshis ?? 0n} satoshis in ${position.coins ?? 0} coin(s), from ${position.standing === 'own' ? 'a record of its own' : 'a record of the earlier seed'}`;

// ------------------------------------------------------------------ the parts

try {
  say(phase);

  if (phase === 'the owner opens a jar') {
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
    account = await openAccount(facts.words.owner, "the owner's device");
    const wallet = await OwnerWallet.open({ backend: account, chain, seed: ownerSeed, ...(facts.ownerState === undefined ? {} : { state: facts.ownerState }), save: (state) => { facts.ownerState = state; keep(); } });
    const funding = await wallet.fundingAddress();
    await once('the wallet is funded', async () => ({ transactionIds: [await funderPays('the wallet is funded', [{ lockingBytecode: funding, valueSatoshis: 80_000n }])] }));
    if ((await wallet.creationStep()) !== 'created') {
      await until('the funding coin in the engine', async () => (await wallet.creationStep()) !== 'not funded');
      await wallet.create({ recovererKeyHash: credential.recoveryKey.keyHash, challengeDelay: { unit: 'time512', value: 1 } });
    }
    facts.identity = wallet.stored.identity as string;
    keep();
    // The recoverer's balance, paid from the run's own coins, once the engine lists what the creation left; a part
    // that stopped after the creation pays it when continued.
    const paidRecoverer = await once('the recoverer gets its balance', async () => {
      const before = await until('what the creation left, in the engine', async () => { const now = (await wallet.balance()).recoverable; return now >= RECOVERER_COINS + 1_000n ? now : undefined; });
      const sent = await wallet.pay([{ lockingBytecode: p2pkhLockingBytecode(credential.feeKey.keyHash), valueSatoshis: RECOVERER_COINS }]);
      // What the wallet holds once the engine lists the payment's change.
      return { transactionIds: [sent.transactionId], data: { recoverable: String(before - RECOVERER_COINS - sent.feeSatoshis) } };
    });
    for (const [step, transactionId, about] of [
      ['prepare', wallet.stored.creation.prepareTransactionId, 'the wallet pays itself, to have a coin that is output 0; this transaction is the identity'],
      ['create', wallet.stored.creation.createTransactionId, 'the controller and the rest'],
    ] as const) {
      if (transactionId === undefined) continue;
      const bytes = ((await until('the transaction', async () => server.getTransaction(transactionId))) as string).length / 2;
      record(step, { transactionId, bytes, feeSatoshis: BigInt(bytes) }, about);
    }
    const created = await once('the wallet holds its first coin', async () => {
      const first = await until('the wallet\'s first coin', async () => { const now = await wallet.balance(); return now.recoverable === BigInt(paidRecoverer['recoverable'] as string) ? now : undefined; });
      return { data: { recoverable: String(first.recoverable) } };
    });
    const arrived = BigInt(created['recoverable'] as string) + 60_000n;
    const identity = hexToBin(facts.identity as string);
    const given = await once('an address is given out', async () => ({ data: { first: (await wallet.receiveAddress()).address.number } }));
    await once('someone pays the wallet', async () => ({ transactionIds: [await funderPays('someone pays the wallet', [{ lockingBytecode: wallet.address(0, given['first'] as number).lockingBytecode, valueSatoshis: 60_000n }])] }));
    await block();
    await until('the coin in the wallet', async () => (await wallet.balance()).recoverable === arrived);

    if (facts.ownerArrangement === undefined) {
      facts.ownerArrangement = { archive: newArchive(STORES), earlierArchives: [], earlierViewingKeyRecords: [] };
      keep();
    }
    const applications = new Applications(wallet.parts, { archive: applicationArchive({ arrangement: () => facts.ownerArrangement, storeAt, seed: ownerSeed, identity, chain }) });
    if (facts.jar === undefined) {
      // The soonest date the run allows: a few minutes ahead of the chain's last block (on chipnet, of this machine's
      // clock too, should the last block be older). The recovery after the opening takes longer than that on chipnet,
      // so the chain's clock has passed the date by the time the new device empties the jar.
      const tip = await server.tip();
      facts.jar = { unlockTime: (local ? tip.time : Math.max(tip.time, Math.floor(Date.now() / 1000))) + JAR_DATE_AHEAD };
      keep();
    }
    const { unlockTime } = facts.jar;
    await once('the owner opens a jar', async () => {
      // A key in the wallet already means a jar was opened by a part that stopped before writing it down: the run
      // does not open a second one.
      if ((await wallet.balance()).tokens.length > 0) throw new Error('the wallet holds a token already, but the run has no record of opening the jar; look at the wallet before continuing');
      // The jar's page, connected to the wallet: its own code makes the request, the wallet shows it, the user approves.
      const link = pageLink(applications, 'the jar page');
      const page = new XoJars(link.requests, memoryStore(), { listUnspent: (lockingBytecode) => server.listUnspent(lockingBytecode) }, PAGE);
      const before = await page.list();
      note(`Before the opening the page asked the wallet which jars of its template it holds (version 2): ${before.trusted ? 'trusted' : 'not trusted with this page yet, so nothing is reported'}.`);
      const outcome = await link.approve(page.open(30_000n, unlockTime), {
        seen: (preview) =>
          note(`The wallet showed the page's request with its own figures: it gives ${preview.figures.givesSatoshis} satoshis, ${preview.figures.intoApplicationSatoshis} go into the jar, the fee is ${preview.figures.feeSatoshis}; it would store the template (${preview.firstUse}) and the record of the position it leaves (${preview.recordsPosition === true}) in the backup before anything is signed; the template is shown with ${'declaration' in preview.template ? 'a declaration' : 'no declaration'}.`),
      });
      const requests = link.sent.filter((message) => message.action === 'xo_action_request');
      if (requests.some((message) => 'declaration' in message.template || (message.definition !== undefined && 'declaration' in message.definition))) throw new Error('the page sent a declaration');
      const [asked] = requests;
      note(`The page's request, as it travelled: ${JSON.stringify({ templateAction: asked?.templateAction, role: asked?.role, variables: asked?.variables, page: asked?.page, template: asked?.template })}; it was sent ${requests.length} times, the second time with the template's text alone, after the wallet said it did not have it. No declaration was named or sent.`);
      (facts.jar as { category?: string }).category = outcome.category as string;
      keep();
      record('open the jar', await sentAs(outcome.transactionId as string), 'an action of the application\'s template, from the page\'s request: 30,000 satoshis into the jar, the key to a fresh address of the wallet; its record was on both stores before the engine signed');
      await block();
      const listed = await until('the page to list the jar', async () => {
        const now = await page.list();
        return now.jars[0]?.satoshis === 30_000n ? now : undefined;
      });
      note(`The page lists the jar from the wallet's answer and reads its balance from the chain: ${JSON.stringify(listed.jars.map((jar) => ({ category: `${jar.category.slice(0, 12)}…`, unlockTime: jar.unlockTime, satoshis: String(jar.satoshis), status: jar.status })))}.`);
      return { transactionIds: [outcome.transactionId as string] };
    });
    await block();
    const [written] = applications.positionRecords;
    note(`The earlier device holds ${applications.positionRecords.length} position record: the jar's script "${written?.lockingScriptIdentifier}" with the values ${JSON.stringify(written?.variables)}, its key ${written?.token?.category.slice(0, 12)}… with commitment ${written?.token?.commitment}, the other values ${Object.keys(written?.values ?? {}).join(', ')}, and the page's address ${written?.applicationPage}.`, 'the record written');
    note(`${await noDeclaration(applications, 'The earlier device')}.`, 'no declaration on the earlier device');
    const listed = await until('the jar listed from its record', async () => { const [position] = await applications.recordedPositions(); return position?.status === 'open' ? position : undefined; });
    note(`The earlier device lists the jar from its own record: ${describePosition(listed)}.`, 'the jar listed by the earlier device');
    const balance = await until('the wallet after opening the jar', async () => { const now = await wallet.balance(); return now.tokens.length === 1 && now.recoverable > 0n ? now : undefined; });
    facts.held = String(balance.recoverable + balance.tokens.reduce((sum, coin) => sum + coin.utxo.output.valueSatoshis, 0n));
    keep();
    note(`The old device holds ${facts.held} satoshis at its addresses, the jar's key among them, and 30,000 satoshis are in the jar. Then the device is lost.`, 'what the old device holds');
  }

  if (phase === 'the recoverer recovers') {
    const identity = hexToBin(facts.identity as string);
    account = await openAccount(facts.words.credential, 'the recoverer');
    const funds = await RecovererFunds.open({ backend: account, chain });
    const recoverer = await RecovererWallet.open({ funds, chain, identity, recoveryKey: credential.recoveryKey });
    const fees = recoveryFees();
    const before = await recoverer.state();
    if (hex(before.ownerKeyHash) !== hex(newSeed.controllerKey.keyHash)) {
      if (before.status === 'active') {
        await until('the recoverer\'s balance', async () => { const now = await funds.balance(); return now >= fees.request + fees.completion ? now : undefined; });
        const requested = await recoverer.request(newSeed.controllerKey.keyHash);
        record('request', requested, 'the recoverer names the new device\'s key; paid from its balance in the same transaction');
        await confirmed(requested.transactionId);
      }
      await until('the request in the engine', async () => (await recoverer.state()).status === 'pending');
      // The waiting period: 512 seconds of the chain's own time. On the local chain it is moved on as the earlier runs
      // do; on chipnet it passes as blocks come.
      if (local) {
        const now = (await rpc('getblockheader', await rpc('getbestblockhash'))).time as number;
        await rpc('setmocktime', now + 700);
        await mine(11, BURN);
      }
      // The network counts the waiting period on the chain's own clock: the median of the last eleven block times,
      // from the block before the one that holds the request. The recoverer waits for that, then completes.
      const startedWaiting = Date.now();
      await until(
        'the waiting period on the chain\'s clock (512 seconds of it after the request\'s block)',
        async () => {
          const request = (await readControllerHistory(chain, identity)).transactions.at(-1);
          const confirmations = request === undefined ? 0 : ((await server.confirmations(request.transactionId)) ?? 0);
          if (confirmations < 1) return false;
          const tip = await server.tip();
          return (await medianTime(tip.height)) >= (await medianTime(tip.height - confirmations)) + 512;
        },
        local ? 10 * 60_000 : 40 * 60_000,
        local ? 500 : 30_000,
      );
      const completed = await until(
        'the waiting period to pass',
        async () => {
          try {
            return await recoverer.complete();
          } catch (error) {
            if (/non-?BIP68-final/i.test(String((error as Error).message))) return undefined;
            throw error;
          }
        },
        local ? 10 * 60_000 : 20 * 60_000,
        local ? 500 : 30_000,
      );
      record('complete', completed, `after the waiting period${local ? '' : ` (${Math.round((Date.now() - startedWaiting) / 60_000)} minutes)`}; no coin has moved`);
      if (local) await rpc('setmocktime', 0);
      await block();
    }
  }

  if (phase === 'the new device empties the jar from its record') {
    const identity = hexToBin(facts.identity as string);
    account = await openAccount(facts.words.next, 'the new device');
    const save = (state: OwnerWalletState): void => { facts.newState = state; keep(); };
    const wallet = facts.newState === undefined
      ? await OwnerWallet.takeOver({ backend: account, chain, seed: newSeed, identity, earlierViewingKeys: [ownerSeed.viewingKey], save })
      : await OwnerWallet.open({ backend: account, chain, seed: newSeed, state: facts.newState, save });
    if ((await wallet.checkOwnership()) === 'closed') {
      say('  (the wallet is closed: done before)');
    } else {
      const { unlockTime } = facts.jar as { unlockTime: number };
      const category = facts.jar?.category as string;
      const jarAt = savingsJarScript(hexToBin(category), unlockTime).lockingBytecode;
      const full = await wallet.search();
      note(`The new device's search over both seeds ended as "${full.status}".`, 'the search');
      if (facts.steps['the new device sweeps'] === undefined) {
        await until('the earlier coins in the engine', async () => (await wallet.balance()).toSweep === BigInt(facts.held as string));
        const sent = await wallet.sweepEarlier();
        for (const transaction of sent.transactions) record('sweep', transaction, `${sent.coins} coins of the earlier seed, the jar's key among them, to addresses of the new seed`);
        facts.steps['the new device sweeps'] = { transactionIds: sent.transactions.map((transaction) => transaction.transactionId) };
        keep();
      }
      await block();
      await until('the swept key at an address of the new seed', async () => { const now = await wallet.balance(); return now.toSweep === 0n && now.tokens.length === 1; });

      // The new device's own archive, with the earlier one's records copied into it (section 10.6).
      if (facts.newArrangement === undefined || (facts.newArrangement.copiedArchives ?? []).length === 0) {
        const copied = await copyEarlierArchives({ arrangement: facts.newArrangement ?? { archive: newArchive(STORES), earlierArchives: [(facts.ownerArrangement as RecoveryArrangement).archive], earlierViewingKeyRecords: [] }, storeAt, whetherSent: actionSent(wallet.parts) });
        facts.newArrangement = copied.arrangement;
        keep();
        if (copied.unfinished.length > 0) throw new Error(`the earlier archive was not copied in full: ${copied.unfinished.join(' ')}`);
        note(`The new device copied ${copied.copied} records of the earlier archive into its own; a record of an action that was never sent is left out.`, 'the copy');
      }
      const applications = new Applications(wallet.parts, { archive: applicationArchive({ arrangement: () => facts.newArrangement, storeAt, seed: newSeed, identity, chain }) });
      // No application takes part from here on: no session, no request, no page. The device has the backup and the chain.
      await once('the new device reads the record from a store', async () => {
        await applications.readBackup();
        const [suggestedRecord] = applications.suggestedRecords;
        if (suggestedRecord === undefined) throw new Error('the backup held no position record');
        facts.record = suggestedRecord;
        keep();
        const [before] = await applications.recordedPositions();
        note(`The new device read the record from a store. It is the earlier seed's, a suggestion; with the template not yet trusted here the jar is listed as ${describePosition(before)}.`);
        const [suggested] = applications.suggestions;
        if (suggested === undefined || suggested.identifier !== jarNames.identifier) throw new Error('the backup did not hold the jar\'s template');
        if ('declaration' in suggested || 'declaration' in suggested.texts) throw new Error('the backup held a declaration');
        note('The backup held the template of version 4 as the earlier owner stored it, with no declaration.');
        await applications.trust(suggested, undefined);
        note(`The user trusted the template "${suggested.name}" the earlier owner stored, on the user's word.`);
        // The check of section 10.4 from the chain alone, with every lookup counted.
        const check = await counted(() => checkPositionRecord(suggestedRecord, wallet.parts, readTemplate(savingsJarV4TemplateText)));
        note(`The check of section 10.4 found that the record ${check.result.counts ? 'counts' : 'does not count'}: ${check.result.reason} The transaction that carried the key and paid the jar: ${check.result.carriedIn}. It cost ${check.history} history, ${check.transactions} transaction(s) and ${check.unspent} list of coins from the server, and the wallet's own list of coins.`);
        if (!check.result.counts) throw new Error('the record does not count');
        const confirmation = await applications.confirmRecords();
        note(`The record was written again as the new owner's own on the stores (${confirmation.confirmed} record), and its script was handed to the engine with the record's values (${confirmation.followed} script${confirmation.notFollowed.length === 0 ? '' : `; not followed: ${confirmation.notFollowed.join('; ')}`}).`);
        return undefined;
      });
      const followed = await until('the engine to list the jar\'s coin', async () => { const coins = await (account as Account).coinsAt(jarAt); return coins.length > 0 ? coins : undefined; });
      note(`The new device's engine, given the jar's script from the record, lists ${followed.length} coin there under the template ${followed[0]?.template.slice(0, 12)}…, ${followed.reduce((sum, coin) => sum + coin.utxo.output.valueSatoshis, 0n)} satoshis.`, 'the engine follows the jar');
      const position = await until('the jar listed from the record', async () => { const [found] = await applications.recordedPositions(); return found?.status === 'open' ? found : undefined; });
      note(`The new device lists the jar from the record: ${describePosition(position)}; the template offers "${position.actions?.join('", "')}" at the jar.`, 'the jar listed from the record');

      // The network takes the withdrawal once the median time of the last eleven blocks has passed the jar's date. On
      // the local chain the clock is moved on; on chipnet it passes as blocks come, and the run waits for it, no longer
      // than until the date and twenty minutes more.
      const dateHasPassed = async (): Promise<void> => {
        const waitedFrom = Date.now();
        const clock = await medianTime((await server.tip()).height);
        await until(
          `the chain's clock (${iso(clock)} now) to pass the jar's date ${iso(unlockTime)}`,
          async () => {
            if ((await medianTime((await server.tip()).height)) > unlockTime) return true;
            if (local) {
              await rpc('setmocktime', unlockTime + 700);
              await mine(11, BURN);
              await rpc('setmocktime', 0);
            }
            return false;
          },
          local ? 10 * 60_000 : Math.max(0, unlockTime - clock) * 1000 + 20 * 60_000,
          local ? 500 : 15_000,
        );
        if (!local) note(`When the new device came to empty the jar, the chain's clock was ${iso(clock)}, ${clock > unlockTime ? `already past the jar's date ${iso(unlockTime)}: the recovery before it had taken longer than the time to the date, and no wait was needed` : `before the jar's date ${iso(unlockTime)}; the run waited ${Math.round((Date.now() - waitedFrom) / 60_000)} minutes for it to pass`}.`, 'the jar\'s date on chipnet');
      };
      await once('the new device empties the jar by itself', async () => {
        await dateHasPassed();
        // The action the wallet's own list offers at the position, from the record: no page, no request.
        const offered = applications.offeredActions(position);
        note(`The wallet's own list offers at the jar: ${JSON.stringify(offered.map(({ action, asks, needsApplication }) => ({ action, asks: asks?.map(({ variable }) => variable) ?? [], needsApplication: needsApplication ?? null })))}.`);
        const withdraw = applications.actionOn(position, 'withdraw');
        if (withdraw.page !== undefined || withdraw.application !== undefined || withdraw.presented !== undefined) throw new Error('the action came with something of an application\'s');
        note(`The action the wallet made from its own list: ${JSON.stringify(withdraw)}.`);
        const preview = await applications.preview(withdraw);
        note(`Before emptying, the wallet's own figures: ${preview.figures.fromApplication.satoshis} satoshis from the jar's ${preview.figures.fromApplication.coins} coin, a fee of ${preview.figures.feeSatoshis}, the key and the savings to the wallet (${preview.figures.toWallet.map(({ kind }) => kind).join(', ')}); the position is ${preview.notConfirmed === undefined ? 'confirmed' : `not confirmed (${preview.notConfirmed})`}; the earliest time ${preview.figures.notBefore}. Every value came from the record (the jar's two values and the date as written on the key) or from the wallet itself (the key's address, the key at input 0); the template is shown with ${'declaration' in preview.template ? 'a declaration' : 'no declaration'}.`);
        const outcome = await applications.carryOut(withdraw);
        record('empty the jar', outcome.sent, 'carried out by the new device by itself, from its list of positions; no page, no session, no request. The key at input 0, the jar\'s coin after it; the key and the savings to addresses of the new seed');
        if (outcome.tokens[0]?.category !== category) throw new Error('the key did not come back');
        const emptied = decodeTransactionBch(hexToBin((await until('the withdrawal', async () => server.getTransaction(outcome.transactionId))) as string));
        if (typeof emptied === 'string' || hex(emptied.inputs[0]?.outpointTransactionHash ?? new Uint8Array()) !== hex(position.token.outpoint.split(':')[0] === undefined ? new Uint8Array() : hexToBin(position.token.outpoint.split(':')[0] as string))) throw new Error('the key was not at input 0');
        note(`${await noDeclaration(applications, 'The new device')}; it made no request to the jar's page and had no session with any application.`);
        return { transactionIds: [outcome.transactionId] };
      });
      await block();
      const closed = await until('the jar listed as closed', async () => { const [found] = await applications.recordedPositions(); return found?.status === 'closed' ? found : undefined; });
      note(`After the withdrawal the jar is listed from the record as ${describePosition(closed)}; the key is still in the wallet.`, 'the jar closed');

      await once('the key is sent on', async () => {
        const holding = await until('the key', async () => { const now = await wallet.balance(); return now.tokens.length === 1 && now.toSweep === 0n ? now.tokens[0] : undefined; });
        const sent = await wallet.sendToken(holding, funderLocking);
        record('send the key on', sent, 'unchanged, to the address that paid for the run');
        return { transactionIds: [sent.transactionId] };
      });
      await block();
      await until('the wallet without a token', async () => (await wallet.balance()).tokens.length === 0);
      await wait(1_500);
      const closing = await wallet.close(funderLocking);
      for (const sent of closing.transactions) record('close', sent, 'everything, and the controller\'s value, back to the address that paid for the run');
      await block();
    }
    const history = await until('the closing', async () => { const read = await readControllerHistory(chain, identity); return read.closed === undefined ? undefined : read; });
    note(`The controller's history: ${history.transitions.map((step) => step.kind).join(', ')}, then closed. It has had ${history.owners.length} owners.`, 'the closing');
  }

  if (phase === 'the recoverer returns its balance') {
    await once('the recoverer returns its balance', async () => {
      account = await openAccount(facts.words.credential, 'the recoverer');
      const funds = await RecovererFunds.open({ backend: account, chain });
      await until('the recoverer\'s balance', async () => (await funds.balance()) > 0n);
      const [sent] = (await funds.sendEverything(funderLocking)).transactions;
      if (sent === undefined) return {};
      record('return the recoverer\'s balance', sent, 'what the recoverer did not use');
      return { transactionIds: [sent.transactionId] };
    });
    await block();
  }

  if (phase === 'the run returns what is left') {
    await once('the key is destroyed', async () => {
      // The jar's key alone: on chipnet the funding key may hold tokens of other runs, which are left as they are.
      const nfts = await until('the key at the funder', async () => { const found = (await server.listUnspent(funderLocking, 'only')).filter((entry) => entry.token?.category === facts.jar?.category); return found.length > 0 ? found : undefined; });
      const extra: Utxo[] = nfts.map((entry) => ({
        transactionHash: hexToBin(entry.transactionId),
        index: entry.index,
        output: {
          lockingBytecode: funderLocking,
          valueSatoshis: entry.valueSatoshis,
          token: { amount: entry.token?.amount ?? 0n, category: hexToBin(entry.token?.category ?? ''), ...(entry.token?.nft === undefined ? {} : { nft: { capability: entry.token.nft.capability, commitment: hexToBin(entry.token.nft.commitment) } }) },
        },
      }));
      return { transactionIds: [await funderPays('the key is destroyed', [], { burn: true, extraInputs: extra })] };
    });
    await block();
    const identity = hexToBin(facts.identity as string);
    const total = await until('the funder\'s coins', async () => { const coins = await funderCoins(); return coins.length > 0 ? coins.reduce((sum, coin) => sum + coin.output.valueSatoshis, 0n) : undefined; });
    const places: [string, Uint8Array][] = [
      ['the wallet\'s funding address', p2pkhLockingBytecode(ownerSeed.fundingKey.keyHash)],
      ['the new device\'s funding address', p2pkhLockingBytecode(newSeed.fundingKey.keyHash)],
      ['the recoverer\'s balance', p2pkhLockingBytecode(credential.feeKey.keyHash)],
    ];
    if (facts.jar?.category !== undefined) places.push(['the jar', savingsJarScript(hexToBin(facts.jar.category), facts.jar.unlockTime).lockingBytecode]);
    const left: string[] = [];
    for (const [name, lockingBytecode] of places) {
      const sum = (await server.listUnspent(lockingBytecode)).reduce((value, entry) => value + entry.valueSatoshis, 0n);
      if (sum > 0n) left.push(`${sum} at ${name}`);
    }
    for (const seed of [ownerSeed, newSeed]) {
      const { quickPass } = await import('@grandmas-wallet/core');
      const found = (await quickPass(chain, identity, seed.viewingKey)).found.flatMap((address) => address.coins);
      if (found.length > 0) left.push(`${found.length} coins at addresses of a seed`);
    }
    const spent = BigInt(facts.funderAtStart as string) - total;
    note(`The funding address held ${facts.funderAtStart} satoshis before the run and holds ${total} after it: the run cost ${spent} satoshis in fees${local ? '' : ' (if no other run paid from the same key meanwhile)'}. ${left.length === 0 ? 'Nothing is left anywhere else.' : `LEFT BEHIND: ${left.join('; ')}.`}`);
    if (left.length > 0) throw new Error(`coins were left behind: ${left.join('; ')}`);
  }
  if (!facts.finished.includes(phase)) facts.finished.push(phase);
  keep();
} catch (error) {
  say(`FAILED: ${(error as Error).name}: ${String((error as Error).message).slice(0, 700)}\n${String((error as Error).stack).split('\n').slice(1, 5).join('\n')}`);
  process.exitCode = STOPPED;
} finally {
  if (local) await rpc('setmocktime', 0).catch(() => undefined);
  await server.disconnect().catch(() => undefined);
  await account?.close();
  process.exit();
}
