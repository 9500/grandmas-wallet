// Run E of the implementation plan, step 1: a ParyonUSD loan by script, from a wallet of this project.
//
// A wallet is created on chipnet as in run D: an owner's wallet on the XO engine, with a recoverer enrolled,
// so that its addresses are real recoverable addresses with a controller on chain. On Paryon's live chipnet
// deployment (`chipnet-fast-periods-6`) a loan key is created, the loan is opened, managed and closed. Every
// transaction of the loan is built by this project's own code (`packages/paryon`) from Paryon's published
// contracts; the wallet's inputs are spent by the everyday path of the recoverable address, with keys derived
// from the wallet's words. The key, the borrowed PUSD and all change go to fresh addresses the wallet gives
// out, and the wallet's own listing is checked to show them. At the end the wallet is closed and everything is
// back at the address that paid for the run.
//
// Before anything is sent, the whole course is built against Paryon's live outputs and checked in the virtual
// machine; each transaction is tried with `testmempoolaccept` on the owner's node just before it is sent; and
// right after the loan is opened, and after each change to it, the closing transaction is built against the
// actual outputs and tried the same way, so that the way out is proven before anything else is done.
//
// usage (from packages/app):
//   npx tsx ../../scripts/run-e.ts chipnet              a loan of 100.00 PUSD: open, manage, close
//   npx tsx ../../scripts/run-e.ts chipnet --loan 200   200.00 PUSD, with a repayment of 100.00 that leaves it open
//
//   STOP_AFTER=<step>   the run stops after the named step, to be continued with the same command
import 'fake-indexeddb/auto';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { type Output, binToHex, createVirtualMachineBch2025, decodeTransactionBch, encodeTransactionBch, generateBip39Mnemonic, hexToBin } from '@bitauth/libauth';
import {
  type BuiltTransaction,
  type ChainReader,
  type InputSpec,
  type KeyPair,
  type RecoverableWalletAddress,
  type Utxo,
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
} from '@grandmas-wallet/core';
import {
  type FoundLoan,
  type ParyonState,
  CHIPNET_FAST_PERIODS_6,
  MINIMUM_DEBT,
  borrow,
  borrowingFee,
  closeLoan,
  collateralAtRatio,
  collateralRatio,
  createLoanKey,
  findLoan,
  latestOraclePrice,
  manageLoan,
  minimumCollateral,
  paryonContracts,
  periodAt,
  readParyonState,
  updateBorrowingPeriod,
} from '@grandmas-wallet/paryon';
import { paryonArtifacts } from '@paryonusd/contracts';
import { Engine, XO_SUPPORTED_NETWORKS, resolveElectrumServersForNetwork } from '@xo-cash/engine';

import { type OwnerWalletState, Account, OwnerWallet, RecovererWallet, feeReserve, walletTemplateNumbers } from '../packages/app/src/index.js';
import { Electrum } from '../packages/chipnet/src/electrum.js';
import { type NodeRpcSettings, nodeRpc, testMempoolAccept } from '../packages/chipnet/src/node-rpc.js';

const hex = binToHex;
const root = fileURLToPath(new URL('..', import.meta.url));
const words = process.argv.slice(2).filter((word) => !word.startsWith('--'));
const [chainName, phase] = words;
const loanArgument = process.argv.indexOf('--loan');
const LOAN_PUSD = loanArgument < 0 ? 100 : Number(process.argv[loanArgument + 1]);
if (chainName !== 'chipnet' || ![100, 200].includes(LOAN_PUSD)) {
  console.error('usage: npx tsx ../../scripts/run-e.ts chipnet [--loan 100|200]   (Paryon\'s deployment is on chipnet only)');
  process.exit(2);
}
const DEBT = BigInt(LOAN_PUSD) * 100n;
const WITH_REPAYMENT = DEBT >= 2n * MINIMUM_DEBT;
/** The exit code of a part that stopped at a step of its own and said why. */
const STOPPED = 3;
const PHASES = ['the owner creates a wallet', 'the loan is opened', 'the loan is managed', 'the loan is closed', 'the wallet is closed', 'the recoverer returns its fee coins', 'the run returns what is left'];
mkdirSync(`${root}.chipnet`, { recursive: true });
const stateFile = `${root}.chipnet/run-e-chipnet${WITH_REPAYMENT ? `-${LOAN_PUSD}` : ''}.json`;
const logFile = `${root}docs/runs/stage-9-loan-chipnet${WITH_REPAYMENT ? `-${LOAN_PUSD}` : ''}.md`;

// ------------------------------------------------------------------ amounts and safety

/** The collateral aimed at: 125% of the debt at the lower of the stored price and the oracle's. */
const TARGET_PERCENT = 125n;
/** Below this at the lower price the run says so in its record. */
const SAFE_PERCENT = 115n;
/** Below this at the oracle's price the run stops before borrowing. */
const FLOOR_PERCENT = 112n;
/** The collateral the manage step adds. */
const MANAGE_ADD = 100_000n;
/** Kept in the wallet for network fees and the outputs of 1,000 satoshis each transaction makes. */
const MARGIN = 50_000n;
/** What creating the wallet takes from the funder: the controller, the allowance, the rest. */
const WALLET_CREATION = 80_000n;
/** No interest: see the record (the period of the Borrowing thread is moved on as well). */
const STARTING_INTEREST = 0;

interface Entry { step: string; transactionId: string; bytes: number; fee: string; note: string }
interface Facts {
  startedAt: string;
  debt: string;
  words: { owner: string; credential: string };
  identity?: string;
  ownerState?: OwnerWalletState;
  /** The wallet's coin for the loan: at a given-out address, output 0 of the funder's payment. */
  loanCoin?: { number: number; transactionId: string; satoshis: string };
  /** Change addresses (kind 1) the wallet gave out for each transaction, by purpose. */
  reserved: Record<string, Record<string, number>>;
  /** A transaction about to be sent, written down first. */
  pending: Record<string, { transactionId: string; hex: string }>;
  keyCategory?: string;
  /** Where the key and the PUSD are, by address number of kind 1. */
  keyAt?: number;
  tokensAt?: number;
  /** The wallet's BCH not in the loan: coins at these change addresses. */
  bchAt?: number[];
  amounts?: Record<string, string>;
  steps: Record<string, { transactionIds: string[]; data?: Record<string, number | string> }>;
  finished: string[];
  funderAtStart?: string;
  log: Entry[];
  notes: string[];
}

// ------------------------------------------------------------------ the driver: one process for each part

