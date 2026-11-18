// Run E of the implementation plan, steps 2 and 3: a ParyonUSD loan through this project's wallet, from the
// Paryon template, and through the loss of the device.
//
// An owner's wallet is created on the XO engine, with a recoverer. The Paryon template and its recovery
// declaration reach the wallet as the loan's page would send them, and are stored in the backup before the
// first signature. Every action of the loan is an action of that template, carried out by the wallet's general
// route for applications (stage 7): the page's part is `packages/paryon`'s requests, which name Paryon's shared
// coins and give the values only Paryon's arithmetic gives; the wallet supplies its own coins and addresses,
// reads the rest from the chain, evaluates every input in the virtual machine, and has the engine build and sign
// each transaction as an invitation of the template. A loan key is made, the Borrowing thread is moved on, 100.00
// PUSD are borrowed, and collateral is added. The device is lost. The recoverer requests, waits and completes; a
// new device takes the wallet over, sweeps the loan key and the PUSD with everything else, takes the template
// from the backup, finds the loan from the key with the chain alone, and closes it from its own list of tokens.
// At the end the wallet is closed and everything is back at the address that paid for the run.
//
// The way out is proven right after the loan is opened, after the collateral is added, and after the takeover:
// the closing is built through the template and by plain script (step 1's builders) against the actual outputs,
// and tried with `testmempoolaccept`; neither is sent. `--emergency-close` closes the loan by plain script from
// the state file and the wallet's words alone, with the earlier seed or the new one, and sends the collateral
// and the key to the address that paid for the run.
//
// One script, two chains: the local node, on which Paryon's contracts as published are deployed by this script
// (packages/paryon/src/local-deployment.ts), and chipnet, with Paryon's own deployment. Each part is a process of
// its own with an empty engine state; every step is written to the run's file, and a run that stops continues.
//
// usage (from packages/app):
//   npx tsx ../../scripts/run-e-template.ts local
//   npx tsx ../../scripts/run-e-template.ts chipnet        with the engine's header fix: node patches/chipnet-faster-blocks.mjs
//   npx tsx ../../scripts/run-e-template.ts <chain> --emergency-close [earlier|new]
//   npx tsx ../../scripts/run-e-template.ts <chain> --emergency-close [earlier|new] --prove
//                       the same closing, built, checked and tried with testmempoolaccept, and not sent
//   npx tsx ../../scripts/run-e-template.ts <chain> --check-course
//                       before borrowing: the whole course built by step 1's builders from the earlier seed's own
//                       coin against Paryon's outputs as they are, and checked in the virtual machine; nothing sent
//
//   --state=<file>      the facts of another run instead of this run's own: the browser course of stage 9
//                       (scripts/browser-run-loan.ts) writes its wallets' words there before it funds them, so
//                       that its loan can be checked and closed from them without the browser
//
//   STOP_AFTER=<step>   the run stops after the named step, to be continued with the same command
import 'fake-indexeddb/auto';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { type Output, type TransactionCommon, binToHex, createVirtualMachineBch2025, decodeTransactionBch, generateBip39Mnemonic, hexToBin } from '@bitauth/libauth';
import { type ArchiveStore, blobIdOf } from '@grandmas-wallet/archive';
import {
  type AccountCoin,
  type BuiltTransaction,
  type ChainReader,
  type FollowedScript,
  type InputSpec,
  type KeyPair,
  type KeyedAddressKind,
  type PreparedTransaction,
  type RecoverableWalletAddress,
  type SeedKeys,
  type TransactionRequest,
  type Utxo,
  type VaultWalletAddress,
  type WalletBackend,
  buildTransaction,
  checkBeforeSending,
  deriveCredentialKeys,
  deriveSeedKeys,
  keyPairFromPrivateKey,
  p2pkhInput,
  p2pkhLockingBytecode,
  quickPass,
  readControllerHistory,
  recoverableInput,
  walletAddress,
} from '@grandmas-wallet/core';
import {
  type LoanRequest,
  type ParyonContracts,
  type ParyonDeployment,
  type ParyonState,
  type PresentedTemplate,
  CHIPNET_FAST_PERIODS_6,
  borrowRequest,
  borrowingFee,
  closeLoan,
  collateralAtRatio,
  collateralRatio,
  createKeyRequest,
  createLoanKey,
  findLoan,
  latestOraclePrice,
  localDeployment,
  manageRequest,
  minimumCollateral,
  movePeriodRequest,
  paryonContracts,
  paryonTemplateTexts,
  periodAt,
  readParyonState,
  updateBorrowingPeriod,
  borrow,
  manageLoan,
} from '@grandmas-wallet/paryon';
import { Engine, XO_SUPPORTED_NETWORKS, resolveElectrumServersForNetwork } from '@xo-cash/engine';

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
  suggestedAllowance,
  walletTemplateNumbers,
} from '../packages/app/src/index.js';
import { Electrum } from '../packages/chipnet/src/electrum.js';
import { type NodeRpc, type NodeRpcSettings, nodeRpc, testMempoolAccept } from '../packages/chipnet/src/node-rpc.js';
// @ts-expect-error a plain script: the engine's settings for the local chain, and the node's RPC
import { BURN, mine, regtestServers, rpc as localRpc } from '../spikes/xo-engine/regtest.mjs';

const hex = binToHex;
const root = fileURLToPath(new URL('..', import.meta.url));
const words = process.argv.slice(2).filter((word) => !word.startsWith('--'));
const [chainName, phase] = words;
const emergency = process.argv.includes('--emergency-close');
const proveOnly = process.argv.includes('--prove');
const checkCourseOnly = process.argv.includes('--check-course');
const otherState = process.argv.find((word) => word.startsWith('--state='))?.slice('--state='.length);
if (otherState !== undefined && !emergency && !checkCourseOnly) {
  console.error('--state= is for --emergency-close and --check-course only: the run itself keeps its own facts.');
  process.exit(2);
}
if (chainName !== 'local' && chainName !== 'chipnet') {
  console.error('usage: npx tsx ../../scripts/run-e-template.ts <local|chipnet> [--emergency-close [earlier|new]]');
  process.exit(2);
}
const local = chainName === 'local';
/** The exit code of a part that stopped at a step of its own and said why. */
const STOPPED = 3;
const PHASES = ['the owner opens a loan', 'the recoverer recovers', 'the new device closes the loan', 'the recoverer returns its fee coins', 'the run returns what is left'];
mkdirSync(`${root}.chipnet`, { recursive: true });
const stateFile = otherState ?? `${root}.chipnet/run-e-template-${chainName}.json`;
const storeDirectory = `${root}.chipnet/run-e-template-${chainName}-stores`;
const logFile = `${root}docs/runs/stage-9-template-${local ? 'local-node' : 'chipnet'}.md`;

// ------------------------------------------------------------------ amounts and safety

const DEBT = 100_00n;
/** The collateral aimed at: 125% of the debt at the lower of the stored price and the oracle's. */
const TARGET_PERCENT = 125n;
/** Below this at the lower price the record says so. */
const SAFE_PERCENT = 115n;
/** Below this at the oracle's price the run stops before borrowing. */
const FLOOR_PERCENT = 112n;
const MANAGE_ADD = 100_000n;
/** Kept in the wallet for network fees and the outputs of 1,000 satoshis the transactions make. */
const MARGIN = 60_000n;
const WALLET_CREATION = 80_000n;
/** Left at the funder for the other run that shares it. */
const LEAVE_AT_FUNDER = 600_000n;
const STARTING_INTEREST = 0;
/**
 * The engine follows the script of a coin of Paryon's when no more than this many coins are unspent there and
 * transactions are in its history, and unlocks it by the template itself; a coin at a script more share is given
 * to it with its unlocking. On chipnet every script of Paryon's has a long history (the Borrowing contract's
 * 76,637 transactions, the price contract's 17,358), so every coin of Paryon's is given there.
 */
const FOLLOW_UP_TO = Number(process.env['FOLLOW_UP_TO'] ?? 50);

interface Entry { step: string; transactionId: string; bytes: number; fee: string; note: string }
interface Facts {
  startedAt: string;
  words: { owner: string; next: string; credential: string };
  localFunder?: string;
  /** The local chain's deployment of Paryon's contracts. */
  deployment?: ParyonDeployment;
  identity?: string;
  ownerState?: OwnerWalletState;
  newState?: OwnerWalletState;
  ownerArrangement?: RecoveryArrangement;
  newArrangement?: RecoveryArrangement;
  keyCategory?: string;
  steps: Record<string, { transactionIds: string[]; data?: Record<string, number | string> }>;
  /** A transaction about to be sent, written down first, by step. */
  pending: Record<string, { transactionId: string; hex: string }>;
  finished: string[];
  funderAtStart?: string;
  amounts?: Record<string, string>;
  log: Entry[];
  notes: string[];
}

// ------------------------------------------------------------------ the driver: one process for each part

