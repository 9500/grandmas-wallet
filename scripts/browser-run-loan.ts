// The scripted run of stage 9 in a browser (PY02 and PY03): the wallet page, the recoverer page and the loan page
// of this checkout, served on this machine, driven as a person would, on chipnet with Paryon's deployment
// `chipnet-fast-periods-6`. Each device is a browser profile of its own, kept on disk; the loan page is a second
// tab of the phone that uses it.
//
//   1. the recoverer opens its page and gives its link       9. the page borrows 100 PUSD; the way out is proven
//   2. the owner creates a wallet with that recoverer        10. the page adds collateral; the way out is proven
//   3. the recoverer takes in the kit; recovery is on        11. the phone is lost, with the loan open
//   4. the owner receives                                    12. a new phone takes the wallet over and sweeps
//   5. the owner pairs the wallet with the loan page         13. the new phone finds the loan from the swept key
//   6. the page has the wallet make a loan key                   and the template from the backup
//   7. the page brings Paryon's contracts up to date         14. the new phone closes the loan from its own list
//      (only when they need it)                                  of tokens, the loan page not opened (PY03)
//   8. the wallet is paid for the loan; the course is        15. the coins go back to the address that paid
//      checked by script against Paryon's outputs
//
// The key and the contracts come first, paid from what the wallet received in step 4: anything wrong between the
// page and the wallet shows before the collateral is paid in.
//
// usage (from the repository's root), after `deploy/preview.sh build`:
//   npx tsx scripts/browser-run-loan.ts chipnet --local-pages [--screens] [--headed] [--until <n>] [--from <n>]
//
// Coins come from .chipnet/funder-design-2.json. Every profile, and the stores' data, are under
// .chipnet/browser-run-loan-chipnet/ (not in git). Before anything is paid to a wallet its words are written to
// wallets.json there, in the form scripts/run-e-template.ts reads with --state=; with it the loan can be checked
// and closed without the browser:
//   cd packages/app && npx tsx ../../scripts/run-e-template.ts chipnet --emergency-close [earlier|new] --state=../../.chipnet/browser-run-loan-chipnet/wallets.json
// --from <n> continues a run that stopped, from step 6 to 11 or 13 to 15, with the profiles on disk.
// The record is written to docs/runs/stage-9-browser-chipnet.md; with --screens, screenshots go to docs/screens/
// as loan-*.png and apps-loan-*.png.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

import { decodeTransactionBch, hexToBin } from '@bitauth/libauth';
import type { Locator, Page } from 'playwright';

import { borrowPlan } from '../apps/loan/src/loan.js';
import { generalProtocolsOracle, readMarket } from '../apps/loan/src/market.js';
import { Electrum } from '../packages/chipnet/src/electrum.js';
import { type Device, LOAN, RECOVERER, WALLET, argument, balanceOf, chipnet, click, completeTakeover, config, course, firstSteps, localPages, newPhoneAsks, openDesk, patience, root, see, valueOf, wait } from './browser-course.js';

if (!chipnet || !localPages) {
  console.error('The loan course runs on chipnet only, where Paryon\'s contracts are, with the pages of this checkout: npx tsx scripts/browser-run-loan.ts chipnet --local-pages');
  process.exit(2);
}
const until = Number(argument('until') ?? '99');
const from = Number(argument('from') ?? '1');
const RESUMABLE = [1, 6, 7, 8, 9, 10, 11, 13, 14, 15];
if (!RESUMABLE.includes(from)) throw new Error(`A run continues from one of the steps ${RESUMABLE.slice(1).join(', ')}.`);
const theCourse = course({ directory: 'browser-run-loan', continuing: from > 1, until });
const { work, started, lines, note, log, run, pay, prepare, device, watchPage, close, shot, state, begin, elsewhere } = theCourse;
const LOAN_ORIGIN = new URL(LOAN).origin;
const noShot = async (): Promise<void> => undefined;
const DEBT = 100_00n;
/** Collateral aimed at, at the lower of the stored price and the oracle's; the run takes less only down to the floor. */
const AIM_PERCENT = 125;
const FLOOR_PERCENT = 120;
/** Added to the loan in step 10. */
const ADD = '0.001';

// ------------------------------------------------------------------ what is kept on disk

