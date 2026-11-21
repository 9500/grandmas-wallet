// A look at the pages of a deployment without coins, for checking a build or a release before anyone relies on it:
// the recoverer's page starts as someone helping a person they know, asks for coins as the second step of its first
// run, reads its balance from the chain, and, with an empty balance, offers nothing else; the wallet page starts
// and offers to be set up. The Savings Jar page and the loan page, where the configuration names them, each show
// the address a wallet connects with. Nothing is paid and nothing is sent to the chain. The session between a
// phone and the recoverer's code needs a funded recoverer, and is not part of this look.
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
  await see(recoverer, 'Add coins to your balance');
  const funds = await valueOf(recoverer, 'funds-address');
  const balance = await valueOf(recoverer, 'funds-balance');
  log(`the recoverer's page starts and asks for coins; its balance, read from the chain, is ${balance} satoshis at ${funds}`);
  if (balance === '0') {
    const held = await recoverer.getByRole('button', { name: 'Continue' }).isDisabled();
    const offered = (await recoverer.getByTestId('new-wallet').count()) + (await recoverer.getByRole('link', { name: 'Set up' }).count());
    if (!held || offered > 0) throw new Error('with an empty balance the recoverer\'s page offers to go on');
    log('with an empty balance it offers nothing else: "Continue" is not open, and no code is shown');
  }

  const wallet = await open('wallet');
  await wallet.goto(config.walletUrl);
  await see(wallet, 'Someone I trust is setting it up');
  await see(wallet, 'I have a code from my bank');
  log('the wallet page starts and offers to be set up by a bank or by someone the owner trusts');

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
