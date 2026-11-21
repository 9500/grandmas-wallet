// A look at the mockup network through the pages, as a visitor would use it: no coins brought, no waiting.
//
//   1. the recoverer's page: the first-visit question answered with the mockup, play coins for its balance at a press
//   2. a wallet set up over the recoverer's code, on the mockup, and given play coins on its Receive screen; a jar
//      opened on the Savings Jar page, time let pass until its date, and emptied; a loan key made and 100.00 PUSD
//      borrowed on the loan page
//   3. the phone is lost; a new phone asks over the recoverer's "lost their phone" code
//   4. "Let the waiting period pass" on the recoverer's page, the move completed, the wallet on the new phone
//   5. the Savings Jar page and the loan page each open on the mockup
//
// usage (from the repository's root):
//   npx tsx scripts/mockup-look.ts <configuration file> [--headed] [--screens <directory>]
//     deploy/config/production.json    the public pages
//     a copy with the preview's addresses, served by `deploy/preview.sh start <file>`
// It takes about three minutes. It uses the mockup's own service for coins and for the clock, so the chain's clock
// moves on by about nine minutes for everyone on the mockup. Each device is a browser context of its own.
import { readFileSync } from 'node:fs';

import { type BrowserContext, type Page, chromium } from 'playwright';

const words = process.argv.slice(2);
const file = words.find((word, index) => !word.startsWith('--') && words[index - 1] !== '--screens');
const screens = words.includes('--screens') ? words[words.indexOf('--screens') + 1] : undefined;
if (file === undefined) {
  console.error('usage: npx tsx scripts/mockup-look.ts <configuration file> [--headed] [--screens <directory>]');
  process.exit(2);
}
const config = JSON.parse(readFileSync(file, 'utf8')) as { walletUrl: string; recovererUrl: string; jarUrl?: string; loanUrl?: string; networks?: Record<string, { mockupService?: string }> };
if (config.networks?.['mockup']?.mockupService === undefined) {
  console.error(`${file} does not describe the mockup with its service under "networks".`);
  process.exit(2);
}
const started = Date.now();
const log = (line: string): void => console.log(`${((Date.now() - started) / 1000).toFixed(0).padStart(4)} s  ${line}`);
const browser = await chromium.launch({ headless: !words.includes('--headed') });
const problems: string[] = [];
const WAIT = 60_000;

