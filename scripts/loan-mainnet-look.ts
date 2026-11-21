// Read-only look at the loan page on mainnet, against real mainnet servers and General Protocols' oracle. Sends
// nothing and connects no wallet: it confirms the mainnet statement, then waits for the page to find Paryon's
// contracts and to show the price and what the smallest loan needs.
//
// usage: serve the loan page's build with a configuration that allows mainnet (deploy/serve.mjs, with
// `--connect https://oracles.generalprotocols.com`) at a port of one's choice; then
//   npx tsx scripts/loan-mainnet-look.ts <page address> <directory for pictures of a failure>
// Pictures go to docs/screens of this checkout.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { type BrowserContext, type Page, chromium } from 'playwright';

const SCREENS = fileURLToPath(new URL('../docs/screens', import.meta.url));
const URL_ = process.argv[2] ?? 'http://localhost:8621/';
const OUT = process.argv[3] ?? '.';
const started = Date.now();
const log = (line: string): void => console.log(`${((Date.now() - started) / 1000).toFixed(1).padStart(6)} s  ${line}`);
const problems: string[] = [];

const failed = async (page: Page, name: string, error: unknown): Promise<never> => {
  await page.screenshot({ path: join(OUT, `failed-${name}.png`), fullPage: true });
  writeFileSync(join(OUT, `failed-${name}.txt`), await page.locator('body').innerText());
  throw new Error(`${name}: ${(error as Error).message.split('\n')[0]}`, { cause: error });
};
/** A wait on the page, at most 20 s; a wait on the chain says what it waits for and until when. */
const see = async (page: Page, name: string, text: string | RegExp, chain?: { what: string; seconds: number }): Promise<void> => {
  const timeout = chain === undefined ? 20_000 : chain.seconds * 1000;
  if (chain !== undefined) log(`waiting on the chain for ${chain.what}, until ${new Date(Date.now() + timeout).toISOString().slice(11, 19)} UTC`);
  await page.getByText(text).first().waitFor({ state: 'visible', timeout }).catch((error: unknown) => failed(page, name, error));
};

const profiles: string[] = [];
const contextAt = async (width: number, height: number): Promise<BrowserContext> => {
  const profile = mkdtempSync(join(tmpdir(), 'loan-mainnet-'));
  profiles.push(profile);
  return chromium.launchPersistentContext(profile, { headless: true, viewport: { width, height }, deviceScaleFactor: 2 });
};

const look = async (context: BrowserContext, name: string): Promise<string> => {
  const page = await context.newPage();
  page.setDefaultTimeout(20_000);
  page.on('pageerror', (error) => problems.push(`[${name}] page error: ${error.message.slice(0, 300)}`));
  page.on('console', (message) => {
    if (message.type() === 'error' && !/favicon|Failed to load resource/.test(message.text())) problems.push(`[${name}] console: ${message.text().slice(0, 300)}`);
  });
  await page.goto(URL_);
  await see(page, `${name}-statement`, 'This page uses real Bitcoin Cash');
  await page.screenshot({ path: join(SCREENS, `loan-mainnet-statement-${name}.png`) });
  const behind = await page.getByText('Connect your wallet').count();
  log(`${name}: the statement is shown; the page behind it ${behind === 0 ? 'has not started' : 'HAS STARTED'}`);
  await page.getByRole('button', { name: 'I understand that coins can be lost' }).click();
  const confirmed = Date.now();
  await see(page, `${name}-independent`, /through their deployment on mainnet/);
  await see(page, `${name}-needs`, /Collateral at 150%/, { what: "Paryon's contracts on mainnet and the oracle's price", seconds: 120 });
  const took = ((Date.now() - confirmed) / 1000).toFixed(1);
  const needs = (await page.locator('.card', { hasText: 'needs now' }).first().innerText()).replace(/\s+/g, ' ').trim();
  log(`${name}: Paryon's contracts and the prices read ${took} s after the statement was confirmed`);
  log(`${name}: band "${(await page.locator('.mainnet-band').first().innerText()).trim()}"`);
  await page.screenshot({ path: join(SCREENS, `loan-mainnet-${name}.png`), fullPage: true });
  return needs;
};

const phone = await contextAt(390, 844);
const desktop = await contextAt(1280, 800);
try {
  log(`phone: ${await look(phone, 'phone')}`);
  log(`desktop: ${await look(desktop, 'desktop')}`);
  for (const problem of problems) log(problem);
  log(problems.length === 0 ? 'no error was logged by the page' : `${problems.length} errors were logged`);
} catch (error) {
  for (const problem of problems) log(problem);
  log(`FAILED: ${(error as Error).message.split('\n')[0]}`);
  process.exitCode = 1;
} finally {
  await phone.close();
  await desktop.close();
  for (const profile of profiles) rmSync(profile, { recursive: true, force: true });
}
