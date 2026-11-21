// Read-only look at the choice of network on pages whose deployment describes chipnet and mainnet. Sends nothing.
//
// usage: serve the wallet at http://localhost:8701 and the recoverer's page at 8702 (deploy/serve.mjs) with a copy of
// deploy/config/both.example.json whose page addresses are those; then
//   npx tsx scripts/network-choice-look.ts <directory for pictures of a failure>
// Pictures go to docs/screens.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { type BrowserContext, type Page, chromium } from 'playwright';

const SCREENS = join(import.meta.dirname, '..', 'docs', 'screens');
const OUT = process.argv[2] ?? '.';
const WALLET = 'http://localhost:8701/';
const RECOVERER = 'http://localhost:8702/';
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

/** A wait on a page, at most 20 s. On failure: a picture and the page's text. */
const see = async (page: Page, name: string, what: string | RegExp | (() => ReturnType<Page['locator']>)): Promise<void> => {
  try {
    const target = typeof what === 'function' ? what() : page.getByText(what).first();
    await target.waitFor({ state: 'visible', timeout: 20_000 });
  } catch (error) {
    await page.screenshot({ path: join(OUT, `failed-${name}.png`), fullPage: true });
    writeFileSync(join(OUT, `failed-${name}.txt`), await page.locator('body').innerText().catch(() => ''));
    throw new Error(`${name}: ${String(what)} not seen: ${(error as Error).message.split('\n')[0]}`, { cause: error });
  }
};

const shot = (page: Page, file: string) => page.screenshot({ path: join(SCREENS, file) });
const chip = (page: Page) => page.locator('.netchip.choosable:visible').first();
const kept = (page: Page) => page.evaluate(() => Object.fromEntries(Object.keys(localStorage).sort().map((key) => [key, localStorage.getItem(key)])));
const chipnetSide = (all: Record<string, string | null>) => Object.fromEntries(Object.entries(all).filter(([key]) => !/mainnet|grandmas-wallet:network/.test(key)));

const profiles: string[] = [];
const contextAt = async (width: number, height: number): Promise<BrowserContext> => {
  const profile = mkdtempSync(join(tmpdir(), 'network-choice-'));
  profiles.push(profile);
  return chromium.launchPersistentContext(profile, { headless: true, viewport: { width, height }, deviceScaleFactor: 2 });
};