const open = async (name: string, viewport: { width: number; height: number }): Promise<{ context: BrowserContext; page: Page }> => {
  const context = await browser.newContext({ viewport });
  context.setDefaultTimeout(WAIT);
  const page = await context.newPage();
  page.on('pageerror', (error) => problems.push(`[${name}] page error: ${error.message.slice(0, 300)}`));
  page.on('console', (message) => {
    if (message.type() === 'error' && !/favicon|Failed to load resource|CLOSING or CLOSED/.test(message.text())) problems.push(`[${name}] console: ${message.text().slice(0, 300)}`);
  });
  return { context, page };
};
const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 900 };
const see = (page: Page, text: string | RegExp, timeout = WAIT): Promise<void> => page.getByText(text).first().waitFor({ state: 'visible', timeout });
const shot = async (page: Page, name: string): Promise<void> => {
  if (screens !== undefined) await page.screenshot({ path: `${screens}/${name}.png`, fullPage: true });
};
/** A code taken in as a person without a camera would: the scanner that opens by itself is closed, and the text pasted. */
const paste = async (page: Page, code: string): Promise<void> => {
  const cancel = page.locator('dialog.scan-dialog').getByRole('button', { name: 'Cancel' });
  await cancel.waitFor({ state: 'visible', timeout: 15_000 }).then(() => cancel.click(), () => undefined);
  await page.getByText('No camera?').first().click();
  await page.locator('#code-text').fill(code);
  await page.getByRole('button', { name: 'Use it' }).click();
};
/** The wallet is connected to an application's page open in another tab: the page's address is pasted into the wallet. */
const connect = async (wallet: Page, application: Page, url: string, connected: string | RegExp): Promise<void> => {
  await application.goto(url);
  const address = application.locator('.value-text[data-value^="wiz:"]').first();
  await address.waitFor({ state: 'visible' });
  const uri = (await address.getAttribute('data-value')) ?? '';
  await wallet.goto(`${config.walletUrl}apps`);
  await wallet.getByRole('button', { name: 'Paste a link instead' }).click();
  await wallet.getByLabel('Connection link').fill(uri);
  await wallet.getByRole('button', { name: /^Connect$/ }).click();
  // The page starts on the site's first network and changes to the wallet's, the mockup, when the wallet connects.
  await see(application, connected, 120_000);
  await application.locator('.netchip', { hasText: 'mockup' }).first().waitFor();
};
/** The wallet's review of a page's request, ticked where it asks for the user's tick, approved, and carried out. */
const approve = async (wallet: Page, what: string): Promise<void> => {
  const request = wallet.locator('.request-card').filter({ hasText: 'asks for your decision' }).first();
  await request.waitFor({ state: 'visible', timeout: 120_000 });
  const button = request.getByRole('button', { name: 'Approve' });
  await button.waitFor({ state: 'visible' });
  const box = request.locator('input[type=checkbox]');
  for (let round = 0; round < 60 && !(await button.isEnabled()); round++) {
    if ((await box.count()) > 0 && !(await box.first().isChecked())) await box.first().check();
    else await wallet.waitForTimeout(500);
  }
  await button.click();
  const outcome = wallet.locator('.request-card').filter({ hasText: /Done:|Not carried out:/ }).first();
  await outcome.waitFor({ state: 'visible', timeout: 120_000 });
  const said = ((await outcome.innerText()) ?? '').replace(/\s+/g, ' ').trim();
  if (!/Done:/.test(said)) throw new Error(`${what} was not carried out: ${said.slice(0, 300)}`);
  await outcome.getByRole('button', { name: 'Dismiss' }).click();
};
const balanceOf = async (page: Page): Promise<string> => ((await page.getByTestId('balance').first().textContent()) ?? '').replace(/\s+/g, ' ').trim();

