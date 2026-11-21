// The Savings Jar course of stage 17 in browsers, on the local node or on chipnet (acceptance test PR19 of proposal
// v0.6, run G on chipnet): the wallet page, the recoverer page and the Savings Jar page, driven as a person would. Each device is a browser profile of its own, kept on disk; the Savings Jar page is a second tab of the
// phone that uses it. The wallet reads no recovery declaration: the jar reaches it as its template, in the page's
// requests of `xo_v1` version 2, and comes back after the loss of the phone from the wallet's own record of it.
//
//   1. Anna opens the recoverer's page and funds her balance      6. a new phone takes the wallet over and sweeps
//   2. Anna sets up Grandma's wallet: the phone scans her code     7. the new phone trusts the template from the backup
//   3. the owner receives                                             and lists the jar from its record, confirmed
//   4. the owner connects the wallet to the Savings Jar page       8. the jar's date passes; the new phone empties the
//      and opens a jar from it; the wallet lists it                   jar from its own list, the jar page never opened
//   5. the phone is lost                                           9. the coins go back to where they came from
//
// Every request the new phone's browser makes, from the moment its profile is made, is recorded (to requests.json
// beside the profiles, so that a continued run keeps them), and the run stops if one goes to the Savings Jar page.
//
// usage (from the repository's root, with the local node running and the pages built: deploy/preview.sh build):
//   npx tsx scripts/stage-17-jar-browser.ts [local] [--screens] [--headed] [--until <step>] [--from 5|7|8|9] [--ports <base>] [--directory <name>] [--within <minutes>]
// on chipnet, with the public pages and backup stores, paid from the key in .chipnet/funder-design-2.json:
//   npx tsx scripts/stage-17-jar-browser.ts chipnet [--screens] [--headed] [--until <step>] [--from 5|7|8|9] [--record-only]
// --record-only writes the record again from what the run kept, and runs nothing.
//
// The first use of a wallet, with small amounts and the recoverer's proposed settings (see scripts/browser-course.ts),
// stopped with the jar open: the wallet, its jar and the recoverer's kit stay as they are, and only what is left at
// the run's key goes back. On the local node, to prove the steps:
//   npx tsx scripts/stage-17-jar-browser.ts local --first-use --directory <name> --record <file name>
// and on mainnet, with real coins, everything kept in the folder named:
//   npx tsx scripts/stage-17-jar-browser.ts mainnet --folder <absolute path> --funder <funding key file> --screens --record mainnet-first-run.md
// The first use adds to step 3 a small payment out of the wallet, to the run's key, and ends after step 4. The pages
// are served at the ports of the run (8700 and on, on mainnet), so that a later part opens the same profiles' data at
// the same addresses with `--from 5`.
//
// The pages, a relay and two backup stores are served on this machine on ports of the run's own (see
// scripts/browser-course.ts; 8301 to 8304, 8311 and 8312 unless --ports says otherwise). The run pays from a key of
// its own, given 460,000 satoshis at the start and emptied back to the funding address at the end (scripts/run-key.ts). The run makes the blocks
// and moves the chain's clock. Profiles, the stores' data, the log and what the run knows between steps are under
// .local-runs/stage-17-jar-browser/. `--from` continues a run that stopped, with the profiles on disk.
//
// The record is written to docs/runs/stage-17-jar-browser-local-node.md; with --screens, pictures at 390x844 and
// 1280x800 go to docs/screens/ as live-jar-*.png. On chipnet the blocks, the waiting period and the jar's date take
// their real time; the profiles and the log are under .chipnet/stage-17-jar-browser-chipnet/, the record is
// docs/runs/stage-17-jar-browser-chipnet.md and the pictures are chipnet-jar-*.png.
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';

import { hexToBin } from '@bitauth/libauth';
import { controllerScript } from '@grandmas-wallet/core';
import { savingsJarScript } from '@grandmas-wallet/savings-jar';
import type { Locator, Page } from 'playwright';

import { type ArchiveStore, readArchive, readRecord } from '@grandmas-wallet/archive';

import { PAGE_WAIT, type Device, JAR, LIMIT, RECOVERER, WALLET, argument, chainShows, chipnet, clearLeftovers, click, completeTakeover, config, confirmStatement, course, firstSteps, firstUse, mainnet, newPhoneAsks, openDeskWorking, pageShows, pagesUsed, publicChain, recordFile, reviewEverything, root, see, takeScreens, walletKey, sendAllOfBalance, servedFrom, untilChain, untilPage, valueOf } from './browser-course.js';
import { type LedgerTransaction, addressOf, chainClock, chainHeight, ledgerSection, runTransactions } from './browser-ledger.js';
import { type RequestLog, controllerLabels, flat, localPayerLocking, lockingOf, openFolds, recordRequests, requestsSection, textOf, walletKept, walletPlaces } from './browser-live.js';

const until = Number(argument('until') ?? '99');
/** Only the record is written again, from what the run kept and the chain as it is now: nothing is run, and the run's log and requests are kept. */
const recordOnly = process.argv.includes('--record-only');
const from = Number(argument('from') ?? (recordOnly ? '9' : '1'));
if (![1, 5, 6, 7, 8, 9].includes(from)) throw new Error('A run continues from step 5, 6, 7, 8 or 9.');
/**
 * Step 6 only as far as the recovery request in a block: the run stops there, before the waiting period. The
 * request is held back from the network until the new phone's keys and what Anna's page keeps for the request are
 * copied to disk. `--from 6` goes on from there: the move is completed, and steps 7 to 9 follow.
 */
const requestOnly = process.argv.includes('--request-only');
if (requestOnly && from !== 5) throw new Error('--request-only goes with --from 5: the recoverer\'s page has to be opened by the run, so that its request can be held until what it keeps is on disk.');
/**
 * What a first use pays, in satoshis: Anna's balance (the wallet's creation with the page's proposed starting
 * balance of 10,000, and room for a recovery's two transactions later), a payment to the owner, a payment out of
 * the wallet, and the smallest first amount the Savings Jar page takes.
 */
const SMALL = { need: 80_000, balance: 30_000, receive: 20_000, payOut: 5_000, jar: 2_000 };
/** The first part of a first use: from step 1 to the open jar. A first use continued with `--from` runs the later steps as the course does. */
const firstPart = firstUse && (from === 1 || recordOnly);
// What the run pays: 400,000 satoshis to Anna's balance and 50,000 to the owner, with room for the fees.
const theCourse = course({ directory: 'stage-17-jar-browser', continuing: from > 1, until: firstPart ? Math.min(until, 4) : until, ports: 8300, need: firstPart ? SMALL.need : 460_000 });
const { work, started, lines, log, mine, passTime, prepare, device, watchPage, close, shot, state, begin, elsewhere, keepStorage } = theCourse;
const noShot = async (): Promise<void> => undefined;
const JAR_ORIGIN = new URL(JAR).origin;

// ------------------------------------------------------------------ what the run keeps between its parts

interface Kept {
  startHeight: number;
  category: string;
  unlockTime: number;
  jarAddress: string;
  fundsAddress: string;
  /** What each transaction was, as the run knew it when it was made. */
  labels: Record<string, string>;
  /** What the run showed, for the head of the record. */
  facts: string[];
  continued: string[];
  /** The names of the pictures taken. */
  screens: string[];
  /** The outcome as last written to the record. */
  outcome?: string;
  /** How the run was started, and when: for a record written again. */
  command?: string;
  startedAt?: number;
  /** On chipnet: which release of the public pages each part of the run used. */
  served?: string[];
  /** In a first use: the funding address's holdings when the run started and when it ended, as its server said. */
  fundingBefore?: string;
  fundingAfter?: string;
  /** In a first use: the position record of the jar as read back from the backup stores, and when each store had it. */
  positionRecord?: string[];
  /** In a first use: how long each step took, in seconds. */
  durations?: string[];
  /** In a first use: when Approve was clicked for the jar and when the wallet said "Done", in milliseconds since 1970. */
  approvedAt?: number;
  doneAt?: number;
}
const keptFile = `${work}jar.json`;
const kept: Kept =
  from > 1 && existsSync(keptFile)
    ? (JSON.parse(readFileSync(keptFile, 'utf8')) as Kept)
    : { startHeight: await chainHeight(), category: '', unlockTime: 0, jarAddress: '', fundsAddress: '', labels: {}, facts: [], continued: [], screens: [] };
