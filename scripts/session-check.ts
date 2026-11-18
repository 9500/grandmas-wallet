// Setting a wallet up over the session of the recoverer's code, in real browsers, through a relay on this machine:
// no chain, no coins, nothing sent to an outside service. The recoverer's page and the wallet's page are built with
// their fixtures pages and served with deploy/serve.mjs, whose configuration names the relay of this run.
//
// The recoverer's first run asks how the page is used. A bank's "New customer" shows its code; the phone's camera (a
// fake one, playing a clip of that very code) scans it on the wallet's "I have a code from my bank"; the wallet
// shows "Setting up…" and the bank's page starts the set-up by itself (its fixtures create nothing, so both stay
// there). A friend's code: the phone scans it, and the friend's page asks "Set up Grandma's wallet with …?" while
// the wallet shows that it waits for the friend to say yes. The request is a real one, signed and sealed to the
// recoverer's key, which the recoverer's page opens. "Your wallet is ready" is shown from fixed figures. (That the
// wallet is created, checked and opened is tested in test/set-up.test.ts and test/set-up-over-session.test.ts, and
// run on the local node by scripts/browser-run.ts.)
//
// Screenshots, each for a phone (390x844) and a desktop (1280x800), under docs/screens/: wallet-welcome,
// wallet-setting-up-bank, wallet-setting-up, wallet-ready, recoverer-start, recoverer-bank-code,
// recoverer-friend-confirm, recoverer-settings.
//
// usage (from the repository's root):   npx tsx scripts/session-check.ts [--headed] [--no-screens]
// It takes about a minute. Ports 8192 and 8193 must be free.
import { type ChildProcess, execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { type Browser, type Page, chromium } from 'playwright';
import qrcode from 'qrcode-generator';

import { startMemoryRelay } from '../packages/connect/test/memory-relay.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const headed = process.argv.includes('--headed');
const screens = !process.argv.includes('--no-screens');
const PORTS = { recoverer: 8192, wallet: 8193 };
const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 800 };
const started = Date.now();
const log = (line: string): void => console.log(`${((Date.now() - started) / 1000).toFixed(1).padStart(5)} s  ${line}`);
const wait = (milliseconds: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, milliseconds));
const check = (ok: boolean, what: string): void => {
  if (!ok) throw new Error(what);
  log(`ok: ${what}`);
};

const work = mkdtempSync(join(tmpdir(), 'session-check-'));
const children: ChildProcess[] = [];
const browsers: Browser[] = [];
const problems: string[] = [];
const relay = await startMemoryRelay();
log(`relay at ${relay.url}`);

// ------------------------------------------------------------------ the pages, built and served as for the public sites

const config = {
  ...(JSON.parse(readFileSync(join(root, 'deploy/config/local-regtest.json'), 'utf8')) as Record<string, unknown>),
  walletUrl: `http://localhost:${PORTS.wallet}/`,
  recovererUrl: `http://localhost:${PORTS.recoverer}/`,
  relays: [relay.url],
};
writeFileSync(join(work, 'config.json'), JSON.stringify(config));

for (const app of ['recoverer', 'wallet'] as const) {
  log(`building the ${app} page with its fixtures page`);
  // In a process of its own, so that the memory the build takes is given back before the browsers start.
  writeFileSync(
    join(work, `${app}.vite.config.mjs`),
    `import base from ${JSON.stringify(join(root, `apps/${app}/vite.config.mjs`))};
export default { ...base, build: { ...base.build, outDir: ${JSON.stringify(join(work, app))}, emptyOutDir: true, rolldownOptions: { input: { index: ${JSON.stringify(join(root, `apps/${app}/index.html`))}, fixtures: ${JSON.stringify(join(root, `apps/${app}/fixtures.html`))} } } } };
`,
  );
  execFileSync(process.execPath, [join(root, 'node_modules/vite/bin/vite.js'), 'build', '--config', join(work, `${app}.vite.config.mjs`), '--logLevel', 'error'], { cwd: join(root, `apps/${app}`), stdio: 'inherit' });
  children.push(spawn(process.execPath, ['deploy/serve.mjs', '--root', join(work, app), '--config', join(work, 'config.json'), '--host', '127.0.0.1', '--port', String(PORTS[app])], { cwd: root, stdio: 'ignore' }));
  const answers = (): Promise<boolean> => fetch(`http://127.0.0.1:${PORTS[app]}/version.json`).then(() => true, () => false);
  for (let attempt = 0; attempt < 60 && !(await answers()); attempt++) await wait(250);
}

