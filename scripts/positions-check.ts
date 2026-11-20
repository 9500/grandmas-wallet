// The wallet page's screens for a template that comes alone, in a real browser, from the fixtures page:
// no chain, no coins. The page is built as for the public site, with its fixtures page added, and served with the
// content security policy of deploy/serve.mjs.
//
// Checked: a request whose token leaves the wallet says so in view, and its Approve button works only once the box is
// ticked, a box a thumb can hit; a request whose record no backup store can take is not offered for approval, and
// says so; an action that would tie money to the phone, and one of which the wallet cannot tell, are refused in place
// of the review, with no Approve button and the wallet's full reason behind a "?"; a template offered with such actions
// names them. The list of tokens: positions from records with the template's names, a token whose record names no
// script with no word on whether it is open, a token with no record, and apart and greyed, a position that is not
// confirmed, which offers taking out and not paying in; an action only the application can do, with its page as a
// link. Acting from the list: the value the action needs is asked for, then the same review as for a request.
//
// Screenshots, for a phone and a desktop, go to docs/screens/: apps-tick-review, apps-tick-ticked, apps-backup-unreachable,
// apps-refused-tied, apps-refused-unclear, apps-offer-findings, apps-positions, apps-act-form and apps-act-review.
//
// usage (from the repository's root):   npx tsx scripts/positions-check.ts [--headed] [--no-screens]
// It takes a few seconds after the build. Port 8197 must be free.
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { type Browser, type Locator, type Page, chromium } from 'playwright';

const root = fileURLToPath(new URL('..', import.meta.url));
const headed = process.argv.includes('--headed');
const screens = !process.argv.includes('--no-screens');
const PORT = 8197;
const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 800 };
const started = Date.now();
const log = (line: string): void => console.log(`${((Date.now() - started) / 1000).toFixed(1).padStart(5)} s  ${line}`);
const wait = (milliseconds: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, milliseconds));

const work = mkdtempSync(join(tmpdir(), 'positions-check-'));
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
log(`served at http://localhost:${PORT}/ with the content security policy of deploy/serve.mjs`);
const at = (query: string): string => `http://localhost:${PORT}/fixtures.html?${query}`;

/** A screenshot of the whole page, on a phone and on a desktop; the decision bar where it stands on the page. */
const shoot = async (page: Page, name: string): Promise<void> => {
  if (!screens) return;
  for (const [label, size] of [['phone', PHONE], ['desktop', DESKTOP]] as const) {
    await page.setViewportSize(size);
    await page.evaluate('window.scrollTo(0, 0)');
    await wait(300);
    // A whole page in one picture would draw the bar at the foot of a phone's screen, and the buttons that stay there,
    // halfway down it: there, they stand where they are on the page.
    const place = (position: string) =>
      page.evaluate((value) => {
        document.querySelectorAll<HTMLElement>('.request-card .decide').forEach((element) => element.style.setProperty('position', value));
        // The bar at the foot of a phone's screen goes to the foot of the page.
        const bar = document.querySelector<HTMLElement>('.nav');
        if (bar === null || (value !== '' && getComputedStyle(bar).position !== 'fixed')) return;
        bar.style.setProperty('position', value === '' ? '' : 'absolute');
        bar.style.setProperty('top', value === '' ? '' : `${Math.max(document.documentElement.scrollHeight, window.innerHeight) - bar.offsetHeight}px`);
        bar.style.setProperty('bottom', value === '' ? '' : 'auto');
      }, position);
    await place('static');
    await page.screenshot({ path: `${root}docs/screens/${name}-${label}.png`, fullPage: true, animations: 'disabled' });
    await place('');
    log(`screenshot docs/screens/${name}-${label}.png`);
  }
  await page.setViewportSize(PHONE);
};

