// Opens a browser profile that a page of the second design left, with this checkout's build served at the page's
// own address, as the public sites will serve it once this design is released there: does the page open what the
// earlier page stored, and show it without errors?
//
// The profile is copied first and only the copy is opened; the original is not changed. Requests to the page's
// origin are answered from `apps/<page>/dist` (build it first: deploy/preview.sh build) with the configuration
// given, as deploy/serve.mjs would; everything else (the chain's servers, the backup stores, the relays) is reached
// as the configuration names it.
//
// usage: npx tsx scripts/earlier-profile-check.ts <wallet|recoverer> <profile directory> <pictures directory>
//          [--config deploy/config/production.json] [--seconds 90]
//
// Prints what each screen says, every error the page reported, and the pictures taken (390x844 and 1280x800).
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';

const root = fileURLToPath(new URL('..', import.meta.url));
const [which, profile, pictures] = process.argv.slice(2).filter((word, index, all) => !word.startsWith('--') && !all[index - 1]?.startsWith('--'));
const option = (name: string, fallback: string): string => {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : (process.argv[index + 1] ?? fallback);
};
if ((which !== 'wallet' && which !== 'recoverer') || profile === undefined || pictures === undefined || !existsSync(profile)) {
  console.error('usage: npx tsx scripts/earlier-profile-check.ts <wallet|recoverer> <profile directory> <pictures directory> [--config <file>] [--seconds <n>]');
  process.exit(2);
}
const config = JSON.parse(readFileSync(option('config', `${root}deploy/config/production.json`), 'utf8')) as { walletUrl: string; recovererUrl: string };
const seconds = Number(option('seconds', '90'));
const url = which === 'wallet' ? config.walletUrl : config.recovererUrl;
const origin = new URL(url).origin;
const dist = `${root}apps/${which}/dist`;
if (!existsSync(`${dist}/index.html`)) throw new Error(`apps/${which} is not built: deploy/preview.sh build`);

const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.wasm': 'application/wasm' };
const flat = (text: string): string => text.replace(/\s+/g, ' ').trim();

const copy = mkdtempSync(join(tmpdir(), 'earlier-profile-'));
cpSync(profile, copy, { recursive: true });
rmSync(join(copy, 'SingletonLock'), { force: true });
const errors: string[] = [];
const context = await chromium.launchPersistentContext(copy, { viewport: { width: 390, height: 844 } });
try {
  await context.route(`${origin}/**`, async (route) => {
    const path = decodeURIComponent(new URL(route.request().url()).pathname);
    if (path === '/config.json') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(config) });
    if (path === '/version.json') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ commit: 'check', network: 'chipnet' }) });
    const requested = normalize(join(dist, path));
    const file = requested.startsWith(dist) && existsSync(requested) && statSync(requested).isFile() ? requested : join(dist, 'index.html');
    return route.fulfill({ status: 200, contentType: TYPES[extname(file)] ?? 'application/octet-stream', body: readFileSync(file) });
  });
  const page = context.pages()[0] ?? (await context.newPage());
  page.on('pageerror', (error) => errors.push(`page error: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text().slice(0, 300)}`);
  });
  const stored = async (): Promise<string[]> => page.evaluate(() => Object.keys(localStorage).sort());
  const look = async (name: string, path: string): Promise<void> => {
    await page.goto(new URL(path, url).toString());
    await page.waitForTimeout(seconds * 1000);
    console.log(`--- ${name} (${path})\n${flat(await page.locator('body').innerText())}\n`);
    for (const [label, viewport] of [['phone', { width: 390, height: 844 }], ['desktop', { width: 1280, height: 800 }]] as const) {
      await page.setViewportSize(viewport);
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${pictures}/${which}-${name}-${label}.png`, fullPage: true });
    }
    await page.setViewportSize({ width: 390, height: 844 });
  };
  await page.goto(url);
  console.log(`kept by the earlier page: ${(await stored()).join(', ')}`);
  if (which === 'wallet') {
    await look('home', '/');
    await look('apps', '/apps');
    await look('details', '/details');
  } else {
    await look('home', '/');
  }
} finally {
  await context.close();
  rmSync(copy, { recursive: true, force: true });
}
console.log(errors.length === 0 ? 'No errors reported by the page.' : `Errors reported by the page:\n${errors.join('\n')}`);
