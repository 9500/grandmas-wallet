// The wallet page's Receive and Send screens and the review of an application's action, in a real browser, from the
// fixtures page: no chain, no coins. The page is built as for the public site, with its fixtures page added, and
// served with the content security policy of deploy/serve.mjs.
//
// Checked: the "?" control opens its explanation by a click and closes by a second one, by Escape (the focus goes
// back to it), by a tap elsewhere and when the focus leaves it; it opens and closes by the keyboard; it is a button
// with a name, says whether it is open and which explanation it opens; its bubble stays inside a phone's screen and
// moves nothing around it. On Receive and Send the explanations are behind a "?" and can be reached, and what guards
// against losing coins is in view without opening anything: an address shown again, a plain address refused for a
// token. The review of an action shows the picture and the headline, what asks for care in view, and each folded
// section opens; the buttons to decide stay within reach of a thumb on a phone.
//
// Screenshots, for a phone and a desktop, go to docs/screens/: wallet-receive, wallet-receive-vault,
// wallet-receive-again, wallet-send-form, wallet-send-review, wallet-send-max, wallet-send-everything, wallet-send-done, the phone's
// wallet-info-open-phone, and wallet-review-borrow, wallet-review-close and wallet-review-box-open, each also with
// its details open (-details).
//
// usage (from the repository's root):   npx tsx scripts/review-check.ts [--headed] [--no-screens]
// It takes a few seconds after the build. Port 8193 must be free.
import { type ChildProcess, execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { type Browser, type Locator, type Page, chromium } from 'playwright';

const root = fileURLToPath(new URL('..', import.meta.url));
const headed = process.argv.includes('--headed');
const screens = !process.argv.includes('--no-screens');
const PORT = 8193;
const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 800 };
const started = Date.now();
const log = (line: string): void => console.log(`${((Date.now() - started) / 1000).toFixed(1).padStart(5)} s  ${line}`);
const wait = (milliseconds: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, milliseconds));

const work = mkdtempSync(join(tmpdir(), 'review-check-'));
const children: ChildProcess[] = [];
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
children.push(spawn(process.execPath, ['deploy/serve.mjs', '--root', join(work, 'dist'), '--config', 'deploy/config/local.json', '--host', '127.0.0.1', '--port', String(PORT)], { cwd: root, stdio: 'ignore' }));
const answers = (): Promise<boolean> => fetch(`http://127.0.0.1:${PORT}/version.json`).then(() => true, () => false);
for (let attempt = 0; attempt < 60 && !(await answers()); attempt++) await wait(250);
log(`served at http://localhost:${PORT}/ with the content security policy of deploy/serve.mjs`);
const at = (query: string): string => `http://localhost:${PORT}/fixtures.html?${query}`;

/** A screenshot of the page as it is, on a phone and on a desktop. */
const shoot = async (page: Page, name: string, only?: 'phone'): Promise<void> => {
  if (!screens) return;
  for (const [label, size] of [['phone', PHONE], ['desktop', DESKTOP]] as const) {
    if (only !== undefined && label !== only) continue;
    await page.setViewportSize(size);
    // From the top: a full-page picture of a scrolled page draws the sticky header in the middle.
    await page.evaluate('window.scrollTo(0, 0)');
    await wait(300);
    // A whole page in one picture would draw the buttons that stay at the foot of the screen halfway down it: there, they stand where they are on the page.
    const place = (position: string) => page.evaluate((value) => document.querySelectorAll<HTMLElement>('.request-card .decide').forEach((element) => element.style.setProperty('position', value)), position);
    if (only === undefined) await place('static');
    await page.screenshot({ path: `${root}docs/screens/${name}-${label}.png`, fullPage: only === undefined, animations: 'disabled' });
    await place('');
    log(`screenshot docs/screens/${name}-${label}.png`);
  }
  await page.setViewportSize(PHONE);
};

/** The bubble an info button opens, by the button's own words. */
const bubbleOf = async (button: Locator): Promise<Locator> => button.page().locator(`[id="${await button.getAttribute('aria-controls')}"]`);
const isOpen = async (button: Locator): Promise<boolean> => (await button.getAttribute('aria-expanded')) === 'true' && (await (await bubbleOf(button)).isVisible());
const box = async (locator: Locator): Promise<{ x: number; y: number; width: number; height: number }> => {
  const found = await locator.boundingBox();
  if (found === null) throw new Error('not on the screen');
  return found;
};

