// Run B of the implementation plan: the wallet's whole life through its own code, on the XO engine.
//
// An owner's wallet is created and used (addresses given out, a vault address, an NFT, a payment); the
// device is lost; the recoverer requests, waits and completes; a new device takes over, runs both passes
// over the earlier seed, sweeps, pays, sends the NFT on and closes the wallet; the recoverer sends what
// is left of its balance back. At the end every coin is back at the address that paid for the run.
//
// One script, two chains: the local node (regtest) and chipnet. Only what a chain needs differs: where the
// first coins come from, how a block comes about, and how the waiting period passes.
//
// Only one engine can be open in a process, so each part is a process of its own with an empty engine
// state, as a device session would be. Every step is written to the run's file before and after it is
// carried out; a run that stops is started again with the same command and continues.
//
// usage (from packages/app):
//   npx tsx ../../scripts/run-b.ts local      with the local node running (deploy/regtest/regtest.sh)
//   npx tsx ../../scripts/run-b.ts chipnet    paid from the key in .chipnet/funder-design-2.json
//
// Two switches rehearse on the local node what chipnet brings:
//   --few-blocks        a block is made only where the run waits for a confirmation, as on a chain whose blocks come when they come
//   STOP_AFTER=<step>   the run stops after the named step, to be continued with the same command
import 'fake-indexeddb/auto';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { type Output, binToHex, generateBip39Mnemonic, hexToBin } from '@bitauth/libauth';
import {
  type ChainReader,
  type KeyPair,
  type Utxo,
  ADDRESS_KIND,
  buildTransaction,
  checkBeforeSending,
  deriveCredentialKeys,
  deriveSeedKeys,
  keyPairFromPrivateKey,
  p2pkhInput,
  p2pkhLockingBytecode,
  readControllerHistory,
  smallestOutputValue,
} from '@grandmas-wallet/core';
import { Engine, XO_SUPPORTED_NETWORKS, resolveElectrumServersForNetwork } from '@xo-cash/engine';

import { Electrum } from '../packages/chipnet/src/electrum.js';
import { type OwnerWalletState, Account, OwnerWallet, RecovererFunds, RecovererWallet, recoveryFees, walletTemplateNumbers } from '../packages/app/src/index.js';
// @ts-expect-error a plain script: the engine's settings for the local chain, and the node's RPC
import { regtestServers, rpc, mine, BURN } from '../spikes/xo-engine/regtest.mjs';

const hex = binToHex;
const root = fileURLToPath(new URL('..', import.meta.url));
const [chainName, phase] = process.argv.slice(2).filter((word) => !word.startsWith('--'));
const fewBlocks = process.argv.includes('--few-blocks');
if (chainName !== 'local' && chainName !== 'chipnet') {
  console.error('usage: npx tsx ../../scripts/run-b.ts <local|chipnet>');
  process.exit(2);
}
const local = chainName === 'local';
/** The exit code of a part that stopped at a step of its own and said why. */
const STOPPED = 3;
const PHASES = ['the owner uses the wallet', 'the recoverer recovers', 'the new device takes over', 'the recoverer returns its balance', 'the run returns what is left'];
mkdirSync(`${root}.chipnet`, { recursive: true });
const stateFile = `${root}.chipnet/run-b-${chainName}.json`;
const logFile = `${root}docs/runs/stage-5-${local ? 'local-node' : 'chipnet'}.md`;

