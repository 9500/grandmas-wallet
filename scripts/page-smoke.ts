// A look at the pages of a deployment without coins, for checking a build or a release before anyone relies on it:
// the recoverer's page starts as someone helping a person they know, reads its balance from the chain and shows its
// code; the wallet page takes the code in as a person without a camera would and asks over the session the code
// offers; the recoverer's page asks "Set up Grandma's wallet?", and, with an empty balance, refuses to set it up
// with what it would take. The Savings Jar page and the loan page, where the configuration names them, each show
// the address a wallet connects with. Nothing is paid and nothing is sent to the chain.
//
// usage (from the repository's root):
//   npx tsx scripts/page-smoke.ts <configuration file> [--headed]
//     deploy/config/production.json        the public pages
//     deploy/config/local.json             deploy/preview.sh start chipnet
//     deploy/config/local-regtest.json     deploy/preview.sh start local
// It takes about a minute. The browser's profile is a temporary directory, removed at the end.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { type Page, chromium } from 'playwright';

const file = process.argv.slice(2).find((word) => !word.startsWith('--'));
if (file === undefined) {
  console.error('usage: npx tsx scripts/page-smoke.ts <configuration file> [--headed]');
  process.exit(2);
}
const config = JSON.parse(readFileSync(file, 'utf8')) as { walletUrl: string; recovererUrl: string; jarUrl?: string; loanUrl?: string; network: string };
const started = Date.now();
const log = (line: string): void => console.log(`${((Date.now() - started) / 1000).toFixed(0).padStart(4)} s  ${line}`);

const profile = mkdtempSync(join(tmpdir(), 'page-smoke-'));
const context = await chromium.launchPersistentContext(profile, { headless: !process.argv.includes('--headed'), viewport: { width: 390, height: 844 } });
const problems: string[] = [];
const open = async (name: string): Promise<Page> => {
  const page = await context.newPage();
  page.setDefaultTimeout(60_000);
  page.on('pageerror', (error) => problems.push(`[${name}] page error: ${error.message.slice(0, 300)}`));
  page.on('console', (message) => {
    if (message.type() === 'error' && !/favicon|Failed to load resource|WebSocket is already in CLOSING or CLOSED state/.test(message.text())) problems.push(`[${name}] console: ${message.text().slice(0, 300)}`);
  });
  return page;
};
const see = (page: Page, text: string | RegExp, timeout = 60_000) => page.getByText(text).first().waitFor({ state: 'visible', timeout });
const valueOf = async (page: Page, testId: string): Promise<string> => {
  const element = page.getByTestId(testId).first();
  await element.waitFor({ state: 'visible' });
  return (await element.getAttribute('data-value')) ?? '';
};

try {
  log(`the pages of ${file}, on ${config.network}`);
  const recoverer = await open('recoverer');
  await recoverer.goto(config.recovererUrl);
  await see(recoverer, 'How will you use this page?');
  await recoverer.getByTestId('mode-friend').click();
  await recoverer.getByLabel('Your name, as their wallet shows it').fill('Anna');
  await recoverer.getByRole('button', { name: 'Continue' }).click();
  await see(recoverer, 'No wallets yet.');
  const funds = await valueOf(recoverer, 'funds-address');
  const balance = await valueOf(recoverer, 'funds-balance');
  log(`the recoverer's page starts; its balance, read from the chain, is ${balance} satoshis at ${funds}`);

  await recoverer.getByTestId('new-wallet').click();
  await recoverer.getByLabel('Who are you helping?').fill('Grandma');
  await recoverer.getByRole('button', { name: 'Show the code' }).click();
  await see(recoverer, /Waiting for their phone to scan the code/);
  const code = await valueOf(recoverer, 'recoverer-code');
  log(`it shows its code, ${code.length} characters`);

  const wallet = await open('wallet');
  await wallet.goto(config.walletUrl);
  await wallet.getByRole('button', { name: 'Someone I trust is setting it up' }).click();
  // The scanner opens by itself; without a camera the code is pasted.
  const cancel = wallet.locator('dialog.scan-dialog').getByRole('button', { name: 'Cancel' });
  await cancel.waitFor({ state: 'visible', timeout: 30_000 }).then(() => cancel.click(), () => undefined);
  await wallet.getByText('No camera?').first().click();
  await wallet.locator('#code-text').fill(code);
  await wallet.getByRole('button', { name: 'Use it' }).click();
  await see(recoverer, 'Set up Grandma\'s wallet with', 120_000);
  await see(wallet, 'Waiting for Anna to say yes', 120_000);
  log('the wallet page took the code in and asked over the session; the recoverer\'s page asks "Set up Grandma\'s wallet?"');

  if (balance === '0') {
    await recoverer.getByRole('button', { name: 'Set it up' }).click();
    await see(recoverer, /Send at least [\d,]+ satoshis to your address/);
    log(`with an empty balance it refuses: "${((await recoverer.getByText(/Send at least/).first().textContent()) ?? '').replace(/\s+/g, ' ').trim()}"`);
  } else {
    log('the balance is not empty: the set-up is left unanswered, so that nothing is paid');
  }

  for (const [name, url] of [['Savings Jar', config.jarUrl], ['loan', config.loanUrl]] as const) {
    if (url === undefined) continue;
    const page = await open(name);
    await page.goto(url);
    const address = page.getByRole('button', { name: 'Copy address' }).first();
    const none = page.getByText('No deployment of Paryon\'s contracts').first();
    await address.or(none).waitFor({ state: 'visible' });
    log((await address.isVisible()) ? `the ${name} page shows the address a wallet connects with` : `the ${name} page says it has no deployment of Paryon's contracts on ${config.network}`);
  }

  for (const problem of problems) log(problem);
  log(problems.length === 0 ? 'no error was logged by any page' : `${problems.length} errors were logged`);
  if (problems.length > 0) process.exitCode = 1;
} catch (error) {
  for (const problem of problems) log(problem);
  log(`FAILED: ${(error as Error).message.split('\n')[0]}`);
  process.exitCode = 1;
} finally {
  await context.close();
  rmSync(profile, { recursive: true, force: true });
}
