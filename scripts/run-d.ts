// Run D of the implementation plan, with this project's wallet: a savings jar through the loss of a device.
//
// An owner's wallet is created; the Savings Jar's template reaches it as an application would send it, and
// a jar is opened. The device is lost. The recoverer requests, waits and completes; a new device takes
// over, sweeps the jar's key with everything else, and reads the backup. From the swept key and the
// template in the backup it finds the jar on chain, with the application's site not consulted, and empties
// it once the jar's date has passed. Someone then pays into the jar again, and that is withdrawn too. At
// the end the wallet is closed and every coin is back at the address that paid for the run.
//
// One script, two chains: the local node (regtest) and chipnet. Each part is a process of its own with an
// empty engine state, as a device session would be; every step is written to the run's file before and
// after it is carried out, and a run that stops is started again with the same command and continues.
// The backup stores are two directories of the run, read and written as a store server's are.
//
// usage (from packages/app):
//   npx tsx ../../scripts/run-d.ts local      with the local node running (deploy/regtest/regtest.sh)
//   npx tsx ../../scripts/run-d.ts chipnet    paid from the key in .chipnet/funder-design-2.json
//
//   STOP_AFTER=<step>   the run stops after the named step, to be continued with the same command
import 'fake-indexeddb/auto';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { type Output, binToHex, generateBip39Mnemonic, hexToBin } from '@bitauth/libauth';
import { type ArchiveStore, blobIdOf } from '@grandmas-wallet/archive';
import {
  type ChainReader,
  type KeyPair,
  type Utxo,
  buildTransaction,
  checkBeforeSending,
  deriveCredentialKeys,
  deriveSeedKeys,
  keyPairFromPrivateKey,
  p2pkhInput,
  p2pkhLockingBytecode,
  readControllerHistory,
  readTemplate,
  textHash,
} from '@grandmas-wallet/core';
import { Engine, XO_SUPPORTED_NETWORKS, resolveElectrumServersForNetwork } from '@xo-cash/engine';

import { Electrum } from '../packages/chipnet/src/electrum.js';
import {
  type ApplicationAction,
  type HeldToken,
  type OwnerWalletState,
  type RecoveryArrangement,
  Account,
  Applications,
  OwnerWallet,
  RecovererWallet,
  applicationArchive,
  copyEarlierArchives,
  newArchive,
  RecovererFunds,
  recoveryFees,
  walletTemplateNumbers,
} from '../packages/app/src/index.js';
// The application's own definitions. The wallet's code has none of them: they reach it as texts.
import { savingsJarDeclarationText, savingsJarScript, savingsJarTemplateText, unlockTimeBytes } from '../packages/savings-jar/src/index.js';
// @ts-expect-error a plain script: the engine's settings for the local chain, and the node's RPC
import { regtestServers, rpc, mine, BURN } from '../spikes/xo-engine/regtest.mjs';

const hex = binToHex;
const root = fileURLToPath(new URL('..', import.meta.url));
const [chainName, phase] = process.argv.slice(2).filter((word) => !word.startsWith('--'));
const fewBlocks = process.argv.includes('--few-blocks');
if (chainName !== 'local' && chainName !== 'chipnet') {
  console.error('usage: npx tsx ../../scripts/run-d.ts <local|chipnet>');
  process.exit(2);
}
const local = chainName === 'local';
/** The exit code of a part that stopped at a step of its own and said why. */
const STOPPED = 3;
const PHASES = ['the owner opens a jar', 'the recoverer recovers', 'the new device finds the jar', 'the recoverer returns its balance', 'the run returns what is left'];
mkdirSync(`${root}.chipnet`, { recursive: true });
const stateFile = `${root}.chipnet/run-d-${chainName}.json`;
const storeDirectory = `${root}.chipnet/run-d-${chainName}-stores`;
const logFile = `${root}docs/runs/stage-8-${local ? 'local-node' : 'chipnet'}.md`;

