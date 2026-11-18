// The recoverer's code and the session it offers, in real browsers, through a relay on this machine: no chain,
// no coins, nothing sent to an outside service. The recoverer's page and the wallet's page are built with their
// fixtures pages and served with deploy/serve.mjs, whose configuration names the relay of this run.
//
// The recoverer's "Your link" screen shows its code; the phone's camera (a fake one, playing a clip of that very
// code) scans it into the wallet's first step of making a wallet; the wallet shows the same fingerprint, and the
// recoverer's page shows that a phone is connected. The wallet then hands over a sealed sample, as it hands over
// the kit once the wallet is made; the recoverer's page shows it as an arrived kit, the wallet shows that the
// page has it; the recoverer tries to keep it, which fails because the sample opens with no key, and the wallet
// shows the refusal with its reason, with the link in view. (That a real kit received this way is the link's kit
// and passes the page's checks is tested in test/kit-over-session.test.ts.)
//
// Screenshots: docs/screens/recoverer-link-code-{phone,desktop}.png (the code, a phone connected) and
// docs/screens/wallet-kit-handed-{phone,desktop}.png (the wallet, the recoverer's page has the kit).
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
  ...(JSON.parse(readFileSync(join(root, 'deploy/config/local.json'), 'utf8')) as Record<string, unknown>),
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
const clipOf = (text: string): string => {
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
  const path = join(work, 'code.y4m');
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
  // ---------------------------------------------------------------- the recoverer's page, on a desktop
  const recoverer = await open([], DESKTOP);
  await recoverer.goto(`http://localhost:${PORTS.recoverer}/fixtures.html`);
  await recoverer.getByLabel('Your name, as their wallet shows it').fill('Anna');
  await recoverer.getByText('Waiting for their phone').waitFor();
  await wait(300);
  const code = (await recoverer.getByTestId('recoverer-code').getAttribute('data-value')) ?? '';
  const plain = (await recoverer.getByTestId('recoverer-link').getAttribute('data-value')) ?? '';
  check(code !== plain && code.length > plain.length, `the code (${code.length} characters) carries more than the link to send (${plain.length})`);
  const recovererFingerprint = (await recoverer.locator('.fingerprint').first().textContent()) ?? '';

  // ---------------------------------------------------------------- the phone scans it
  const phone = await open(['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${clipOf(code)}`], PHONE);
  await phone.goto(`http://localhost:${PORTS.wallet}/fixtures.html?show=recoverer`);
  await phone.getByRole('button', { name: 'Scan', exact: true }).click();
  await phone.waitForFunction(() => (document.querySelector<HTMLTextAreaElement>('#recipient-link')?.value ?? '').includes('#recoverer='));
  check((await phone.locator('#recipient-link').inputValue()) === code, 'the phone scanned the code into the field, exactly as shown');
  await phone.getByRole('button', { name: 'Use this link' }).click();
  await phone.getByText('Fingerprint of their key').waitFor();
  check((await phone.locator('.fingerprint').first().textContent()) === recovererFingerprint, `the wallet shows the recoverer's fingerprint, ${recovererFingerprint}`);
  await recoverer.getByText('A phone is connected').waitFor();
  check(true, 'the recoverer\'s page shows that a phone is connected');
  await shoot(recoverer, 'recoverer-link-code');

  // ---------------------------------------------------------------- something sealed, handed over the session
  await phone.getByLabel('The fingerprints are the same').check();
  await phone.getByRole('button', { name: 'Send a sample to their page' }).click();
  await phone.getByText('Anna\'s page has the kit.').waitFor();
  check(true, 'the wallet shows that the recoverer\'s page has it');
  check(!(await phone.getByTestId('kit-link').isVisible()), 'with the link folded away under "Send it as a link instead"');
  await recoverer.getByText('A recovery kit has arrived').waitFor();
  check(await recoverer.getByText('The kit has arrived').isVisible(), 'the recoverer\'s page shows the kit as arrived, as if its link had been opened');
  await shoot(phone, 'wallet-kit-handed');

  // ---------------------------------------------------------------- the recoverer's page checks it, and refuses it
  await recoverer.getByLabel('Whose wallet is this?').fill('Grandma');
  await recoverer.getByRole('button', { name: 'Check and keep the kit' }).click();
  await phone.getByText('Anna\'s page did not keep the kit.').waitFor();
  const refusal = (await phone.locator('.notice.warn').first().textContent()) ?? '';
  check(/Send it as a link instead/.test(refusal), `the wallet shows the refusal and its reason: "${refusal.trim()}"`);
  check(await phone.getByTestId('kit-link').isVisible(), 'and the link, in view');
  check(await recoverer.getByText('The kit was not kept').isVisible(), 'the recoverer\'s page says the kit was not kept');

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