if (phase === undefined) {
  const finished = existsSync(stateFile) ? (JSON.parse(readFileSync(stateFile, 'utf8')) as Facts).finished : [];
  const extra = WITH_REPAYMENT ? ['--loan', String(LOAN_PUSD)] : [];
  for (const next of PHASES) {
    if (finished.includes(next)) {
      console.log(`${next}: done before`);
      continue;
    }
    let result = spawnSync('npx', ['tsx', fileURLToPath(import.meta.url), chainName, next, ...extra], { stdio: 'inherit' });
    for (let again = 0; again < 3 && result.status !== 0 && result.status !== STOPPED; again += 1) {
      console.log(`"${next}" ended unexpectedly; continuing it`);
      result = spawnSync('npx', ['tsx', fileURLToPath(import.meta.url), chainName, next, ...extra], { stdio: 'inherit' });
    }
    if (result.status !== 0) {
      console.error(`Stopped in "${next}". The same command continues the run.`);
      process.exit(result.status ?? 1);
    }
  }
  const facts = JSON.parse(readFileSync(stateFile, 'utf8')) as Facts;
  const revision = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const libauth = (JSON.parse(readFileSync(`${root}node_modules/@bitauth/libauth/package.json`, 'utf8')) as { version: string }).version;
  const contractsPackage = (JSON.parse(readFileSync(`${root}node_modules/@paryonusd/contracts/package.json`, 'utf8')) as { version: string }).version;
  const contracts = paryonContracts(CHIPNET_FAST_PERIODS_6);
  const amounts = facts.amounts ?? {};
  writeFileSync(
    logFile,
    [
      `# Stage 9 run on chipnet (run E, step 1): a ParyonUSD loan of ${LOAN_PUSD}.00 PUSD by script, from recoverable addresses`,
      '',
      `Written by the run itself (\`scripts/run-e.ts chipnet${WITH_REPAYMENT ? ` --loan ${LOAN_PUSD}` : ''}\`). The wallet is an owner's wallet of this project on the XO engine, created on chipnet with a recoverer enrolled, so its addresses are recoverable addresses with a controller on chain. Every transaction of the loan was built by this project's code (\`packages/paryon\`) from Paryon's published contracts, unchanged, against the live outputs of Paryon's deployment \`${contracts.deployment.name}\`. The wallet's inputs were unlocked by the everyday path of the recoverable address (\`spend\`: the address key's signature), with keys derived from the wallet's words by the script. Each transaction was checked in libauth's virtual machine (2026 and 2025 rules, standard) and by this project's check before sending, tried with \`testmempoolaccept\` on the owner's chipnet node, and sent through Electrum.`,
      '',
      `- Wallet identity: \`${facts.identity}\``,
      `- Loan key (token category): \`${facts.keyCategory}\``,
      `- Contracts: \`@paryonusd/contracts\` ${contractsPackage}, compiled by ${JSON.stringify((paryonArtifacts.artifactBorrowing as unknown as { compiler: { name: string; version: string } }).compiler.name)} ${(paryonArtifacts.artifactBorrowing as unknown as { compiler: { version: string } }).compiler.version}, as published; Borrowing \`${hex(contracts.borrowing.lockingBytecode)}\`, price (guarded) \`${hex(contracts.price.lockingBytecode)}\`, Loan \`${hex(contracts.loan.lockingBytecode)}\`, sidecar \`${hex(contracts.loanSidecar.lockingBytecode)}\`, manage \`${hex(contracts.manage.lockingBytecode)}\``,
      `- libauth ${libauth}; repository at commit \`${revision}\` with the uncommitted package \`packages/paryon\``,
      `- Started ${facts.startedAt}`,
      '',
      '| Step | Transaction | Bytes | Fee (sat) | Note |',
      '| --- | --- | --- | --- | --- |',
      ...facts.log.map((entry) => `| ${entry.step} | \`${entry.transactionId}\` | ${entry.bytes} | ${entry.fee} | ${entry.note} |`),
      '',
      'Amounts:',
      '',
      ...Object.entries(amounts).filter(([name]) => name !== 'borrowing fee (sat)').map(([name, value]) => `- ${name}: ${value}`),
      '',
      'Also observed:',
      '',
      ...facts.notes.map((line) => `- ${line}`),
      '',
      `Outcome: passed. The loan was opened from recoverable addresses, managed${WITH_REPAYMENT ? ' without and with a repayment' : ' without a repayment'} and closed on Paryon's live chipnet deployment, every transaction built by this project's code; the wallet was closed and everything returned to the address that paid for the run.`,
      '',
    ].join('\n'),
  );
  console.log(`Run complete. Log written to ${logFile.slice(root.length)}`);
  process.exit(0);
}

// ------------------------------------------------------------------ what every part shares

