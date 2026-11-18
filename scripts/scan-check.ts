// The wallet page's QR code scanner in a real browser, with fake cameras. The wallet page is built as for the
// public site, with its fixtures page added, and served with the content security policy of deploy/serve.mjs.
// Chromium is started twice: once with three fake cameras showing its own moving picture, to go round them; once
// with one camera that plays a clip made here, of a recoverer's link as a QR code, to read it.
//
// Checked: the scanning library is loaded only when the scanner opens; "Camera 1 of 3", the hint and the button
// that switches; a tap on the picture goes to the next camera, and round; a remembered camera is the one the
// scanner starts with; with one camera there is nothing to switch; a code of another kind is refused with the
// field's own words and the scanner stays open; the code fills the field it was scanned for, exactly as pasted,
// and the camera that read it is kept; a picture of the code is read as well; the camera is released when the
// scanner closes and when the page is hidden. Screenshots of the open scanner go to
// docs/screens/wallet-scan-phone.png and docs/screens/wallet-scan-desktop.png.
//
// usage (from the repository's root):   npx tsx scripts/scan-check.ts [--headed] [--no-screens]
// It takes about half a minute. Port 8191 must be free.
import { type ChildProcess, execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { makeLink } from '@grandmas-wallet/app/links';
import { type Browser, type Page, chromium } from 'playwright';
import qrcode from 'qrcode-generator';

const root = fileURLToPath(new URL('..', import.meta.url));
const headed = process.argv.includes('--headed');
const screens = !process.argv.includes('--no-screens');
const PORT = 8191;
const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 800 };
const started = Date.now();
const log = (line: string): void => console.log(`${((Date.now() - started) / 1000).toFixed(1).padStart(5)} s  ${line}`);
const wait = (milliseconds: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, milliseconds));

const work = mkdtempSync(join(tmpdir(), 'scan-check-'));
const children: ChildProcess[] = [];
const browsers: Browser[] = [];
const problems: string[] = [];
const check = (ok: boolean, what: string): void => {
  if (!ok) throw new Error(what);
  log(`ok: ${what}`);
};

// ------------------------------------------------------------------ the code, as a clip and as a picture

const link = await makeLink('http://localhost:8101/', 'recoverer', { name: 'Anna', page: 'http://localhost:8102/', publicKey: '5d'.repeat(32) });
const code = qrcode(0, 'M');
code.addData(link, 'Byte');
code.make();

/** A clip in the YUV4MPEG2 format, which Chromium plays as a camera: the code, black on white, in the middle. */
const clip = (): string => {
  const [width, height] = [640, 480];
  const modules = code.getModuleCount();
  const scale = Math.floor(360 / (modules + 8));
  const side = scale * (modules + 8);
  const left = Math.floor((width - side) / 2);
  const top = Math.floor((height - side) / 2);
  const luma = new Uint8Array(width * height).fill(235);
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      const row = Math.floor(y / scale) - 4;
      const column = Math.floor(x / scale) - 4;
      const dark = row >= 0 && column >= 0 && row < modules && column < modules && code.isDark(row, column);
      luma[(top + y) * width + left + x] = dark ? 16 : 235;
    }
  }
  const chroma = new Uint8Array((width / 2) * (height / 2)).fill(128);
  const frame = Buffer.concat([Buffer.from('FRAME\n'), luma, chroma, chroma]);
  const path = join(work, 'code.y4m');
  writeFileSync(path, Buffer.concat([Buffer.from(`YUV4MPEG2 W${width} H${height} F10:1 Ip A1:1 C420jpeg\n`), frame, frame]));
  return path;
};

const picture = join(work, 'code.svg');
writeFileSync(picture, code.createSvgTag({ cellSize: 6, margin: 24, scalable: false }));

// ------------------------------------------------------------------ the page, built and served as for the public site

log('building the wallet page with its fixtures page');
// In a process of its own, so that the memory the build takes is given back before the browsers start.
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

// ------------------------------------------------------------------ the browser

