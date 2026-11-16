// Drives the Savings Jar page with the Cashonize web wallet (https://cashonize.com) on chipnet, in one
// browser profile kept on disk so that the wallet's keys outlive the run.
//
// usage: node scripts/jar-cashonize-demo.mjs --step setup    make a chipnet wallet in Cashonize, print its address
//        node scripts/jar-cashonize-demo.mjs --step open     connect to the jar page and open a jar
//        node scripts/jar-cashonize-demo.mjs --step empty    wait for the jar's lock and empty it
//   [--config deploy/config/local.json] [--amount 3000] [--profile <directory>] [--shots <directory>]
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { chromium } from 'playwright';

const argument = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1];
};
const config = JSON.parse(readFileSync(resolve(argument('config', 'deploy/config/local.json')), 'utf8'));
const step = argument('step', 'setup');
const amount = argument('amount', '3000');
const shots = argument('shots');
if (shots !== undefined) mkdirSync(shots, { recursive: true });
const profile = resolve(argument('profile', '.xo-demo/browser/cashonize'));
mkdirSync(profile, { recursive: true });
const WALLET = 'https://cashonize.com';
const MINUTE = 60_000;

const started = Date.now();
const say = (message) => console.log(`[${String(Math.round((Date.now() - started) / 1000)).padStart(4)}s] ${message}`);
const context = await chromium.launchPersistentContext(profile, { viewport: { width: 900, height: 1100 } });
await context.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => undefined);
for (const blank of context.pages()) await blank.close();
let shot = 0;
const picture = async (page, label) => {
  if (shots === undefined) return;
  shot += 1;
  await page.screenshot({ path: resolve(shots, `${String(shot).padStart(2, '0')}-${step}-${label}.png`), fullPage: true });
};
const dialogOf = async (page, timeout = MINUTE) => {
  const dialog = page.locator('.q-dialog:visible').last();
  await dialog.waitFor({ state: 'visible', timeout });
  return dialog;
};

