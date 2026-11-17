// The scripted run of stage 6: the two pages in a real browser, driven as a person would, on the local node
// or on chipnet. Each device is a browser profile of its own, kept on disk, so that a device that is "lost"
// is a profile that is no longer opened, and one that comes back is the same profile opened again.
//
//   1. the recoverer opens its page and gives its link        7. the phone is lost
//   2. the owner creates a wallet with that recoverer         8. a new phone takes the wallet over and sweeps
//   3. the recoverer takes in the kit; recovery is on         9. the wallet moves to a newer phone (new seed)
//   4. the owner receives                                     10. a new recoverer replaces the first
//   5. the owner pays                                         11. the user's own backup, restored elsewhere
//   6. an unwanted request is made and refused                12. the coins go back to where they came from
//
// usage (from the repository's root):
//   npx tsx scripts/browser-run.ts [local|chipnet] [--until <step number>] [--screens] [--headed] [--ask-again]
//
// --ask-again: the phone whose request is refused in step 6 is the same that takes over in step 8, and the
// recoverer asks the network again with the request it saved (the course of docs/walkthrough.md).
//
// local (the default): against the local node (deploy/regtest/regtest.sh status), with the pages of this
// checkout (deploy/preview.sh build) served on 127.0.0.1:8101 and :8102 and two backup stores on :8111 and
// :8112, unless something already answers there. The run makes the blocks and moves the chain's clock.
//
// chipnet: against the public pages named in deploy/config/production.json, as they are served. Coins come
// from the key in .chipnet/funder-design-2.json and go back to it at the end; blocks and the waiting period
// take their real time.
//
// Profiles and store data are under .chipnet/browser-run/ or .chipnet/browser-run-chipnet/ (not in git).
// The log is written to docs/runs/; with --screens, screenshots of every main screen at 390x844 and
// 1280x800 go to docs/screens/.
import { type ChildProcess, execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { hexToBin, lockingBytecodeToCashAddress } from '@bitauth/libauth';
import { type BrowserContext, type Page, chromium } from 'playwright';

const root = fileURLToPath(new URL('..', import.meta.url));
const chipnet = process.argv[2] === 'chipnet';
const work = `${root}.chipnet/browser-run${chipnet ? '-chipnet' : ''}/`;
const screens = `${root}docs/screens/`;
const argument = (name: string): string | undefined => {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : (process.argv[index + 1] ?? '');
};
const until = Number(argument('until') ?? '99');
const takeScreens = process.argv.includes('--screens');
const headed = process.argv.includes('--headed');
/** The phone whose request was refused in step 6 is the one that takes over in step 8: the recoverer asks the network again. */
const askAgain = process.argv.includes('--ask-again');
const config = JSON.parse(readFileSync(`${root}deploy/config/${chipnet ? 'production' : 'local-regtest'}.json`, 'utf8')) as { walletUrl: string; recovererUrl: string };
const WALLET = config.walletUrl;
const RECOVERER = config.recovererUrl;
/** On chipnet a block takes about a minute and may take several: every wait is given ten times as long. */
const patience = chipnet ? 10 : 1;

// ------------------------------------------------------------------ the log

const started = Date.now();
const lines: string[] = [];
const elapsed = (): string => `${((Date.now() - started) / 1000).toFixed(0).padStart(4)} s`;
const log = (line: string): void => {
  const entry = `${elapsed()}  ${line}`;
  lines.push(entry);
  console.log(entry);
};
const writeLog = (outcome: string): void => {
  mkdirSync(`${root}docs/runs`, { recursive: true });
  const where = chipnet
    ? `The pages are the public ones, ${WALLET} and ${RECOVERER}, as served, on chipnet with the public backup stores. Blocks and the waiting period took their real time.`
    : 'The pages are the production builds served by `deploy/serve.mjs` with the content security policy, against the regtest node and two backup stores on this machine. The run made the blocks and moved the chain\'s clock.';
  writeFileSync(
    `${root}docs/runs/stage-6-${chipnet ? 'chipnet' : 'local-node'}.md`,
    [
      `# Stage 6 scripted run in a browser, ${chipnet ? 'on chipnet with the public pages (run C)' : 'against the local node'}`,
      '',
      `Written by \`scripts/browser-run.ts\` on ${new Date(started).toISOString().slice(0, 16).replace('T', ' ')} UTC. Chromium (Playwright), one browser profile per device kept on disk under \`${work.slice(root.length)}\`. ${where} Times are seconds since the start.`,
      '',
      `Outcome: ${outcome}`,
      '',
      '```',
      ...lines,
      '```',
      '',
    ].join('\n'),
  );
};

// ------------------------------------------------------------------ the chain and the servers

const run = (file: string, args: string[]): string => execFileSync(file, args, { cwd: root, encoding: 'utf8' }).trim();
const pay = (address: string, satoshis: number): string => run('npx', ['tsx', chipnet ? 'scripts/chipnet-pay.ts' : 'scripts/local-pay.ts', address, String(satoshis)]);
/** On the local node the run makes the blocks; on chipnet they come by themselves. */
const mine = (blocks = 1): void => {
  if (!chipnet) run('npx', ['tsx', 'scripts/local-pay.ts', 'mine', String(blocks)]);
};
/** On the local node the run moves the chain's clock; on chipnet the waiting period takes its time. */
const passTime = (seconds: number): string => (chipnet ? 'the waiting period takes its real time' : run('npx', ['tsx', 'scripts/local-pay.ts', 'time', String(seconds)]));
/** An address outside every wallet of the run, to pay to: on chipnet the one the coins came from. */
const elsewhere = (() => {
  if (chipnet) return run('npx', ['tsx', 'scripts/chipnet-pay.ts', 'address']);
  const made = lockingBytecodeToCashAddress({ prefix: 'bchtest', bytecode: hexToBin(`76a914${'11'.repeat(20)}88ac`) });
  return typeof made === 'string' ? made : made.address;
})();

const children: ChildProcess[] = [];
const answers = async (url: string): Promise<boolean> => fetch(url).then(() => true, () => false);
const serve = async (url: string, command: string, args: string[], name: string): Promise<void> => {
  if (await answers(url)) return;
  const child = spawn(command, args, { cwd: root, stdio: ['ignore', 'ignore', 'inherit'] });
  children.push(child);
  for (let attempt = 0; attempt < 60 && !(await answers(url)); attempt++) await wait(250);
  if (!(await answers(url))) throw new Error(`${name} did not start`);
};
const wait = (milliseconds: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, milliseconds));