// ------------------------------------------------------------------ the browsers

const open = async (args: string[], viewport: { width: number; height: number }): Promise<Page> => {
  const browser = await chromium.launch({ headless: !headed, args });
  browsers.push(browser);
  const page = await (await browser.newContext({ viewport, deviceScaleFactor: 1 })).newPage();
  page.setDefaultTimeout(60_000);
  page.on('pageerror', (error) => problems.push(`page error: ${error.message.slice(0, 300)}`));
  page.on('console', (message) => {
    // A refusal is shown on the page; the page also writes it to the console.
    if (message.type() === 'error' && !/favicon|EnrollmentError/.test(message.text())) problems.push(`console: ${message.text().slice(0, 300)}`);
  });
  return page;
};

/** A clip in the YUV4MPEG2 format, which Chromium plays as a camera: the code, black on white, in the middle. */
const clipOf = (text: string, name: string): string => {
  const code = qrcode(0, 'M');
  code.addData(text, 'Byte');
  code.make();
  const [width, height] = [640, 480];
  const modules = code.getModuleCount();
  const scale = Math.floor(440 / (modules + 8));
  const side = scale * (modules + 8);
  const [left, top] = [Math.floor((width - side) / 2), Math.floor((height - side) / 2)];
  const luma = new Uint8Array(width * height).fill(235);
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      const [row, column] = [Math.floor(y / scale) - 4, Math.floor(x / scale) - 4];
      if (row >= 0 && column >= 0 && row < modules && column < modules && code.isDark(row, column)) luma[(top + y) * width + left + x] = 16;
    }
  }
  const chroma = new Uint8Array((width / 2) * (height / 2)).fill(128);
  const frame = Buffer.concat([Buffer.from('FRAME\n'), luma, chroma, chroma]);
  const path = join(work, `${name}.y4m`);
  writeFileSync(path, Buffer.concat([Buffer.from(`YUV4MPEG2 W${width} H${height} F10:1 Ip A1:1 C420jpeg\n`), frame, frame]));
  return path;
};

const shoot = async (page: Page, name: string): Promise<void> => {
  if (!screens) return;
  const before = page.viewportSize() ?? DESKTOP;
  for (const [label, size] of [['phone', PHONE], ['desktop', DESKTOP]] as const) {
    await page.setViewportSize(size);
    await wait(500);
    await page.screenshot({ path: `${root}docs/screens/${name}-${label}.png`, fullPage: true, animations: 'disabled' });
    log(`screenshot docs/screens/${name}-${label}.png`);
  }
  await page.setViewportSize(before);
};


