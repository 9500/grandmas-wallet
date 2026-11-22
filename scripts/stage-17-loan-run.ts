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
// On the local node the run carries the course out with version 3 of the template by default (`--page` for the course
// above, with version 2): the page only offers the template, which names Paryon's service, and the wallet carries out
// every action from its own lists, with the page closed. The service app (apps/paryon-service) is started by the run
// for the local deployment, as a process of its own on 127.0.0.1, as it runs in production, and stopped at the end of
// each part. Each action is an invitation the wallet starts and the service joins with one commit of its own. After
// the device is lost, the new device trusts the template again from the backup and does not speak to the service until
// the user presses Connect; the loan's actions then appear under the swept key, and the new device closes the loan from
// its own list. Every request to the service is counted, by the wallet as it sends it and at the service as it
// answers it, in the three moments the wallet may speak to it (the user trusting the template, Connect, acting), and
// the run checks that none came at any other time.
//
// One script, two chains: the local node (regtest) and chipnet, as in run B (scripts/run-b.ts). On the local node the
// run deploys Paryon's contracts itself, makes its blocks and moves the chain's clock. On chipnet it uses Paryon's own
// public deployment `chipnet-fast-periods-6`, unchanged; it is paid from the saved funding key, leaves a reserve there,
// reckons the collateral from the price stored in Paryon's price contract, never makes a block, waits for one only
// where a confirmation is needed, and lets the waiting period pass on the chain's own clock. The loan key is destroyed
// at the end, and everything else goes back to the funding key; Paryon's borrowing fee stays with Paryon.
//
// On chipnet the course with the service is the default too: the frozen template, version 3
// (packages/paryon/frozen/paryon-loan-v3-chipnet-fast-periods-6.json), offered unchanged, and the public service it
// names in its resources (https://paryon.9500.cash/service/v1), which the run does not start: it is Paryon's service
// as it runs for everyone. The wallet's requests to it are counted by moment as on the local node; the service's own
// log cannot be read there, so the run checks the wallet's side only: every request inside one of the three moments,
// none outside them. "Bring Paryon up to date" is carried out when the service says it can be; when it says it cannot,
// or the thread is taken by Paryon's keeper or another user first (nothing sent), the run goes on without it and says
// so in the record.
//
// With `--page` on chipnet the page drives every action with the frozen template, version 2
// (packages/paryon/frozen/paryon-loan-v2-chipnet-fast-periods-6.json), as the page sends it (no oracle and nothing of
// Paryon's but its contracts on the chain is consulted). There Paryon's keeper moves the Borrowing threads on as soon as
// a period begins: the run moves one on itself only where a thread is behind, or where a period begins within a few
// minutes and it takes a thread before the keeper does; otherwise it goes on without that action and says so in the
// record.
//
// Each part is a process of its own with an empty engine state, as a device session would be. What the run knows
// between parts is in .local-runs/stage-17-loan-local.json (on chipnet .chipnet/stage-17-loan-chipnet.json; with
// `--page` the names end in `-page`); the stores are directories beside it. Every step is written to that file once it is carried out. A run that stops is
// continued with the same command; `--new` starts again (on chipnet only once the earlier run has finished, and its
// file is kept under another name).
//
// usage (from packages/app):
//   npx tsx ../../scripts/stage-17-loan-run.ts [local]       with the local node running (deploy/regtest/regtest.sh):
//                                                            the wallet with Paryon's service, version 3
//   npx tsx ../../scripts/stage-17-loan-run.ts local --page  the page drives every action, version 2
//   npx tsx ../../scripts/stage-17-loan-run.ts chipnet       paid from the key in .chipnet/funder-design-2.json:
//                                                            the wallet with Paryon's public service, version 3
//   npx tsx ../../scripts/stage-17-loan-run.ts chipnet --page the page drives every action, version 2
//   ... --fee-rate <n>                                       every transaction pays at least n sat/byte (1 unless
//                                                            given); kept in the run's file for a continued run
//   npx tsx ../../scripts/stage-17-loan-run.ts chipnet --dry reads Paryon's deployment and the funding key, asks the
//                                                            public service who it is, and says what a run would need;
//                                                            sends no transaction (with `--page`: the page's course)
// The log is written to docs/runs/stage-17-loan-local-node.md (with `--page` docs/runs/stage-17-loan-local-node-page.md;
// on chipnet docs/runs/stage-17-loan-chipnet.md, with the invitations in docs/runs/invitations/stage-17-loan-chipnet/;
// with `--page` on chipnet docs/runs/stage-17-loan-chipnet-page.md and docs/runs/invitations/stage-17-loan-chipnet-page/).
import 'fake-indexeddb/auto';
import { type ChildProcess, execFileSync, spawn, spawnSync } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { type Output, binToHex, decodeTransactionBch, generateBip39Mnemonic, hexToBin } from '@bitauth/libauth';
import { type ArchiveStore, type PositionRecordEntry, blobIdOf } from '@grandmas-wallet/archive';
import { type ChainReader, type KeyPair, type Utxo, buildTransaction, checkBeforeSending, deriveCredentialKeys, deriveSeedKeys, invitationFromText, keyPairFromPrivateKey, p2pkhInput, p2pkhLockingBytecode, readControllerHistory, readTemplate } from '@grandmas-wallet/core';
import { Engine, XO_SUPPORTED_NETWORKS } from '@xo-cash/engine';

import { Electrum } from '../packages/chipnet/src/electrum.js';
import { invitationDirectory, invitationFiles, writeInvitationFiles } from './invitation-files.js';
import { chipnetFunder, coinsFor, electrumEndpoint, engineServers, medianTime as medianTimeAt, runArguments, startOver } from './stage-17-chain.js';
import { type ServiceFetch, buildServiceHello, buildServicePossibleRequest, serviceExchange } from '../packages/connect/src/index.js';
import {
  type ActionOutcome,
  type ActionPreview,
  type ApplicationAction,
  type OwnerWalletState,
  type TokenAction,
  ActionRefusedError,
  InputsSpentError,
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
  creationFunding,
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
  borrowRequestAloneV2,
  borrowingFee,
  closeRequestAloneV2,
  collateralAtRatio,
  collateralRatio,
  createKeyRequestAloneV2,
  decodeLoanState,
  findLoan,
  loanCoins,
  localDeployment,
  manageRequestAloneV2,
  changeInterestRequestAloneV2,
  interestCoins,
  interestPerPeriod,
  minimumCollateral,
  movePeriodRequestAloneV2,
  paryonAddressesAt,
  paryonChipnetTemplateTextV2,
  paryonChipnetTemplateTextV3,
  paryonContracts,
  paryonTemplateAlone,
  periodAt,
  periodStart,
  readInterestFunctions,
  readParyonState,
  repayRequestAloneV2,
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
/**
 * Whether the wallet carries the actions out with Paryon's service, the page closed (version 3): the course on both
 * chains unless `--page` asks for the page-driven one (version 2). On the local node the run starts the service itself;
 * on chipnet it is Paryon's public one, which the template names.
 */
const withService = !process.argv.includes('--page');
const PHASES = ['the owner opens a loan', 'the recoverer recovers', withService ? 'the new device closes the loan from its own list' : 'the new device closes the loan from the page', 'the recoverer returns its balance', 'the run returns what is left'];
const { chainName, local, phase, dry, fresh, feeRate: givenFeeRate } = runArguments(PHASES, 'stage-17-loan-run.ts');
/**
 * The satoshis per byte every transaction of the run pays at least (`--fee-rate <n>`, 1 unless given). It is kept in
 * the run's file, so that a continued run pays the same without being told again; a different one given then stops it.
 * Set by the driver once it knows the run's file, and by each part once it has read it.
 */
let FEE_RATE = givenFeeRate ?? 1;
const feeRateOf = (kept: number | undefined): number => {
  if (kept !== undefined && givenFeeRate !== undefined && kept !== givenFeeRate) {
    console.error(`The run under way pays ${kept} sat/byte, kept in its file; --fee-rate ${givenFeeRate} differs. Continue it with --fee-rate ${kept} or without the option.`);
    process.exit(2);
  }
  return kept ?? givenFeeRate ?? 1;
};
/** An amount reckoned at 1 sat/byte, at the run's rate. */
const atRate = (satoshis: bigint): bigint => BigInt(Math.ceil(Number(satoshis) * FEE_RATE));
/** What a part is started with besides the chain and its name. */
const MODE_ARGUMENTS = (): string[] => [...(withService ? [] : ['--page']), '--fee-rate', String(FEE_RATE)];
const runDirectory = local ? `${root}.local-runs` : `${root}.chipnet`;
mkdirSync(runDirectory, { recursive: true });
const stateFile = `${runDirectory}/stage-17-loan-${local ? (withService ? 'local' : 'local-page') : withService ? 'chipnet' : 'chipnet-page'}.json`;
const storeDirectory = `${runDirectory}/stage-17-loan-${local ? (withService ? '' : 'page-') : withService ? 'chipnet-' : 'chipnet-page-'}stores`;
/** On chipnet, the name of the run's invitations in docs/runs/invitations/, kept in git beside the record. */
const CHIPNET_RUN = withService ? 'stage-17-loan-chipnet' : 'stage-17-loan-chipnet-page';
/** The XO invitation behind every transaction an account of the run sends, a file each (scripts/invitation-files.ts). */
const invitations = local ? `${runDirectory}/invitations/stage-17-loan${withService ? '' : '-page'}/` : invitationDirectory(CHIPNET_RUN, false);
const logFile = `${root}docs/runs/stage-17-loan-${local ? (withService ? 'local-node' : 'local-node-page') : withService ? 'chipnet' : 'chipnet-page'}.md`;
/**
 * Paryon's service on the local node: where the run starts it, and the address of the loan page the template made for
 * the local deployment names, beside which the service is (`paryonAddressesAt`): no page is served there in this run.
 * Its configuration, its log (one line per message it answers, as it writes them) and its process number are files of
 * the run.
 */
const SERVICE_PORT = 18_610;
const SERVICE_LOAN_URL = `http://127.0.0.1:${SERVICE_PORT}/`;
const serviceFiles = { config: `${runDirectory}/stage-17-loan-service.json`, log: `${runDirectory}/stage-17-loan-service.log`, pid: `${runDirectory}/stage-17-loan-service.pid` };
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
/** What the wallet is given to create it at the run's rate: the amount above, or what the creation takes there with a margin if more. */
const walletCreation = (): bigint => {
  const least = creationFunding({ feeRate: FEE_RATE }) + atRate(20_000n);
  return least > WALLET_CREATION ? least : WALLET_CREATION;
};
const LEAVE_AT_FUNDER = 1_000_000n;
/** On chipnet: the least share of the debt the collateral may be worth at the lowest stored price when borrowing. */
const FLOOR_PERCENT = 112n;
/** Paryon's deployment on chipnet and the identifier of its frozen template, version 2, which the run sends unchanged. */
const CHIPNET_TEMPLATE_IDENTIFIER = '3fa4baf9f313ee2a5046ae30fdf1f7affc6aca21a29e3f6b38227b4a826e9235';
/** The identifier of the frozen template, version 3, which the run offers unchanged on chipnet with the service. */
const CHIPNET_TEMPLATE_IDENTIFIER_V3 = '160a451f5398db649de7d660855db24113b774559534361f8334cbfe9a583e20';
/** Paryon's public service on chipnet, as the frozen template version 3 names it in its resources; not started by the run. */
const CHIPNET_SERVICE_URL = 'https://paryon.9500.cash/service/v1';
/** On chipnet: how long the run waits for the service or the wallet's side of something (chain waits are longer). */
const SERVICE_PATIENCE_MS = local ? 60_000 : 20_000;

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
  /** The satoshis per byte every transaction of the run pays at least. */
  feeRate?: number;
  held?: string;
  funderAtStart?: string;
  log: Entry[];
  notes: string[];
  /** With the service: each exchange of a moment in which the wallet may speak to it, as the wallet sent it and as the service answered it. */
  serviceMoments?: ServiceMoment[];
  /** With the service: each action, who took part in it and what came from whom. */
  serviceActions?: ServiceActionEntry[];
  /** With the service: the requests the service had answered when the device was lost. */
  serviceAtLoss?: number;
  /** With the service: requests the service answered in a part that stopped before it could count them. */
  serviceUnaccounted?: number;
}
/** The moments in which the wallet may speak to an application's service (docs/xo-service.md). */
type MomentKind = 'trust' | 'Connect' | 'acting';
interface ServiceMoment {
  moment: string;
  kind: MomentKind;
  part: string;
  /** The requests the wallet sent, by the protocol's action. */
  sent: Record<string, number>;
  /** The requests the service answered meanwhile, by its own log: on the local node only, where the run starts it. */
  atService?: number;
}
interface ServiceActionEntry {
  step: string;
  transactionId: string;
  participants: string;
  asked: string;
  fromService: string;
  requests: string;
}