const wallet = await context.newPage();
wallet.on('pageerror', (error) => say(`  ! wallet: ${error.message.slice(0, 200)}`));
let jar;
try {
  await wallet.goto(WALLET);
  if (step === 'setup') {
    await wallet.getByRole('button', { name: 'Create new wallet' }).click();
    await wallet.getByRole('button', { name: 'Create wallet' }).click();
    await wallet.getByRole('button', { name: 'Finish Setup' }).click();
    await wallet.locator('nav').waitFor({ timeout: MINUTE });
    await wallet.locator('nav img[src*="settings"]').click();
    await wallet.getByText('Developer settings').click();
    await wallet.getByText('Add development wallet').click();
    await wallet.locator('#addWalletNetwork').waitFor({ timeout: MINUTE });
    say(`Network for the new wallet: ${await wallet.locator('#addWalletNetwork').inputValue()}`);
    await wallet.getByRole('button', { name: 'Continue' }).click();
    await wallet.getByRole('button', { name: 'Create new wallet' }).click();
    await wallet.locator('.depositAddr').first().waitFor({ timeout: MINUTE });
  }
  await wallet.locator('nav').waitFor({ timeout: MINUTE });
  const deposit = wallet.locator('.depositAddr').first();
  if (await deposit.isVisible().catch(() => false)) say(`Cashonize receives at ${(await deposit.innerText()).trim()}`);
  await picture(wallet, 'wallet');
  if (step === 'setup') {
    say('Done.');
  } else {
    jar = await context.newPage();
    jar.on('pageerror', (error) => say(`  ! jar: ${error.message.slice(0, 200)}`));
    await jar.goto(config.jarUrl);
    await jar.getByText(/Connect your wallet|Your savings jars/).first().waitFor({ timeout: MINUTE });
    // A session from an earlier step is resumed by both sides; otherwise pair now.
    const resumed = await jar
      .getByText('Your savings jars')
      .first()
      .waitFor({ timeout: 20_000 })
      .then(() => true, () => false);
    if (!resumed) {
      const forget = jar.getByRole('button', { name: 'Forget the earlier connection' });
      if (await forget.isVisible().catch(() => false)) await forget.click();
      const address = jar.locator('.copybox code').first();
      await address.waitFor({ timeout: MINUTE });
      const uri = (await address.innerText()).trim();
      say(`Jar page shows ${uri.slice(0, 40)}…`);
      await wallet.bringToFront();
      await wallet.locator('nav').getByText('Connect', { exact: true }).click();
      await wallet.getByPlaceholder('Connection URI').fill(uri);
      await wallet.locator('input.primaryButton[value*="Connect"]').click();
      const consent = await dialogOf(wallet);
      await picture(wallet, 'consent');
      await consent.getByRole('button', { name: 'Connect', exact: true }).click();
      await jar.getByText('Your savings jars').first().waitFor({ timeout: 2 * MINUTE });
    }
    say(`Jar page: ${(await jar.locator('.pill.ok').first().innerText()).trim()}`);
    await jar.getByText('Your wallet holds').first().waitFor({ timeout: 2 * MINUTE });
    say(`Jar page: ${(await jar.getByText('Your wallet holds').first().innerText()).trim()}`);
    await picture(jar, 'connected');

    const signInWallet = async (label) => {
      const dialog = await dialogOf(wallet, 2 * MINUTE);
      await wallet.bringToFront();
      await picture(wallet, `${label}-request`);
      say(`Cashonize asks: ${(await dialog.innerText()).replaceAll(/\s+/g, ' ').slice(0, 300)}`);
      await dialog.getByRole('button', { name: 'Sign' }).click();
    };
    const alertText = async () => {
      const alert = jar.getByRole('alert').first();
      return (await alert.isVisible().catch(() => false)) ? alert.innerText() : undefined;
    };

    if (step === 'open') {
      await jar.getByPlaceholder('0').fill(amount);
      await jar.getByPlaceholder('Holiday').fill('Holiday');
      await jar.getByRole('button', { name: 'Open a savings jar' }).click();
      await signInWallet('open');
      for (let waited = 0; ; waited++) {
        if (await jar.getByText('Done.').first().isVisible().catch(() => false)) break;
        const problem = await alertText();
        if (problem !== undefined) throw new Error(`opening the jar: ${problem}`);
        if (waited > 120) throw new Error('opening the jar: no answer');
        await jar.waitForTimeout(1_000);
      }
      await jar.getByText('Locked until').first().waitFor({ timeout: MINUTE });
      await picture(jar, 'opened');
      say('Jar page: the jar is open');
    }
    if (step === 'empty') {
      for (let attempt = 0; ; attempt++) {
        const withdraw = jar.getByRole('button', { name: 'Withdraw' }).first();
        await withdraw.waitFor({ timeout: 3 * MINUTE });
        if (await withdraw.isEnabled()) {
          await withdraw.click();
          await signInWallet('empty');
          await jar.waitForTimeout(15_000);
          if (await jar.getByText('No jars yet.').first().isVisible().catch(() => false)) break;
          const problem = await alertText();
          if (problem !== undefined) say(`Jar page: ${problem.slice(0, 200)}`);
        }
        if (attempt > 60) throw new Error('the jar could not be emptied');
        await jar.waitForTimeout(45_000);
      }
      await picture(jar, 'emptied');
      say(`Jar page: the jar is emptied. ${(await jar.getByText('Your wallet holds').first().innerText()).trim()}`);
    }
    say('Done.');
  }
} catch (error) {
  say(`FAILED: ${error.message}`);
  await picture(wallet, 'failure-wallet').catch(() => undefined);
  if (jar !== undefined) await picture(jar, 'failure-jar').catch(() => undefined);
  process.exitCode = 1;
} finally {
  await context.close().catch(() => undefined);
}
