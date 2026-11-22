// The Applications screen's templates in a real browser, from the fixtures page (`show=apps&file=`): no chain, no coins,
// nothing stored or sent. The page is built as for the public site, with its fixtures page added, and served with the
// content security policy of deploy/serve.mjs.
//
// Checked: a template's screen has its way back left of its heading, and so has every other screen under Apps; a tap
// on the Apps tab inside one brings back the list. Stopping to trust a template offers to delete it too, with what that
// does behind a "?", and asks for the tick while a token of it is held; deleted, it is neither listed nor suggested. A
// template the user stopped trusting can be deleted from its screen. A template is added from a file or as pasted text,
// read on the page and reviewed as an app's offer is; what is not JSON, not a template, too large, or trusted already is
// refused or opened in plain words. Nothing sticks out on a phone.
//
// usage (from the repository's root):   npx tsx scripts/template-file-screens.ts [--out <directory>] [--headed]
// Screenshots go to the directory given (docs/screens/ unless given), named template-file-<what>-<phone|desktop>.png.
// Port 8197 must be free.
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { type Browser, type Page, chromium } from 'playwright';

const root = fileURLToPath(new URL('..', import.meta.url));
const headed = process.argv.includes('--headed');
const outAt = process.argv.indexOf('--out');
const out = outAt === -1 ? join(root, 'docs/screens') : resolve(process.argv[outAt + 1] ?? '.');
mkdirSync(out, { recursive: true });
const PORT = 8197;
const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 800 };
const SIZES = { phone: PHONE, desktop: DESKTOP };
const started = Date.now();
const log = (line: string): void => console.log(`${((Date.now() - started) / 1000).toFixed(1).padStart(5)} s  ${line}`);
const wait = (milliseconds: number): Promise<void> => new Promise((done) => setTimeout(done, milliseconds));
const check = (ok: boolean, what: string): void => {
  if (!ok) throw new Error(what);
  log(`ok: ${what}`);
};

const work = mkdtempSync(join(tmpdir(), 'template-file-screens-'));
let browser: Browser | undefined;
const problems: string[] = [];

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
const at = (query: string): string => `http://localhost:${PORT}/fixtures.html?show=apps&${query}`;

/** A picture of the whole page (of what is in view, with `inView`), on a phone and a desktop; the bar at the bottom stands where it is on the page. */
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
    const path = join(out, `template-file-${name}-${label}.png`);
    await page.screenshot({ path, fullPage: !inView, animations: 'disabled' });
    if (!inView) await place('');
    log(`screenshot ${path}`);
  }
  await page.setViewportSize(PHONE);
};

/** Wait for text on the page, at most 10 seconds. */
const see = async (page: Page, text: string | RegExp): Promise<void> => {
  const pattern = typeof text === 'string' ? { source: text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags: '' } : { source: text.source, flags: text.flags };
  try {
    await page.waitForFunction(({ source, flags }) => new RegExp(source, flags).test(document.body.innerText), pattern, { timeout: 10_000 });
  } catch (error) {
    await page.screenshot({ path: join(out, 'template-file-failure.png'), fullPage: true }).catch(() => undefined);
    throw new Error(`"${String(text)}" did not appear: ${(error as Error).message.split('\n')[0]}`, { cause: error });
  }
};
const absent = async (page: Page, text: string): Promise<boolean> => !(await page.locator('body').innerText()).includes(text);
const fitsPhone = async (page: Page, what: string): Promise<void> => {
  await page.setViewportSize(PHONE);
  const wide = await page.evaluate(() => document.documentElement.scrollWidth);
  check(wide <= PHONE.width, `${what}: nothing sticks out sideways on a phone (${wide} px of ${PHONE.width})`);
};
/** The back button sits left of the heading, on the heading's first line. */
const backBesideHeading = async (page: Page, what: string): Promise<void> => {
  for (const size of ['phone', 'desktop'] as const) {
    await page.setViewportSize(SIZES[size]);
    const back = await page.getByRole('button', { name: 'Back', exact: true }).boundingBox();
    const heading = await page.locator('h1').first().boundingBox();
    check(back !== null && heading !== null && back.x + back.width <= heading.x + 1 && Math.abs(back.y + back.height / 2 - (heading.y + 17)) < 12, `${what}: the back button is left of the heading, on its first line (${size})`);
  }
  await page.setViewportSize(PHONE);
};
const choose = (page: Page, name: string, text: string): Promise<void> => page.locator('input[type=file]').setInputFiles({ name, mimeType: 'application/json', buffer: Buffer.from(text) });

