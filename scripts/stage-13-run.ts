// The stage 13 run on the local node (acceptance test PR03 of proposal v0.6): a position through the loss of a
// device, found again from its position record.
//
// An owner's wallet is created on the XO engine, with a recoverer, and opens a Savings Jar; the record of the jar
// is on two backup stores before the opening is signed. The device is lost. The recoverer requests, waits and
// completes; a new device takes the wallet over with the project's recovery flow, sweeps the jar's key, copies
// the earlier archive and reads the record from a store. The user trusts the template the earlier owner stored;
// the record is checked against the chain alone (proposal section 10.4), written again as the new owner's own,
// and its script is handed to the engine with the record's values. The jar is listed from the record, and the
// wallet empties it by itself, with no application asked. At the end the wallet is closed and every coin is back
// at the address that paid for the run.
//
// The run of record (docs/runs/stage-13-local-node.md) sent the jar's template of version 3 with its recovery
// declaration, and the withdrawal was worked out through the declaration; that script is at the tag `design-2`.
// Since stage 14 the wallet reads no declaration: this script sends the template of version 4 alone, and the
// withdrawal is worked out from the template and the record.
//
// Each part is a process of its own with an empty engine state, as a device session would be. What the run knows
// between parts is in .local-runs/stage-13-local.json; the stores are directories beside it. A run that stops is
// continued with the same command; `--new` starts again.
//
// usage (from packages/app, with the local node running; see deploy/regtest/regtest.sh):
//   npx tsx ../../scripts/stage-13-run.ts
// The log is written to docs/runs/stage-13-local-node.md.
import 'fake-indexeddb/auto';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { type Output, binToHex, generateBip39Mnemonic, hexToBin } from '@bitauth/libauth';
import { type ArchiveStore, type PositionRecordEntry, blobIdOf } from '@grandmas-wallet/archive';
import { type ChainReader, type KeyPair, type Utxo, buildTransaction, checkBeforeSending, deriveCredentialKeys, deriveSeedKeys, keyPairFromPrivateKey, p2pkhInput, p2pkhLockingBytecode, readControllerHistory, readTemplate } from '@grandmas-wallet/core';
import { Engine, XO_SUPPORTED_NETWORKS } from '@xo-cash/engine';

import { Electrum } from '../packages/chipnet/src/electrum.js';
import { invitationFiles, writeInvitationFiles } from './invitation-files.js';
import {
  type ApplicationAction,
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
// The application's own definitions. The wallet's code has none of them: they reach it as texts.
import { savingsJarScript, savingsJarV4TemplateText as savingsJarTemplateText, unlockTimeBytes } from '../packages/savings-jar/src/index.js';
// @ts-expect-error a plain script: the engine's settings for the local chain, and the node's RPC
import { regtestServers, rpc, mine, BURN } from '../spikes/xo-engine/regtest.mjs';

const hex = binToHex;
const root = fileURLToPath(new URL('..', import.meta.url));
const [phase] = process.argv.slice(2).filter((word) => !word.startsWith('--'));
/** The exit code of a part that stopped at a step of its own and said why. */
const STOPPED = 3;
const PHASES = ['the owner opens a jar', 'the recoverer recovers', 'the new device empties the jar from its record', 'the recoverer returns its balance', 'the run returns what is left'];
const runDirectory = `${root}.local-runs`;
mkdirSync(runDirectory, { recursive: true });
const stateFile = `${runDirectory}/stage-13-local.json`;
const storeDirectory = `${runDirectory}/stage-13-stores`;
const invitations = `${runDirectory}/invitations/stage-13/`;
const logFile = `${root}docs/runs/stage-13-local-node.md`;

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
  finished: string[];
  held?: string;
  funderAtStart?: string;
  log: Entry[];
  notes: string[];
}

// ------------------------------------------------------------------ the driver: one process for each part

