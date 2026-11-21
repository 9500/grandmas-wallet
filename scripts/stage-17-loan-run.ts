// The stage 17 run on the local node for a ParyonUSD loan (acceptance test PR20 of proposal v0.6, on the local node):
// the loan without a recovery declaration, through the loss of a device.
//
// Paryon's contracts as published are deployed on the local chain by this script, as the run of stage 9 did
// (packages/paryon/src/local-deployment.ts). An owner's wallet is created on the XO engine, with a recoverer. The
// loan page's part is played by the library the page uses (packages/paryon: `page-requests.ts`, `findLoan`,
// `loanCoins`, `readParyonState`), its requests sent with the page's `DappRequests` to the wallet's connector for
// applications over a session in memory, every message through JSON and back as it travels. The page reads Paryon's
// coins from the chain itself, names each by outpoint, gives the values it read from them and from the loan, says
// which loan key an action is about, where the key goes, what the key's coin holds as the wallet reported it, and its
// own address; it sends the Paryon template alone, version 2. Every action of the template is carried out, each as an
// invitation: a loan key is made (the user ticks that the key, made from the wallet's coin, waits in Paryon's contract),
// the Borrowing thread is brought up to date, 200.00 PUSD are borrowed, collateral is added, the interest rate is
// changed and 100.00 PUSD are repaid, leaving the loan open. The device is lost. The recoverer requests, waits and completes; a new device takes the wallet
// over with the project's recovery flow, sweeps the key and the PUSD, copies the earlier archive, reads the record of
// the key from a store, and is told by the user to trust the template the earlier owner stored. The wallet by itself
// sends the user to the page. The page, connected to the new device and allowed by the user, is told of the key, finds
// the loan and closes it. At the end the wallet is closed and every coin is back at the address that paid for the run.
//
// No recovery declaration is read anywhere: none is sent, stored or kept, and the run checks that.
//
// One script, two chains: the local node (regtest) and chipnet, as in run B (scripts/run-b.ts). On the local node the
// run deploys Paryon's contracts itself, makes its blocks and moves the chain's clock. On chipnet it uses Paryon's own
// public deployment `chipnet-fast-periods-6`, unchanged, with the frozen template
// (packages/paryon/frozen/paryon-loan-v2-chipnet-fast-periods-6.json) as the page sends it; it is paid from the saved
// funding key, leaves a reserve there, reckons the collateral from the price stored in Paryon's price contract (no
// oracle and nothing of Paryon's but its contracts on the chain is consulted), never makes a block, waits for one only
// where a confirmation is needed, and lets the waiting period pass on the chain's own clock. There Paryon's keeper moves
// the Borrowing threads on as soon as a period begins: the run moves one on itself only where a thread is behind, or
// where a period begins within a few minutes and it takes a thread before the keeper does; otherwise it goes on without
// that action and says so in the record. The loan key is destroyed
// at the end, and everything else goes back to the funding key; Paryon's borrowing fee stays with Paryon.
//
// Each part is a process of its own with an empty engine state, as a device session would be. What the run knows
// between parts is in .local-runs/stage-17-loan-local.json (on chipnet .chipnet/stage-17-loan-chipnet.json); the
// stores are directories beside it. Every step is written to that file once it is carried out. A run that stops is
// continued with the same command; `--new` starts again (on chipnet only once the earlier run has finished, and its
// file is kept under another name).
//
// usage (from packages/app):
//   npx tsx ../../scripts/stage-17-loan-run.ts [local]       with the local node running (deploy/regtest/regtest.sh)
//   npx tsx ../../scripts/stage-17-loan-run.ts chipnet       paid from the key in .chipnet/funder-design-2.json
//   npx tsx ../../scripts/stage-17-loan-run.ts chipnet --dry reads Paryon's deployment and the funding key, and says
//                                                            what a run would need; sends nothing
// The log is written to docs/runs/stage-17-loan-local-node.md (on chipnet docs/runs/stage-17-loan-chipnet.md, with
// the invitations in docs/runs/invitations/stage-17-loan-chipnet/).
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
import { chipnetFunder, coinsFor, electrumEndpoint, engineServers, medianTime as medianTimeAt, runArguments, startOver } from './stage-17-chain.js';
import {
  type OwnerWalletState,
  NeedsApplicationError,
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
// The application's own definitions, and the library its page uses. The wallet's code has none of them: the template
// reaches it as a text, in the page's requests.
import {
  type FoundLoan,
  type LoanRequestAlone,
  type ParyonContracts,
  type ParyonDeployment,
  type ParyonState,
  CHIPNET_FAST_PERIODS_6,
  borrowRequestAlone,
  borrowingFee,
  closeRequestAlone,
  collateralAtRatio,
  collateralRatio,
  createKeyRequestAlone,
  decodeLoanState,
  findLoan,
  loanCoins,
  localDeployment,
  manageRequestAlone,
  changeInterestRequestAlone,
  interestCoins,
  interestPerPeriod,
  minimumCollateral,
  movePeriodRequestAlone,
  paryonChipnetTemplateText,
  paryonContracts,
  paryonTemplateAlone,
  periodAt,
  periodStart,
  readInterestFunctions,
  readParyonState,
  repayRequestAlone,
} from '../packages/paryon/src/index.js';
import { detailsOf } from '../apps/loan/src/xo.js';
import { CHIPNET_FASTER_BLOCKS_FROM, finalLockHeight } from '../apps/loan/src/loan.js';
import { type PageLink, pageLink } from './stage-17-page-link.js';
// @ts-expect-error a plain script: the engine's settings for the local chain, and the node's RPC
import { rpc, mine, BURN } from '../spikes/xo-engine/regtest.mjs';

const hex = binToHex;
const root = fileURLToPath(new URL('..', import.meta.url));
/** The exit code of a part that stopped at a step of its own and said why. */
const STOPPED = 3;
const PHASES = ['the owner opens a loan', 'the recoverer recovers', 'the new device closes the loan from the page', 'the recoverer returns its balance', 'the run returns what is left'];
const { chainName, local, phase, dry, fresh } = runArguments(PHASES, 'stage-17-loan-run.ts');
const runDirectory = local ? `${root}.local-runs` : `${root}.chipnet`;
mkdirSync(runDirectory, { recursive: true });
const stateFile = `${runDirectory}/stage-17-loan-${local ? 'local' : 'chipnet'}.json`;
const storeDirectory = `${runDirectory}/stage-17-loan-${local ? '' : 'chipnet-'}stores`;
/** The XO invitation behind every transaction an account of the run sends, a file each (scripts/invitation-files.ts). */
const invitations = local ? `${runDirectory}/invitations/stage-17-loan/` : invitationDirectory('stage-17-loan-chipnet', false);
const logFile = `${root}docs/runs/stage-17-loan-${local ? 'local-node' : 'chipnet'}.md`;
/** Where the page says it is served from; the run has no web server, and the address is only kept in the record. */
const PAGE = 'https://loan.example/';
/**
 * PUSD cents borrowed, the collateral's share of the debt at the stored price, what is added later, and what is repaid
 * before the device is lost: Paryon takes at least 100.00 PUSD in a part repayment and leaves at least 100.00 owed.
 */
const DEBT = 200_00n;
const PERCENT = 125n;
const MANAGE_ADD = 100_000n;
const REPAY = 100_00n;
/** The loan's interest rate for the periods to come, set by the action that changes it: per 10,000,000 per period. */
const NEW_RATE = 100;
/** The steps of the loan, named by what they do. */
const BORROWED = `${DEBT / 100n}.00 PUSD are borrowed`;
/**
 * On chipnet: how many blocks ahead a period may begin for the run to wait for it, and to try to move a Borrowing thread
 * on before Paryon's keeper does; and how long it waits at most. A period is three blocks there as the network counts lock
 * times, at ten-minute blocks, which is thirty of chipnet's one-minute blocks.
 */
const PERIOD_WAIT_BLOCKS = 4;
const PERIOD_WAIT_MS = 6 * 60_000;
/** US cents per BCH in the deployment's price threads on the local chain, as in the run of stage 9. */
const PRICE = 20_870n;
/** On chipnet: what the wallet is given to create it, and what is left at the funding key for other runs. */
const WALLET_CREATION = 80_000n;
const LEAVE_AT_FUNDER = 1_000_000n;
/** On chipnet: the least share of the debt the collateral may be worth at the lowest stored price when borrowing. */
const FLOOR_PERCENT = 112n;
/** Paryon's deployment on chipnet and the identifier of its frozen template, version 2, which the run sends unchanged. */
const CHIPNET_TEMPLATE_IDENTIFIER = '3fa4baf9f313ee2a5046ae30fdf1f7affc6aca21a29e3f6b38227b4a826e9235';

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
  deployment?: ParyonDeployment;
  loan?: { keyCategory?: string; collateral?: string };
  amounts?: string[];
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

const pusd = (cents: bigint): string => `${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`;
const dollars = (cents: bigint): string => `$${pusd(cents)}`;
const sat = (value: bigint): string => `${value.toLocaleString('en-US')} sat`;
/**
 * The template the page sends, with the names its requests give it: on chipnet the frozen text of Paryon's
 * deployment, unchanged, checked against its known identifier; on the local chain made for the run's own deployment.
 */
const templateOf = (deployment: ParyonDeployment): { names: { identifier: string; contentHash: string }; texts: { template: string } } => {
  if (local) return paryonTemplateAlone(paryonContracts(deployment));
  if (deployment.name !== CHIPNET_FAST_PERIODS_6.name) throw new Error(`on chipnet the run uses Paryon's deployment ${CHIPNET_FAST_PERIODS_6.name}, not ${deployment.name}`);
  const read = readTemplate(paryonChipnetTemplateText);
  if (read.identifier !== CHIPNET_TEMPLATE_IDENTIFIER) throw new Error(`the frozen template's identifier is ${read.identifier}, not ${CHIPNET_TEMPLATE_IDENTIFIER}`);
  return { names: { identifier: read.identifier, contentHash: read.contentHash }, texts: { template: paryonChipnetTemplateText } };
};
/** The price threads as the run reckons with them: the highest, which the page names and the contracts take, and the lowest, at which the collateral is reckoned. */
const pricesOf = (state: ParyonState): { thread: ParyonState['price'][number]; used: bigint; lowest: bigint } => {
  const [thread] = state.price.slice().sort((a, b) => (b.state.price > a.state.price ? 1 : -1));
  if (thread === undefined) throw new Error('Paryon\'s deployment shows no price thread');
  return { thread, used: thread.state.price, lowest: state.price.reduce((lowest, entry) => (entry.state.price < lowest ? entry.state.price : lowest), thread.state.price) };
};
/** Paryon's deployment as it stands on the chain: every kind of contract a loan needs, or the reason it cannot go on. */
const aliveOrStop = (state: ParyonState): ParyonState => {
  for (const [what, list] of [['Borrowing thread', state.borrowing], ['price thread', state.price], ['loan key factory', state.loanKeyFactory], ['manage function', state.manage]] as const) {
    if (list.length === 0) throw new Error(`Paryon's deployment shows no ${what} just now; nothing more was sent`);
  }
  return state;
};
/** Paryon's interest function, which changing the interest rate spends: its coins on the chain, or the reason the run cannot go on. */
const interestAliveOrStop = async (reading: Parameters<typeof readInterestFunctions>[0], contracts: ParyonContracts): Promise<number> => {
  const found = await readInterestFunctions(reading, contracts);
  if (found.length === 0) throw new Error('Paryon\'s deployment shows no interest function just now; nothing more was sent');
  return found.length;
};
/**
 * On chipnet, the highest height a lock time may name for the network to take the transaction in the next block: lock
 * times by height are compared with the height the chain would have at ten-minute blocks, and must be below it. This is
 * what Paryon's keeper uses (its transactions moving the threads on were each taken in the first block that allowed
 * them, or one or two later); the page keeps a block in hand (`finalLockHeight`).
 */
const countedHeight = (height: number): number => (height < CHIPNET_FASTER_BLOCKS_FROM ? height : CHIPNET_FASTER_BLOCKS_FROM + Math.floor((height - CHIPNET_FASTER_BLOCKS_FROM) / 10));
const earliestLockHeight = (tip: number): number => countedHeight(tip + 1) - 1;
/** The tip at which a lock height becomes final for the next block: the first tip whose next block's counted height is above it. */
const tipForLock = (lock: number): number => {
  let tip = CHIPNET_FASTER_BLOCKS_FROM + (lock - CHIPNET_FASTER_BLOCKS_FROM) * 10 - 20;
  while (earliestLockHeight(tip) < lock) tip += 1;
  return tip;
};
/** The wallet said that another transaction spent one of the coins the request named first: nothing was sent. */
const spentFirst = (error: unknown): boolean => (error as { name?: string }).name === 'RequestRefusedError' && (error as { code?: string }).code === 'inputs-spent';
/** The wallet refused the request: nothing was sent. */
const refusedByWallet = (error: unknown): boolean => (error as { name?: string }).name === 'RequestRefusedError';

/** What a loan on chipnet takes from the funder, from the prices stored in Paryon's price threads. */
const chipnetCourse = (state: ParyonState): { collateral: bigint; fee: bigint; pay: bigint; needed: bigint; used: bigint; lowest: bigint } => {
  const { used, lowest } = pricesOf(state);
  const collateral = collateralAtRatio(DEBT, lowest, PERCENT);
  const fee = borrowingFee(DEBT, used);
  const pay = collateral + fee + MANAGE_ADD + 50_000n;
  return { collateral, fee, pay, needed: pay + WALLET_CREATION + 20_000n + LEAVE_AT_FUNDER, used, lowest };
};
/** The Borrowing thread the run would bring up to date, the one with the largest supply, and whether it needs it. */
const threadToMove = (state: ParyonState, deployment: ParyonDeployment, height: number): { thread: ParyonState['borrowing'][number] | undefined; current: number; needed: boolean } => {
  const [thread] = state.borrowing.slice().sort((a, b) => (b.supply > a.supply ? 1 : -1));
  const current = periodAt(deployment, height);
  return { thread, current, needed: thread !== undefined && thread.period < current };
};

// ------------------------------------------------------------------ the driver: one process for each part

if (phase === undefined && dry) {
  // A look at chipnet before a run: Paryon's deployment as it stands, the stored prices, what the loan would take from
  // the funding key, and whether the Borrowing thread would be brought up to date. Nothing is written or sent.
  const server = await Electrum.connect(electrumEndpoint(false));
  try {
    const contracts = paryonContracts(CHIPNET_FAST_PERIODS_6);
    const template = templateOf(CHIPNET_FAST_PERIODS_6);
    const made = paryonTemplateAlone(contracts);
    console.log(`The frozen template "${readTemplate(template.texts.template).definition.name ?? ''}" ${template.names.identifier}, content ${template.names.contentHash}; the template made from the deployment's parameters today ${made.names.identifier === template.names.identifier && made.names.contentHash === template.names.contentHash ? 'is the same' : `DIFFERS (${made.names.identifier}, ${made.names.contentHash}); the run sends the frozen one`}.`);
    const tip = await server.tip();
    const lockHeight = earliestLockHeight(tip.height);
    const state = aliveOrStop(await readParyonState(server, contracts));
    const interestFunctions = await interestAliveOrStop(server, contracts);
    console.log(`chipnet at ${electrumEndpoint(false)}: tip ${tip.height}; the highest height a lock time may name for the next block ${lockHeight}, in Paryon's period ${periodAt(CHIPNET_FAST_PERIODS_6, lockHeight)} (the page, which keeps a block in hand: ${finalLockHeight('chipnet', tip.height)}).`);
    console.log(`Paryon's deployment ${CHIPNET_FAST_PERIODS_6.name}: ${state.borrowing.length} Borrowing threads (periods ${[...new Set(state.borrowing.map((entry) => entry.period))].join(', ')}), ${state.price.length} price threads (${[...new Set(state.price.map((entry) => dollars(entry.state.price)))].join(', ')}), ${state.loanKeyFactory.length} loan key factories, ${state.manage.length} manage functions, ${interestFunctions} interest functions.`);
    const course = chipnetCourse(state);
    const current = periodAt(CHIPNET_FAST_PERIODS_6, lockHeight);
    const behind = state.borrowing.filter((thread) => thread.period < current);
    const nextTip = tipForLock(periodStart(CHIPNET_FAST_PERIODS_6, current + 1));
    console.log(
      behind.length > 0
        ? `${behind.length} of the Borrowing threads are behind the current period ${current}: the run would bring one up to date ("movePeriod"), if Paryon's keeper does not first.`
        : `No Borrowing thread is behind the current period ${current}: Paryon's keeper moved them on. The next period begins for a transaction in the block after tip ${nextTip}, ${nextTip - tip.height} blocks from now; the run waits for it only if it is at most ${PERIOD_WAIT_BLOCKS} blocks away when it gets there, and then tries to move a thread on before the keeper does, for at most ${PERIOD_WAIT_MS / 60_000} minutes. Otherwise it goes on without "movePeriod" and says so in the record.`,
    );
    console.log(`The course: make a key, bring a Borrowing thread up to date where it can, borrow ${pusd(DEBT)} PUSD, add ${sat(MANAGE_ADD)} of collateral, change the interest rate to ${NEW_RATE} per 10,000,000 per period, repay ${pusd(REPAY)} PUSD; the device is lost and recovered; the new device closes the loan from the page, repaying the remaining ${pusd(DEBT - REPAY)} PUSD.`);
    console.log(`The loan: ${pusd(DEBT)} PUSD against ${sat(course.collateral)} of collateral, ${PERCENT}% at the lowest stored price ${dollars(course.lowest)} (${collateralRatio(course.collateral, DEBT, course.used)}% at the highest, ${dollars(course.used)}, at which the contracts take it; their least there is ${sat(minimumCollateral(DEBT, course.used))}); Paryon's borrowing fee ${sat(course.fee)}, kept by Paryon; ${sat(MANAGE_ADD)} added later.`);
    const funderLocking = p2pkhLockingBytecode(chipnetFunder().keyHash);
    const coins = await server.listUnspent(funderLocking, 'exclude');
    const tokens = await server.listUnspent(funderLocking, 'only');
    const balance = coins.reduce((sum, coin) => sum + coin.valueSatoshis, 0n);
    console.log(`The funding key holds ${sat(balance)} in ${coins.length} coins without tokens, and ${tokens.length} coins with tokens (left alone by the run). The run pays the wallet ${sat(WALLET_CREATION)} to create it and ${sat(course.pay)} for the loan, and leaves ${sat(LEAVE_AT_FUNDER)} at the key: it needs ${sat(course.needed)}. ${balance >= course.needed ? 'The key holds enough.' : 'The key holds TOO LITTLE.'}`);
    console.log(`What the run would cost: Paryon's borrowing fee ${sat(course.fee)}, network fees of about 20,000 sat, and 1,500 sat for each interest payment someone else makes on the loan while it is open (a period is about 30 minutes on chipnet). The interest is 0 until the first payment after the rate is changed; from then on ${sat(interestPerPeriod(NEW_RATE, DEBT - REPAY, course.used))} a period at ${NEW_RATE} per 10,000,000 (on ${pusd(DEBT - REPAY)} PUSD after the repayment; ${sat(interestPerPeriod(NEW_RATE, DEBT, course.used))} on ${pusd(DEBT)}).`);
    console.log(existsSync(stateFile) ? `A run is under way: ${stateFile.slice(root.length)} (finished: ${(JSON.parse(readFileSync(stateFile, 'utf8')) as Facts).finished.join(', ') || 'nothing yet'}). The same command without --dry continues it.` : `No run is under way; ${stateFile.slice(root.length)} does not exist.`);
  } finally {
    await server.disconnect().catch(() => undefined);
  }
  process.exit(0);
}

if (phase === undefined) {
  if (fresh) startOver(local, stateFile, storeDirectory, PHASES);
  if (!existsSync(stateFile)) rmSync(invitations, { recursive: true, force: true });
  if (local && !existsSync(stateFile) && Number(execFileSync(`${root}deploy/regtest/regtest.sh`, ['cli', 'getblockcount'], { encoding: 'utf8' })) > 1000) {
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
    return local ? `${found.action} (${found.templateName})` : `[${found.action}](invitations/stage-17-loan-chipnet/${found.file})`;
  };
  const sent = templateOf(facts.deployment as ParyonDeployment);
  const revision = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const changed = execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).split('\n').filter((line) => line.trim() !== '' && !line.includes('docs/runs/') && !line.includes('.chipnet'));
  writeFileSync(
    logFile,
    [
      `# Stage 17 run on ${local ? 'the local node' : 'chipnet'}: a ParyonUSD loan without a declaration, through the loss of a device (PR20)`,
      '',
      (local
        ? 'Written by the run itself (`scripts/stage-17-loan-run.ts`). The owner\'s wallet, the recoverer and the new device, each on the unmodified XO engine, against the local node in regtest mode with the public networks\' relay rules, on which the run deployed Paryon\'s contracts as published, as the run of stage 9 did (`packages/paryon/src/local-deployment.ts`).'
        : `Written by the run itself (\`scripts/stage-17-loan-run.ts chipnet\`). The owner's wallet, the recoverer and the new device, each on the unmodified XO engine, on chipnet, against Paryon's own public deployment \`${CHIPNET_FAST_PERIODS_6.name}\`, unchanged, with its frozen template, version 2 (\`packages/paryon/frozen/paryon-loan-v2-chipnet-fast-periods-6.json\`), as the page sent it; nothing of Paryon's but its contracts on the chain was consulted. The run was paid from the funding address and returned everything to it at the end but Paryon's borrowing fee; it made no block, and the waiting period passed on the chain's own clock.`) +
        ' Each part ran in a process of its own with an empty engine state. The Paryon template reached the wallet alone, as a text, in the requests of the loan page: the library the page uses (`packages/paryon`: `page-requests.ts`, `findLoan`, `loanCoins`, `readParyonState`) made each request from what it read on the chain, and the page\'s `DappRequests` sent it to the wallet\'s connector for applications over a session in memory, every message through JSON and back as it travels; only the relay and the page\'s screens were left out. Every transaction of the loan is an invitation of that template, built by the unmodified engine, which signed the wallet\'s own inputs, and compared with what the wallet\'s own code had worked out before it was sent; every input of Paryon\'s was evaluated in the virtual machine before the user was asked. The backup stores are two directories of the run, read and written as a store server\'s are. No recovery declaration was sent, stored, kept or read anywhere in the run.',
      '',
      `- Wallet identity: \`${facts.identity}\``,
      `- Loan key (token category): \`${facts.loan?.keyCategory}\``,
      `- Template "${readTemplate(sent.texts.template).definition.name ?? ''}" \`${sent.names.identifier}\`, content \`${sent.names.contentHash}\`, with no declaration`,
      `- Paryon's deployment ${local ? 'on the local chain' : `\`${facts.deployment?.name}\``}: PUSD \`${facts.deployment?.tokenIds.paryon}\`, factories \`${facts.deployment?.tokenIds.loanKeyFactory}\``,
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
      'The position record the earlier device wrote before the borrowing was signed, when the key reached the wallet, as the new device read it from a store:',
      '',
      '```json',
      JSON.stringify(facts.record ?? null, null, 1),
      '```',
      '',
      '| Step | Transaction | Bytes | Fee (sat) | Note | Invitation |',
      '| --- | --- | --- | --- | --- | --- |',
      ...facts.log.map((entry) => `| ${entry.step} | \`${entry.transactionId}\` | ${entry.bytes} | ${entry.fee} | ${entry.note} | ${invitationOf(entry.transactionId)} |`),
      '',
      'Amounts:',
      '',
      ...(facts.amounts ?? []).map((line) => `- ${line}`),
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
 * for longer (`BLOCK_PATIENCE_MS`), and the waiting period as long as the chain's clock needs.
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

// The key that pays for the run and gets everything back: on the local chain one of the run's own, paid by block
// rewards; on chipnet the saved funding key.
if (local && facts.localFunder === undefined) {
  facts.localFunder = hex(crypto.getRandomValues(new Uint8Array(32)));
  keep();
}
const funder: KeyPair = local ? keyPairFromPrivateKey(hexToBin(facts.localFunder as string)) : chipnetFunder();
const funderLocking = p2pkhLockingBytecode(funder.keyHash);
// On chipnet the deployment is Paryon's own, known before the run starts.
if (!local && facts.deployment === undefined) {
  facts.deployment = CHIPNET_FAST_PERIODS_6;
  keep();
}
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

/** The deployment's contracts and the template the page sends, once the deployment is known. */
let contractsCache: ParyonContracts | undefined;
const contracts = (): ParyonContracts => {
  if (facts.deployment === undefined) throw new Error('Paryon\'s contracts are not deployed yet');
  return (contractsCache ??= paryonContracts(facts.deployment));
};
let templateCache: ReturnType<typeof templateOf> | undefined;
const template = (): ReturnType<typeof templateOf> => (templateCache ??= templateOf(contracts().deployment));
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
/** No declaration anywhere: what the wallet keeps of each template. */
const noDeclaration = (applications: Applications, where: string): string => {
  const kept = applications.templates.filter((kept) => 'declaration' in kept || kept.identifier !== template().names.identifier);
  if (kept.length > 0) throw new Error(`${where} keeps a template with a declaration, or another template`);
  return `${where} keeps ${applications.templates.length} template, Paryon's, with no declaration`;
};
const amount = (line: string, name: string): void => {
  facts.amounts = [...(facts.amounts ?? []).filter((known) => !known.startsWith(`${name}:`)), `${name}: ${line}`];
  keep();
};

/**
 * The page's side, on a device: its requests, from the library the page uses, sent as the page sends them. Every
 * request is checked to carry no declaration and the page's address; the request as it travelled is noted.
 */
const thePage = (applications: Applications) => {
  const link: PageLink = pageLink(applications, 'the loan page');
  const ask = async (request: LoanRequestAlone, about: string, tick = false): Promise<{ transactionId: string; tokens: { category: string; capability: string; amount?: string }[] }> => {
    const asked = link.requests.request(detailsOf(request), template().texts);
    const result = (await link.approve(asked, {
      tick,
      seen: (preview) =>
        note(
          `${about}: the wallet showed the page's request with its own figures: it gives ${sat(preview.figures.givesSatoshis)}, gets ${sat(preview.figures.getsSatoshis)}, ${sat(preview.figures.intoApplicationSatoshis)} go into the application, the fee is ${sat(preview.figures.feeSatoshis)}; Paryon's coins spent: ${preview.figures.applicationInputs.map(({ name }) => `"${name}"`).join(', ')}; to the wallet: ${preview.figures.toWallet.map(({ kind }) => kind).join(', ')}${preview.figures.tokensNet.length === 0 ? '' : `; tokens ${preview.figures.tokensNet.map(({ amount: change }) => (change > 0n ? `+${change}` : String(change))).join(', ')}`}${preview.figures.tokensDestroyed.length === 0 ? '' : `; destroyed: ${preview.figures.tokensDestroyed.map(({ name, how, wallet }) => `"${name}" (${how}, ${wallet ? 'the wallet\'s' : 'the application\'s'})`).join(', ')}`}${preview.tokensLeaving === undefined ? '' : `; it asks for the user's tick: ${preview.tokensLeaving.map(({ how, made, to }) => `a token ${made === true ? 'made from the wallet\'s coin ' : ''}${how} to "${to ?? ''}"`).join(', ')}`}; it ${preview.recordsPosition === true ? 'records a position' : 'records nothing'}; the template is shown with ${'declaration' in preview.template ? 'a declaration' : 'no declaration'}.`,
        ),
    })) as { transactionId: string; tokens: { category: string; capability: string; amount?: string }[] };
    const travelled = link.sent.filter((message) => message.action === 'xo_action_request');
    if (travelled.some((message) => 'declaration' in message.template || (message.definition !== undefined && 'declaration' in message.definition))) throw new Error('the page sent a declaration');
    const last = travelled.at(-1);
    if (last?.page !== PAGE) throw new Error('the page\'s request did not carry its address');
    note(`${about}: the page's request, as it travelled: ${JSON.stringify({ templateAction: last.templateAction, variables: last.variables, ...(last.bindings === undefined ? {} : { bindings: last.bindings }), ...(last.about === undefined ? {} : { about: last.about }), ...(last.creates === undefined ? {} : { creates: last.creates }), inputs: last.inputs, page: last.page })}.`);
    // The next action takes what this one left the wallet: the wallet itself waits for the engine to list it, a
    // moment after the transaction is sent. The run does not wait here.
    return result;
  };
  return { link, ask };
};
/**
 * An action on the loan, asked again at once, three times at most, while the wallet says that another transaction spent
 * one of the coins the request named first (on chipnet, Paryon's keeper paying the loan's interest, or another user taking
 * the same coin of a shared contract): nothing was sent, and the request is made anew from the coins read now, as the page
 * does (`apps/loan/src/xo.ts`).
 */
const askOnLoan = async (ask: ReturnType<typeof thePage>['ask'], build: () => Promise<LoanRequestAlone>, about: string): Promise<{ transactionId: string; tokens: { category: string; capability: string; amount?: string }[] }> => {
  for (let attempt = 1; ; attempt += 1) {
    const request = await build();
    try {
      return await ask(request, about);
    } catch (error) {
      if (!spentFirst(error) || attempt >= 3) throw error;
      note(`${about}: the wallet said that another transaction had spent one of the coins the request named first; nothing was sent, and the page asked again with the coins as they were then.`);
      await wait(local ? 500 : 5_000);
    }
  }
};
/** What the page reads before an action on the loan: the key as the wallet reports it, the loan from the key, Paryon's coins. */
/**
 * What the coin that holds the loan key holds, as the wallet reports it to the page. Right after an action that sends
 * the key back, the wallet reports it once it lists the new coin: the page waits for that, as long as the run waits for a
 * server.
 */
const reportedKeySatoshis = async (link: PageLink, keyCategory: string): Promise<bigint> => {
  const reported = await until('the wallet to report the loan key to the page', async () => {
    const { trusted, positions } = await link.requests.recordedPositions(template().names.identifier);
    return trusted ? positions.find((position) => position.category === keyCategory) : undefined;
  });
  return BigInt(reported.satoshis);
};
const readLoanForPage = async (link: PageLink, keyCategory: string): Promise<FoundLoan & { coins: Parameters<typeof closeRequestAlone>[1] }> => {
  const found = await loanCoins(server, contracts(), hexToBin(keyCategory), await reportedKeySatoshis(link, keyCategory));
  if (found === undefined) throw new Error('the page finds no loan for the key');
  return { ...found, coins: { keyCategory, keySatoshis: found.keySatoshis, loan: found.loan, sidecar: found.sidecar, price: found.price, manageFunction: found.manageFunction, page: PAGE } };
};
const medianTime = (height: number): Promise<number> => medianTimeAt(server, height);

// ------------------------------------------------------------------ the parts

try {
  say(phase);

  if (phase === 'the owner opens a loan') {
    if (!local) {
      // On chipnet: Paryon's deployment is alive, and the funding key holds what the loan takes at the stored prices
      // and the reserve left there. Nothing is paid before this check has passed.
      await once('the check before starting', async () => {
        const state = aliveOrStop(await readParyonState(server, contracts()));
        const interestFunctions = await interestAliveOrStop(server, contracts());
        const course = chipnetCourse(state);
        const coins = await until('the funder\'s coins', async () => { const found = await funderCoins(); return found.length > 0 ? found : undefined; });
        const balance = coins.reduce((sum, coin) => sum + coin.output.valueSatoshis, 0n);
        if (balance < course.needed) throw new Error(`STOP before starting: the funding address holds ${sat(balance)}; the loan takes ${sat(course.needed)} at the stored prices, with ${sat(LEAVE_AT_FUNDER)} left there. Nothing was paid.`);
        facts.funderAtStart = String(balance);
        keep();
        const tip = await server.tip();
        const move = threadToMove(state, contracts().deployment, earliestLockHeight(tip.height));
        note(`Before starting: Paryon's deployment \`${contracts().deployment.name}\` showed ${state.borrowing.length} Borrowing threads (periods ${[...new Set(state.borrowing.map((entry) => entry.period))].join(', ')}), ${state.price.length} price threads (${[...new Set(state.price.map((entry) => dollars(entry.state.price)))].join(', ')}), ${state.loanKeyFactory.length} loan key factories, ${state.manage.length} manage functions and ${interestFunctions} interest functions, at the tip ${tip.height} (the period of the highest height a lock time may name for the next block: ${move.current}). The funding address held ${sat(balance)}: enough for ${sat(course.collateral)} of collateral, ${PERCENT}% of the debt at the lowest stored price ${dollars(course.lowest)}, Paryon's fee ${sat(course.fee)} at ${dollars(course.used)}, and ${sat(LEAVE_AT_FUNDER)} left there. The template sent is the frozen one of version 2, \`${template().names.identifier}\`.`);
        return { data: { collateral: String(course.collateral), fee: String(course.fee), used: String(course.used), lowest: String(course.lowest) } };
      });
    }
    if (local) await once('Paryon\'s contracts are deployed on the local chain', async () => {
      // Four block rewards: two define the deployment's categories, two pay for the run.
      const hashes = (await mine(4, hex(funderLocking))) as string[];
      await mine(100, BURN);
      const coinbase = async (hash: string): Promise<Utxo> => {
        const read = (await rpc('getblock', hash, 2)) as { tx: { txid: string; vout: { value: number }[] }[] };
        const [tx] = read.tx;
        if (tx === undefined) throw new Error('no coinbase');
        return { transactionHash: hexToBin(tx.txid), index: 0, output: { lockingBytecode: funderLocking, valueSatoshis: BigInt(Math.round((tx.vout[0]?.value ?? 0) * 1e8)) } };
      };
      const [paryonCoin, factoryCoin] = await Promise.all(hashes.slice(0, 2).map(coinbase));
      const deployed = localDeployment({ funder, paryonCoin: paryonCoin as Utxo, factoryCoin: factoryCoin as Utxo, price: PRICE, period: 1 });
      for (const built of deployed.transactions) await rpc('sendrawtransaction', hex(built.encoded));
      await block();
      facts.deployment = deployed.deployment;
      keep();
      await until('the deployment at the server', async () => {
        const state = await readParyonState(server, contracts());
        return state.borrowing.length > 0 && state.price.length > 0 && state.loanKeyFactory.length > 0 && state.manage.length > 0 && (await readInterestFunctions(server, contracts())).length > 0;
      });
      note(`Paryon's contracts as published (\`@paryonusd/contracts\` 1.1.0) were deployed on the local chain by this script, with categories of its own: PUSD \`${deployed.deployment.tokenIds.paryon}\`, factories \`${deployed.deployment.tokenIds.loanKeyFactory}\`; two Borrowing threads in period 1, two price threads at ${dollars(PRICE)}, two manage NFTs, two interest function NFTs and two key factories. Paryon's fee goes to the address that paid for the run.`);
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
    await once('the wallet is funded', async () => ({ transactionIds: [await funderPays('the wallet is funded', [{ lockingBytecode: funding, valueSatoshis: WALLET_CREATION }])] }));
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
    const createdAt = wallet.stored.creation.createTransactionId;
    if (createdAt !== undefined) {
      const bytes = ((await until('the transaction', async () => server.getTransaction(createdAt))) as string).length / 2;
      record('create', { transactionId: createdAt, bytes, feeSatoshis: BigInt(bytes) }, 'the controller and the rest');
    }
    const created = await once('the wallet holds its first coin', async () => {
      const first = await until('the wallet\'s first coin', async () => { const now = await wallet.balance(); return now.recoverable === BigInt(paidRecoverer['recoverable'] as string) ? now : undefined; });
      return { data: { recoverable: String(first.recoverable) } };
    });
    // What the loan takes: the collateral, Paryon's fee, the collateral added later, and a margin for the keys' coins and
    // the fees. On chipnet the collateral and the fee are those the check before starting reckoned from the stored prices.
    const checked = facts.steps['the check before starting']?.data ?? {};
    const lowestPrice = local ? PRICE : BigInt(checked['lowest'] as string);
    const collateral = local ? collateralAtRatio(DEBT, PRICE, PERCENT) : BigInt(checked['collateral'] as string);
    const fee = local ? borrowingFee(DEBT, PRICE) : BigInt(checked['fee'] as string);
    const pay = collateral + fee + MANAGE_ADD + 50_000n;
    const arrived = BigInt(created['recoverable'] as string) + pay;
    const identity = hexToBin(facts.identity as string);
    const given = await once('an address is given out', async () => ({ data: { first: (await wallet.receiveAddress()).address.number } }));
    await once('someone pays the wallet', async () => {
      const transactionId = await funderPays('someone pays the wallet', [{ lockingBytecode: wallet.address(0, given['first'] as number).lockingBytecode, valueSatoshis: pay }]);
      record('pay the wallet', await sentAs(transactionId), `${sat(pay)} from the funder to an address the wallet gave out, as output 0`);
      return { transactionIds: [transactionId] };
    });
    await block();
    // A run continued after the key was made finds that coin spent already.
    if (facts.steps['a loan key is made'] === undefined) await until('the coin in the wallet', async () => (await wallet.balance()).recoverable === arrived);

    if (facts.ownerArrangement === undefined) {
      facts.ownerArrangement = { archive: newArchive(STORES), earlierArchives: [], earlierViewingKeyRecords: [] };
      keep();
    }
    const applications = new Applications(wallet.parts, { archive: applicationArchive({ arrangement: () => facts.ownerArrangement, storeAt, seed: ownerSeed, identity, chain }) });
    const { link, ask } = thePage(applications);
    facts.loan ??= { collateral: String(collateral) };
    keep();

    // 1. A loan key. The page names a factory of Paryon's it read from the chain. The key is made from the wallet's
    // coin and waits in Paryon's contract: the wallet asks for the user's tick, and the user gives it.
    const made = await once('a loan key is made', async () => {
      const state = await readParyonState(server, contracts());
      const [factory] = state.loanKeyFactory;
      if (factory === undefined) throw new Error('no factory');
      const outcome = await ask(createKeyRequestAlone(template().names, { factory, page: PAGE }), 'Making a loan key', true);
      record('make a loan key', await sentAs(outcome.transactionId), 'from the page\'s request, with the user\'s tick: the wallet\'s coin that is output 0 defines the key\'s category (input 0); Paryon\'s factory, named by the page; the key waits in Paryon\'s contract; output 0 is what the wallet keeps of its coin');
      return { transactionIds: [outcome.transactionId], data: { transactionId: outcome.transactionId } };
    });
    const madeId = made['transactionId'] as string;
    const madeTransaction = decodeTransactionBch(hexToBin((await until('the key\'s transaction', async () => server.getTransaction(madeId))) as string));
    if (typeof madeTransaction === 'string') throw new Error(madeTransaction);
    const keyCategory = hex(madeTransaction.inputs[0]?.outpointTransactionHash as Uint8Array);
    (facts.loan as { keyCategory?: string }).keyCategory = keyCategory;
    keep();
    note(`After the key was made the wallet holds ${applications.positionRecords.length} position record: the key is in Paryon's contract, not in the wallet, and the wallet follows nothing there.`, 'no record for the key yet');

    // 2. Bring the Borrowing thread up to date, so that the loan is charged no interest for the periods before.
    const move = async (thread: ParyonState['borrowing'][number], height: number, how: string): Promise<{ transactionIds: string[] }> => {
      const outcome = await ask(movePeriodRequestAlone(template().names, contracts(), { borrowing: thread, lockHeight: height, page: PAGE }), 'Bringing Paryon up to date');
      record('bring the Borrowing thread up to date', await sentAs(outcome.transactionId), `from the page's request: the thread named by the page, moved from period ${thread.period} to ${periodAt(contracts().deployment, height)} (lock time ${height}); its supply as the page read it${how}`);
      amount(`period ${thread.period} moved to ${periodAt(contracts().deployment, height)} (lock time ${height})${how}`, 'Borrowing thread');
      return { transactionIds: [outcome.transactionId] };
    };
    /**
     * On chipnet Paryon's keeper moves every thread on in the first block a new period allows. A thread behind the period
     * of the highest lock time the next block takes is taken at once; otherwise, where the next period begins within a few
     * blocks, the run waits for it and asks at once, before the keeper. Someone else spending the thread first is a refusal
     * of the wallet's, with nothing sent: another thread that is still behind is tried, three times at most. Without a
     * chance within the bound, the reason is returned and the run goes on.
     */
    const moveOnChipnet = async (moment: string): Promise<{ transactionIds: string[] } | string> => {
      const refusals: string[] = [];
      const attempt = async (lockFor: () => Promise<number>, how: string): Promise<{ transactionIds: string[] } | undefined> => {
        for (let tries = 1; tries <= 3; tries += 1) {
          const height = await lockFor();
          const current = periodAt(contracts().deployment, height);
          const behind = (await readParyonState(server, contracts())).borrowing.filter((thread) => thread.period < current);
          if (behind.length === 0) return undefined;
          // One at random: the keeper moves them all on, in an order of its own.
          const thread = behind[Math.floor(Math.random() * behind.length)] as ParyonState['borrowing'][number];
          try {
            return await move(thread, height, how);
          } catch (error) {
            if (!refusedByWallet(error)) throw error;
            refusals.push(String((error as Error).message).slice(0, 160));
            note(`Bringing Paryon up to date ${moment}: the wallet refused the request for the thread in period ${thread.period} with lock time ${height} ("${String((error as Error).message).slice(0, 160)}"); nothing was sent.`);
            if (!spentFirst(error)) return undefined;
          }
        }
        return undefined;
      };
      const lockNow = async (): Promise<number> => earliestLockHeight((await server.tip()).height);
      const first = await attempt(lockNow, `, ${moment}; the thread was behind the current period when the run got there`);
      if (first !== undefined) return first;
      const tip = (await server.tip()).height;
      const lock = earliestLockHeight(tip);
      const next = periodStart(contracts().deployment, periodAt(contracts().deployment, lock) + 1);
      const due = tipForLock(next);
      if (due - tip > PERIOD_WAIT_BLOCKS) return `${moment}, at tip ${tip}, no thread was behind the current period ${periodAt(contracts().deployment, lock)}, Paryon's keeper having moved them all on, and the next period began for a transaction in the block after tip ${due}, ${due - tip} blocks away, more than the ${PERIOD_WAIT_BLOCKS} the run waits for`;
      const reached = await until(`the tip ${due}, where period ${periodAt(contracts().deployment, next)} begins for the next block`, async () => ((await server.tip()).height >= due ? true : undefined), PERIOD_WAIT_MS, 1_000).catch(() => false);
      if (reached !== true) return `${moment}, the run waited ${PERIOD_WAIT_MS / 60_000} minutes for the tip ${due}, where the next period begins, and it did not come`;
      const taken = await attempt(async () => Math.max(next, await lockNow()), `, ${moment}; the run waited for the period to begin (tip ${due}) and asked at once, before Paryon's keeper`);
      if (taken !== undefined) return taken;
      return `${moment}, the run waited for the next period to begin (tip ${due}) and asked at once, but ${refusals.length === 0 ? 'Paryon\'s keeper had moved every thread on before the run read them' : `the wallet refused ${refusals.length} time${refusals.length === 1 ? '' : 's'} (${refusals.join('; ')})`}`;
    };
    await once('the Borrowing thread is brought up to date', async () => {
      await block();
      if (local) {
        // The lock time: the highest height the network takes as final now, one block kept in hand, as the loan page reckons it.
        const height = finalLockHeight('regtest', (await server.tip()).height);
        const state = await readParyonState(server, contracts());
        const { thread, current, needed } = threadToMove(state, contracts().deployment, height);
        if (thread === undefined) throw new Error('no Borrowing thread');
        if (!needed) {
          note(`The Borrowing thread was not brought up to date: the thread the page takes, the one with the largest supply of the deployment's ${state.borrowing.length}, was in period ${thread.period} already, that of the highest height a lock time may name (${height}, period ${current}). The template's action "Bring Paryon up to date" (\`movePeriod\`) was therefore not needed.`);
          amount(`in period ${thread.period} already (lock height ${height}); the loan's interest starts there`, 'Borrowing thread');
          return undefined;
        }
        return move(thread, height, '; the loan\'s interest starts there');
      }
      const moved = await moveOnChipnet('before borrowing');
      if (typeof moved !== 'string') return moved;
      // A second chance comes after the repayment, before the device is lost.
      return { data: { without: moved } };
    });
    await block();

    // 3. Borrow: the page names the thread, the price, the key waiting in Paryon's contract and its proof.
    const opened = await once(BORROWED, async () => {
      // The page reads Paryon's coins from its server: it waits until the server lists the thread it just brought up to date.
      const moved = facts.steps['the Borrowing thread is brought up to date']?.transactionIds[0];
      const state = await until('the Borrowing thread brought up to date, at the server', async () => {
        const read = await readParyonState(server, contracts());
        // On chipnet someone else may have taken the thread on meanwhile; a thread in a period as late serves as well.
        if (moved === undefined || read.borrowing.some((thread) => hex(thread.transactionHash) === moved)) return read;
        if (local) return undefined;
        const current = periodAt(contracts().deployment, finalLockHeight('chipnet', (await server.tip()).height));
        return read.borrowing.some((thread) => thread.period >= current) ? read : undefined;
      });
      // The thread in the latest period, the one just brought up to date; of those, the one that can lend the most. On
      // chipnet Paryon's keepers may spend the thread or the price first: the request is then made again from what is read then.
      let reading: ParyonState | undefined = state;
      let fees = 0n;
      let price: ParyonState['price'][number] | undefined;
      const outcome = await askOnLoan(ask, async () => {
        const now = reading ?? (await readParyonState(server, contracts()));
        reading = undefined;
        const [thread] = now.borrowing.slice().sort((a, b) => b.period - a.period || (b.supply > a.supply ? 1 : b.supply < a.supply ? -1 : 0));
        [price] = now.price.slice().sort((a, b) => (b.state.price > a.state.price ? 1 : -1));
        if (thread === undefined || price === undefined) throw new Error('no thread or price');
        // On chipnet the prices may have moved since the check before starting: the collateral the wallet was paid for
        // must still be what the contracts take at the price named, and a safe share of the debt at the lowest price.
        fees = borrowingFee(DEBT, price.state.price);
        if (!local) {
          const lowest = pricesOf(now).lowest;
          if (collateral < minimumCollateral(DEBT, price.state.price) || collateral < collateralAtRatio(DEBT, lowest, FLOOR_PERCENT)) throw new Error(`STOP before borrowing: ${sat(collateral)} of collateral is ${collateralRatio(collateral, DEBT, lowest)}% of the debt at the lowest stored price ${dollars(lowest)} now, below ${FLOOR_PERCENT}%. Nothing was borrowed; the loan key waits in Paryon's contract.`);
          if (fees > fee + 40_000n) throw new Error(`STOP before borrowing: Paryon's fee is ${sat(fees)} at ${dollars(price.state.price)} now, more than the wallet was paid for. Nothing was borrowed.`);
        }
        const at = (index: number): Utxo => ({ transactionHash: hexToBin(madeId), index, output: madeTransaction.outputs[index] as Output });
        return borrowRequestAlone(template().names, { borrowing: thread, price, enforcer: at(2), proof: at(3), debt: DEBT, collateral, startingInterest: 0, page: PAGE });
      }, 'Borrowing');
      if (price === undefined) throw new Error('no price');
      record('borrow', await sentAs(outcome.transactionId), `from the page's request: ${pusd(DEBT)} PUSD against ${sat(collateral)} of collateral, Paryon's fee ${sat(fees)}, starting interest 0; the page named the Borrowing thread, the price, the key waiting in Paryon's contract and its proof, and gave the values it read from them; the key and the PUSD to fresh addresses of the wallet; the record of the key on both stores before the engine signed`);
      amount(`${pusd(DEBT)} PUSD`, 'Debt');
      amount(
        local
          ? `${sat(collateral)}: ${PERCENT}% of the debt at the stored price ${dollars(PRICE)}; Paryon's fee ${sat(fee)}, paid to the address that paid for the run`
          : `${sat(collateral)}: ${PERCENT}% of the debt at the lowest stored price ${dollars(lowestPrice)} when the run started, ${collateralRatio(collateral, DEBT, price.state.price)}% at the price named, ${dollars(price.state.price)}, at which the contracts take it (their least there: ${sat(minimumCollateral(DEBT, price.state.price))}); Paryon's fee ${sat(fees)}, kept by Paryon`,
        'Collateral',
      );
      return { transactionIds: [outcome.transactionId], data: { fee: String(fees) } };
    });
    void opened;
    await block();
    const [written] = applications.positionRecords;
    note(`The earlier device holds ${applications.positionRecords.length} position record, written when the key reached the wallet: the key ${written?.token?.category.slice(0, 12)}… (${written?.token?.capability}, commitment "${written?.token?.commitment}"), the template, ${written?.lockingScriptIdentifier === undefined ? 'no script (the loan is at Paryon\'s shared contracts)' : `the script ${written.lockingScriptIdentifier}`}, the values ${Object.keys(written?.values ?? {}).join(', ')}, and the page's address ${written?.applicationPage}.`, 'the record written');
    note(`${noDeclaration(applications, 'The earlier device')}.`, 'no declaration on the earlier device');
    const reported = await link.requests.recordedPositions(template().names.identifier);
    note(`The wallet answered the page's positions request (version 2): ${JSON.stringify(reported)}. Whether the loan is open the page finds out itself.`, 'the answer before');
    const found = await until('the page to find the loan', async () => findLoan(server, contracts(), hexToBin(keyCategory)));
    note(`The page found the loan from the key, through its sidecar: the loan at ${hex(found.loan.transactionHash).slice(0, 16)}…:${found.loan.index} with ${sat(found.loan.output.valueSatoshis)}, debt ${pusd(found.state.borrowed)} PUSD; the sidecar at …:${found.sidecar.index}.`, 'the page finds the loan');

    // 4. Add collateral: the page names the loan, its sidecar, the price and a manage function, and the key's coin value.
    await once('collateral is added', async () => {
      const outcome = await askOnLoan(ask, async () => {
        const { coins } = await readLoanForPage(link, keyCategory);
        return manageRequestAlone(template().names, { ...coins, collateral: coins.loan.output.valueSatoshis + MANAGE_ADD });
      }, 'Adding collateral');
      record('add collateral', await sentAs(outcome.transactionId), `from the page's request: ${sat(MANAGE_ADD)} more collateral; the page named the price, the loan, its sidecar and a manage function, and gave the key's coin value as the wallet reported it; the key back to the address it was spent from (\`return\`)`);
      return { transactionIds: [outcome.transactionId] };
    });
    await block();
    // On chipnet anyone may pay a loan's interest once a period has passed, which takes 1,500 satoshis from the loan
    // as that payment's fee: the loan then holds a little less than what was added.
    const added = await until('the loan with the collateral added', async () => {
      const now = await findLoan(server, contracts(), hexToBin(keyCategory));
      if (now === undefined) return undefined;
      const holds = now.loan.output.valueSatoshis;
      return holds === collateral + MANAGE_ADD || (!local && holds > collateral + MANAGE_ADD - 20_000n && holds < collateral + MANAGE_ADD) ? now : undefined;
    });

    // 5. Change the interest rate for the periods to come: the page names the loan, its sidecar and a coin of Paryon's
    // interest function; the key goes back where it was. A run continued after the change was sent finds it on the loan.
    await once('the interest rate is changed', async () => {
      const before = await findLoan(server, contracts(), hexToBin(keyCategory));
      if (before !== undefined && before.state.nextInterestRate === NEW_RATE) {
        record('change the interest rate', await sentAs(hex(before.loan.transactionHash)), `found on the chain when the run was continued: the loan's rate for the periods to come is ${NEW_RATE} per 10,000,000 per period`);
        return { transactionIds: [hex(before.loan.transactionHash)] };
      }
      const outcome = await askOnLoan(ask, async () => {
        const found = await interestCoins(server, contracts(), hexToBin(keyCategory), await reportedKeySatoshis(link, keyCategory));
        if (found === undefined) throw new Error('the page finds no loan for the key');
        return changeInterestRequestAlone(template().names, { keyCategory, keySatoshis: found.keySatoshis, loan: found.loan, sidecar: found.sidecar, interestFunction: found.interestFunction, rate: NEW_RATE, page: PAGE });
      }, 'Changing the interest rate');
      record('change the interest rate', await sentAs(outcome.transactionId), `from the page's request: the loan's rate for the periods to come set from ${added.state.nextInterestRate} to ${NEW_RATE} per 10,000,000 per period; the page named the loan, its sidecar and a coin of Paryon's interest function, and gave the loan's new record and the key's coin value as the wallet reported it; no price; the key back to the address it was spent from (\`return\`)`);
      amount(`${added.state.currentInterestRate} per 10,000,000 per period when the loan was opened, ${NEW_RATE} from its next interest payment on (${sat(interestPerPeriod(NEW_RATE, DEBT, lowestPrice))} a period on ${pusd(DEBT)} PUSD at ${dollars(lowestPrice)}, ${sat(interestPerPeriod(NEW_RATE, DEBT - REPAY, lowestPrice))} on ${pusd(DEBT - REPAY)})`, 'Interest rate');
      return { transactionIds: [outcome.transactionId] };
    });
    await block();
    await until('the loan with its new rate', async () => ((await findLoan(server, contracts(), hexToBin(keyCategory)))?.state.nextInterestRate === NEW_RATE ? true : undefined));

    // 6. Repay part of the debt; the loan stays open. A run continued after the repayment was sent finds it on the loan.
    await once('part of the loan is repaid', async () => {
      const before = await findLoan(server, contracts(), hexToBin(keyCategory));
      if (before !== undefined && before.state.borrowed === DEBT - REPAY) {
        record('repay part of the loan', await sentAs(hex(before.loan.transactionHash)), `found on the chain when the run was continued: the loan owes ${pusd(DEBT - REPAY)} PUSD`);
        return { transactionIds: [hex(before.loan.transactionHash)] };
      }
      const outcome = await askOnLoan(ask, async () => {
        const { coins } = await readLoanForPage(link, keyCategory);
        return repayRequestAlone(template().names, { ...coins, repay: REPAY, collateral: coins.loan.output.valueSatoshis });
      }, 'Repaying part of the loan');
      record('repay part of the loan', await sentAs(outcome.transactionId), `from the page's request: ${pusd(REPAY)} PUSD repaid and destroyed, ${pusd(DEBT - REPAY)} PUSD still owed; the page named the price, the loan, its sidecar and a manage function, and gave the loan's new record and the key's coin value as the wallet reported it; the PUSD left over and the key back to the wallet`);
      amount(`${pusd(REPAY)} PUSD repaid before the device was lost, leaving ${pusd(DEBT - REPAY)} PUSD owed`, 'Repayment');
      return { transactionIds: [outcome.transactionId] };
    });
    await block();
    // On chipnet, where no thread was behind before the borrowing, a second chance to bring one up to date, bounded as the first.
    if (!local && facts.steps['the Borrowing thread is brought up to date']?.data?.['without'] !== undefined) {
      await once('a Borrowing thread is brought up to date after the repayment', async () => {
        const moved = await moveOnChipnet('after the repayment');
        if (typeof moved !== 'string') return moved;
        const before = String(facts.steps['the Borrowing thread is brought up to date']?.data?.['without']);
        note(`The template's action "Bring Paryon up to date" (\`movePeriod\`) was not carried out on chipnet, for want of a chance within the bounds the run sets: ${before}; and ${moved}. The loan was opened from a thread Paryon's keeper had brought up to date.`, 'no movePeriod on chipnet');
        amount('brought up to date by Paryon\'s keeper; the run did not move one on itself (see the notes)', 'Borrowing thread');
        return undefined;
      });
      await block();
    }
    const after = await until('the loan with part of it repaid', async () => {
      const now = await findLoan(server, contracts(), hexToBin(keyCategory));
      return now !== undefined && now.state.borrowed === DEBT - REPAY ? now : undefined;
    });
    facts.loan = { keyCategory, collateral: String(after.loan.output.valueSatoshis) };
    keep();
    const balance = await until('the wallet after the repayment', async () => {
      const now = await wallet.balance();
      const pusdHeld = now.tokens.filter((coin) => hex(coin.utxo.output.token?.category ?? new Uint8Array()) === hex(contracts().paryonCategory)).reduce((sum, coin) => sum + (coin.utxo.output.token?.amount ?? 0n), 0n);
      return now.tokens.length === 2 && pusdHeld === DEBT - REPAY ? now : undefined;
    });
    facts.held = String(balance.recoverable + balance.tokens.reduce((sum, coin) => sum + coin.utxo.output.valueSatoshis, 0n));
    keep();
    note(`The old device holds the loan key and ${pusd(DEBT - REPAY)} PUSD at its addresses, and ${sat(balance.recoverable)} without tokens; the loan holds ${sat(after.loan.output.valueSatoshis)} and owes ${pusd(after.state.borrowed)} PUSD, at the rate ${after.state.currentInterestRate} now and ${after.state.nextInterestRate} from its next interest payment on. Then the device is lost, with the loan open.`, 'what the old device holds');
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
      record('complete', completed, `after the waiting period${local ? '' : ` (${Math.round((Date.now() - startedWaiting) / 60_000)} minutes)`}; no coin has moved, the loan is still open under the key the earlier seed holds`);
      if (local) await rpc('setmocktime', 0);
      await block();
    }
  }

  if (phase === 'the new device closes the loan from the page') {
    const identity = hexToBin(facts.identity as string);
    account = await openAccount(facts.words.next, 'the new device');
    const save = (state: OwnerWalletState): void => { facts.newState = state; keep(); };
    const wallet = facts.newState === undefined
      ? await OwnerWallet.takeOver({ backend: account, chain, seed: newSeed, identity, earlierViewingKeys: [ownerSeed.viewingKey], save })
      : await OwnerWallet.open({ backend: account, chain, seed: newSeed, state: facts.newState, save });
    if ((await wallet.checkOwnership()) === 'closed') {
      say('  (the wallet is closed: done before)');
    } else {
      const keyCategory = facts.loan?.keyCategory as string;
      const full = await wallet.search();
      note(`The new device's search over both seeds ended as "${full.status}".`, 'the search');
      if (facts.steps['the new device sweeps'] === undefined) {
        await until('the earlier coins in the engine', async () => (await wallet.balance()).toSweep === BigInt(facts.held as string));
        const sent = await wallet.sweepEarlier();
        for (const transaction of sent.transactions) record('sweep', transaction, `${sent.coins} coins of the earlier seed, the loan key and the PUSD among them, to addresses of the new seed, in a transaction of its own (the sweep needs the controller at input 0; Paryon's actions need their price contract there)`);
        facts.steps['the new device sweeps'] = { transactionIds: sent.transactions.map((transaction) => transaction.transactionId) };
        keep();
      }
      await block();
      await until('the swept key and PUSD at addresses of the new seed', async () => { const now = await wallet.balance(); return now.toSweep === 0n && now.tokens.length === 2; });

      // The new device's own archive, with the earlier one's records copied into it (section 10.6).
      if (facts.newArrangement === undefined || (facts.newArrangement.copiedArchives ?? []).length === 0) {
        const copied = await copyEarlierArchives({ arrangement: facts.newArrangement ?? { archive: newArchive(STORES), earlierArchives: [(facts.ownerArrangement as RecoveryArrangement).archive], earlierViewingKeyRecords: [] }, storeAt, whetherSent: actionSent(wallet.parts) });
        facts.newArrangement = copied.arrangement;
        keep();
        if (copied.unfinished.length > 0) throw new Error(`the earlier archive was not copied in full: ${copied.unfinished.join(' ')}`);
        note(`The new device copied ${copied.copied} records of the earlier archive into its own.`, 'the copy');
      }
      const applications = new Applications(wallet.parts, { archive: applicationArchive({ arrangement: () => facts.newArrangement, storeAt, seed: newSeed, identity, chain }) });
      await once('the new device reads the record from a store', async () => {
        await applications.readBackup();
        const [suggestedRecord] = applications.suggestedRecords;
        if (suggestedRecord === undefined) throw new Error('the backup held no position record');
        facts.record = suggestedRecord;
        keep();
        const [suggested] = applications.suggestions;
        if (suggested === undefined || suggested.identifier !== template().names.identifier) throw new Error('the backup did not hold Paryon\'s template');
        if ('declaration' in suggested || 'declaration' in suggested.texts) throw new Error('the backup held a declaration');
        note(`The new device read the record of the key from a store, the earlier seed's, a suggestion; the backup held Paryon's template as the earlier owner stored it, with no declaration.`);
        await applications.trust(suggested, undefined);
        note(`The user trusted the template "${suggested.name}" the earlier owner stored, on the user's word.`);
        const check = await checkPositionRecord(suggestedRecord, wallet.parts, readTemplate(template().texts.template));
        note(`The check of section 10.4 found that the record ${check.counts ? 'counts' : 'does not count'}: ${check.reason}`);
        const confirmation = await applications.confirmRecords();
        note(`The record was written again as the new owner's own on the stores (${confirmation.confirmed} record); it names no script, so nothing was handed to the engine (${confirmation.followed} scripts).`);
        return undefined;
      });
      const [position] = await applications.recordedPositions();
      if (position === undefined) throw new Error('the key is not listed');
      note(`The new device lists the key from the record: "${position.status}", ${position.standing === 'own' ? 'a record of its own' : 'a record of the earlier seed'}, under the template "${position.template.name}", the key at ${position.token.place === 'address' ? 'an address of the new seed' : position.token.place}; whether the loan is open is the page's to say.`, 'the key listed');
      // The wallet by itself: it offers nothing it can do alone, and sends the user to the page the record names.
      const offered = applications.offeredActions(position);
      const byItself = await applications.carryOut(applications.actionOn(position, 'close')).then(
        () => undefined,
        (error: unknown) => error,
      );
      if (!(byItself instanceof NeedsApplicationError)) throw new Error(`the wallet did not send the user to the page: ${String(byItself)}`);
      note(`From its own list the wallet offers ${offered.length} actions for the key and shows it with "Open the application to do this" and the page's address from the record (${position.page ?? 'none'}); asked to close the loan by itself it answers: "${byItself.message}" (the page: ${byItself.page}).`, 'the wallet sends the user to the page');

      // The page on the new phone: connected afresh, it is told of the key once the user allows it, finds the loan and closes it.
      await once('the page closes the loan', async () => {
        const { link, ask } = thePage(applications);
        const asked = await link.requests.recordedPositions(template().names.identifier);
        note(`The page on the new phone asked which keys of its template the wallet holds: ${asked.trusted ? 'answered' : 'not answered, since the template came from the backup and this page has not been allowed yet'}.`);
        applications.allow(template().names.identifier, 'the loan page');
        const { coins, state } = await readLoanForPage(link, keyCategory);
        note(`Once the user allowed the page, the wallet answered ${JSON.stringify((await link.requests.recordedPositions(template().names.identifier)).positions)}; the page found the loan from the key: ${sat(coins.loan.output.valueSatoshis)}, debt ${pusd(state.borrowed)} PUSD.`);
        let closing = coins;
        const outcome = await askOnLoan(ask, async () => {
          closing = (await readLoanForPage(link, keyCategory)).coins;
          return closeRequestAlone(template().names, closing);
        }, 'Closing the loan on the new phone');
        record('close the loan', await sentAs(outcome.transactionId), 'from the page\'s request on the new phone: the page named the price, the loan, its sidecar and a manage function, and gave the loan\'s record, the debt and the key\'s coin value as the wallet reported it; the whole debt repaid, the PUSD and the loan\'s record sent to data outputs, the sidecar not carried on; the collateral and the key to fresh addresses of the new seed');
        const record_ = decodeLoanState(closing.loan.output.token?.nft?.commitment as Uint8Array);
        amount(`the loan held ${sat(closing.loan.output.valueSatoshis)} and a debt of ${pusd(record_.borrowed)} PUSD; the collateral came back to addresses of the new seed, and the PUSD repaid were destroyed`, 'Closing');
        return { transactionIds: [outcome.transactionId] };
      });
      await block();
      await until('the loan closed', async () => ((await findLoan(server, contracts(), hexToBin(keyCategory))) === undefined ? true : undefined));
      // The wallet's list, right after the closing: it waits itself for the engine to list what the closing gave it.
      const heldAfter = await applications.tokens();
      note(`After closing, the page finds no loan for the key; the key is still in the wallet (${heldAfter.some((token) => token.category === keyCategory)}); the wallet holds ${heldAfter.some((token) => token.amount > 0n) ? 'PUSD' : 'no PUSD'}. ${noDeclaration(applications, 'The new device')}.`, 'the loan closed');

      await once('the key is sent on', async () => {
        const holding = await until('the key', async () => { const now = await wallet.balance(); return now.tokens.length === 1 && now.toSweep === 0n ? now.tokens[0] : undefined; });
        const sent = await wallet.sendToken(holding, funderLocking);
        record('send the key on', sent, 'the loan key, unchanged, to the address that paid for the run');
        return { transactionIds: [sent.transactionId] };
      });
      await block();
      await until('the wallet without a token', async () => (await wallet.balance()).tokens.length === 0);
      await wait(1_500);
      const closing = await wallet.close(funderLocking);
      for (const sent of closing.transactions) record('close the wallet', sent, 'everything, and the controller\'s value, back to the address that paid for the run');
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
      // The loan key alone: on chipnet the funding key may hold tokens of other runs, which are left as they are.
      const nfts = await until('the key at the funder', async () => { const found = (await server.listUnspent(funderLocking, 'only')).filter((entry) => entry.token?.category === facts.loan?.keyCategory); return found.length > 0 ? found : undefined; });
      const extra: Utxo[] = nfts.map((entry) => ({
        transactionHash: hexToBin(entry.transactionId),
        index: entry.index,
        output: {
          lockingBytecode: funderLocking,
          valueSatoshis: entry.valueSatoshis,
          token: { amount: entry.token?.amount ?? 0n, category: hexToBin(entry.token?.category ?? ''), ...(entry.token?.nft === undefined ? {} : { nft: { capability: entry.token.nft.capability, commitment: hexToBin(entry.token.nft.commitment) } }) },
        },
      }));
      const transactionId = await funderPays('the key is destroyed', [], { burn: true, extraInputs: extra });
      record('destroy the key', await sentAs(transactionId), 'the funder spends the loan key without carrying it on, and keeps its satoshis');
      return { transactionIds: [transactionId] };
    });
    await block();
    const identity = hexToBin(facts.identity as string);
    const total = await until('the funder\'s coins', async () => { const coins = await funderCoins(); return coins.length > 0 ? coins.reduce((sum, coin) => sum + coin.output.valueSatoshis, 0n) : undefined; });
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
    if ((await findLoan(server, contracts(), hexToBin(facts.loan?.keyCategory as string))) !== undefined) left.push('the loan');
    const spent = BigInt(facts.funderAtStart as string) - total;
    if (local) {
      amount(`${sat(BigInt(facts.funderAtStart as string))} before the run (after deploying Paryon's contracts), ${sat(total)} after it`, 'Funder');
      note(`The funding address held ${facts.funderAtStart} satoshis before the run and holds ${total} after it: the run cost ${spent} satoshis in network fees (Paryon's fee went to the same address and came back). ${left.length === 0 ? 'Nothing is left anywhere else: no PUSD (all of it was destroyed at the closing), no loan key (destroyed by the funder), no coin at the wallet\'s or the recoverer\'s addresses, and no loan. Paryon\'s deployment stays on the local chain.' : `LEFT BEHIND: ${left.join('; ')}.`}`);
    } else {
      const borrowFee = BigInt(facts.steps[BORROWED]?.data?.['fee'] ?? 0);
      const networkFees = facts.log.reduce((sum, entry) => sum + BigInt(entry.fee), 0n);
      amount(`${sat(BigInt(facts.funderAtStart as string))} before the run, ${sat(total)} after it`, 'Funder');
      amount(`${sat(spent)}: Paryon's borrowing fee ${sat(borrowFee)}, network fees ${sat(networkFees)} for the ${facts.log.length} transactions above, and ${sat(spent - borrowFee - networkFees)} otherwise (the fees of the payments of the funder and of the recoverer's balance, which are not among the transactions above, and 1,500 sat and the interest for each interest payment someone else made on the loan while it was open: the interest was 0 until the first payment after the rate was changed to ${NEW_RATE} per 10,000,000 per period; anything another run paid from the same key meanwhile would be here too)`, 'Cost of the run');
      note(`The funding address held ${facts.funderAtStart} satoshis before the run and holds ${total} after it. ${left.length === 0 ? 'Nothing is left anywhere else: no PUSD (all of it was destroyed at the closing), no loan key (destroyed by the funder), no coin at the wallet\'s or the recoverer\'s addresses, and no loan.' : `LEFT BEHIND: ${left.join('; ')}.`}`);
    }
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
