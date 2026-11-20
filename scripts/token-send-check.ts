// The wallet page's screens for sending and receiving tokens, in a real browser, from the fixtures page: no chain,
// no coins. The page is built as for the public site, with its fixtures page added, and served with the content
// security policy of deploy/serve.mjs.
//
// Checked: the Send screen opens on the token another screen chose, with the choice between Bitcoin Cash and a
// token; a fungible token is shown by its category and in raw units, and nothing names it; an amount with a
// fraction is refused, not rounded; "Max" fills the whole balance; a
// plain address is refused before anything is built, with what to ask the receiver for; a token address gives the
// review with what goes, the token change and the fee; a token that controls something names its template and what
// its position holds now (or, where the record names no script, that the application shows it, at the record's page),
// and cannot be sent until the user ticks that they understand; the Receive screen shows the address in its token form first, and
// its switch shows the same address in the plain form, in the text, the copy button and the code. Screenshots, for a phone and a desktop, go to docs/screens/:
// wallet-send-token-choice, wallet-send-token-review, wallet-send-token-controls, wallet-send-token-application,
// wallet-send-token-plain-address and wallet-receive-token.
//
// usage (from the repository's root):   npx tsx scripts/token-send-check.ts [--headed] [--no-screens]
// It takes a few seconds after the build. Port 8192 must be free.
import { type ChildProcess, execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { cashAddressToLockingBytecode } from '@bitauth/libauth';
import { type Browser, type Page, chromium } from 'playwright';

const root = fileURLToPath(new URL('..', import.meta.url));
const headed = process.argv.includes('--headed');
const screens = !process.argv.includes('--no-screens');
const PORT = 8192;
const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 800 };
const started = Date.now();
const log = (line: string): void => console.log(`${((Date.now() - started) / 1000).toFixed(1).padStart(5)} s  ${line}`);
const wait = (milliseconds: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, milliseconds));

const work = mkdtempSync(join(tmpdir(), 'token-send-check-'));
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

/** A screenshot of the page as it is, on a phone and on a desktop. */
const shoot = async (page: Page, name: string): Promise<void> => {
  if (!screens) return;
  for (const [label, size] of [['phone', PHONE], ['desktop', DESKTOP]] as const) {
    await page.setViewportSize(size);
    // From the top: a full-page picture of a scrolled page draws the sticky header in the middle.
    await page.evaluate('window.scrollTo(0, 0)');
    await wait(300);
    await page.screenshot({ path: `${root}docs/screens/${name}-${label}.png`, fullPage: true, animations: 'disabled' });
    log(`screenshot docs/screens/${name}-${label}.png`);
  }
  await page.setViewportSize(PHONE);
};
const textOf = async (page: Page, selector: string): Promise<string> => ((await page.locator(selector).first().textContent()) ?? '').replace(/\s+/g, ' ').trim();