/** The run's facts, in the form scripts/run-e-template.ts reads with --state=, and the course's own beside them. */
interface Kept {
  startedAt: string;
  words: { owner: string; next: string; credential: string };
  identity?: string;
  keyCategory?: string;
  steps: Record<string, unknown>;
  pending: Record<string, unknown>;
  finished: string[];
  log: unknown[];
  notes: string[];
  course: { funderAtStart?: string; percent?: number; transactions: { step: string; transactionId: string }[]; facts: string[]; continued: string[] };
}
const keptFile = `${work}wallets.json`;
const read = (): Kept => JSON.parse(readFileSync(keptFile, 'utf8')) as Kept;
if (from === 1 && existsSync(keptFile) && (read().identity !== undefined || read().words.owner !== '')) {
  console.error(`${keptFile} holds the words of a wallet from an earlier run. Continue it with --from, or move the file away first: its coins may still be there.`);
  process.exit(2);
}
let kept: Kept = from > 1 && existsSync(keptFile) ? read() : { startedAt: new Date(started).toISOString(), words: { owner: '', next: '', credential: '' }, steps: {}, pending: {}, finished: [], log: [], notes: [], course: { transactions: [], facts: [], continued: [] } };
const keep = (): void => {
  mkdirSync(work, { recursive: true });
  writeFileSync(keptFile, JSON.stringify(kept, null, 1), { mode: 0o600 });
};
keep();
const fact = (line: string): void => {
  kept.course.facts.push(line);
  keep();
};
const sent = (step: string, transactionId: string): void => {
  if (!kept.course.transactions.some((entry) => entry.transactionId === transactionId)) kept.course.transactions.push({ step, transactionId });
  keep();
};

const writeLog = (outcome: string): void => {
  mkdirSync(`${root}docs/runs`, { recursive: true });
  writeFileSync(
    `${root}docs/runs/stage-9-browser-chipnet.md`,
    [
      '# Stage 9 scripted run in a browser, on chipnet: a ParyonUSD loan from the loan page, through the loss of a phone',
      '',
      `Written by \`scripts/browser-run-loan.ts chipnet --local-pages\` on ${new Date(started).toISOString().slice(0, 16).replace('T', ' ')} UTC. Chromium (Playwright), one browser profile per device kept on disk under \`${work.slice(root.length)}\`; the loan page is a second tab of the phone that uses it. The pages are this checkout's production builds (\`deploy/preview.sh build\`), served on this machine by \`deploy/serve.mjs\` with the content security policy and \`deploy/config/local.json\`: the wallet at ${WALLET}, the recoverer at ${RECOVERER}, the loan page at ${LOAN} (it has no public address), and two backup stores of the run's own. They worked on chipnet, against Paryon's deployment \`chipnet-fast-periods-6\`, its contracts used unchanged. The wallet page and the loan page reached each other through the public WizardConnect relays (${config.relays?.join(', ') ?? 'as configured'}). The loan page is an independent demonstration, not Paryon's site. Times are seconds since the start.`,
      '',
      `Outcome: ${outcome}`,
      ...(kept.course.continued.length === 0 ? [] : ['', ...kept.course.continued]),
      '',
      ...(kept.course.facts.length === 0 ? [] : ['What the run showed:', '', ...kept.course.facts.map((line) => `- ${line}`), '']),
      ...(kept.course.transactions.length === 0 ? [] : ['Transactions:', '', '| Step | Transaction |', '| --- | --- |', ...kept.course.transactions.map((entry) => `| ${entry.step} | \`${entry.transactionId}\` |`), '']),
      '```',
      ...lines,
      '```',
      '',
    ].join('\n'),
  );
};

// ------------------------------------------------------------------ reading the pages

const flat = (text: string | null | undefined): string => (text ?? '').replace(/\s+/g, ' ').trim();
const textOf = async (locator: Locator): Promise<string> => flat(await locator.first().innerText());
const rows = (locator: Locator): Promise<string[]> =>
  locator.evaluate((element) =>
    Array.from(element.querySelectorAll(':scope > dl.kv > div, :scope dl.kv > div')).map((row) => {
      const name = (row.querySelector('dt')?.childNodes[0]?.textContent ?? row.querySelector('dt')?.textContent ?? '').trim();
      return `${name}: ${(row.querySelector('dd') as HTMLElement | null)?.innerText.replace(/\s+/g, ' ').trim() ?? ''}`;
    }),
  );
const movedItems = (locator: Locator): Promise<string[]> =>
  locator.evaluate((element) =>
    Array.from(element.querySelectorAll('.moved-group')).flatMap((group) => {
      const title = group.querySelector('.moved-title')?.textContent ?? '';
      const items = Array.from(group.querySelectorAll('li.moved')).map((item) => `${title}: ${(item as HTMLElement).innerText.replace(/\s+/g, ' ').trim()}`);
      return items.length > 0 ? items : [`${title}: ${(group as HTMLElement).innerText.replace(/\s+/g, ' ').trim().slice(title.length).trim()}`];
    }),
  );