const phone = await contextAt(390, 844);
const desktop = await contextAt(1280, 800);
try {
  // The wallet on chipnet, where a new visitor starts; a set-up begun, so that chipnet has something kept.
  const wallet = await open(phone, 'wallet');
  await wallet.goto(WALLET);
  await see(wallet, 'wallet-chipnet', 'Welcome');
  log(`wallet: starts on chipnet; header "${(await chip(wallet).innerText()).trim()}"; band ${(await wallet.locator('.mainnet-band').count()) === 0 ? 'none' : 'SHOWN'}`);
  await wallet.getByTestId('begin-friend').click();
  const cancel = wallet.locator('dialog.scan-dialog').getByRole('button', { name: 'Cancel' });
  await cancel.waitFor({ state: 'visible', timeout: 5_000 }).then(() => cancel.click(), () => undefined);
  await wallet.waitForTimeout(500);
  const chipnetBefore = chipnetSide(await kept(wallet));
  const chipnetText = (await wallet.locator('main').innerText()).replace(/\s+/g, ' ').trim().slice(0, 120);
  log(`wallet on chipnet keeps ${Object.keys(chipnetBefore).join(', ')}; shows "${chipnetText}"`);

  // The choice, from the header.
  await chip(wallet).click();
  await see(wallet, 'menu', () => wallet.locator('.netmenu'));
  log(`the choice: ${(await wallet.locator('.netmenu-item').allInnerTexts()).map((text) => `"${text.replace(/\s+/g, ' ').trim()}"`).join(', ')}`);
  await shot(wallet, 'network-choice-menu-phone.png');

  // Mainnet: the statement, with a way back; back keeps the page on chipnet.
  await wallet.locator('.netmenu-item.real').click();
  await see(wallet, 'statement', 'This page uses real Bitcoin Cash');
  await shot(wallet, 'network-choice-statement-phone.png');
  await wallet.getByRole('button', { name: 'Stay on chipnet' }).click();
  log(`back from the statement: still on chipnet? ${(await chip(wallet).innerText()).includes('chipnet') ? 'yes' : 'NO'}`);

  // Again, and confirmed: asked every time, even though this browser has not confirmed before.
  await chip(wallet).click();
  await wallet.locator('.netmenu-item.real').click();
  await see(wallet, 'statement-again', 'This page uses real Bitcoin Cash');
  await wallet.getByRole('button', { name: 'I understand that coins can be lost' }).click();
  await see(wallet, 'wallet-mainnet', () => wallet.locator('.mainnet-band'));
  await see(wallet, 'wallet-mainnet-welcome', 'Welcome');
  const onMainnet = await kept(wallet);
  log(`wallet on mainnet: band "${(await wallet.locator('.mainnet-band').first().innerText()).trim()}"; header "${(await chip(wallet).innerText()).trim()}"; statement asked again after the reload? ${(await wallet.getByText('This page uses real Bitcoin Cash').count()) > 0 ? 'YES' : 'no'}`);
  log(`wallet on mainnet: start screen "${(await wallet.locator('main').innerText()).replace(/\s+/g, ' ').trim().slice(0, 140)}"; test-network line ${(await wallet.getByText(/Test network/).count()) === 0 ? 'absent' : 'SHOWN'}`);
  log(`kept now: ${Object.keys(onMainnet).join(', ')}`);
  await shot(wallet, 'network-choice-mainnet-welcome-phone.png');
  await chip(wallet).click();
  await see(wallet, 'menu-mainnet', () => wallet.locator('.netmenu'));
  await shot(wallet, 'network-choice-menu-mainnet-phone.png');
  await wallet.keyboard.press('Escape');

  // The recoverer's page: its own choice; on mainnet its balance account has a bitcoincash: address.
  const recoverer = await open(phone, 'recoverer');
  await recoverer.goto(RECOVERER);
  await see(recoverer, 'recoverer-chipnet', 'How will you use this page?');
  await chip(recoverer).click();
  await recoverer.locator('.netmenu-item.real').click();
  await see(recoverer, 'recoverer-statement', 'This page uses real Bitcoin Cash');
  await recoverer.getByRole('button', { name: 'I understand that coins can be lost' }).click();
  await see(recoverer, 'recoverer-mainnet', () => recoverer.locator('.mainnet-band'));
  await see(recoverer, 'recoverer-mainnet-start', 'How will you use this page?');
  await recoverer.getByTestId('mode-friend').click();
  await recoverer.getByLabel('Your name, as their wallet shows it').fill('Anna');
  await recoverer.getByRole('button', { name: 'Continue' }).click();
  const address = recoverer.getByTestId('funds-address').first();
  const seen = await address.waitFor({ state: 'visible', timeout: 20_000 }).then(() => true, () => false);
  if (seen) log(`recoverer on mainnet: balance address ${(await address.getAttribute('data-value')) ?? ''}`);
  else {
    writeFileSync(join(OUT, 'recoverer-address.txt'), await recoverer.locator('body').innerText());
    log('recoverer on mainnet: the balance address did not show within 20 s (the engine\'s header check); not waited for longer');
  }
  await shot(recoverer, 'network-choice-recoverer-mainnet-phone.png');

  // Back to chipnet in the wallet: no statement, and chipnet's data as it was.
  await chip(wallet).click();
  await wallet.locator('.netmenu-item:not(.real)').click();
  await see(wallet, 'wallet-back', () => wallet.locator('.netchip.test'));
  await wallet.waitForTimeout(500);
  const chipnetAfter = chipnetSide(await kept(wallet));
  log(`wallet back on chipnet: band ${(await wallet.locator('.mainnet-band').count()) === 0 ? 'none' : 'SHOWN'}; shows "${(await wallet.locator('main').innerText()).replace(/\s+/g, ' ').trim().slice(0, 120)}"`);
  log(`chipnet's data untouched: ${JSON.stringify(chipnetAfter) === JSON.stringify(chipnetBefore) ? 'yes' : `NO: ${JSON.stringify(chipnetAfter)}`}`);
  await shot(wallet, 'network-choice-chipnet-again-phone.png');

  // Desktop width: the choice and the statement.
  const wide = await open(desktop, 'wallet-wide');
  await wide.goto(WALLET);
  await see(wide, 'wide-welcome', 'Welcome');
  await chip(wide).click();
  await see(wide, 'wide-menu', () => wide.locator('.netmenu'));
  await shot(wide, 'network-choice-menu-desktop.png');
  await wide.locator('.netmenu-item.real').click();
  await see(wide, 'wide-statement', 'This page uses real Bitcoin Cash');
  await shot(wide, 'network-choice-statement-desktop.png');
  await wide.getByRole('button', { name: 'Stay on chipnet' }).click();
  // The recoverer's page with its side rail: the label sits at the foot of the rail and the choice opens upwards.
  const wideRecoverer = await open(desktop, 'recoverer-wide');
  await wideRecoverer.goto(RECOVERER);
  await see(wideRecoverer, 'wide-recoverer-start', 'How will you use this page?');
  await wideRecoverer.getByTestId('mode-friend').click();
  await wideRecoverer.getByLabel('Your name, as their wallet shows it').fill('Anna');
  await wideRecoverer.getByRole('button', { name: 'Continue' }).click();
  await see(wideRecoverer, 'wide-recoverer-people', 'No wallets yet.');
  await chip(wideRecoverer).click();
  await see(wideRecoverer, 'wide-recoverer-menu', () => wideRecoverer.locator('.netmenu'));
  await shot(wideRecoverer, 'network-choice-recoverer-desktop.png');

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