try {
  browser = await chromium.launch({ headless: !headed });
  const page = await (await browser.newContext({ viewport: PHONE, deviceScaleFactor: 2 })).newPage();
  page.setDefaultTimeout(20_000);
  page.on('pageerror', (error) => problems.push(`page error: ${error.message.slice(0, 300)}`));
  page.on('console', (message) => {
    if (message.type() === 'error' && !/favicon/.test(message.text())) problems.push(`console: ${message.text().slice(0, 300)}`);
  });

  // ---------------------------------------------------------------- an amount of a named token
  await page.goto(`http://localhost:${PORT}/fixtures.html?show=send-token`);
  await page.getByText('Fungible tokens').first().waitFor();
  check((await page.getByRole('button', { name: 'A token' }).getAttribute('aria-pressed')) === 'true', 'the Send screen opens on "A token", the token another screen chose');
  const chosen = page.locator('.token-picker .choice', { has: page.locator('input:checked') });
  check((await chosen.count()) === 1, 'with that token chosen among the tokens');
  const choice = (await chosen.innerText()).replace(/\s+/g, ' ');
  check(choice.includes('25,000 units') && choice.includes('a1d53b'), 'it is shown by its category, its balance in raw units, "25,000 units"');
  check(!(await page.getByText('Example dollar').first().isVisible().catch(() => false)) && !choice.includes('EXD'), 'and no template names it');
  const units = page.getByRole('button', { name: 'About this token\'s units' });
  await units.click();
  check(await page.getByText('In whole units, up to 25,000 units.').first().isVisible(), 'the "?" beside its amount says it is typed in whole units');
  await units.click();
  const tokenAddress = await textOf(page, '[data-testid="fixture-token-address"]');
  const plainAddress = await textOf(page, '[data-testid="fixture-plain-address"]');
  const decoded = [cashAddressToLockingBytecode(tokenAddress), cashAddressToLockingBytecode(plainAddress)];
  check(decoded.every((entry) => typeof entry !== 'string') && (decoded[0] as { tokenSupport: boolean }).tokenSupport && !(decoded[1] as { tokenSupport: boolean }).tokenSupport, 'the fixture offers the same script as a token address and as a plain one');
  await shoot(page, 'wallet-send-token-choice');

  await page.locator('#token-amount').fill('12.5');
  await page.locator('#token-to').fill(tokenAddress);
  await page.getByRole('button', { name: 'Review' }).click();
  await page.locator('.field-error', { hasText: 'enter a whole number' }).waitFor();
  check(!(await page.getByText('Check and send').isVisible()), 'an amount with a fraction is refused, not rounded');
  await page.getByRole('button', { name: 'Max', exact: true }).click();
  check((await page.locator('#token-amount').inputValue()) === '25000', '"Max" fills the whole balance, 25000');

  await page.locator('#token-amount').fill('1250');
  await page.locator('#token-to').fill(plainAddress);
  await page.getByRole('button', { name: 'Review' }).click();
  await page.getByText('Not a token address').waitFor();
  check(!(await page.getByText('Check and send').isVisible()), 'a plain address is refused before anything is built');
  check(await page.getByText('Ask the receiver for their token address').isVisible(), 'and the screen says what to ask the receiver for');
  await shoot(page, 'wallet-send-token-plain-address');

  await page.locator('#token-to').fill(tokenAddress);
  await page.getByRole('button', { name: 'Review' }).click();
  await page.getByText('Check and send').waitFor();
  const review = await textOf(page, '.token-review');
  check(review.includes('1,250') && review.includes('units'), 'the review says what goes, in raw units: 1,250');
  check(review.includes('Comes back as token change') && review.includes('23,750 units'), 'and what comes back as token change, "23,750 units"');
  check(/Network fee.*sat/.test(review) && review.includes('Leaves the wallet'), 'and the fee, and the Bitcoin Cash that leaves the wallet');
  check(await page.getByRole('button', { name: 'Send', exact: true }).isEnabled(), 'an amount of tokens needs no tick before it is sent');
  await shoot(page, 'wallet-send-token-review');

  // ---------------------------------------------------------------- a token that controls something
  await page.getByRole('button', { name: 'Change' }).click();
  await page.getByRole('radio', { name: /Example key/ }).check();
  check(!(await page.locator('#token-amount').isVisible()), 'an NFT is sent whole: no amount is asked for');
  await page.locator('#token-to').fill(tokenAddress);
  await page.getByRole('button', { name: 'Review' }).click();
  await page.getByText('It controls a position of "Example lending (test network)".').waitFor();
  const controls = await textOf(page, '.controls');
  check(/Holds now\s*0\.59957301 BCH/.test(controls), 'the review names the template and shows what the position holds now');
  check(controls.includes('I understand that whoever receives this token gets what it controls'), 'and the tick says that whoever receives the token gets what it controls');
  const about = page.getByRole('button', { name: 'About what this token controls' });
  await about.click();
  check(await page.getByText(/A record in this wallet's backup ties this token to a position of the template\..*It can make new tokens of its category/).first().isVisible(), 'the "?" says where that comes from, and what the minting capability lets its holder do');
  await about.click();
  const send = page.getByRole('button', { name: 'Send', exact: true });
  check(await send.isDisabled(), 'the button to send stays disabled until the user ticks');
  await page.getByRole('checkbox', { name: /I understand/ }).check();
  check(await send.isEnabled(), 'and is enabled once ticked');
  await page.getByRole('checkbox', { name: /I understand/ }).uncheck();
  await shoot(page, 'wallet-send-token-controls');
  await page.getByRole('checkbox', { name: /I understand/ }).check();
  await send.click();
  await page.locator('.card.good').waitFor();
  check((await textOf(page, '.card.good')).includes('Example key'), 'once sent, the screen says what went');

  // ---------------------------------------------------------------- a key whose record names no script, and one whose position is emptied
  await page.goto(`http://localhost:${PORT}/fixtures.html?show=send-token&nft=ticket`);
  await page.locator('#token-to').fill(tokenAddress);
  await page.getByRole('button', { name: 'Review' }).click();
  await page.getByText('It controls a position of "Example cloakroom (test network)".').waitFor();
  const ticket = await textOf(page, '.controls');
  check(/The application shows what it holds:\s*cloakroom\.example\.org\/coats/.test(ticket), 'for a key whose record names no script, the application shows what it holds, at the page the record names');
  check((await page.locator('.controls a.application-page').getAttribute('href')) === 'https://cloakroom.example.org/coats/', 'and the page is a link');
  check(await page.getByRole('button', { name: 'Send', exact: true }).isDisabled(), 'it too is sent only once ticked');
  await shoot(page, 'wallet-send-token-application');
  await page.goto(`http://localhost:${PORT}/fixtures.html?show=send-token&nft=spent`);
  await page.locator('#token-to').fill(tokenAddress);
  await page.getByRole('button', { name: 'Review' }).click();
  await page.getByText('It controls a position of "Example money box (test network)".').waitFor();
  check(/Holds now\s*Nothing/.test(await textOf(page, '.controls')), 'for an emptied position, it says that it holds nothing now');

  // ---------------------------------------------------------------- receiving a token
  await page.goto(`http://localhost:${PORT}/fixtures.html?show=receive`);
  const shown = page.getByTestId('receive-address');
  await shown.waitFor();
  const tokens = (await shown.getAttribute('data-value')) ?? '';
  check((await shown.getAttribute('data-form')) === 'tokens' && /^bchtest:r/.test(tokens) && (await page.getByRole('checkbox', { name: /Receiving a token\?/ }).isChecked()), 'the Receive screen shows the token form by default, "Receiving a token?" ticked');
  check((await page.getByRole('button', { name: 'Copy token address' }).count()) === 1 && (await page.getByLabel('QR code of the token address').count()) === 1, 'and the copy button and the code follow it');
  check(await page.getByText('The same address, written for wallets that send tokens.').isVisible(), 'one line says it is the same address');
  await page.getByRole('checkbox', { name: /Receiving a token\?/ }).uncheck();
  await page.locator('[data-form="plain"]').waitFor();
  const plain = (await shown.getAttribute('data-value')) ?? '';
  const both = [cashAddressToLockingBytecode(plain), cashAddressToLockingBytecode(tokens)] as { bytecode: Uint8Array; tokenSupport: boolean }[];
  check(/^bchtest:p/.test(plain) && both[1]?.tokenSupport === true && Buffer.from(both[0]?.bytecode ?? []).equals(Buffer.from(both[1]?.bytecode ?? [])), 'unticked, the switch shows the same address in its plain form');
  check((await page.getByRole('button', { name: 'Copy address' }).count()) === 1 && (await page.getByLabel('QR code of the address').count()) === 1, 'and the copy button and the code follow it');
  await page.getByRole('checkbox', { name: /Receiving a token\?/ }).check();
  await page.getByRole('button', { name: 'For regular payments' }).click();
  await page.locator('[data-form="tokens"]').waitFor();
  check(((await shown.getAttribute('data-value')) ?? '') !== tokens, 'the switch applies to the lasting address as well');
  await page.getByRole('button', { name: 'For one payment' }).click();
  await shoot(page, 'wallet-receive-token');

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
