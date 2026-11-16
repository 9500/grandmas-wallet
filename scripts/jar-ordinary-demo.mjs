// Drives the Savings Jar page in a real browser with an ordinary wallet on the command line
// (scripts/ordinary-wallet.ts) connected over WizardConnect: open a jar, then empty it after its lock.
//
// usage: node scripts/jar-ordinary-demo.mjs [--config deploy/config/local.json] [--amount 3000] [--name ordinary]
//                                           [--profile <directory>] [--shots <directory>] [--only open|empty]
//
// The wallet's first address needs test coins; run scripts/ordinary-wallet.ts without an address to see it.
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { chromium } from 'playwright';

const argument = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1];
};
const config = JSON.parse(readFileSync(resolve(argument('config', 'deploy/config/local.json')), 'utf8'));
const amount = argument('amount', '3000');
const name = argument('name', 'ordinary');
const only = argument('only');
const shots = argument('shots');
if (shots !== undefined) mkdirSync(shots, { recursive: true });
const profile = resolve(argument('profile', '.xo-demo/browser/jar-ordinary'));
mkdirSync(profile, { recursive: true });
const MINUTE = 60_000;

const started = Date.now();
const say = (message) => console.log(`[${String(Math.round((Date.now() - started) / 1000)).padStart(4)}s] ${message}`);

const context = await chromium.launchPersistentContext(profile, { viewport: { width: 760, height: 1100 } });
for (const blank of context.pages()) await blank.close();
const page = await context.newPage();
page.on('pageerror', (error) => say(`  ! ${error.message.slice(0, 200)}`));
let wallet;
let shot = 0;
const picture = async (label) => {
  if (shots === undefined) return;
  shot += 1;
  await page.screenshot({ path: resolve(shots, `${String(shot).padStart(2, '0')}-${label}.png`), fullPage: true });
};
const alertText = async () => {
  const alert = page.getByRole('alert').first();
  return (await alert.isVisible().catch(() => false)) ? alert.innerText() : undefined;
};
const expectText = async (text, timeout, where) => {
  const deadline = Date.now() + timeout;
  for (;;) {
    if (await page.getByText(text, { exact: false }).first().isVisible().catch(() => false)) return;
    const problem = await alertText();
    if (problem !== undefined) throw new Error(`${where}: ${problem}`);
    if (Date.now() > deadline) throw new Error(`${where}: "${text}" did not appear`);
    await page.waitForTimeout(1_000);
  }
};

try {
  await page.goto(config.jarUrl);
  await page.getByText(/Connect your wallet|Your savings jars/).first().waitFor({ timeout: MINUTE });
  if (!(await page.getByText('Your savings jars').first().isVisible().catch(() => false))) {
    const forget = page.getByRole('button', { name: 'Forget the earlier connection' });
    if (await forget.isVisible().catch(() => false)) await forget.click();
    const address = page.locator('.copybox code').first();
    await address.waitFor({ timeout: MINUTE });
    const uri = (await address.innerText()).trim();
    await picture('connect');
    say(`Application shows ${uri.slice(0, 40)}…`);
    wallet = spawn('node', ['--import', 'tsx', 'scripts/ordinary-wallet.ts', '--name', name, uri], { stdio: ['ignore', 'pipe', 'inherit'] });
    wallet.stdout.on('data', (data) => String(data).trim().split('\n').forEach((line) => say(`  wallet: ${line}`)));
  }
  await expectText('Your savings jars', 2 * MINUTE, 'connecting');
  await expectText('Your wallet holds', 2 * MINUTE, 'reading the coins');
  say(`Application: ${(await page.getByText('Your wallet holds').first().innerText()).trim()}`);
  await picture('connected');

  if (only !== 'empty') {
    await page.getByPlaceholder('0').fill(amount);
    await page.getByPlaceholder('Holiday').fill('Holiday');
    await page.getByRole('button', { name: 'Open a savings jar' }).click();
    await expectText('Done.', 3 * MINUTE, 'opening the jar');
    await expectText('Locked until', MINUTE, 'listing the jar');
    await picture('opened');
    say('Application: the jar is open');
  }
  if (only !== 'open') {
    // The jar is locked for ten minutes, and the network's clock runs behind.
    for (let attempt = 0; ; attempt++) {
      const withdraw = page.getByRole('button', { name: 'Withdraw' }).first();
      await withdraw.waitFor({ timeout: 3 * MINUTE });
      if (await withdraw.isEnabled()) {
        await withdraw.click();
        await page.waitForTimeout(15_000);
        if (await page.getByText('No jars yet.').first().isVisible().catch(() => false)) break;
        const problem = await alertText();
        if (problem !== undefined) say(`Application: ${problem.slice(0, 160)}`);
      }
      if (attempt > 60) throw new Error('the jar could not be emptied');
      await page.waitForTimeout(45_000);
      await page.reload();
      await expectText('Your wallet holds', 2 * MINUTE, 'reading the coins');
    }
    await picture('emptied');
    say(`Application: the jar is emptied. ${(await page.getByText('Your wallet holds').first().innerText()).trim()}`);
  }
  say('Done.');
} catch (error) {
  say(`FAILED: ${error.message}`);
  await picture('failure').catch(() => undefined);
  process.exitCode = 1;
} finally {
  wallet?.kill();
  await context.close().catch(() => undefined);
}