/** The names of the pictures and of the record: of the local node, or of chipnet. */
const where = mainnet ? 'mainnet' : chipnet ? 'chipnet' : 'local-node';
const prefix = mainnet ? 'mainnet-jar' : chipnet ? 'chipnet-jar' : 'live-jar';
const save = (): void => writeFileSync(keptFile, JSON.stringify(kept, null, 1));
save();
const fact = (line: string): void => {
  kept.facts.push(line);
  save();
  log(`   (${line})`);
};
const label = (transactionId: string, what: string): void => {
  if (/^[0-9a-f]{64}$/.test(transactionId) && kept.labels[transactionId] === undefined) kept.labels[transactionId] = what;
  save();
};
const picture = async (page: Page, name: string): Promise<void> => {
  if (!takeScreens) return;
  await shot(page, `${prefix}-${name}`);
  if (!kept.screens.includes(name)) kept.screens.push(name);
  save();
};
const requests: RequestLog = recordRequests(`${work}requests.json`, from > 1);

// ------------------------------------------------------------------ reading the pages

const iso = (seconds: number): string => new Date(seconds * 1000).toISOString().replace('.000Z', 'Z');

/** The row of the jar's key in the wallet's list, as a position from a record or as a token. */
const keyRow = (page: Page): Locator => page.locator('li.token').filter({ has: page.locator(`.token-id [title="${kept.category}"]`) });

/** Connect the wallet to the Savings Jar page open in another tab: the page's address is pasted into the wallet. */
const connect = async (wallet: Page, jarPage: Page): Promise<void> => {
  await jarPage.goto(JAR);
  await confirmStatement(jarPage, log, 'the Savings Jar page');
  const address = jarPage.locator('.value-text[data-value^="wiz:"]').first();
  // A page that was connected to this wallet in a part of the run that stopped takes that session up again by itself.
  const resumed = jarPage.getByText(/^Connected to /).first();
  await pageShows(address.or(resumed).or(jarPage.getByText(/Reaching the wallet/)), 'the Savings Jar page\'s connection address, or the session it had before');
  if (!(await address.isVisible())) {
    // A session of a part that stopped may have gone through a relay that is gone with it: then the page is paired again.
    const back = await resumed.waitFor({ state: 'visible', timeout: PAGE_WAIT }).then(() => true, () => false);
    if (back) {
      log('   the Savings Jar page took up the session it had with this wallet before');
      return;
    }
    log(`   the Savings Jar page did not take up its earlier session within ${PAGE_WAIT / 1000} s ("${flat(await jarPage.locator('.link-state, .connect-card, main').first().innerText().catch(() => ''))}"); it is connected again with "Connect another wallet"`);
    await click(jarPage, 'Connect another wallet');
    await pageShows(address, 'the Savings Jar page\'s connection address after "Connect another wallet"');
  }
  const uri = (await address.getAttribute('data-value')) ?? '';
  await see(jarPage, 'Waiting for your wallet.');
  log(`   the Savings Jar page shows its connection address (${uri.length} characters) and waits for a wallet`);
  await wallet.goto(`${WALLET}apps`);
  await click(wallet, 'Paste a link instead');
  await wallet.getByLabel('Connection link').fill(uri);
  await click(wallet, /^Connect$/);
  const row = wallet.locator('ul.connections li').filter({ has: wallet.getByText('Connected', { exact: true }) }).first();
  await pageShows(row, 'the wallet\'s Applications screen to say "Connected"');
  // A connection to the session of a part that stopped, which cannot come back, is ended.
  const stale = wallet.locator('ul.connections li').filter({ hasText: 'Connecting' });
  for (let round = 0; round < 5 && (await stale.first().isVisible()); round++) {
    const before = await stale.count();
    await stale.first().getByRole('button', { name: 'End the connection' }).click();
    log('   the wallet\'s connection to the session of the part that stopped is ended');
    await untilPage(async () => (await stale.count()) < before, 'the ended connection to leave the wallet\'s list');
  }
  log(`   the wallet's Applications screen: "${await textOf(row.locator('.connection-name'))}", ${await textOf(row.locator('.small.muted'))}; "Connected"`);
  await see(jarPage, /Connected to /);
  log(`   the Savings Jar page: "${await textOf(jarPage.locator('.status-title'))}"`);
};

// ------------------------------------------------------------------ what a first use adds

/** How long each part took, said in the log and kept for the record. */
let partStarted = Date.now();
const timed = (part: string): void => {
  const seconds = Math.round((Date.now() - partStarted) / 1000);
  partStarted = Date.now();
  kept.durations = [...(kept.durations ?? []), `${part}: ${seconds} s`];
  save();
  log(`   (${part} took ${seconds} s)`);
};

/** The run's key's address, read from its file (only the address). */
const runKeyAddress = (): string => (JSON.parse(readFileSync(theCourse.keyFile, 'utf8')) as { address: string }).address;

/** Step 3 of a first use goes on: the owner pays a small amount out of the wallet, to the run's key, from the Send screen. */
const payOut = async (old: Device): Promise<void> => {
  const to = runKeyAddress();
  await old.page.getByRole('link', { name: 'Send' }).first().click();
  await old.page.getByLabel('To').fill(to);
  await old.page.getByLabel('Amount').fill((SMALL.payOut / 1e8).toFixed(8).replace(/0+$/, ''));
  await click(old.page, 'Review');
  await see(old.page, 'Check and send');
  const review = await textOf(old.page.locator('.card').filter({ hasText: 'Check and send' }));
  log(`   the review of the payment: "${review}"`);
  log(`   about to send ${SMALL.payOut.toLocaleString('en-US')} satoshis from the wallet to the run's key ${to}`);
  await click(old.page, /^Send$/);
  const sent = await valueOf(old.page, 'sent-transaction');
  const card = await textOf(old.page.locator('.card').filter({ hasText: /^Sent/ }));
  label(sent, `The owner pays ${SMALL.payOut.toLocaleString('en-US')} sat out of the wallet, to the run's key, from the Send screen`);
  log(`   sent: transaction ${sent}; the wallet says "${card}"`);
  fact(`An ordinary payment out of the wallet: ${SMALL.payOut.toLocaleString('en-US')} sat to the run's key from the Send screen (transaction \`${sent}\`). Its review said: "${review}"`);
};

/** What the phone's browser sends while it is watched: records to the backup stores, transactions to the network. */
const sending: { at: number; what: string }[] = [];
const watchSending = (owner: Device): void => {
  owner.context.on('request', (asked) => {
    if (asked.method() === 'POST' && /\/v1\/archives\/[0-9a-f]+\/blobs$/.test(asked.url())) sending.push({ at: Date.now(), what: `a record to the store at ${new URL(asked.url()).host}` });
  });
  owner.page.on('websocket', (socket) =>
    socket.on('framesent', (frame) => {
      const text = typeof frame.payload === 'string' ? frame.payload : frame.payload.toString('utf8');
      if (text.includes('blockchain.transaction.broadcast')) sending.push({ at: Date.now(), what: `a transaction to the server ${new URL(socket.url()).host}` });
    }),
  );
};

