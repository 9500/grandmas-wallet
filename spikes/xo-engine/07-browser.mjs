// Experiment 7 runner: serve the built page, open it twice in headless Chromium, and print what it reports.
// The second load shows whether engine state (keys, templates, invitations) persists in IndexedDB.
import { preview } from 'vite';
import { chromium } from 'playwright';

const server = await preview({ configFile: new URL('./browser/vite.config.mjs', import.meta.url).pathname, preview: { port: 4179 } });
const browser = await chromium.launch();
const context = await browser.newContext();
const page = await context.newPage();
const problems = [];
page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
page.on('console', (message) => { if (message.type() === 'error') problems.push(`console: ${message.text().slice(0, 160)}`); });
for (const visit of ['first load', 'second load']) {
  await page.goto('http://localhost:4179/');
  await page.waitForFunction(() => /DONE|FAILED/.test(document.getElementById('out').textContent), null, { timeout: 90000 }).catch(() => undefined);
  console.log(`--- ${visit}\n${await page.textContent('#out')}`);
}
console.log('--- distinct page problems\n' + [...new Set(problems)].slice(0, 8).join('\n'));
await browser.close();
await server.close();
process.exit(0);