// ------------------------------------------------------------------ devices

interface Device {
  name: string;
  context: BrowserContext;
  page: Page;
}
const devices: Device[] = [];
const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 800 };

const device = async (name: string, fresh = true): Promise<Device> => {
  const directory = `${work}profiles/${name}`;
  if (fresh) rmSync(directory, { recursive: true, force: true });
  const context = await chromium.launchPersistentContext(directory, { headless: !headed, viewport: PHONE, deviceScaleFactor: 1 });
  const page = context.pages()[0] ?? (await context.newPage());
  page.on('pageerror', (error) => log(`  [${name}] page error: ${error.message.slice(0, 200)}`));
  page.on('console', (message) => {
    if (message.type() === 'error' && !/favicon|Failed to load resource/.test(message.text())) log(`  [${name}] console: ${message.text().slice(0, 200)}`);
  });
  const made = { name, context, page };
  devices.push(made);
  return made;
};
const close = async (gone: Device): Promise<void> => {
  await gone.context.close();
  devices.splice(devices.indexOf(gone), 1);
};

/** Wait for text on the page, patiently: an engine opens, blocks come, receipts are polled. */
const see = async (page: Page, text: string | RegExp, timeout = 180_000): Promise<void> => {
  await page.getByText(text).first().waitFor({ state: 'visible', timeout: timeout * patience });
};
const valueOf = async (page: Page, testId: string, timeout = 180_000): Promise<string> => {
  const element = page.getByTestId(testId).first();
  await element.waitFor({ state: 'visible', timeout: timeout * patience });
  return (await element.getAttribute('data-value')) ?? '';
};
const click = async (page: Page, name: string | RegExp, timeout = 180_000): Promise<void> => {
  const button = page.getByRole('button', { name }).first();
  await button.waitFor({ state: 'visible', timeout: timeout * patience });
  for (let attempt = 0; attempt < (timeout * patience) / 500 && !(await button.isEnabled()); attempt++) await wait(500);
  // To the middle of the screen: a button scrolled just into view may sit under the bar at the bottom of a phone's screen.
  await button.evaluate((element) => element.scrollIntoView({ block: 'center' }));
  await button.click();
};
const tick = async (page: Page, name: string | RegExp): Promise<void> => {
  await page.getByLabel(name).first().check();
};