/** What a review of an action shows: the template and the wallet's statement, the template's words, and the wallet's own figures. */
const readReview = async (card: Locator, who: string): Promise<{ figures: string[]; moved: string[] }> => {
  const template = await textOf(card.locator('.template-name'));
  const statement = await textOf(card.locator('.status-title'));
  log(`   ${who}: template "${template}", "${statement}"`);
  const firstUse = card.locator('.notice').filter({ hasText: /Approving (trusts|stores)/ });
  if ((await firstUse.count()) > 0) log(`   it says: "${await textOf(firstUse)}"`);
  const words = card.locator('.their-words');
  log(`   in the template's words: "${await textOf(words.locator('.quote-title'))}"; ${(await rows(words.locator('.quote'))).join('; ')}`);
  const own = card.locator('.own-figures');
  const figures = await own.evaluate((element) =>
    Array.from(element.querySelectorAll(':scope > dl.kv > div')).map((row) => `${(row.querySelector('dt')?.childNodes[0]?.textContent ?? '').trim()}: ${(row.querySelector('dd') as HTMLElement | null)?.innerText.replace(/\s+/g, ' ').trim() ?? ''}`),
  );
  log(`   the wallet's own figures: ${figures.join('; ')}`);
  const moved = await movedItems(own);
  for (const item of moved) log(`     ${item}`);
  for (const notice of await own.locator('.notice').all()) log(`     "${flat(await notice.innerText())}"`);
  return { figures, moved };
};

/** The token row of the loan key on the wallet's Applications screen. */
const keyRow = (page: Page, category: string): Locator => page.locator('li.token').filter({ has: page.locator(`.token-id [title="${category}"]`) });

/** A request of the loan page, as the wallet shows it: read, pictured, approved; the transaction it sent. */
const approve = async (wallet: Page, what: string, screen?: string): Promise<{ transactionId: string; figures: string[]; moved: string[] }> => {
  const request = wallet.locator('.request-card').filter({ hasText: 'asks for your decision' }).first();
  await request.waitFor({ state: 'visible', timeout: 180_000 * patience });
  await request.getByText('This wallet\'s own figures').waitFor({ state: 'visible', timeout: 180_000 * patience });
  log(`   the wallet's Applications screen: "${await textOf(request.locator('h2, .card-title'))}"`);
  const review = await readReview(request, what);
  if (screen !== undefined) await shot(wallet, screen);
  await click(wallet, /^Approve$/);
  const finished = wallet.locator('.request-card').filter({ hasText: /(Done|Not carried out): / }).first();
  await finished.waitFor({ state: 'visible', timeout: 300_000 * patience });
  const title = await textOf(finished.locator('h2, .card-title'));
  if (!title.startsWith('Done')) throw new Error(`${what} was not carried out: ${await textOf(finished.locator('.failure'))}`);
  const transactionId = (await finished.getByTestId('action-transaction').getAttribute('data-value')) ?? '';
  log(`   approved; the wallet: "${title}", transaction ${transactionId}`);
  await finished.getByRole('button', { name: 'Dismiss' }).click();
  return { transactionId, ...review };
};

/** The way out, proven by script from the words on disk: the closing built, checked and tried on the node, not sent. */
const wayOut = async (which: 'earlier' | 'new', when: string): Promise<void> => {
  let proven: string | undefined;
  let output = '';
  // A server may list the loan's newest outputs a little after it took the transaction: tried a few times.
  for (let attempt = 1; attempt <= 6 && proven === undefined; attempt++) {
    if (attempt > 1) await wait(20_000);
    output = execFileSync('npx', ['tsx', '../../scripts/run-e-template.ts', 'chipnet', '--emergency-close', which, '--prove', `--state=${keptFile}`], { cwd: `${root}packages/app`, encoding: 'utf8' });
    proven = output.split('\n').find((line) => line.includes('PROVEN'));
  }
  if (proven === undefined) throw new Error(`the way out could not be proven ${when}: ${output.trim().split('\n').slice(-3).join(' ')}`);
  log(`   the way out ${when}: ${proven.trim()}`);
  fact(`The way out was proven ${when}, from the ${which === 'earlier' ? 'first phone\'s' : 'new phone\'s'} words on disk and the chain alone, without the browser: ${proven.trim().replace(/^PROVEN: /, '')}.`);
  kept = read();
};

const electrum = async <T>(work: (server: Electrum) => Promise<T>): Promise<T> => {
  const server = await Electrum.connect('wss://chipnet.9500.cash:443');
  try {
    return await work(server);
  } finally {
    await server.disconnect().catch(() => undefined);
  }
};
const funderBalance = (): bigint => BigInt(/^(\d+) satoshis/.exec(run('npx', ['tsx', 'scripts/chipnet-pay.ts', 'balance']))?.[1] ?? '0');

/** What the wallet page keeps in a profile: its words and the wallet's identity. */
const walletWords = async (phone: Device): Promise<{ words: string; identity?: string }> => {
  const stored = await phone.page.evaluate(() => ({ words: localStorage.getItem('gw2-wallet:words'), state: localStorage.getItem('gw2-wallet:state') }));
  if (stored.words === null) throw new Error(`the ${phone.name}'s page keeps no words`);
  const identity = stored.state === null ? undefined : (JSON.parse(stored.state) as { identity?: string }).identity;
  return { words: JSON.parse(stored.words) as string, ...(identity === undefined ? {} : { identity }) };
};

