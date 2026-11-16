// Drives the whole demonstration through the three web applications in real browsers:
// an owner's device, a recoverer, a savings jar application, an attempt the owner cancels,
// loss of the owner's device, and a new device taking the wallet over with its jar.
//
// usage: node scripts/browser-demo.mjs [--config deploy/config/local.json] [--fund-from owner] [--amount 20000]
//                                      [--return-to <address>] [--shots <directory>] [--skip-cancel]
//
// The owner's new account needs test coins. With --fund-from, they are sent from one of the command-line
// accounts (npm run xo-demo -- addresses); otherwise the script prints the address and waits.
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { chromium } from 'playwright';

const argument = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1];
};
const flag = (name) => process.argv.includes(`--${name}`);

const config = JSON.parse(readFileSync(resolve(argument('config', 'deploy/config/local.json')), 'utf8'));
const shots = argument('shots');
if (shots !== undefined) mkdirSync(shots, { recursive: true });
const fundFrom = argument('fund-from');
const amount = argument('amount', '20000');
const returnTo = argument('return-to');
const MINUTE = 60_000;

const started = Date.now();
const say = (message) => console.log(`[${String(Math.round((Date.now() - started) / 1000)).padStart(4)}s] ${message}`);

// Each device keeps its browser storage on disk, so that the keys made during a run outlive the run:
// a device's directory can be opened again with a browser to reach its wallet.
const profiles = resolve(argument('profiles', `.xo-demo/browser/${new Date().toISOString().replaceAll(/[:.]/g, '-')}`));
mkdirSync(profiles, { recursive: true });
const contexts = [];
let shotNumber = 0;

/** One device: its own browser storage, one page at a time. */
const device = async (name) => {
  const context = await chromium.launchPersistentContext(resolve(profiles, name), { viewport: { width: 760, height: 1100 } });
  contexts.push(context);
  for (const blank of context.pages()) await blank.close();
  let page;
  const watch = (opened) => {
    opened.on('pageerror', (error) => say(`  ! ${name}: ${error.message.slice(0, 200)}`));
    return opened;
  };
  return {
    name,
    get page() {
      return page;
    },
    /** Open an address the way following a link does: in a fresh tab, the old one closed. */
    async open(url) {
      await page?.close();
      page = watch(await context.newPage());
      await page.goto(url);
      return page;
    },
    async shot(label) {
      if (shots === undefined || page === undefined) return;
      shotNumber += 1;
      await page.screenshot({ path: resolve(shots, `${String(shotNumber).padStart(2, '0')}-${name}-${label}.png`), fullPage: true });
    },
    close: () => context.close(),
  };
};

const button = (page, name) => page.getByRole('button', { name, exact: false }).first();
const linkOf = async (page, name, timeout = MINUTE) => {
  const anchor = page.getByRole('link', { name, exact: false }).first();
  await anchor.waitFor({ timeout });
  return anchor.getAttribute('href');
};
const see = (page, text, timeout = MINUTE) => page.getByText(text, { exact: false }).first().waitFor({ timeout });
const click = async (page, name, timeout = MINUTE, exact = false) => {
  const target = exact ? page.getByRole('button', { name, exact: true }).first() : button(page, name);
  await target.waitFor({ timeout });
  await page.waitForFunction((element) => !element.disabled, await target.elementHandle(), { timeout });
  await target.click();
};
const failIfError = async (page, where) => {
  const alert = page.getByRole('alert').first();
  if (await alert.isVisible().catch(() => false)) throw new Error(`${where}: ${await alert.innerText()}`);
};
/** Wait for text, failing early if the page shows an error instead. */
const expectText = async (page, text, timeout, where) => {
  const deadline = Date.now() + timeout;
  for (;;) {
    if (await page.getByText(text, { exact: false }).first().isVisible().catch(() => false)) return;
    await failIfError(page, where);
    if (Date.now() > deadline) throw new Error(`${where}: "${text}" did not appear`);
    await page.waitForTimeout(1_000);
  }
};