interface Entry { step: string; transactionId: string; bytes: number; fee: string; note: string }
interface Facts {
  startedAt: string;
  words: { owner: string; next: string; credential: string };
  /** The key that pays for the run on the local chain. On chipnet it is the saved funding key. */
  localFunder?: string;
  identity?: string;
  ownerState?: OwnerWalletState;
  newState?: OwnerWalletState;
  /** The backup arrangement of each device: where its archive is, and its key. */
  ownerArrangement?: RecoveryArrangement;
  newArrangement?: RecoveryArrangement;
  /** The jar: its date, and the category of its key. */
  jar?: { unlockTime: number; category?: string };
  steps: Record<string, { transactionIds: string[]; data?: Record<string, number | string> }>;
  /** The parts that have run to their end; a run that continues starts after them. */
  finished: string[];
  held?: string;
  funderAtStart?: string;
  log: Entry[];
  notes: string[];
}

// ------------------------------------------------------------------ the driver: one process for each part

if (phase === undefined) {
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
    let result = spawnSync('npx', ['tsx', fileURLToPath(import.meta.url), chainName, next, ...(fewBlocks ? ['--few-blocks'] : [])], { stdio: 'inherit' });
    for (let again = 0; again < 3 && result.status !== 0 && result.status !== STOPPED; again += 1) {
      console.log(`"${next}" ended unexpectedly; continuing it`);
      result = spawnSync('npx', ['tsx', fileURLToPath(import.meta.url), chainName, next, ...(fewBlocks ? ['--few-blocks'] : [])], { stdio: 'inherit' });
    }
    if (result.status !== 0) {
      console.error(`Stopped in "${next}". The same command continues the run.`);
      process.exit(result.status ?? 1);
    }
  }
  const facts = JSON.parse(readFileSync(stateFile, 'utf8')) as Facts;
  const revision = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  writeFileSync(
    logFile,
    [
      `# Stage 8 run on ${local ? 'the local node' : 'chipnet (run D, this wallet)'}: a savings jar through the loss of a device`,
      '',
      `Written by the run itself (\`scripts/run-d.ts ${chainName}\`). The owner's wallet, the recoverer and the new device, each on the XO engine${local ? ', against the local node in regtest mode with the public networks\' relay rules' : ', on chipnet'}. Each part ran in a process of its own with an empty engine state. The Savings Jar reached the wallet as its template and recovery declaration, as texts; every transaction of the jar is an invitation of that template, built and signed by the engine, and was compared with what the wallet's own code had worked out before it was sent.`,
      '',
      `- Wallet identity: \`${facts.identity}\``,
      `- Jar key (token category): \`${facts.jar?.category}\`; the jar's date: ${new Date((facts.jar?.unlockTime ?? 0) * 1000).toISOString()}`,
      `- Template "Savings Jar" \`${readTemplate(savingsJarTemplateText).identifier}\`; compiled contract \`contracts/artifacts/savingsJar.json\``,
      `- Repository at commit \`${revision}\``,
      `- Started ${facts.startedAt}`,
      ...(local ? [] : [
        '- The engine ran with the local fix for chipnet\'s block timing (`docs/xo-chipnet-header-verification.md`); without it its header check stops below the tip.',
        '- The engine was given one server.',
      ]),
      '',
      '| Step | Transaction | Bytes | Fee (sat) | Note |',
      '| --- | --- | --- | --- | --- |',
      ...facts.log.map((entry) => `| ${entry.step} | \`${entry.transactionId}\` | ${entry.bytes} | ${entry.fee} | ${entry.note} |`),
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
const keep = (): void => writeFileSync(stateFile, JSON.stringify(facts, null, 1), { mode: 0o600 });
// The keys are on disk before anything is paid to them.
keep();
const say = (line: string): void => console.log(line);
/** An observation for the log. One given a name is written the first time only: a run that continues sees a later state. */
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
/** A step that is carried out once: what it did is written down, and a run that continues skips it. */
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
const PATIENCE_MS = local ? 60_000 : 20 * 60_000;
const until = async <T>(what: string, check: () => Promise<T | undefined | false>, patienceMs = PATIENCE_MS, everyMs = local ? 500 : 5_000): Promise<T> => {
  const deadline = Date.now() + patienceMs;
  let announced = false;
  for (;;) {
    const found = await check();
    if (found !== undefined && found !== false) return found;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    if (!announced && !local) say(`  waiting for ${what}`);
    announced = true;
    await wait(everyMs);
  }
};
console.error = () => undefined;

const numbers = walletTemplateNumbers();
const credential = deriveCredentialKeys(facts.words.credential, 'testnet', numbers);
/** What the run gives the recoverer's balance: enough for four requests and a completion. */
const RECOVERER_COINS = 5_000n;
const ownerSeed = deriveSeedKeys(facts.words.owner, 'testnet', numbers);
const newSeed = deriveSeedKeys(facts.words.next, 'testnet', numbers);

const server = await Electrum.connect(local ? 'ws://127.0.0.1:60403' : 'wss://chipnet.9500.cash:443');
const chain: ChainReader = {
  getHistory: (lockingBytecode) => server.getHistory(lockingBytecode),
  getTransaction: (transactionId) => server.getTransaction(transactionId),
  listUnspent: async (lockingBytecode) => (await server.listUnspent(lockingBytecode)).map((entry) => ({ ...entry, hasToken: entry.token !== undefined })),
};

// The key that pays for the run, and gets everything back.
if (local && facts.localFunder === undefined) {
  facts.localFunder = hex(crypto.getRandomValues(new Uint8Array(32)));
  keep();
}
const funder: KeyPair = keyPairFromPrivateKey(hexToBin(local ? (facts.localFunder as string) : (JSON.parse(readFileSync(`${root}.chipnet/funder-design-2.json`, 'utf8')) as { privateKey: string }).privateKey));
const funderLocking = p2pkhLockingBytecode(funder.keyHash);

/** A block: made on demand on the local chain; awaited on chipnet only where a confirmation is needed. */
const block = async (): Promise<void> => {
  if (local && !fewBlocks) await mine(1, BURN);
};
const confirmed = async (transactionId: string): Promise<void> => {
  if (local) await mine(1, BURN);
  await until(`the first confirmation of ${transactionId.slice(0, 12)}…`, async () => ((await server.confirmations(transactionId)) ?? 0) > 0);
};
/** The funder's coins without tokens, as the server lists them. */
const funderCoins = async (): Promise<Utxo[]> => {
  const coins: Utxo[] = [];
  for (const entry of await server.listUnspent(funderLocking, 'exclude')) {
    coins.push({ transactionHash: hexToBin(entry.transactionId), index: entry.index, output: { lockingBytecode: funderLocking, valueSatoshis: entry.valueSatoshis } });
  }
  return coins;
};
/** A payment from the funder, with its change back to the funder. Returns the transaction's identifier. */
const funderPays = async (outputs: Output[], options: { inputs?: Utxo[]; burn?: boolean; extraInputs?: Utxo[] } = {}): Promise<string> => {
  const coins = options.inputs ?? (await until('the funder\'s coins', async () => { const found = await funderCoins(); return found.length > 0 ? found : undefined; }));
  const built = buildTransaction({ inputs: [...coins, ...(options.extraInputs ?? [])].map((coin) => p2pkhInput(coin, funder)), outputs, changeLockingBytecode: funderLocking, allowTokenBurn: options.burn === true });
  const check = checkBeforeSending(built);
  if (check !== true) throw new Error(`a payment of the funder fails the check before sending: ${check}`);
  const result = await server.broadcast(hex(built.encoded));
  if (!result.accepted && !/already/i.test(result.reason)) throw new Error(`a payment of the funder was refused: ${result.reason}`);
  // The next payment spends this one's change: wait until the server lists it.
  await until('the funder\'s change', async () => (await server.getTransaction(built.transactionId)) !== undefined, 60_000);
  await wait(local ? 1_200 : 2_000);
  return built.transactionId;
};

const openAccount = async (words: string): Promise<Account> => {
  const electrumServers = local
    ? await regtestServers()
    : (() => {
        const [first] = resolveElectrumServersForNetwork(XO_SUPPORTED_NETWORKS.chipnet);
        if (first === undefined) throw new Error('the engine names no chipnet server');
        // One server. With several, the engine's network package takes the first answer to a request for a new
        // block's header, and a server that has not seen the block yet answers first, with nothing: the process ends.
        return [{ host: 'chipnet.9500.cash', version: first.version, transports: { wss: 443 }, blockchain: first.blockchain }];
      })();
  return Account.open(await Engine.create(words, { network: XO_SUPPORTED_NETWORKS.chipnet, electrumServers }));
};
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

/** The Savings Jar as its page presents it to a wallet: the two texts, and the names a request gives them. */
const jarTemplate = readTemplate(savingsJarTemplateText);
const jarNames = { identifier: jarTemplate.identifier, contentHash: jarTemplate.contentHash, declaration: textHash(savingsJarDeclarationText) };
const jarTexts = { template: savingsJarTemplateText, declaration: savingsJarDeclarationText };
const medianTime = async (height: number): Promise<number> => {
  const times = await Promise.all(Array.from({ length: 11 }, (_, back) => server.headerTime(Math.max(height - back, 0))));
  return times.sort((a, b) => a - b)[5] as number;
};
/** The key of the run's jar, as the wallet lists it. */
const jarKey = async (applications: Applications, wanted?: (token: HeldToken) => boolean): Promise<HeldToken> =>
  until('the jar, found from its key', async () => {
    const token = (await applications.tokens()).find((held) => held.category === facts.jar?.category);
    return token !== undefined && token.meaning === 'position' && (wanted === undefined || wanted(token)) ? token : undefined;
  });

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
      if (BigInt(facts.funderAtStart) < 150_000n) throw new Error(`The funding address holds ${facts.funderAtStart} satoshis; the run needs 150,000.`);
    }
    account = await openAccount(facts.words.owner);
    const wallet = await OwnerWallet.open({ backend: account, chain, seed: ownerSeed, ...(facts.ownerState === undefined ? {} : { state: facts.ownerState }), save: (state) => { facts.ownerState = state; keep(); } });

    const funding = await wallet.fundingAddress();
    await once('the wallet is funded', async () => ({ transactionIds: [await funderPays([{ lockingBytecode: funding, valueSatoshis: 80_000n }])] }));
    if ((await wallet.creationStep()) !== 'created') {
      await until('the funding coin in the engine', async () => (await wallet.creationStep()) !== 'not funded');
      await wallet.create({ recovererKeyHash: credential.recoveryKey.keyHash, challengeDelay: { unit: 'time512', value: 1 } });
      // The recoverer's balance, paid here from the run's own coins; the owner gives the recoverer nothing. In this
      // run the recoverer keeps its balance under the same words as its credential for the wallet.
      await wallet.pay([{ lockingBytecode: p2pkhLockingBytecode(credential.feeKey.keyHash), valueSatoshis: RECOVERER_COINS }]);
      facts.identity = wallet.stored.identity as string;
      keep();
      // The wallet is in use as soon as the network has its creation; no block is waited for.
    }
    for (const [step, transactionId, about] of [
      ['prepare', wallet.stored.creation.prepareTransactionId, 'the wallet pays itself, to have a coin that is output 0; this transaction is the identity'],
      ['create', wallet.stored.creation.createTransactionId, 'the controller and the rest'],
    ] as const) {
      if (transactionId === undefined) continue;
      const bytes = ((await until('the transaction', async () => server.getTransaction(transactionId))) as string).length / 2;
      record(step, { transactionId, bytes, feeSatoshis: BigInt(bytes) }, about);
    }
    note(`Recovery is shown as "${wallet.recovery}" while no receipt of the recoverer exists.`);
    // What the wallet holds at its own addresses is followed exactly, so that no step works from a list the engine has not yet brought up to date.
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

    // The backup: an archive on two stores. The template is stored there before its first action.
    if (facts.ownerArrangement === undefined) {
      facts.ownerArrangement = { archive: newArchive(STORES), earlierArchives: [], earlierViewingKeyRecords: [] };
      keep();
    }
    const applications = new Applications(wallet.parts, { archive: applicationArchive({ arrangement: () => facts.ownerArrangement, storeAt, seed: ownerSeed, identity, chain }) });

    // The jar's date: five minutes of the chain's time from now. The recovery's waiting period is longer.
    if (facts.jar === undefined) {
      facts.jar = { unlockTime: (await server.tip()).time + 300 };
      keep();
    }
    const { unlockTime } = facts.jar;
    // What the application's page asks of the wallet. The wallet fills in the key's category and its own addresses.
    const open: ApplicationAction = {
      template: jarNames,
      presented: jarTexts,
      action: 'open',
      role: 'saver',
      variables: { unlockTime, unlockTimeBytes: hex(unlockTimeBytes(unlockTime)), savedSatoshis: 30_000 },
      application: 'the jar page',
    };
    const opened = await once('the owner opens a jar', async () => {
      const preview = await applications.preview(open);
      note(`Before the first action the wallet showed the template "${preview.template.name}" as "${preview.template.verdict.statement}", said that it would be stored in the backup first (${preview.firstUse}), and showed its own figures: ${preview.figures.toOthers[0]?.satoshis} satoshis to "${preview.figures.toOthers[0]?.name}", a fee of ${preview.figures.feeSatoshis}${preview.figures.payingItself === undefined ? '' : `, after paying itself first for a fee of ${preview.figures.payingItself.feeSatoshis}, to have a coin that can define the key`}.`);
      const outcome = await applications.carryOut(open);
      (facts.jar as { category?: string }).category = outcome.tokens[0]?.category as string;
      keep();
      record('open the jar', outcome.sent, 'an action of the application\'s template: 30,000 satoshis into the jar, the key to a fresh address of the wallet');
      return { transactionIds: [outcome.transactionId], data: { fee: String(outcome.sent.feeSatoshis) } };
    });
    void opened;
    await block();
    const key = await jarKey(applications, (token) => token.position?.status === 'open');
    const jarAt = savingsJarScript(hexToBin(key.category), unlockTime).lockingBytecode;
    note(`The wallet finds the jar from its key: ${key.position?.status}, ${key.position?.satoshis} satoshis, at the address the application's own code gives for that key (${key.position?.lockingBytecode === hex(jarAt)}).`, 'the jar is found');
    await once('emptying before the date is refused', async () => {
      const early = await applications.carryOut(applications.actionOn(key, 'withdraw')).then(
        () => 'UNEXPECTED: accepted',
        (error: unknown) => String((error as Error).message),
      );
      note(`Emptying the jar before its date was refused by the network: ${/non-final/i.test(early) ? '"non-final"' : early.slice(0, 100)}.`);
      return undefined;
    });
    const balance = await until('the wallet after opening the jar', async () => { const now = await wallet.balance(); return now.tokens.length === 1 && now.recoverable > 0n ? now : undefined; });
    facts.held = String(balance.recoverable + balance.tokens.reduce((sum, coin) => sum + coin.utxo.output.valueSatoshis, 0n));
    keep();
    note(`The old device holds ${facts.held} satoshis at its addresses, the jar's key among them, and 30,000 satoshis are in the jar. Then the device is lost.`, 'what the old device holds');
  }

  if (phase === 'the recoverer recovers') {
    const identity = hexToBin(facts.identity as string);
    account = await openAccount(facts.words.credential);
    const funds = await RecovererFunds.open({ backend: account, chain });
    const recoverer = await RecovererWallet.open({ funds, chain, identity, recoveryKey: credential.recoveryKey });
    const fees = recoveryFees();
    const before = await recoverer.state();
    if (hex(before.ownerKeyHash) !== hex(newSeed.controllerKey.keyHash)) {
      if (before.status === 'active') {
        const holds = await until('the recoverer\'s balance', async () => { const now = await funds.balance(); return now >= fees.request + fees.completion ? now : undefined; });
        note(`The recoverer's balance holds ${holds} satoshis: enough for a request (${fees.request}) and a completion (${fees.completion}).`);
        const requested = await recoverer.request(newSeed.controllerKey.keyHash);
        record('request', requested, 'the recoverer names the new device\'s key; paid from its balance in the same transaction');
        await confirmed(requested.transactionId);
      }
      await until('the request in the engine', async () => (await recoverer.state()).status === 'pending');
      let early = '';
      try {
        record('complete', await recoverer.complete(), 'UNEXPECTED: accepted before the waiting period');
      } catch (error) {
        early = String((error as Error).message);
      }
      note(`Completing right after the request was refused: ${/non-?BIP68-final/i.test(early) ? '"non-BIP68-final"' : early.slice(0, 80)}.`);
      // The waiting period: 512 seconds of the chain's own time.
      if (local) {
        const now = (await rpc('getblockheader', await rpc('getbestblockhash'))).time as number;
        await rpc('setmocktime', now + 700);
        await mine(11, BURN);
      }
      // The network counts the waiting period on the chain's own clock: the median of the last eleven block times,
      // from the block before the one that holds the request. The recoverer waits for that, then completes.
      const startedWaiting = Date.now();
      await until(
        'the waiting period on the chain\'s clock',
        async () => {
          const request = (await readControllerHistory(chain, identity)).transactions.at(-1);
          const confirmations = request === undefined ? 0 : ((await server.confirmations(request.transactionId)) ?? 0);
          if (confirmations < 1) return false;
          const tip = await server.tip();
          return (await medianTime(tip.height)) >= (await medianTime(tip.height - confirmations)) + 512;
        },
        40 * 60_000,
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
        40 * 60_000,
        local ? 500 : 30_000,
      );
      record('complete', completed, `after the waiting period${local ? '' : ` (${Math.round((Date.now() - startedWaiting) / 60_000)} minutes)`}; no coin has moved`);
      if (local) await rpc('setmocktime', 0);
      await block();
    }
  }

  if (phase === 'the new device finds the jar') {
    const identity = hexToBin(facts.identity as string);
    account = await openAccount(facts.words.next);
    const save = (state: OwnerWalletState): void => { facts.newState = state; keep(); };
    // The recoverer hands over the identity, the earlier seed's viewing key and the access to the earlier archive.
    const wallet = facts.newState === undefined
      ? await OwnerWallet.takeOver({ backend: account, chain, seed: newSeed, identity, earlierViewingKeys: [ownerSeed.viewingKey], save })
      : await OwnerWallet.open({ backend: account, chain, seed: newSeed, state: facts.newState, save });
    if ((await wallet.checkOwnership()) === 'closed') {
      say('  (the wallet is closed: done before)');
    } else {
      const { unlockTime } = facts.jar as { unlockTime: number };
      const jarAt = savingsJarScript(hexToBin(facts.jar?.category as string), unlockTime).lockingBytecode;
      const full = await wallet.search();
      note(`The new device's search over both seeds ended as "${full.status}".`, 'the search');
      if (facts.steps['the new device sweeps'] === undefined) {
        await until('the earlier coins in the engine', async () => (await wallet.balance()).toSweep === BigInt(facts.held as string));
        const sent = await wallet.sweepEarlier();
        for (const transaction of sent.transactions) record('sweep', transaction, `${sent.coins} coins of the earlier seed, the jar's key among them, to addresses of the new seed`);
        note(`The sweep reported the jar's key as a token of ${sent.tokens[0]?.meaning} meaning: the wallet moves what it does not understand.`);
        facts.steps['the new device sweeps'] = { transactionIds: sent.transactions.map((transaction) => transaction.transactionId) };
        keep();
      }
      await block();
      await until('the swept key at an address of the new seed', async () => { const now = await wallet.balance(); return now.toSweep === 0n && now.tokens.length === 1; });

      // The new device's own archive, with the earlier one's records copied into it (section 10.6).
      if (facts.newArrangement === undefined || (facts.newArrangement.copiedArchives ?? []).length === 0) {
        const copied = await copyEarlierArchives({ arrangement: facts.newArrangement ?? { archive: newArchive(STORES), earlierArchives: [(facts.ownerArrangement as RecoveryArrangement).archive], earlierViewingKeyRecords: [] }, storeAt });
        facts.newArrangement = copied.arrangement;
        keep();
        if (copied.unfinished.length > 0) throw new Error(`the earlier archive was not copied in full: ${copied.unfinished.join(' ')}`);
      }
      const applications = new Applications(wallet.parts, { archive: applicationArchive({ arrangement: () => facts.newArrangement, storeAt, seed: newSeed, identity, chain }) });
      // No application takes part from here on: no session, no request, no page. The device has the backup and the chain.
      await once('the new device reads the backup', async () => {
        const before = (await applications.tokens()).find((token) => token.category === facts.jar?.category);
        const found = await applications.readBackup();
        const noted = (await applications.tokens()).find((token) => token.category === facts.jar?.category);
        note(`Before reading the backup the new device listed the swept key as a token of ${before?.meaning} meaning. The backup held ${found.suggested} template that the earlier owner had stored and ${found.notes} note. The device then listed the key as "${noted?.meaning}": ${noted?.reason}`);
        const [suggested] = applications.suggestions;
        if (suggested === undefined || suggested.identifier !== jarNames.identifier) throw new Error('the backup did not hold the jar\'s template');
        const summary = applications.describe(suggested, suggested.texts);
        note(`The earlier owner's record does not make the template trusted on the new device: it was offered as "${summary.name}", shown as "${summary.verdict.statement}", and trusted on the user's word.`);
        await applications.trust(suggested, undefined);
        return undefined;
      });
      const found = await jarKey(applications, (token) => token.position?.status === 'open');
      note(`The new device finds the jar from the swept key and the template, with the application's site not consulted: ${found.position?.status}, ${found.position?.satoshis} satoshis; the template offers "${found.actions?.map((action) => action.name).join('" and "')}".`, 'the jar is found again');

      /** The network takes a withdrawal once the median time of recent blocks has passed the jar's date. */
      const dateHasPassed = async (): Promise<void> => {
        await until(
          'the jar\'s date on the chain\'s clock',
          async () => {
            if ((await medianTime((await server.tip()).height)) > unlockTime) return true;
            if (local) {
              await rpc('setmocktime', unlockTime + 700);
              await mine(11, BURN);
              await rpc('setmocktime', 0);
            }
            return false;
          },
          40 * 60_000,
          local ? 500 : 30_000,
        );
      };
      await once('the new device empties the jar', async () => {
        await dateHasPassed();
        const preview = await applications.preview(applications.actionOn(found, 'withdraw'));
        const outcome = await applications.carryOut(applications.actionOn(found, 'withdraw'));
        record('empty the jar', outcome.sent, `the jar's ${preview.figures.fromApplication.coins} coin and the key in one transaction; the savings and the key to addresses of the new seed`);
        if (outcome.tokens[0]?.category !== facts.jar?.category) throw new Error('the key did not come back');
        return { transactionIds: [outcome.transactionId] };
      });
      await block();
      const emptied = await jarKey(applications, (token) => token.position?.status === 'closed');
      note(`After the withdrawal the key is still in the wallet (at ${emptied.place === 'address' ? 'an address of the new seed' : emptied.place}); the jar holds ${emptied.position?.satoshis} satoshis.`, 'the key is kept');

      // Someone pays into the jar again, with an ordinary payment to its address.
      await once('someone pays into the jar again', async () => ({ transactionIds: [await funderPays([{ lockingBytecode: jarAt, valueSatoshis: 8_000n }])] }));
      await block();
      await once('the new deposit is withdrawn too', async () => {
        const again = await jarKey(applications, (token) => token.position?.status === 'open' && token.position.satoshis === 8_000n);
        const outcome = await applications.carryOut(applications.actionOn(again, 'withdraw'));
        record('empty the jar again', outcome.sent, '8,000 satoshis that someone paid in after the first withdrawal, with the same key');
        return { transactionIds: [outcome.transactionId] };
      });
      await block();
      await jarKey(applications, (token) => token.position?.status === 'closed');

      // The run has no further use for the wallet: the key goes to the run's own address, and the wallet is closed.
      await once('the key is sent on', async () => {
        const holding = await until('the key', async () => { const now = await wallet.balance(); return now.tokens.length === 1 && now.toSweep === 0n ? now.tokens[0] : undefined; });
        const sent = await wallet.sendToken(holding, funderLocking);
        record('send the key on', sent, 'unchanged, to the address that paid for the run');
        return { transactionIds: [sent.transactionId] };
      });
      await block();
      await until('the wallet without a token', async () => (await wallet.balance()).tokens.length === 0);
      // Everything the engine was shown is spent or settled before the last coins are counted.
      await wait(local ? 1_500 : 5_000);
      const closing = await wallet.close(funderLocking);
      for (const sent of closing.transactions) record('close', sent, 'everything, and the controller\'s value, back to the address that paid for the run');
      await block();
    }
    const history = await until('the closing', async () => { const read = await readControllerHistory(chain, identity); return read.closed === undefined ? undefined : read; });
    note(`The controller's history: ${history.transitions.map((step) => step.kind).join(', ')}, then closed. It has had ${history.owners.length} owners.`);
  }

  if (phase === 'the recoverer returns its balance') {
    await once('the recoverer returns its balance', async () => {
      account = await openAccount(facts.words.credential);
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
    // The jar is empty and the run is over: the funder destroys the key and takes the satoshis under it.
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
    // Nothing of the run is left anywhere else.
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
  if (local) await rpc('setmocktime', 0).catch(() => undefined);
  await server.disconnect().catch(() => undefined);
  await account?.close();
  process.exit();
}