const box = async (locator: Locator): Promise<{ x: number; y: number; width: number; height: number }> => {
  const found = await locator.boundingBox();
  if (found === null) throw new Error('not on the screen');
  return found;
};
/** Nothing sticks out of the page sideways on a phone. */
const fitsPhone = async (page: Page, what: string): Promise<void> => {
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

  // ---------------------------------------------------------------- the tick
  await page.goto(at('show=apps&request=tick'));
  const card = page.locator('.request-card');
  const approve = page.getByRole('button', { name: 'Approve' });
  await approve.waitFor();
  const leaving = card.getByTestId('tokens-leaving');
  check(await leaving.getByText('A new token goes elsewhere').isVisible(), 'a token made from the wallet\'s coin that goes to the application is said in view');
  check(await leaving.getByText('Made now from your coin, it goes to "Key, waiting", not to this wallet.').isVisible(), 'with where it goes, in the template\'s name for it');
  check(await approve.isDisabled(), 'Approve does not work before the tick');
  const tickBox = leaving.locator('label.choice');
  const target = await box(tickBox);
  check(target.height >= 44 && target.width >= PHONE.width - 120, `the tick is a box a thumb can hit: the whole line, ${Math.round(target.width)} by ${Math.round(target.height)} px`);
  check((await card.getByText('Not verified', { exact: true }).count()) === 0, 'an action that comes back has no word on the template beyond the review');
  await fitsPhone(page, 'the tick');
  await shoot(page, 'apps-tick-review');
  await tickBox.tap();
  check(await approve.isEnabled(), 'Approve works once the box is ticked');
  await shoot(page, 'apps-tick-ticked');
  await tickBox.tap();
  check(await approve.isDisabled(), 'and stops working when it is unticked');

  // ---------------------------------------------------------------- no store answers
  await page.goto(at('show=apps&request=backup'));
  await page.getByText('Your backup can\'t be reached. Try again in a moment.').waitFor();
  check((await page.getByRole('button', { name: 'Approve' }).count()) === 0, 'with no backup store answering, the action is not offered for approval');
  check(await page.getByRole('button', { name: 'Try again' }).isVisible(), 'and can be tried again');
  check(await page.getByRole('button', { name: 'Decline' }).isVisible(), 'or declined');
  await fitsPhone(page, 'no store answers');
  await shoot(page, 'apps-backup-unreachable');

  // ---------------------------------------------------------------- refusals
  for (const [request, words, name] of [
    ['tied', 'This would tie money to this phone alone. If the phone is lost, nobody can get it back.', 'apps-refused-tied'],
    ['unclear', 'It can\'t tell whether this money would come back if the phone is lost.', 'apps-refused-unclear'],
  ] as const) {
    await page.goto(at(`show=apps&request=${request}`));
    const refusal = page.getByTestId('refusal');
    await refusal.waitFor();
    check(await refusal.getByText('This wallet won\'t do this').isVisible(), `${request}: the refusal stands in place of the review`);
    check(await refusal.getByText(words).isVisible(), `${request}: "${words}", in view`);
    check((await page.getByRole('button', { name: 'Approve' }).count()) === 0 && (await page.locator('.review').count()) === 0, `${request}: no review, and no Approve button`);
    const why = refusal.getByRole('button', { name: 'Why' });
    await why.tap();
    const detail = page.locator(`[id="${await why.getAttribute('aria-controls')}"]`);
    check(/does not carry it out/.test(await detail.innerText()), `${request}: the wallet's full reason behind the "?"`);
    await why.tap();
    await fitsPhone(page, request);
    await shoot(page, name);
  }

  // ---------------------------------------------------------------- a template shown with what the wallet found
  await page.goto(at('show=apps&offer=pool'));
  await page.getByText('offers its template').waitFor();
  check(await page.getByText('This wallet won\'t do "Open a pool".').isVisible(), 'a template offered names the action this wallet refuses');
  check(await page.getByRole('button', { name: 'Trust this template' }).isVisible(), 'and can still be trusted: only that action is refused');
  await shoot(page, 'apps-offer-findings');

  // ---------------------------------------------------------------- the list of positions from records
  await page.goto(at('show=apps&records'));
  const list = page.locator('.tokens-card');
  await list.getByText('Not confirmed').waitFor();
  const open = list.locator('[data-testid="position-open"]').first();
  check((await open.locator('.token-title').innerText()).replace(/\s+/g, ' ').trim() === 'Box key · Example money box (test network)', 'a confirmed position by the template\'s name for its token and the template\'s name');
  check(await open.getByText('Open', { exact: true }).isVisible() && /Holds/.test(await open.innerText()), 'open, and what it holds');
  check(await open.getByRole('button', { name: 'Take everything out', exact: true }).isVisible() && (await open.getByRole('button', { name: 'Put money in', exact: true }).isVisible()), 'with the actions its script offers');
  const club = list.locator('[data-testid="position-open"]').nth(1);
  check(await club.getByText('Open the application to do this').isVisible(), 'an action only the application can do says to open the application');
  check((await club.getByRole('link').getAttribute('href')) === 'https://shared-box.example.org/', 'with the address of its page, as a link');
  const held = list.locator('[data-testid="position-held"]');
  check((await held.locator('.token-title').innerText()).includes('Ticket · Example cloakroom') && (await held.locator('.pill').count()) === 0, 'a token whose record names no script: under the template\'s name, with no word on whether it is open');
  check(await list.getByText('A token of unknown meaning').isVisible(), 'a token with no record, listed as a token');
  const apart = list.getByTestId('not-confirmed');
  const greyed = apart.locator('[data-testid="position-unconfirmed"]');
  check(await greyed.isVisible(), 'a position that is not confirmed, apart');
  const colour = await greyed.locator('.token-title').evaluate((element) => getComputedStyle(element).color);
  const normal = await open.locator('.token-title').evaluate((element) => getComputedStyle(element).color);
  check(colour !== normal, `and greyed (${colour} against ${normal})`);
  check(await greyed.getByRole('button', { name: 'Take everything out', exact: true }).isVisible() && (await greyed.getByRole('button', { name: 'Put money in', exact: true }).count()) === 0, 'taking out is offered there; paying in is not');
  check((await list.getByRole('button', { name: 'Send', exact: true }).count()) === 5, 'every token can be sent');
  await fitsPhone(page, 'the list');
  await shoot(page, 'apps-positions');

  // ---------------------------------------------------------------- acting from the list
  await open.getByRole('button', { name: 'Put money in', exact: true }).tap();
  const amount = page.getByLabel('Amount');
  await amount.waitFor();
  await fitsPhone(page, 'the value the action needs');
  await shoot(page, 'apps-act-form');
  await amount.fill('20000');
  await page.getByRole('button', { name: 'Review' }).tap();
  await page.getByText('Check and carry out').waitFor();
  check(await page.getByRole('button', { name: 'Carry it out' }).isEnabled(), 'then the same review as for a request, ready to carry out');
  await fitsPhone(page, 'the review from the list');
  await shoot(page, 'apps-act-review');

  check(problems.length === 0, `no errors on the pages${problems.length === 0 ? '' : `: ${problems.join(' | ')}`}`);
  log('PASSED');
} catch (error) {
  log(`FAILED: ${(error as Error).message.split('\n')[0]}`);
  if (problems.length > 0) log(`page problems: ${problems.join(' | ')}`);
  process.exitCode = 1;
} finally {
  await browser?.close();
  server.kill();
  rmSync(work, { recursive: true, force: true });
}