/** Connect the wallet to the loan page open in another tab: the page's address is pasted into the wallet. */
const connect = async (wallet: Page, loanPage: Page): Promise<void> => {
  await loanPage.goto(LOAN);
  const address = loanPage.locator('.value-text[data-value^="wiz:"]').first();
  await address.waitFor({ state: 'visible', timeout: 120_000 * patience });
  const uri = (await address.getAttribute('data-value')) ?? '';
  await see(loanPage, 'Waiting for your wallet.', 120_000);
  log(`   the loan page shows its connection address (${uri.length} characters) and waits for a wallet; it says: "${await textOf(loanPage.locator('.independent'))}"`);
  await shot(loanPage, 'loan-connect');
  await wallet.goto(`${WALLET}apps`);
  await see(wallet, 'Connect to an application');
  await wallet.locator('#connect-address').fill(uri);
  await click(wallet, /^Connect$/);
  const row = wallet.locator('ul.connections li').first();
  await row.getByText('Connected', { exact: true }).waitFor({ state: 'visible', timeout: 120_000 * patience });
  log(`   the wallet's Applications screen: "${await textOf(row.locator('.connection-name'))}", ${await textOf(row.locator('.small.muted'))}; "Connected"`);
  await see(loanPage, /Connected to /, 120_000);
  log(`   the loan page: "${await textOf(loanPage.locator('.status-title'))}"`);
};

/** Wait for text on a page, reading the page again now and then: the page reads the chain every half minute. */
const seeEventually = async (page: Page, text: string | RegExp, minutes = 6): Promise<void> => {
  const deadline = Date.now() + minutes * 60_000;
  for (;;) {
    if (await page.getByText(text).first().isVisible().catch(() => false)) return;
    if (Date.now() > deadline) throw new Error(`"${String(text)}" did not appear on ${page.url()}`);
    await wait(10_000);
    if (Date.now() > deadline - minutes * 30_000) await page.reload().catch(() => undefined);
  }
};

const loanItem = (page: Page): Locator => page.getByTestId('loan').filter({ has: page.locator('.pill', { hasText: 'Open' }) }).first();

// ------------------------------------------------------------------ the run

