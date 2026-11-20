// The Savings Jar course of stage 17 in browsers, on the local node (acceptance test PR19 of proposal v0.6, its
// local part): the wallet page, the recoverer page and the Savings Jar page of this checkout, driven as a person
// would. Each device is a browser profile of its own, kept on disk; the Savings Jar page is a second tab of the
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
//   npx tsx scripts/stage-17-jar-browser.ts [--screens] [--headed] [--until <step>] [--from 5|7|8|9] [--ports <base>]
//
// The pages, a relay and two backup stores are served on this machine on ports of the run's own (see
// scripts/browser-course.ts; 8301 to 8304, 8311 and 8312 unless --ports says otherwise). The run makes the blocks
// and moves the chain's clock. Profiles, the stores' data, the log and what the run knows between steps are under
// .local-runs/stage-17-jar-browser/. `--from` continues a run that stopped, with the profiles on disk.
//
// The record is written to docs/runs/stage-17-jar-browser-local-node.md; with --screens, pictures at 390x844 and
// 1280x800 go to docs/screens/ as live-jar-*.png.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

import { hexToBin } from '@bitauth/libauth';
import { controllerScript } from '@grandmas-wallet/core';
import { savingsJarScript } from '@grandmas-wallet/savings-jar';
import type { Locator, Page } from 'playwright';

import { type Device, JAR, RECOVERER, WALLET, argument, click, completeTakeover, config, course, firstSteps, newPhoneAsks, openDeskWorking, patience, recordFile, reviewEverything, root, see, sendAllOfBalance, valueOf, wait } from './browser-course.js';
import { type LedgerTransaction, addressOf, ledgerSection, localHeight, runTransactions } from './browser-ledger.js';
import { type RequestLog, controllerLabels, flat, localPayerLocking, lockingOf, openFolds, recordRequests, requestsSection, textOf, walletKept, walletPlaces } from './browser-live.js';

const until = Number(argument('until') ?? '99');
const from = Number(argument('from') ?? '1');
if (![1, 5, 7, 8, 9].includes(from)) throw new Error('A run continues from step 5, 7, 8 or 9.');
const theCourse = course({ directory: 'stage-17-jar-browser', continuing: from > 1, until });
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
}
const keptFile = `${work}jar.json`;
const kept: Kept =
  from > 1 && existsSync(keptFile)
    ? (JSON.parse(readFileSync(keptFile, 'utf8')) as Kept)
    : { startHeight: localHeight(), category: '', unlockTime: 0, jarAddress: '', fundsAddress: '', labels: {}, facts: [], continued: [], screens: [] };
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
  await shot(page, `live-jar-${name}`);
  if (!kept.screens.includes(name)) kept.screens.push(name);
  save();
};
const requests: RequestLog = recordRequests(`${work}requests.json`, from > 1);

// ------------------------------------------------------------------ reading the pages

const iso = (seconds: number): string => new Date(seconds * 1000).toISOString().replace('.000Z', 'Z');
const chainClock = (): { tip: number; median: number } => {
  const cli = (...parameters: string[]): string => theCourse.run(`${root}deploy/regtest/regtest.sh`, ['cli', ...parameters]);
  const header = JSON.parse(cli('getblockheader', cli('getbestblockhash'))) as { time: number; mediantime: number };
  return { tip: header.time, median: header.mediantime };
};

/** The row of the jar's key in the wallet's list, as a position from a record or as a token. */
const keyRow = (page: Page): Locator => page.locator('li.token').filter({ has: page.locator(`.token-id [title="${kept.category}"]`) });

/** Connect the wallet to the Savings Jar page open in another tab: the page's address is pasted into the wallet. */
const connect = async (wallet: Page, jarPage: Page): Promise<void> => {
  await jarPage.goto(JAR);
  const address = jarPage.locator('.value-text[data-value^="wiz:"]').first();
  await address.waitFor({ state: 'visible', timeout: 120_000 * patience });
  const uri = (await address.getAttribute('data-value')) ?? '';
  await see(jarPage, 'Waiting for your wallet.', 120_000);
  log(`   the Savings Jar page shows its connection address (${uri.length} characters) and waits for a wallet`);
  await wallet.goto(`${WALLET}apps`);
  await click(wallet, 'Paste a link instead');
  await wallet.getByLabel('Connection link').fill(uri);
  await click(wallet, /^Connect$/);
  const row = wallet.locator('ul.connections li').first();
  await row.getByText('Connected', { exact: true }).waitFor({ state: 'visible', timeout: 120_000 * patience });
  log(`   the wallet's Applications screen: "${await textOf(row.locator('.connection-name'))}", ${await textOf(row.locator('.small.muted'))}; "Connected"`);
  await see(jarPage, /Connected to /, 120_000);
  log(`   the Savings Jar page: "${await textOf(jarPage.locator('.status-title'))}"`);
};