try {
  browser = await chromium.launch({ headless: !headed });
  const page = await (await browser.newContext({ viewport: PHONE, deviceScaleFactor: 2, hasTouch: true })).newPage();
  page.setDefaultTimeout(10_000);
  page.on('pageerror', (error) => problems.push(`page error: ${error.message.slice(0, 300)}`));
  page.on('console', (message) => {
    if (message.type() === 'error' && !/favicon|Failed to load resource/.test(message.text())) problems.push(`console: ${message.text().slice(0, 300)}`);
  });

  // ---------------------------------------------------------------- a trusted template's screen, and the way back
  await page.goto(at('file=trusted'));
  await page.getByTestId('template-row').click();
  await see(page, 'Trusted since');
  await see(page, 'By you, not by an app');
  check(await absent(page, 'Apps that see its tokens'), 'a template added from a file suggests no app');
  await backBesideHeading(page, 'the template\'s screen');
  check((await page.getByRole('button', { name: 'Back', exact: true }).count()) === 1, 'the template\'s screen has one back control');
  await fitsPhone(page, 'the template\'s screen');
  await shoot(page, 'template');
  await shoot(page, 'template-top', ['phone', 'desktop'], true);
  // The Apps tab, tapped inside the template's screen, brings back the list.
  await page.locator('.nav a', { hasText: 'Apps' }).first().click();
  await see(page, 'Connect an app');
  check(await absent(page, 'Trusted since'), 'tapping the Apps tab inside a template\'s screen brings back the list (phone)');
  await page.setViewportSize(DESKTOP);
  await page.getByTestId('template-row').click();
  await see(page, 'Trusted since');
  await page.locator('.nav a', { hasText: 'Apps' }).first().click();
  await see(page, 'Connect an app');
  check(await absent(page, 'Trusted since'), 'tapping the Apps tab inside a template\'s screen brings back the list (desktop)');
  await page.setViewportSize(PHONE);
  // The back button, too.
  await page.getByTestId('template-row').click();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await see(page, 'Connect an app');

  // ---------------------------------------------------------------- stopping to trust, and deleting
  await page.getByTestId('template-row').click();
  await page.getByRole('button', { name: 'Stop trusting this template' }).click();
  await see(page, 'Your backup keeps the template');
  await shoot(page, 'stop');
  await page.getByText('Also delete it from this wallet').click();
  await see(page, 'Stop and delete');
  await see(page, 'no longer listed or offered to you again');
  await fitsPhone(page, 'the deletion step');
  await shoot(page, 'delete');
  await page.getByRole('button', { name: 'About deleting a template' }).click();
  await see(page, /it is marked as deleted, and no phone offers it again/);
  await page.getByRole('button', { name: 'About deleting a template' }).scrollIntoViewIfNeeded();
  await shoot(page, 'delete-info', ['phone'], true);
  await page.getByRole('button', { name: 'About deleting a template' }).click();
  await page.getByRole('button', { name: 'Stop and delete' }).click();
  // The toast is the page's own; the fixtures page shows none.
  await see(page, 'Connect an app');
  check((await page.getByTestId('template-row').count()) === 0 && (await page.getByTestId('template-row-untrusted').count()) === 0, 'deleted: neither listed nor suggested');
  await see(page, 'None yet.');

  // With a token of it held: the warning and the tick, and nothing until it is ticked.
  await page.goto(at('file=trusted&holds'));
  await page.getByTestId('template-row').click();
  await page.getByRole('button', { name: 'Stop trusting this template' }).click();
  await page.getByText('Also delete it from this wallet').click();
  await see(page, 'You hold a token of this template: Box key.');
  check(await page.getByRole('button', { name: 'Stop and delete' }).isDisabled(), 'while a token is held, nothing is deleted before the tick');
  await fitsPhone(page, 'the deletion step with its warning');
  await shoot(page, 'delete-warning');
  await page.getByText('I understand, delete it anyway').click();
  check(await page.getByRole('button', { name: 'Stop and delete' }).isEnabled(), 'ticked, the deletion can go ahead');
  await shoot(page, 'delete-ticked', ['phone']);

  // A template the user stopped trusting: the suggestion's screen offers to delete it.
  await page.goto(at('file=withdrawn&holds'));
  await page.getByTestId('template-row-untrusted').click();
  await see(page, 'You stopped trusting this template. Your backup still holds it.');
  await backBesideHeading(page, 'the suggestion\'s screen');
  await shoot(page, 'suggestion');
  await page.getByRole('button', { name: 'Delete it from this wallet' }).click();
  await see(page, 'You hold a token of this template: Box key.');
  await fitsPhone(page, 'the suggestion\'s deletion');
  await shoot(page, 'suggestion-delete');
  await page.getByText('I understand, delete it anyway').click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await see(page, 'Connect an app');
  check((await page.getByTestId('template-row-untrusted').count()) === 0, 'the suggestion, deleted, is gone');

  // ---------------------------------------------------------------- adding one from a file
  await page.goto(at('file=none'));
  await see(page, 'Add from a file');
  await fitsPhone(page, 'the Applications screen with the way to add a template');
  await shoot(page, 'entry');
  // Refusals, each in plain words, nothing trusted.
  await choose(page, 'notes.json', 'These are my notes.');
  await see(page, 'This file is not JSON.');
  await shoot(page, 'refused-not-json');
  await choose(page, 'list.json', JSON.stringify({ name: 'A list', items: [1, 2, 3] }));
  await see(page, /This is not an XO template: /);
  await fitsPhone(page, 'a file that is not a template');
  await shoot(page, 'refused-not-template');
  await choose(page, 'large.json', `"${' '.repeat(400_001)}"`);
  await see(page, 'The file is too large for a template. A template can have at most 400,000 characters.');
  await shoot(page, 'refused-too-large', ['phone']);
  // Pasting, the same checks.
  await page.getByRole('button', { name: 'Paste it instead' }).click();
  await page.locator('#template-text').fill('{ "half": ');
  await page.getByRole('button', { name: 'Check it' }).click();
  await see(page, 'This text is not JSON.');
  await shoot(page, 'paste', ['phone']);
  await page.getByRole('button', { name: 'Cancel' }).click();

  // The example template: its review, marked as from a file on this phone, with its service named.
  const exampleText = await page.evaluate(() => (window as unknown as { exampleTemplate?: string }).exampleTemplate ?? '');
  check(exampleText !== '', 'the fixtures page gives the example template\'s text');
  await choose(page, 'money-box.json', exampleText);
  await see(page, 'A template from a file');
  await see(page, 'From a file on this phone');
  await backBesideHeading(page, 'the review of a template from a file');
  await page.getByText('Technical details').click();
  await see(page, 'box.example.org');
  await fitsPhone(page, 'the review of a template from a file');
  await shoot(page, 'review');
  await page.getByRole('button', { name: 'Where this template comes from' }).click();
  await see(page, /The wallet read it on this phone and sent it nowhere/);
  await shoot(page, 'review-info', ['phone'], true);
  await page.getByRole('button', { name: 'Where this template comes from' }).click();
  await page.getByRole('button', { name: 'Trust this template' }).click();
  await see(page, 'Trusted since');
  await see(page, 'By you, not by an app');
  await shoot(page, 'trusted');
  // Chosen again: it is trusted already, and its screen opens.
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await choose(page, 'money-box.json', exampleText);
  await see(page, 'Trusted since');
  await shoot(page, 'already-trusted', ['phone']);

  check(problems.length === 0, `no errors on the page${problems.length === 0 ? '' : `: ${problems.join(' | ')}`}`);
  log('done');
} finally {
  await browser?.close();
  server.kill();
  rmSync(work, { recursive: true, force: true });
}