const pusd = (cents: bigint): string => `${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`;
const dollars = (cents: bigint): string => `$${pusd(cents)}`;
const sat = (value: bigint): string => `${value.toLocaleString('en-US')} sat`;
/**
 * The template the page sends, with the names its requests give it: on chipnet the frozen text of Paryon's
 * deployment, unchanged, checked against its known identifier; on the local chain made for the run's own deployment.
 */
const templateOf = (deployment: ParyonDeployment): { names: { identifier: string; contentHash: string }; texts: { template: string } } => {
  if (local) return withService ? paryonTemplateAlone(paryonContracts(deployment), paryonAddressesAt(SERVICE_LOAN_URL)) : paryonTemplateAlone(paryonContracts(deployment), 2);
  if (deployment.name !== CHIPNET_FAST_PERIODS_6.name) throw new Error(`on chipnet the run uses Paryon's deployment ${CHIPNET_FAST_PERIODS_6.name}, not ${deployment.name}`);
  const [text, expected] = withService ? [paryonChipnetTemplateTextV3, CHIPNET_TEMPLATE_IDENTIFIER_V3] : [paryonChipnetTemplateTextV2, CHIPNET_TEMPLATE_IDENTIFIER];
  const read = readTemplate(text);
  if (read.identifier !== expected) throw new Error(`the frozen template's identifier is ${read.identifier}, not ${expected}`);
  if (withService) {
    const named = ((JSON.parse(text) as { resources?: { name?: string; url?: string }[] }).resources ?? []).find((resource) => resource.name === 'xo_service_v1');
    if (named?.url !== CHIPNET_SERVICE_URL) throw new Error(`the frozen template names the service ${named?.url ?? 'none'}, not ${CHIPNET_SERVICE_URL}`);
  }
  return { names: { identifier: read.identifier, contentHash: read.contentHash }, texts: { template: text } };
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
  const pay = collateral + fee + MANAGE_ADD + atRate(50_000n);
  return { collateral, fee, pay, needed: pay + walletCreation() + atRate(20_000n) + LEAVE_AT_FUNDER, used, lowest };
};
/** The Borrowing thread the run would bring up to date, the one with the largest supply, and whether it needs it. */
const threadToMove = (state: ParyonState, deployment: ParyonDeployment, height: number): { thread: ParyonState['borrowing'][number] | undefined; current: number; needed: boolean } => {
  const [thread] = state.borrowing.slice().sort((a, b) => (b.supply > a.supply ? 1 : -1));
  const current = periodAt(deployment, height);
  return { thread, current, needed: thread !== undefined && thread.period < current };
};

/** The record's account of the service: each action with who took part and what came from whom, and every request to the service by moment. */
const serviceTables = (known: Facts): string[] => {
  const moments = known.serviceMoments ?? [];
  const kinds: MomentKind[] = ['trust', 'Connect', 'acting'];
  const total = (entries: ServiceMoment[], action: string): number => entries.reduce((sum, entry) => sum + (entry.sent[action] ?? 0), 0);
  const answered = moments.reduce((sum, entry) => sum + (entry.atService ?? 0), 0);
  const kindName = (kind: MomentKind): string => (kind === 'trust' ? 'the user trusts the template' : kind === 'Connect' ? 'the user presses Connect' : 'the user acts');
  if (!local) {
    // On chipnet the service is Paryon's public one: its log is not the run's to read, and only the wallet's side is counted.
    const sentAll = moments.reduce((sum, entry) => sum + total([entry], 'hello') + total([entry], 'possible') + total([entry], 'join'), 0);
    return [
      'Each action, carried out by the wallet from its own list with the page closed:',
      '',
      '| Step | Who took part | What the wallet asked the user for | What came from the service | Requests to the service |',
      '| --- | --- | --- | --- | --- |',
      ...(known.serviceActions ?? []).map((entry) => `| ${entry.step} | ${entry.participants} | ${entry.asked} | ${entry.fromService} | ${entry.requests} |`),
      '',
      `Every request the wallet sent the service, in the moment it sent it, as the wallet counted it. The service is Paryon's public one at ${CHIPNET_SERVICE_URL}, which the run did not start; its own log is not available on chipnet, so what it answered is not counted here:`,
      '',
      '| Moment | Kind | Part | hello | possible | join |',
      '| --- | --- | --- | --- | --- | --- |',
      ...moments.map((entry) => `| ${entry.moment} | ${entry.kind} | ${entry.part} | ${entry.sent['hello'] ?? 0} | ${entry.sent['possible'] ?? 0} | ${entry.sent['join'] ?? 0} |`),
      '',
      'By moment:',
      '',
      '| Moment | hello | possible | join | All |',
      '| --- | --- | --- | --- | --- |',
      ...kinds.map((kind) => {
        const of = moments.filter((entry) => entry.kind === kind);
        return `| ${kindName(kind)} | ${total(of, 'hello')} | ${total(of, 'possible')} | ${total(of, 'join')} | ${total(of, 'hello') + total(of, 'possible') + total(of, 'join')} |`;
      }),
      '| at any other time | 0 | 0 | 0 | 0 |',
      '',
      `The wallet sent the service ${sentAll} requests in all, each of them in one of the three moments; before and after each moment, and at the end of every part, the run checked that the wallet had sent nothing outside them. The new device, which trusted the template again from the backup, had sent none when the user pressed Connect.`,
      '',
    ];
  }
  return [
    'Each action, carried out by the wallet from its own list with the page closed:',
    '',
    '| Step | Who took part | What the wallet asked the user for | What came from the service | Requests to the service |',
    '| --- | --- | --- | --- | --- |',
    ...(known.serviceActions ?? []).map((entry) => `| ${entry.step} | ${entry.participants} | ${entry.asked} | ${entry.fromService} | ${entry.requests} |`),
    '',
    'Every request the wallet sent the service, in the moment it sent it, and what the service answered meanwhile by its own log (one line per message, with no address, token or value):',
    '',
    '| Moment | Kind | Part | hello | possible | join | Answered at the service |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...moments.map((entry) => `| ${entry.moment} | ${entry.kind} | ${entry.part} | ${entry.sent['hello'] ?? 0} | ${entry.sent['possible'] ?? 0} | ${entry.sent['join'] ?? 0} | ${entry.atService ?? 0} |`),
    '',
    'By moment:',
    '',
    '| Moment | hello | possible | join | All | Answered at the service |',
    '| --- | --- | --- | --- | --- | --- |',
    ...kinds.map((kind) => {
      const of = moments.filter((entry) => entry.kind === kind);
      return `| ${kindName(kind)} | ${total(of, 'hello')} | ${total(of, 'possible')} | ${total(of, 'join')} | ${total(of, 'hello') + total(of, 'possible') + total(of, 'join')} | ${of.reduce((sum, entry) => sum + (entry.atService ?? 0), 0)} |`;
    }),
    `| at any other time | 0 | 0 | 0 | 0 | ${(known.serviceUnaccounted ?? 0) === 0 ? 0 : `${known.serviceUnaccounted} in parts that stopped`} |`,
    '',
    `The service answered ${answered} requests in all, each of them in one of the three moments; before and after each moment, and at the end of every part, the run checked that the wallet had sent nothing outside them and that the service had answered nothing else. When the earlier device was lost the service had answered ${known.serviceAtLoss ?? '?'}; the new device, which trusted the template again from the backup, had sent none and the service, running from the start of that part, had answered none more when the user pressed Connect.`,
    '',
  ];
};

// ------------------------------------------------------------------ the driver: one process for each part