try {
  browser = await chromium.launch({ headless: !headed });
  const page = await (await browser.newContext({ viewport: PHONE, deviceScaleFactor: 2, hasTouch: true })).newPage();
  page.setDefaultTimeout(20_000);
  page.on('pageerror', (error) => problems.push(`page error: ${error.message.slice(0, 300)}`));
  page.on('console', (message) => {
    if (message.type() === 'error' && !/favicon/.test(message.text())) problems.push(`console: ${message.text().slice(0, 300)}`);
  });

  // ---------------------------------------------------------------- the "?" control, on the Send screen
  await page.goto(at('show=send'));
  const available = page.getByRole('button', { name: 'About what is available' });
  await available.waitFor();
  const bubble = await bubbleOf(available);
  check((await available.evaluate((element) => element.tagName)) === 'BUTTON' && (await available.getAttribute('aria-expanded')) === 'false' && !(await bubble.isVisible()), 'the "?" is a button with a name, closed, its explanation hidden');
  check((await bubble.getAttribute('role')) === 'note' && (await bubble.count()) === 1, 'it names the explanation it opens, a note that follows it');
  const review = page.getByRole('button', { name: 'Review', exact: true });
  const before = await box(review);
  await available.click();
  check(await isOpen(available), 'a click opens it');
  check((await bubble.innerText()).includes('one satoshi per byte'), 'with the explanation that was on the screen before: the fee is one satoshi per byte');
  const after = await box(review);
  check(before.y === after.y && before.x === after.x, 'nothing around it moves when it opens');
  const inside = await box(bubble);
  check(inside.x >= 8 && inside.x + inside.width <= PHONE.width - 8, `its bubble stays inside a phone's screen (${Math.round(inside.x)} to ${Math.round(inside.x + inside.width)} of ${PHONE.width} px), the "?" being near the right edge`);
  await shoot(page, 'wallet-info-open', 'phone');
  await available.click();
  check(!(await isOpen(available)), 'a second click closes it');
  await available.tap();
  check(await isOpen(available), 'a tap opens it');
  await page.touchscreen.tap(30, 700);
  check(!(await isOpen(available)), 'a tap elsewhere closes it');
  await available.click();
  await page.keyboard.press('Escape');
  check(!(await isOpen(available)) && (await available.evaluate((element) => element === document.activeElement)), 'Escape closes it, and the focus is back on the "?"');
  await page.keyboard.press('Enter');
  check(await isOpen(available), 'Enter opens it from the keyboard');
  await page.keyboard.press(' ');
  check(!(await isOpen(available)), 'and the space bar closes it');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Tab');
  check(!(await isOpen(available)), 'it closes when the focus moves on');
  const units = page.getByRole('button', { name: 'About BCH units' });
  await units.click();
  const left = await box(await bubbleOf(units));
  check(left.x >= 8 && left.x + left.width <= PHONE.width - 8, 'a bubble beside a label at the left edge stays inside the screen too');
  check((await (await bubbleOf(units)).innerText()).includes('One BCH is 100,000,000 satoshis'), 'what the amount is in is behind the "?" beside its label');
  await units.click();

  // ---------------------------------------------------------------- Send: Bitcoin Cash
  check(!(await page.getByText('one satoshi per byte').first().isVisible()), 'the explanation of the fee is out of view on the form');
  await shoot(page, 'wallet-send-form');
  const destination = ((await page.getByTestId('fixture-plain-address').textContent()) ?? '').trim();
  await page.getByLabel('To').fill(destination);
  await page.getByLabel('Amount').fill('0.0002');
  check(await page.getByText('20,000 satoshis').isVisible(), 'the amount shows the satoshis it comes to');
  await review.click();
  await page.getByText('Check and send').waitFor();
  const fee = (await page.locator('dd').nth(2).textContent()) ?? '';
  check(/^\d[\d,]* sat$/.test(fee.trim()), `the third figure of the review is the fee, as the scripted courses read it: "${fee}"`);
  const feeInfo = page.locator('.send-review').getByRole('button', { name: 'About the network fee' });
  await feeInfo.click();
  check((await (await bubbleOf(feeInfo)).innerText()).includes('bytes at one satoshi per byte'), 'the fee\'s make-up is behind the "?" beside it');
  await feeInfo.click();
  await shoot(page, 'wallet-send-review');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await page.getByTestId('sent-transaction').waitFor();
  await shoot(page, 'wallet-send-done');
  await page.getByRole('button', { name: 'Send another payment' }).click();
  check((await page.getByRole('button', { name: 'Review' }).count()) === 1 && (await page.getByRole('button', { name: /Send everything/ }).count()) === 0, 'the form has one Review button, and "Max" instead of a button to send everything');
  // "Max" before an address is entered: an estimate, worked out again in the review.
  await page.getByRole('button', { name: 'Max', exact: true }).click();
  await page.getByText('Everything the wallet can send', { exact: true }).waitFor();
  const filled = await page.getByLabel('Amount').inputValue();
  check(Number(filled) > 0, `"Max" fills the amount with what would arrive (${filled} BCH) and says so under the field`);
  await shoot(page, 'wallet-send-max');
  await page.getByLabel('To').fill(destination);
  await page.getByRole('button', { name: 'Review', exact: true }).click();
  await page.getByText('Arrives', { exact: true }).first().waitFor();
  check(((await page.locator('dd').nth(1).textContent()) ?? '').includes('BCH'), 'sending everything shows what arrives as the second figure');
  check((await page.getByText('Check and send').count()) === 1 && (await page.getByRole('button', { name: 'Send', exact: true }).count()) === 1, 'in the same "Check and send" card, with one Send button');
  await shoot(page, 'wallet-send-everything');
  await page.getByRole('button', { name: 'Change', exact: true }).click();
  await page.getByLabel('Amount').fill('0.0001');
  check(!(await page.getByText('Everything the wallet can send', { exact: true }).isVisible()), 'an amount typed by hand leaves "Max"');
  await page.goto(at('show=send&little'));
  await page.getByRole('button', { name: 'Max', exact: true }).click();
  await page.getByText('Too little to send').waitFor();
  check(await page.getByText('The smallest amount that can arrive').isVisible(), 'with too little, "Max" says so, with the three figures');

  // ---------------------------------------------------------------- Send: a token
  await page.goto(at('show=send-token'));
  await page.getByText('Example dollar').first().waitFor();
  const plain = ((await page.getByTestId('fixture-plain-address').textContent()) ?? '').trim();
  const amountInfo = page.getByRole('button', { name: 'About this token\'s units' });
  await amountInfo.click();
  check((await (await bubbleOf(amountInfo)).innerText()).includes('Name from the template "Example lending (test network)", which you trust.'), 'where a token\'s name comes from is behind the "?" beside its amount');
  await amountInfo.click();
  const addressInfo = page.getByRole('button', { name: 'About token addresses' });
  await addressInfo.click();
  check((await (await bubbleOf(addressInfo)).innerText()).includes('A plain Bitcoin Cash address is not taken for a token'), 'what a token address is is behind the "?" beside "To"');
  await addressInfo.click();
  const feesInfo = page.getByRole('button', { name: 'About the network fee' });
  await feesInfo.click();
  check((await (await bubbleOf(feesInfo)).innerText()).includes('never from a token\'s coin'), 'where the fee comes from is behind the "?" beside the Bitcoin Cash for fees');
  await feesInfo.click();
  await page.locator('#token-amount').fill('12.50');
  await page.locator('#token-to').fill(plain);
  await page.getByRole('button', { name: 'Review' }).click();
  await page.getByText('Not a token address').waitFor();
  check(await page.getByText('A wallet that does not know tokens can destroy them').isVisible(), 'a plain address refused for a token is said in view, with why');

  // ---------------------------------------------------------------- Receive
  await page.goto(at('show=receive'));
  await page.getByTestId('receive-address').waitFor();
  const once = page.getByRole('button', { name: 'About this kind of address' });
  await once.click();
  check((await (await bubbleOf(once)).innerText()).includes('Every payment gets a new address'), 'what an address for one payment is is behind the "?" under the choice');
  await once.click();
  await shoot(page, 'wallet-receive');
  await page.getByRole('button', { name: 'For regular payments' }).click();
  const lasting = page.getByRole('button', { name: 'About this kind of address' });
  await lasting.click();
  check((await (await bubbleOf(lasting)).innerText()).includes('stays valid for years'), 'and what a vault address is, behind the "?" for regular payments');
  await lasting.click();
  await shoot(page, 'wallet-receive-vault');
  // The page keeps the address it gave; without it, it asks the wallet again, which says it is one given before.
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.goto(at('show=receive&again'));
  await page.getByTestId('receive-address').waitFor();
  check(await page.getByText('This address was given out before and has not been used yet.').isVisible(), 'an address shown again is said in view');
  await shoot(page, 'wallet-receive-again');

  // ---------------------------------------------------------------- the review of an action
  for (const [show, name, cautions] of [
    ['review', 'wallet-review-borrow', ['Template not verified', 'A token is destroyed']],
    ['closing', 'wallet-review-close', ['Template not verified', '3 tokens are destroyed']],
    ['box-open', 'wallet-review-box-open', ['This wallet does not have this template yet', 'It first pays itself']],
  ] as const) {
    await page.goto(at(`show=${show}`));
    const card = page.locator('.request-card');
    await card.locator('.flow').waitFor();
    check(await card.locator('.flow').getByText('Your wallet', { exact: true }).isVisible(), `${show}: the picture shows the wallet`);
    const template = (await card.locator('.flow-node.theirs .flow-name').innerText()).trim();
    check(template.length > 0 && (await card.locator('.lane.out .lane-items').isVisible()) && (await card.locator('.lane.back .lane-items').isVisible()), `${show}: and the application, "${template}", with what goes each way`);
    check(/^Your wallet goes (down|up) by/.test((await card.locator('.headline-label').innerText()).trim()) && (await card.locator('.headline-figure').isVisible()), `${show}: the headline says by how much the wallet goes ${(await card.locator('.headline-label').innerText()).includes('down') ? 'down' : 'up'}: ${(await card.locator('.headline-figure').innerText()).replace(/\s+/g, ' ')}`);
    for (const caution of cautions) check(await card.getByText(caution).first().isVisible(), `${show}: "${caution}" is in view without opening anything`);
    check(await card.locator('.their-words .quote-title').isVisible(), `${show}: the action's name in the template's words: "${(await card.locator('.their-words .quote-title').innerText()).trim()}"`);
    check(await card.getByText('This wallet\'s own figures').isVisible(), `${show}: "This wallet's own figures" is named, folded`);
    const approve = page.getByRole('button', { name: 'Approve' });
    const reach = await box(approve);
    check(reach.y + reach.height <= PHONE.height && reach.y > PHONE.height / 2, `${show}: on a phone, Approve is at the foot of the screen, within a thumb's reach, before anything is scrolled (${Math.round(reach.y)} to ${Math.round(reach.y + reach.height)} px of ${PHONE.height})`);
    await shoot(page, name);
    await shoot(page, `${name}-first-screen`, 'phone');
    const folds = card.locator('details.fold');
    for (let index = 0; index < (await folds.count()); index++) {
      const fold = folds.nth(index);
      const title = (await fold.locator('.fold-title').innerText()).trim();
      await fold.locator(':scope > summary').click();
      check((await fold.evaluate((element) => (element as HTMLDetailsElement).open)) && (await fold.locator(':scope > :not(summary)').first().isVisible()), `${show}: the folded section "${title}" opens`);
    }
    check((await card.locator('.own-figures > dl.kv > div').count()) >= 4, `${show}: the wallet's figures in full, where the scripted courses read them`);
    await shoot(page, `${name}-details`);
  }

  check(problems.length === 0, `no errors on the pages${problems.length === 0 ? '' : `: ${problems.join(' | ')}`}`);
  log('PASSED');
} catch (error) {
  log(`FAILED: ${(error as Error).message.split('\n')[0]}`);
  if (problems.length > 0) log(`page problems: ${problems.join(' | ')}`);
  process.exitCode = 1;
} finally {
  await browser?.close();
  for (const child of children) child.kill();
  rmSync(work, { recursive: true, force: true });
}