const facts: Facts = existsSync(stateFile)
  ? (JSON.parse(readFileSync(stateFile, 'utf8')) as Facts)
  : { startedAt: new Date().toISOString(), debt: String(DEBT), words: { owner: generateBip39Mnemonic(), credential: generateBip39Mnemonic() }, reserved: {}, pending: {}, steps: {}, finished: [], log: [], notes: [] };
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
const until = async <T>(what: string, check: () => Promise<T | undefined | false>, patienceMs = 20 * 60_000, everyMs = 3_000): Promise<T> => {
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
const credential = deriveCredentialKeys(facts.words.credential, 'testnet', numbers);
const ownerSeed = deriveSeedKeys(facts.words.owner, 'testnet', numbers);

const server = await Electrum.connect('wss://chipnet.9500.cash:443');
const chain: ChainReader = {
  getHistory: (lockingBytecode) => server.getHistory(lockingBytecode),
  getTransaction: (transactionId) => server.getTransaction(transactionId),
  listUnspent: async (lockingBytecode) => (await server.listUnspent(lockingBytecode)).map((entry) => ({ ...entry, hasToken: entry.token !== undefined })),
};
const rpc = nodeRpc(JSON.parse(readFileSync(`${root}.chipnet/node-rpc.json`, 'utf8')) as NodeRpcSettings);
const contracts = paryonContracts(CHIPNET_FAST_PERIODS_6);
const P = hex(contracts.paryonCategory);

const funder: KeyPair = keyPairFromPrivateKey(hexToBin((JSON.parse(readFileSync(`${root}.chipnet/funder-design-2.json`, 'utf8')) as { privateKey: string }).privateKey));
const funderLocking = p2pkhLockingBytecode(funder.keyHash);

const funderCoins = async (): Promise<Utxo[]> =>
  (await server.listUnspent(funderLocking, 'exclude')).map((entry) => ({ transactionHash: hexToBin(entry.transactionId), index: entry.index, output: { lockingBytecode: funderLocking, valueSatoshis: entry.valueSatoshis } }));
const funderBalance = async (): Promise<bigint> => (await funderCoins()).reduce((sum, coin) => sum + coin.output.valueSatoshis, 0n);
const funderPays = async (outputs: Output[], options: { burn?: boolean; extraInputs?: Utxo[] } = {}): Promise<BuiltTransaction> => {
  const coins = await until('the funder\'s coins', async () => { const found = await funderCoins(); return found.length > 0 ? found : undefined; });
  const built = buildTransaction({ inputs: [...coins, ...(options.extraInputs ?? [])].map((coin) => p2pkhInput(coin, funder)), outputs, changeLockingBytecode: funderLocking, allowTokenBurn: options.burn === true });
  const check = checkBeforeSending(built);
  if (check !== true) throw new Error(`a payment of the funder fails the check before sending: ${check}`);
  const result = await server.broadcast(hex(built.encoded));
  if (!result.accepted && !/already/i.test(result.reason)) throw new Error(`a payment of the funder was refused: ${result.reason}`);
  await until('the funder\'s payment at the server', async () => (await server.getTransaction(built.transactionId)) !== undefined, 60_000, 1_000);
  await wait(2_000);
  return built;
};

const openAccount = async (mnemonic: string): Promise<Account> => {
  const [first] = resolveElectrumServersForNetwork(XO_SUPPORTED_NETWORKS.chipnet);
  if (first === undefined) throw new Error('the engine names no chipnet server');
  // One server, as in run D: with several, a server that has not seen a new block yet can end the process.
  const electrumServers = [{ host: 'chipnet.9500.cash', version: first.version, transports: { wss: 443 }, blockchain: first.blockchain }];
  return Account.open(await Engine.create(mnemonic, { network: XO_SUPPORTED_NETWORKS.chipnet, electrumServers }));
};
let account: Account | undefined;
const openWallet = async (): Promise<OwnerWallet> => {
  account = await openAccount(facts.words.owner);
  walletOpened = await OwnerWallet.open({ backend: account, chain, seed: ownerSeed, ...(facts.ownerState === undefined ? {} : { state: facts.ownerState }), save: (state) => { facts.ownerState = state; keep(); } });
  return walletOpened;
};

// ------------------------------------------------------------------ the wallet's parts, spent by script

/** The wallet's address of a kind and number, as its own code works it out. */
const walletAt = (wallet: OwnerWallet, kind: 0 | 1, number: number): RecoverableWalletAddress => wallet.address(kind, number) as RecoverableWalletAddress;
/** A coin at an address of the wallet, unlocked by that address's key: the everyday path of a recoverable address. */
const byKey = (wallet: OwnerWallet, kind: 0 | 1, number: number, utxo: Utxo): InputSpec => {
  const address = walletAt(wallet, kind, number);
  if (hex(address.lockingBytecode) !== hex(utxo.output.lockingBytecode)) throw new Error('the coin is not at that address of the wallet');
  return recoverableInput(utxo, address.script, ownerSeed.addressKey(kind, number));
};
/** A coin at any address the run has had from the wallet: the given-out address of the loan's coin, or a change address it reserved. */
let walletOpened: OwnerWallet | undefined;
const spendWallet = (utxo: Utxo): InputSpec => {
  const wallet = walletOpened;
  if (wallet === undefined) throw new Error('the wallet is not open');
  const at = hex(utxo.output.lockingBytecode);
  const candidates: [0 | 1, number][] = [
    ...(facts.loanCoin === undefined ? [] : [[0, facts.loanCoin.number] as [0, number]]),
    ...Object.values(facts.reserved).flatMap((purposes) => Object.values(purposes).map((number) => [1, number] as [1, number])),
  ];
  for (const [kind, number] of candidates) if (hex(walletAt(wallet, kind, number).lockingBytecode) === at) return byKey(wallet, kind, number, utxo);
  throw new Error('the coin is not at an address the run has had from the wallet');
};
/** The unspent outputs at a script, read from their transactions. */
const coinsAt = async (lockingBytecode: Uint8Array): Promise<Utxo[]> => {
  const coins: Utxo[] = [];
  for (const entry of await server.listUnspent(lockingBytecode)) {
    const text = await server.getTransaction(entry.transactionId);
    if (text === undefined) throw new Error(`transaction ${entry.transactionId} cannot be read`);
    const transaction = decodeTransactionBch(hexToBin(text));
    if (typeof transaction === 'string') throw new Error(transaction);
    coins.push({ transactionHash: hexToBin(entry.transactionId), index: entry.index, output: transaction.outputs[entry.index] as Output });
  }
  return coins;
};
/**
 * Fresh change addresses from the wallet for one transaction, by purpose. The wallet records them as taken and
 * makes them known to the engine before anything names them; the same step continued uses the same ones.
 */
const reserveFor = async (wallet: OwnerWallet, step: string, purposes: string[]): Promise<Record<string, number>> => {
  const known = facts.reserved[step];
  if (known !== undefined) return known;
  const reserved = wallet.parts.reserve(purposes.map(() => 1 as const));
  if (reserved.some((entry) => !entry.fresh)) throw new Error('The wallet\'s window of change addresses is full.');
  await wallet.parts.hold(reserved);
  wallet.parts.keep(reserved);
  facts.reserved[step] = Object.fromEntries(purposes.map((purpose, index) => [purpose, reserved[index]?.address.number as number]));
  keep();
  return facts.reserved[step] as Record<string, number>;
};

// ------------------------------------------------------------------ checking and sending

const vm2025 = createVirtualMachineBch2025(true);
/** This project's check before sending (the 2026 rules, standard, exact fee) and the 2025 rules. */
const verified = (built: BuiltTransaction, what: string): void => {
  const check = checkBeforeSending(built);
  if (check !== true) throw new Error(`${what} fails the check before sending: ${check}`);
  const earlier = vm2025.verify({ transaction: built.transaction, sourceOutputs: built.sourceOutputs });
  if (earlier !== true) throw new Error(`${what} fails under the 2025 rules: ${earlier}`);
};
/** A refusal that means a shared output was spent by someone else meanwhile: build again from what is there now. */
const spentMeanwhile = (reason: string): boolean => /missing-?inputs|missingorspent|mempool-conflict|txn-already-known|inputs-spent/i.test(reason);
/** Inputs of a transaction that spend outputs of transactions not yet in a block. */
const unconfirmedParents = async (built: BuiltTransaction): Promise<number> => {
  const parents = new Set(built.transaction.inputs.map((input) => hex(input.outpointTransactionHash)));
  let count = 0;
  for (const parent of parents) if (((await server.confirmations(parent)) ?? 0) === 0) count += 1;
  return count;
};

/**
 * Build, check, try on the owner's node, write down and send one transaction of the loan. A shared output
 * spent meanwhile by someone else means building again from what is there now. Done once: a run that
 * continues finds the transaction sent, or sends what it wrote down, or builds it again.
 */
const sendLoanStep = async (step: string, about: string | (() => string), build: () => Promise<BuiltTransaction>): Promise<string> => {
  const done = facts.steps[step];
  if (done !== undefined) {
    say(`  (${step}: done before)`);
    return done.transactionIds[0] as string;
  }
  const finish = async (transactionId: string, bytes: number, fee: bigint, chained: number): Promise<string> => {
    await until(`${step} at the server`, async () => (await server.getTransaction(transactionId)) !== undefined, 60_000, 1_000);
    const said = typeof about === 'string' ? about : about();
    record(step, { transactionId, bytes, feeSatoshis: fee }, `${said}${chained > 0 ? `; spends outputs of ${chained} unconfirmed transaction${chained === 1 ? '' : 's'}` : ''}`);
    facts.steps[step] = { transactionIds: [transactionId] };
    facts.pending = Object.fromEntries(Object.entries(facts.pending).filter(([name]) => name !== step));
    keep();
    if (process.env['STOP_AFTER'] === step) throw new Error(`stopped after "${step}", as asked`);
    return transactionId;
  };
  const written = facts.pending[step];
  if (written !== undefined) {
    // Written down and perhaps sent: the server knows it, or the node still takes it and it is sent again.
    const known = (await server.getTransaction(written.transactionId)) !== undefined;
    if (known || (await testMempoolAccept(rpc, written.hex)).allowed) {
      if (!known) await server.broadcast(written.hex);
      const decoded = decodeTransactionBch(hexToBin(written.hex));
      if (typeof decoded === 'string') throw new Error(decoded);
      const spentOutputs: bigint[] = [];
      for (const input of decoded.inputs) {
        const parent = decodeTransactionBch(hexToBin((await server.getTransaction(hex(input.outpointTransactionHash))) ?? ''));
        if (typeof parent === 'string') throw new Error(parent);
        spentOutputs.push(parent.outputs[input.outpointIndex]?.valueSatoshis ?? 0n);
      }
      const fee = spentOutputs.reduce((sum, value) => sum + value, 0n) - decoded.outputs.reduce((sum, output) => sum + output.valueSatoshis, 0n);
      return finish(written.transactionId, written.hex.length / 2, fee, 0);
    }
    facts.pending = Object.fromEntries(Object.entries(facts.pending).filter(([name]) => name !== step));
    keep();
  }
  for (let attempt = 1; attempt <= 6; attempt++) {
    const built = await build();
    verified(built, step);
    const transactionHex = hex(encodeTransactionBch(built.transaction));
    const tried = await testMempoolAccept(rpc, transactionHex);
    if (!tried.allowed) {
      if (spentMeanwhile(tried.reason) && attempt < 6) {
        say(`  ${step}: the node says "${tried.reason}"; a shared output was spent meanwhile; building again`);
        note(`"${step}" was built again after the node answered "${tried.reason}" (attempt ${attempt}).`);
        await wait(3_000);
        continue;
      }
      throw new Error(`${step}: testmempoolaccept refused it: ${tried.reason}`);
    }
    const chained = await unconfirmedParents(built);
    facts.pending[step] = { transactionId: built.transactionId, hex: transactionHex };
    keep();
    const result = await server.broadcast(transactionHex);
    if (!result.accepted && !/already/i.test(result.reason)) {
      if (spentMeanwhile(result.reason) && attempt < 6) {
        note(`"${step}" was built again after the server answered "${result.reason.slice(0, 120)}" (attempt ${attempt}).`);
        facts.pending = Object.fromEntries(Object.entries(facts.pending).filter(([name]) => name !== step));
        keep();
        await wait(3_000);
        continue;
      }
      throw new Error(`${step}: the server refused it: ${result.reason}`);
    }
    return finish(built.transactionId, built.encoded.length, built.feeSatoshis, chained);
  }
  throw new Error(`${step}: not sent after six attempts`);
};

/**
 * The highest height a lock time may name for the node to take the transaction now. On mainnet that is the
 * last block's height. Chipnet has run the tentative upgrade of May 2027 since 15 November 2026: its blocks
 * come every minute, and a lock time given as a height is compared with the height the chain would have at
 * ten-minute blocks, which its node reports as `blocks_ticks` (600 per ten minutes). Both are this.
 */
const lockHeight = async (): Promise<number> => {
  const info = await rpc<{ blocks: number; blocks_ticks?: number }>('getblockchaininfo');
  const height = info.blocks_ticks === undefined ? info.blocks : Math.min(info.blocks, Math.floor(info.blocks_ticks / 600));
  if (height !== info.blocks) {
    note(`A lock time given as a height is compared on chipnet with the height the chain would have at ten-minute blocks: at ${info.blocks} blocks the owner's node reports ${info.blocks_ticks} ticks, and testmempoolaccept took a lock time of ${Math.floor((info.blocks_ticks ?? 0) / 600)} as final and refused ${Math.floor((info.blocks_ticks ?? 0) / 600) + 1} and ${info.blocks} as "bad-txns-nonfinal" (tried during the run, outside this script, with a payment of the funder that was not sent). This is the tentative upgrade of May 2027 that chipnet runs; the run's first attempt to move the Borrowing thread on, with the block height as its lock time, was refused by testmempoolaccept for that reason and nothing was sent. Paryon's periods are counted from lock times, so on chipnet they now follow that height.`, 'lock time heights');
  }
  return height;
};

// ------------------------------------------------------------------ reading Paryon

const pick = <T>(items: T[], what: string): T => {
  const chosen = items[Math.floor(Math.random() * items.length)];
  if (chosen === undefined) throw new Error(`Paryon's deployment shows no ${what}: is it still alive?`);
  return chosen;
};
const readParyon = async (): Promise<ParyonState> => {
  const state = await readParyonState(server, contracts);
  for (const [what, list] of [['Borrowing thread', state.borrowing], ['price thread', state.price], ['loan key factory', state.loanKeyFactory], ['manage function', state.manage]] as const) {
    if (list.length === 0) throw new Error(`Paryon's deployment shows no ${what}: is it still alive?`);
  }
  return state;
};
/** The price thread with the highest price: the smallest borrowing fee. Any thread serves. */
const priceThread = (state: ParyonState) => state.price.slice().sort((a, b) => Number(b.state.price - a.state.price))[0] as ParyonState['price'][number];

interface Prices { stored: bigint; oracle: bigint; oracleTime: number; lower: bigint }
const prices = async (state: ParyonState): Promise<Prices> => {
  const oracle = await latestOraclePrice(contracts.deployment);
  const stored = state.price.reduce((lowest, thread) => (thread.state.price < lowest ? thread.state.price : lowest), priceThread(state).state.price);
  return { stored, oracle: oracle.price, oracleTime: oracle.time, lower: stored < oracle.price ? stored : oracle.price };
};
const dollars = (cents: bigint): string => `$${(Number(cents) / 100).toFixed(2)}`;
const sat = (value: bigint): string => `${value.toLocaleString('en-US')} sat`;

/** The collateral for the loan: the target at the lower price, or what the coins allow; never below the floor. */
const chooseCollateral = (available: bigint, price: Prices, storedForThread: bigint): { collateral: bigint; ratio: number } => {
  const target = collateralAtRatio(DEBT, price.lower, TARGET_PERCENT);
  const collateral = available < target ? available : target;
  const floor = collateralAtRatio(DEBT, price.oracle, FLOOR_PERCENT);
  if (collateral < floor || collateral < minimumCollateral(DEBT, storedForThread)) {
    throw new Error(`STOP before borrowing: ${sat(available)} at hand cannot collateralise ${LOAN_PUSD}.00 PUSD to ${FLOOR_PERCENT}% at the oracle's price of ${dollars(price.oracle)} (that needs ${sat(floor)}). Nothing was borrowed.`);
  }
  return { collateral, ratio: collateralRatio(collateral, DEBT, price.lower) };
};

/** The loan's way out: the closing transaction against the loan as it stands, checked and tried, not sent. */
const proveWayOut = async (wallet: OwnerWallet, when: string): Promise<void> => {
  const name = `the way out is proven ${when}`;
  if (facts.steps[name] !== undefined) return;
  const found = await until('the loan, found from its key', async () => findLoan(server, contracts, hexToBin(facts.keyCategory as string)));
  const state = await readParyon();
  const keyAddress = walletAt(wallet, 1, facts.keyAt as number);
  const [key] = (await coinsAt(keyAddress.lockingBytecode)).filter((coin) => coin.output.token !== undefined && hex(coin.output.token.category) === facts.keyCategory);
  const tokenCoins = (await coinsAt(walletAt(wallet, 1, facts.tokensAt as number).lockingBytecode)).filter((coin) => coin.output.token !== undefined && hex(coin.output.token.category) === P);
  if (key === undefined || tokenCoins.length === 0) throw new Error('the key or the PUSD is not at the wallet\'s address');
  const closing = closeLoan({
    contracts,
    price: pick(state.price, 'price thread'),
    loan: found.loan,
    sidecar: found.sidecar,
    manageFunction: pick(state.manage, 'manage function'),
    key: byKey(wallet, 1, facts.keyAt as number, key),
    wallet: tokenCoins.map((coin) => byKey(wallet, 1, facts.tokensAt as number, coin)),
    keyTo: keyAddress.lockingBytecode,
    changeTo: keyAddress.lockingBytecode,
  });
  verified(closing.built, 'the closing');
  const tried = await testMempoolAccept(rpc, hex(closing.built.encoded));
  if (!tried.allowed) throw new Error(`STOP: the closing transaction against the loan ${when} was refused by testmempoolaccept: ${tried.reason}. The loan: ${hex(found.loan.transactionHash)}:${found.loan.index}; key category ${facts.keyCategory}; the key at change address ${facts.keyAt}, the PUSD at change address ${facts.tokensAt} of the wallet in ${stateFile}.`);
  note(`The way out was proven ${when}: the closing transaction (${closing.built.encoded.length} bytes, against the loan at \`${hex(found.loan.transactionHash).slice(0, 16)}…:${found.loan.index}\` with ${sat(found.loan.output.valueSatoshis)}) passed the virtual machine and testmempoolaccept on the owner's node; it would return ${sat(closing.change.output.valueSatoshis)} and the key. It was not sent.`);
  facts.steps[name] = { transactionIds: [] };
  keep();
};

/** The wallet's own listing, through the engine: the key and the PUSD it holds. */
const walletShows = async (wallet: OwnerWallet, pusd: bigint, when: string): Promise<void> => {
  const tokens = await until(`the wallet to list the key${pusd > 0n ? ' and the PUSD' : ''}`, async () => {
    const { tokens: held } = await wallet.balance();
    const key = held.find((coin) => coin.utxo.output.token !== undefined && hex(coin.utxo.output.token.category) === facts.keyCategory && coin.utxo.output.token.nft?.capability === 'minting');
    const tokenAmount = held.filter((coin) => coin.utxo.output.token !== undefined && hex(coin.utxo.output.token.category) === P).reduce((sum, coin) => sum + (coin.utxo.output.token?.amount ?? 0n), 0n);
    return key !== undefined && tokenAmount === pusd ? held : undefined;
  }, 10 * 60_000);
  const balance = await wallet.balance();
  note(`${when}, the wallet's own listing (the engine following its addresses) shows ${tokens.length} coin${tokens.length === 1 ? '' : 's'} with tokens: the loan key (a minting NFT of its category) ${pusd > 0n ? `and ${Number(pusd) / 100} PUSD ` : 'and no PUSD '}at its recoverable addresses, and ${sat(balance.recoverable)} without tokens.`, `listing ${when}`);
};

// ------------------------------------------------------------------ the parts

try {
  say(phase);

  if (phase === 'the owner creates a wallet') {
    // A check before starting: the deployment is alive, the servers agree, and the coins suffice.
    await once('the check before starting', async () => {
      const state = await readParyon();
      const price = await prices(state);
      const other = await Electrum.connect('wss://chipnet.imaginary.cash:50004').catch(() => undefined);
      const tips = [await server.tip(), ...(other === undefined ? [] : [await other.tip()])];
      await other?.disconnect().catch(() => undefined);
      const nodeTip = await rpc<number>('getblockcount');
      const balance = await funderBalance();
      facts.funderAtStart = String(balance);
      keep();
      const thread = priceThread(state);
      const fee = borrowingFee(DEBT, thread.state.price);
      const available = balance - WALLET_CREATION - fee - MANAGE_ADD - MARGIN - 10_000n;
      const { collateral, ratio } = chooseCollateral(available, price, thread.state.price);
      note(`Before starting: Paryon's deployment \`${contracts.deployment.name}\` showed ${state.borrowing.length} Borrowing threads (periods ${[...new Set(state.borrowing.map((entry) => entry.period))].join(', ')}), ${state.price.length} price threads (${[...new Set(state.price.map((entry) => dollars(entry.state.price)))].join(', ')}), ${state.loanKeyFactory.length} loan key factories and ${state.manage.length} manage NFTs. The tip was ${tips.map((tip) => tip.height).join(' and ')} at two Electrum servers and ${nodeTip} at the owner's node; the current period ${periodAt(contracts.deployment, nodeTip)}. The oracle's latest signed price was ${dollars(price.oracle)} (${new Date(price.oracleTime * 1000).toISOString()}); the stored price is ${dollars(price.stored)}, unchanged since height 330,200. The funder held ${sat(balance)}: enough for ${sat(collateral)} of collateral, ${ratio}% of the debt at ${dollars(price.lower)}.`);
      return { data: { pay: String(collateral + fee + MANAGE_ADD + MARGIN + 10_000n) } };
    });

    const wallet = await openWallet();
    const funding = await wallet.fundingAddress();
    await once('the wallet is funded', async () => {
      const built = await funderPays([{ lockingBytecode: funding, valueSatoshis: WALLET_CREATION }]);
      record('fund the wallet', { transactionId: built.transactionId, bytes: built.encoded.length, feeSatoshis: built.feeSatoshis }, `${sat(WALLET_CREATION)} from the funder to the wallet's funding address, to create the wallet`);
      return { transactionIds: [built.transactionId] };
    });
    if ((await wallet.creationStep()) !== 'created') {
      await until('the funding coin in the engine', async () => (await wallet.creationStep()) !== 'not funded');
      await wallet.create({ recovererKeyHash: credential.recoveryKey.keyHash, challengeDelay: { unit: 'time512', value: 1 } });
      // The recoverer's fee coins, paid here from the run's own coins; the owner gives no allowance.
      await wallet.pay([{ lockingBytecode: p2pkhLockingBytecode(credential.feeKey.keyHash), valueSatoshis: feeReserve() }]);
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
    note('The wallet gave out no address until its creation was in a block; that is the wallet\'s own rule, and the only wait for a block in this run.', 'creation');

    // The coins for the loan: paid to an address the wallet gives out, as output 0, so that the loan key's category can come from it.
    const pay = BigInt((facts.steps['the check before starting']?.data?.['pay'] as string | undefined) ?? '0');
    await once('the wallet is paid for the loan', async () => {
      const given = await wallet.receiveAddress();
      const built = await funderPays([{ lockingBytecode: given.address.lockingBytecode, valueSatoshis: pay }]);
      facts.loanCoin = { number: given.address.number, transactionId: built.transactionId, satoshis: String(pay) };
      keep();
      record('pay the wallet', { transactionId: built.transactionId, bytes: built.encoded.length, feeSatoshis: built.feeSatoshis }, `${sat(pay)} from the funder to an address the wallet gave out, as output 0`);
      return { transactionIds: [built.transactionId] };
    });
    await until('the coin in the wallet', async () => (await wallet.balance()).recoverable >= pay);
  }

  if (phase === 'the loan is opened') {
    const wallet = await openWallet();
    const loanCoin = facts.loanCoin;
    if (loanCoin === undefined) throw new Error('the wallet was not paid for the loan');
    const given = walletAt(wallet, 0, loanCoin.number);

    // The whole course, built against the live outputs and checked, before anything of the loan is sent. What
    // the planned transactions pay goes to the address of the wallet's coin; only the sizes and the scripts matter.
    const course = async (from: { state: ParyonState; price: Prices; enforcer: Utxo; proof: Utxo; change: Utxo; borrowing?: ParyonState['borrowing'][number] }): Promise<string[]> => {
      const to = given.lockingBytecode;
      const done: string[] = [];
      const thread = priceThread(from.state);
      const fee = borrowingFee(DEBT, thread.state.price);
      let borrowingThread: Utxo = from.borrowing ?? (from.state.borrowing.slice().sort((a, b) => Number(b.supply - a.supply))[0] as ParyonState['borrowing'][number]);
      let before = from.change;
      if (from.borrowing === undefined) {
        const height = await lockHeight();
        const moved = updateBorrowingPeriod({ contracts, borrowing: borrowingThread, wallet: [spendWallet(before)], height, changeTo: to });
        verified(moved.built, 'moving the Borrowing thread on (planned)');
        done.push('move the Borrowing thread on');
        borrowingThread = moved.borrowing;
        before = moved.change;
      }
      const { collateral } = chooseCollateral(before.output.valueSatoshis - fee - MANAGE_ADD - MARGIN, from.price, thread.state.price);
      const opened = borrow({ contracts, borrowing: borrowingThread, price: thread, enforcer: from.enforcer, proof: from.proof, wallet: [spendWallet(before)], debt: DEBT, collateral, startingInterest: STARTING_INTEREST, keyTo: to, tokensTo: to, changeTo: to });
      verified(opened.built, 'borrowing (planned)');
      const added = manageLoan({ contracts, price: opened.price, loan: opened.loan, sidecar: opened.sidecar, manageFunction: pick(from.state.manage, 'manage function'), key: spendWallet(opened.key), wallet: [spendWallet(opened.change)], repay: 0n, collateral: collateral + MANAGE_ADD, changeTo: to });
      verified(added.built, 'managing, adding collateral (planned)');
      done.push('borrow', 'manage, adding collateral');
      let last = { price: added.price, loan: added.loan, sidecar: added.sidecar, manageFunction: added.manageFunction, key: added.key, tokens: opened.tokens };
      if (WITH_REPAYMENT) {
        const repaid = manageLoan({ contracts, price: added.price, loan: added.loan, sidecar: added.sidecar, manageFunction: added.manageFunction, key: spendWallet(added.key), wallet: [spendWallet(added.change), spendWallet(opened.tokens)], repay: MINIMUM_DEBT, collateral: added.loan.output.valueSatoshis, tokensChangeTo: to, changeTo: to });
        verified(repaid.built, 'managing with a repayment (planned)');
        done.push('manage, repaying 100.00 PUSD');
        last = { price: repaid.price, loan: repaid.loan, sidecar: repaid.sidecar, manageFunction: repaid.manageFunction, key: repaid.key, tokens: repaid.tokens as Utxo };
      }
      const closed = closeLoan({ contracts, ...last, key: spendWallet(last.key), wallet: [spendWallet(last.tokens)], keyTo: to, changeTo: to });
      verified(closed.built, 'closing (planned)');
      done.push('close');
      return done;
    };

    const coin = (await coinsAt(given.lockingBytecode)).find((entry) => hex(entry.transactionHash) === loanCoin.transactionId && entry.index === 0);
    if (facts.steps['create a loan key'] === undefined) {
      if (coin === undefined) throw new Error('the wallet\'s coin for the loan is not there');
      const state = await readParyon();
      const price = await prices(state);
      const made = createLoanKey({ contracts, factory: pick(state.loanKeyFactory, 'factory'), defining: spendWallet(coin), changeTo: given.lockingBytecode });
      verified(made.built, 'creating a loan key (planned)');
      const planned = ['create a loan key', ...(await course({ state, price, enforcer: made.enforcer, proof: made.proof, change: made.change }))];
      note(`Before anything of the loan was sent, the whole course (${planned.length} transactions: ${planned.join(', ')}) was built against Paryon's live outputs and the wallet's actual coin, chained locally, and every input of every transaction passed the virtual machine (2026 and 2025 rules, standard).`, 'the whole course');
      const reserved = await reserveFor(wallet, 'create a loan key', ['change']);
      await sendLoanStep('create a loan key', 'the wallet\'s coin that is output 0 defines the key\'s category; the change, as the category\'s authhead, to a fresh address', async () => {
        const fresh = await readParyon();
        const made = createLoanKey({ contracts, factory: pick(fresh.loanKeyFactory, 'factory'), defining: byKey(wallet, 0, loanCoin.number, coin), changeTo: walletAt(wallet, 1, reserved['change'] as number).lockingBytecode });
        facts.keyCategory = hex(made.keyCategory);
        keep();
        return made.built;
      });
      await wallet.noteUsed([{ kind: 1, number: reserved['change'] as number }]);
    }
    const created = facts.steps['create a loan key']?.transactionIds[0] as string;
    const createChangeAt = facts.reserved['create a loan key']?.['change'] as number;

    // The Borrowing thread is moved on to the current period, so that no interest can be charged for the
    // periods the deployment's keepers have not counted.
    if (facts.steps['move the Borrowing thread on'] === undefined) {
      const reserved = await reserveFor(wallet, 'move the Borrowing thread on', ['change']);
      await sendLoanStep('move the Borrowing thread on', '`updatePeriodState`: the lock time is the highest height the node takes as final, and the thread\'s period becomes the one of that height', async () => {
        const state = await readParyon();
        const height = await lockHeight();
        const thread = state.borrowing.slice().sort((a, b) => Number(b.supply - a.supply))[0] as ParyonState['borrowing'][number];
        const change = (await coinsAt(walletAt(wallet, 1, createChangeAt).lockingBytecode)).find((entry) => hex(entry.transactionHash) === created && entry.index === 0);
        if (change === undefined) throw new Error('the change of the loan key\'s creation is not there');
        const moved = updateBorrowingPeriod({ contracts, borrowing: thread, wallet: [byKey(wallet, 1, createChangeAt, change)], height, changeTo: walletAt(wallet, 1, reserved['change'] as number).lockingBytecode });
        amount('Borrowing thread', `period ${thread.period} moved to ${moved.period} (lock time ${height}); the loan's interest starts there`);
        return moved.built;
      });
      await wallet.noteUsed([{ kind: 1, number: reserved['change'] as number }]);
    }
    const movedId = facts.steps['move the Borrowing thread on']?.transactionIds[0] as string;
    const movedChangeAt = facts.reserved['move the Borrowing thread on']?.['change'] as number;

    if (facts.steps['borrow'] === undefined) {
      const reserved = await reserveFor(wallet, 'borrow', ['key', 'tokens', 'change']);
      facts.keyAt = reserved['key'] as number;
      facts.tokensAt = reserved['tokens'] as number;
      facts.bchAt = [reserved['change'] as number];
      keep();
      let borrowed = '';
      await sendLoanStep('borrow', () => borrowed, async () => {
        const state = await readParyon();
        const price = await prices(state);
        const thread = priceThread(state);
        const enforcer = (await coinsAt(contracts.loanKeyOriginEnforcer.lockingBytecode)).find((entry) => hex(entry.transactionHash) === created && entry.index === 2);
        const proof = (await coinsAt(contracts.loanKeyOriginProof.lockingBytecode)).find((entry) => hex(entry.transactionHash) === created && entry.index === 3);
        const change = (await coinsAt(walletAt(wallet, 1, movedChangeAt).lockingBytecode)).find((entry) => hex(entry.transactionHash) === movedId && entry.index === 1);
        if (enforcer === undefined || proof === undefined || change === undefined) throw new Error('an output of the loan key\'s creation or of the thread\'s move is not there');
        const ours = state.borrowing.find((entry) => hex(entry.transactionHash) === movedId && entry.index === 0);
        // The rest of the course is built again from here, against what is there now, before the loan is opened.
        await course({ state, price, enforcer, proof, change, ...(ours === undefined ? {} : { borrowing: ours }) });
        const fee = borrowingFee(DEBT, thread.state.price);
        const available = change.output.valueSatoshis - fee - MANAGE_ADD - MARGIN;
        const { collateral, ratio } = chooseCollateral(available, price, thread.state.price);
        if (ours === undefined) note('The Borrowing thread the run moved on was spent by someone else before the loan was opened; another thread was used.');
        const borrowingThread = ours ?? (state.borrowing.slice().sort((a, b) => Number(b.supply - a.supply))[0] as ParyonState['borrowing'][number]);
        const opened = borrow({
          contracts,
          borrowing: borrowingThread,
          price: thread,
          enforcer,
          proof,
          wallet: [byKey(wallet, 1, movedChangeAt, change)],
          debt: DEBT,
          collateral,
          startingInterest: STARTING_INTEREST,
          keyTo: walletAt(wallet, 1, reserved['key'] as number).lockingBytecode,
          tokensTo: walletAt(wallet, 1, reserved['tokens'] as number).lockingBytecode,
          changeTo: walletAt(wallet, 1, reserved['change'] as number).lockingBytecode,
        });
        amount('Debt', `${LOAN_PUSD}.00 PUSD`);
        amount('Prices when the loan was opened', `stored in the price thread used ${dollars(thread.state.price)}; lowest stored ${dollars(price.stored)}; the oracle's latest ${dollars(price.oracle)} (${new Date(price.oracleTime * 1000).toISOString()}); collateral is reckoned at the lower, ${dollars(price.lower)}`);
        amount('Collateral', `${sat(collateral)}: ${ratio}% of the debt at ${dollars(price.lower)}, ${collateralRatio(collateral, DEBT, thread.state.price)}% at the stored price; the contracts' least at the stored price is ${sat(minimumCollateral(DEBT, thread.state.price))} (110%)${ratio < Number(SAFE_PERCENT) ? `; BELOW the aim of ${SAFE_PERCENT}%` : ''}`);
        amount('Borrowing fee', `${sat(opened.borrowingFee)} to Paryon's fee address (0.25% of the debt at the stored price)`);
        amount('Starting interest', `${STARTING_INTEREST} per 10,000,000 per period; the loan's interest period starts at ${opened.state.lastPeriodInterestPaid}`);
        facts.amounts = { ...facts.amounts, 'borrowing fee (sat)': String(opened.borrowingFee) };
        keep();
        borrowed = `${LOAN_PUSD}.00 PUSD against ${sat(collateral)} of collateral, a borrowing fee of ${sat(opened.borrowingFee)}, starting interest ${STARTING_INTEREST}; the key, the PUSD and the change to three fresh addresses of the wallet`;
        return opened.built;
      });
      await wallet.noteUsed(['key', 'tokens', 'change'].map((purpose) => ({ kind: 1 as const, number: reserved[purpose] as number })));
    }
    // The way out first: before anything else is tried, the closing is shown to be accepted.
    await proveWayOut(wallet, 'right after the loan was opened');
    const found = await until('the loan, found from its key', async () => findLoan(server, contracts, hexToBin(facts.keyCategory as string)));
    note(`The loan was found from its key alone, through its sidecar: \`${hex(found.loan.transactionHash).slice(0, 16)}…:${found.loan.index}\`, ${sat(found.loan.output.valueSatoshis)}, a debt of ${Number(found.state.borrowed) / 100} PUSD, interest ${found.state.currentInterestRate}, interest period ${found.state.lastPeriodInterestPaid}.`, 'found after opening');
    await walletShows(wallet, DEBT, 'After the loan was opened');
  }

  if (phase === 'the loan is managed') {
    const wallet = await openWallet();
    const keyCategory = hexToBin(facts.keyCategory as string);
    const current = async (): Promise<{ found: FoundLoan; key: Utxo; state: ParyonState }> => {
      const found = await until('the loan, found from its key', async () => findLoan(server, contracts, keyCategory));
      const key = (await coinsAt(walletAt(wallet, 1, facts.keyAt as number).lockingBytecode)).find((coin) => coin.output.token !== undefined && hex(coin.output.token.category) === facts.keyCategory);
      if (key === undefined) throw new Error('the key is not at its address');
      return { found, key, state: await readParyon() };
    };
    const bchCoins = async (): Promise<InputSpec[]> => {
      const spends: InputSpec[] = [];
      for (const number of facts.bchAt ?? []) for (const coin of await coinsAt(walletAt(wallet, 1, number).lockingBytecode)) if (coin.output.token === undefined) spends.push(byKey(wallet, 1, number, coin));
      return spends;
    };

    if (facts.steps['manage, adding collateral'] === undefined) {
      const reserved = await reserveFor(wallet, 'manage, adding collateral', ['change']);
      await sendLoanStep('manage, adding collateral', `${sat(MANAGE_ADD)} more collateral, no repayment; the key back to the address it was spent from, as the contract requires`, async () => {
        const { found, key, state } = await current();
        const price = await prices(state);
        const thread = pick(state.price, 'price thread');
        const managed = manageLoan({
          contracts,
          price: thread,
          loan: found.loan,
          sidecar: found.sidecar,
          manageFunction: pick(state.manage, 'manage function'),
          key: byKey(wallet, 1, facts.keyAt as number, key),
          wallet: await bchCoins(),
          repay: 0n,
          collateral: found.loan.output.valueSatoshis + MANAGE_ADD,
          changeTo: walletAt(wallet, 1, reserved['change'] as number).lockingBytecode,
        });
        amount('Collateral after managing', `${sat(managed.loan.output.valueSatoshis)}: ${collateralRatio(managed.loan.output.valueSatoshis, managed.state.borrowed, price.lower)}% at ${dollars(price.lower)}`);
        return managed.built;
      });
      facts.bchAt = [reserved['change'] as number];
      keep();
      await wallet.noteUsed([{ kind: 1, number: reserved['change'] as number }]);
    }
    await proveWayOut(wallet, 'after collateral was added');

    if (WITH_REPAYMENT && facts.steps['manage, repaying 100.00 PUSD'] === undefined) {
      const reserved = await reserveFor(wallet, 'manage, repaying 100.00 PUSD', ['tokens', 'change']);
      await sendLoanStep('manage, repaying 100.00 PUSD', '100.00 PUSD repaid and burned in a data output; the loan stays open; the rest of the PUSD and the change to fresh addresses', async () => {
        const { found, key, state } = await current();
        const tokens = (await coinsAt(walletAt(wallet, 1, facts.tokensAt as number).lockingBytecode)).filter((coin) => coin.output.token !== undefined && hex(coin.output.token.category) === P);
        const managed = manageLoan({
          contracts,
          price: pick(state.price, 'price thread'),
          loan: found.loan,
          sidecar: found.sidecar,
          manageFunction: pick(state.manage, 'manage function'),
          key: byKey(wallet, 1, facts.keyAt as number, key),
          wallet: [...(await bchCoins()), ...tokens.map((coin) => byKey(wallet, 1, facts.tokensAt as number, coin))],
          repay: MINIMUM_DEBT,
          collateral: found.loan.output.valueSatoshis,
          tokensChangeTo: walletAt(wallet, 1, reserved['tokens'] as number).lockingBytecode,
          changeTo: walletAt(wallet, 1, reserved['change'] as number).lockingBytecode,
        });
        return managed.built;
      });
      facts.tokensAt = reserved['tokens'] as number;
      facts.bchAt = [reserved['change'] as number];
      keep();
      await wallet.noteUsed(['tokens', 'change'].map((purpose) => ({ kind: 1 as const, number: reserved[purpose] as number })));
      await proveWayOut(wallet, 'after the repayment');
    }
    if (!WITH_REPAYMENT) {
      const state = await readParyon();
      const price = await prices(state);
      const needed = collateralAtRatio(2n * MINIMUM_DEBT, price.lower, SAFE_PERCENT);
      note(`Managing with a repayment that leaves the loan open was not sent. The manage contract takes a repayment of 0, of at least 100.00 PUSD, or of the whole debt, and leaves at least 100.00 PUSD (\`manage.cash\` 62–69, 92), so it needs a loan of at least 200.00 PUSD; at ${SAFE_PERCENT}% of the oracle's ${dollars(price.oracle)} that is ${sat(needed)} of collateral, and the funder held ${sat(BigInt(facts.funderAtStart as string))}. The same transaction was built and checked in the virtual machine against Paryon's live outputs, with the wallet's parts at recoverable addresses (\`packages/paryon/test/transactions.test.ts\`, "PY04: managing with a repayment"), and this script runs that course on chain with \`--loan 200\`. Here the closing is the on-chain repayment: the whole debt repaid and burned, and the loan's NFT burned.`, 'repayment not sent');
    }
    const after = await until('the loan', async () => findLoan(server, contracts, keyCategory));
    note(`After managing, the loan found from its key holds ${sat(after.loan.output.valueSatoshis)} with a debt of ${Number(after.state.borrowed) / 100} PUSD; the key is at the same address as before (${facts.keyAt === facts.reserved['borrow']?.['key']}).`, 'after managing');
    await walletShows(wallet, WITH_REPAYMENT ? DEBT - MINIMUM_DEBT : DEBT, 'After managing');
  }

  if (phase === 'the loan is closed') {
    const wallet = await openWallet();
    const keyCategory = hexToBin(facts.keyCategory as string);
    let collateralAtClose = 0n;
    if (facts.steps['close'] === undefined) {
      const reserved = await reserveFor(wallet, 'close', ['key', 'change']);
      await sendLoanStep('close', 'the whole debt repaid: the PUSD and the loan\'s own NFT burned in data outputs; the sidecar\'s NFT burned; the collateral and the key to fresh addresses', async () => {
        const found = await until('the loan, found from its key', async () => findLoan(server, contracts, keyCategory));
        const state = await readParyon();
        const key = (await coinsAt(walletAt(wallet, 1, facts.keyAt as number).lockingBytecode)).find((coin) => coin.output.token !== undefined && hex(coin.output.token.category) === facts.keyCategory);
        const tokens = (await coinsAt(walletAt(wallet, 1, facts.tokensAt as number).lockingBytecode)).filter((coin) => coin.output.token !== undefined && hex(coin.output.token.category) === P);
        if (key === undefined) throw new Error('the key is not at its address');
        collateralAtClose = found.loan.output.valueSatoshis;
        const closed = closeLoan({
          contracts,
          price: pick(state.price, 'price thread'),
          loan: found.loan,
          sidecar: found.sidecar,
          manageFunction: pick(state.manage, 'manage function'),
          key: byKey(wallet, 1, facts.keyAt as number, key),
          wallet: tokens.map((coin) => byKey(wallet, 1, facts.tokensAt as number, coin)),
          keyTo: walletAt(wallet, 1, reserved['key'] as number).lockingBytecode,
          changeTo: walletAt(wallet, 1, reserved['change'] as number).lockingBytecode,
        });
        amount('Closing', `${Number(closed.repaid) / 100} PUSD repaid and burned; the loan held ${sat(collateralAtClose)}, of which ${sat(closed.change.output.valueSatoshis)} came back to the wallet after the network fee (with the sidecar's and the PUSD output's 1,000 satoshis each)`);
        return closed.built;
      });
      facts.keyAt = reserved['key'] as number;
      facts.bchAt = [...(facts.bchAt ?? []), reserved['change'] as number];
      keep();
      await wallet.noteUsed(['key', 'change'].map((purpose) => ({ kind: 1 as const, number: reserved[purpose] as number })));
    }
    const gone = await until('the loan to be gone', async () => ((await findLoan(server, contracts, keyCategory)) === undefined ? true : undefined), 120_000);
    note(`After closing, the key opens no loan any more: the finder found none (${gone}). The key itself stays in the wallet; the contracts do not require it to continue.`, 'after closing');
    await walletShows(wallet, 0n, 'After closing');
  }

  if (phase === 'the wallet is closed') {
    const wallet = await openWallet();
    if ((await wallet.closed())) {
      say('  (the wallet is closed: done before)');
    } else {
      await once('the wallet is searched', async () => {
        const result = await wallet.search();
        note(`The wallet's search over its seed ended as "${result.status}".`);
        return undefined;
      });
      await once('the key is sent on', async () => {
        const holding = await until('the key', async () => { const now = await wallet.balance(); return now.tokens.length === 1 ? now.tokens[0] : undefined; });
        const sent = await wallet.sendToken(holding, funderLocking);
        record('send the key on', sent, 'the loan key, unchanged, to the address that paid for the run; the wallet\'s own transaction');
        return { transactionIds: [sent.transactionId] };
      });
      await until('the wallet without a token', async () => (await wallet.balance()).tokens.length === 0);
      await wait(5_000);
      const closing = await wallet.close(funderLocking);
      for (const sent of closing.transactions) record('close the wallet', sent, 'everything, and the controller\'s value, back to the address that paid for the run');
    }
    const identity = hexToBin(facts.identity as string);
    const history = await until('the closing', async () => { const read = await readControllerHistory(chain, identity); return read.closed === undefined ? undefined : read; });
    note(`The controller's history: ${history.transitions.map((step) => step.kind).join(', ') || 'no transition'}, then closed.`);
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
  }

  if (phase === 'the run returns what is left') {
    // The loan is closed and the run is over: the funder destroys the key and takes the satoshis under it.
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
    const identity = hexToBin(facts.identity as string);
    const total = await until('the funder\'s coins', async () => { const value = await funderBalance(); return value > 0n ? value : undefined; });
    const places: [string, Uint8Array][] = [
      ['the wallet\'s funding address', p2pkhLockingBytecode(ownerSeed.fundingKey.keyHash)],
      ['the recoverer\'s fee address', p2pkhLockingBytecode(credential.feeKey.keyHash)],
    ];
    const left: string[] = [];
    for (const [name, lockingBytecode] of places) {
      const sum = (await server.listUnspent(lockingBytecode)).reduce((value, entry) => value + entry.valueSatoshis, 0n);
      if (sum > 0n) left.push(`${sum} at ${name}`);
    }
    const found = (await quickPass(chain, identity, ownerSeed.viewingKey)).found.flatMap((address) => address.coins);
    if (found.length > 0) left.push(`${found.length} coins at addresses of the wallet`);
    const spent = BigInt(facts.funderAtStart as string) - total;
    const networkFees = facts.log.reduce((sum, entry) => sum + BigInt(entry.fee), 0n);
    const borrowFee = BigInt(facts.amounts?.['borrowing fee (sat)'] ?? '0');
    amount('Funder', `${sat(BigInt(facts.funderAtStart as string))} before the run, ${sat(total)} after it`);
    amount('Cost of the run', `${sat(spent)}: the borrowing fee ${sat(borrowFee)}, network fees ${sat(networkFees)} for the ${facts.log.length} transactions above, interest 0, and ${sat(spent - borrowFee - networkFees)} otherwise`);
    note(`The funding address held ${facts.funderAtStart} satoshis before the run and holds ${total} after it: the run cost ${spent} satoshis. ${left.length === 0 ? `Nothing is left anywhere else: no PUSD (all of it was burned${WITH_REPAYMENT ? ' at the repayment and the closing' : ' at the closing'}), no loan key (destroyed by the funder), no coin at the wallet's or the recoverer's addresses.` : `LEFT BEHIND: ${left.join('; ')}.`}`);
    if (left.length > 0) throw new Error(`coins were left behind: ${left.join('; ')}`);
  }
  if (!facts.finished.includes(phase)) facts.finished.push(phase);
  keep();
} catch (error) {
  say(`FAILED: ${(error as Error).name}: ${String((error as Error).message).slice(0, 900)}\n${String((error as Error).stack).split('\n').slice(1, 5).join('\n')}`);
  process.exitCode = STOPPED;
} finally {
  await server.disconnect().catch(() => undefined);
  await account?.close();
  process.exit();
}
