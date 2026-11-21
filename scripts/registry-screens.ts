// The wallet page's screens with token names from registries, in a real browser, from the fixtures page (`&registry`):
// no chain, no coins. The page is built as for the public site, with its fixtures page added, and served with the
// content security policy of deploy/serve.mjs.
//
// Checked: the list of tokens names a fungible token by its registry, in its units, with the issuer's claim behind a
// "?"; the Send screen reads a typed amount in the token's decimals and reviews it in its units, the raw amount behind
// the "?"; a review of an application's action shows its chips in the token's units. Nothing sticks out on a phone.
//
// Screenshots go to docs/screens/: registry-tokens, registry-send, registry-send-review and registry-action-review for a
// phone and a desktop; registry-claim and registry-send-claim, the "?" opened, for a phone.
//
// usage (from the repository's root):   npx tsx scripts/registry-screens.ts [--headed]
// Port 8196 must be free.
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { lockingBytecodeToCashAddress } from '@bitauth/libauth';
import { type Browser, type Page, chromium } from 'playwright';

const root = fileURLToPath(new URL('..', import.meta.url));
const headed = process.argv.includes('--headed');
const PORT = 8196;
const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 800 };
const started = Date.now();
const log = (line: string): void => console.log(`${((Date.now() - started) / 1000).toFixed(1).padStart(5)} s  ${line}`);
const wait = (milliseconds: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, milliseconds));

const work = mkdtempSync(join(tmpdir(), 'registry-screens-'));
let browser: Browser | undefined;
const problems: string[] = [];
const check = (ok: boolean, what: string): void => {
  if (!ok) throw new Error(what);
  log(`ok: ${what}`);
};

log('building the wallet page with its fixtures page');
writeFileSync(
  join(work, 'vite.config.mjs'),
  `import base from ${JSON.stringify(join(root, 'apps/wallet/vite.config.mjs'))};
export default { ...base, build: { ...base.build, outDir: ${JSON.stringify(join(work, 'dist'))}, emptyOutDir: true, rolldownOptions: { input: { index: ${JSON.stringify(join(root, 'apps/wallet/index.html'))}, fixtures: ${JSON.stringify(join(root, 'apps/wallet/fixtures.html'))} } } } };
`,
);
execFileSync(process.execPath, [join(root, 'node_modules/vite/bin/vite.js'), 'build', '--config', join(work, 'vite.config.mjs'), '--logLevel', 'warn'], { cwd: join(root, 'apps/wallet'), stdio: 'inherit' });
const server = spawn(process.execPath, ['deploy/serve.mjs', '--root', join(work, 'dist'), '--config', 'deploy/config/local.json', '--host', '127.0.0.1', '--port', String(PORT)], { cwd: root, stdio: 'ignore' });
const answers = (): Promise<boolean> => fetch(`http://127.0.0.1:${PORT}/version.json`).then(() => true, () => false);
for (let attempt = 0; attempt < 60 && !(await answers()); attempt++) await wait(250);
log(`served at http://localhost:${PORT}/ (process ${server.pid})`);
const at = (query: string): string => `http://localhost:${PORT}/fixtures.html?${query}&registry`;

/** A picture of the whole page (of what is in view, with `inView`), on a phone and a desktop; the bars that stay in place stand where they are on the page. */
const shoot = async (page: Page, name: string, sizes: (keyof typeof SIZES)[] = ['phone', 'desktop'], inView = false): Promise<void> => {
  const place = (position: string) =>
    page.evaluate((value) => {
      document.querySelectorAll<HTMLElement>('.request-card .decide').forEach((element) => element.style.setProperty('position', value));
      const bar = document.querySelector<HTMLElement>('.nav');
      if (bar === null || (value !== '' && getComputedStyle(bar).position !== 'fixed')) return;
      bar.style.setProperty('position', value === '' ? '' : 'absolute');
      bar.style.setProperty('top', value === '' ? '' : `${Math.max(document.documentElement.scrollHeight, window.innerHeight) - bar.offsetHeight}px`);
      bar.style.setProperty('bottom', value === '' ? '' : 'auto');
    }, position);
  for (const label of sizes) {
    await page.setViewportSize(SIZES[label]);
    if (!inView) await page.evaluate('document.activeElement?.blur(); window.scrollTo(0, 0)');
    await wait(300);
    if (!inView) await place('static');
    await page.screenshot({ path: `${root}docs/screens/${name}-${label}.png`, fullPage: !inView, animations: 'disabled' });
    if (!inView) await place('');
    log(`screenshot docs/screens/${name}-${label}.png`);
  }
  await page.setViewportSize(PHONE);
};
const SIZES = { phone: PHONE, desktop: DESKTOP };