/** The recoverer's screen of its wallet. The page opens on the wallet it last had open, or on the list of its wallets. */
const openDesk = async (page: Page): Promise<void> => {
  await page.goto(RECOVERER);
  const list = page.getByTestId('open-wallet').first();
  const desk = page.getByText('Where the wallet stands').first();
  await list.or(desk).first().waitFor({ state: 'visible', timeout: 60_000 * patience });
  if (!(await desk.isVisible())) await list.click();
  await desk.waitFor({ state: 'visible', timeout: 60_000 * patience });
};

/** Screenshots of a screen on a phone and on a desktop. */
const shot = async (page: Page, name: string): Promise<void> => {
  if (!takeScreens) return;
  mkdirSync(screens, { recursive: true });
  for (const [label, size] of [['phone', PHONE], ['desktop', DESKTOP]] as const) {
    await page.setViewportSize(size);
    await wait(400);
    // In a full-page picture the bar fixed at the bottom of a phone's screen would sit across the middle.
    // It is put at the end of the page for the picture.
    const phone = label === 'phone';
    await page.evaluate(() => {
      window.scrollTo(0, 0);
      document.querySelectorAll<HTMLElement>('.toast').forEach((element) => element.style.setProperty('display', 'none'));
      document.querySelectorAll<HTMLElement>('.topbar').forEach((element) => element.style.setProperty('position', 'static'));
    });
    if (phone) await page.evaluate(() => {
      const app = document.querySelector<HTMLElement>('.app.with-nav');
      const nav = document.querySelector<HTMLElement>('.nav');
      if (app === null || nav === null) return;
      app.style.setProperty('display', 'flex');
      app.style.setProperty('flex-direction', 'column');
      nav.style.setProperty('position', 'static');
      nav.style.setProperty('order', '10');
    });
    await page.screenshot({ path: `${screens}${name}-${label}.png`, fullPage: true });
    if (phone) await page.evaluate(() => {
      document.querySelectorAll<HTMLElement>('.app, .nav').forEach((element) => ['display', 'flex-direction', 'position', 'order'].forEach((property) => element.style.removeProperty(property)));
    });
    await page.evaluate(() => document.querySelectorAll<HTMLElement>('.toast, .topbar').forEach((element) => ['display', 'position'].forEach((property) => element.style.removeProperty(property))));
  }
  await page.setViewportSize(PHONE);
};

// ------------------------------------------------------------------ the run

let step = 0;
const begin = (title: string): boolean => {
  step += 1;
  if (step > until) return false;
  log(`${step}. ${title}`);
  return true;
};