/** A backup store read from the folder it keeps its blobs in (apps/archive-store), without its server. */
const diskStore = (directory: string, name: string): ArchiveStore => ({
  name,
  put: () => Promise.reject(new Error('read only')),
  list: async (archive) => (existsSync(`${directory}/${archive}`) ? readdirSync(`${directory}/${archive}`).filter((blob) => /^[0-9a-f]{64}$/.test(blob)) : []),
  get: async (archive, blob) => (existsSync(`${directory}/${archive}/${blob}`) ? new Uint8Array(readFileSync(`${directory}/${archive}/${blob}`)) : undefined),
});

/** The blobs on the run's two backup stores, on disk, with when each was written. */
const storeBlobs = (): Map<string, number> => {
  const found = new Map<string, number>();
  for (const store of ['store1', 'store2']) {
    const directory = `${work}${store}`;
    if (!existsSync(directory)) continue;
    for (const archive of readdirSync(directory)) {
      const folder = `${directory}/${archive}`;
      if (!statSync(folder).isDirectory()) continue;
      for (const blob of readdirSync(folder)) if (/^[0-9a-f]{64}$/.test(blob)) found.set(`${store}/${blob}`, statSync(`${folder}/${blob}`).mtimeMs);
    }
  }
  return found;
};

/**
 * The position record of the jar, read back from the run's backup stores with the archive key the wallet keeps, and
 * when each store wrote it to disk, against when the phone sent the transaction and when the wallet said "Done".
 */
const positionRecordRead = async (before: Map<string, number> | undefined, approvedAt: number, doneAt: number, opened: string): Promise<void> => {
  kept.approvedAt = approvedAt;
  kept.doneAt = doneAt;
  const after = (s: number): string => `${((s - approvedAt) / 1000).toFixed(1)} s`;
  const items = (JSON.parse(readFileSync(`${work}storage-old-phone.json`, 'utf8')) as Record<string, Record<string, string>>)[new URL(WALLET).origin] ?? {};
  const arrangement = JSON.parse(items[walletKey('arrangement')] ?? '{}') as { archive?: { archiveId: string; contentKey: string } };
  const lines: string[] = [];
  if (arrangement.archive === undefined) {
    lines.push('The wallet\'s archive key was not found in what its page keeps, so the stores were not read.');
  } else {
    // Read from the stores' own folders, as the stores serve them: so that it can be read again when they are not running.
    const contents = await readArchive(hexToBin(arrangement.archive.archiveId), hexToBin(arrangement.archive.contentKey), ['store1', 'store2'].map((name, index) => diskStore(`${work}${name}`, `${name} (${config.stores[index] ?? ''})`)));
    // Read again after the run: what the stores wrote from Approve to "Done", by the times of their files.
    const written = [...storeBlobs()].filter(([name, at]) => (before === undefined ? at >= approvedAt - 1_500 && at <= doneAt + 1_500 : !before.has(name)));
    for (const blob of contents.blobs) {
      if (blob.blob.type !== 'record') continue;
      let record;
      try {
        record = readRecord(blob.blob.signed, mainnet ? 'mainnet' : 'testnet');
      } catch {
        continue;
      }
      const entry = record.entry;
      if (entry.kind !== 'position' || entry.token?.category !== kept.category) continue;
      const onDisk = written.filter(([name]) => name.endsWith(blob.blobId)).map(([name, at]) => `${name.split('/')[0]} wrote it ${after(at)} after Approve`);
      lines.push(
        `The position record of the jar's key, read back from ${blob.stores.join(' and ')} with the wallet's archive key and its signature checked (a ${record.network} record of the wallet \`${record.identity}\`): blob \`${blob.blobId}\`; ${onDisk.length === 0 ? 'it was on the stores before Approve' : onDisk.join(', ')}.`,
        `What it says: template \`${entry.templateIdentifier}\`; the token ${entry.token.category} (${entry.token.capability}, commitment ${entry.token.commitment === '' ? 'none' : entry.token.commitment}); script \`${entry.lockingScriptIdentifier ?? '(none named)'}\`, the wallet's role \`${entry.roleIdentifier ?? '(none named)'}\`; the script's values ${JSON.stringify(entry.variables ?? {})}; the action's other values ${JSON.stringify(entry.values)}; the page ${entry.applicationPage ?? '(none named)'}.`,
      );
    }
    if (lines.length === 0) lines.push(`No position record of the jar's key was found on the stores (${contents.blobs.length} blobs read${contents.problems.length === 0 ? '' : `; ${contents.problems.join('; ')}`}).`);
    if (contents.problems.length > 0) lines.push(`Reading the stores: ${contents.problems.join('; ')}.`);
    lines.push(`Written to the stores' disks between Approve and "Done": ${written.length === 0 ? 'nothing' : written.map(([name, at]) => `${name.split('/')[0]} ${name.split('/')[1]?.slice(0, 12)}… at ${after(at)}`).join(', ')}.`);
  }
  const seen = sending.filter((entry) => entry.at >= approvedAt - 1_000 && entry.at <= doneAt + 1_000);
  const earlier = (kept.positionRecord ?? []).find((line) => line.startsWith('What the phone\'s browser sent'));
  if (before === undefined && earlier !== undefined) lines.push(earlier);
  else lines.push(`What the phone's browser sent between Approve and "Done" (${after(doneAt)}), in order: ${seen.length === 0 ? 'nothing seen' : seen.map((entry) => `${entry.what} at ${after(entry.at)}`).join('; ')}. The transaction the wallet named is \`${opened}\`.`);
  kept.positionRecord = lines;
  save();
  for (const line of lines) log(`   ${line}`);
};

// ------------------------------------------------------------------ the request alone

