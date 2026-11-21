// Read-only look at the pages built for mainnet, against real mainnet servers. Sends nothing.
//
// usage: serve the four pages with a configuration that allows mainnet (deploy/serve.mjs) at http://localhost:8601 (wallet),
// 8602 (recoverer), 8603 (Savings Jar) and 8604 (loan page), a backup store at 8611, and the wallet page at 8605 with a
// mainnet configuration that does not allow it, served without the server's own check; then
//   npx tsx scripts/mainnet-look.ts <directory for pictures of a failure>
// Pictures go to docs/screens.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { type BrowserContext, type Page, chromium } from 'playwright';

const SCREENS = '/home/ubuntu/projects/grandmas-wallet-design-3/docs/screens';
const OUT = process.argv[2] ?? '.';
const started = Date.now();
const log = (line: string): void => console.log(`${((Date.now() - started) / 1000).toFixed(1).padStart(6)} s  ${line}`);
const problems: string[] = [];

const open = async (context: BrowserContext, name: string): Promise<Page> => {
  const page = await context.newPage();
  page.setDefaultTimeout(20_000);
  page.on('pageerror', (error) => problems.push(`[${name}] page error: ${error.message.slice(0, 300)}`));
  page.on('console', (message) => {
    if (message.type() === 'error' && !/favicon|Failed to load resource/.test(message.text())) problems.push(`[${name}] console: ${message.text().slice(0, 300)}`);
  });
  return page;
};

/** A wait on a page, at most 20 s unless it is a wait on the chain, which says what and until when. On failure: a picture and the text. */
const see = async (page: Page, name: string, text: string | RegExp, chain?: { what: string; seconds: number }): Promise<void> => {
  const timeout = chain === undefined ? 20_000 : chain.seconds * 1000;
  if (chain !== undefined) log(`waiting on the chain for ${chain.what}, until ${new Date(Date.now() + timeout).toISOString().slice(11, 19)} UTC`);
  try {
    await page.getByText(text).first().waitFor({ state: 'visible', timeout });
  } catch (error) {
    await page.screenshot({ path: join(OUT, `failed-${name}.png`), fullPage: true });
    writeFileSync(join(OUT, `failed-${name}.txt`), await page.locator('body').innerText());
    throw new Error(`${name}: "${String(text)}" not seen: ${(error as Error).message.split('\n')[0]}`, { cause: error });
  }
};
const valueOf = async (page: Page, testId: string, chain: { what: string; seconds: number }): Promise<string> => {
  log(`waiting on the chain for ${chain.what}, until ${new Date(Date.now() + chain.seconds * 1000).toISOString().slice(11, 19)} UTC`);
  const element = page.getByTestId(testId).first();
  try {
    await element.waitFor({ state: 'visible', timeout: chain.seconds * 1000 });
  } catch (error) {
    await page.screenshot({ path: join(OUT, `failed-${testId}.png`), fullPage: true });
    writeFileSync(join(OUT, `failed-${testId}.txt`), await page.locator('body').innerText());
    throw error;
  }
  return (await element.getAttribute('data-value')) ?? '';
};

const shot = (page: Page, file: string) => page.screenshot({ path: join(SCREENS, file) });

const profiles: string[] = [];
const contextAt = async (width: number, height: number): Promise<BrowserContext> => {
  const profile = mkdtempSync(join(tmpdir(), 'mainnet-check-'));
  profiles.push(profile);
  return chromium.launchPersistentContext(profile, { headless: true, viewport: { width, height }, deviceScaleFactor: 2 });
};