const main = async (): Promise<void> => {
  if (chipnet) {
    for (const [name, url] of [['wallet', WALLET], ['recoverer', RECOVERER]] as const) {
      const version = (await (await fetch(`${url}version.json`)).json()) as { commit?: string; branch?: string; network?: string; releasedAt?: string };
      if (version.network !== 'chipnet') throw new Error(`${url} does not serve chipnet`);
      log(`${name} page: ${url}, commit ${version.commit} of ${version.branch}, released ${version.releasedAt}`);
    }
    log(`funding address: ${run('npx', ['tsx', 'scripts/chipnet-pay.ts', 'balance'])}`);
  } else {
    log(`local node: ${run(`${root}deploy/regtest/regtest.sh`, ['status']).split('\n')[0]}`);
    for (const app of ['wallet', 'recoverer']) if (!existsSync(`${root}apps/${app}/dist/index.html`)) throw new Error(`apps/${app} is not built`);
    mkdirSync(`${work}store1`, { recursive: true });
    mkdirSync(`${work}store2`, { recursive: true });
    const origins = ['--origin', 'http://localhost:8101', '--origin', 'http://localhost:8102'];
    await serve('http://127.0.0.1:8111/', process.execPath, ['--import', 'tsx', 'apps/archive-store/src/cli.ts', '--port', '8111', '--directory', `${work}store1`, ...origins], 'store 1');
    await serve('http://127.0.0.1:8112/', process.execPath, ['--import', 'tsx', 'apps/archive-store/src/cli.ts', '--port', '8112', '--directory', `${work}store2`, ...origins], 'store 2');
    // Each is started as a process of its own, not through a wrapper, so that it ends when the run does.
    for (const [app, port] of [['wallet', 8101], ['recoverer', 8102]] as const) {
      await serve(`http://127.0.0.1:${port}/`, process.execPath, ['deploy/serve.mjs', '--root', `apps/${app}/dist`, '--config', 'deploy/config/local-regtest.json', '--host', '127.0.0.1', '--port', String(port)], `the ${app} page`);
    }
  }

  if (askAgain) log('course: the phone whose request is refused in step 6 is the one that takes over in step 8 (--ask-again)');

  // 1 ------------------------------------------------------------------
  if (!begin('The recoverer opens its page and gives its link')) return;
  const recoverer = await device('recoverer');
  await recoverer.page.goto(`${RECOVERER}link`);
  await recoverer.page.getByLabel('Your name, as their wallet shows it').fill('Anna');
  await wait(300);
  const recovererLink = await valueOf(recoverer.page, 'recoverer-link');
  const recovererFingerprint = (await recoverer.page.locator('.fingerprint').first().textContent()) ?? '';
  log(`   link of ${recovererLink.length} characters; fingerprint ${recovererFingerprint}`);
  await shot(recoverer.page, 'recoverer-link');
  await recoverer.page.goto(RECOVERER);
  await see(recoverer.page, 'No wallets yet.');
  await shot(recoverer.page, 'recoverer-empty');

  // 2 ------------------------------------------------------------------
  if (!begin('The owner creates a wallet with Anna as recoverer')) return;
  const old = await device('old-phone');
  await old.page.goto(WALLET);
  await see(old.page, 'Make a new wallet');
  await shot(old.page, 'wallet-welcome');
  await old.page.goto(recovererLink);
  await see(old.page, 'You opened the link of');
  await click(old.page, /Make a new wallet/);
  await see(old.page, 'Fingerprint of their key');
  const seenFingerprint = (await old.page.locator('.fingerprint').first().textContent()) ?? '';
  if (seenFingerprint !== recovererFingerprint) throw new Error(`the fingerprints differ: ${seenFingerprint} and ${recovererFingerprint}`);
  log(`   the wallet shows the same fingerprint, ${seenFingerprint}`);
  await tick(old.page, 'The fingerprints are the same');
  await shot(old.page, 'wallet-create-setup');
  await click(old.page, 'Continue');
  const funding = await valueOf(old.page, 'funding-address');
  log(`   funding address ${funding}`);
  await shot(old.page, 'wallet-create-funding');
  log(`   ${pay(funding, 120_000)}`);
  await click(old.page, 'Create the wallet');
  await see(old.page, 'Waiting for the network to put the new wallet in a block');
  log(chipnet ? '   created; waiting for a block' : '   created; waiting for a block, which the run makes now');
  await shot(old.page, 'wallet-create-waiting');
  mine(1);
  const kitLink = await valueOf(old.page, 'kit-link');
  log(`   confirmed; the kit link has ${kitLink.length} characters`);
  await see(old.page, /Recovery is not on yet|Checking the wallet's protection/);
  await shot(old.page, 'wallet-home-kit-sent');

  // 3 ------------------------------------------------------------------
  if (!begin('Anna takes in the kit; the wallet says that recovery is on')) return;
  await recoverer.page.goto(kitLink);
  await see(recoverer.page, 'A recovery kit has arrived');
  await recoverer.page.getByLabel('Whose wallet is this?').fill('Grandma');
  await shot(recoverer.page, 'recoverer-kit-arrived');
  await click(recoverer.page, 'Check and keep the kit');
  await see(recoverer.page, 'You look after Grandma now');
  log('   the recoverer kept the kit and left its receipt');
  await shot(recoverer.page, 'recoverer-kit-kept');
  await see(old.page, 'Protected', 120_000);
  log('   the wallet shows "Protected"');

  // 4 ------------------------------------------------------------------
  if (!begin('The owner receives')) return;
  await old.page.getByRole('link', { name: 'Receive' }).first().click();
  const receiving = await valueOf(old.page, 'receive-address');
  log(`   address ${receiving}`);
  log(`   ${pay(receiving, 50_000)}`);
  await shot(old.page, 'wallet-receive');
  await old.page.getByRole('button', { name: 'For regular payments' }).click();
  const vaultAddress = await valueOf(old.page, 'receive-address');
  log(`   vault address ${vaultAddress}`);
  await shot(old.page, 'wallet-receive-vault');
  await old.page.getByRole('link', { name: 'Home' }).first().click();
  await see(old.page, /^0\.00\d+/);
  for (let attempt = 0; attempt < 30; attempt++) {
    const balance = (await old.page.getByTestId('balance').textContent()) ?? '';
    if (Number(balance.replace(/[^0-9.]/g, '')) > 0.0011) break;
    await wait(1_000);
  }
  log(`   the wallet holds ${(await old.page.getByTestId('balance').textContent())?.replace('BCH', ' BCH')}`);
  await shot(old.page, 'wallet-home');

  // 5 ------------------------------------------------------------------
  if (!begin('The owner pays, and sees the fee before sending')) return;
  await old.page.getByRole('link', { name: 'Send' }).first().click();
  await old.page.getByLabel('To').fill(elsewhere);
  await old.page.getByLabel('Amount').fill('0.0002');
  await click(old.page, 'Review');
  await see(old.page, 'Check and send');
  const fee = (await old.page.locator('dd').nth(2).textContent()) ?? '';
  log(`   the review shows a fee of ${fee}`);
  await shot(old.page, 'wallet-send-review');
  await click(old.page, /^Send$/);
  await see(old.page, 'Sent');
  log(`   sent in ${await valueOf(old.page, 'sent-transaction')}`);
  await shot(old.page, 'wallet-send-done');
  mine(1);

  // 6 ------------------------------------------------------------------
  if (!begin('A request the owner did not make is refused')) return;
  const stranger = await device('stranger');
  await stranger.page.goto(recovererLink);
  await click(stranger.page, /Take over my wallet on this phone/);
  await tick(stranger.page, 'The fingerprints are the same');
  await click(stranger.page, 'Make my request');
  const strangerLink = await valueOf(stranger.page, 'takeover-link');
  const strangerFingerprint = (await stranger.page.locator('.fingerprint').first().textContent()) ?? '';
  log(`   a request from a phone with key ${strangerFingerprint}`);
  await recoverer.page.goto(strangerLink);
  await see(recoverer.page, 'A takeover request has arrived');
  await click(recoverer.page, 'See the request');
  await tick(recoverer.page, 'I have made sure who is asking');
  await shot(recoverer.page, 'recoverer-request');
  await click(recoverer.page, 'Save it for this wallet');
  await click(recoverer.page, /Ask the network/);
  await see(recoverer.page, 'The request is sent');
  log('   the recoverer (deceived, or its key stolen) asked the network');
  mine(1);
  await see(recoverer.page, 'Your request is waiting');
  await shot(recoverer.page, 'recoverer-request-waiting');
  await old.page.getByRole('link', { name: 'Home' }).first().click();
  await see(old.page, 'Someone asked to move your wallet', 60_000);
  log('   the owner\'s phone shows the alarm');
  await shot(old.page, 'wallet-alarm');
  await click(old.page, 'Refuse the request');
  await see(old.page, 'The request is refused.');
  log('   refused');
  mine(1);
  await see(old.page, 'This phone cannot refuse a request', 60_000);
  log('   the coin for cancelling paid for the refusal; the wallet says that it cannot refuse another');
  await shot(old.page, 'wallet-no-cancel-coin');
  await click(old.page, 'Put a coin aside');
  mine(1);
  await see(old.page, 'Protected', 60_000);
  log('   a new coin is put aside; protected again');
  await see(recoverer.page, 'The owner\'s phone refused your request', 60_000);
  log('   the recoverer sees the refusal; the wallet is protected again');
  if (!askAgain) await close(stranger);

  // 7 ------------------------------------------------------------------
  if (!begin('The phone is lost')) return;
  await close(old);
  log('   the old phone\'s profile is no longer opened');

  // 8 ------------------------------------------------------------------
  if (!begin('A new phone takes the wallet over with Anna\'s help, and sweeps')) return;
  let next: Device;
  if (askAgain) {
    // The same phone asks again: its request is still with the recoverer, who asks the network once more.
    next = stranger;
    await openDesk(recoverer.page);
    await see(recoverer.page, 'A saved takeover request');
    const shown = (await recoverer.page.locator('.fingerprint').first().textContent()) ?? '';
    if (shown !== strangerFingerprint) throw new Error(`the recoverer sees ${shown}, the phone ${strangerFingerprint}`);
    log(`   the recoverer still holds the request of ${shown}, and asks the network again`);
    await click(recoverer.page, 'Ask the network again');
  } else {
    next = await device('new-phone');
    await next.page.goto(recovererLink);
    await click(next.page, /Take over my wallet on this phone/);
    await tick(next.page, 'The fingerprints are the same');
    await click(next.page, 'Make my request');
    const takeoverLink = await valueOf(next.page, 'takeover-link');
    const nextFingerprint = (await next.page.locator('.fingerprint').first().textContent()) ?? '';
    await shot(next.page, 'wallet-takeover-request');
    await recoverer.page.goto(takeoverLink);
    await click(recoverer.page, 'See the request');
    const shown = (await recoverer.page.locator('.fingerprint').first().textContent()) ?? '';
    if (shown !== nextFingerprint) throw new Error(`the recoverer sees ${shown}, the new phone ${nextFingerprint}`);
    log(`   both sides show ${shown}`);
    await tick(recoverer.page, 'I have made sure who is asking');
    await click(recoverer.page, 'Save it for this wallet');
    await click(recoverer.page, /Ask the network/);
  }
  await see(recoverer.page, 'The request is sent');
  mine(1);
  await see(recoverer.page, 'Your request is waiting');
  log('   the request is in a block; the waiting period runs');
  log(`   ${passTime(700)}`);
  // On chipnet the chain's clock has to pass 512 seconds: the button is enabled when it has.
  await click(recoverer.page, 'Complete the move', chipnet ? 360_000 : 120_000);
  await see(recoverer.page, 'The wallet is moved');
  mine(1);
  const handOver = await valueOf(recoverer.page, 'handover-link', 120_000);
  log('   completed; the hand-over link is ready');
  await shot(recoverer.page, 'recoverer-handover');
  await next.page.goto(handOver);
  await see(next.page, 'Bringing your coins over');
  await shot(next.page, 'wallet-arrival');
  for (let attempt = 0; attempt < 40; attempt++) {
    if (await next.page.getByRole('button', { name: 'Open the wallet' }).isVisible()) break;
    mine(1);
    await wait(3_000);
  }
  await click(next.page, 'Open the wallet');
  mine(1);
  await see(next.page, 'In your wallet');
  for (let attempt = 0; attempt < 30; attempt++) {
    const balance = (await next.page.getByTestId('balance').textContent()) ?? '';
    if (Number(balance.replace(/[^0-9.]/g, '')) > 0.001) break;
    await wait(1_000);
  }
  log(`   the new phone holds ${(await next.page.getByTestId('balance').textContent())?.replace('BCH', ' BCH')}`);
  await see(next.page, 'Protected', 120_000);
  log('   recovery is on for the new phone');
  await shot(next.page, 'wallet-home-after-takeover');
  // The lost phone, found again, knows it no longer owns the wallet.
  const found = await device('old-phone', false);
  await found.page.goto(WALLET);
  await see(found.page, 'This wallet now belongs to another key');
  log('   the old phone, opened again, says the wallet belongs to another key');
  await shot(found.page, 'wallet-owned-elsewhere');
  await close(found);

  // 9 ------------------------------------------------------------------
  if (!begin('The wallet moves to a newer phone, the new phone still working')) return;
  const newer = await device('newer-phone');
  await newer.page.goto(WALLET);
  await click(newer.page, /Move from my other phone/);
  await click(newer.page, 'Start');
  const prepareLink = await valueOf(newer.page, 'prepare-link');
  await shot(newer.page, 'wallet-move-in');
  await next.page.goto(prepareLink);
  await click(next.page, 'Move to the new phone');
  await tick(next.page, 'The new phone shows the same fingerprint');
  await click(next.page, 'Continue');
  const updateLink = await valueOf(next.page, 'update-link');
  const moveLink = await valueOf(next.page, 'move-link');
  await shot(next.page, 'wallet-move-out');
  await recoverer.page.goto(updateLink);
  await see(recoverer.page, 'update taken in');
  log('   the recoverer took in the update and left a prepared receipt');
  await newer.page.goto(moveLink);
  await see(next.page, 'Your wallet is on your new phone now', 120_000);
  log('   the old phone made the change');
  mine(1);
  await see(newer.page, 'Bringing your coins over', 120_000);
  await click(newer.page, 'Open the wallet', 180_000);
  mine(1);
  await see(newer.page, 'Protected', 120_000);
  log(`   the newer phone holds ${(await newer.page.getByTestId('balance').textContent())?.replace('BCH', ' BCH')}; recovery is on`);
  await shot(newer.page, 'wallet-home-after-move');

  // 10 ------------------------------------------------------------------
  if (!begin('Ben replaces Anna as recoverer')) return;
  const ben = await device('second-recoverer');
  await ben.page.goto(`${RECOVERER}link`);
  await ben.page.getByLabel('Your name, as their wallet shows it').fill('Ben');
  await wait(300);
  const benLink = await valueOf(ben.page, 'recoverer-link');
  await newer.page.goto(benLink);
  await click(newer.page, 'Change recoverer');
  await tick(newer.page, 'The fingerprints are the same');
  await click(newer.page, 'Send them a kit');
  const benKit = await valueOf(newer.page, 'new-recoverer-link');
  await ben.page.goto(benKit);
  await see(ben.page, 'A recovery kit has arrived');
  await ben.page.getByLabel('Whose wallet is this?').fill('Grandma');
  await click(ben.page, 'Check and keep the kit');
  await see(ben.page, 'This kit is for a new recoverer');
  await click(ben.page, 'Keep it as the new recoverer');
  await see(ben.page, 'You look after Grandma now');
  log('   Ben took the kit in as the new recoverer');
  await see(newer.page, /is your recoverer now|The wallet names/, 120_000);
  mine(1);
  await newer.page.getByRole('link', { name: 'Home' }).first().click();
  await see(newer.page, 'Recovery is on with Ben', 180_000);
  log('   the wallet names Ben, and recovery is on with him');
  await shot(newer.page, 'wallet-home-after-new-recoverer');
  await newer.page.getByRole('link', { name: 'Recovery' }).first().click();
  await see(newer.page, 'Coin for cancelling: kept');
  await shot(newer.page, 'wallet-recovery');
  await ben.page.goto(RECOVERER);
  await see(ben.page, 'Quiet', 60_000);
  await shot(ben.page, 'recoverer-wallets');

  // 11 ------------------------------------------------------------------
  if (!begin('The owner keeps a backup, and restores the wallet from it on another phone')) return;
  await newer.page.getByRole('button', { name: /Your own backup/ }).click();
  await newer.page.getByRole('button', { name: 'Complete' }).click();
  await click(newer.page, 'Show the backup');
  const backup = await valueOf(newer.page, 'backup-text');
  log(`   the complete backup has ${backup.split('\n').length - 1} lines, ${backup.length} characters`);
  // The words are not put into the repository, not even as a picture.
  await newer.page.evaluate(() =>
    document.querySelectorAll<HTMLElement>('.backup-text > div').forEach((line) => {
      if (line.textContent?.startsWith('words: ') === true) line.textContent = 'words: (twelve words, hidden in this picture)';
    }),
  );
  await shot(newer.page, 'wallet-backup');
  await newer.page.goto(`${WALLET}details`);
  await see(newer.page, 'Technical details');
  await see(newer.page, /active/);
  await shot(newer.page, 'wallet-details');
  const restored = await device('restored-phone');
  await restored.page.goto(WALLET);
  await click(restored.page, /Restore from my own backup/);
  await restored.page.getByLabel('Your backup').fill(backup);
  await click(restored.page, /^Restore$/);
  await see(restored.page, 'Bringing your coins over');
  await click(restored.page, 'Open the wallet', 180_000);
  await see(restored.page, 'In your wallet');
  for (let attempt = 0; attempt < 30; attempt++) {
    const balance = (await restored.page.getByTestId('balance').textContent()) ?? '';
    if (Number(balance.replace(/[^0-9.]/g, '')) > 0.001) break;
    await wait(1_000);
  }
  log(`   the restored phone shows ${(await restored.page.getByTestId('balance').textContent())?.replace('BCH', ' BCH')}, the same wallet with no waiting period`);
  await shot(restored.page, 'wallet-home-restored');
  await close(restored);

  // 12 ------------------------------------------------------------------
  if (!begin('The coins go back to where they came from')) return;
  await newer.page.getByRole('link', { name: 'Send' }).first().click();
  await newer.page.getByLabel('To').fill(elsewhere);
  await click(newer.page, 'Send everything instead');
  await see(newer.page, 'The coin kept for cancelling goes too');
  const arrives = (await newer.page.locator('dd').nth(1).textContent()) ?? '';
  const everythingFee = (await newer.page.locator('dd').nth(2).textContent()) ?? '';
  await shot(newer.page, 'wallet-send-everything');
  await click(newer.page, /^Send everything$/);
  await see(newer.page, 'Sent');
  log(`   the wallet sent everything: ${arrives.replace('BCH', ' BCH')} arrives, fee ${everythingFee}`);
  mine(1);
  // Anna is no longer the wallet's recoverer. What is left of her allowance is hers, and she sends it back.
  await openDesk(recoverer.page);
  await see(recoverer.page, 'The wallet no longer names you');
  // The bar fixed at the bottom of a phone's screen would cover a row scrolled just into view.
  const elsewhereRow = recoverer.page.getByText('Send the fee coins elsewhere');
  await elsewhereRow.evaluate((element) => element.scrollIntoView({ block: 'center' }));
  await elsewhereRow.click();
  await recoverer.page.getByLabel('To').fill(elsewhere);
  await click(recoverer.page, 'Send them');
  await see(recoverer.page, /Sent; the fee was \d+ satoshis/);
  log(`   Anna, no longer the recoverer, sent the rest of her allowance back: ${(await recoverer.page.getByText(/Sent; the fee was \d+ satoshis/).first().textContent())?.trim()}`);
  mine(1);
  if (chipnet) {
    await wait(5_000);
    log(`   funding address: ${run('npx', ['tsx', 'scripts/chipnet-pay.ts', 'balance'])}`);
  }
};

try {
  await main();
  writeLog(step >= 12 && until >= 12 ? 'every step was carried out.' : `stopped after step ${Math.min(step, until)}, as asked.`);
} catch (error) {
  log(`FAILED at step ${step}: ${(error as Error).message.split('\n')[0]}`);
  for (const gone of devices) await gone.page.screenshot({ path: `${work}failure-${gone.name}.png`, fullPage: true }).catch(() => undefined);
  writeLog(`failed at step ${step}; see the last lines.`);
  process.exitCode = 1;
} finally {
  for (const gone of [...devices]) await gone.context.close().catch(() => undefined);
  for (const child of children) child.kill();
}