interface Entry { step: string; transactionId: string; bytes: number; fee: string; note: string }
interface Facts {
  startedAt: string;
  words: { owner: string; next: string; credential: string };
  /** The key that pays for the run on the local chain. On chipnet it is the saved funding key. */
  localFunder?: string;
  identity?: string;
  ownerState?: OwnerWalletState;
  newState?: OwnerWalletState;
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
  if (local && !existsSync(stateFile) && Number(execFileSync(`${root}deploy/regtest/regtest.sh`, ['cli', 'getblockcount'], { encoding: 'utf8' })) > 300) {
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
      `# Stage 5 run on ${local ? 'the local node' : 'chipnet (run B)'}: the wallet's whole life through its own code`,
      '',
      `Written by the run itself (\`scripts/run-b.ts ${chainName}\`). The owner's wallet, the recoverer and the new device, each on the XO engine with the wallet's templates${local ? ', against the local node in regtest mode with the public networks\' relay rules' : ', on chipnet'}. Each part ran in a process of its own with an empty engine state. Every transaction was built and signed by the engine from what the wallet's code decided, and passed this project's check before it was sent.`,
      '',
      `- Wallet identity: \`${facts.identity}\``,
      `- Repository at commit \`${revision}\``,
      `- Started ${facts.startedAt}`,
      ...(local ? [] : [
        '- The engine ran with the local fix for chipnet\'s block timing (`docs/xo-chipnet-header-verification.md`); without it its header check stops below the tip.',
        '- The engine was given one server. With three, the first start of this run ended while waiting for a block: the engine\'s network package asks every server for a new block\'s header and takes the first answer, and a server that had not seen the block yet answered first, with nothing. The run was continued with the same command.',
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

// ------------------------------------------------------------------ the parts

try {
  say(phase);

  if (phase === 'the owner uses the wallet') {
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
    const arrived = BigInt(created['recoverable'] as string) + 21_000n;

    // Addresses are given out once; a run that continues uses the same ones.
    const given = await once('addresses are given out', async () => ({
      data: {
        first: (await wallet.receiveAddress()).address.number,
        second: (await wallet.receiveAddress()).address.number,
        token: (await wallet.receiveAddress()).address.number,
        vault: (await wallet.vaultAddress()).address.number,
      },
    }));
    const at = (kind: 0 | 2, name: string): Uint8Array => wallet.address(kind, given[name] as number).lockingBytecode;
    await once('someone pays the first address', async () => ({ transactionIds: [await funderPays([{ lockingBytecode: at(ADDRESS_KIND.givenOut, 'first'), valueSatoshis: 12_000n }])] }));
    await once('someone pays the second address', async () => ({ transactionIds: [await funderPays([{ lockingBytecode: at(ADDRESS_KIND.givenOut, 'second'), valueSatoshis: 9_000n }])] }));
    await once('someone pays the vault address', async () => ({ transactionIds: [await funderPays([{ lockingBytecode: at(ADDRESS_KIND.vault, 'vault'), valueSatoshis: 6_000n }])] }));
    // An NFT: a new category, made from a coin that is output 0 of its transaction, sent to an address of the wallet.
    const seedCoin = await once('a coin for a new token category', async () => {
      const transactionId = await funderPays([{ lockingBytecode: funderLocking, valueSatoshis: 3_000n }]);
      return { transactionIds: [transactionId], data: { transactionId } };
    });
    await once('an NFT is sent to the wallet', async () => {
      const category = hexToBin(seedCoin['transactionId'] as string);
      const genesis: Utxo = { transactionHash: category, index: 0, output: { lockingBytecode: funderLocking, valueSatoshis: 3_000n } };
      const others = (await funderCoins()).filter((coin) => !(hex(coin.transactionHash) === hex(category) && coin.index === 0));
      const transactionId = await funderPays([{ lockingBytecode: at(ADDRESS_KIND.givenOut, 'token'), valueSatoshis: 1_000n, token: { amount: 0n, category, nft: { capability: 'none', commitment: Uint8Array.of(0xca, 0xfe) } } }], { inputs: [genesis, ...others] });
      return { transactionIds: [transactionId] };
    });
    await block();
    const paid = await once('the owner pays', async () => {
      await until('the coins and the NFT in the wallet', async () => { const balance = await wallet.balance(); return balance.vault === 6_000n && balance.tokens.length === 1 && balance.recoverable === arrived; });
      const sent = await wallet.pay([{ lockingBytecode: funderLocking, valueSatoshis: 5_000n }]);
      record('pay', sent, 'an everyday payment by key');
      return { transactionIds: [sent.transactionId], data: { recoverable: String(arrived - 5_000n - sent.feeSatoshis) } };
    });
    await block();
    const balance = await until('the wallet after the payment', async () => { const now = await wallet.balance(); return now.recoverable === BigInt(paid['recoverable'] as string) ? now : undefined; });
    facts.held = String(balance.recoverable + balance.vault + 1_000n);
    keep();
    note(`The old device holds ${facts.held} satoshis at addresses given out, change addresses and a vault address, and an NFT. Then it is lost.`);
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
      const medianTime = async (height: number): Promise<number> => {
        const times = await Promise.all(Array.from({ length: 11 }, (_, back) => server.headerTime(height - back)));
        return times.sort((a, b) => a - b)[5] as number;
      };
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

  if (phase === 'the new device takes over') {
    const identity = hexToBin(facts.identity as string);
    account = await openAccount(facts.words.next);
    const save = (state: OwnerWalletState): void => { facts.newState = state; keep(); };
    // The recoverer hands over the identity and the earlier seed's viewing key.
    const wallet = facts.newState === undefined
      ? await OwnerWallet.takeOver({ backend: account, chain, seed: newSeed, identity, earlierViewingKeys: [ownerSeed.viewingKey], save })
      : await OwnerWallet.open({ backend: account, chain, seed: newSeed, state: facts.newState, save });
    if ((await wallet.checkOwnership()) === 'closed') {
      say('  (the wallet is closed: done before)');
    } else {
      const quick = await wallet.search({ passes: ['quick'] });
      note(`The new device's quick pass found ${quick.coins.length} coins; the wallet was then reported as "${quick.status}", not as fully found.`, 'the quick pass');
      const started = Date.now();
      const full = await wallet.search();
      note(`The full pass over both seeds (${full.seeds.reduce((sum, seed) => sum + (seed.full?.lookups ?? 0), 0)} addresses) took ${((Date.now() - started) / 1000).toFixed(0)} seconds; the wallet was then "${full.status}".`, 'the full pass');
      const holds = async (amount: bigint, tokens: number): Promise<void> => {
        await until(`the new device to hold ${amount} satoshis`, async () => { const now = await wallet.balance(); return now.recoverable === amount && now.tokens.length === tokens && now.toSweep === 0n; });
      };
      // What the sweep sent is written down as soon as it is sent, so that a run that stops here does not sweep twice.
      if (facts.steps['the new device sweeps'] === undefined) {
        const toSweep = await until('the earlier coins in the engine', async () => { const now = await wallet.balance(); return now.toSweep === BigInt(facts.held as string) ? now.toSweep : undefined; });
        const sent = await wallet.sweepEarlier();
        for (const transaction of sent.transactions) record('sweep', transaction, `${sent.coins} coins of the earlier seed, the vault coin and the NFT among them, to an address of the new seed`);
        const fees = sent.transactions.reduce((sum, transaction) => sum + transaction.feeSatoshis, 0n);
        // The NFT keeps the 1,000 satoshis under it; everything else, less the fee, is at the new seed's addresses.
        facts.steps['the new device sweeps'] = { transactionIds: sent.transactions.map((transaction) => transaction.transactionId), data: { recoverable: String(toSweep - fees - 1_000n) } };
        keep();
      }
      await block();
      const swept = BigInt(facts.steps['the new device sweeps']?.data?.['recoverable'] as string);
      const paid = await once('the new owner pays', async () => {
        await holds(swept, 1);
        note(`After the sweep the new device holds everything at its own addresses: ${swept} satoshis, and the NFT, which it reports as a token of unknown meaning. Its coins pay for cancelling a request: ${await wallet.canCancel()}.`);
        const sent = await wallet.pay([{ lockingBytecode: funderLocking, valueSatoshis: 4_000n }]);
        record('pay', sent, 'the new owner pays from what it swept, by its own key');
        return { transactionIds: [sent.transactionId], data: { recoverable: String(swept - 4_000n - sent.feeSatoshis) } };
      });
      await block();
      const afterPayment = BigInt(paid['recoverable'] as string);
      const passed = await once('the NFT is sent on', async () => {
        await holds(afterPayment, 1);
        const holding = await until('the NFT', async () => (await wallet.balance()).tokens[0]);
        const sent = await wallet.sendToken(holding, funderLocking);
        record('send the NFT', sent, 'unchanged; the fee from another coin');
        // The NFT goes on with the smallest value its output may have; what was under it beyond that stays with the wallet.
        const under = holding.utxo.output.valueSatoshis - smallestOutputValue({ ...holding.utxo.output, lockingBytecode: funderLocking });
        return { transactionIds: [sent.transactionId], data: { recoverable: String(afterPayment + under - sent.feeSatoshis) } };
      });
      await block();
      await holds(BigInt(passed['recoverable'] as string), 0);
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
    // The NFT opens nothing: the funder destroys it and takes the satoshis under it.
    await once('the NFT is destroyed', async () => {
      const nfts = await until('the NFT at the funder', async () => { const found = await server.listUnspent(funderLocking, 'only'); return found.length > 0 ? found : undefined; });
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