/** Chromium with fake cameras: three showing its own moving picture, or one that plays the clip. */
const launch = async (cameras: 'three' | 'clip'): Promise<Page> => {
  const browser = await chromium.launch({
    headless: !headed,
    args: ['--use-fake-ui-for-media-stream', ...(cameras === 'three' ? ['--use-fake-device-for-media-stream=device-count=3'] : ['--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${clip()}`])],
  });
  browsers.push(browser);
  const page = await (await browser.newContext({ viewport: PHONE, deviceScaleFactor: 1 })).newPage();
  // A busy machine makes a browser that decodes video slow to answer: patience rather than failure.
  page.setDefaultTimeout(120_000);
  page.on('pageerror', (error) => problems.push(`page error: ${error.message.slice(0, 300)}`));
  page.on('console', (message) => {
    if (message.type() === 'error' && !/favicon/.test(message.text())) problems.push(`console: ${message.text().slice(0, 300)}`);
  });
  return page;
};

const valueOf = (page: Page, id: string): Promise<string> => page.locator(`#${id}`).inputValue();
const waitFor = async (what: () => Promise<boolean>, timeout = 60_000): Promise<boolean> => {
  for (const until = Date.now() + timeout; Date.now() < until; await wait(100)) if (await what()) return true;
  return false;
};
/** The camera whose picture the scanner shows, if it shows one. */
const runningCamera = (page: Page): Promise<string | undefined> =>
  page.evaluate(() => {
    const source = document.querySelector<HTMLVideoElement>('dialog video')?.srcObject;
    return source instanceof MediaStream ? source.getVideoTracks()[0]?.getSettings().deviceId : undefined;
  });
const remembered = (page: Page): Promise<string | null> => page.evaluate(() => localStorage.getItem('gw2-wallet:scanCamera'));

try {
  // ---------------------------------------------------------------- three cameras: going round them
  const page = await launch('three');
  const libraryRequests: string[] = [];
  page.on('request', (request) => {
    if (/qr-scanner/.test(request.url())) libraryRequests.push(request.url());
  });
  await page.goto(`http://localhost:${PORT}/fixtures.html?show=scan`);
  const scan = page.getByRole('button', { name: 'Scan', exact: true });
  await scan.first().waitFor();
  await wait(500);
  check(libraryRequests.length === 0, 'a page that does not scan does not load the scanning library');
  await scan.first().click();
  const dialog = page.locator('dialog.scan-dialog');
  const caption = page.getByTestId('scan-camera');
  check(await waitFor(async () => (await caption.isVisible()) && (await caption.textContent()) === 'Camera 1 of 3'), 'with three cameras, the caption says "Camera 1 of 3"');
  check(libraryRequests.length > 0, 'the scanning library is loaded when the scanner opens');
  check(await page.getByText('Tap to switch camera').isVisible(), 'the hint "Tap to switch camera" is shown');
  check(await page.locator('.scan-switch').isVisible(), 'and the button that switches');
  if (screens) {
    for (const [label, size] of [['phone', PHONE], ['desktop', DESKTOP]] as const) {
      await page.setViewportSize(size);
      await wait(600);
      await page.screenshot({ path: `${root}docs/screens/wallet-scan-${label}.png`, animations: 'disabled' });
      log(`screenshot docs/screens/wallet-scan-${label}.png`);
    }
    await page.setViewportSize(PHONE);
  }
  const first = await runningCamera(page);
  await page.getByTestId('scan-view').click({ position: { x: 40, y: 200 } });
  check(await waitFor(async () => (await caption.textContent()) === 'Camera 2 of 3'), 'a tap on the picture goes to camera 2 of 3');
  const second = await runningCamera(page);
  check(second !== undefined && second !== first, 'and another camera is running');
  await page.locator('.scan-switch').click();
  check(await waitFor(async () => (await caption.textContent()) === 'Camera 3 of 3'), 'the switch button goes to camera 3 of 3');
  const third = await runningCamera(page);
  check(third !== undefined && third !== second && third !== first, 'and the third camera is running');
  await page.getByTestId('scan-view').click({ position: { x: 40, y: 200 } });
  check(await waitFor(async () => (await caption.textContent()) === 'Camera 1 of 3' && (await runningCamera(page)) === first), 'a tap goes round to the first camera');
  await page.getByRole('button', { name: 'Cancel' }).click();
  check(await waitFor(async () => !(await dialog.isVisible())), 'Cancel closes the scanner');
  check(await waitFor(() => page.evaluate(() => document.querySelector('dialog video') === null)), 'and the camera\'s picture is gone with it');
  check((await remembered(page)) === null, 'a camera that read no code is not remembered');
  // A camera remembered from an earlier scan is the one the scanner starts with.
  await page.evaluate((id) => localStorage.setItem('gw2-wallet:scanCamera', JSON.stringify(id)), third);
  await scan.first().click();
  check(await waitFor(async () => (await caption.isVisible()) && (await caption.textContent()) === 'Camera 3 of 3' && (await runningCamera(page)) === third), 'a remembered camera is the one the scanner starts with');
  await page.keyboard.press('Escape');
  check(await waitFor(async () => !(await dialog.isVisible())), 'Escape closes the scanner');

  // ---------------------------------------------------------------- one camera, filming the code
  const phone = await launch('clip');
  await phone.goto(`http://localhost:${PORT}/fixtures.html?show=scan`);
  const buttons = phone.getByRole('button', { name: 'Scan', exact: true });
  await buttons.first().waitFor();
  // A code of another kind: the field for an address refuses the recoverer's link, and the scanner stays open.
  await buttons.nth(1).click();
  await phone.getByText('This code is not a Bitcoin Cash address').waitFor({ timeout: 60_000 });
  check(await phone.locator('dialog.scan-dialog').isVisible(), 'a code of another kind is refused with the field\'s words, and the scanner stays open');
  check((await valueOf(phone, 'to')) === '', 'the field for an address stays empty');
  check(!(await phone.getByText('Tap to switch camera').isVisible()) && (await phone.locator('.scan-switch').count()) === 0, 'with one camera there is no hint and no button to switch');
  check((await remembered(phone)) === null, 'a refused code does not make the camera remembered');
  await phone.getByRole('button', { name: 'Cancel' }).click();
  // The code in the field it is for.
  await buttons.first().click();
  check(await waitFor(async () => (await valueOf(phone, 'recipient-link')) === link), 'the recoverer\'s link from the camera fills its field, exactly as pasted');
  check(!(await phone.locator('dialog.scan-dialog').isVisible()), 'and the scanner closed by itself');
  check(await waitFor(() => phone.evaluate(() => document.querySelector('dialog video') === null)), 'releasing the camera');
  check((await remembered(phone)) !== null, 'the camera that read the code is kept on the device');
  // From a picture.
  await phone.locator('#recipient-link').fill('');
  await buttons.first().click();
  await phone.locator('.scan-picture input').setInputFiles(picture);
  check(await waitFor(async () => (await valueOf(phone, 'recipient-link')) === link), 'a picture of the code fills the field as well');
  // The camera is released when the page is hidden.
  await buttons.nth(1).click();
  await phone.getByText('This code is not a Bitcoin Cash address').waitFor({ timeout: 60_000 });
  // As text: a function written here would be given helpers the page does not have.
  await phone.evaluate("Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange'));");
  check(await waitFor(async () => (await runningCamera(phone)) === undefined), 'the camera is released when the page is hidden');

  check(problems.length === 0, `no errors on the pages${problems.length === 0 ? '' : `: ${problems.join(' | ')}`}`);
  log('PASSED');
} catch (error) {
  log(`FAILED: ${(error as Error).message.split('\n')[0]}`);
  if (problems.length > 0) log(`page problems: ${problems.join(' | ')}`);
  process.exitCode = 1;
} finally {
  for (const browser of browsers) await browser.close();
  for (const child of children) child.kill();
  rmSync(work, { recursive: true, force: true });
}