// ------------------------------------------------------------------ the run

const steps = async (): Promise<void> => {
  let recoverer: Device;
  let next: Device | undefined;
  if (from === 1) {
    const reached = await firstSteps(theCourse, noShot, async (old) => keepStorage(old));
    if (reached === undefined) return;
    const { old } = reached;
    recoverer = reached.recoverer;
    kept.fundsAddress = await valueOf(recoverer.page, 'funds-address').catch(() => '');
    save();

    // 4 ------------------------------------------------------------------
    if (!begin('The owner connects the wallet to the Savings Jar page and opens a jar from it; the wallet lists it')) return;
    const oldJar = await old.context.newPage();
    watchPage('old-phone, jar tab', oldJar);
    await connect(old.page, oldJar);
    await see(oldJar, /^No jars (yet|to show)\./);
    log(`   the jar page lists: "${await textOf(oldJar.locator('.card').filter({ hasText: 'Your jars' }).locator('p'))}"`);
    // The date: some minutes ahead of the chain's clock and of this machine's, so that it is still ahead after the
    // waiting period of the takeover has moved the chain's clock on.
    const clock = chainClock();
    const now = Math.floor(Date.now() / 1000);
    kept.unlockTime = Math.ceil((Math.max(now, clock.tip, clock.median) + 25 * 60) / 60) * 60;
    save();
    log(`   the chain's clock: last block ${iso(clock.tip)}, median time ${iso(clock.median)}; this machine ${iso(now)}`);
    const local = await oldJar.evaluate((seconds) => {
      const date = new Date(seconds * 1000);
      return [date.getFullYear(), '-', date.getMonth() + 1, '-', date.getDate(), 'T', date.getHours(), ':', date.getMinutes()].map((part) => (typeof part === 'number' && part < 10 ? `0${part}` : String(part))).join('');
    }, kept.unlockTime);
    await oldJar.locator('#jar-amount').fill('0.0003');
    await oldJar.locator('#jar-date').fill(local);
    await see(oldJar, /stays in the jar until/);
    log(`   the form says: "${await textOf(oldJar.locator('.summary'))}" (the date ${iso(kept.unlockTime)})`);
    await click(oldJar, 'Open the jar');
    await see(oldJar, 'On its way');

    const request = old.page.locator('.request-card').filter({ hasText: 'asks for your decision' }).first();
    await request.waitFor({ state: 'visible', timeout: 120_000 * patience });
    const approve = request.getByRole('button', { name: 'Approve' });
    await approve.waitFor({ state: 'visible', timeout: 120_000 * patience });
    for (let attempt = 0; attempt < 120 && !(await approve.isEnabled()); attempt++) await wait(500);
    const first = await textOf(request);
    await picture(old.page, 'open-review');
    await openFolds(request);
    log(`   the wallet's review of the page's request, every fold opened: "${await textOf(request)}"`);
    fact(`Opening the jar, the wallet showed the page's request with its own figures before anything was signed. With its folds closed, as it first appears: "${first}"`);
    await click(old.page, /^Approve$/);
    const done = old.page.locator('.request-card').filter({ hasText: 'Done:' }).first();
    await done.waitFor({ state: 'visible', timeout: 180_000 * patience });
    const opened = (await done.getByTestId('action-transaction').getAttribute('data-value')) ?? '';
    label(opened, 'The owner\'s phone opens the jar, on the Savings Jar page\'s request (30,000 sat into the jar, the key to the wallet)');
    log(`   approved; the wallet: "${await textOf(done.locator('h2, .card-title'))}", transaction ${opened}`);
    await see(oldJar, 'The jar is open. Its key is in your wallet.', 120_000);
    const item = oldJar.getByTestId('jar').first();
    await item.waitFor({ state: 'visible', timeout: 120_000 * patience });
    log(`   the jar page: "The jar is open. Its key is in your wallet."; the jar: ${await textOf(item.locator('.jar-top'))}, "${await textOf(item.locator('.jar-when'))}"`);
    await picture(oldJar, 'page-opened');
    mine(1);

    // The jar in the wallet's own list, from the record it wrote before signing.
    await old.page.goto(`${WALLET}apps`);
    const position = old.page.getByTestId('position-open').first();
    await position.waitFor({ state: 'visible', timeout: 120_000 * patience });
    kept.category = (await position.locator('.token-id [title]').first().getAttribute('title')) ?? '';
    if (!/^[0-9a-f]{64}$/.test(kept.category)) throw new Error(`the key's category could not be read: ${kept.category}`);
    const made = savingsJarScript(hexToBin(kept.category), kept.unlockTime).lockingBytecode;
    kept.jarAddress = addressOf(Buffer.from(made).toString('hex'));
    save();
    const row = await textOf(position);
    log(`   the wallet's list: "${row}"; key ${kept.category}`);
    fact(`On the owner's phone the wallet listed the jar from its own record: "${row}". The jar's key is \`${kept.category}\`; the jar's date ${iso(kept.unlockTime)}; its address \`${kept.jarAddress}\` (transaction \`${opened}\`).`);
    await picture(old.page, 'positions-owner');

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
    }
  }

  // 6 ------------------------------------------------------------------
  if (next === undefined) {
    if (!begin('A new phone takes the wallet over with Anna\'s help, and sweeps')) return;
    next = await device('new-phone');
    requests.watch(next.context);
    await newPhoneAsks(theCourse, recoverer, '', noShot, next);
    await completeTakeover(theCourse, recoverer, next, noShot);
    await keepStorage(next);
  }
  const phone = next;

  // 7 ------------------------------------------------------------------
  if (state.step < 7) {
    if (!begin('The new phone trusts the template from the backup and lists the jar from its record, confirmed')) return;
    await phone.page.goto(`${WALLET}apps`);
    const swept = keyRow(phone.page);
    const trust = swept.getByRole('button', { name: 'Trust this template' });
    await trust.waitFor({ state: 'visible', timeout: 180_000 * patience });
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
    await position.waitFor({ state: 'visible', timeout: 180_000 * patience });
    const listed = await textOf(position);
    log(`   trusted; the wallet's list: "${listed}"`);
    fact(`Once the user trusted the template the earlier owner had stored, the new phone checked the record against the chain and listed the jar from it as open: "${listed}". The actions it offers: ${(await position.locator('.token-actions button:not(.info-button):not(.hex)').allInnerTexts()).map((text) => `"${flat(text)}"`).join(', ')}.`);
    await picture(phone.page, 'positions-after-recovery');
  }

  // 8 ------------------------------------------------------------------
  if (state.step < 8) {
    if (!begin('The jar\'s date passes; the new phone empties the jar from its own list, the jar page never opened')) return;
    const clock = chainClock();
    if (clock.median <= kept.unlockTime) log(`   ${passTime(kept.unlockTime - clock.tip + 120)}`);
    log(`   the chain's median time is ${iso(chainClock().median)}, past the jar's date ${iso(kept.unlockTime)}`);
    await phone.page.goto(`${WALLET}apps`);
    const position = phone.page.getByTestId('position-open').filter({ has: phone.page.locator(`.token-id [title="${kept.category}"]`) });
    await position.waitFor({ state: 'visible', timeout: 180_000 * patience });
    await position.getByRole('button', { name: 'Empty a savings jar', exact: true }).click();
    const review = phone.page.locator('.request-card').filter({ hasText: 'Check and carry out' }).first();
    await review.waitFor({ state: 'visible', timeout: 120_000 * patience });
    const carry = review.getByRole('button', { name: 'Carry it out' });
    await carry.waitFor({ state: 'visible', timeout: 120_000 * patience });
    for (let attempt = 0; attempt < 120 && !(await carry.isEnabled()); attempt++) await wait(500);
    const reviewed = await textOf(review);
    await picture(phone.page, 'empty-review');
    await openFolds(review);
    log(`   "Empty a savings jar", from the wallet's own list, every fold opened: "${await textOf(review)}"`);
    fact(`From its own list the new phone offered "Empty a savings jar" and showed its review, every value from the record or the wallet itself. With its folds closed: "${reviewed}"`);
    await click(phone.page, 'Carry it out');
    const outcome = phone.page.getByText(/^(Done|Not carried out)$/).first();
    await outcome.waitFor({ state: 'visible', timeout: 180_000 * patience });
    if ((await outcome.innerText()).trim() !== 'Done') throw new Error(`the jar was not emptied: ${await textOf(phone.page.locator('.refused-card'))}`);
    const emptied = (await phone.page.getByTestId('action-transaction').first().getAttribute('data-value')) ?? '';
    label(emptied, 'The new phone empties the jar by itself, from its own list (the key at input 0, the key and the savings to the new seed)');
    log(`   done: ${emptied}`);
    await picture(phone.page, 'emptied-done');
    await click(phone.page, 'Back to the tokens');
    mine(1);
    const closed = phone.page.getByTestId('position-closed').filter({ has: phone.page.locator(`.token-id [title="${kept.category}"]`) });
    for (let attempt = 0; attempt < 30 && !(await closed.isVisible()); attempt++) {
      await phone.page.getByRole('button', { name: 'Read again' }).click().catch(() => undefined);
      await wait(2_000);
    }
    await closed.waitFor({ state: 'visible', timeout: 60_000 * patience });
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
  await everything.or(nothing).first().waitFor({ state: 'visible', timeout: 120_000 * patience });
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

const writeRecord = async (outcome: string): Promise<void> => {
  // Every transaction of the run, read from the chain, and whose each coin is.
  const ledger = await runTransactions(kept.startHeight);
  const wallet = walletKept(work, ['old-phone', 'new-phone'], WALLET);
  const places = await walletPlaces(wallet);
  const identity = wallet.identity;
  const controller = identity === undefined ? '' : Buffer.from(controllerScript(hexToBin(identity)).lockingBytecode).toString('hex');
  const jarLocking = kept.category === '' ? '' : Buffer.from(savingsJarScript(hexToBin(kept.category), kept.unlockTime).lockingBytecode).toString('hex');
  const outside = lockingOf(elsewhere());
  const funds = kept.fundsAddress === '' ? '' : lockingOf(kept.fundsAddress);
  const payer = localPayerLocking();
  for (const entry of wallet.activity) label(entry.transactionId, `${entry.who === 'old-phone' ? 'The owner\'s phone' : 'The new phone'}: ${entry.what}`);
  const placeOf = (lockingBytecode: string): string | undefined =>
    lockingBytecode === controller ? 'the wallet\'s controller (its identity token)' : lockingBytecode === jarLocking ? 'the jar' : lockingBytecode === outside ? `the outside address the coins went back to (${addressOf(outside)})` : lockingBytecode === funds ? 'the recoverer\'s balance' : lockingBytecode === payer ? 'the local payer (`scripts/local-pay.ts`)' : places.get(lockingBytecode);
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
    if (transaction.inputs.some((input) => input.lockingBytecode === payer)) return 'The local payer pays';
    return undefined;
  };
  const toJarPage = requests.urls().filter((url) => url.startsWith(JAR_ORIGIN));
  writeFileSync(
    recordFile('stage-17-jar-browser-local-node.md'),
    [
      '# Stage 17 in browsers on the local node: the Savings Jar from its template alone, through the loss of a phone (PR19)',
      '',
      `Written by \`scripts/stage-17-jar-browser.ts${process.argv.slice(2).length === 0 ? '' : ` ${process.argv.slice(2).join(' ')}`}\` on ${new Date(started).toISOString().slice(0, 16).replace('T', ' ')} UTC. Chromium (Playwright), one browser profile per device kept on disk under \`${work.slice(root.length)}\`; the Savings Jar page is a second tab of the phone that uses it. The pages are this checkout's production builds (\`deploy/preview.sh build\`) served by \`deploy/serve.mjs\` with the content security policy at ${WALLET}, ${RECOVERER} and ${JAR}, against the regtest node, with two backup stores and a relay for the sessions between the pages, all on this machine. The run made the blocks and moved the chain's clock. The wallet reads no recovery declaration: the Savings Jar reached it as its template of version 4, in the page's requests of \`xo_v1\` version 2. Times in the log are seconds since the start.`,
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
      `Read from the local node after the run: every transaction in the blocks after height ${kept.startHeight}, where the run started, and in the node's pool. The fee is what the inputs held less what the outputs hold; the size is that of the transaction as sent.`,
      '',
      ...ledgerSection(ledger, labelOf, placeOf),
      ...(kept.screens.length === 0 ? [] : ['## Pictures', '', `In \`docs/screens/\`, each at 390×844 (\`-phone\`) and 1280×800 (\`-desktop\`): ${kept.screens.map((name) => `\`live-jar-${name}\``).join(', ')}.`, '']),
      '## Log',
      '',
      '```',
      ...lines,
      '```',
      '',
    ].join('\n'),
  );
  log(`record written to ${recordFile('stage-17-jar-browser-local-node.md').slice(root.length)}`);
};

try {
  if (from > 1) {
    const line = `The run was continued from step ${from} on ${new Date(started).toISOString().slice(0, 16).replace('T', ' ')} UTC with the same browser profiles; the line "continued from step ${from}" in the log marks where, and the times after it count from then.`;
    kept.continued.push(line);
    save();
    theCourse.note(`       continued from step ${from}`);
  }
  await prepare(['wallet', 'recoverer', 'jar']);
  log(`   the run starts after block ${kept.startHeight}; the jar page is at ${JAR}, on ${config.network}`);
  await steps();
  const all = state.step >= 9 && until >= 9;
  await writeRecord(all ? (kept.continued.length > 0 ? 'every step was carried out, in parts with the same browser profiles (see below).' : 'every step was carried out.') : `stopped after step ${Math.min(state.step, until)}, as asked.`);
} catch (error) {
  await theCourse.failed(error);
  kept.continued.push(`A part of the run stopped at step ${state.step}: "${String((error as Error).message).split('\n')[0]?.slice(0, 300)}".`);
  save();
  await writeRecord(`failed at step ${state.step}; see the last lines of the log.`).catch((problem: unknown) => log(`the record could not be written: ${(problem as Error).message}`));
  process.exitCode = 1;
} finally {
  await theCourse.end();
}