if (phase === undefined) {
  if (process.argv.includes('--new')) {
    rmSync(stateFile, { force: true });
    rmSync(storeDirectory, { recursive: true, force: true });
  }
  if (!existsSync(stateFile)) rmSync(invitations, { recursive: true, force: true });
  if (!existsSync(stateFile) && Number(execFileSync(`${root}deploy/regtest/regtest.sh`, ['cli', 'getblockcount'], { encoding: 'utf8' })) > 1500) {
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
    let result = spawnSync('npx', ['tsx', fileURLToPath(import.meta.url), next], { stdio: 'inherit' });
    for (let again = 0; again < 3 && result.status !== 0 && result.status !== STOPPED; again += 1) {
      console.log(`"${next}" ended unexpectedly; continuing it`);
      result = spawnSync('npx', ['tsx', fileURLToPath(import.meta.url), next], { stdio: 'inherit' });
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
    return found === undefined ? '' : `${found.action} (${found.templateName})`;
  };
  const revision = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  writeFileSync(
    logFile,
    [
      '# Stage 13 run on the local node: a position found again from its record (PR03)',
      '',
      'Written by the run itself (`scripts/stage-13-run.ts`). The owner\'s wallet, the recoverer and the new device, each on the unmodified XO engine, against the local node in regtest mode with the public networks\' relay rules. Each part ran in a process of its own with an empty engine state. The Savings Jar reached the wallet as its template alone, as a text; every transaction of the jar is an invitation of that template, built and signed by the engine, and was compared with what the wallet\'s own code had worked out before it was sent. The backup stores are two directories of the run, read and written as a store server\'s are.',
      '',
      `- Wallet identity: \`${facts.identity}\``,
      `- Jar key (token category): \`${facts.jar?.category}\`; the jar's date: ${new Date((facts.jar?.unlockTime ?? 0) * 1000).toISOString()}`,
      `- Template "Savings Jar" \`${readTemplate(savingsJarTemplateText).identifier}\``,
      `- Repository at commit \`${revision}\``,
      `- Started ${facts.startedAt}`,
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
const until = async <T>(what: string, check: () => Promise<T | undefined | false>, patienceMs = 60_000, everyMs = 500): Promise<T> => {
  const deadline = Date.now() + patienceMs;
  for (;;) {
    const found = await check();
    if (found !== undefined && found !== false) return found;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await wait(everyMs);
  }
};
console.error = () => undefined;

const numbers = walletTemplateNumbers();
const credential = deriveCredentialKeys(facts.words.credential, 'testnet', numbers);
const RECOVERER_COINS = 5_000n;
const ownerSeed = deriveSeedKeys(facts.words.owner, 'testnet', numbers);
const newSeed = deriveSeedKeys(facts.words.next, 'testnet', numbers);

const server = await Electrum.connect('ws://127.0.0.1:60403');
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

if (facts.localFunder === undefined) {
  facts.localFunder = hex(crypto.getRandomValues(new Uint8Array(32)));
  keep();
}
const funder: KeyPair = keyPairFromPrivateKey(hexToBin(facts.localFunder));
const funderLocking = p2pkhLockingBytecode(funder.keyHash);
const block = async (): Promise<void> => {
  await mine(1, BURN);
};
const confirmed = async (transactionId: string): Promise<void> => {
  await mine(1, BURN);
  await until(`the first confirmation of ${transactionId.slice(0, 12)}…`, async () => ((await server.confirmations(transactionId)) ?? 0) > 0);
};
const funderCoins = async (): Promise<Utxo[]> =>
  (await server.listUnspent(funderLocking, 'exclude')).map((entry) => ({ transactionHash: hexToBin(entry.transactionId), index: entry.index, output: { lockingBytecode: funderLocking, valueSatoshis: entry.valueSatoshis } }));
const funderPays = async (outputs: Output[], options: { burn?: boolean; extraInputs?: Utxo[] } = {}): Promise<string> => {
  const coins = await until('the funder\'s coins', async () => { const found = await funderCoins(); return found.length > 0 ? found : undefined; });
  const built = buildTransaction({ inputs: [...coins, ...(options.extraInputs ?? [])].map((coin) => p2pkhInput(coin, funder)), outputs, changeLockingBytecode: funderLocking, allowTokenBurn: options.burn === true });
  const check = checkBeforeSending(built);
  if (check !== true) throw new Error(`a payment of the funder fails the check before sending: ${check}`);
  const result = await server.broadcast(hex(built.encoded));
  if (!result.accepted && !/already/i.test(result.reason)) throw new Error(`a payment of the funder was refused: ${result.reason}`);
  await until('the funder\'s change', async () => (await server.getTransaction(built.transactionId)) !== undefined);
  await wait(1_200);
  return built.transactionId;
};

const openAccount = async (words: string, who: string): Promise<Account> =>
  Account.open(await Engine.create(words, { network: XO_SUPPORTED_NETWORKS.chipnet, electrumServers: await regtestServers() }), { onSent: writeInvitationFiles(invitations, who) });
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

const jarTemplate = readTemplate(savingsJarTemplateText);
const jarNames = { identifier: jarTemplate.identifier, contentHash: jarTemplate.contentHash };
const jarTexts = { template: savingsJarTemplateText };
const medianTime = async (height: number): Promise<number> => {
  const times = await Promise.all(Array.from({ length: 11 }, (_, back) => server.headerTime(Math.max(height - back, 0))));
  return times.sort((a, b) => a - b)[5] as number;
};
const describePosition = (position: RecordedPosition | undefined): string =>
  position === undefined ? 'nothing' : `"${position.status}"${position.reason === undefined ? '' : ` (${position.reason})`}, ${position.satoshis ?? 0n} satoshis in ${position.coins ?? 0} coin(s), from ${position.standing === 'own' ? 'a record of its own' : 'a record of the earlier seed'}`;

// ------------------------------------------------------------------ the parts

try {
  say(phase);

  if (phase === 'the owner opens a jar') {
    await once('the funder gets a block reward', async () => {
      await mine(1, hex(funderLocking));
      await mine(100, BURN);
      return undefined;
    });
    if (facts.funderAtStart === undefined) {
      const coins = await until('the funder\'s coins', async () => { const found = await funderCoins(); return found.length > 0 ? found : undefined; });
      facts.funderAtStart = String(coins.reduce((sum, coin) => sum + coin.output.valueSatoshis, 0n));
      keep();
    }
    account = await openAccount(facts.words.owner, "the owner's device");
    const wallet = await OwnerWallet.open({ backend: account, chain, seed: ownerSeed, ...(facts.ownerState === undefined ? {} : { state: facts.ownerState }), save: (state) => { facts.ownerState = state; keep(); } });
    const funding = await wallet.fundingAddress();
    await once('the wallet is funded', async () => ({ transactionIds: [await funderPays([{ lockingBytecode: funding, valueSatoshis: 80_000n }])] }));
    if ((await wallet.creationStep()) !== 'created') {
      await until('the funding coin in the engine', async () => (await wallet.creationStep()) !== 'not funded');
      await wallet.create({ recovererKeyHash: credential.recoveryKey.keyHash, challengeDelay: { unit: 'time512', value: 1 } });
      await wallet.pay([{ lockingBytecode: p2pkhLockingBytecode(credential.feeKey.keyHash), valueSatoshis: RECOVERER_COINS }]);
      facts.identity = wallet.stored.identity as string;
      keep();
    }
    for (const [step, transactionId, about] of [
      ['prepare', wallet.stored.creation.prepareTransactionId, 'the wallet pays itself, to have a coin that is output 0; this transaction is the identity'],
      ['create', wallet.stored.creation.createTransactionId, 'the controller and the rest'],
    ] as const) {
      if (transactionId === undefined) continue;
      const bytes = ((await until('the transaction', async () => server.getTransaction(transactionId))) as string).length / 2;
      record(step, { transactionId, bytes, feeSatoshis: BigInt(bytes) }, about);
    }
    const created = await once('the wallet holds its first coin', async () => {
      const first = await until('the wallet\'s first coin', async () => { const now = await wallet.balance(); return now.recoverable > 0n ? now : undefined; });
      return { data: { recoverable: String(first.recoverable) } };
    });
    const arrived = BigInt(created['recoverable'] as string) + 60_000n;
    const identity = hexToBin(facts.identity as string);
    const given = await once('an address is given out', async () => ({ data: { first: (await wallet.receiveAddress()).address.number } }));
    await once('someone pays the wallet', async () => ({ transactionIds: [await funderPays([{ lockingBytecode: wallet.address(0, given['first'] as number).lockingBytecode, valueSatoshis: 60_000n }])] }));
    await block();
    await until('the coin in the wallet', async () => (await wallet.balance()).recoverable === arrived);

    if (facts.ownerArrangement === undefined) {
      facts.ownerArrangement = { archive: newArchive(STORES), earlierArchives: [], earlierViewingKeyRecords: [] };
      keep();
    }
    const applications = new Applications(wallet.parts, { archive: applicationArchive({ arrangement: () => facts.ownerArrangement, storeAt, seed: ownerSeed, identity, chain }) });
    if (facts.jar === undefined) {
      facts.jar = { unlockTime: (await server.tip()).time + 300 };
      keep();
    }
    const { unlockTime } = facts.jar;
    const open: ApplicationAction = {
      template: jarNames,
      presented: jarTexts,
      action: 'open',
      role: 'saver',
      variables: { unlockTime, unlockTimeBytes: hex(unlockTimeBytes(unlockTime)), savedSatoshis: 30_000 },
      application: 'the jar page',
      page: 'https://jar.example/',
    };
    await once('the owner opens a jar', async () => {
      const preview = await applications.preview(open);
      note(`Before the opening the wallet said that it would store the template (${preview.firstUse}) and the record of the position it leaves (${preview.recordsPosition === true}) in the backup before anything is signed.`);
      const outcome = await applications.carryOut(open);
      (facts.jar as { category?: string }).category = outcome.tokens[0]?.category as string;
      keep();
      record('open the jar', outcome.sent, 'an action of the application\'s template: 30,000 satoshis into the jar, the key to a fresh address of the wallet; its record was on both stores before the engine signed');
      return { transactionIds: [outcome.transactionId] };
    });
    await block();
    const [written] = applications.positionRecords;
    note(`The earlier device holds ${applications.positionRecords.length} position record: the jar's script "${written?.lockingScriptIdentifier}" with the values ${JSON.stringify(written?.variables)}, its key ${written?.token?.category.slice(0, 12)}… with commitment ${written?.token?.commitment}, and the other values ${Object.keys(written?.values ?? {}).join(', ')}.`, 'the record written');
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
      // The waiting period: 512 seconds of the chain's own time, moved on as the earlier runs do.
      const now = (await rpc('getblockheader', await rpc('getbestblockhash'))).time as number;
      await rpc('setmocktime', now + 700);
      await mine(11, BURN);
      await until(
        'the waiting period on the chain\'s clock',
        async () => {
          const request = (await readControllerHistory(chain, identity)).transactions.at(-1);
          const confirmations = request === undefined ? 0 : ((await server.confirmations(request.transactionId)) ?? 0);
          if (confirmations < 1) return false;
          const tip = await server.tip();
          return (await medianTime(tip.height)) >= (await medianTime(tip.height - confirmations)) + 512;
        },
        10 * 60_000,
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
        10 * 60_000,
      );
      record('complete', completed, 'after the waiting period; no coin has moved');
      await rpc('setmocktime', 0);
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
        await applications.trust(suggested, undefined);
        note(`The user trusted the template "${suggested.name}" the earlier owner stored, on the user's word.`);
        // The check of section 10.4 from the chain alone, with every lookup counted.
        const check = await counted(() => checkPositionRecord(suggestedRecord, wallet.parts, readTemplate(savingsJarTemplateText)));
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

      const dateHasPassed = async (): Promise<void> => {
        await until(
          'the jar\'s date on the chain\'s clock',
          async () => {
            if ((await medianTime((await server.tip()).height)) > unlockTime) return true;
            await rpc('setmocktime', unlockTime + 700);
            await mine(11, BURN);
            await rpc('setmocktime', 0);
            return false;
          },
          10 * 60_000,
        );
      };
      await once('the new device empties the jar by itself', async () => {
        await dateHasPassed();
        // The action the wallet's own list offers at the position, for the token the record names.
        const withdraw = applications.actionOn(position, 'withdraw');
        const preview = await applications.preview(withdraw);
        note(`Before emptying, the wallet's own figures: ${preview.figures.fromApplication.satoshis} satoshis from the jar's ${preview.figures.fromApplication.coins} coin, a fee of ${preview.figures.feeSatoshis}, the key and the savings to the wallet; the position is ${preview.notConfirmed === undefined ? 'confirmed' : `not confirmed (${preview.notConfirmed})`}. The withdrawal's values came from the record, and the jar's coin from the record's script.`);
        const outcome = await applications.carryOut(withdraw);
        record('empty the jar', outcome.sent, 'carried out by the new device by itself, from its list of positions; no application was asked. The key and the savings to addresses of the new seed');
        if (outcome.tokens[0]?.category !== category) throw new Error('the key did not come back');
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
      const nfts = await until('the key at the funder', async () => { const found = await server.listUnspent(funderLocking, 'only'); return found.length > 0 ? found : undefined; });
      const extra: Utxo[] = nfts.map((entry) => ({
        transactionHash: hexToBin(entry.transactionId),
        index: entry.index,
        output: {
          lockingBytecode: funderLocking,
          valueSatoshis: entry.valueSatoshis,
          token: { amount: entry.token?.amount ?? 0n, category: hexToBin(entry.token?.category ?? ''), ...(entry.token?.nft === undefined ? {} : { nft: { capability: entry.token.nft.capability, commitment: hexToBin(entry.token.nft.commitment) } }) },
        },
      }));
      return { transactionIds: [await funderPays([], { burn: true, extraInputs: extra })] };
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
    note(`The funding address held ${facts.funderAtStart} satoshis before the run and holds ${total} after it: the run cost ${spent} satoshis in fees. ${left.length === 0 ? 'Nothing is left anywhere else.' : `LEFT BEHIND: ${left.join('; ')}.`}`);
    if (left.length > 0) throw new Error(`coins were left behind: ${left.join('; ')}`);
  }
  if (!facts.finished.includes(phase)) facts.finished.push(phase);
  keep();
} catch (error) {
  say(`FAILED: ${(error as Error).name}: ${String((error as Error).message).slice(0, 700)}\n${String((error as Error).stack).split('\n').slice(1, 5).join('\n')}`);
  process.exitCode = STOPPED;
} finally {
  await rpc('setmocktime', 0).catch(() => undefined);
  await server.disconnect().catch(() => undefined);
  await account?.close();
  process.exit();
}