const from = argument('from');
const resume = from === 'move' || from === 'complete' || from === 'return';
const owner = await device('owner');
const recoverer = await device('recoverer');
const jar = await device('jar');

let jarOpenedAt = 0;
try {
  if (resume) {
    // Continue an earlier run from its kept browser storage, at the first request to move the wallet.
    await owner.open(config.walletUrl);
    if (from !== 'return') await see(owner.page, 'Held with applications', 3 * MINUTE);
    await recoverer.open(config.recovererUrl);
  } else {
  // ── A new wallet ────────────────────────────────────────────────────────────────────────────
  say('Owner: starting a new wallet');
  await owner.open(config.walletUrl);
  await click(owner.page, 'Create a new wallet');
  await see(owner.page, 'Put some coins in', 2 * MINUTE);
  const depositAddress = (await owner.page.locator('.copybox code').first().innerText()).trim();
  say(`Owner: deposit address ${depositAddress}`);
  if (fundFrom !== undefined) {
    say(`Sending ${amount} sat from the "${fundFrom}" command-line account`);
    const sent = spawnSync('npm', ['run', 'xo-demo', '--', 'distribute', fundFrom, `${depositAddress}=${amount}`], { encoding: 'utf8' });
    if (sent.status !== 0) throw new Error(`funding failed: ${sent.stdout.slice(-400)} ${sent.stderr.slice(-400)}`);
  } else {
    say(`Waiting for at least ${amount} sat at that address`);
  }
  await see(owner.page, 'that is enough', 30 * MINUTE);
  await owner.shot('funded');
  await click(owner.page, 'Create the wallet');
  await expectText(owner.page, 'Recovery is not set up yet', 4 * MINUTE, 'creating the wallet');
  await owner.shot('created');
  say('Owner: wallet created');

  // ── Enrolling the recoverer ─────────────────────────────────────────────────────────────────
  await recoverer.open(config.recovererUrl);
  const setupLink = await linkOf(recoverer.page, 'Open the wallet page');
  await recoverer.shot('home');
  await owner.open(setupLink);
  await click(owner.page, 'Make the package for', 2 * MINUTE);
  const packageLink = await linkOf(owner.page, 'Open the recoverer\'s page');
  say(`Owner: package made, link of ${packageLink.length} characters`);
  await owner.shot('package');
  await recoverer.open(packageLink);
  await see(recoverer.page, 'The package matches the wallet', 2 * MINUTE);
  await recoverer.page.getByPlaceholder('Grandma Ana').fill('Grandma Ana');
  await recoverer.shot('package-opened');
  await click(recoverer.page, 'Keep it and confirm');
  await see(recoverer.page, 'Grandma Ana', MINUTE);
  await expectText(owner.page, 'Recovery is on', 2 * MINUTE, 'waiting for the recoverer\'s confirmation');
  await owner.shot('recovery-on');
  say('Owner: the recoverer confirmed; recovery is on');

  // ── A savings jar, asked for by an application ──────────────────────────────────────────────
  await jar.open(config.jarUrl);
  // The application shows one WizardConnect address for any wallet; the owner copies it into the wallet.
  const address = jar.page.locator('.copybox code').first();
  await address.waitFor({ timeout: MINUTE });
  const connectAddress = (await address.innerText()).trim();
  await jar.shot('connect');
  await owner.page.getByPlaceholder('wiz://', { exact: false }).fill(connectAddress);
  await click(owner.page, 'Continue', MINUTE);
  await click(owner.page, 'Connect', 2 * MINUTE, true);
  await see(jar.page, 'Your savings jars', 2 * MINUTE);
  say('Application: connected to the wallet');
  await jar.page.getByPlaceholder('0').fill('2000');
  await jar.page.getByPlaceholder('Holiday').fill('Holiday');
  await click(jar.page, 'Open a savings jar');
  // The wallet has never seen the application's template: it asks whether to trust it, then shows the action.
  await see(owner.page, 'asks for your approval', 2 * MINUTE);
  await see(owner.page, 'a template this wallet has not seen before', MINUTE);
  await owner.shot('template');
  await click(owner.page, 'Trust and remember this template', MINUTE);
  await expectText(owner.page, 'what this wallet worked out', 2 * MINUTE, 'working out the action');
  await owner.shot('approval');
  await click(owner.page, 'Approve', MINUTE, true);
  await expectText(jar.page, 'Done.', 3 * MINUTE, 'opening the jar');
  await jar.shot('jar-opened');
  await see(owner.page, 'Held with applications', MINUTE);
  await owner.shot('position');
  jarOpenedAt = Date.now();
  say('Application: the jar is open; the wallet recorded it before signing');
  }

  // ── A request the owner did not ask for ─────────────────────────────────────────────────────
  if (from !== 'return') {
    await click(recoverer.page, 'Open', MINUTE, true);
    await see(recoverer.page, 'What a new device would find', 3 * MINUTE);
    await see(recoverer.page, 'Records complete', 2 * MINUTE);
    await recoverer.shot('desk');
  }
  const startMove = async (target) => {
    // A run that is being continued may already have started the request, or set the device up.
    if (!(await recoverer.page.getByRole('link', { name: 'Open on the new device' }).first().isVisible().catch(() => false))) {
      await recoverer.page.getByRole('checkbox').check();
      await click(recoverer.page, 'Start', MINUTE, true);
    }
    const restoreLink = await linkOf(recoverer.page, 'Open on the new device', 2 * MINUTE);
    await target.open(restoreLink);
    await target.page.getByText(/Set up this device|Give this link to your recoverer/).first().waitFor({ timeout: 2 * MINUTE });
    if (await button(target.page, 'Set up this device').isVisible().catch(() => false)) await click(target.page, 'Set up this device', 2 * MINUTE);
    const joinLink = await linkOf(target.page, 'Open the recoverer\'s page', 2 * MINUTE);
    await recoverer.open(joinLink);
    await click(recoverer.page, 'Sign and send the request', 3 * MINUTE);
    await expectText(recoverer.page, 'A move is waiting', 3 * MINUTE, 'sending the request');
  };
  if (!flag('skip-cancel') && from !== 'complete' && from !== 'return') {
    say('Recoverer: asking to move the wallet without the owner having asked');
    const stranger = await device('stranger');
    await startMove(stranger);
    await see(owner.page, 'Someone asked to move this wallet', 2 * MINUTE);
    await owner.shot('alarm');
    say('Owner: warned on the device; cancelling');
    await click(owner.page, 'Cancel the request');
    await owner.page.getByText('Someone asked to move this wallet').first().waitFor({ state: 'hidden', timeout: 3 * MINUTE });
    await expectText(stranger.page, 'The move is not going ahead', 2 * MINUTE, 'the cancelled request');
    await stranger.shot('cancelled');
    await stranger.close();
    await see(recoverer.page, 'Move this wallet to a new device', 2 * MINUTE);
    say('Owner: cancelled; the wallet is unchanged');
  }

  // ── The owner's device is lost ──────────────────────────────────────────────────────────────
  say('Owner: the device is lost; the owner asks the recoverer for help from a new one');
  const newDevice = await device('new-device');
  if (from === 'return') {
    await newDevice.open(config.walletUrl);
  } else {
  if (from === 'complete') {
    await see(recoverer.page, 'A move is waiting', 3 * MINUTE);
  } else {
    await startMove(newDevice);
  }
  const requestedLink = await linkOf(recoverer.page, 'Open on the new device', 2 * MINUTE);
  await recoverer.shot('move-waiting');
  await newDevice.open(requestedLink);
  await expectText(newDevice.page, 'The waiting period', 3 * MINUTE, 'taking in the request');
  await newDevice.shot('waiting');
  say('New device: request taken in; waiting for the waiting period');
  await click(recoverer.page, 'Complete the move', 40 * MINUTE);
  for (let attempt = 0; ; attempt++) {
    const done = recoverer.page.getByText('The wallet has moved to the new device').first();
    await recoverer.page.waitForTimeout(8_000);
    if (await done.isVisible().catch(() => false)) break;
    // The network's clock can be a little behind the estimate; the page says so and the button is tried again.
    if (attempt > 150) throw new Error('completing the move did not succeed');
    if (await recoverer.page.getByRole('alert').first().isVisible().catch(() => false)) {
      say(`Recoverer: ${(await recoverer.page.getByRole('alert').first().innerText()).slice(0, 200)}`);
      await recoverer.page.waitForTimeout(30_000);
      await click(recoverer.page, 'Complete the move', 5 * MINUTE);
    }
  }
  await recoverer.shot('moved');
  say('Recoverer: move completed');
  await click(newDevice.page, 'Open my wallet', 3 * MINUTE);
  await expectText(newDevice.page, 'Your wallet is on this device now', 4 * MINUTE, 'opening the wallet on the new device');
  await see(newDevice.page, 'Holiday', MINUTE);
  await newDevice.shot('taken-over');
  say('New device: the wallet and its jar are here');
  if (from !== 'return') await expectText(owner.page, 'This wallet has moved to another device', 2 * MINUTE, 'the earlier device');
  await owner.shot('moved-away');
  say('Earlier device: shows that the wallet has moved');

  // ── The jar, on the new device ──────────────────────────────────────────────────────────────
  // The jar was locked for ten minutes, and the network's clock runs some minutes behind.
  const unlockIn = jarOpenedAt + 10 * MINUTE + 20_000 - Date.now();
  if (unlockIn > 0) {
    say(`New device: waiting ${Math.round(unlockIn / 1000)} s for the jar's time lock`);
    await newDevice.page.waitForTimeout(unlockIn);
  }
  // The application is not involved: the wallet offers the action the jar's own template names.
  for (let attempt = 0; ; attempt++) {
    await newDevice.open(config.walletUrl);
    await click(newDevice.page, 'Empty a savings jar', 3 * MINUTE, true);
    await expectText(newDevice.page, 'what this wallet worked out', 2 * MINUTE, 'working out the action');
    if (attempt === 0) await newDevice.shot('emptying');
    await click(newDevice.page, 'Confirm', MINUTE, true);
    await newDevice.page.waitForTimeout(20_000);
    if (await newDevice.page.getByText('Empty a savings jar: "Holiday"').first().isVisible().catch(() => false)) break;
    if (attempt > 20) throw new Error('the jar could not be emptied');
    await newDevice.page.waitForTimeout(40_000);
  }
  await newDevice.shot('jar-emptied');
  say('New device: emptied the jar into the wallet');
  }

  if (returnTo !== undefined) {
    await newDevice.open(config.walletUrl);
    await see(newDevice.page, 'You can send up to', 2 * MINUTE);
    const hint = await newDevice.page.getByText('You can send up to').first().innerText();
    const most = (/up to ([\d,]+) sat/.exec(hint)?.[1] ?? '0').replaceAll(',', '');
    if (BigInt(most) >= 546n) {
      await newDevice.page.getByPlaceholder('bchtest:…').fill(returnTo);
      await newDevice.page.getByPlaceholder('0').first().fill(most);
      await click(newDevice.page, 'Send');
      await expectText(newDevice.page, 'Sent.', 3 * MINUTE, 'returning the coins');
      say(`New device: returned ${most} sat to ${returnTo}`);
    }
  }
  say('Done.');
} catch (error) {
  say(`FAILED: ${error.message}`);
  for (const each of [owner, recoverer, jar]) await each.shot('failure').catch(() => undefined);
  console.error(error.stack);
  process.exitCode = 1;
} finally {
  await Promise.all(contexts.map((context) => context.close().catch(() => undefined)));
  say(`Browser storage of each device is kept in ${profiles}`);
}