try {
  const recovererPage = (show: string): string => `http://localhost:${PORTS.recoverer}/fixtures.html?show=${show}`;
  const walletPage = (show: string): string => `http://localhost:${PORTS.wallet}/fixtures.html?show=${show}`;

  // ---------------------------------------------------------------- the first screens, by themselves
  const recoverer = await open([], DESKTOP);
  await recoverer.goto(recovererPage('start'));
  await recoverer.getByText('How will you use this page?').waitFor();
  await recoverer.getByTestId('mode-bank').click();
  check(await recoverer.getByLabel('Your bank\'s name, as customers\' wallets show it').isVisible(), 'the recoverer\'s first run asks whether it is a bank or someone helping, and then for the name phones show');
  await shoot(recoverer, 'recoverer-start');
  await recoverer.goto(recovererPage('settings'));
  await recoverer.getByText('Starting balance, in satoshis').waitFor();
  check(true, 'the settings have the starting balance and the waiting period');
  await shoot(recoverer, 'recoverer-settings');

  const welcome = await open([], PHONE);
  await welcome.goto(walletPage('welcome'));
  await welcome.getByText('I have a code from my bank').waitFor();
  check(await welcome.getByText('Someone I trust is helping me').isVisible(), 'the wallet\'s first screen offers the bank and the helper, and the ways back to a wallet');
  await shoot(welcome, 'wallet-welcome');
  await welcome.goto(walletPage('ready'));
  await welcome.getByText('Your wallet is ready').waitFor();
  check(await welcome.getByText('Protected by').isVisible(), '"Your wallet is ready" shows the balance and who protects it');
  await shoot(welcome, 'wallet-ready');

  // ---------------------------------------------------------------- a bank: the phone scans, the page sets up by itself
  await recoverer.goto(recovererPage('bank'));
  await recoverer.getByText('Waiting for their phone to scan the code').waitFor();
  await recoverer.getByLabel('Customer', { exact: true }).fill('1042');
  await wait(300);
  const bankCode = (await recoverer.getByTestId('recoverer-code').getAttribute('data-value')) ?? '';
  check(/#recoverer=/.test(bankCode), `the bank's "New customer" shows its code (${bankCode.length} characters)`);
  await shoot(recoverer, 'recoverer-bank-code');
  const bankPhone = await open(['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${clipOf(bankCode, 'bank')}`], PHONE);
  await bankPhone.goto(walletPage('setup-bank'));
  await bankPhone.getByTestId('setting-up').waitFor();
  check(true, 'the phone scanned the bank\'s code at once and shows "Setting up…"');
  await recoverer.getByText('Setting up the customer\'s wallet…').or(recoverer.getByText('Setting up 1042\'s wallet…')).waitFor();
  check(true, 'the bank\'s page took the request and began the set-up by itself, with nobody saying yes');
  await bankPhone.locator('[data-stage="waiting"]').waitFor();
  await shoot(bankPhone, 'wallet-setting-up-bank');

  // ---------------------------------------------------------------- a friend: the phone scans, the friend says yes
  await recoverer.goto(recovererPage('friend'));
  await recoverer.getByLabel('Who are you helping?').fill('Grandma');
  await recoverer.getByRole('button', { name: 'Show the code' }).click();
  await recoverer.getByText('Waiting for their phone to scan the code').waitFor();
  await wait(300);
  const friendCode = (await recoverer.getByTestId('recoverer-code').getAttribute('data-value')) ?? '';
  const friendPhone = await open(['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${clipOf(friendCode, 'friend')}`], PHONE);
  await friendPhone.goto(walletPage('setup-friend'));
  await recoverer.getByTestId('set-up-confirm').waitFor();
  const question = (await recoverer.getByTestId('set-up-confirm').locator('.status-title, strong, h3').first().textContent()) ?? (await recoverer.getByTestId('set-up-confirm').textContent()) ?? '';
  check(/Set up Grandma's wallet/.test((await recoverer.getByTestId('set-up-confirm').textContent()) ?? ''), `the friend's page asks: "${question.trim()}"`);
  await friendPhone.getByText('Waiting for Anna to say yes').waitFor();
  check(true, 'the phone shows that it waits for Anna to say yes');
  await shoot(recoverer, 'recoverer-friend-confirm');
  await shoot(friendPhone, 'wallet-setting-up');

  check(problems.length === 0, `no errors on the pages${problems.length === 0 ? '' : `: ${problems.join(' | ')}`}`);
  log(`PASSED (${relay.published().count} relay messages)`);
} catch (error) {
  log(`FAILED: ${(error as Error).message.split('\n')[0]}`);
  if (problems.length > 0) log(`page problems: ${problems.join(' | ')}`);
  process.exitCode = 1;
} finally {
  for (const browser of browsers) await browser.close();
  for (const child of children) child.kill();
  await relay.close();
  rmSync(work, { recursive: true, force: true });
}