/** A value anywhere in what a page keeps, its JSON strings read too: the first object under `name` that has the text `field`. */
const findKept = (value: unknown, name: string, field: string): Record<string, unknown> | undefined => {
  if (typeof value === 'string') {
    if (!/^[[{]/.test(value)) return undefined;
    try {
      return findKept(JSON.parse(value), name, field);
    } catch {
      return undefined;
    }
  }
  if (value === null || typeof value !== 'object') return undefined;
  for (const [key, inner] of Object.entries(value)) {
    if (key === name && inner !== null && typeof inner === 'object' && typeof (inner as Record<string, unknown>)[field] === 'string') return inner as Record<string, unknown>;
    const found = findKept(inner, name, field);
    if (found !== undefined) return found;
  }
  return undefined;
};

/**
 * Step 6 as far as the request in a block (`--request-only`). Anna's page sends the request as soon as the new
 * phone's request reaches it; what it sends to the network is held back until the new phone's keys and what her page
 * keeps for the request are copied to disk, and then let through. The run then waits for a block to hold the request
 * and says when the waiting period ends by the chain's clock.
 */
const requestHeld = async (recoverer: Device, next: Device): Promise<void> => {
  const held: (() => void)[] = [];
  let holding = true;
  let leftThrough = 0;
  // Installed before Anna's page is opened, so that every connection it makes to the chain's servers passes here.
  await recoverer.context.routeWebSocket(/^wss:\/\//, (socket) => {
    const server = socket.connectToServer();
    socket.onMessage((message) => {
      const text = typeof message === 'string' ? message : message.toString('utf8');
      if (text.includes('blockchain.transaction.broadcast')) {
        if (holding) {
          held.push(() => server.send(message));
          return;
        }
        leftThrough += 1;
      }
      server.send(message);
    });
  });
  await newPhoneAsks(theCourse, recoverer, '', noShot, next);
  await untilChain('Anna\'s page to sign the request, held back from the network', LIMIT.read, async () => held.length > 0);
  log(`   Anna's page signed the request; it is held back from the network (${held.length} message${held.length === 1 ? '' : 's'}) while what both pages keep is copied to disk`);
  await keepStorage(next);
  await keepStorage(recoverer);
  const newPhone = readFileSync(`${work}storage-new-phone.json`, 'utf8');
  const anna = readFileSync(`${work}storage-recoverer.json`, 'utf8');
  const words = walletKey('words');
  if (!newPhone.includes(words) || !newPhone.includes(walletKey('takeover'))) throw new Error(`the new phone's words or its takeover request are not in ${work}storage-new-phone.json: nothing was let through to the network`);
  const pending = findKept(JSON.parse(anna), 'pending', 'proposedKeyHash');
  if (pending === undefined || typeof pending.proposedKeyHash !== 'string') throw new Error(`Anna's saved takeover is not in ${work}storage-recoverer.json: nothing was let through to the network`);
  log(`   on disk before the request goes out: the new phone's words and its takeover request (storage-new-phone.json, and its profile), and Anna's saved takeover to the key ${pending.proposedKeyHash.slice(0, 8)}… (storage-recoverer.json)`);
  holding = false;
  for (const send of held) send();
  log('   the request is let through to the network');
  await chainShows(recoverer.page.getByText('Your request is waiting'), 'Anna\'s page to show "Your request is waiting", once the server has the request', LIMIT.read);
  await keepStorage(recoverer);
  const requested = findKept(JSON.parse(readFileSync(`${work}storage-recoverer.json`, 'utf8')), 'requested', 'transactionId');
  const transactionId = typeof requested?.transactionId === 'string' ? requested.transactionId : '';
  label(transactionId, 'Anna\'s page sends the recovery request, from her balance, to the new phone\'s key');
  log(`   the request: transaction ${transactionId || '(not found in what her page keeps)'}${leftThrough > 0 ? `; ${leftThrough} more transaction${leftThrough === 1 ? '' : 's'} went out after it` : ''}`);
  await picture(recoverer.page, 'request-sent');
  const sentAt = Date.now();
  const limit = 40 * 60_000;
  await chainShows(recoverer.page.getByTestId('waiting-clock'), `a block to hold the recovery request (on mainnet about ten minutes; at most ${limit / 60_000} minutes)`, limit);
  const clockOf = async (testId: string): Promise<string> => ((await recoverer.page.getByTestId(testId).first().textContent()) ?? '').trim();
  const height = await valueOf(recoverer.page, 'chain-height');
  log(`   the request is in a block, ${Math.round((Date.now() - sentAt) / 1000)} s after it was let through; the recoverer's page shows the chain's clock at ${await clockOf('waiting-clock')}, block ${height}; the waiting period ends when it passes ${await clockOf('waiting-ends')}`);
  const status = await textOf(recoverer.page.locator('.card').filter({ hasText: 'Where the wallet stands' }).first()).catch(() => '(not read)');
  log(`   Anna's page: "${status}"`);
  fact(`Anna's page sent the recovery request (transaction \`${transactionId}\`) once the new phone's keys and her saved takeover were on disk; a block held it, and her page said: "${status}"`);
  await picture(recoverer.page, 'request-in-block');
  await keepStorage(next);
  await keepStorage(recoverer);
};

// ------------------------------------------------------------------ the run

const steps = async (): Promise<void> => {
  let recoverer: Device;
  let next: Device | undefined;
  if (from === 1) {
    const reached = await firstSteps(theCourse, noShot, async (old) => keepStorage(old), firstUse ? { balance: SMALL.balance, receive: SMALL.receive } : undefined);
    if (reached === undefined) return;
    const { old } = reached;
    recoverer = reached.recoverer;
    kept.fundsAddress = await valueOf(recoverer.page, 'funds-address').catch(() => '');
    save();
    if (firstUse) {
      timed('steps 1 to 3 up to the payment received');
      await picture(old.page, 'wallet-home');
      await payOut(old);
      await keepStorage(old);
      await keepStorage(recoverer);
      timed('the payment out of the wallet');
      // What the phone's browser sends, timed: the records it gives the backup stores and the transactions it gives the network.
      watchSending(old);
    }

    // 4 ------------------------------------------------------------------
    if (!begin('The owner connects the wallet to the Savings Jar page and opens a jar from it; the wallet lists it')) return;
    const oldJar = await old.context.newPage();
    watchPage('old-phone, jar tab', oldJar);
    await connect(old.page, oldJar);
    await chainShows(oldJar.getByText(/^No jars (yet|to show)\./), 'the Savings Jar page to look for jars', LIMIT.read);
    log(`   the jar page lists: "${await textOf(oldJar.locator('.card').filter({ hasText: 'Your jars' }).locator('p'))}"`);
    const clock = await chainClock();
    const now = Math.floor(Date.now() / 1000);
    log(`   the chain's clock: last block ${iso(clock.tip)}, median time ${iso(clock.median)}; this machine ${iso(now)}`);
    if (firstUse) {
      // The smallest first amount the page takes, and the soonest of the dates it offers to choose.
      await oldJar.locator('#jar-amount').fill((SMALL.jar / 1e8).toFixed(8).replace(/0+$/, ''));
      await oldJar.getByRole('button', { name: '10 minutes', exact: true }).click();
      const chosen = await oldJar.locator('#jar-date').inputValue();
      kept.unlockTime = await oldJar.evaluate((value) => Math.floor(new Date(value).getTime() / 1000), chosen);
      log(`   the date: "10 minutes", the soonest the page offers to choose, gives ${chosen} in the browser's time zone (${iso(kept.unlockTime)}); the hint says "${await textOf(oldJar.locator('#jar-date ~ .hint'))}"`);
    } else {
      // The date: some minutes ahead of the chain's clock and of this machine's, so that it is still ahead after the
      // waiting period of the takeover has moved the chain's clock on.
      kept.unlockTime = Math.ceil((Math.max(now, clock.tip, clock.median) + 25 * 60) / 60) * 60;
      const local = await oldJar.evaluate((seconds) => {
        const date = new Date(seconds * 1000);
        return [date.getFullYear(), '-', date.getMonth() + 1, '-', date.getDate(), 'T', date.getHours(), ':', date.getMinutes()].map((part) => (typeof part === 'number' && part < 10 ? `0${part}` : String(part))).join('');
      }, kept.unlockTime);
      await oldJar.locator('#jar-amount').fill('0.0003');
      await oldJar.locator('#jar-date').fill(local);
    }
    save();
    await see(oldJar, /stays in the jar until/);
    log(`   the form says: "${await textOf(oldJar.locator('.summary'))}" (the date ${iso(kept.unlockTime)})`);
    await click(oldJar, 'Open the jar');
    await see(oldJar, 'On its way');

    const request = old.page.locator('.request-card').filter({ hasText: 'asks for your decision' }).first();
    await pageShows(request, 'the wallet to show the Savings Jar page\'s request');
    const approve = request.getByRole('button', { name: 'Approve' });
    await pageShows(approve, 'Approve on the request');
    await untilPage(() => approve.isEnabled(), 'Approve enabled on the request');
    const first = await textOf(request);
    await picture(old.page, 'open-review');
    await openFolds(request);
    log(`   the wallet's review of the page's request, every fold opened: "${await textOf(request)}"`);
    fact(`Opening the jar, the wallet showed the page's request with its own figures before anything was signed. With its folds closed, as it first appears: "${first}"`);
    const blobsBefore = storeBlobs();
    log('   about to approve: the wallet writes its records to the backup stores, then signs the opening of the jar and sends it');
    const approvedAt = Date.now();
    await click(old.page, /^Approve$/);
    const done = old.page.locator('.request-card').filter({ hasText: 'Done:' }).first();
    await pageShows(done, '"Done:" after approving the opening of the jar');
    const doneAt = Date.now();
    const opened = (await done.getByTestId('action-transaction').getAttribute('data-value')) ?? '';
    label(opened, `The owner's phone opens the jar, on the Savings Jar page's request (${(firstUse ? SMALL.jar : 30_000).toLocaleString('en-US')} sat into the jar, the key to the wallet)`);
    log(`   approved; the wallet: "${await textOf(done.locator('h2, .card-title'))}", transaction ${opened}`);
    await see(oldJar, 'The jar is open. Its key is in your wallet.');
    const item = oldJar.getByTestId('jar').first();
    await pageShows(item, 'the jar in the Savings Jar page\'s list');
    log(`   the jar page: "The jar is open. Its key is in your wallet."; the jar: ${await textOf(item.locator('.jar-top'))}, "${await textOf(item.locator('.jar-when'))}"`);
    await picture(oldJar, 'page-opened');
    mine(1);

    // The jar in the wallet's own list, from the record it wrote before signing.
    await old.page.goto(`${WALLET}apps`);
    const position = old.page.getByTestId('position-open').first();
    await chainShows(position, 'the wallet to list the jar from its record, read against the chain', LIMIT.read);
    kept.category = (await position.locator('.token-id [title]').first().getAttribute('title')) ?? '';
    if (!/^[0-9a-f]{64}$/.test(kept.category)) throw new Error(`the key's category could not be read: ${kept.category}`);
    const made = savingsJarScript(hexToBin(kept.category), kept.unlockTime).lockingBytecode;
    kept.jarAddress = addressOf(Buffer.from(made).toString('hex'));
    save();
    const row = await textOf(position);
    log(`   the wallet's list: "${row}"; key ${kept.category}`);
    fact(`On the owner's phone the wallet listed the jar from its own record: "${row}". The jar's key is \`${kept.category}\`; the jar's date ${iso(kept.unlockTime)}; its address \`${kept.jarAddress}\` (transaction \`${opened}\`).`);
    await picture(old.page, 'positions-owner');
    if (firstUse) {
      await keepStorage(old);
      await positionRecordRead(blobsBefore, approvedAt, doneAt, opened);
      timed('step 4, the jar opened and listed');
      return;
    }

    // 5 ------------------------------------------------------------------
    if (!begin('The phone is lost')) return;
    await close(old);
    log('   the old phone\'s profile, with its wallet tab and its Savings Jar tab, is no longer opened');
  } else {
    log(`   the jar: key ${kept.category}, date ${iso(kept.unlockTime)}, address ${kept.jarAddress}`);
    recoverer = await device('recoverer', false);
    state.step = from === 5 ? 4 : from - 1;
    if (from === 5 && begin('The phone is lost')) log('   the old phone\'s profile is not opened again');
    if (from > 6) {
      next = await device('new-phone', false);
      requests.watch(next.context);
      // What the new phone's wallet shows before anything is done, and what a stopped part left on it.
      await next.page.goto(`${WALLET}apps`);
      await theCourse.lookAround();
      await clearLeftovers(next.page, log);
    } else await theCourse.lookAround();
  }

  // 6 ------------------------------------------------------------------
  if (next === undefined) {
    if (!begin(requestOnly ? 'A new phone asks Anna to move the wallet; her page sends the request, and it goes into a block' : 'A new phone takes the wallet over with Anna\'s help, and sweeps')) return;
    if (from === 6) {
      next = await device('new-phone', false);
      requests.watch(next.context);
      log('   the request was sent by the part that stopped; the new phone\'s profile and Anna\'s page are opened again where they were');
      await completeTakeover(theCourse, recoverer, next, noShot, true);
    } else if (requestOnly) {
      next = await device('new-phone');
      requests.watch(next.context);
      await requestHeld(recoverer, next);
      return;
    } else {
      next = await device('new-phone');
      requests.watch(next.context);
      await newPhoneAsks(theCourse, recoverer, '', noShot, next);
      await completeTakeover(theCourse, recoverer, next, noShot);
    }
    await keepStorage(next);
  }
  const phone = next;

  // 7 ------------------------------------------------------------------
  if (state.step < 7) {
    if (!begin('The new phone trusts the template from the backup and lists the jar from its record, confirmed')) return;
    await phone.page.goto(`${WALLET}apps`);
    const swept = keyRow(phone.page);
    const trust = swept.getByRole('button', { name: 'Trust this template' });
    await chainShows(trust, 'the new phone to list the swept key, read from the chain, with "Trust this template"', LIMIT.read);
    const before = await textOf(swept);
    log(`   the Applications screen lists the swept key: "${before}"`);
    fact(`On the new phone, after the recovery, the wallet listed the swept key as a token of a template it does not trust yet: "${before}".`);
    await picture(phone.page, 'new-phone-untrusted');
    await trust.click();
    await see(phone.page, 'A template from your backup');
    const offered = await textOf(phone.page.locator('.request-card').first());
    log(`   "A template from your backup": "${offered.slice(0, 600)}"`);
    await picture(phone.page, 'trust-from-backup');
    await click(phone.page, 'Trust this template');
    const position = phone.page.getByTestId('position-open').filter({ has: phone.page.locator(`.token-id [title="${kept.category}"]`) });
    await chainShows(position, 'the new phone to list the jar from its record, checked against the chain', LIMIT.read);
    const listed = await textOf(position);
    log(`   trusted; the wallet's list: "${listed}"`);
    fact(`Once the user trusted the template the earlier owner had stored, the new phone checked the record against the chain and listed the jar from it as open: "${listed}". The actions it offers: ${(await position.locator('.token-actions button:not(.info-button):not(.hex)').allInnerTexts()).map((text) => `"${flat(text)}"`).join(', ')}.`);
    await picture(phone.page, 'positions-after-recovery');
  }

  // 8 ------------------------------------------------------------------
  if (state.step < 8) {
    if (!begin('The jar\'s date passes; the new phone empties the jar from its own list, the jar page never opened')) return;
    const clock = await chainClock();
    if (!publicChain && clock.median <= kept.unlockTime) log(`   ${passTime(kept.unlockTime - clock.tip + 120)}`);
    // On chipnet and mainnet the chain's clock passes the date by itself, as blocks come.
    if (publicChain && clock.median <= kept.unlockTime) log(`   the chain's median time is ${iso(clock.median)}; waiting for it to pass the jar's date ${iso(kept.unlockTime)}`);
    if (publicChain) {
      const left = Math.max(0, kept.unlockTime - clock.median) * 1000;
      await untilChain(`the chain's median time to pass the jar's date ${iso(kept.unlockTime)} (it trails the blocks' times by about six blocks)`, left + 20 * 60_000, async () => (await chainClock()).median > kept.unlockTime, 15_000);
    }
    log(`   the chain's median time is ${iso((await chainClock()).median)}, past the jar's date ${iso(kept.unlockTime)}`);
    await phone.page.goto(`${WALLET}apps`);
    const position = phone.page.getByTestId('position-open').filter({ has: phone.page.locator(`.token-id [title="${kept.category}"]`) });
    await chainShows(position, 'the new phone to list the jar as open, from its record checked against the chain', LIMIT.read);
    await position.getByRole('button', { name: 'Empty a savings jar', exact: true }).click();
    const review = phone.page.locator('.request-card').filter({ hasText: 'Check and carry out' }).first();
    await pageShows(review, 'the review "Check and carry out" after "Empty a savings jar"');
    const carry = review.getByRole('button', { name: 'Carry it out' });
    await pageShows(carry, '"Carry it out" on the review');
    await untilPage(() => carry.isEnabled(), '"Carry it out" enabled');
    const reviewed = await textOf(review);
    await picture(phone.page, 'empty-review');
    await openFolds(review);
    log(`   "Empty a savings jar", from the wallet's own list, every fold opened: "${await textOf(review)}"`);
    fact(`From its own list the new phone offered "Empty a savings jar" and showed its review, every value from the record or the wallet itself. With its folds closed: "${reviewed}"`);
    await click(phone.page, 'Carry it out');
    const outcome = phone.page.getByText(/^(Done|Not carried out)$/).first();
    await pageShows(outcome, '"Done" or "Not carried out" after "Carry it out"');
    if ((await outcome.innerText()).trim() !== 'Done') throw new Error(`the jar was not emptied: ${await textOf(phone.page.locator('.refused-card'))}`);
    const emptied = (await phone.page.getByTestId('action-transaction').first().getAttribute('data-value')) ?? '';
    label(emptied, 'The new phone empties the jar by itself, from its own list (the key at input 0, the key and the savings to the new seed)');
    log(`   done: ${emptied}`);
    await picture(phone.page, 'emptied-done');
    await click(phone.page, 'Back to the tokens');
    mine(1);
    const closed = phone.page.getByTestId('position-closed').filter({ has: phone.page.locator(`.token-id [title="${kept.category}"]`) });
    let asked = 0;
    await untilChain('the wallet\'s list to show the jar closed, once the server has the emptying', LIMIT.read, async () => {
      if (await closed.isVisible()) return true;
      if (asked++ % 2 === 0) await phone.page.getByRole('button', { name: 'Read again' }).click({ timeout: 2_000 }).catch(() => undefined);
      return false;
    }, 1_000);
    log(`   the wallet's list: "${await textOf(closed)}"`);
    await picture(phone.page, 'positions-emptied');
    const toJar = requests.urls().filter((url) => url.startsWith(JAR_ORIGIN));
    if (toJar.length > 0) throw new Error(`the new phone asked the Savings Jar page: ${toJar.join(', ')}`);
    fact(`The jar was emptied by the new phone from its own list of positions (transaction \`${emptied}\`), with the Savings Jar page never opened on it: of the ${requests.urls().length} requests its browser made up to then, none went to the jar page's origin ${JAR_ORIGIN}. The list then showed the jar as "${await textOf(closed.locator('.pill'))}", "${await textOf(closed.locator('.token-body p').first())}".`);
  }

  // 9 ------------------------------------------------------------------
  if (!begin('The coins go back to where they came from')) return;
  const to = elsewhere();
  await phone.page.goto(`${WALLET}send`);
  await phone.page.getByLabel('To').fill(to);
  await reviewEverything(phone.page);
  const everything = phone.page.getByText('Arrives', { exact: true });
  const nothing = phone.page.getByText('Too little to send');
  await pageShows(everything.or(nothing), 'the review of sending everything, or "Too little to send"');
  if (await everything.isVisible()) {
    await click(phone.page, /^Send$/);
    await see(phone.page, 'Sent');
    log(`   the new phone sent everything to ${to}; tokens stay where they are, so the jar's key stays in the wallet`);
  } else log('   the wallet has nothing left to send');
  mine(1);
  await openDeskWorking(theCourse, recoverer);
  const returned = await sendAllOfBalance(recoverer.page, to);
  log(returned === undefined ? '   Anna\'s balance holds nothing' : `   Anna sent her balance back: ${returned}`);
  mine(1);
  await keepStorage(phone);
};

// ------------------------------------------------------------------ the record

/** How the later part goes on from what the first part left on disk: said in the record of a first use. */
const laterPart = (): string[] => [
  '## How the later part goes on',
  '',
  `Everything of the run is in its folder${mainnet ? ' (`.mainnet/runs/first/` of the main checkout, not in git)' : ''}, written before any coin was sent to an address it controls:`,
  '',
  '- `profiles/recoverer/`: the recoverer\'s browser profile (Anna\'s page: her balance, her key for the wallet and its kit); `storage-recoverer.json`: a copy of what her page keeps, her balance\'s words among it.',
  '- `profiles/old-phone/`: the owner\'s phone, with the wallet page and the Savings Jar page as a second tab; `storage-old-phone.json`: a copy of what both pages keep, the wallet\'s words and its archive key among it.',
  '- `store1/`, `store2/`: the two backup stores\' data (the wallet\'s sealed records: the recoverer\'s receipt, the template, the jar\'s position record).',
  '- `run-key.json`: the run\'s key, emptied back to the funding address. `config.json`: the configuration the pages were served with. `jar.json`: what the course knows between its parts (the jar\'s key, date and address, the transactions\' names). `log.txt`, `console.txt`, `blocks.json`, `requests.json`: what the run said.',
  '',
  `What a page keeps in a browser is kept by the page's address, so the later part serves the pages and stores at the same addresses: ${WALLET}, ${RECOVERER}, ${JAR}, and the stores ${config.stores.join(' and ')} with their data in \`store1/\` and \`store2/\`. The course does that by itself with the same folder.`,
  '',
  `The wallet's waiting period is what the recoverer's page proposed, ${mainnet ? '169 steps of 512 seconds, about a day' : 'one step of 512 seconds on a test network'}: a recovery completes only after it has passed on the chain's clock, counted from the block that holds the request. It can be changed only by the owner's phone, with an update of the controller's settings (the contract's \`ownerUpdate\`, which the wallet makes once the recoverer's prepared receipt for the change is on the backup stores); the wallet page offers no screen for changing it today, so it was not changed.`,
  '',
  'Two ways on:',
  '',
  '- Emptying the jar without a recovery: open the owner\'s phone\'s profile with the pages served as above; once the chain\'s median time has passed the jar\'s date, the wallet\'s Applications screen offers "Empty a savings jar" on the jar\'s row. No course step does this alone today.',
  `- The recovery with the jar open, then the emptying from the new phone: \`npx tsx scripts/stage-17-jar-browser.ts ${mainnet ? 'mainnet --folder <the run\'s folder> --funder <funding key file>' : 'local --directory <the run\'s directory>'} --from 5 --screens --record <a new record> --within <minutes>\`. Step 5 leaves the owner's phone closed; step 6 makes a new phone, which asks Anna, and her page sends the request from her balance; the waiting period runs (\`--within\` has to cover it${mainnet ? ': more than 1,440 minutes for about a day' : ''}); she completes the move and the new phone sweeps the coins; step 7 trusts the template from the backup and lists the jar; step 8 waits for the chain's median time to pass the jar's date and empties the jar from the wallet's own list; step 9 sends the wallet's coins and Anna's balance back to the funding address${mainnet ? '. This continuation has not been run on mainnet' : ''}.`,
  '',
];

/** The record of a first use: what was done and shown, every transaction, where every coin is, and how the later part goes on. */
const firstUseRecord = (outcome: string, ledger: string[]): string[] => {
  const folder = work.startsWith(root) ? work.slice(root.length) : work;
  const ports = `the wallet ${WALLET}, the recoverer ${RECOVERER}, the Savings Jar ${JAR}, the backup stores ${config.stores.join(' and ')}`;
  const command = `npx tsx scripts/stage-17-jar-browser.ts ${kept.command ?? ''}`.trim();
  const cleanCommand = command.replace(/--funder \S+/, '--funder <funding key file>').replace(/--folder \S+/, '--folder <the run\'s folder>');
  return [
    mainnet ? '# The first use of the wallet on mainnet: a recoverer, a payment in and out, and a Savings Jar left open' : '# The first use of the wallet, proved on the local node: a recoverer, a payment in and out, and a Savings Jar left open',
    '',
    `Written by \`${cleanCommand}\` on ${new Date(kept.startedAt ?? started).toISOString().slice(0, 16).replace('T', ' ')} UTC. Chromium (Playwright), one browser profile per device kept on disk under \`${mainnet ? '<the run\'s folder>' : folder}\`; the Savings Jar page is a second tab of the phone that uses it. The pages are this checkout's production builds served on this machine by \`deploy/serve.mjs\` with the content security policy, at ${ports}, ${mainnet ? `with \`deploy/config/mainnet.example.json\` and this machine's addresses (\`"network": "mainnet"\`, \`"mainnetEnabled": true\`), against mainnet's servers ${config.chain.join(', ')}, with a relay on this machine for the sessions between the pages. Each page's statement about mainnet was confirmed once per browser as a person would. Blocks and the chain's clock took their real time; nothing waited for a block.` : 'against the regtest node, with a relay on this machine. The run made the blocks.'} Times in the log are seconds since the start.`,
    '',
    `The steps are those of the Savings Jar course in its first use (\`--first-use\`${mainnet ? ', implied on mainnet' : ''}): the recoverer keeps the waiting period and starting balance her page proposes; the amounts are small; the owner receives and pays a small amount out; a jar is opened with the smallest first amount the Savings Jar page takes and the soonest date it offers; the run stops there. The wallet is not closed and its coins are not returned: the wallet, its jar and the recoverer's kit are where the later part starts. Only what was left at the run's key went back to the funding address.`,
    '',
    `Outcome: ${outcome}`,
    ...(kept.continued.length === 0 ? [] : ['', ...kept.continued]),
    '',
    'What the run showed:',
    '',
    ...kept.facts.map((line) => `- ${line}`),
    '',
    ...((kept.positionRecord ?? []).length === 0 ? [] : ['## The position record, before signing', '', ...(kept.positionRecord ?? []).map((line) => `- ${line}`), '']),
    ...((kept.durations ?? []).length === 0 ? [] : ['## How long each part took', '', ...(kept.durations ?? []).map((line) => `- ${line}`), '']),
    '## The jar\'s date on the chain',
    '',
    kept.unlockTime === 0
      ? 'No jar was opened.'
      : `The jar's date is ${iso(kept.unlockTime)}. The network accepts emptying it once the median time of the last eleven blocks has passed that date${mainnet ? ', which on mainnet trails the wall clock by about an hour: about ' + iso(kept.unlockTime + 3_600) + ', give or take the blocks\' times' : ''}. Before then the wallet's "Empty a savings jar" is refused by the network.`,
    '',
    '## Transactions and coins',
    '',
    `Read from ${mainnet ? 'mainnet\'s server' : 'the local node'} after the run: every transaction in the blocks after height ${kept.startHeight}, where the run started, or not yet in a block, that touches an address of the run (the run's own key, the wallet's addresses, its controller, the jar and the recoverer's balance). The fee is what the inputs held less what the outputs hold; the size is that of the transaction as sent.`,
    '',
    ...ledger,
    ...(kept.fundingBefore === undefined ? [] : [`The funding address: before the run ${kept.fundingBefore}; after it ${kept.fundingAfter ?? '(not read)'}.`, '']),
    ...(kept.screens.length === 0 ? [] : ['## Pictures', '', `In \`docs/screens/\`, each at 390×844 (\`-phone\`) and 1280×800 (\`-desktop\`): ${kept.screens.map((name) => `\`${prefix}-${name}\``).join(', ')}.`, '']),
    ...laterPart(),
    '## Log',
    '',
    '```',
    ...lines,
    '```',
    '',
  ];
};

const writeRecord = async (outcome: string): Promise<void> => {
  kept.outcome = outcome;
  save();
  // On chipnet the wallet is closed after the run (scripts/close-run-wallet.ts), which writes its line beside the profiles.
  const closing = existsSync(`${work}closing.txt`) ? readFileSync(`${work}closing.txt`, 'utf8').trim() : '';
  // Every transaction of the run, read from the chain, and whose each coin is.
  const wallet = walletKept(work, ['old-phone', 'new-phone'], WALLET);
  const places = await walletPlaces(wallet, firstPart ? { 'old-phone': 'an address of the wallet (the owner\'s phone\'s seed)' } : undefined);
  const identity = wallet.identity;
  const controller = identity === undefined ? '' : Buffer.from(controllerScript(hexToBin(identity)).lockingBytecode).toString('hex');
  const jarLocking = kept.category === '' ? '' : Buffer.from(savingsJarScript(hexToBin(kept.category), kept.unlockTime).lockingBytecode).toString('hex');
  const outside = (() => {
    try {
      return lockingOf(elsewhere());
    } catch {
      return '';
    }
  })();
  const funds = kept.fundsAddress === '' ? '' : lockingOf(kept.fundsAddress);
  const payer = localPayerLocking();
  const ownKey = theCourse.keyLocking();
  // On chipnet the run's transactions are found from the run's own addresses.
  // The funding address is not read: others use it too, and what it paid the run is found through the run's addresses.
  const ledger = await runTransactions(kept.startHeight, [...places.keys(), controller, jarLocking, funds, ownKey]);
  for (const entry of wallet.activity) label(entry.transactionId, `${entry.who === 'old-phone' ? 'The owner\'s phone' : 'The new phone'}: ${entry.what}`);
  const placeOf = (lockingBytecode: string): string | undefined =>
    lockingBytecode === controller ? 'the wallet\'s controller (its identity token)' : lockingBytecode === jarLocking ? 'the jar' : lockingBytecode === outside ? (mainnet ? `the funding address (${addressOf(outside)})` : `the outside address the coins went back to (${addressOf(outside)})`) : lockingBytecode === funds ? 'the recoverer\'s balance' : lockingBytecode === ownKey ? 'the run\'s own key (`scripts/run-key.ts`)' : lockingBytecode === payer ? (chipnet ? 'the funding address (`scripts/chipnet-pay.ts`)' : 'the local payer (`scripts/local-pay.ts`)') : places.get(lockingBytecode);
  const ofController = await controllerLabels(identity);
  const labelOf = (transaction: LedgerTransaction): string | undefined => {
    const named = kept.labels[transaction.transactionId] ?? ofController.get(transaction.transactionId);
    if (named !== undefined) return named;
    const touches = (lockingBytecode: string): boolean => lockingBytecode !== '' && (transaction.inputs.some((input) => input.lockingBytecode === lockingBytecode) || transaction.outputs.some((output) => output.lockingBytecode === lockingBytecode));
    const fromFunds = funds !== '' && transaction.inputs.some((input) => input.lockingBytecode === funds);
    if (touches(controller) && fromFunds) return 'The recoverer: a transaction of the controller paid from her balance (the wallet\'s creation, the request or the completion)';
    if (touches(controller)) return 'A transaction of the controller';
    if (fromFunds && transaction.outputs.some((output) => output.lockingBytecode === outside)) return 'The recoverer sends her balance back';
    if (fromFunds) return 'Paid from the recoverer\'s balance';
    if (ownKey !== '' && transaction.inputs.some((input) => input.lockingBytecode === ownKey)) {
      if (transaction.outputs.some((output) => output.lockingBytecode === outside)) return 'The run\'s key sends what it holds back to the funding address';
      if (funds !== '' && transaction.outputs[0]?.lockingBytecode === funds) return 'The run\'s key pays the recoverer\'s balance';
      if (places.has(transaction.outputs[0]?.lockingBytecode ?? '')) return 'The run\'s key pays the owner\'s wallet';
      return 'The run\'s key pays';
    }
    // Every coin in and out the wallet's own: it pays itself, for a coin a new token can be made from.
    if (transaction.inputs.every((input) => places.has(input.lockingBytecode)) && transaction.outputs.every((output) => places.has(output.lockingBytecode))) return 'The wallet pays itself (a coin that can start a new token: the jar\'s key)';
    if (transaction.inputs.some((input) => input.lockingBytecode === payer)) return publicChain ? 'The funding address pays the run\'s key' : 'The local payer pays the run\'s key';
    return undefined;
  };
  const toJarPage = requests.urls().filter((url) => url.startsWith(JAR_ORIGIN));
  const served = (kept.served ?? []).length === 0 ? '' : ` ${(kept.served ?? []).join(' Then, for the part that continued: ')}`;
  if (firstPart) {
    writeFileSync(recordFile(`first-use-jar-browser-${where}.md`), firstUseRecord(outcome, ledgerSection(ledger, labelOf, placeOf)).join('\n'));
    log(`record written to ${recordFile(`first-use-jar-browser-${where}.md`).slice(root.length)}`);
    return;
  }
  writeFileSync(
    recordFile(`stage-17-jar-browser-${where}.md`),
    [
      `# Stage 17 in browsers on ${chipnet ? 'chipnet (run G)' : mainnet ? 'mainnet' : 'the local node'}: the Savings Jar from its template alone, through the loss of a phone (PR19)`,
      '',
      `Written by \`scripts/stage-17-jar-browser.ts${(kept.command ?? '') === '' ? '' : ` ${kept.command}`}\` on ${new Date(kept.startedAt ?? started).toISOString().slice(0, 16).replace('T', ' ')} UTC. Chromium (Playwright), one browser profile per device kept on disk under \`${work.slice(root.length)}\`; the Savings Jar page is a second tab of the phone that uses it. ${chipnet ? pagesUsed([WALLET, RECOVERER, JAR], 'Blocks, the waiting period and the jar\'s date took their real time; the coins came from the funding address and went back to it.') : mainnet ? `The pages are this checkout's production builds served on this machine by \`deploy/serve.mjs\` with the content security policy at ${WALLET}, ${RECOVERER} and ${JAR}, with two backup stores and a relay for the sessions between the pages on this machine, against mainnet's servers ${config.chain.join(', ')}. Blocks, the waiting period and the jar's date take their real time.` : `The pages are this checkout's production builds (\`deploy/preview.sh build\`) served by \`deploy/serve.mjs\` with the content security policy at ${WALLET}, ${RECOVERER} and ${JAR}, against the regtest node, with two backup stores and a relay for the sessions between the pages, all on this machine. The run made the blocks and moved the chain's clock.`}${served} The wallet reads no recovery declaration: the Savings Jar reached it as its template of version 4, in the page's requests of \`xo_v1\` version 2. Times in the log are seconds since the start.`,
      '',
      `Outcome: ${outcome}`,
      ...(kept.continued.length === 0 ? [] : ['', ...kept.continued]),
      '',
      'What the run showed:',
      '',
      ...kept.facts.map((line) => `- ${line}`),
      '',
      '## The new phone\'s requests',
      '',
      ...requestsSection(requests, JAR_ORIGIN, 'the Savings Jar page', toJarPage),
      '## Transactions and coins',
      '',
      publicChain
        ? `Read from ${mainnet ? 'mainnet' : 'chipnet'}'s server after the run: every transaction in the blocks after height ${kept.startHeight}, where the run started, or not yet in a block, that touches an address of the run (the wallet's addresses of both phones' seeds, its controller, the jar and the recoverer's balance). The fee is what the inputs held less what the outputs hold; the size is that of the transaction as sent.`
        : `Read from the local node after the run: every transaction in the blocks after height ${kept.startHeight}, where the run started, or in the node's pool, that touches an address of the run (the run's own key, the wallet's addresses of both phones' seeds, its controller, the jar and the recoverer's balance), so that another run at the same time is left out. The fee is what the inputs held less what the outputs hold; the size is that of the transaction as sent.`,
      '',
      ...ledgerSection(ledger, labelOf, placeOf),
      ...(kept.screens.length === 0 ? [] : ['## Pictures', '', `In \`docs/screens/\`, each at 390×844 (\`-phone\`) and 1280×800 (\`-desktop\`): ${kept.screens.map((name) => `\`${prefix}-${name}\``).join(', ')}.`, '']),
      ...(closing === '' ? [] : ['## The wallet closed', '', closing, '']),
      '## Log',
      '',
      '```',
      ...lines,
      '```',
      '',
    ].join('\n'),
  );
  log(`record written to ${recordFile(`stage-17-jar-browser-${where}.md`).slice(root.length)}`);
};

try {
  if (!recordOnly && kept.command === undefined) {
    kept.command = process.argv.slice(2).join(' ');
    kept.startedAt = started;
    save();
  }
  if (recordOnly) {
    // The position record is read again from the stores' folders, where the run's part could not read it.
    if (firstPart && kept.approvedAt !== undefined && kept.doneAt !== undefined && kept.category !== '' && !(kept.positionRecord ?? []).some((line) => line.startsWith('The position record'))) {
      await positionRecordRead(undefined, kept.approvedAt, kept.doneAt, Object.keys(kept.labels).find((id) => /opens the jar/.test(kept.labels[id] ?? '')) ?? '');
    }
    await writeRecord(kept.outcome ?? 'not known');
    process.exit(0);
  }
  if (from > 1) {
    const line = `The run was continued from step ${from} on ${new Date(started).toISOString().slice(0, 16).replace('T', ' ')} UTC with the same browser profiles; the line "continued from step ${from}" in the log marks where, and the times after it count from then.`;
    kept.continued.push(line);
    save();
    theCourse.note(`       continued from step ${from}`);
  }
  await prepare(['wallet', 'recoverer', 'jar']);
  if (firstPart) {
    kept.fundingBefore = theCourse.fundingHolds();
    save();
  }
  if (from === 1) theCourse.fundRunKey();
  if (chipnet) {
    const now = await servedFrom([WALLET, RECOVERER, JAR]);
    if (!(kept.served ?? []).includes(now)) kept.served = [...(kept.served ?? []), now];
    save();
  }
  log(`   the run starts after block ${kept.startHeight}; the jar page is at ${JAR}, on ${config.network}`);
  await steps();
  if (firstPart) {
    const reached = state.step >= 4 && kept.category !== '';
    // Only what is left at the run's key goes back; the wallet, its jar and the recoverer's balance stay.
    if (reached) theCourse.returnCoins();
    kept.fundingAfter = theCourse.fundingHolds();
    save();
    log(`   the funding address: ${kept.fundingAfter}`);
    await writeRecord(reached ? 'stopped after step 4 with the jar open, as the first use asks; the wallet, its jar and the recoverer\'s balance stay, and what was left at the run\'s key went back to the funding address.' : `stopped after step ${Math.min(state.step, until)}, as asked; nothing was returned.`);
  } else {
    const all = state.step >= 9 && until >= 9;
    if (all) theCourse.returnCoins();
    await writeRecord(all ? (kept.continued.length > 0 ? 'every step was carried out, in parts with the same browser profiles (see below).' : 'every step was carried out.') : `stopped after step ${Math.min(state.step, until)}, as asked.`);
  }
} catch (error) {
  await theCourse.failed(error);
  kept.continued.push(`A part of the run stopped at step ${state.step}: "${String((error as Error).message).split('\n')[0]?.slice(0, 300)}".`);
  save();
  await writeRecord(`failed at step ${state.step}; see the last lines of the log.`).catch((problem: unknown) => log(`the record could not be written: ${(problem as Error).message}`));
  process.exitCode = 1;
} finally {
  await theCourse.end();
}