if (phase === undefined && dry) {
  // A look at chipnet before a run: Paryon's deployment as it stands, the stored prices, what the loan would take from
  // the funding key, and whether the Borrowing thread would be brought up to date. Nothing is written or sent.
  FEE_RATE = feeRateOf(existsSync(stateFile) ? (JSON.parse(readFileSync(stateFile, 'utf8')) as Facts).feeRate : undefined);
  if (FEE_RATE !== 1) console.log(`Every transaction of the run would pay at least ${FEE_RATE} sat/byte.`);
  const server = await Electrum.connect(electrumEndpoint(false));
  try {
    const contracts = paryonContracts(CHIPNET_FAST_PERIODS_6);
    const template = templateOf(CHIPNET_FAST_PERIODS_6);
    const made = withService ? paryonTemplateAlone(contracts, 3, paryonAddressesAt(new URL('../', CHIPNET_SERVICE_URL).href)) : paryonTemplateAlone(contracts, 2);
    console.log(`The course: ${withService ? 'the wallet with Paryon\'s public service, the page closed (version 3)' : 'the page drives every action (version 2)'}.`);
    console.log(`The frozen template "${readTemplate(template.texts.template).definition.name ?? ''}", version ${withService ? 3 : 2}, ${template.names.identifier}, content ${template.names.contentHash}; the template made from the deployment's parameters today ${made.names.identifier === template.names.identifier && made.names.contentHash === template.names.contentHash ? 'is the same' : `DIFFERS (${made.names.identifier}, ${made.names.contentHash}); the run sends the frozen one`}.`);
    if (withService) {
      // Read-only: who the service is, and what it says is possible for a wallet that holds nothing of the template yet.
      const hello = await serviceExchange(CHIPNET_SERVICE_URL, buildServiceHello({ network: 'chipnet', id: `dry-${Date.now()}`, template: template.names, role: 'borrower' }), { timeoutMs: 20_000 });
      if (!hello.carried) console.log(`Paryon's service at ${CHIPNET_SERVICE_URL}, as the template names it (not started by the run): xo_service_hello got NO usable answer (${hello.failure}: ${hello.reason}). The run would stop at the first moment it speaks to it.`);
      else if (!hello.answer.ok) console.log(`Paryon's service at ${CHIPNET_SERVICE_URL}, as the template names it (not started by the run): xo_service_hello was DECLINED: ${hello.answer.error}.`);
      else {
        const serves = hello.answer.serves.find((entry) => entry.template.identifier === template.names.identifier && entry.template.contentHash === template.names.contentHash);
        console.log(`Paryon's service at ${CHIPNET_SERVICE_URL}, as the template names it (not started by the run): xo_service_hello answered; it serves ${hello.answer.serves.length} template${hello.answer.serves.length === 1 ? '' : 's'}, ${serves === undefined ? 'NOT the frozen one' : `the frozen one as the role "${serves.role}"`}.`);
        const possible = await serviceExchange(CHIPNET_SERVICE_URL, buildServicePossibleRequest({ network: 'chipnet', id: `dry-${Date.now()}`, template: template.names, role: 'borrower', tokens: [], made: [] }), { timeoutMs: 20_000 });
        if (possible.carried && possible.answer.ok) console.log(`xo_service_possible_request for a wallet that holds nothing yet: at height ${possible.answer.height} the service says ${possible.answer.start.map((entry) => `${entry.action} ${entry.available ? 'possible now' : `not now (${entry.reason ?? ''})`}`).join(', ')}.`);
        else console.log(`xo_service_possible_request got no usable answer: ${possible.carried ? (possible.answer.ok ? '' : possible.answer.error) : possible.reason}`);
      }
    }
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
    console.log(withService
      ? `${behind.length === 0 ? 'No Borrowing thread is' : `${behind.length} of the Borrowing threads are`} behind the current period ${current}. The wallet carries out "Bring Paryon up to date" ("movePeriod") if the service says it can be, the service choosing the thread and the lock time; if it says it cannot, or Paryon's keeper or another user takes the thread first (nothing sent), the run goes on without it and says so in the record.`
      : behind.length > 0
        ? `${behind.length} of the Borrowing threads are behind the current period ${current}: the run would bring one up to date ("movePeriod"), if Paryon's keeper does not first.`
        : `No Borrowing thread is behind the current period ${current}: Paryon's keeper moved them on. The next period begins for a transaction in the block after tip ${nextTip}, ${nextTip - tip.height} blocks from now; the run waits for it only if it is at most ${PERIOD_WAIT_BLOCKS} blocks away when it gets there, and then tries to move a thread on before the keeper does, for at most ${PERIOD_WAIT_MS / 60_000} minutes. Otherwise it goes on without "movePeriod" and says so in the record.`,
    );
    console.log(`The steps: make a key, bring a Borrowing thread up to date where it can, borrow ${pusd(DEBT)} PUSD, add ${sat(MANAGE_ADD)} of collateral, change the interest rate to ${NEW_RATE} per 10,000,000 per period, repay ${pusd(REPAY)} PUSD${withService ? ', each from the wallet\'s own list, the user typing the debt, the collateral and the starting rate 0 for the borrowing, and each joined by the service' : ''}; the device is lost and recovered; the new device ${withService ? 'trusts the template again from the backup, the user presses Connect, and it closes the loan from its own list' : 'closes the loan from the page'}, repaying the remaining ${pusd(DEBT - REPAY)} PUSD.`);
    console.log(`The loan: ${pusd(DEBT)} PUSD against ${sat(course.collateral)} of collateral, ${PERCENT}% at the lowest stored price ${dollars(course.lowest)} (${collateralRatio(course.collateral, DEBT, course.used)}% at the highest, ${dollars(course.used)}, at which the contracts take it; their least there is ${sat(minimumCollateral(DEBT, course.used))}); Paryon's borrowing fee ${sat(course.fee)}, kept by Paryon; ${sat(MANAGE_ADD)} added later.`);
    const funderLocking = p2pkhLockingBytecode(chipnetFunder().keyHash);
    const coins = await server.listUnspent(funderLocking, 'exclude');
    const tokens = await server.listUnspent(funderLocking, 'only');
    const balance = coins.reduce((sum, coin) => sum + coin.valueSatoshis, 0n);
    console.log(`The funding key holds ${sat(balance)} in ${coins.length} coins without tokens, and ${tokens.length} coins with tokens (left alone by the run). The run pays the wallet ${sat(walletCreation())} to create it and ${sat(course.pay)} for the loan, and leaves ${sat(LEAVE_AT_FUNDER)} at the key: it needs ${sat(course.needed)}. ${balance >= course.needed ? 'The key holds enough.' : 'The key holds TOO LITTLE.'}`);
    console.log(`What the run would cost: Paryon's borrowing fee ${sat(course.fee)}, network fees of about ${sat(atRate(20_000n))}${FEE_RATE === 1 ? '' : ` at ${FEE_RATE} sat/byte`}, and 1,500 sat for each interest payment someone else makes on the loan while it is open (a period is about 30 minutes on chipnet). The interest is 0 until the first payment after the rate is changed; from then on ${sat(interestPerPeriod(NEW_RATE, DEBT - REPAY, course.used))} a period at ${NEW_RATE} per 10,000,000 (on ${pusd(DEBT - REPAY)} PUSD after the repayment; ${sat(interestPerPeriod(NEW_RATE, DEBT, course.used))} on ${pusd(DEBT)}).`);
    console.log(existsSync(stateFile) ? `A run is under way: ${stateFile.slice(root.length)} (finished: ${(JSON.parse(readFileSync(stateFile, 'utf8')) as Facts).finished.join(', ') || 'nothing yet'}). The same command without --dry continues it.` : `No run is under way; ${stateFile.slice(root.length)} does not exist.`);
  } finally {
    await server.disconnect().catch(() => undefined);
  }
  process.exit(0);
}