if (phase === undefined && !emergency && !checkCourseOnly) {
  if (local && !existsSync(stateFile) && Number(execFileSync(`${root}deploy/regtest/regtest.sh`, ['cli', 'getblockcount'], { encoding: 'utf8' })) > 2500) {
    console.error('The local chain is long and its block rewards are small. Start a new one: deploy/regtest/regtest.sh reset');
    process.exit(1);
  }
  const finished = existsSync(stateFile) ? (JSON.parse(readFileSync(stateFile, 'utf8')) as Facts).finished : [];
  for (const next of PHASES) {
    if (finished.includes(next)) {
      console.log(`${next}: done before`);
      continue;
    }
    let result = spawnSync('npx', ['tsx', fileURLToPath(import.meta.url), chainName, next], { stdio: 'inherit' });
    for (let again = 0; again < 3 && result.status !== 0 && result.status !== STOPPED; again += 1) {
      console.log(`"${next}" ended unexpectedly; continuing it`);
      result = spawnSync('npx', ['tsx', fileURLToPath(import.meta.url), chainName, next], { stdio: 'inherit' });
    }
    if (result.status !== 0) {
      console.error(`Stopped in "${next}". The same command continues the run. To get out of the loan by plain script: npx tsx ../../scripts/run-e-template.ts ${chainName} --emergency-close`);
      process.exit(result.status ?? 1);
    }
  }
  const facts = JSON.parse(readFileSync(stateFile, 'utf8')) as Facts;
  const revision = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const contracts = paryonContracts(facts.deployment ?? CHIPNET_FAST_PERIODS_6);
  const presented = paryonTemplateTexts(contracts);
  writeFileSync(
    logFile,
    [
      `# Stage 9 run on ${local ? 'the local node' : 'chipnet (run E, steps 2 and 3)'}: a ParyonUSD loan through the wallet from the Paryon template, and through the loss of the device`,
      '',
      `Written by the run itself (\`scripts/run-e-template.ts ${chainName}\`). The owner's wallet, the recoverer and the new device, each on the XO engine${local ? ', against the local node in regtest mode with the public networks\' relay rules, on which the run deployed Paryon\'s contracts as published' : `, on chipnet, against Paryon's deployment \`${contracts.deployment.name}\``}. Each part ran in a process of its own with an empty engine state. The Paryon template and its recovery declaration reached the wallet as texts, as the loan's page sends them (\`packages/paryon\`'s requests), and were stored in the backup before the first signature. Every transaction of the loan is an invitation of that template, built by the unmodified engine, which signed the wallet's own inputs, and compared, output by output and input by input, with what the wallet's own code had worked out. A coin of Paryon's is at a script every user of Paryon shares; where the template marks such a script as one a wallet need not track, the wallet gave the coin to the engine with the unlocking it worked out from the template (arguments and redeem script, no signature), and the engine put it into the transaction as given; each step says which coins of Paryon's the engine unlocked by the template itself and which it was given. Every input of every transaction was evaluated in the virtual machine before it was signed and again before it was sent, and each was tried with \`testmempoolaccept\` on ${local ? 'the local node' : 'the owner\'s chipnet node'} before it was sent. The wallet's code names no application: what it did for the loan came from the template, its declaration and the chain.`,
      '',
      `- Wallet identity: \`${facts.identity}\``,
      `- Loan key (token category): \`${facts.keyCategory}\``,
      `- Template "${JSON.parse(presented.template).name as string}" \`${presented.names.identifier}\`, content \`${presented.names.contentHash}\`; declaration \`${presented.names.declaration}\``,
      `- Repository at commit \`${revision}\`, with the uncommitted work of stage 9 steps 2 and 3`,
      `- Started ${facts.startedAt}`,
      ...(local ? [] : ['- The engine ran with the local fix for chipnet\'s block timing (`docs/xo-chipnet-header-verification.md`), given one server.']),
      '',
      '| Step | Transaction | Bytes | Fee (sat) | Note |',
      '| --- | --- | --- | --- | --- |',
      ...facts.log.map((entry) => `| ${entry.step} | \`${entry.transactionId}\` | ${entry.bytes} | ${entry.fee} | ${entry.note} |`),
      '',
      'Amounts:',
      '',
      ...Object.entries(facts.amounts ?? {}).filter(([name]) => !name.endsWith('(sat)')).map(([name, value]) => `- ${name}: ${value}`),
      '',
      'Also observed:',
      '',
      ...facts.notes.map((line) => `- ${line}`),
      '',
      'Outcome: passed. A loan of 100.00 PUSD was opened, managed and, after the loss of the device and a recovery, closed from the new device\'s own list of tokens, every transaction an action of the Paryon template carried out by the wallet; the wallet was closed and everything returned to the address that paid for the run.',
      '',
    ].join('\n'),
  );
  console.log(`Run complete. Log written to ${logFile.slice(root.length)}`);
  process.exit(0);
}

// ------------------------------------------------------------------ what every part shares

const facts: Facts = existsSync(stateFile)
  ? (JSON.parse(readFileSync(stateFile, 'utf8')) as Facts)
  : { startedAt: new Date().toISOString(), words: { owner: generateBip39Mnemonic(), next: generateBip39Mnemonic(), credential: generateBip39Mnemonic() }, steps: {}, pending: {}, finished: [], log: [], notes: [] };
const keep = (): void => writeFileSync(stateFile, JSON.stringify(facts, null, 1), { mode: 0o600 });
// The keys are on disk before anything is paid to them.
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
const amount = (name: string, value: string): void => {
  facts.amounts = { ...(facts.amounts ?? {}), [name]: value };
  keep();
};
const record = (step: string, sent: { transactionId: string; bytes: number; feeSatoshis: bigint }, about = ''): void => {
  if (!facts.log.some((entry) => entry.transactionId === sent.transactionId)) facts.log.push({ step, transactionId: sent.transactionId, bytes: sent.bytes, fee: String(sent.feeSatoshis), note: about });
  keep();
  say(`  ${step}: ${sent.transactionId}, ${sent.bytes} bytes, fee ${sent.feeSatoshis}${about === '' ? '' : `; ${about}`}`);
  if (sent.feeSatoshis < BigInt(sent.bytes)) throw new Error('a fee below the size');
};
/** The step being carried out, for the transaction it sends. */
let currentStep: string | undefined;
const once = async (name: string, work: () => Promise<{ transactionIds?: string[]; data?: Record<string, number | string> } | undefined>): Promise<Record<string, number | string>> => {
  if (facts.steps[name] === undefined) {
    currentStep = name;
    const done = (await work()) ?? {};
    currentStep = undefined;
    facts.steps[name] = { transactionIds: done.transactionIds ?? [], ...(done.data === undefined ? {} : { data: done.data }) };
    facts.pending = Object.fromEntries(Object.entries(facts.pending).filter(([step]) => step !== name));
    keep();
    if (process.env['STOP_AFTER'] === name) throw new Error(`stopped after "${name}", as asked`);
  } else {
    say(`  (${name}: done before)`);
  }
  return facts.steps[name]?.data ?? {};
};
const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const PATIENCE_MS = local ? 90_000 : 20 * 60_000;
const until = async <T>(what: string, check: () => Promise<T | undefined | false>, patienceMs = PATIENCE_MS, everyMs = local ? 500 : 4_000): Promise<T> => {
  const deadline = Date.now() + patienceMs;
  let announced = false;
  for (;;) {
    const found = await check();
    if (found !== undefined && found !== false) return found;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    if (!announced) say(`  waiting for ${what}`);
    announced = true;
    await wait(everyMs);
  }
};
console.error = () => undefined;

const numbers = walletTemplateNumbers();
// Another run's facts may name only the words it has so far: the recoverer's and the new device's are then absent.
const credential = (facts.words.credential === '' ? undefined : deriveCredentialKeys(facts.words.credential, 'testnet', numbers)) as ReturnType<typeof deriveCredentialKeys>;
const ownerSeed = deriveSeedKeys(facts.words.owner, 'testnet', numbers);
const newSeed = (facts.words.next === '' ? undefined : deriveSeedKeys(facts.words.next, 'testnet', numbers)) as SeedKeys;

const server = await Electrum.connect(local ? 'ws://127.0.0.1:60403' : 'wss://chipnet.9500.cash:443');
const chain: ChainReader = {
  getHistory: (lockingBytecode) => server.getHistory(lockingBytecode),
  getTransaction: (transactionId) => server.getTransaction(transactionId),
  listUnspent: async (lockingBytecode) => (await server.listUnspent(lockingBytecode)).map((entry) => ({ ...entry, hasToken: entry.token !== undefined })),
};
const rpc: NodeRpc = local ? (localRpc as NodeRpc) : nodeRpc(JSON.parse(readFileSync(`${root}.chipnet/node-rpc.json`, 'utf8')) as NodeRpcSettings);

if (local && facts.localFunder === undefined) {
  facts.localFunder = hex(crypto.getRandomValues(new Uint8Array(32)));
  keep();
}
const funder: KeyPair = keyPairFromPrivateKey(hexToBin(local ? (facts.localFunder as string) : (JSON.parse(readFileSync(`${root}.chipnet/funder-design-2.json`, 'utf8')) as { privateKey: string }).privateKey));
const funderLocking = p2pkhLockingBytecode(funder.keyHash);

const block = async (): Promise<void> => {
  if (local) await mine(1, BURN);
};
const confirmed = async (transactionId: string): Promise<void> => {
  if (local) await mine(1, BURN);
  await until(`the first confirmation of ${transactionId.slice(0, 12)}…`, async () => ((await server.confirmations(transactionId)) ?? 0) > 0);
};
const funderCoins = async (): Promise<Utxo[]> =>
  (await server.listUnspent(funderLocking, 'exclude')).map((entry) => ({ transactionHash: hexToBin(entry.transactionId), index: entry.index, output: { lockingBytecode: funderLocking, valueSatoshis: entry.valueSatoshis } }));
const funderBalance = async (): Promise<bigint> => (await funderCoins()).reduce((sum, coin) => sum + coin.output.valueSatoshis, 0n);
/**
 * A payment of the funder, from as few of its coins as cover it, largest first: another run pays from the same
 * key. A payment refused because a coin was spent meanwhile is built again.
 */
const funderPays = async (outputs: Output[], options: { burn?: boolean; extraInputs?: Utxo[]; all?: boolean } = {}): Promise<BuiltTransaction> => {
  for (let attempt = 1; ; attempt++) {
    const coins = (await until('the funder\'s coins', async () => { const found = await funderCoins(); return found.length > 0 ? found : undefined; })).sort((a, b) => (a.output.valueSatoshis > b.output.valueSatoshis ? -1 : 1));
    const needed = outputs.reduce((sum, output) => sum + output.valueSatoshis, 0n) + 5_000n;
    const chosen: Utxo[] = [];
    for (const coin of coins) {
      if (!options.all && chosen.reduce((sum, chosenCoin) => sum + chosenCoin.output.valueSatoshis, 0n) >= needed) break;
      chosen.push(coin);
    }
    const built = buildTransaction({ inputs: [...chosen, ...(options.extraInputs ?? [])].map((coin) => p2pkhInput(coin, funder)), outputs, changeLockingBytecode: funderLocking, allowTokenBurn: options.burn === true });
    const check = checkBeforeSending(built);
    if (check !== true) throw new Error(`a payment of the funder fails the check before sending: ${check}`);
    const result = await server.broadcast(hex(built.encoded));
    if (!result.accepted && !/already/i.test(result.reason)) {
      if (/missing|spent|conflict/i.test(result.reason) && attempt < 6) {
        say(`  a payment of the funder was refused ("${result.reason.slice(0, 80)}"): a coin was spent meanwhile; building it again`);
        await wait(5_000);
        continue;
      }
      throw new Error(`a payment of the funder was refused: ${result.reason}`);
    }
    await until('the funder\'s payment at the server', async () => (await server.getTransaction(built.transactionId)) !== undefined, 60_000, 1_000);
    await wait(local ? 1_200 : 2_000);
    return built;
  }
};

/** Whether the node takes a transaction, without sending it. */
const tryOnNode = async (transactionHex: string): Promise<{ allowed: true } | { allowed: false; reason: string }> => testMempoolAccept(rpc, transactionHex);

// ------------------------------------------------------------------ Paryon, as the loan's page reads it

const vm2025 = createVirtualMachineBch2025(true);
/** This project's check before sending (the 2026 rules, standard, exact fee) and the 2025 rules. */
const verified = (built: Pick<BuiltTransaction, 'transaction' | 'sourceOutputs'>, what: string): void => {
  const check = checkBeforeSending(built);
  if (check !== true) throw new Error(`${what} fails the check before sending: ${check}`);
  const earlier = vm2025.verify({ transaction: built.transaction, sourceOutputs: built.sourceOutputs });
  if (earlier !== true) throw new Error(`${what} fails under the 2025 rules: ${earlier}`);
};
const pick = <T>(items: T[], what: string): T => {
  const [first] = items;
  if (first === undefined) throw new Error(`Paryon's deployment shows no ${what}: is it still alive?`);
  return first;
};
let contractsCache: ParyonContracts | undefined;
const contracts = (): ParyonContracts => (contractsCache ??= paryonContracts(facts.deployment ?? CHIPNET_FAST_PERIODS_6));
const presented = (): PresentedTemplate => paryonTemplateTexts(contracts());
const readParyon = async (): Promise<ParyonState> => {
  const state = await readParyonState(server, contracts());
  for (const [what, list] of [['Borrowing thread', state.borrowing], ['price thread', state.price], ['loan key factory', state.loanKeyFactory], ['manage function', state.manage]] as const) {
    if (list.length === 0) throw new Error(`Paryon's deployment shows no ${what}: is it still alive?`);
  }
  return state;
};
const priceThread = (state: ParyonState) => state.price.slice().sort((a, b) => Number(b.state.price - a.state.price))[0] as ParyonState['price'][number];
const dollars = (cents: bigint): string => `$${(Number(cents) / 100).toFixed(2)}`;
const sat = (value: bigint): string => `${value.toLocaleString('en-US')} sat`;
interface Prices { stored: bigint; oracle: bigint; oracleTime: number; lower: bigint }
const prices = async (state: ParyonState): Promise<Prices> => {
  const stored = state.price.reduce((lowest, thread) => (thread.state.price < lowest ? thread.state.price : lowest), priceThread(state).state.price);
  if (local) return { stored, oracle: stored, oracleTime: 0, lower: stored };
  const oracle = await latestOraclePrice(contracts().deployment);
  return { stored, oracle: oracle.price, oracleTime: oracle.time, lower: stored < oracle.price ? stored : oracle.price };
};
/**
 * The highest height a lock time may name for the node to take the transaction now. On mainnet and the local
 * node that is the last block's height. Chipnet runs the tentative upgrade of May 2027, and compares a lock
 * time given as a height with the height the chain would have at ten-minute blocks (`blocks_ticks` / 600).
 */
const lockHeight = async (): Promise<number> => {
  const info = await rpc<{ blocks: number; blocks_ticks?: number }>('getblockchaininfo');
  return info.blocks_ticks === undefined ? info.blocks : Math.min(info.blocks, Math.floor(info.blocks_ticks / 600));
};

// ------------------------------------------------------------------ the engine, with a check before each send

const openAccount = async (mnemonic: string): Promise<Account> => {
  const electrumServers = local
    ? await regtestServers()
    : (() => {
        const [first] = resolveElectrumServersForNetwork(XO_SUPPORTED_NETWORKS.chipnet);
        if (first === undefined) throw new Error('the engine names no chipnet server');
        return [{ host: 'chipnet.9500.cash', version: first.version, transports: { wss: 443 }, blockchain: first.blockchain }];
      })();
  return Account.open(await Engine.create(mnemonic, { network: XO_SUPPORTED_NETWORKS.chipnet, electrumServers }));
};

/** A transaction the run had built and checked, and not sent: the way out, proven. */
class NotSent extends Error {
  constructor(readonly prepared: PreparedTransaction) {
    super('not sent: the way out was only to be proven');
  }
}

/**
 * The account, with the run's check before every send: the transaction is written down first and tried on the
 * node; a refusal stops the run. In a dry run the transaction is handed back and nothing is sent.
 */
class CheckedBackend implements WalletBackend {
  dryRun = false;
  constructor(private readonly account: Account) {}
  controllerKey = (role: Parameters<WalletBackend['controllerKey']>[0]) => this.account.controllerKey(role);
  ordinaryAddress = () => this.account.ordinaryAddress();
  knowController = (identity: Uint8Array, role: Parameters<WalletBackend['knowController']>[1], currentState?: Uint8Array) => this.account.knowController(identity, role, currentState);
  nextAddress = (kind: KeyedAddressKind, tag: Uint8Array) => this.account.nextAddress(kind, tag);
  addressCount = (kind: KeyedAddressKind) => this.account.addressCount(kind);
  knowEarlierAddress = (identity: Uint8Array, address: RecoverableWalletAddress) => this.account.knowEarlierAddress(identity, address);
  knowVaultAddress = (identity: Uint8Array, address: VaultWalletAddress) => this.account.knowVaultAddress(identity, address);
  coins = () => this.account.coins();
  /** The last transaction asked of the engine. */
  lastRequest: TransactionRequest | undefined;
  prepare = (request: TransactionRequest) => {
    this.lastRequest = request;
    return this.account.prepare(request);
  };
  discard = (invitation: string) => this.account.discard(invitation);
  importTemplate = (text: string) => this.account.importTemplate(text);
  followScript = (script: FollowedScript) => this.account.followScript(script);
  async send(prepared: PreparedTransaction): Promise<string> {
    if (this.dryRun) {
      await this.account.discard(prepared.invitationIdentifier);
      throw new NotSent(prepared);
    }
    const tried = await tryOnNode(prepared.transactionHex);
    if (!tried.allowed) {
      await this.account.discard(prepared.invitationIdentifier);
      throw new Error(`testmempoolaccept refused ${currentStep ?? 'a transaction'}: ${tried.reason}`);
    }
    if (currentStep !== undefined) {
      facts.pending[currentStep] = { transactionId: prepared.transactionId, hex: prepared.transactionHex };
      keep();
    }
    return this.account.send(prepared);
  }
}

let account: Account | undefined;
let backendInUse: CheckedBackend | undefined;
/** A backup store kept as a directory of the run, as a store server keeps its blobs. */
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

/** A request of the page's, as the wallet's session turns it into an action. */
const asked = (request: LoanRequest): ApplicationAction => ({
  template: request.template,
  presented: presented().texts,
  action: request.templateAction,
  role: request.role,
  variables: request.variables,
  ...(request.bindings === undefined ? {} : { bindings: request.bindings }),
  ...(request.creates === undefined ? {} : { creates: request.creates }),
  ...(request.spends === undefined ? {} : { tokens: request.spends }),
  ...(request.inputs === undefined ? {} : { inputs: request.inputs }),
  application: 'the loan page',
});

const decoded = async (transactionId: string): Promise<TransactionCommon> => {
  const text = await until(`transaction ${transactionId.slice(0, 12)}…`, async () => server.getTransaction(transactionId), 60_000, 1_000);
  const transaction = decodeTransactionBch(hexToBin(text));
  if (typeof transaction === 'string') throw new Error(transaction);
  return transaction;
};
const outputAt = async (transactionId: string, index: number): Promise<Utxo> => ({ transactionHash: hexToBin(transactionId), index, output: (await decoded(transactionId)).outputs[index] as Output });

/** The wallet's address of a seed that holds a coin, found by its own derivation; and the input that spends the coin by key. */
const spendByKey = (seed: SeedKeys, utxo: Utxo): InputSpec => {
  const identity = hexToBin(facts.identity as string);
  const at = hex(utxo.output.lockingBytecode);
  for (let number = 0; number < 400; number++) {
    for (const kind of [0, 1] as const) {
      const address = walletAddress(identity, seed.viewingKey, kind, number) as RecoverableWalletAddress;
      if (hex(address.lockingBytecode) === at) return recoverableInput(utxo, address.script, seed.addressKey(kind, number));
    }
  }
  throw new Error('the coin is not at an address of that seed');
};
/** Coins of a seed with a token of a category, found by looking up its addresses on chain. */
const coinsOfSeed = async (seed: SeedKeys, category: string): Promise<Utxo[]> => {
  const identity = hexToBin(facts.identity as string);
  const found: Utxo[] = [];
  for (let start = 0; start < 120; start += 20) {
    const addresses = Array.from({ length: 20 }, (_, offset) => [0, 1].map((kind) => walletAddress(identity, seed.viewingKey, kind as 0 | 1, start + offset))).flat();
    const lists = await Promise.all(addresses.map((address) => server.listUnspent(address.lockingBytecode)));
    for (const list of lists) {
      for (const entry of list) {
        if (entry.token?.category !== category) continue;
        found.push(await outputAt(entry.transactionId, entry.index));
      }
    }
  }
  return found;
};

/**
 * The loan's way out, by plain script: step 1's builder closes the loan against the outputs as they are, with
 * the key and the PUSD spent by the given seed's address keys. Checked, and tried on the node; sent only in an
 * emergency, with the collateral and the key to the address that paid for the run.
 */
const plainClose = async (seed: SeedKeys, send: boolean): Promise<BuiltTransaction> => {
  const keyCategory = facts.keyCategory as string;
  const found = await findLoan(server, contracts(), hexToBin(keyCategory));
  if (found === undefined) throw new Error('the key opens no loan');
  const state = await readParyon();
  const held = await coinsOfSeed(seed, keyCategory);
  const key = held.find((coin) => coin.output.token?.nft?.capability === 'minting');
  const tokens = await coinsOfSeed(seed, hex(contracts().paryonCategory));
  if (key === undefined) throw new Error('the key is not at an address of that seed');
  const closing = closeLoan({
    contracts: contracts(),
    price: pick(state.price, 'price thread'),
    loan: found.loan,
    sidecar: found.sidecar,
    manageFunction: pick(state.manage, 'manage function'),
    key: spendByKey(seed, key),
    wallet: tokens.map((coin) => spendByKey(seed, coin)),
    keyTo: funderLocking,
    changeTo: funderLocking,
  });
  verified(closing.built, 'the closing by plain script');
  const tried = await tryOnNode(hex(closing.built.encoded));
  if (!tried.allowed) throw new Error(`the closing by plain script was refused by testmempoolaccept: ${tried.reason}`);
  if (send) {
    const result = await server.broadcast(hex(closing.built.encoded));
    if (!result.accepted && !/already/i.test(result.reason)) throw new Error(`the closing was refused: ${result.reason}`);
  }
  return closing.built;
};

/** The way out through the template: the wallet works the closing out, the engine builds and signs it, the node takes it; nothing is sent. */
const templateClose = async (applications: Applications, backend: CheckedBackend): Promise<PreparedTransaction> => {
  const token = await loanKey(applications, (held) => held.position?.status === 'open');
  backend.dryRun = true;
  try {
    await applications.carryOut(applications.actionOn(token, 'close'));
    throw new Error('the closing was sent in a dry run');
  } catch (error) {
    if (!(error instanceof NotSent)) throw error;
    const tried = await tryOnNode(error.prepared.transactionHex);
    if (!tried.allowed) throw new Error(`the closing through the template was refused by testmempoolaccept: ${tried.reason}`, { cause: error });
    return error.prepared;
  } finally {
    backend.dryRun = false;
  }
};

const proveWayOut = async (applications: Applications, backend: CheckedBackend, seed: SeedKeys, when: string): Promise<void> => {
  await once(`the way out is proven ${when}`, async () => {
    const template = await templateClose(applications, backend);
    const plain = await plainClose(seed, false);
    const found = await findLoan(server, contracts(), hexToBin(facts.keyCategory as string));
    note(`The way out was proven ${when}, twice: the closing through the template (${template.bytes} bytes, built and signed by the engine) and the closing by plain script with step 1's builder (${plain.encoded.length} bytes), each against the loan at \`${hex(found?.loan.transactionHash ?? new Uint8Array()).slice(0, 16)}…:${found?.loan.index}\` with ${sat(found?.loan.output.valueSatoshis ?? 0n)}, passed the virtual machine and testmempoolaccept on ${local ? 'the local node' : 'the owner\'s node'}. Neither was sent.`);
    return undefined;
  });
};

/** The loan key, as the wallet lists it. */
const loanKey = async (applications: Applications, wanted?: (token: HeldToken) => boolean): Promise<HeldToken> =>
  until('the loan, found from its key', async () => {
    const token = (await applications.tokens()).find((held) => held.category === facts.keyCategory && held.capability === 'minting');
    return token !== undefined && token.meaning === 'position' && (wanted === undefined || wanted(token)) ? token : undefined;
  });

/** Carry out an action of the template for a step, and record it. A step whose transaction was sent before is taken as done. */
const act = async (applications: Applications, step: string, about: (outcome: { transactionId: string }) => string, request: () => Promise<ApplicationAction>): Promise<string> => {
  const data = await once(step, async () => {
    const written = facts.pending[step];
    if (written !== undefined && (await server.getTransaction(written.transactionId)) !== undefined) {
      const transaction = await decoded(written.transactionId);
      const sources = await Promise.all(transaction.inputs.map(async (input) => (await decoded(hex(input.outpointTransactionHash))).outputs[input.outpointIndex] as Output));
      const fee = sources.reduce((sum, output) => sum + output.valueSatoshis, 0n) - transaction.outputs.reduce((sum, output) => sum + output.valueSatoshis, 0n);
      record(step, { transactionId: written.transactionId, bytes: written.hex.length / 2, feeSatoshis: fee }, `${about({ transactionId: written.transactionId })}; found sent after a stop`);
      return { transactionIds: [written.transactionId], data: { transactionId: written.transactionId } };
    }
    const outcome = await applications.carryOut(await request());
    const inputs = backendInUse?.lastRequest?.inputs ?? [];
    const followed = inputs.filter((input) => input.inputIdentifier !== undefined && input.unlocking === undefined).map((input) => input.inputIdentifier);
    const given = inputs.filter((input) => input.unlocking !== undefined).map((input) => input.inputIdentifier);
    record(step, outcome.sent, `${about(outcome)}; of Paryon's coins the engine unlocked ${followed.length === 0 ? 'none' : followed.join(', ')} by the template itself and took ${given.length === 0 ? 'none' : given.join(', ')} with the unlocking the wallet worked out from the template`);
    return { transactionIds: [outcome.transactionId], data: { transactionId: outcome.transactionId } };
  });
  return data['transactionId'] as string;
};

/** Whether the wallet's own coins, as the engine lists them, include the outputs a transaction gave it. */
const walletSees = async (wallet: OwnerWallet, transactionId: string): Promise<void> => {
  // A run that continues after a stop may find those outputs spent already, by the next step: it waits a while only.
  await until(`the wallet's outputs of ${transactionId.slice(0, 12)}…`, async () => {
    const coins = [...(await wallet.parts.ownCoins()), ...(await wallet.parts.tokenCoins()).map(({ coin }) => coin)];
    return coins.some((coin: AccountCoin) => hex(coin.utxo.transactionHash) === transactionId);
  }, 120_000).catch(() => say(`  (the wallet's outputs of ${transactionId.slice(0, 12)}… are not listed; going on)`));
};

// ------------------------------------------------------------------ the emergency exit

if (emergency) {
  const which = words[1] === 'new' ? 'new' : words[1] === 'earlier' ? 'earlier' : facts.steps['the new device sweeps'] === undefined ? 'earlier' : 'new';
  say(`${proveOnly ? 'the way out' : 'emergency'}: closing the loan by plain script with the ${which} seed's keys${proveOnly ? ', not sent' : ''}`);
  try {
    if (which === 'new' && newSeed === undefined) throw new Error('the facts name no words of a new device');
    const built = await plainClose(which === 'new' ? newSeed : ownerSeed, !proveOnly);
    const found = await findLoan(server, contracts(), hexToBin(facts.keyCategory as string));
    if (proveOnly) {
      say(`  PROVEN: the closing ${built.transactionId} (${built.encoded.length} bytes, fee ${built.feeSatoshis} sat) against the loan at ${hex(found?.loan.transactionHash ?? new Uint8Array())}:${found?.loan.index} with ${found?.loan.output.valueSatoshis} sat passed the virtual machine and testmempoolaccept; it was not sent`);
    } else {
      say(`  sent ${built.transactionId}: the collateral (less the fee) and the key to the address that paid for the run`);
      facts.notes.push(`EMERGENCY: the loan was closed by plain script with the ${which} seed in ${built.transactionId}.`);
      keep();
    }
  } catch (error) {
    say(`FAILED: ${String((error as Error).message)}`);
    process.exitCode = STOPPED;
  } finally {
    await server.disconnect().catch(() => undefined);
    process.exit();
  }
}

// ------------------------------------------------------------------ the course, checked before borrowing

/**
 * The whole course (create a loan key, move the Borrowing thread on, borrow, add collateral, close), built by
 * step 1's builders against Paryon's outputs as they are and a coin of the seed that is output 0, chained, and
 * every input of every transaction evaluated in the virtual machine. Nothing is sent.
 */
const checkCourse = (state: ParyonState, price: Prices, coin: Utxo, seed: SeedKeys, height: number): bigint => {
  const to = coin.output.lockingBytecode;
  const spend = (utxo: Utxo): InputSpec => spendByKey(seed, { ...utxo, output: { ...utxo.output, lockingBytecode: to } });
  const made = createLoanKey({ contracts: contracts(), factory: pick(state.loanKeyFactory, 'factory'), defining: spendByKey(seed, coin), changeTo: to });
  verified(made.built, 'creating a loan key (planned)');
  const thread = state.borrowing.slice().sort((a, b) => Number(b.supply - a.supply))[0] as ParyonState['borrowing'][number];
  const moved = updateBorrowingPeriod({ contracts: contracts(), borrowing: thread, wallet: [spend(made.change)], height, changeTo: to });
  verified(moved.built, 'moving the Borrowing thread on (planned)');
  const fee = borrowingFee(DEBT, priceThread(state).state.price);
  const room = moved.change.output.valueSatoshis - fee - MANAGE_ADD - MARGIN;
  const collateral = collateralAtRatio(DEBT, price.lower, TARGET_PERCENT) < room ? collateralAtRatio(DEBT, price.lower, TARGET_PERCENT) : room;
  const opened = borrow({ contracts: contracts(), borrowing: moved.borrowing, price: priceThread(state), enforcer: made.enforcer, proof: made.proof, wallet: [spend(moved.change)], debt: DEBT, collateral, startingInterest: STARTING_INTEREST, keyTo: to, tokensTo: to, changeTo: to });
  verified(opened.built, 'borrowing (planned)');
  const added = manageLoan({ contracts: contracts(), price: opened.price, loan: opened.loan, sidecar: opened.sidecar, manageFunction: pick(state.manage, 'manage function'), key: spend(opened.key), wallet: [spend(opened.change)], repay: 0n, collateral: collateral + MANAGE_ADD, changeTo: to });
  verified(added.built, 'managing (planned)');
  const closed = closeLoan({ contracts: contracts(), price: added.price, loan: added.loan, sidecar: added.sidecar, manageFunction: added.manageFunction, key: spend(added.key), wallet: [spend(opened.tokens)], keyTo: to, changeTo: to });
  verified(closed.built, 'closing (planned)');
  return collateral;
};

if (checkCourseOnly) {
  try {
    const identity = hexToBin(facts.identity as string);
    const state = await readParyon();
    const price = await prices(state);
    const coins = (await quickPass(chain, identity, ownerSeed.viewingKey)).found.flatMap((address) => address.coins).map((found) => found.utxo).filter((utxo) => utxo.index === 0 && utxo.output.token === undefined);
    const [coin] = coins.sort((a, b) => (a.output.valueSatoshis > b.output.valueSatoshis ? -1 : 1));
    if (coin === undefined) throw new Error('the seed holds no coin that is output 0');
    const collateral = checkCourse(state, price, coin, ownerSeed, await lockHeight());
    say(`CHECKED: the whole course (create a loan key, move the Borrowing thread on, borrow 100.00 PUSD against ${collateral} sat, ${collateralRatio(collateral, DEBT, price.lower)}% at ${dollars(price.lower)}, add ${MANAGE_ADD} sat, close) from the coin ${hex(coin.transactionHash)}:0 of ${coin.output.valueSatoshis} sat, against Paryon's outputs as they are: every input of every transaction passed the virtual machine (2026 and 2025 rules, standard). Nothing was sent. Stored ${dollars(price.stored)}, oracle ${dollars(price.oracle)}.`);
  } catch (error) {
    say(`FAILED: ${String((error as Error).message)}`);
    process.exitCode = STOPPED;
  } finally {
    await server.disconnect().catch(() => undefined);
    process.exit();
  }
}

// ------------------------------------------------------------------ the parts

try {
  say(phase as string);

  if (phase === 'the owner opens a loan') {
    if (local) {
      await once('Paryon\'s contracts are deployed on the local chain', async () => {
        const hashes = (await mine(4, hex(funderLocking))) as string[];
        await mine(100, BURN);
        const coinbase = async (hash: string): Promise<Utxo> => {
          const read = (await localRpc('getblock', hash, 2)) as { tx: { txid: string; vout: { value: number }[] }[] };
          const [tx] = read.tx;
          if (tx === undefined) throw new Error('no coinbase');
          return { transactionHash: hexToBin(tx.txid), index: 0, output: { lockingBytecode: funderLocking, valueSatoshis: BigInt(Math.round((tx.vout[0]?.value ?? 0) * 1e8)) } };
        };
        const [paryonCoin, factoryCoin] = await Promise.all(hashes.slice(0, 2).map(coinbase));
        const deployed = localDeployment({ funder, paryonCoin: paryonCoin as Utxo, factoryCoin: factoryCoin as Utxo, price: 20_870n, period: 1 });
        for (const built of deployed.transactions) await localRpc('sendrawtransaction', hex(built.encoded));
        await mine(1, BURN);
        facts.deployment = deployed.deployment;
        contractsCache = undefined;
        keep();
        await until('the deployment at the server', async () => { const state = await readParyonState(server, contracts()); return state.borrowing.length > 0 && state.price.length > 0 && state.loanKeyFactory.length > 0 && state.manage.length > 0; });
        note(`Paryon's contracts as published (\`@paryonusd/contracts\` 1.1.0) were deployed on the local chain by this script, with categories of its own: PUSD \`${deployed.deployment.tokenIds.paryon}\`, factories \`${deployed.deployment.tokenIds.loanKeyFactory}\`; two Borrowing threads, two price threads at $208.70, two manage NFTs and two key factories.`);
        return undefined;
      });
    }
    // A check before starting: the deployment is alive, the servers agree, and the coins suffice.
    const pay = BigInt(
      (await once('the check before starting', async () => {
        const state = await readParyon();
        const price = await prices(state);
        const nodeTip = await rpc<number>('getblockcount');
        const balance = await funderBalance();
        facts.funderAtStart = String(balance);
        keep();
        const thread = priceThread(state);
        const fee = borrowingFee(DEBT, thread.state.price);
        const spare = local ? 0n : LEAVE_AT_FUNDER;
        const target = collateralAtRatio(DEBT, price.lower, TARGET_PERCENT);
        const available = balance - spare - WALLET_CREATION - fee - MANAGE_ADD - MARGIN - 20_000n;
        const collateral = available < target ? available : target;
        const floor = collateralAtRatio(DEBT, price.oracle, FLOOR_PERCENT);
        if (collateral < floor || collateral < minimumCollateral(DEBT, thread.state.price)) throw new Error(`STOP before starting: ${sat(available)} at hand cannot collateralise 100.00 PUSD to ${FLOOR_PERCENT}% at ${dollars(price.oracle)}. Nothing was paid.`);
        note(`Before starting: Paryon's deployment \`${contracts().deployment.name}\` showed ${state.borrowing.length} Borrowing threads (periods ${[...new Set(state.borrowing.map((entry) => entry.period))].join(', ')}), ${state.price.length} price threads (${[...new Set(state.price.map((entry) => dollars(entry.state.price)))].join(', ')}), ${state.loanKeyFactory.length} loan key factories and ${state.manage.length} manage NFTs. The tip was ${(await server.tip()).height} at the Electrum server and ${nodeTip} at ${local ? 'the local node' : 'the owner\'s node'}.${local ? '' : ` The oracle's latest signed price was ${dollars(price.oracle)} (${new Date(price.oracleTime * 1000).toISOString()}); the lowest stored price is ${dollars(price.stored)}.`} The funder held ${sat(balance)}${spare > 0n ? `, of which ${sat(spare)} are left for the other run that pays from the same key` : ''}: enough for ${sat(collateral)} of collateral, ${collateralRatio(collateral, DEBT, price.lower)}% of the debt at ${dollars(price.lower)}.`);
        return { data: { pay: String(collateral + fee + MANAGE_ADD + MARGIN) } };
      }))['pay'] as string,
    );

    const backend = (backendInUse = new CheckedBackend((account = await openAccount(facts.words.owner))));
    const wallet = await OwnerWallet.open({ backend, chain, seed: ownerSeed, ...(facts.ownerState === undefined ? {} : { state: facts.ownerState }), save: (state) => { facts.ownerState = state; keep(); } });
    const funding = await wallet.fundingAddress();
    await once('the wallet is funded', async () => {
      const built = await funderPays([{ lockingBytecode: funding, valueSatoshis: WALLET_CREATION }]);
      record('fund the wallet', { transactionId: built.transactionId, bytes: built.encoded.length, feeSatoshis: built.feeSatoshis }, `${sat(WALLET_CREATION)} from the funder to the wallet's funding address, to create the wallet`);
      return { transactionIds: [built.transactionId] };
    });
    if ((await wallet.creationStep()) !== 'created') {
      await until('the funding coin in the engine', async () => (await wallet.creationStep()) !== 'not funded');
      await wallet.create({ recovererKeyHash: credential.recoveryKey.keyHash, challengeDelay: { unit: 'time512', value: 1 }, allowance: { feeLockingBytecode: p2pkhLockingBytecode(credential.feeKey.keyHash), satoshis: suggestedAllowance() } });
      facts.identity = wallet.stored.identity as string;
      keep();
      // The wallet is in use as soon as the network has its creation; no block is waited for.
    }
    for (const [step, transactionId, about] of [
      ['prepare', wallet.stored.creation.prepareTransactionId, 'the wallet pays itself, to have a coin that is output 0; this transaction is the identity'],
      ['create', wallet.stored.creation.createTransactionId, 'the controller, an allowance for the recoverer, and the rest'],
    ] as const) {
      if (transactionId === undefined) continue;
      const bytes = ((await until('the transaction', async () => server.getTransaction(transactionId))) as string).length / 2;
      record(step, { transactionId, bytes, feeSatoshis: BigInt(bytes) }, about);
    }
    note('The wallet gave out no address until its creation was in a block; that is the wallet\'s own rule, and the only wait for a block before the recovery.', 'creation');
    const identity = hexToBin(facts.identity as string);

    // The coins for the loan: paid to an address the wallet gives out, as output 0, so that the loan key's category can come from it.
    await once('the wallet is paid for the loan', async () => {
      const given = await wallet.receiveAddress();
      const built = await funderPays([{ lockingBytecode: given.address.lockingBytecode, valueSatoshis: pay }]);
      record('pay the wallet', { transactionId: built.transactionId, bytes: built.encoded.length, feeSatoshis: built.feeSatoshis }, `${sat(pay)} from the funder to an address the wallet gave out, as output 0`);
      return { transactionIds: [built.transactionId] };
    });
    await until('the coin in the wallet', async () => (await wallet.balance()).recoverable >= pay);

    // The backup: an archive on two stores. The template is stored there before its first signature.
    if (facts.ownerArrangement === undefined) {
      facts.ownerArrangement = { archive: newArchive(STORES), earlierArchives: [], earlierViewingKeyRecords: [] };
      keep();
    }
    const applications = new Applications(wallet.parts, { archive: applicationArchive({ arrangement: () => facts.ownerArrangement, storeAt, seed: ownerSeed, identity, chain }), followUpTo: FOLLOW_UP_TO });

    // The whole course, built by step 1's builders against the outputs as they are and the wallet's actual coin,
    // and checked in the virtual machine, before anything of the loan is sent.
    await once('the whole course is checked', async () => {
      const state = await readParyon();
      const price = await prices(state);
      const [coin] = (await wallet.parts.ownCoins()).filter((candidate) => candidate.utxo.index === 0).sort((a, b) => (a.utxo.output.valueSatoshis > b.utxo.output.valueSatoshis ? -1 : 1));
      if (coin === undefined) throw new Error('the wallet holds no coin that is output 0');
      checkCourse(state, price, coin.utxo, ownerSeed, await lockHeight());
      note('Before anything of the loan was sent, the whole course (5 transactions: create a loan key, move the Borrowing thread on, borrow, manage, close) was built by step 1\'s builders against Paryon\'s outputs as they were and the wallet\'s actual coin, chained, and every input of every transaction passed the virtual machine (2026 and 2025 rules, standard). The wallet then worked each transaction out again from the template, and evaluated it in the virtual machine before it was signed.');
      return undefined;
    });

    // What the page shows before the first request: the template, as the wallet describes it.
    const summary = applications.describe(presented().names, presented().texts);
    note(`The wallet described the template as "${summary.name}", "${summary.verdict.statement}", with the actions ${summary.actions.map((action) => `"${action.name}"`).join(', ')}.`, 'described');

    const created = await act(applications, 'create a loan key', () => 'an action of the template: the wallet\'s coin that is output 0 defines the key\'s category (input 0); Paryon\'s factory, found by the wallet; output 0 is what the wallet keeps of its coin', async () => {
      const preview = await applications.preview(asked(createKeyRequest(presented())));
      note(`Before the first action the wallet said that the template would be stored in the backup first (${preview.firstUse}), and showed its own figures: it gives ${sat(preview.figures.givesSatoshis)}, gets ${sat(preview.figures.getsSatoshis)}, ${sat(preview.figures.intoApplicationSatoshis)} go into the application, the fee is ${sat(preview.figures.feeSatoshis)}; Paryon's coins spent: ${preview.figures.applicationInputs.map((input) => `"${input.name}"`).join(', ')}.`, 'first preview');
      return asked(createKeyRequest(presented()));
    });
    if (facts.keyCategory === undefined) {
      facts.keyCategory = hex((await decoded(created)).inputs[0]?.outpointTransactionHash as Uint8Array);
      keep();
    }
    await walletSees(wallet, created);

    const moved = await act(applications, 'move the Borrowing thread on', () => 'an action of the template: `updatePeriodState`, the lock time the highest height the node takes as final; the thread named by the page', async () => {
      const state = await readParyon();
      const thread = state.borrowing.slice().sort((a, b) => Number(b.supply - a.supply))[0] as ParyonState['borrowing'][number];
      const height = await lockHeight();
      amount('Borrowing thread', `period ${thread.period} moved to ${periodAt(contracts().deployment, height)} (lock time ${height}); the loan's interest starts there`);
      return asked(movePeriodRequest(presented(), contracts(), { borrowing: thread, lockHeight: height }));
    });
    await walletSees(wallet, moved);

    let borrowedNote = '';
    const opened = await act(applications, 'borrow', () => borrowedNote, async () => {
      const state = await readParyon();
      const price = await prices(state);
      const thread = priceThread(state);
      const borrowing = state.borrowing.find((entry) => hex(entry.transactionHash) === moved && entry.index === 0);
      if (borrowing === undefined) throw new Error('the Borrowing thread the run moved on was spent by someone else; the run stops before borrowing');
      const fee = borrowingFee(DEBT, thread.state.price);
      const own = (await wallet.parts.ownCoins()).reduce((sum, coin) => sum + coin.utxo.output.valueSatoshis, 0n);
      const target = collateralAtRatio(DEBT, price.lower, TARGET_PERCENT);
      const available = own - fee - MANAGE_ADD - MARGIN;
      const collateral = available < target ? available : target;
      const ratio = collateralRatio(collateral, DEBT, price.lower);
      if (collateral < collateralAtRatio(DEBT, price.oracle, FLOOR_PERCENT)) throw new Error(`STOP before borrowing: ${sat(available)} at hand collateralise only ${ratio}% at ${dollars(price.lower)}. Nothing was borrowed.`);
      const createdTransaction = await decoded(created);
      const request = borrowRequest(presented(), {
        borrowing,
        price: thread,
        enforcer: { transactionHash: hexToBin(created), index: 2, output: createdTransaction.outputs[2] as Output },
        proof: { transactionHash: hexToBin(created), index: 3, output: createdTransaction.outputs[3] as Output },
        debt: DEBT,
        collateral,
        startingInterest: STARTING_INTEREST,
      });
      const preview = await applications.preview(asked(request));
      note(`The wallet's own figures for the borrowing, before it was approved: it gives ${sat(preview.figures.givesSatoshis)} and gets ${sat(preview.figures.getsSatoshis)} back (the key, the PUSD and what is left over), ${sat(preview.figures.intoApplicationSatoshis)} go into the application (the collateral and Paryon's fee of ${sat(preview.figures.toOthers.find((output) => output.name === 'Borrowing fee')?.satoshis ?? 0n)}), the network fee is ${sat(preview.figures.feeSatoshis)}; it receives ${preview.figures.tokensNet.map((entry) => `${Number(entry.amount) / 100} PUSD`).join(', ')}; destroyed: ${preview.figures.tokensDestroyed.map((entry) => `"${entry.name}" (${entry.how}, ${entry.wallet ? 'the wallet\'s' : 'the application\'s'})`).join(', ')}.`, 'borrow preview');
      amount('Debt', '100.00 PUSD');
      amount('Prices when the loan was opened', `stored in the price thread used ${dollars(thread.state.price)}; lowest stored ${dollars(price.stored)}${local ? '' : `; the oracle's latest ${dollars(price.oracle)} (${new Date(price.oracleTime * 1000).toISOString()})`}; collateral is reckoned at the lower, ${dollars(price.lower)}`);
      amount('Collateral', `${sat(collateral)}: ${ratio}% of the debt at ${dollars(price.lower)}, ${collateralRatio(collateral, DEBT, thread.state.price)}% at the stored price; the contracts' least at the stored price is ${sat(minimumCollateral(DEBT, thread.state.price))} (110%)${ratio < Number(SAFE_PERCENT) ? `; BELOW the aim of ${SAFE_PERCENT}%` : ''}`);
      amount('borrowing fee (sat)', String(fee));
      borrowedNote = `an action of the template: 100.00 PUSD against ${sat(collateral)} of collateral, Paryon's fee ${sat(fee)}, starting interest ${STARTING_INTEREST}; the key and the PUSD to two fresh addresses of the wallet, what is left to a third`;
      return asked(request);
    });
    const loan = await loanKey(applications, (held) => held.position?.status === 'open');
    note(`The wallet found the loan from its key, by the template's declaration: ${loan.position?.status}, ${sat(loan.position?.satoshis ?? 0n)}; it shows ${loan.position?.state?.map((entry) => `"${entry.name}" ${entry.value}`).join(' and ')}, and offers ${loan.actions?.map((action) => `"${action.name}"${action.needsApplication === undefined ? '' : ' (through the page only)'}`).join(', ')}.`, 'found after opening');
    await proveWayOut(applications, backend, ownerSeed, 'right after the loan was opened');

    const managed = await act(applications, 'manage, adding collateral', () => `an action of the template: ${sat(MANAGE_ADD)} more collateral; the page named nothing but the amount, the wallet found Paryon's price and manage coins itself; the key back to the address it was spent from`, async () => {
      const current = await loanKey(applications, (held) => held.position?.status === 'open');
      return asked(manageRequest(presented(), { keyCategory: current.category, collateral: (current.position?.satoshis ?? 0n) + MANAGE_ADD }));
    });
    const managedTransaction = await decoded(managed);
    const openedTransaction = await decoded(opened);
    note(`After managing, the key is at the same address as before (${hex(managedTransaction.outputs[4]?.lockingBytecode ?? new Uint8Array()) === hex(openedTransaction.outputs[5]?.lockingBytecode ?? new Uint8Array())}), and the loan holds ${sat(managedTransaction.outputs[1]?.valueSatoshis ?? 0n)}.`, 'after managing');
    await loanKey(applications, (held) => held.position?.satoshis === managedTransaction.outputs[1]?.valueSatoshis);
    await proveWayOut(applications, backend, ownerSeed, 'after collateral was added');
    const balance = await wallet.balance();
    note(`The old device holds the loan key and ${Number(balance.tokens.filter((coin) => hex(coin.utxo.output.token?.category ?? new Uint8Array()) === hex(contracts().paryonCategory)).reduce((sum, coin) => sum + (coin.utxo.output.token?.amount ?? 0n), 0n)) / 100} PUSD at its addresses, and ${sat(balance.recoverable)} without tokens. Then the device is lost, with the loan open.`, 'what the old device holds');
  }

  if (phase === 'the recoverer recovers') {
    const identity = hexToBin(facts.identity as string);
    account = await openAccount(facts.words.credential);
    const recoverer = await RecovererWallet.open({ backend: account, chain, identity });
    const before = await recoverer.state();
    if (hex(before.ownerKeyHash) !== hex(newSeed.controllerKey.keyHash)) {
      if (before.status === 'active') {
        await until('the recoverer\'s fee coins', async () => { const now = await recoverer.feeReadiness(); return now.canRecover ? now : undefined; });
        const requested = await recoverer.request(newSeed.controllerKey.keyHash);
        record('request', requested, 'the recoverer names the new device\'s key; paid from its fee address');
        await confirmed(requested.transactionId);
      }
      await until('the request in the engine', async () => (await recoverer.state()).status === 'pending');
      if (local) {
        const now = (await localRpc('getblockheader', await localRpc('getbestblockhash'))) as { time: number };
        await localRpc('setmocktime', now.time + 700);
        await mine(11, BURN);
      }
      const medianTime = async (height: number): Promise<number> => {
        const times = await Promise.all(Array.from({ length: 11 }, (_, back) => server.headerTime(Math.max(height - back, 0))));
        return times.sort((a, b) => a - b)[5] as number;
      };
      const started = Date.now();
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
        local ? 500 : 20_000,
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
        local ? 500 : 20_000,
      );
      record('complete', completed, `after the waiting period${local ? '' : ` (${Math.round((Date.now() - started) / 60_000)} minutes)`}; no coin has moved, the loan is still open under the key the earlier seed holds`);
      if (local) await localRpc('setmocktime', 0);
      await block();
    }
  }

  if (phase === 'the new device closes the loan') {
    const identity = hexToBin(facts.identity as string);
    const backend = (backendInUse = new CheckedBackend((account = await openAccount(facts.words.next))));
    const save = (state: OwnerWalletState): void => { facts.newState = state; keep(); };
    const wallet = facts.newState === undefined
      ? await OwnerWallet.takeOver({ backend, chain, seed: newSeed, identity, earlierViewingKeys: [ownerSeed.viewingKey], save })
      : await OwnerWallet.open({ backend, chain, seed: newSeed, state: facts.newState, save });
    if ((await wallet.checkOwnership()) === 'closed') {
      say('  (the wallet is closed: done before)');
    } else {
      const search = await wallet.search();
      note(`The new device's search over both seeds ended as "${search.status}".`, 'the search');
      if (facts.steps['the new device sweeps'] === undefined) {
        await until('the earlier coins in the engine', async () => { const now = await wallet.balance(); return now.toSweep > 0n && now.tokens.length === 0 ? now : undefined; });
        const sent = await wallet.sweepEarlier();
        for (const transaction of sent.transactions) record('sweep', transaction, `${sent.coins} coins of the earlier seed, the loan key and the PUSD among them, to addresses of the new seed, in a transaction of its own (the sweep needs the controller at input 0; Paryon's actions need their price contract there)`);
        note(`The sweep reported the tokens as of ${[...new Set(sent.tokens.map((token) => token.meaning))].join(' and ')} meaning: the wallet moves what it does not understand.`);
        facts.steps['the new device sweeps'] = { transactionIds: sent.transactions.map((transaction) => transaction.transactionId) };
        keep();
      }
      await block();
      await until('the swept key at an address of the new seed', async () => { const now = await wallet.balance(); return now.toSweep === 0n && now.tokens.length >= 2 ? now : undefined; });

      if (facts.newArrangement === undefined || (facts.newArrangement.copiedArchives ?? []).length === 0) {
        const copied = await copyEarlierArchives({ arrangement: facts.newArrangement ?? { archive: newArchive(STORES), earlierArchives: [(facts.ownerArrangement as RecoveryArrangement).archive], earlierViewingKeyRecords: [] }, storeAt });
        facts.newArrangement = copied.arrangement;
        keep();
        if (copied.unfinished.length > 0) throw new Error(`the earlier archive was not copied in full: ${copied.unfinished.join(' ')}`);
      }
      const applications = new Applications(wallet.parts, { archive: applicationArchive({ arrangement: () => facts.newArrangement, storeAt, seed: newSeed, identity, chain }), followUpTo: FOLLOW_UP_TO });
      // No application takes part from here on: no session, no request, no page. The device has the backup and the chain.
      await once('the new device reads the backup', async () => {
        const before = (await applications.tokens()).find((token) => token.category === facts.keyCategory);
        const found = await applications.readBackup();
        const suggested = applications.suggestions.find((candidate) => candidate.identifier === presented().names.identifier);
        if (suggested === undefined) throw new Error('the backup did not hold the Paryon template');
        const summary = applications.describe(suggested, suggested.texts);
        await applications.trust(suggested, undefined);
        note(`Before reading the backup the new device listed the swept key as a token of ${before?.meaning} meaning. The backup held ${found.suggested} ${found.suggested === 1 ? 'text' : 'texts'} of the template that the earlier owner had stored and ${found.notes} ${found.notes === 1 ? 'note' : 'notes'}; the template was offered as "${summary.name}", shown as "${summary.verdict.statement}", and trusted on the user's word.`);
        return undefined;
      });
      const found = await loanKey(applications, (held) => held.position?.status === 'open');
      note(`The new device found the loan from the swept key, with the template from the backup and the chain alone (Paryon's site and API not consulted, and \`packages/paryon\`'s finder not used by the wallet): ${found.position?.status}, ${sat(found.position?.satoshis ?? 0n)}, ${found.position?.state?.map((entry) => `"${entry.name}" ${entry.value}`).join(', ')}; the key at ${found.place === 'address' ? 'an address of the new seed' : found.place}. It offers ${found.actions?.map((action) => `"${action.name}"${action.asks === undefined ? '' : ` (asking for ${action.asks.map((asked) => `"${asked.name}"`).join(', ')})`}${action.needsApplication === undefined ? '' : ' (through the page only)'}`).join(', ')}.`, 'found again');
      await proveWayOut(applications, backend, newSeed, 'after the takeover, with the new seed');

      let closedNote = '';
      const closed = await act(applications, 'close', () => closedNote, async () => {
        const token = await loanKey(applications, (held) => held.position?.status === 'open');
        const request = applications.actionOn(token, 'close');
        const preview = await applications.preview(request);
        note(`The new device's own figures for the closing, from its list of tokens: it gives ${sat(preview.figures.givesSatoshis)} (the key and the PUSD), gets ${sat(preview.figures.getsSatoshis)} back, ${sat(-preview.figures.intoApplicationSatoshis)} come back from the application, the fee is ${sat(preview.figures.feeSatoshis)}; destroyed: ${preview.figures.tokensDestroyed.map((entry) => `"${entry.name}" (${entry.how}, ${entry.wallet ? 'the wallet\'s' : 'the application\'s'})`).join(', ')}.`, 'close preview');
        closedNote = `an action of the template from the new device's own list of tokens, every value read from the chain: the whole debt repaid, the PUSD and the loan's record sent to data outputs, the sidecar not carried on; the collateral and the key to fresh addresses of the new seed`;
        amount('Closing', `the loan held ${sat(token.position?.satoshis ?? 0n)}; ${sat(preview.figures.getsSatoshis)} came back to the wallet with the key`);
        return request;
      });
      await walletSees(wallet, closed);
      const after = await loanKey(applications, (held) => held.position?.status === 'closed');
      note(`After closing, the key is still in the wallet and its loan is "${after.position?.status}"; the wallet holds no PUSD (${(await wallet.balance()).tokens.every((coin) => hex(coin.utxo.output.token?.category ?? new Uint8Array()) !== hex(contracts().paryonCategory))}).`, 'after closing');

      // The run has no further use for the wallet: the key goes to the run's own address, and the wallet is closed.
      await once('the key is sent on', async () => {
        const holding = await until('the key', async () => { const now = await wallet.balance(); return now.tokens.length === 1 && now.toSweep === 0n ? now.tokens[0] : undefined; });
        const sent = await wallet.sendToken(holding, funderLocking);
        record('send the key on', sent, 'the loan key, unchanged, to the address that paid for the run; the wallet\'s own transaction');
        return { transactionIds: [sent.transactionId] };
      });
      await block();
      await until('the wallet without a token', async () => (await wallet.balance()).tokens.length === 0);
      await wait(local ? 1_500 : 5_000);
      const closing = await wallet.close(funderLocking);
      for (const sent of closing.transactions) record('close the wallet', sent, 'everything, and the controller\'s value, back to the address that paid for the run');
      await block();
    }
    const history = await until('the closing', async () => { const read = await readControllerHistory(chain, identity); return read.closed === undefined ? undefined : read; });
    note(`The controller's history: ${history.transitions.map((step) => step.kind).join(', ')}, then closed. It has had ${history.owners.length} owners.`);
  }

  if (phase === 'the recoverer returns its fee coins') {
    await once('the recoverer returns its fee coins', async () => {
      account = await openAccount(facts.words.credential);
      const recoverer = await RecovererWallet.open({ backend: account, chain, identity: hexToBin(facts.identity as string) });
      await until('the recoverer\'s fee coins', async () => (await recoverer.feeReadiness()).holds > 0n);
      const sent = await recoverer.returnFeeCoins(funderLocking);
      if (sent === undefined) return {};
      record('return the allowance', sent, 'what the recoverer did not use');
      return { transactionIds: [sent.transactionId] };
    });
    await block();
  }

  if (phase === 'the run returns what is left') {
    await once('the key is destroyed', async () => {
      const nfts = await until('the key at the funder', async () => { const found = (await server.listUnspent(funderLocking, 'only')).filter((entry) => entry.token?.category === facts.keyCategory); return found.length > 0 ? found : undefined; });
      const extra: Utxo[] = nfts.map((entry) => ({
        transactionHash: hexToBin(entry.transactionId),
        index: entry.index,
        output: { lockingBytecode: funderLocking, valueSatoshis: entry.valueSatoshis, token: { amount: entry.token?.amount ?? 0n, category: hexToBin(entry.token?.category ?? ''), ...(entry.token?.nft === undefined ? {} : { nft: { capability: entry.token.nft.capability, commitment: hexToBin(entry.token.nft.commitment) } }) } },
      }));
      const built = await funderPays([], { burn: true, extraInputs: extra });
      record('destroy the key', { transactionId: built.transactionId, bytes: built.encoded.length, feeSatoshis: built.feeSatoshis }, 'the funder spends the loan key without carrying it on, and keeps its satoshis');
      return { transactionIds: [built.transactionId] };
    });
    await block();
    const identity = hexToBin(facts.identity as string);
    const total = await until('the funder\'s coins', async () => { const value = await funderBalance(); return value > 0n ? value : undefined; });
    const places: [string, Uint8Array][] = [
      ['the wallet\'s funding address', p2pkhLockingBytecode(ownerSeed.fundingKey.keyHash)],
      ['the new device\'s funding address', p2pkhLockingBytecode(newSeed.fundingKey.keyHash)],
      ['the recoverer\'s fee address', p2pkhLockingBytecode(credential.feeKey.keyHash)],
    ];
    const left: string[] = [];
    for (const [name, lockingBytecode] of places) {
      const sum = (await server.listUnspent(lockingBytecode)).reduce((value, entry) => value + entry.valueSatoshis, 0n);
      if (sum > 0n) left.push(`${sum} at ${name}`);
    }
    for (const seed of [ownerSeed, newSeed]) {
      const found = (await quickPass(chain, identity, seed.viewingKey)).found.flatMap((address) => address.coins);
      if (found.length > 0) left.push(`${found.length} coins at addresses of a seed`);
    }
    if ((await findLoan(server, contracts(), hexToBin(facts.keyCategory as string))) !== undefined) left.push('the loan is open');
    const spent = BigInt(facts.funderAtStart as string) - total;
    const networkFees = facts.log.reduce((sum, entry) => sum + BigInt(entry.fee), 0n);
    const borrowFee = BigInt(facts.amounts?.['borrowing fee (sat)'] ?? '0');
    amount('Funder', `${sat(BigInt(facts.funderAtStart as string))} before the run, ${sat(total)} after it`);
    const lost = local ? 0n : borrowFee;
    amount('Cost of the run', `${sat(spent)}: ${local ? `no borrowing fee (the ${sat(borrowFee)} went to the run's own fee address on the local chain and came back)` : `the borrowing fee ${sat(borrowFee)}`}, network fees ${sat(networkFees)} for the ${facts.log.length} transactions above, interest 0, and ${sat(spent - lost - networkFees)} otherwise${facts.log.some((entry) => entry.step.endsWith(', not used')) ? ' (the satoshis a loan key that was not used left in Paryon\'s contracts with its waiting key and proof of origin; anything another run paid from the same key meanwhile would be here too)' : ''}`);
    note(`The funding address held ${facts.funderAtStart} satoshis before the run and holds ${total} after it. ${left.length === 0 ? 'Nothing is left anywhere else: no PUSD (all of it was burned at the closing), no loan key (destroyed by the funder), no coin at the wallet\'s or the recoverer\'s addresses, and no loan.' : `LEFT BEHIND: ${left.join('; ')}.`}`);
    if (left.length > 0) throw new Error(`coins were left behind: ${left.join('; ')}`);
  }
  if (!facts.finished.includes(phase as string)) facts.finished.push(phase as string);
  keep();
} catch (error) {
  say(`FAILED: ${(error as Error).name}: ${String((error as Error).message).slice(0, 900)}\n${String((error as Error).stack).split('\n').slice(1, 5).join('\n')}`);
  process.exitCode = STOPPED;
} finally {
  if (local) await localRpc('setmocktime', 0).catch(() => undefined);
  await server.disconnect().catch(() => undefined);
  await account?.close();
  process.exit();
}