const steps = async (): Promise<void> => {
  let recoverer: Device;
  let old: Device | undefined;
  let loanTab: Page | undefined;
  let recovererLink: string;
  /** Everything the new phone's browser asks of any server, to show that the loan page is not among them. */
  const requested: string[] = [];
  const record = (phone: Device): void => {
    phone.context.on('request', (asked) => void requested.push(asked.url()));
    phone.context.on('page', (page) => page.on('websocket', (socket) => void requested.push(socket.url())));
    phone.page.on('websocket', (socket) => void requested.push(socket.url()));
  };

  if (from === 1) {
    kept.course.funderAtStart = String(funderBalance());
    keep();
    const reached = await firstSteps(theCourse, noShot, async (owner) => {
      const { words } = await walletWords(owner);
      kept.words.owner = words;
      keep();
      log(`   the owner's words are on disk (${keptFile.slice(root.length)}) before anything is paid to the wallet`);
    });
    if (reached === undefined) return;
    recoverer = reached.recoverer;
    old = reached.old;
    recovererLink = reached.recovererLink;
    const { identity } = await walletWords(old);
    if (identity === undefined) throw new Error('the wallet page keeps no identity after the wallet was created');
    kept.identity = identity;
    kept.course.continued = [];
    (kept as unknown as { recovererLink: string }).recovererLink = recovererLink;
    keep();
    log(`   the wallet's identity ${kept.identity}`);
  } else {
    state.step = from - 1;
    recoverer = await device('recoverer', false);
    recovererLink = (kept as unknown as { recovererLink?: string }).recovererLink ?? '';
    if (from <= 11) {
      old = await device('old-phone', false);
      await old.page.goto(`${WALLET}apps`);
      loanTab = await old.context.newPage();
      watchPage('old-phone, loan tab', loanTab);
      await loanTab.goto(LOAN);
    }
    kept.course.continued.push(`The run was continued from step ${from} with the same browser profiles; the line "continued from step ${from}" in the log marks where.`);
    keep();
  }

  // 5 ------------------------------------------------------------------
  if (from <= 5) {
    if (!begin('The owner pairs the wallet with the loan page')) return;
    loanTab = await (old as Device).context.newPage();
    watchPage('old-phone, loan tab', loanTab);
    await connect((old as Device).page, loanTab);
    await see(loanTab, /^No loans (yet|to show)\./, 120_000);
    await see(loanTab, 'This page reckons with', 120_000);
    log(`   the loan page: prices ${(await rows(loanTab.locator('.card').filter({ hasText: 'Prices' }))).join('; ')}`);
    await shot(loanTab, 'loan-connected');
    fact('The wallet was paired with the loan page over WizardConnect: the page showed its connection address, the wallet connected to it from its Applications screen, and the page said that it is an independent demonstration on chipnet with Paryon\'s public contracts, not Paryon\'s site.');
  }
  const oldPage = (): Page => (old as Device).page;
  const loanPage = (): Page => loanTab as Page;

  // 6 ------------------------------------------------------------------
  if (from <= 6) {
    if (!begin('The loan page has the wallet make a loan key')) return;
    await loanPage().reload();
    await click(loanPage(), 'Make a loan key');
    await see(loanPage(), 'On its way');
    const made = await approve(oldPage(), 'making a loan key', 'apps-loan-request');
    sent('a loan key, asked by the loan page', made.transactionId);
    kept.keyCategory = await electrum(async (server) => {
      for (let attempt = 0; attempt < 30; attempt++) {
        const text = await server.getTransaction(made.transactionId);
        if (text !== undefined) {
          const transaction = decodeTransactionBch(hexToBin(text));
          if (typeof transaction === 'string') throw new Error(transaction);
          return Buffer.from(transaction.inputs[0]?.outpointTransactionHash ?? new Uint8Array()).toString('hex');
        }
        await wait(2_000);
      }
      throw new Error('the transaction that made the key is not known to the server');
    });
    keep();
    log(`   the loan key's category ${kept.keyCategory}`);
    await see(loanPage(), 'The loan key is made.', 120_000);
    await seeEventually(loanPage(), 'Your wallet has a new key');
    await shot(loanPage(), 'loan-key-made');
    fact(`The loan page asked the wallet to make a loan key; the wallet showed the request in the template's words with its own figures (${made.figures.join('; ')}), and after it was approved made the key (transaction \`${made.transactionId}\`, category \`${kept.keyCategory}\`). The first request named the template; the wallet asked for it, and the page sent the template and its recovery declaration with the same request.`);
  }

  // 7 ------------------------------------------------------------------
  if (from <= 7) {
    if (!begin('The loan page brings Paryon\'s contracts up to date, if they need it')) return;
    await loanPage().reload();
    const move = loanPage().getByRole('button', { name: 'Bring the contracts up to date' });
    const upToDate = loanPage().getByText(/^Up to date\./);
    await move.or(upToDate).first().waitFor({ state: 'visible', timeout: 180_000 * patience });
    if (await move.isVisible()) {
      const why = await textOf(loanPage().locator('.new-step').nth(1).locator('p').first());
      log(`   the page says: "${why}"`);
      await shot(loanPage(), 'loan-move');
      await move.click();
      const moved = await approve(oldPage(), 'bringing the contracts up to date');
      sent('Paryon\'s contracts brought up to date, asked by the loan page', moved.transactionId);
      await seeEventually(loanPage(), /^Up to date\./);
      fact(`The loan page found Paryon's borrowing contract behind the current period and explained it: "${why}" The wallet moved it on (transaction \`${moved.transactionId}\`).`);
    } else {
      fact('The loan page found Paryon\'s contracts up to date and asked nothing of the wallet for it.');
    }
    log(`   the page: "${await textOf(upToDate)}"`);
  }

  // 8 ------------------------------------------------------------------
  if (from <= 8) {
    if (!begin('The wallet is paid for the loan; the whole course is checked by script against Paryon\'s outputs')) return;
    const balance = funderBalance();
    const market = await electrum((server) => readMarket({ getTransaction: (t) => server.getTransaction(t), listUnspent: (b) => server.listUnspent(b, 'include'), tip: () => server.tip() }, 'chipnet', generalProtocolsOracle));
    const aim = borrowPlan(DEBT, AIM_PERCENT, market);
    const room = balance - aim.fee - 120_000n - 100_000n;
    let percent = AIM_PERCENT;
    while (percent > FLOOR_PERCENT && borrowPlan(DEBT, percent, market).collateral > room) percent -= 1;
    const plan = borrowPlan(DEBT, percent, market);
    if (plan.collateral > room || plan.problem !== undefined) throw new Error(`STOP before paying for the loan: the funder's ${balance} satoshis cannot collateralise 100.00 PUSD to ${FLOOR_PERCENT}% at $${Number(market.lower) / 100}. Nothing of the loan was paid.`);
    kept.course.percent = percent;
    keep();
    await oldPage().getByRole('link', { name: 'Receive' }).first().click();
    const address = await valueOf(oldPage(), 'receive-address');
    const amount = plan.collateral + plan.fee + 120_000n;
    log(`   prices: stored ${market.stored}, oracle ${market.oracle?.price}, lower ${market.lower} (US cents); collateral at ${percent}%: ${plan.collateral} sat; Paryon's fee ${plan.fee} sat`);
    const paid = pay(address, Number(amount));
    log(`   ${paid}`);
    const paidId = /in ([0-9a-f]{64})/.exec(paid)?.[1];
    if (paidId !== undefined) sent('the wallet is paid for the loan', paidId);
    await oldPage().getByRole('link', { name: 'Home' }).first().click();
    await see(oldPage(), 'In your wallet');
    for (let attempt = 0; attempt < 60 && (await balanceOf(oldPage())) < amount; attempt++) await wait(2_000);
    log(`   the wallet holds ${await balanceOf(oldPage())} satoshis`);
    const checked = execFileSync('npx', ['tsx', '../../scripts/run-e-template.ts', 'chipnet', '--check-course', `--state=${keptFile}`], { cwd: `${root}packages/app`, encoding: 'utf8' });
    const line = checked.split('\n').find((text) => text.startsWith('CHECKED'));
    if (line === undefined) throw new Error(`the course could not be checked: ${checked.trim().split('\n').slice(-2).join(' ')}`);
    log(`   ${line}`);
    fact(`Before anything of the loan was sent, ${line.replace(/^CHECKED: /, '').replace(/^the whole course/, 'the whole course, by script from the wallet\'s words on disk,')}`);
    await oldPage().goto(`${WALLET}apps`);
  }

  // 9 ------------------------------------------------------------------
  if (from <= 9) {
    if (!begin('The loan page borrows 100 PUSD; the way out is proven')) return;
    await loanPage().reload();
    await seeEventually(loanPage(), 'Your wallet has a new key');
    await loanPage().locator('#loan-amount').fill('100');
    await loanPage().locator('#loan-ratio').fill(String(kept.course.percent ?? AIM_PERCENT));
    await see(loanPage(), 'Leaves your wallet, about');
    const summary = await rows(loanPage().locator('.summary'));
    log(`   the page: ${summary.join('; ')}`);
    await shot(loanPage(), 'loan-borrow-form');
    await click(loanPage(), /^Borrow 100\.00 PUSD$/);
    const opened = await approve(oldPage(), 'borrowing', 'apps-loan-borrow-review');
    sent('borrow 100.00 PUSD, asked by the loan page', opened.transactionId);
    await see(loanPage(), 'The loan is open.', 180_000);
    const item = loanItem(loanPage());
    await item.waitFor({ state: 'visible', timeout: 180_000 * patience });
    const shown = `${await textOf(item.locator('.loan-amount'))}; ${(await rows(item)).join('; ')}`;
    log(`   the loan page lists, from the wallet's answer and the chain: ${shown}`);
    await shot(loanPage(), 'loan-open');
    fact(`The loan page borrowed 100.00 PUSD at ${kept.course.percent}% collateral at the lower price (${summary.join('; ')}). The wallet showed: ${opened.figures.join('; ')}; ${opened.moved.filter((line) => /^(Tokens|Destroyed)/.test(line)).join('; ')}. Transaction \`${opened.transactionId}\`. The page then listed the loan, found through the wallet's answer to its question about the template's tokens and read from the chain: ${shown}.`);
    await oldPage().goto(`${WALLET}apps`);
    const row = keyRow(oldPage(), kept.keyCategory as string);
    await row.locator('.position-state').waitFor({ state: 'visible', timeout: 180_000 * patience });
    log(`   the wallet's tokens: "${await textOf(row.locator('.token-title'))}" (${await textOf(row.locator('.pill'))}); ${(await rows(row.locator('.position-state'))).join('; ')}; actions ${(await row.locator('.token-actions > li').allInnerTexts()).map((text) => `"${flat(text)}"`).join(', ')}`);
    await shot(oldPage(), 'apps-loan-tokens');
    await wayOut('earlier', 'right after the loan was opened');
  }

  // 10 ------------------------------------------------------------------
  if (from <= 10) {
    if (!begin('The loan page adds collateral; the way out is proven')) return;
    await loanPage().reload();
    const item = loanItem(loanPage());
    await item.waitFor({ state: 'visible', timeout: 180_000 * patience });
    await item.getByRole('button', { name: 'Change the collateral' }).click();
    await item.locator(`#collateral-${kept.keyCategory}`).fill(ADD);
    log(`   the page: "${await textOf(item.locator('.panel p.small'))}"`);
    await item.getByRole('button', { name: 'Add', exact: true }).click();
    const added = await approve(oldPage(), 'adding collateral');
    sent('collateral added, asked by the loan page', added.transactionId);
    await see(loanPage(), 'The collateral is changed.', 180_000);
    await shot(loanPage(), 'loan-collateral-added');
    fact(`The loan page added ${ADD} BCH of collateral (transaction \`${added.transactionId}\`); the wallet showed: ${added.figures.join('; ')}.`);
    await wayOut('earlier', 'after collateral was added');
  }

  // 11 ------------------------------------------------------------------
  if (from <= 11) {
    if (!begin('The phone is lost, with the loan open')) return;
    await close(old as Device);
    log('   the old phone\'s profile, with its wallet tab and its loan tab, is no longer opened');
  }

  // 12 ------------------------------------------------------------------
  let next: Device;
  if (from <= 12) {
    if (!begin('A new phone takes the wallet over with Anna\'s help, and sweeps')) return;
    next = await device('new-phone');
    record(next);
    await newPhoneAsks(theCourse, recoverer, recovererLink, noShot, next);
    kept.words.next = (await walletWords(next)).words;
    keep();
    log(`   the new phone's words are on disk (${keptFile.slice(root.length)}) before anything is swept to it`);
    await completeTakeover(theCourse, recoverer, next, noShot);
  } else {
    next = await device('new-phone', false);
    record(next);
  }

  // 13 ------------------------------------------------------------------
  if (from <= 13) {
    if (!begin('The new phone finds the loan from the swept key and the template from the backup')) return;
    await next.page.goto(`${WALLET}apps`);
    const swept = keyRow(next.page, kept.keyCategory as string);
    const trustButton = swept.getByRole('button', { name: 'Trust this template' });
    await trustButton.or(swept.locator('.position-state')).first().waitFor({ state: 'visible', timeout: 240_000 * patience });
    if (await trustButton.isVisible()) {
      log(`   the Applications screen lists the swept key: "${await textOf(swept.locator('.token-title'))}" (${await textOf(swept.locator('.pill'))}): "${await textOf(swept.locator('.token-body p').first())}"`);
      await shot(next.page, 'apps-loan-incomplete');
      await trustButton.click();
      await see(next.page, 'A template from your backup');
      log(`   "A template from your backup": "${await textOf(next.page.locator('.template-name'))}", "${await textOf(next.page.locator('.status-title'))}"`);
      await click(next.page, 'Trust this template');
    }
    const found = keyRow(next.page, kept.keyCategory as string);
    await found.locator('.position-state').waitFor({ state: 'visible', timeout: 240_000 * patience });
    const holds = `${await textOf(found.locator('.token-body p').first())}; ${(await rows(found.locator('.position-state'))).join('; ')}`;
    const actions = (await found.locator('.token-actions > li').allInnerTexts()).map((text) => `"${flat(text)}"`).join(', ');
    log(`   the key: "${await textOf(found.locator('.token-title'))}" (${await textOf(found.locator('.pill'))}), ${holds}; actions ${actions}`);
    await shot(next.page, 'apps-loan-found');
    fact(`On the new phone the swept loan key was listed; once the template stored in the backup was trusted, the wallet found the loan from the key and the chain: ${holds}. It offered ${actions}.`);
    await wayOut('new', 'after the takeover');
  }

  // 14 ------------------------------------------------------------------
  if (from <= 14) {
    if (!begin('The new phone closes the loan from its own list of tokens; the loan page is not opened')) return;
    await next.page.goto(`${WALLET}apps`);
    const row = keyRow(next.page, kept.keyCategory as string);
    await row.locator('.position-state').waitFor({ state: 'visible', timeout: 240_000 * patience });
    await row.getByRole('button', { name: 'Repay and close the loan' }).click();
    const review = next.page.locator('.request-card').filter({ hasText: 'Check and carry out' }).first();
    await review.waitFor({ state: 'visible', timeout: 240_000 * patience });
    const read = await readReview(review, 'the review');
    await shot(next.page, 'apps-loan-close-review');
    await click(next.page, 'Carry it out');
    const outcome = next.page.getByText(/^(Done|Not carried out)$/).first();
    await outcome.waitFor({ state: 'visible', timeout: 300_000 * patience });
    if ((await outcome.innerText()).trim() !== 'Done') throw new Error(`the closing was not carried out: ${await textOf(next.page.locator('.failure'))}`);
    const closed = (await next.page.getByTestId('action-transaction').first().getAttribute('data-value')) ?? '';
    sent('the loan closed from the new phone\'s list of tokens', closed);
    log(`   done: ${closed}`);
    await click(next.page, 'Back to the tokens');
    const after = keyRow(next.page, kept.keyCategory as string);
    await after.getByText('It holds nothing now.').waitFor({ state: 'visible', timeout: 240_000 * patience });
    log(`   the key is still listed: "${await textOf(after.locator('.token-title'))}" (${await textOf(after.locator('.pill'))}), "It holds nothing now."`);
    await shot(next.page, 'apps-loan-closed');
    const toLoan = requested.filter((url) => url.startsWith(LOAN_ORIGIN));
    const origins = [...new Set(requested.map((url) => new URL(url).origin))];
    if (toLoan.length > 0) throw new Error(`the new phone asked the loan page: ${toLoan.join(', ')}`);
    log(`   ${from > 12 ? 'in this part of the run ' : ''}the new phone's browser made ${requested.length} requests, to ${origins.join(', ')}; none to the loan page (${LOAN_ORIGIN})`);
    fact(`The new phone closed the loan from its own list of tokens, with the loan page not opened (transaction \`${closed}\`). Its review: ${read.figures.join('; ')}; ${read.moved.filter((line) => /^(Tokens|Destroyed)/.test(line)).join('; ')}. ${from > 12 ? 'In the part of the run that did this, the' : 'From the takeover on, the'} new phone's browser made ${requested.length} requests, to ${origins.join(', ')}: none to the loan page (${LOAN_ORIGIN}). The key stays listed, its loan "Closed".`);
  }

  // 15 ------------------------------------------------------------------
  if (!begin('The coins go back to the address that paid for the run')) return;
  const to = elsewhere();
  // The key first, while the wallet still has coins for the fee: a token's own coin never pays one.
  let keyPart = 'the loan key stayed in the wallet';
  await next.page.goto(`${WALLET}send`);
  const tokens = next.page.locator('.card').filter({ hasText: 'The wallet does not know what these stand for' });
  if (await tokens.first().waitFor({ state: 'visible', timeout: 60_000 }).then(() => true, () => false)) {
    await tokens.getByRole('button', { name: 'Send', exact: true }).first().click();
    await next.page.locator('#token-to').fill(to);
    await click(next.page, 'Send the token');
    const said = next.page.getByText(/Sent a token to|Not enough|cannot|could not/i).first();
    await said.waitFor({ state: 'visible', timeout: 120_000 }).catch(() => undefined);
    const words = flat(await said.textContent().catch(() => ''));
    if (/Sent a token/.test(words)) keyPart = 'the loan key, which opens nothing now';
    log(`   the loan key: "${words}"`);
  }
  await next.page.goto(`${WALLET}send`);
  await next.page.getByLabel('To').first().fill(to);
  await click(next.page, 'Send everything instead');
  const everything = next.page.getByText('Arrives', { exact: true });
  const nothing = next.page.getByText('Too little to send');
  await everything.or(nothing).first().waitFor({ state: 'visible', timeout: 120_000 * patience });
  let walletPart = 'nothing more from the wallet, which had nothing left to send';
  if (await everything.isVisible()) {
    const arrives = flat(await next.page.locator('dd').nth(1).textContent());
    const fee = flat(await next.page.locator('dd').nth(2).textContent());
    await click(next.page, /^Send everything$/);
    await see(next.page, 'Sent');
    log(`   the new phone sent everything to ${to}: ${arrives} arrives, fee ${fee}`);
    walletPart = `the wallet's coins (${arrives} arrived, fee ${fee})`;
  } else {
    const earlier = /the new phone sent everything to \S+: (.+?) arrives, fee ([\d,]+ sat)/.exec(lines.join('\n'));
    if (earlier !== null) walletPart = `the wallet's coins, sent by the part of the run that stopped (${earlier[1]} arrived, fee ${earlier[2]})`;
  }
  // The recoverer's page opens its account after it has checked the chain's block headers; it is given a few tries.
  let returnedText = 'not returned: the recoverer\'s page did not open its account';
  for (let attempt = 1; attempt <= 4; attempt++) {
    await openDesk(recoverer.page);
    const elsewhereRow = recoverer.page.getByText('Send the fee coins elsewhere');
    if (!(await elsewhereRow.waitFor({ state: 'visible', timeout: 120_000 }).then(() => true, () => false))) {
      log(`   the recoverer's page has not opened its account yet ("${await textOf(recoverer.page.locator('.notice').first()).catch(() => '')}"); try ${attempt}`);
      continue;
    }
    await elsewhereRow.evaluate((element) => element.scrollIntoView({ block: 'center' }));
    await elsewhereRow.click();
    await recoverer.page.getByLabel('To').fill(to);
    await click(recoverer.page, 'Send them');
    const returned = recoverer.page.getByText(/Sent; the fee was \d+ satoshis|holds too little to send on/).first();
    await returned.waitFor({ state: 'visible', timeout: 120_000 * patience });
    returnedText = flat(await returned.textContent());
    break;
  }
  log(`   Anna's fee coins: ${returnedText}`);
  await wait(15_000);
  const after = funderBalance();
  log(`   funding address: ${after} satoshis`);
  fact(`At the end the coins went back to ${to}, the address that paid for the run: ${walletPart}; ${keyPart}; the recoverer's fee coins: ${returnedText}. The funder held ${kept.course.funderAtStart ?? '?'} satoshis before the run and ${after} after it. What is left: the wallet's controller coin, which the pages do not close. Every profile stays on disk.`);
};

try {
  if (from > 1) note(`       continued from step ${from} on ${new Date(started).toISOString().slice(0, 16).replace('T', ' ')} UTC with the same browser profiles; the times below are seconds since then`);
  await prepare(['wallet', 'recoverer', 'loan']);
  await steps();
  const all = state.step >= 15 && until >= 15;
  writeLog(all ? (from > 1 ? 'every step was carried out, in parts with the same browser profiles, as named below and in the log.' : 'every step was carried out.') : `stopped after step ${Math.min(state.step, until)}, as asked.`);
} catch (error) {
  await theCourse.failed(error);
  writeLog(`failed at step ${state.step}; see the last lines. The way out: cd packages/app && npx tsx ../../scripts/run-e-template.ts chipnet --emergency-close --state=../../${keptFile.slice(root.length)}`);
  process.exitCode = 1;
} finally {
  await theCourse.end();
}