if (phase === undefined) {
  if (fresh) startOver(local, stateFile, storeDirectory, PHASES);
  FEE_RATE = feeRateOf(existsSync(stateFile) ? (JSON.parse(readFileSync(stateFile, 'utf8')) as Facts).feeRate : undefined);
  if (!existsSync(stateFile)) {
    rmSync(invitations, { recursive: true, force: true });
    if (withService && local) rmSync(serviceFiles.log, { force: true });
  }
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
    let result = spawnSync('npx', ['tsx', fileURLToPath(import.meta.url), chainName, next, ...MODE_ARGUMENTS()], { stdio: 'inherit' });
    for (let again = 0; again < 3 && result.status !== 0 && result.status !== STOPPED; again += 1) {
      console.log(`"${next}" ended unexpectedly; continuing it`);
      result = spawnSync('npx', ['tsx', fileURLToPath(import.meta.url), chainName, next, ...MODE_ARGUMENTS()], { stdio: 'inherit' });
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
    return local ? `${found.action} (${found.templateName})` : `[${found.action}](invitations/${CHIPNET_RUN}/${found.file})`;
  };
  const sent = templateOf(facts.deployment as ParyonDeployment);
  const serviceIntro =
    'Written by the run itself (`scripts/stage-17-loan-run.ts`). The owner\'s wallet, the recoverer and the new device, each on the unmodified XO engine, against the local node in regtest mode with the public networks\' relay rules, on which the run deployed Paryon\'s contracts as published (`packages/paryon/src/local-deployment.ts`). Each part ran in a process of its own with an empty engine state. The template is version 3 of the ParyonUSD loan template, made for the local deployment; it names Paryon\'s service (`xo_service_v1`), which takes part in every action as the role `service`. Paryon\'s service app (`apps/paryon-service`) ran as a process of its own on 127.0.0.1, started by the run from its command line with a configuration of the local chain, as it runs in production, for the two parts that needed it, and stopped at the end of each. The loan page\'s only part was to offer the template to the wallet over `xo_v1` (`xo_template_offer`, sent with the page\'s `DappRequests` to the wallet\'s connector for applications over a session in memory, every message through JSON and back as it travels); it asked for no action. From then on the wallet (`Applications`, with the service option) carried out every action from its own lists: the starting actions under the template, the borrowing under the key that waited in Paryon\'s contract, and the loan\'s actions under the key. Each action is an invitation the wallet started with its own share, which the service joined over HTTP with one commit, bringing Paryon\'s coins and the values read from them; the wallet checked what the service added, worked the whole transaction out by its own rules, evaluated every input of Paryon\'s in the virtual machine before the user was asked, and compared what the engine built with what it had worked out before it was sent. The backup stores are two directories of the run, read and written as a store server\'s are. No recovery declaration was sent, stored, kept or read anywhere in the run.';
  const chipnetServiceIntro = `Written by the run itself (\`scripts/stage-17-loan-run.ts chipnet\`). The owner's wallet, the recoverer and the new device, each on the unmodified XO engine, on chipnet, against Paryon's own public deployment \`${CHIPNET_FAST_PERIODS_6.name}\`, unchanged. The template is the frozen text of version 3 of the ParyonUSD loan template (\`packages/paryon/frozen/paryon-loan-v3-chipnet-fast-periods-6.json\`), offered unchanged and checked against its identifier; it names Paryon's service (\`xo_service_v1\`) at ${CHIPNET_SERVICE_URL}, which takes part in every action as the role \`service\`. That service is Paryon's public one, as it runs for everyone; the run did not start it, and its log is not the run's to read. The run was paid from the funding address and returned everything to it at the end but Paryon's borrowing fee; it made no block, and the waiting period passed on the chain's own clock. Each part ran in a process of its own with an empty engine state. The loan page's only part was to offer the template to the wallet over \`xo_v1\` (\`xo_template_offer\`, sent with the page's \`DappRequests\` to the wallet's connector for applications over a session in memory, every message through JSON and back as it travels); it asked for no action. From then on the wallet (\`Applications\`, with the service option for chipnet, which takes only an \`https:\` address) carried out every action from its own lists: the starting actions under the template, the borrowing under the key that waited in Paryon's contract, and the loan's actions under the key. Each action is an invitation the wallet started with its own share, which the service joined over HTTPS with one commit, bringing Paryon's coins and the values read from them; the wallet checked what the service added, worked the whole transaction out by its own rules, evaluated every input of Paryon's in the virtual machine before the user was asked, and compared what the engine built with what it had worked out before it was sent. Every request the wallet sent the service was counted by the wallet in the moment it was sent. The backup stores are two directories of the run, read and written as a store server's are. No recovery declaration was sent, stored, kept or read anywhere in the run.`;
  const revision = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const changed = execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).split('\n').filter((line) => line.trim() !== '' && !line.includes('docs/runs/') && !line.includes('.chipnet'));
  writeFileSync(
    logFile,
    [
      `# Stage 17 run on ${local ? 'the local node' : 'chipnet'}: a ParyonUSD loan without a declaration, through the loss of a device (PR20)${withService ? ', carried out by the wallet with Paryon\'s service, the page closed' : ''}`,
      '',
      withService ? (local ? serviceIntro : chipnetServiceIntro) : (local
        ? 'Written by the run itself (`scripts/stage-17-loan-run.ts`). The owner\'s wallet, the recoverer and the new device, each on the unmodified XO engine, against the local node in regtest mode with the public networks\' relay rules, on which the run deployed Paryon\'s contracts as published, as the run of stage 9 did (`packages/paryon/src/local-deployment.ts`).'
        : `Written by the run itself (\`scripts/stage-17-loan-run.ts chipnet\`). The owner's wallet, the recoverer and the new device, each on the unmodified XO engine, on chipnet, against Paryon's own public deployment \`${CHIPNET_FAST_PERIODS_6.name}\`, unchanged, with its frozen template, version 2 (\`packages/paryon/frozen/paryon-loan-v2-chipnet-fast-periods-6.json\`), as the page sent it; nothing of Paryon's but its contracts on the chain was consulted. The run was paid from the funding address and returned everything to it at the end but Paryon's borrowing fee; it made no block, and the waiting period passed on the chain's own clock.`) +
        ' Each part ran in a process of its own with an empty engine state. The Paryon template reached the wallet alone, as a text, in the requests of the loan page: the library the page uses (`packages/paryon`: `page-requests.ts`, `findLoan`, `loanCoins`, `readParyonState`) made each request from what it read on the chain, and the page\'s `DappRequests` sent it to the wallet\'s connector for applications over a session in memory, every message through JSON and back as it travels; only the relay and the page\'s screens were left out. Every transaction of the loan is an invitation of that template, built by the unmodified engine, which signed the wallet\'s own inputs, and compared with what the wallet\'s own code had worked out before it was sent; every input of Paryon\'s was evaluated in the virtual machine before the user was asked. The backup stores are two directories of the run, read and written as a store server\'s are. No recovery declaration was sent, stored, kept or read anywhere in the run.',
      '',
      `- Wallet identity: \`${facts.identity}\``,
      `- Loan key (token category): \`${facts.loan?.keyCategory}\``,
      `- Template "${readTemplate(sent.texts.template).definition.name ?? ''}" \`${sent.names.identifier}\`, content \`${sent.names.contentHash}\`, with no declaration`,
      `- Paryon's deployment ${local ? 'on the local chain' : `\`${facts.deployment?.name}\``}: PUSD \`${facts.deployment?.tokenIds.paryon}\`, factories \`${facts.deployment?.tokenIds.loanKeyFactory}\``,
      withService && !local
        ? `- Paryon's service as the template names it: ${CHIPNET_SERVICE_URL}, Paryon's public service, not started by the run; the loan page offered the template and asked for no action`
        : withService
        ? `- Paryon's service as the template names it: ${paryonAddressesAt(SERVICE_LOAN_URL).service}, started by the run for each part that needed it (\`apps/paryon-service\`, its command line, with the configuration \`${serviceFiles.config.slice(root.length)}\`); the loan page's address the template names, ${SERVICE_LOAN_URL}, serves no page in this run`
        : `- The page's address in its requests: ${PAGE}`,
      `- Repository at commit \`${revision}\`${changed.length === 0 ? '' : `, with uncommitted changes to ${changed.map((line) => line.slice(3)).join(', ')}`}`,
      `- Started ${facts.startedAt}`,
      ...((facts.feeRate ?? 1) === 1 ? [] : [`- Fee rate: every transaction of the run paid at least ${facts.feeRate} sat/byte (\`--fee-rate ${facts.feeRate}\`)`]),
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
      ...(withService ? serviceTables(facts) : []),
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
FEE_RATE = feeRateOf(facts.feeRate);
facts.feeRate = FEE_RATE;
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
  if (sent.feeSatoshis < atRate(BigInt(sent.bytes))) throw new Error(`a fee below ${FEE_RATE} sat/byte`);
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
const RECOVERER_COINS = atRate(5_000n);
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
    const chosen = coinsFor(local, coins, outputs.reduce((sum, output) => sum + output.valueSatoshis, 0n), FEE_RATE);
    const built = buildTransaction({ inputs: [...chosen, ...(options.extraInputs ?? [])].map((coin) => p2pkhInput(coin, funder)), outputs, changeLockingBytecode: funderLocking, allowTokenBurn: options.burn === true, feeRate: FEE_RATE });
    const check = checkBeforeSending(built, FEE_RATE);
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
const readLoanForPage = async (link: PageLink, keyCategory: string): Promise<FoundLoan & { coins: Parameters<typeof closeRequestAloneV2>[1] }> => {
  const found = await loanCoins(server, contracts(), hexToBin(keyCategory), await reportedKeySatoshis(link, keyCategory));
  if (found === undefined) throw new Error('the page finds no loan for the key');
  return { ...found, coins: { keyCategory, keySatoshis: found.keySatoshis, loan: found.loan, sidecar: found.sidecar, price: found.price, manageFunction: found.manageFunction, page: PAGE } };
};
const medianTime = (height: number): Promise<number> => medianTimeAt(server, height);

// ------------------------------------------------------------------ Paryon's service, on the local node

/** A line of the service's log for a message it answered: its kind, its network, what became of it and how long it took. */
const REQUEST_LINE = /^(hello|possible|join|unreadable) \S+ \S+ \d+ms$/;
/** The messages the service has answered, by kind, as its log says, over every part of the run. */
const atTheService = (): { total: number; byKind: Record<string, number> } => {
  const lines = existsSync(serviceFiles.log) ? readFileSync(serviceFiles.log, 'utf8').split('\n').filter((line) => REQUEST_LINE.test(line)) : [];
  const byKind: Record<string, number> = {};
  for (const line of lines) byKind[line.split(' ')[0] as string] = (byKind[line.split(' ')[0] as string] ?? 0) + 1;
  return { total: lines.length, byKind };
};
let serviceProcess: ChildProcess | undefined;
/** A service process of an earlier part that did not end, by the number it left: ended, so that its port is free. */
const endLeftoverService = async (): Promise<boolean> => {
  if (!existsSync(serviceFiles.pid)) return false;
  const pid = Number(readFileSync(serviceFiles.pid, 'utf8'));
  rmSync(serviceFiles.pid, { force: true });
  const alive = (): boolean => existsSync(`/proc/${pid}/cmdline`) && readFileSync(`/proc/${pid}/cmdline`, 'utf8').includes('paryon-service');
  if (!Number.isInteger(pid) || !alive()) return false;
  process.kill(pid, 'SIGTERM');
  await until('the service of an earlier part to end', async () => !alive(), 10_000, 200);
  return true;
};
/** Stop the service this part started, and wait for it to end. */
const stopService = async (): Promise<void> => {
  const child = serviceProcess;
  serviceProcess = undefined;
  if (child === undefined || child.exitCode !== null) return;
  const ended = new Promise((resolve) => child.once('exit', resolve));
  child.kill('SIGTERM');
  await Promise.race([ended, wait(5_000)]);
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  rmSync(serviceFiles.pid, { force: true });
};
process.on('exit', () => serviceProcess?.kill('SIGKILL'));
/**
 * Start Paryon's service app for the local deployment, from its command line, with a configuration of the local chain
 * as the pages' files have it: the deployment (`paryon`), the address of the loan page beside which the service is
 * (`loanUrl`) and the node's server. It must serve the very template the run's wallet trusts.
 */
const startService = async (): Promise<void> => {
  if (await endLeftoverService()) note('A service an earlier part had started and not stopped was ended before this part started its own.');
  writeFileSync(serviceFiles.config, `${JSON.stringify({ network: 'regtest', loanUrl: SERVICE_LOAN_URL, chain: [electrumEndpoint(true)], relays: [], stores: [], paryon: contracts().deployment }, null, 1)}\n`);
  const from = existsSync(serviceFiles.log) ? readFileSync(serviceFiles.log, 'utf8').length : 0;
  const out = openSync(serviceFiles.log, 'a');
  const child = spawn(process.execPath, ['--import', 'tsx', `${root}apps/paryon-service/src/cli.ts`, '--config', serviceFiles.config, '--host', '127.0.0.1', '--port', String(SERVICE_PORT)], { cwd: root, stdio: ['ignore', out, out] });
  closeSync(out);
  serviceProcess = child;
  writeFileSync(serviceFiles.pid, String(child.pid));
  const started = await until('Paryon\'s service to start', async () => {
    if (child.exitCode !== null) throw new Error(`Paryon's service ended at its start (${child.exitCode}): ${readFileSync(serviceFiles.log, 'utf8').slice(from).slice(-400)}`);
    const text = readFileSync(serviceFiles.log, 'utf8').slice(from);
    return /^Paryon's service at /m.test(text) && /^serves /m.test(text) ? text : undefined;
  }, 30_000, 200);
  const served = /^serves regtest: template ([0-9a-f]{64})/m.exec(started)?.[1];
  if (served !== template().names.identifier) throw new Error(`Paryon's service serves the template ${served ?? 'none'} on the local chain, not ${template().names.identifier}`);
  say(`  Paryon's service at http://127.0.0.1:${SERVICE_PORT}/service/v1 (process ${child.pid}), serving the template ${served.slice(0, 12)}…`);
};

/** The wallet's requests to the service, as it sends them, each under the moment it was sent in (none outside one). */
const sentToService: { moment: string | undefined; action: string }[] = [];
let momentNow: string | undefined;
const countingFetch: ServiceFetch = (url, init) => {
  let action = 'unreadable';
  try {
    action = String((JSON.parse(String(init.body)) as { xo_service_v1?: { action?: unknown } }).xo_service_v1?.action ?? 'unreadable');
  } catch {
    // Counted as it is.
  }
  sentToService.push({ moment: momentNow, action });
  return fetch(url, init);
};
const SHORT: Record<string, string> = { xo_service_hello: 'hello', xo_service_possible_request: 'possible', xo_service_join_request: 'join' };
/**
 * The service as the wallet is given it, with every request counted: on the local chain `local`, where an `http:`
 * address is allowed; on chipnet `public`, which takes only an `https:` address.
 */
const serviceOption = { service: local ? { network: 'regtest', kind: 'local' as const, fetch: countingFetch } : { network: 'chipnet', kind: 'public' as const, fetch: countingFetch } };
/** The requests the service answered that the run has counted, in the moments and in parts that stopped. */
const accounted = (): number => (facts.serviceMoments ?? []).reduce((sum, entry) => sum + (entry.atService ?? 0), 0) + (facts.serviceUnaccounted ?? 0);
/**
 * Outside the moments in which the wallet may speak to the service: the wallet sent nothing, and (on the local node,
 * where the run reads the service's log) the service answered nothing that the run has not counted in one of them.
 */
const noneOutside = (where: string): void => {
  const stray = sentToService.filter((entry) => entry.moment === undefined);
  if (stray.length > 0) throw new Error(`the wallet sent the service ${stray.map((entry) => SHORT[entry.action] ?? entry.action).join(', ')} ${where}, outside the moments in which it may speak to it`);
  if (!local) return;
  const at = atTheService().total;
  if (at !== accounted()) throw new Error(`the service answered ${at - accounted()} requests ${where} that came outside the moments in which the wallet may speak to it`);
};
/** A part that starts: requests a part that stopped could not count are counted as such, and said. */
const countLeftovers = (): void => {
  if (!local) return;
  const missing = atTheService().total - accounted();
  if (missing === 0) return;
  facts.serviceUnaccounted = (facts.serviceUnaccounted ?? 0) + missing;
  keep();
  note(`The service had answered ${missing} requests in a part that stopped before it could count them; they are counted apart.`);
};
/**
 * A moment in which the wallet may speak to the service: what the wallet sent in it, and what the service answered,
 * counted at both ends. The service writes its line once it has answered, so the count there is waited for, briefly.
 */
const inMoment = async <T>(moment: string, kind: MomentKind, work: () => Promise<T>): Promise<T> => {
  noneOutside(`before "${moment}"`);
  const from = sentToService.length;
  const atStart = local ? atTheService().total : 0;
  momentNow = moment;
  let outcome: { value: T } | { error: unknown };
  try {
    outcome = { value: await work() };
  } catch (error) {
    outcome = { error };
  }
  momentNow = undefined;
  const mine = sentToService.slice(from);
  // On chipnet the service's log is not the run's to read: the wallet's side alone is counted.
  const answered = local ? await until('the service\'s log of the requests', async () => (atTheService().total - atStart >= mine.length ? atTheService().total - atStart : undefined), 10_000, 100).catch(() => atTheService().total - atStart) : undefined;
  const sent: Record<string, number> = {};
  for (const { action } of mine) sent[SHORT[action] ?? action] = (sent[SHORT[action] ?? action] ?? 0) + 1;
  facts.serviceMoments = [...(facts.serviceMoments ?? []), { moment, kind, part: phase as string, sent, ...(answered === undefined ? {} : { atService: answered }) }];
  keep();
  say(`  requests to the service in "${moment}": ${Object.entries(sent).map(([action, count]) => `${action} ${count}`).join(', ') || 'none'}${answered === undefined ? '' : `; the service answered ${answered}`}`);
  if ('error' in outcome) throw outcome.error;
  if (answered !== undefined && answered !== mine.length) throw new Error(`in "${moment}" the wallet sent the service ${mine.length} requests and the service answered ${answered}`);
  return outcome.value;
};
/**
 * Who took part in a transaction's invitation, from the invitation the wallet saved when it sent it: each participant by
 * the key its commits are made under, with the role it took and how many commits it made.
 */
const participantsOf = (transactionId: string): { text: string } => {
  const entry = invitationFiles(invitations).find((file) => file.transactionId === transactionId);
  if (entry === undefined) throw new Error(`no invitation was saved for ${transactionId}`);
  const invitation = invitationFromText(readFileSync(`${invitations}${entry.file}`, 'utf8').trim());
  const participants = new Map<string, { roles: Set<string>; commits: number }>();
  for (const commit of invitation.commits) {
    const known = participants.get(commit.entityIdentifier) ?? { roles: new Set<string>(), commits: 0 };
    if (commit.data.roleIdentifier !== undefined) known.roles.add(commit.data.roleIdentifier);
    known.commits += 1;
    participants.set(commit.entityIdentifier, known);
  }
  const of = (role: string) => [...participants.values()].filter((participant) => participant.roles.has(role));
  const [borrower] = of('borrower');
  const [service] = of('service');
  if (participants.size !== 2 || of('borrower').length !== 1 || of('service').length !== 1 || borrower?.roles.size !== 1 || service?.roles.size !== 1 || service.commits !== 1) {
    throw new Error(`the invitation of ${transactionId} has the participants ${JSON.stringify([...participants.values()].map(({ roles, commits }) => ({ roles: [...roles], commits })))}, not the wallet and the service with exactly one commit`);
  }
  return { text: `two: the wallet as the borrower (${borrower.commits} commits) and Paryon's service as the service (1 commit)` };
};
const figuresOf = (preview: ActionPreview): string =>
  `it gives ${sat(preview.figures.givesSatoshis)}, gets ${sat(preview.figures.getsSatoshis)}, ${sat(preview.figures.intoApplicationSatoshis)} go into the application, the fee is ${sat(preview.figures.feeSatoshis)}; to the wallet: ${preview.figures.toWallet.map(({ kind }) => kind).join(', ') || 'nothing'}${preview.figures.tokensNet.length === 0 ? '' : `; tokens ${preview.figures.tokensNet.map(({ amount: change }) => (change > 0n ? `+${change}` : String(change))).join(', ')}`}`;
/**
 * An action the wallet carries out with the service, from its own list, the page closed: the review (worked out with
 * the service: what is possible, then the join), the user's approval with what they typed and, where the wallet asks for
 * it, their tick; then the transaction recorded, with who took part and what came from whom.
 */
const actWithService = async (applications: Applications, stepName: string, step: string, offer: TokenAction | undefined, request: ApplicationAction, typed: Record<string, string>, about: string, tick = false): Promise<ActionOutcome> => {
  if (offer === undefined) throw new Error(`the wallet does not offer "${step}" from its own list`);
  let review: ActionPreview | undefined;
  // On chipnet Paryon's keeper or another user may spend one of Paryon's coins between the service's join and the
  // sending: the network refuses, nothing is sent, and the wallet asks the service anew, three times at most.
  const attempt = (): Promise<ActionOutcome> => inMoment(step, 'acting', async () => {
    review = await applications.preview(request);
    let done: ActionOutcome;
    try {
      done = await applications.carryOut(request, undefined, tick ? { tokensLeave: true } : {});
    } catch (error) {
      await applications.discardPreview(request);
      throw error;
    }
    // Sent: a part that stops from here on does not carry the action out again when it is continued.
    facts.steps[stepName] ??= { transactionIds: [done.transactionId], data: { transactionId: done.transactionId } };
    keep();
    return done;
  });
  let outcome: ActionOutcome | undefined;
  for (let tries = 1; outcome === undefined; tries += 1) {
    try {
      outcome = await attempt();
    } catch (error) {
      if (local || !(error instanceof InputsSpentError) || tries >= 3) throw error;
      note(`${about}: the network said that another transaction had spent one of the coins first ("${String(error.message).slice(0, 160)}"); nothing was sent, and the wallet asked the service again.`);
      await wait(5_000);
    }
  }
  const shown = review as ActionPreview;
  const asks = (offer.asks ?? []).map(({ variable, name }) => `"${name}" (${variable}) ${typed[variable] ?? '?'}`);
  const asked = [
    `"${offer.name}"`,
    asks.length === 0 ? 'nothing to type' : `typed: ${asks.join(', ')}`,
    ...(shown.tokensLeaving === undefined ? [] : [`the tick for ${shown.tokensLeaving.map(({ how, made, to }) => `a token ${made === true ? 'made from the wallet\'s coin ' : ''}that ${how} to "${to ?? ''}"`).join(', ')}`]),
    'the approval',
  ].join('; ');
  const values = shown.service?.values ?? [];
  const coins = shown.figures.applicationInputs.map(({ name }) => `"${name}"`);
  const fromService = `${values.length === 0 ? 'no value' : values.map(({ name, value }) => `${name} ${value.length > 20 ? `${value.slice(0, 16)}…` : value}`).join(', ')}; Paryon's coins ${coins.join(', ') || 'none'}, with their unlocking, and the outputs that put them back`;
  const counted = facts.serviceMoments?.at(-1);
  const requests = Object.entries(counted?.sent ?? {}).map(([action, count]) => `${action} ${count}`).join(', ');
  const { text } = participantsOf(outcome.transactionId);
  facts.serviceActions = [...(facts.serviceActions ?? []).filter((entry) => entry.step !== step), { step, transactionId: outcome.transactionId, participants: text, asked, fromService, requests }];
  keep();
  note(`${about}: the wallet showed its own figures, worked out with the service's part: ${figuresOf(shown)}; from the service (${shown.service?.roleName ?? '?'} at ${shown.service?.url ?? '?'}): ${fromService}.`);
  return outcome;
};


/**
 * The owner's loan with Paryon's service (version 3), the page closed: the page only offers the template; the user
 * trusts it in the wallet; from then on the wallet carries out every action from its own lists. Returns the key's
 * category.
 */
const theOwnerWithTheService = async (applications: Applications, collateral: bigint, lowestPrice: bigint, paidFee: bigint): Promise<string> => {
  const id = template().names.identifier;
  // 0. The page, connected to the wallet as the pages are, offers its template without an action (`xo_template_offer`);
  // the user trusts it in the wallet, which then asks the service the template names who it is and what is possible.
  await once('the user trusts the template the page offered', async () => {
    const link = pageLink(applications, 'the loan page');
    await inMoment('the user trusts the template', 'trust', async () => {
      const trusted = await link.acceptOffer(link.requests.offerTemplate(template().names, template().texts, SERVICE_PATIENCE_MS, 5_000), (offer) =>
        note(`The page offered its template without an action; the wallet listed the offer of "${readTemplate(offer.definition.template).definition.name ?? ''}" ${offer.template.identifier.slice(0, 12)}… from "${offer.application}" for the user to trust, and the user trusted it.`),
      );
      if (!trusted) throw new Error('the wallet did not answer the offer as trusted');
      await until('the wallet to speak to the service', async () => (applications.serviceOf(id)?.state === 'never asked' ? undefined : true), SERVICE_PATIENCE_MS);
      await applications.serviceContact(id);
    });
    const status = applications.serviceOf(id);
    if (status?.state !== 'reached') throw new Error(`the service was not reached when the template was trusted: ${JSON.stringify(status)}`);
    const offered = link.sent.filter((message) => message.action === 'xo_action_request');
    if (offered.length > 0) throw new Error('the page asked for an action');
    note(`Once the user trusted the template, the wallet spoke to the service it names, "${status.description}" at ${status.url}: it is "${status.role?.name}" (${status.role?.role}) to the wallet's "${status.walletRole?.name}" (${status.walletRole?.role}). The page sent the offer and nothing else; it asked for no action in the whole run.`);
    return undefined;
  });
  const listed = await applications.templateActions(id);
  note(`From its own list, under the template, the wallet offers the starting actions ${(listed?.starting ?? []).map(({ name, service }) => `"${name}" (the service said: ${service?.available === undefined ? 'nothing' : service.available ? 'possible now' : `not now, ${service.reason ?? ''}`})`).join(' and ')}, and nothing that waits.`, 'the wallet\'s own list');

  // 1. A loan key, from the wallet's own list. The service brings Paryon's factory; the key, made from the wallet's coin,
  // waits in Paryon's contract: the wallet asks for the user's tick, and the user gives it.
  const made = await once('a loan key is made', async () => {
    const offer = (await applications.templateActions(id))?.starting.find(({ action }) => action === 'createKey');
    const outcome = await actWithService(applications, 'a loan key is made', 'make a loan key', offer, applications.startAction(id, 'createKey'), {}, 'Making a loan key', true);
    record('make a loan key', await sentAs(outcome.transactionId), 'from the wallet\'s own list, with the user\'s tick, joined by the service: the wallet\'s coin that is output 0 defines the key\'s category (input 0); Paryon\'s factory, brought by the service; the key waits in Paryon\'s contract; output 0 is what the wallet keeps of its coin');
    return { transactionIds: [outcome.transactionId], data: { transactionId: outcome.transactionId } };
  });
  const madeId = made['transactionId'] as string;
  const madeTransaction = decodeTransactionBch(hexToBin((await until('the key\'s transaction', async () => server.getTransaction(madeId))) as string));
  if (typeof madeTransaction === 'string') throw new Error(madeTransaction);
  const keyCategory = hex(madeTransaction.inputs[0]?.outpointTransactionHash as Uint8Array);
  (facts.loan as { keyCategory?: string }).keyCategory = keyCategory;
  keep();

  // 2. Bring a Borrowing thread up to date, from the starting actions: the service chooses the thread and the lock time.
  // On chipnet Paryon's keeper moves the threads on as a period begins: where the service says it cannot be done, or
  // the keeper or another user takes the thread first (the wallet or the network refuses, nothing sent), the run goes on
  // without it and says so. Anything else stops the part, and nothing is asked again that may have been sent.
  await once('the Borrowing thread is brought up to date', async () => {
    await block();
    const before = await readParyonState(server, contracts());
    const offer = (await applications.templateActions(id))?.starting.find(({ action }) => action === 'movePeriod');
    const without = (why: string): undefined => {
      note(`The template's action "Bring Paryon up to date" (\`movePeriod\`) was not carried out on chipnet: ${why}. The loan was opened from a thread Paryon's keeper had brought up to date.`, 'no movePeriod on chipnet');
      amount('brought up to date by Paryon\'s keeper; the run did not move one on itself (see the notes)', 'Borrowing thread');
      return undefined;
    };
    if (offer?.service?.available === false) {
      if (local) throw new Error(`the service says Paryon is up to date already: ${offer.service.reason ?? ''}`);
      return without(`the service said it could not be carried out now ("${offer.service.reason ?? ''}")`);
    }
    let outcome: ActionOutcome;
    try {
      outcome = await actWithService(applications, 'the Borrowing thread is brought up to date', 'bring the Borrowing thread up to date', offer, applications.startAction(id, 'movePeriod'), {}, 'Bringing Paryon up to date');
    } catch (error) {
      if (local || !(error instanceof ActionRefusedError || error instanceof InputsSpentError) || facts.steps['the Borrowing thread is brought up to date'] !== undefined) throw error;
      return without(`the wallet's attempt ended with "${String((error as Error).message).slice(0, 200)}", and nothing was sent`);
    }
    const moved = decodeTransactionBch(hexToBin((await until('the transaction', async () => server.getTransaction(outcome.transactionId))) as string));
    if (typeof moved === 'string') throw new Error(moved);
    const from = before.borrowing.find((thread) => hex(thread.transactionHash) === hex(moved.inputs[0]?.outpointTransactionHash as Uint8Array) && thread.index === moved.inputs[0]?.outpointIndex);
    const to = periodAt(contracts().deployment, moved.locktime);
    record('bring the Borrowing thread up to date', await sentAs(outcome.transactionId), `from the wallet's own list, joined by the service, which chose the thread and the lock time: the thread moved from period ${from?.period ?? '?'} to ${to} (lock time ${moved.locktime}); its supply put back as it was; the wallet paid the fee`);
    amount(`period ${from?.period ?? '?'} moved to ${to} (lock time ${moved.locktime}), chosen by the service; the loan's interest starts there`, 'Borrowing thread');
    return { transactionIds: [outcome.transactionId] };
  });
  await block();

  // 3. Borrow with the key that waits in Paryon's contract, offered under the template where it waits: the user types
  // the debt, the collateral and the starting rate; the service brings the thread, the price, the key and its proof.
  await once(BORROWED, async () => {
    const waiting = await until('the borrowing offered with the waiting key', async () => (await applications.templateActions(id))?.waiting.find(({ action, waiting: at }) => action === 'borrow' && at?.category === keyCategory));
    const typed = { debt: String(DEBT), collateral: String(collateral), startingRate: '0' };
    note(`After the key was made, the wallet offers "${waiting.name}" under the template, for the key that waits at "${waiting.waiting?.at}"; it asks for ${(waiting.asks ?? []).map(({ name }) => `"${name}"`).join(', ')}.`, 'the waiting key offered');
    if (!local) {
      // The prices may have moved since the check before starting: the collateral the wallet was paid for must still be
      // what the contracts take at the highest stored price, and a safe share of the debt at the lowest.
      const now = pricesOf(aliveOrStop(await readParyonState(server, contracts())));
      if (collateral < minimumCollateral(DEBT, now.used) || collateral < collateralAtRatio(DEBT, now.lowest, FLOOR_PERCENT)) throw new Error(`STOP before borrowing: ${sat(collateral)} of collateral is ${collateralRatio(collateral, DEBT, now.lowest)}% of the debt at the lowest stored price ${dollars(now.lowest)} now, below ${FLOOR_PERCENT}%. Nothing was borrowed; the loan key waits in Paryon's contract.`);
      if (borrowingFee(DEBT, now.lowest) > paidFee + 40_000n) throw new Error(`STOP before borrowing: Paryon's fee would be up to ${sat(borrowingFee(DEBT, now.lowest))} at ${dollars(now.lowest)} now, more than the wallet was paid for. Nothing was borrowed.`);
    }
    const outcome = await actWithService(applications, BORROWED, 'borrow', waiting, applications.waitingAction(id, keyCategory, 'borrow', typed), typed, 'Borrowing');
    // Paryon's fee as the transaction paid it (the template's output 4), and the price it was reckoned at (input 1).
    const borrowed = decodeTransactionBch(hexToBin((await until('the transaction', async () => server.getTransaction(outcome.transactionId))) as string));
    if (typeof borrowed === 'string') throw new Error(borrowed);
    const fee = local ? borrowingFee(DEBT, PRICE) : (borrowed.outputs[4]?.valueSatoshis ?? 0n);
    // The price contract is put back as it was, as output 1: the price named is that of the thread there now, if no one spent it since.
    const named = local ? PRICE : (await readParyonState(server, contracts()).catch(() => undefined))?.price.find((entry) => hex(entry.transactionHash) === outcome.transactionId)?.state.price;
    record('borrow', await sentAs(outcome.transactionId), `from the wallet's own list, joined by the service: ${pusd(DEBT)} PUSD against ${sat(collateral)} of collateral, starting rate 0, as the user typed them; Paryon's fee ${sat(fee)}; the service brought the Borrowing thread, the price, the key waiting in Paryon's contract and its proof, and the values read from them; the key and the PUSD to fresh addresses of the wallet; the record of the key on both stores before the engine signed`);
    amount(`${pusd(DEBT)} PUSD`, 'Debt');
    amount(
      local
        ? `${sat(collateral)}: ${PERCENT}% of the debt at the stored price ${dollars(PRICE)}; Paryon's fee ${sat(fee)}, paid to the address that paid for the run`
        : `${sat(collateral)}: ${PERCENT}% of the debt at the lowest stored price ${dollars(lowestPrice)} when the run started${named === undefined ? '' : `, ${collateralRatio(collateral, DEBT, named)}% at the price the service named, ${dollars(named)}, at which the contracts take it (their least there: ${sat(minimumCollateral(DEBT, named))})`}; Paryon's fee ${sat(fee)}, kept by Paryon`,
      'Collateral',
    );
    return { transactionIds: [outcome.transactionId], data: { fee: String(fee) } };
  });
  await block();
  const [written] = applications.positionRecords;
  note(`The earlier device holds ${applications.positionRecords.length} position record, written when the key reached the wallet: the key ${written?.token?.category.slice(0, 12)}… (${written?.token?.capability}, commitment "${written?.token?.commitment}"), the template, ${written?.lockingScriptIdentifier === undefined ? 'no script (the loan is at Paryon\'s shared contracts)' : `the script ${written.lockingScriptIdentifier}`}, the values ${Object.keys(written?.values ?? {}).join(', ')}, and ${written?.applicationPage === undefined ? 'no page\'s address: no page asked for the action' : `the page's address ${written.applicationPage}`}.`, 'the record written');
  note(`${noDeclaration(applications, 'The earlier device')}.`, 'no declaration on the earlier device');
  const keyOf = async () => until('the key listed under the template', async () => (await applications.recordedPositions({ template: id })).find(({ token }) => token.category === keyCategory));
  const loanNow = async () => until('the loan', async () => findLoan(server, contracts(), hexToBin(keyCategory)));
  {
    const position = await keyOf();
    note(`The wallet lists the key under the template ("${position.status}") and offers from its own list, as the service last said the loan allows: ${applications.offeredActions(position).map(({ name, asks }) => `"${name}"${asks === undefined ? '' : ` (asks ${asks.map(({ name: asked }) => `"${asked}"`).join(', ')})`}`).join(', ')}.`, 'the key\'s actions');
  }

  // 4. Add collateral, from the key's follow-ups: the user types what the loan is to hold.
  await once('collateral is added', async () => {
    const position = await keyOf();
    const typed = { collateral: String((await loanNow()).loan.output.valueSatoshis + MANAGE_ADD) };
    const outcome = await actWithService(applications, 'collateral is added', 'add collateral', applications.offeredActions(position).find(({ action }) => action === 'manage'), applications.actionOn(position, 'manage', typed), typed, 'Adding collateral');
    record('add collateral', await sentAs(outcome.transactionId), `from the key's follow-ups in the wallet, joined by the service: ${sat(MANAGE_ADD)} more collateral (the user typed what the loan holds then, ${typed.collateral}); the service brought the price, the loan, its sidecar and a manage function, the loan's record and what the key's coin holds; the key back to the address it was spent from`);
    return { transactionIds: [outcome.transactionId] };
  });
  await block();
  // On chipnet anyone may pay a loan's interest once a period has passed, which takes 1,500 satoshis from the loan.
  const added = await until('the loan with the collateral added', async () => {
    const now = await findLoan(server, contracts(), hexToBin(keyCategory));
    if (now === undefined) return undefined;
    const holds = now.loan.output.valueSatoshis;
    return holds === collateral + MANAGE_ADD || (!local && holds > collateral + MANAGE_ADD - 20_000n && holds < collateral + MANAGE_ADD) ? now : undefined;
  });

  // 5. Change the interest rate for the periods to come, from the key's follow-ups: the user types the rate, a whole number.
  await once('the interest rate is changed', async () => {
    const position = await keyOf();
    const typed = { interestRate: String(NEW_RATE) };
    const outcome = await actWithService(applications, 'the interest rate is changed', 'change the interest rate', applications.offeredActions(position).find(({ action }) => action === 'changeInterest'), applications.actionOn(position, 'changeInterest', typed), typed, 'Changing the interest rate');
    record('change the interest rate', await sentAs(outcome.transactionId), `from the key's follow-ups in the wallet, joined by the service: the loan's rate for the periods to come set from ${added.state.nextInterestRate} to ${NEW_RATE} per 10,000,000 per period, as the user typed it; the service brought the loan, its sidecar, a coin of Paryon's interest function, the loan's new record and what the key's coin holds; no price; the key back to the address it was spent from`);
    amount(`${added.state.currentInterestRate} per 10,000,000 per period when the loan was opened, ${NEW_RATE} from its next interest payment on (${sat(interestPerPeriod(NEW_RATE, DEBT, lowestPrice))} a period on ${pusd(DEBT)} PUSD at ${dollars(lowestPrice)}, ${sat(interestPerPeriod(NEW_RATE, DEBT - REPAY, lowestPrice))} on ${pusd(DEBT - REPAY)})`, 'Interest rate');
    return { transactionIds: [outcome.transactionId] };
  });
  await block();
  await until('the loan with its new rate', async () => ((await findLoan(server, contracts(), hexToBin(keyCategory)))?.state.nextInterestRate === NEW_RATE ? true : undefined));

  // 6. Repay part of the debt, from the key's follow-ups; the loan stays open.
  await once('part of the loan is repaid', async () => {
    const position = await keyOf();
    const typed = { repayAmount: String(REPAY) };
    const outcome = await actWithService(applications, 'part of the loan is repaid', 'repay part of the loan', applications.offeredActions(position).find(({ action }) => action === 'repay'), applications.actionOn(position, 'repay', typed), typed, 'Repaying part of the loan');
    record('repay part of the loan', await sentAs(outcome.transactionId), `from the key's follow-ups in the wallet, joined by the service: ${pusd(REPAY)} PUSD repaid and destroyed, as the user typed it, ${pusd(DEBT - REPAY)} PUSD still owed; the service brought the price, the loan, its sidecar and a manage function, the loan's new record and what the key's coin holds; the PUSD left over and the key back to the wallet`);
    amount(`${pusd(REPAY)} PUSD repaid before the device was lost, leaving ${pusd(DEBT - REPAY)} PUSD owed`, 'Repayment');
    return { transactionIds: [outcome.transactionId] };
  });
  await block();
  {
    const position = await keyOf();
    note(`With ${pusd(DEBT - REPAY)} PUSD owed, Paryon takes no repayment in part any more: the wallet offers ${applications.offeredActions(position).map(({ name }) => `"${name}"`).join(', ')} for the key.`, 'the key\'s actions after the repayment');
  }
  return keyCategory;
};

/**
 * The new device with Paryon's service: it trusted the template again from the backup and has not spoken to the service;
 * the user presses Connect; the loan's actions appear under the swept key; the loan is closed from the wallet's own list.
 */
const theNewDeviceWithTheService = async (applications: Applications, listed: Awaited<ReturnType<Applications['recordedPositions']>>[number], keyCategory: string): Promise<void> => {
  const id = template().names.identifier;
  await once('the new device has not spoken to the service', async () => {
    noneOutside('on the new device before Connect');
    if (!local) {
      // On chipnet only the wallet's side is counted: the public service's log is not the run's to read.
      if (sentToService.length !== 0) throw new Error(`the new device spoke to the service before Connect: it sent ${sentToService.length} requests`);
      const status = applications.serviceOf(id);
      if (status?.state !== 'never asked') throw new Error(`the new device shows the service as "${status?.state}" before Connect`);
      const actions = await applications.templateActions(id);
      const offered = applications.offeredActions(listed);
      note(`Before Connect, the new device had sent the service no request (the public service's own log is not available on chipnet). The wallet shows the service "${status.description}" at ${status.url} as "${status.state}" and offers Connect; from its own list it offers ${(actions?.starting ?? []).map(({ name }) => `"${name}"`).join(' and ')} under the template, as the template gives them, and ${offered.length === 0 ? 'nothing for the key, which names no script of its own: its loan\'s actions come from the service' : offered.map(({ name }) => `"${name}"`).join(', ')}.`);
      return undefined;
    }
    const at = atTheService().total;
    if (sentToService.length !== 0 || at !== facts.serviceAtLoss) throw new Error(`the new device spoke to the service before Connect: it sent ${sentToService.length} requests, and the service answered ${at} in all against ${facts.serviceAtLoss} when the device was lost`);
    const status = applications.serviceOf(id);
    if (status?.state !== 'never asked') throw new Error(`the new device shows the service as "${status?.state}" before Connect`);
    const actions = await applications.templateActions(id);
    const offered = applications.offeredActions(listed);
    note(`Before Connect, the new device had sent the service no request, and the service, running from the start of this part, had answered ${at} requests in all, as many as when the earlier device was lost: none since the loss. The wallet shows the service "${status.description}" at ${status.url} as "${status.state}" and offers Connect; from its own list it offers ${(actions?.starting ?? []).map(({ name }) => `"${name}"`).join(' and ')} under the template, as the template gives them, and ${offered.length === 0 ? 'nothing for the key, which names no script of its own: its loan\'s actions come from the service' : offered.map(({ name }) => `"${name}"`).join(', ')}.`);
    return { data: { atService: at } };
  });
  await once('the user presses Connect', async () => {
    const status = await inMoment('Connect on the new device', 'Connect', () => applications.connect(id));
    if (status?.state !== 'reached') throw new Error(`Connect did not reach the service: ${JSON.stringify(status)}`);
    const position = await until('the key listed', async () => (await applications.recordedPositions({ template: id })).find(({ token }) => token.category === keyCategory));
    const offered = applications.offeredActions(position);
    if (!offered.some(({ action }) => action === 'close')) throw new Error(`after Connect the wallet does not offer to close the loan: ${offered.map(({ action }) => action).join(', ')}`);
    note(`The user pressed Connect: the wallet asked the service who it is and what is possible for the key it now holds at an address of the new seed. Under the swept key it offers ${offered.map(({ name, service }) => `"${name}"${service?.says === undefined ? '' : ` (the service says ${service.says.map(({ name: said, value }) => `${said} ${value}`).join(', ')})`}`).join(', ')}.`);
    return undefined;
  });
  await once('the loan is closed from the wallet\'s own list', async () => {
    const position = await until('the key listed', async () => (await applications.recordedPositions({ template: id })).find(({ token }) => token.category === keyCategory));
    const loan = await until('the loan', async () => findLoan(server, contracts(), hexToBin(keyCategory)));
    const outcome = await actWithService(applications, 'the loan is closed from the wallet\'s own list', 'close the loan', applications.offeredActions(position).find(({ action }) => action === 'close'), applications.actionOn(position, 'close'), {}, 'Closing the loan on the new phone');
    record('close the loan', await sentAs(outcome.transactionId), 'from the key\'s follow-ups on the new phone, joined by the service, the page closed: the service brought the price, the loan, its sidecar and a manage function, the loan\'s record, the debt and what the key\'s coin holds; the whole debt repaid from the swept PUSD, the PUSD and the loan\'s record sent to data outputs, the sidecar not carried on; the collateral and the key to fresh addresses of the new seed');
    amount(`the loan held ${sat(loan.loan.output.valueSatoshis)} and a debt of ${pusd(loan.state.borrowed)} PUSD; the collateral came back to addresses of the new seed, and the PUSD repaid were destroyed`, 'Closing');
    return { transactionIds: [outcome.transactionId] };
  });
};

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
        note(`Before starting: Paryon's deployment \`${contracts().deployment.name}\` showed ${state.borrowing.length} Borrowing threads (periods ${[...new Set(state.borrowing.map((entry) => entry.period))].join(', ')}), ${state.price.length} price threads (${[...new Set(state.price.map((entry) => dollars(entry.state.price)))].join(', ')}), ${state.loanKeyFactory.length} loan key factories, ${state.manage.length} manage functions and ${interestFunctions} interest functions, at the tip ${tip.height} (the period of the highest height a lock time may name for the next block: ${move.current}). The funding address held ${sat(balance)}: enough for ${sat(course.collateral)} of collateral, ${PERCENT}% of the debt at the lowest stored price ${dollars(course.lowest)}, Paryon's fee ${sat(course.fee)} at ${dollars(course.used)}, and ${sat(LEAVE_AT_FUNDER)} left there. The template ${withService ? 'offered' : 'sent'} is the frozen one of version ${withService ? 3 : 2}, \`${template().names.identifier}\`${withService ? `, whose service is Paryon's public one at ${CHIPNET_SERVICE_URL}` : ''}.`);
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
    // On chipnet the service is Paryon's public one, which the run does not start.
    if (withService && local) {
      await startService();
      countLeftovers();
    }
    account = await openAccount(facts.words.owner, "the owner's device");
    const wallet = await OwnerWallet.open({ backend: account, chain, seed: ownerSeed, feeRate: FEE_RATE, ...(facts.ownerState === undefined ? {} : { state: facts.ownerState }), save: (state) => { facts.ownerState = state; keep(); } });
    const funding = await wallet.fundingAddress();
    await once('the wallet is funded', async () => ({ transactionIds: [await funderPays('the wallet is funded', [{ lockingBytecode: funding, valueSatoshis: walletCreation() }])] }));
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
      record('create', { ...(await sentAs(createdAt)), bytes }, 'the controller and the rest');
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
    const pay = collateral + fee + MANAGE_ADD + atRate(50_000n);
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
    const applications = new Applications(wallet.parts, { archive: applicationArchive({ arrangement: () => facts.ownerArrangement, storeAt, seed: ownerSeed, identity, chain }), ...(withService ? serviceOption : {}) });
    facts.loan ??= { collateral: String(collateral) };
    keep();
    let keyCategory: string;
    if (withService) keyCategory = await theOwnerWithTheService(applications, collateral, lowestPrice, fee);
    else {
      const { link, ask } = thePage(applications);

      // 1. A loan key. The page names a factory of Paryon's it read from the chain. The key is made from the wallet's
      // coin and waits in Paryon's contract: the wallet asks for the user's tick, and the user gives it.
      const made = await once('a loan key is made', async () => {
        const state = await readParyonState(server, contracts());
        const [factory] = state.loanKeyFactory;
        if (factory === undefined) throw new Error('no factory');
        const outcome = await ask(createKeyRequestAloneV2(template().names, { factory, page: PAGE }), 'Making a loan key', true);
        record('make a loan key', await sentAs(outcome.transactionId), 'from the page\'s request, with the user\'s tick: the wallet\'s coin that is output 0 defines the key\'s category (input 0); Paryon\'s factory, named by the page; the key waits in Paryon\'s contract; output 0 is what the wallet keeps of its coin');
        return { transactionIds: [outcome.transactionId], data: { transactionId: outcome.transactionId } };
      });
      const madeId = made['transactionId'] as string;
      const madeTransaction = decodeTransactionBch(hexToBin((await until('the key\'s transaction', async () => server.getTransaction(madeId))) as string));
      if (typeof madeTransaction === 'string') throw new Error(madeTransaction);
      keyCategory = hex(madeTransaction.inputs[0]?.outpointTransactionHash as Uint8Array);
      (facts.loan as { keyCategory?: string }).keyCategory = keyCategory;
      keep();
      note(`After the key was made the wallet holds ${applications.positionRecords.length} position record: the key is in Paryon's contract, not in the wallet, and the wallet follows nothing there.`, 'no record for the key yet');

      // 2. Bring the Borrowing thread up to date, so that the loan is charged no interest for the periods before.
      const move = async (thread: ParyonState['borrowing'][number], height: number, how: string): Promise<{ transactionIds: string[] }> => {
        const outcome = await ask(movePeriodRequestAloneV2(template().names, contracts(), { borrowing: thread, lockHeight: height, page: PAGE }), 'Bringing Paryon up to date');
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
          return borrowRequestAloneV2(template().names, { borrowing: thread, price, enforcer: at(2), proof: at(3), debt: DEBT, collateral, startingInterest: 0, page: PAGE });
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
          return manageRequestAloneV2(template().names, { ...coins, collateral: coins.loan.output.valueSatoshis + MANAGE_ADD });
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
          return changeInterestRequestAloneV2(template().names, { keyCategory, keySatoshis: found.keySatoshis, loan: found.loan, sidecar: found.sidecar, interestFunction: found.interestFunction, rate: NEW_RATE, page: PAGE });
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
          return repayRequestAloneV2(template().names, { ...coins, repay: REPAY, collateral: coins.loan.output.valueSatoshis });
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
    if (withService) {
      noneOutside('after the last action');
      if (local) facts.serviceAtLoss ??= atTheService().total;
      keep();
    }
  }

  if (phase === 'the recoverer recovers') {
    const identity = hexToBin(facts.identity as string);
    account = await openAccount(facts.words.credential, 'the recoverer');
    const funds = await RecovererFunds.open({ backend: account, chain, feeRate: FEE_RATE });
    const recoverer = await RecovererWallet.open({ funds, chain, identity, recoveryKey: credential.recoveryKey });
    const fees = recoveryFees(FEE_RATE);
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

  if (phase === PHASES[2]) {
    const identity = hexToBin(facts.identity as string);
    // The service runs from the start of this part, so that a request the new device sent it would reach it and be counted.
    // On chipnet it is Paryon's public one, which the run does not start.
    if (withService && local) {
      await startService();
      countLeftovers();
    }
    account = await openAccount(facts.words.next, 'the new device');
    const save = (state: OwnerWalletState): void => { facts.newState = state; keep(); };
    const wallet = facts.newState === undefined
      ? await OwnerWallet.takeOver({ backend: account, chain, seed: newSeed, identity, earlierViewingKeys: [ownerSeed.viewingKey], save, feeRate: FEE_RATE })
      : await OwnerWallet.open({ backend: account, chain, seed: newSeed, state: facts.newState, save, feeRate: FEE_RATE });
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
      const applications = new Applications(wallet.parts, { archive: applicationArchive({ arrangement: () => facts.newArrangement, storeAt, seed: newSeed, identity, chain }), ...(withService ? serviceOption : {}) });
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
        note(`The user trusted the template "${suggested.name}" the earlier owner stored, on the user's word${withService ? '; a trust restored from the backup does not speak to the template\'s service' : ''}.`);
        const check = await checkPositionRecord(suggestedRecord, wallet.parts, readTemplate(template().texts.template));
        note(`The check of section 10.4 found that the record ${check.counts ? 'counts' : 'does not count'}: ${check.reason}`);
        const confirmation = await applications.confirmRecords();
        note(`The record was written again as the new owner's own on the stores (${confirmation.confirmed} record); it names no script, so nothing was handed to the engine (${confirmation.followed} scripts).`);
        return undefined;
      });
      const [position] = await applications.recordedPositions();
      if (position === undefined) throw new Error('the key is not listed');
      note(`The new device lists the key from the record: "${position.status}", ${position.standing === 'own' ? 'a record of its own' : 'a record of the earlier seed'}, under the template "${position.template.name}", the key at ${position.token.place === 'address' ? 'an address of the new seed' : position.token.place}; whether the loan is open is ${withService ? 'the service\'s or' : ''} the page's to say.`, 'the key listed');
      if (withService) await theNewDeviceWithTheService(applications, position, keyCategory);
      else {
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
            return closeRequestAloneV2(template().names, closing);
          }, 'Closing the loan on the new phone');
          record('close the loan', await sentAs(outcome.transactionId), 'from the page\'s request on the new phone: the page named the price, the loan, its sidecar and a manage function, and gave the loan\'s record, the debt and the key\'s coin value as the wallet reported it; the whole debt repaid, the PUSD and the loan\'s record sent to data outputs, the sidecar not carried on; the collateral and the key to fresh addresses of the new seed');
          const record_ = decodeLoanState(closing.loan.output.token?.nft?.commitment as Uint8Array);
          amount(`the loan held ${sat(closing.loan.output.valueSatoshis)} and a debt of ${pusd(record_.borrowed)} PUSD; the collateral came back to addresses of the new seed, and the PUSD repaid were destroyed`, 'Closing');
          return { transactionIds: [outcome.transactionId] };
        });
      }
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
      const funds = await RecovererFunds.open({ backend: account, chain, feeRate: FEE_RATE });
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
    if (withService && local && (await endLeftoverService())) left.push('a process of Paryon\'s service, now ended');
    const spent = BigInt(facts.funderAtStart as string) - total;
    if (local) {
      amount(`${sat(BigInt(facts.funderAtStart as string))} before the run (after deploying Paryon's contracts), ${sat(total)} after it`, 'Funder');
      note(`The funding address held ${facts.funderAtStart} satoshis before the run and holds ${total} after it: the run cost ${spent} satoshis in network fees (Paryon's fee went to the same address and came back). ${left.length === 0 ? `Nothing is left anywhere else: no PUSD (all of it was destroyed at the closing), no loan key (destroyed by the funder), no coin at the wallet's or the recoverer's addresses, and no loan${withService ? ', and no process of Paryon\'s service' : ''}. Paryon's deployment stays on the local chain.` : `LEFT BEHIND: ${left.join('; ')}.`}`);
    } else {
      const borrowFee = BigInt(facts.steps[BORROWED]?.data?.['fee'] ?? 0);
      const networkFees = facts.log.reduce((sum, entry) => sum + BigInt(entry.fee), 0n);
      amount(`${sat(BigInt(facts.funderAtStart as string))} before the run, ${sat(total)} after it`, 'Funder');
      amount(`${sat(spent)}: Paryon's borrowing fee ${sat(borrowFee)}, network fees ${sat(networkFees)} for the ${facts.log.length} transactions above, and ${sat(spent - borrowFee - networkFees)} otherwise (the fees of the payments of the funder and of the recoverer's balance, which are not among the transactions above, and 1,500 sat and the interest for each interest payment someone else made on the loan while it was open: the interest was 0 until the first payment after the rate was changed to ${NEW_RATE} per 10,000,000 per period; anything another run paid from the same key meanwhile would be here too)`, 'Cost of the run');
      note(`The funding address held ${facts.funderAtStart} satoshis before the run and holds ${total} after it. ${left.length === 0 ? 'Nothing is left anywhere else: no PUSD (all of it was destroyed at the closing), no loan key (destroyed by the funder), no coin at the wallet\'s or the recoverer\'s addresses, and no loan.' : `LEFT BEHIND: ${left.join('; ')}.`}`);
    }
    if (left.length > 0) throw new Error(`coins were left behind: ${left.join('; ')}`);
  }
  if (withService) noneOutside(`at the end of "${phase}"`);
  if (!facts.finished.includes(phase)) facts.finished.push(phase);
  keep();
} catch (error) {
  say(`FAILED: ${(error as Error).name}: ${String((error as Error).message).slice(0, 700)}\n${String((error as Error).stack).split('\n').slice(1, 5).join('\n')}`);
  process.exitCode = STOPPED;
} finally {
  if (local) await rpc('setmocktime', 0).catch(() => undefined);
  await stopService().catch(() => undefined);
  await server.disconnect().catch(() => undefined);
  await account?.close();
  process.exit();
}
