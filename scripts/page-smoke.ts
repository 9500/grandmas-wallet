// A look at the two pages without coins: the recoverer's page gives its link, the wallet page takes it in,
// opens the device's keys in the XO engine (which checks the chain's block headers first) and shows the
// address for the first coins. Nothing is paid. For trying a build or a deployment on a network before a
// run that costs coins and time.
//
// usage (from the repository's root):
//   npx tsx scripts/page-smoke.ts <configuration file>     e.g. deploy/config/local.json with deploy/preview.sh start chipnet
import { readFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';

const root = fileURLToPath(new URL('..', import.meta.url));
const config = JSON.parse(readFileSync(process.argv[2] ?? `${root}deploy/config/local.json`, 'utf8')) as { walletUrl: string; recovererUrl: string; network: string };
const started = Date.now();
const log = (line: string): void => console.log(`${((Date.now() - started) / 1000).toFixed(0).padStart(4)} s  ${line}`);

const profile = `${root}.chipnet/page-smoke/`;
rmSync(profile, { recursive: true, force: true });
const context = await chromium.launchPersistentContext(profile, { headless: true, viewport: { width: 390, height: 844 } });
const problems: string[] = [];
const open = async (name: string) => {
  const page = await context.newPage();
  page.on('pageerror', (error) => problems.push(`[${name}] page error: ${error.message.slice(0, 300)}`));
  page.on('console', (message) => {
    if (message.type() === 'error' && !/favicon|Failed to load resource/.test(message.text())) problems.push(`[${name}] console: ${message.text().slice(0, 300)}`);
  });
  return page;
};
try {
  const recoverer = await open('recoverer');
  await recoverer.goto(`${config.recovererUrl}link`);
  await recoverer.getByLabel('Your name, as their wallet shows it').fill('Anna');
  const linkBox = recoverer.getByTestId('recoverer-link').first();
  await linkBox.waitFor({ state: 'visible', timeout: 60_000 });
  await recoverer.waitForTimeout(500);
  const link = (await linkBox.getAttribute('data-value')) ?? '';
  log(`the recoverer's page (${config.network}) gives a link of ${link.length} characters`);
  const wallet = await open('wallet');
  await wallet.goto(link);
  await wallet.getByRole('button', { name: /Make a new wallet/ }).first().click();
  await wallet.getByLabel('The fingerprints are the same').first().check();
  await wallet.getByRole('button', { name: 'Continue' }).first().click();
  log('the wallet page opens the device\'s keys in the engine');
  const address = wallet.getByTestId('funding-address').first();
  await address.waitFor({ state: 'visible', timeout: 600_000 });
  log(`the engine is open and the page shows the address for the first coins: ${await address.getAttribute('data-value')}`);
  for (const problem of problems) log(problem);
  log(problems.length === 0 ? 'no error was logged by either page' : `${problems.length} errors were logged`);
} catch (error) {
  for (const problem of problems) log(problem);
  log(`FAILED: ${(error as Error).message.split('\n')[0]}`);
  process.exitCode = 1;
} finally {
  await context.close();
}