try {
  log(`the pages of ${file}, on the mockup`);
  // 1 ------------------------------------------------------------------
  const recoverer = (await open('recoverer', DESKTOP)).page;
  await recoverer.goto(config.recovererUrl);
  await see(recoverer, 'Where do you want to try this?');
  await shot(recoverer, 'mockup-recoverer-question');
  await recoverer.getByTestId('network-mockup').click();
  await see(recoverer, 'How will you use this page?');
  log(`the recoverer's page asked where to try it and is on "${(await recoverer.locator('.netchip').first().innerText()).replace(/\s+/g, ' ').trim()}"`);
  await recoverer.getByTestId('mode-friend').click();
  await recoverer.getByLabel('Your name, as their wallet shows it').fill('Anna');
  await recoverer.getByRole('button', { name: 'Continue' }).click();
  const fundsAddress = (await recoverer.getByTestId('funds-address').first().getAttribute('data-value')) ?? '';
  if (!fundsAddress.startsWith('bchreg:')) throw new Error(`the recoverer's balance address is not written for the mockup: ${fundsAddress}`);
  await recoverer.getByRole('button', { name: 'Get play coins' }).click();
  await recoverer.locator('[data-testid="funds-balance"]:not([data-value="0"])').first().waitFor();
  await shot(recoverer, 'mockup-recoverer-fund');
  log(`play coins reached the recoverer's balance at ${fundsAddress}: ${(await recoverer.getByTestId('funds-balance').first().getAttribute('data-value')) ?? ''} satoshis`);
  await recoverer.getByRole('button', { name: 'Continue' }).click();

  // 2 ------------------------------------------------------------------
  await recoverer.getByTestId('new-wallet').click();
  await recoverer.getByLabel('Who are you helping?').fill('Grandma');
  await recoverer.getByRole('button', { name: 'Show the code' }).click();
  await see(recoverer, 'Waiting for their phone to scan the code');
  const code = (await recoverer.getByTestId('recoverer-code').getAttribute('data-value')) ?? '';
  const old = await open('old-phone', PHONE);
  await old.page.goto(config.walletUrl);
  await see(old.page, 'Where do you want to try the wallet?');
  await shot(old.page, 'mockup-wallet-question');
  await old.page.getByTestId('network-mockup').click();
  await old.page.getByRole('button', { name: 'Someone I trust is setting it up' }).click();
  await paste(old.page, code);
  await recoverer.getByRole('button', { name: 'Set it up' }).click();
  await see(old.page, 'Your wallet is ready', 120_000);
  await old.page.getByRole('button', { name: 'Open my wallet' }).click();
  log('the wallet was set up on the mockup over the recoverer\'s code');
  await old.page.getByRole('link', { name: 'Receive' }).first().click();
  const receive = (await old.page.getByTestId('receive-address').getAttribute('data-value')) ?? '';
  if (!receive.startsWith('bchreg:')) throw new Error(`the wallet's address is not written for the mockup: ${receive}`);
  await old.page.getByRole('button', { name: 'Get 1 BCH of play coins' }).click();
  await see(old.page, 'Sent. They show here in a few seconds.');
  await shot(old.page, 'mockup-wallet-receive');
  await old.page.getByRole('link', { name: 'Home' }).first().click();
  await old.page.getByTestId('balance').filter({ hasText: /^\s*1\.\d/ }).first().waitFor();
  log(`play coins reached the wallet at ${receive}: it holds ${await balanceOf(old.page)}`);

  // The Savings Jar: opened from its page, time let pass until its date, emptied.
  if (config.jarUrl !== undefined) {
    const jar = await old.context.newPage();
    await connect(old.page, jar, config.jarUrl, /Connected to /);
    await jar.locator('#jar-amount').fill('0.001');
    await jar.getByRole('button', { name: '10 minutes', exact: true }).click();
    await see(jar, /stays in the jar until/);
    await jar.getByRole('button', { name: 'Open the jar' }).click();
    await approve(old.page, 'Opening the jar');
    await see(jar, 'The jar is open. Its key is in your wallet.');
    log('the wallet followed to the Savings Jar page on the mockup and opened a jar of 0.001 BCH for ten minutes');
    await shot(jar, 'mockup-jar-locked');
    const emptied = Date.now();
    await jar.getByRole('button', { name: 'Let time pass until the jar opens' }).click();
    const empty = jar.getByRole('button', { name: 'Empty the jar' });
    await empty.waitFor({ state: 'visible', timeout: 120_000 });
    for (let round = 0; round < 120 && !(await empty.isEnabled()); round++) await jar.waitForTimeout(500);
    await empty.click();
    await approve(old.page, 'Emptying the jar');
    await see(jar, /Emptied\./, 120_000);
    log(`"Let time pass until the jar opens" and the emptying took ${((Date.now() - emptied) / 1000).toFixed(0)} s`);
    await jar.close();
  }

  // ParyonUSD: a loan key, then 100.00 PUSD borrowed against the play coins.
  if (config.loanUrl !== undefined) {
    const loan = await old.context.newPage();
    await connect(old.page, loan, config.loanUrl, 'Your loans');
    await loan.getByRole('button', { name: 'Make a loan key' }).click();
    await approve(old.page, 'Making a loan key');
    await see(loan, 'The loan key is made. It waits in Paryon\'s contracts until you borrow.', 120_000);
    await loan.locator('#loan-amount').fill('100');
    const move = loan.getByRole('button', { name: 'Bring the contracts up to date' });
    const ready = loan.getByText(/^Up to date\. A loan opened now/);
    await move.or(ready).first().waitFor({ state: 'visible', timeout: 120_000 });
    if (await move.isVisible()) {
      await move.click();
      await approve(old.page, 'Bringing Paryon\'s contracts up to date');
      await see(loan, 'Paryon\'s contracts are up to date.', 120_000);
    }
    await ready.waitFor({ state: 'visible', timeout: 120_000 });
    await shot(loan, 'mockup-loan-borrow');
    await loan.getByRole('button', { name: /^Borrow 100\.00 PUSD/ }).click();
    await approve(old.page, 'Borrowing 100.00 PUSD');
    await see(loan, 'The loan is open. The PUSD and the loan key are in your wallet.', 120_000);
    log('the wallet followed to the loan page on the mockup, made a loan key and borrowed 100.00 PUSD');
    await loan.close();
    await old.page.goto(config.walletUrl);
    await old.page.getByTestId('balance').first().waitFor();
    log(`the wallet now holds ${await balanceOf(old.page)} beside the loan's collateral`);
  }

  // 3 ------------------------------------------------------------------
  await old.context.close();
  await recoverer.goto(config.recovererUrl);
  await recoverer.getByTestId('open-wallet').first().click();
  await recoverer.getByRole('button', { name: /lost their phone/ }).click();
  const lostCode = (await recoverer.getByTestId('lost-phone-code').getAttribute('data-value')) ?? '';
  const next = await open('new-phone', PHONE);
  await next.page.goto(config.walletUrl);
  await next.page.getByTestId('network-mockup').click();
  await next.page.getByRole('button', { name: 'I lost my phone' }).click();
  await paste(next.page, lostCode);
  await see(next.page, /Waiting for Anna/);
  log('the old phone is gone; a new phone asked over the recoverer\'s code');

  // 4 ------------------------------------------------------------------
  await see(recoverer, 'Your request is waiting', 120_000);
  const pass = recoverer.getByRole('button', { name: 'Let the waiting period pass' });
  await pass.waitFor({ state: 'visible', timeout: 120_000 });
  await shot(recoverer, 'mockup-recoverer-waiting');
  const waitedFrom = Date.now();
  await pass.click();
  const complete = recoverer.getByRole('button', { name: 'Complete the move' });
  await see(recoverer, 'The waiting period has passed.', 120_000);
  await complete.click();
  log(`"Let the waiting period pass" opened the completion after ${((Date.now() - waitedFrom) / 1000).toFixed(0)} s`);
  await next.page.getByRole('button', { name: 'Open the wallet' }).click({ timeout: 240_000 });
  await next.page.getByTestId('balance').filter({ hasText: /^\s*(0\.[1-9]|1\.)/ }).first().waitFor({ timeout: 120_000 });
  await shot(next.page, 'mockup-wallet-recovered');
  log(`the new phone has the wallet, with ${await balanceOf(next.page)}`);

  // 5 ------------------------------------------------------------------
  for (const [name, url] of [['Savings Jar', config.jarUrl], ['loan', config.loanUrl]] as const) {
    if (url === undefined) continue;
    const visitor = await open(name, DESKTOP);
    // An application's page follows the wallet that connects; here it is put on the mockup as a wallet on it would.
    await visitor.context.addInitScript('localStorage.setItem("grandmas-wallet:network", "mockup")');
    await visitor.page.goto(url);
    const address = visitor.page.getByRole('button', { name: 'Copy address' }).first();
    const none = visitor.page.getByText('No deployment of Paryon\'s contracts').first();
    await address.or(none).waitFor({ state: 'visible' });
    const chip = (await visitor.page.locator('.netchip').first().innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
    if (!(await address.isVisible())) throw new Error(`the ${name} page has no deployment on the mockup`);
    await shot(visitor.page, `mockup-${name === 'loan' ? 'loan' : 'jar'}`);
    log(`the ${name} page opens on "${chip}" and shows the address a wallet connects with`);
    await visitor.context.close();
  }

  for (const problem of problems) log(problem);
  log(problems.length === 0 ? 'no error was logged by any page' : `${problems.length} errors were logged`);
  if (problems.length > 0) process.exitCode = 1;
} catch (error) {
  for (const problem of problems) log(problem);
  log(`FAILED: ${(error as Error).message.split('\n')[0]}`);
  process.exitCode = 1;
} finally {
  await browser.close();
}