const phone = await contextAt(390, 844);
const desktop = await contextAt(1280, 800);
try {
  // A page whose configuration names mainnet without the parameter: it does not start.
  const refused = await open(phone, 'refused');
  await refused.goto('http://localhost:8605/');
  await see(refused, 'refused', /does not allow it/);
  log(`without the parameter the wallet page says: "${(await refused.locator('main').innerText()).replace(/\s+/g, ' ').trim()}"`);
  await shot(refused, 'mainnet-refused-phone.png');
  await refused.close();

  // The recoverer's page: the statement first, nothing behind it.
  const recoverer = await open(phone, 'recoverer');
  await recoverer.goto('http://localhost:8602/');
  await see(recoverer, 'recoverer-statement', 'This page uses real Bitcoin Cash');
  await shot(recoverer, 'mainnet-statement-recoverer-phone.png');
  const behind = await recoverer.getByText('How will you use this page?').count();
  log(`recoverer: the statement is shown; the page behind it ${behind === 0 ? 'has not started' : 'HAS STARTED'}`);
  await recoverer.getByRole('button', { name: 'I understand that coins can be lost' }).click();
  await see(recoverer, 'recoverer-start', 'How will you use this page?');
  await recoverer.getByTestId('mode-friend').click();
  await recoverer.getByLabel('Your name, as their wallet shows it').fill('Anna');
  await recoverer.getByRole('button', { name: 'Continue' }).click();
  await see(recoverer, 'recoverer-fund', 'Add coins to your balance');
  const headerFrom = Date.now();
  const funds = await valueOf(recoverer, 'funds-address', { what: "the recoverer's balance account: the engine's header check from its checkpoint", seconds: 240 });
  const balance = await valueOf(recoverer, 'funds-balance', { what: "the recoverer's balance read from the chain", seconds: 60 });
  log(`recoverer: header check and balance in ${((Date.now() - headerFrom) / 1000).toFixed(1)} s; balance ${balance} satoshis at ${funds}`);
  await shot(recoverer, 'mainnet-recoverer-phone.png');
  // With an empty balance the page offers nothing else: no code is shown, so the set-up over a session is not looked at here.
  log(`recoverer: "Continue" ${(await recoverer.getByRole('button', { name: 'Continue' }).isDisabled()) ? 'is not open' : 'IS OPEN'} with a balance of ${balance} satoshis`);

  // The wallet: the statement, then the first screen.
  const wallet = await open(phone, 'wallet');
  await wallet.goto('http://localhost:8601/');
  await see(wallet, 'wallet-statement', 'This page uses real Bitcoin Cash');
  await shot(wallet, 'mainnet-statement-wallet-phone.png');
  await wallet.getByRole('button', { name: 'I understand that coins can be lost' }).click();
  await see(wallet, 'wallet-welcome', 'Welcome');
  await shot(wallet, 'mainnet-wallet-welcome-phone.png');
  log(`wallet: after the statement, the first screen; header chip "${(await wallet.locator('.netchip').first().innerText()).trim()}", band "${(await wallet.locator('.mainnet-band').first().innerText()).trim()}"`);
  // The statement again from the band.
  await wallet.locator('.mainnet-band').first().click();
  await see(wallet, 'wallet-statement-again', 'This page uses real Bitcoin Cash');
  await wallet.getByRole('button', { name: 'Close' }).click();
  // A reload does not ask again in this browser.
  await wallet.reload();
  await see(wallet, 'wallet-reload', /Waiting for Anna|Welcome|Not set up/);
  log(`wallet reloaded: statement shown again? ${(await wallet.getByText('This page uses real Bitcoin Cash').count()) > 0 ? 'YES' : 'no'}`);

  // Desktop width.
  const walletWide = await open(desktop, 'wallet-wide');
  await walletWide.goto('http://localhost:8601/');
  await see(walletWide, 'wallet-wide-statement', 'This page uses real Bitcoin Cash');
  await shot(walletWide, 'mainnet-statement-wallet-desktop.png');
  await walletWide.getByRole('button', { name: 'I understand that coins can be lost' }).click();
  await see(walletWide, 'wallet-wide-welcome', 'Welcome');
  await shot(walletWide, 'mainnet-wallet-welcome-desktop.png');
  const recovererWide = await open(desktop, 'recoverer-wide');
  await recovererWide.goto('http://localhost:8602/');
  await see(recovererWide, 'recoverer-wide-statement', 'This page uses real Bitcoin Cash');
  await recovererWide.getByRole('button', { name: 'I understand that coins can be lost' }).click();
  await see(recovererWide, 'recoverer-wide-start', 'How will you use this page?');
  await shot(recovererWide, 'mainnet-recoverer-start-desktop.png');
  await recovererWide.getByTestId('mode-friend').click();
  await recovererWide.getByLabel('Your name, as their wallet shows it').fill('Anna');
  await recovererWide.getByRole('button', { name: 'Continue' }).click();
  await valueOf(recovererWide, 'funds-balance', { what: "the recoverer's balance at desktop width", seconds: 240 });
  await shot(recovererWide, 'mainnet-recoverer-desktop.png');

  // The two applications' pages.
  for (const [name, url] of [['jar', 'http://localhost:8603/'], ['loan', 'http://localhost:8604/']] as const) {
    const page = await open(phone, name);
    await page.goto(url);
    await see(page, `${name}-statement`, 'This page uses real Bitcoin Cash');
    await page.getByRole('button', { name: 'I understand that coins can be lost' }).click();
    if (name === 'jar') {
      await page.getByRole('button', { name: 'Copy address' }).first().waitFor({ state: 'visible', timeout: 20_000 });
      log('jar: after the statement it shows the address a wallet connects with');
    } else {
      await see(page, 'loan-needs', /Collateral at 150%/, { what: "Paryon's contracts on mainnet and the oracle's price", seconds: 120 });
      log(`loan: "${((await page.locator('.card', { hasText: 'needs now' }).first().innerText()) ?? '').replace(/\s+/g, ' ').trim()}"`);
    }
    await shot(page, `mainnet-${name}-phone.png`);
  }

  for (const problem of problems) log(problem);
  log(problems.length === 0 ? 'no error was logged by any page' : `${problems.length} errors were logged`);
} catch (error) {
  for (const problem of problems) log(problem);
  log(`FAILED: ${(error as Error).message.split('\n')[0]}`);
  process.exitCode = 1;
} finally {
  await phone.close();
  await desktop.close();
  for (const profile of profiles) rmSync(profile, { recursive: true, force: true });
}