/** Wait for text on the page, at most 20 seconds; on failure a picture and the page's text are kept. */
const see = async (page: Page, text: string | RegExp): Promise<void> => {
  try {
    // The page's text as shown: what is behind a closed "?" is not in it.
    const pattern = typeof text === 'string' ? { source: text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags: '' } : { source: text.source, flags: text.flags };
    await page.waitForFunction(({ source, flags }) => new RegExp(source, flags).test(document.body.innerText), pattern, { timeout: 20_000 });
  } catch (error) {
    const body = await page.locator('body').innerText().catch(() => '');
    writeFileSync(join(root, 'docs/screens/registry-screens-failure.txt'), body);
    await page.screenshot({ path: join(root, 'docs/screens/registry-screens-failure.png'), fullPage: true }).catch(() => undefined);
    throw new Error(`"${String(text)}" did not appear: ${(error as Error).message.split('\n')[0]}`, { cause: error });
  }
};
const fitsPhone = async (page: Page, what: string): Promise<void> => {
  await page.setViewportSize(PHONE);
  const wide = await page.evaluate(() => document.documentElement.scrollWidth);
  check(wide <= PHONE.width, `${what}: nothing sticks out sideways on a phone (${wide} px of ${PHONE.width})`);
};

try {
  browser = await chromium.launch({ headless: !headed });
  const page = await (await browser.newContext({ viewport: PHONE, deviceScaleFactor: 2, hasTouch: true })).newPage();
  page.setDefaultTimeout(20_000);
  page.on('pageerror', (error) => problems.push(`page error: ${error.message.slice(0, 300)}`));
  page.on('console', (message) => {
    if (message.type() === 'error' && !/favicon/.test(message.text())) problems.push(`console: ${message.text().slice(0, 300)}`);
  });

  // ---------------------------------------------------------------- the list of tokens
  await page.goto(at('show=tokens'));
  await see(page, 'Garden Credits');
  await see(page, '25.000 GARDEN');
  await see(page, '100.00 SCENT');
  // The name is cut at 20 characters in the list.
  check((await page.getByText('Sample Cents of a L…').count()) > 0, 'a long name is cut at 20 characters in the list');
  await fitsPhone(page, 'the list of tokens');
  await shoot(page, 'registry-tokens');
  await page.getByRole('button', { name: 'About the name GARDEN' }).click();
  await see(page, /chose this name and published it on the chain/);
  await see(page, 'Raw amount: 25,000 units, with 3 decimals.');
  await shoot(page, 'registry-claim', ['phone'], true);

  // ---------------------------------------------------------------- sending, in the token's units
  await page.goto(at('show=send-token'));
  await see(page, 'Garden Credits');
  await page.locator('#token-amount').fill('12.5');
  const to = lockingBytecodeToCashAddress({ prefix: 'bchtest', bytecode: Uint8Array.of(0x76, 0xa9, 0x14, ...new Uint8Array(20).fill(0x44), 0x88, 0xac), tokenSupport: true });
  if (typeof to === 'string') throw new Error(to);
  await page.locator('#token-to').fill(to.address);
  await fitsPhone(page, 'the Send screen');
  await shoot(page, 'registry-send');
  await page.locator('#token-amount').fill('12.5001');
  await page.getByRole('button', { name: 'Review' }).click();
  await see(page, /3 decimals; the amount has more. Nothing is rounded/);
  await page.locator('#token-amount').fill('12.5');
  await page.getByRole('button', { name: 'Review' }).click();
  await see(page, 'Check and send');
  await see(page, '12.500 GARDEN');
  await fitsPhone(page, 'the review of a send');
  await shoot(page, 'registry-send-review');
  await page.getByRole('button', { name: 'About the name GARDEN' }).click();
  await see(page, 'Raw amount: 12,500 units, with 3 decimals.');
  await shoot(page, 'registry-send-claim', ['phone'], true);

  // ---------------------------------------------------------------- an application's action
  await page.goto(at('show=review'));
  await see(page, /SCENT/);
  await fitsPhone(page, 'the review of an action');
  await shoot(page, 'registry-action-review');

  check(problems.length === 0, `no errors on the page${problems.length === 0 ? '' : `: ${problems.join(' | ')}`}`);
  log('done');
} finally {
  await browser?.close();
  server.kill();
  rmSync(work, { recursive: true, force: true });
}
