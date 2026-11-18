// What the scripted courses in a browser share (scripts/browser-run.ts and scripts/browser-run-jar.ts): the log
// kept line by line, the chain and the servers of the local node, the devices (one browser profile each, kept on
// disk), the ways of waiting for a page, the screenshots, and the first steps that every course begins with:
// a recoverer gives its link, the owner makes a wallet with it, the recoverer keeps the kit, the owner receives.
//
// The first argument of a course is `local` (the default) or `chipnet`; `--screens` takes screenshots and
// `--headed` shows the browser.
import { type ChildProcess, execFileSync, spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { hexToBin, lockingBytecodeToCashAddress } from '@bitauth/libauth';
import { type BrowserContext, type Page, chromium } from 'playwright';

export const root = fileURLToPath(new URL('..', import.meta.url));
export const chipnet = process.argv[2] === 'chipnet';
export const argument = (name: string): string | undefined => {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : (process.argv[index + 1] ?? '');
};
export const takeScreens = process.argv.includes('--screens');
export const headed = process.argv.includes('--headed');
export const config = JSON.parse(readFileSync(`${root}deploy/config/${chipnet ? 'production' : 'local-regtest'}.json`, 'utf8')) as { walletUrl: string; recovererUrl: string; jarUrl: string; network: string };
export const WALLET = config.walletUrl;
export const RECOVERER = config.recovererUrl;
export const JAR = config.jarUrl;
/** On chipnet a block takes about a minute and may take several: every wait is given ten times as long. */
export const patience = chipnet ? 10 : 1;
export const PHONE = { width: 390, height: 844 };
export const DESKTOP = { width: 1280, height: 800 };
const screens = `${root}docs/screens/`;

export const wait = (milliseconds: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, milliseconds));

export interface Device {
  name: string;
  context: BrowserContext;
  page: Page;
}

type App = 'wallet' | 'recoverer' | 'jar';
const PORTS: Record<App, number> = { wallet: 8101, recoverer: 8102, jar: 8103 };

/**
 * A course: its log, its devices and its servers.
 * @param directory - under `.chipnet/`, for the profiles, the stores' data and the log (with `-chipnet` added on chipnet)
 * @param continuing - the log goes on from the lines a stopped run left
 * @param until - the last step to carry out
 */
export const course = (options: { directory: string; continuing: boolean; until: number }) => {
  const work = `${root}.chipnet/${options.directory}${chipnet ? '-chipnet' : ''}/`;
  const started = Date.now();

  // ------------------------------------------------------------------ the log

  // The log is kept on disk line by line, so that a run that stops leaves what it did, and one that continues goes on from it.
  mkdirSync(work, { recursive: true });
  const journal = `${work}log.txt`;
  const lines: string[] = options.continuing && existsSync(journal) ? readFileSync(journal, 'utf8').split('\n').filter((line) => line !== '') : [];
  if (!options.continuing) writeFileSync(journal, '');
  const elapsed = (): string => `${((Date.now() - started) / 1000).toFixed(0).padStart(4)} s`;
  const note = (entry: string): void => {
    lines.push(entry);
    appendFileSync(journal, `${entry}\n`);
    console.log(entry);
  };
  const log = (line: string): void => note(`${elapsed()}  ${line}`);

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
  let outside: string | undefined;
  const elsewhere = (): string => {
    if (outside !== undefined) return outside;
    if (chipnet) outside = run('npx', ['tsx', 'scripts/chipnet-pay.ts', 'address']);
    else {
      const made = lockingBytecodeToCashAddress({ prefix: 'bchtest', bytecode: hexToBin(`76a914${'11'.repeat(20)}88ac`) });
      outside = typeof made === 'string' ? made : made.address;
    }
    return outside;
  };

  const children: ChildProcess[] = [];
  const answers = async (url: string): Promise<boolean> => fetch(url).then(() => true, () => false);
  const serve = async (url: string, command: string, args: string[], name: string): Promise<void> => {
    if (await answers(url)) return;
    const child = spawn(command, args, { cwd: root, stdio: ['ignore', 'ignore', 'inherit'] });
    children.push(child);
    for (let attempt = 0; attempt < 60 && !(await answers(url)); attempt++) await wait(250);
    if (!(await answers(url))) throw new Error(`${name} did not start`);
  };

  /** What a run needs before its first step: the public pages' version on chipnet, or the pages and stores of this checkout on the local node. */
  const prepare = async (apps: App[]): Promise<void> => {
    if (chipnet) {
      for (const app of apps) {
        const url = app === 'wallet' ? WALLET : app === 'recoverer' ? RECOVERER : JAR;
        const version = (await (await fetch(`${url}version.json`)).json()) as { commit?: string; branch?: string; network?: string; releasedAt?: string };
        if (version.network !== 'chipnet') throw new Error(`${url} does not serve chipnet`);
        log(`${app} page: ${url}, commit ${version.commit} of ${version.branch}, released ${version.releasedAt}`);
      }
      log(`funding address: ${run('npx', ['tsx', 'scripts/chipnet-pay.ts', 'balance'])}`);
      return;
    }
    log(`local node: ${run(`${root}deploy/regtest/regtest.sh`, ['status']).split('\n')[0]}`);
    for (const app of apps) if (!existsSync(`${root}apps/${app}/dist/index.html`)) throw new Error(`apps/${app} is not built`);
    mkdirSync(`${work}store1`, { recursive: true });
    mkdirSync(`${work}store2`, { recursive: true });
    const origins = ['--origin', 'http://localhost:8101', '--origin', 'http://localhost:8102'];
    await serve('http://127.0.0.1:8111/', process.execPath, ['--import', 'tsx', 'apps/archive-store/src/cli.ts', '--port', '8111', '--directory', `${work}store1`, ...origins], 'store 1');
    await serve('http://127.0.0.1:8112/', process.execPath, ['--import', 'tsx', 'apps/archive-store/src/cli.ts', '--port', '8112', '--directory', `${work}store2`, ...origins], 'store 2');
    // Each is started as a process of its own, not through a wrapper, so that it ends when the run does.
    for (const app of apps) {
      const port = PORTS[app];
      await serve(`http://127.0.0.1:${port}/`, process.execPath, ['deploy/serve.mjs', '--root', `apps/${app}/dist`, '--config', 'deploy/config/local-regtest.json', '--host', '127.0.0.1', '--port', String(port)], `the ${app} page`);
    }
  };

  // ------------------------------------------------------------------ devices

  const devices: Device[] = [];
  const device = async (name: string, fresh = true): Promise<Device> => {
    const directory = `${work}profiles/${name}`;
    if (fresh) rmSync(directory, { recursive: true, force: true });
    const context = await chromium.launchPersistentContext(directory, { headless: !headed, viewport: PHONE, deviceScaleFactor: 1 });
    const page = context.pages()[0] ?? (await context.newPage());
    watchPage(name, page);
    const made = { name, context, page };
    devices.push(made);
    return made;
  };
  /** Its errors go into the log. */
  const watchPage = (name: string, page: Page): void => {
    page.on('pageerror', (error) => log(`  [${name}] page error: ${error.message.slice(0, 200)}`));
    page.on('console', (message) => {
      if (message.type() === 'error' && !/favicon|Failed to load resource/.test(message.text())) log(`  [${name}] console: ${message.text().slice(0, 200)}`);
    });
  };
  const close = async (gone: Device): Promise<void> => {
    await gone.context.close();
    devices.splice(devices.indexOf(gone), 1);
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

  // ------------------------------------------------------------------ steps

  const state = { step: 0 };
  const begin = (title: string): boolean => {
    state.step += 1;
    if (state.step > options.until) return false;
    log(`${state.step}. ${title}`);
    return true;
  };

  /** After the last step, or a failure: a picture of every device that is still open, then everything is closed. */
  const failed = async (error: unknown): Promise<void> => {
    log(`FAILED at step ${state.step}: ${(error as Error).message.split('\n')[0]}`);
    for (const gone of devices) {
      for (const [index, page] of gone.context.pages().entries()) await page.screenshot({ path: `${work}failure-${gone.name}${index === 0 ? '' : `-${index + 1}`}.png`, fullPage: true }).catch(() => undefined);
    }
  };
  const end = async (): Promise<void> => {
    for (const gone of [...devices]) await gone.context.close().catch(() => undefined);
    for (const child of children) child.kill();
  };

  return { work, started, lines, note, log, run, pay, mine, passTime, elsewhere, prepare, device, watchPage, close, devices, shot, state, begin, failed, end };
};

export type Course = ReturnType<typeof course>;

// ------------------------------------------------------------------ waiting for a page

/** Wait for text on the page, patiently: an engine opens, blocks come, receipts are polled. */
export const see = async (page: Page, text: string | RegExp, timeout = 180_000): Promise<void> => {
  await page.getByText(text).first().waitFor({ state: 'visible', timeout: timeout * patience });
};
export const valueOf = async (page: Page, testId: string, timeout = 180_000): Promise<string> => {
  const element = page.getByTestId(testId).first();
  await element.waitFor({ state: 'visible', timeout: timeout * patience });
  return (await element.getAttribute('data-value')) ?? '';
};
export const click = async (page: Page, name: string | RegExp, timeout = 180_000): Promise<void> => {
  const button = page.getByRole('button', { name }).first();
  await button.waitFor({ state: 'visible', timeout: timeout * patience });
  for (let attempt = 0; attempt < (timeout * patience) / 500 && !(await button.isEnabled()); attempt++) await wait(500);
  // To the middle of the screen: a button scrolled just into view may sit under the bar at the bottom of a phone's screen.
  await button.evaluate((element) => element.scrollIntoView({ block: 'center' }));
  await button.click();
};
export const tick = async (page: Page, name: string | RegExp): Promise<void> => {
  await page.getByLabel(name).first().check();
};

/** The recoverer's screen of its wallet. The page opens on the wallet it last had open, or on the list of its wallets. */
export const openDesk = async (page: Page): Promise<void> => {
  await page.goto(RECOVERER);
  const list = page.getByTestId('open-wallet').first();
  const desk = page.getByText('Where the wallet stands').first();
  await list.or(desk).first().waitFor({ state: 'visible', timeout: 60_000 * patience });
  if (!(await desk.isVisible())) await list.click();
  await desk.waitFor({ state: 'visible', timeout: 60_000 * patience });
};

/** The wallet's balance as its home screen shows it, in satoshis. */
export const balanceOf = async (page: Page): Promise<bigint> => {
  const text = (await page.getByTestId('balance').first().textContent()) ?? '';
  const [whole = '0', fraction = ''] = text.replace(/[^0-9.]/g, '').split('.');
  return BigInt(whole) * 100_000_000n + BigInt(fraction.padEnd(8, '0').slice(0, 8) || '0');
};

// ------------------------------------------------------------------ the first steps of every course

/**
 * Steps 1 to 4: the recoverer opens its page and gives its link; the owner creates a wallet with that recoverer;
 * the recoverer takes in the kit and recovery is on; the owner receives.
 * @param shoot - takes the screenshots of these screens, under their names in docs/screens
 * @returns the devices and the recoverer's link, or nothing when the run was asked to stop earlier
 */
export const firstSteps = async (
  { begin, device, log, pay }: Course,
  shoot: (page: Page, name: string) => Promise<void>,
): Promise<{ recoverer: Device; old: Device; recovererLink: string } | undefined> => {
  // 1 ------------------------------------------------------------------
  if (!begin('The recoverer opens its page and gives its link')) return;
  const recoverer = await device('recoverer');
  await recoverer.page.goto(`${RECOVERER}link`);
  await recoverer.page.getByLabel('Your name, as their wallet shows it').fill('Anna');
  await wait(300);
  const recovererLink = await valueOf(recoverer.page, 'recoverer-link');
  const recovererFingerprint = (await recoverer.page.locator('.fingerprint').first().textContent()) ?? '';
  log(`   link of ${recovererLink.length} characters; fingerprint ${recovererFingerprint}`);
  await shoot(recoverer.page, 'recoverer-link');
  await recoverer.page.goto(RECOVERER);
  await see(recoverer.page, 'No wallets yet.');
  await shoot(recoverer.page, 'recoverer-empty');

  // 2 ------------------------------------------------------------------
  if (!begin('The owner creates a wallet with Anna as recoverer')) return;
  const old = await device('old-phone');
  await old.page.goto(WALLET);
  await see(old.page, 'Make a new wallet');
  await shoot(old.page, 'wallet-welcome');
  await old.page.goto(recovererLink);
  await see(old.page, 'You opened the link of');
  await click(old.page, /Make a new wallet/);
  await see(old.page, 'Fingerprint of their key');
  const seenFingerprint = (await old.page.locator('.fingerprint').first().textContent()) ?? '';
  if (seenFingerprint !== recovererFingerprint) throw new Error(`the fingerprints differ: ${seenFingerprint} and ${recovererFingerprint}`);
  log(`   the wallet shows the same fingerprint, ${seenFingerprint}`);
  await tick(old.page, 'The fingerprints are the same');
  await shoot(old.page, 'wallet-create-setup');
  await click(old.page, 'Continue');
  const funding = await valueOf(old.page, 'funding-address');
  log(`   funding address ${funding}`);
  await shoot(old.page, 'wallet-create-funding');
  log(`   ${pay(funding, 120_000)}`);
  await click(old.page, 'Create the wallet');
  // The wallet goes on as soon as the network has its creation: no block is waited for.
  const kitLink = await valueOf(old.page, 'kit-link');
  log(`   created; the kit link has ${kitLink.length} characters`);
  await see(old.page, /Recovery is not on yet|Checking the wallet's protection/);
  await shoot(old.page, 'wallet-home-kit-sent');

  // 3 ------------------------------------------------------------------
  if (!begin('Anna takes in the kit; the wallet says that recovery is on')) return;
  await recoverer.page.goto(kitLink);
  await see(recoverer.page, 'A recovery kit has arrived');
  await recoverer.page.getByLabel('Whose wallet is this?').fill('Grandma');
  await shoot(recoverer.page, 'recoverer-kit-arrived');
  await click(recoverer.page, 'Check and keep the kit');
  await see(recoverer.page, 'You look after Grandma now');
  log('   the recoverer kept the kit and left its receipt');
  await shoot(recoverer.page, 'recoverer-kit-kept');
  await see(old.page, 'Protected', 120_000);
  log('   the wallet shows "Protected"');

  // 4 ------------------------------------------------------------------
  if (!begin('The owner receives')) return;
  await old.page.getByRole('link', { name: 'Receive' }).first().click();
  const receiving = await valueOf(old.page, 'receive-address');
  log(`   address ${receiving}`);
  log(`   ${pay(receiving, 50_000)}`);
  await shoot(old.page, 'wallet-receive');
  await old.page.getByRole('button', { name: 'For regular payments' }).click();
  const vaultAddress = await valueOf(old.page, 'receive-address');
  log(`   vault address ${vaultAddress}`);
  await shoot(old.page, 'wallet-receive-vault');
  await old.page.getByRole('link', { name: 'Home' }).first().click();
  await see(old.page, /^0\.00\d+/);
  for (let attempt = 0; attempt < 30; attempt++) {
    const balance = (await old.page.getByTestId('balance').textContent()) ?? '';
    if (Number(balance.replace(/[^0-9.]/g, '')) > 0.0011) break;
    await wait(1_000);
  }
  log(`   the wallet holds ${(await old.page.getByTestId('balance').textContent())?.replace('BCH', ' BCH')}`);
  await shoot(old.page, 'wallet-home');
  return { recoverer, old, recovererLink };
};

// ------------------------------------------------------------------ a takeover

/**
 * A new phone asks to take the wallet over with the recoverer's link; the recoverer checks it and asks the network.
 * @param made - the new phone, if it is already opened; otherwise a new profile is made
 */
export const newPhoneAsks = async ({ device, log }: Course, recoverer: Device, recovererLink: string, shoot: (page: Page, name: string) => Promise<void>, made?: Device): Promise<Device> => {
  const next = made ?? (await device('new-phone'));
  await next.page.goto(recovererLink);
  await click(next.page, /Take over my wallet on this phone/);
  await tick(next.page, 'The fingerprints are the same');
  await click(next.page, 'Make my request');
  const takeoverLink = await valueOf(next.page, 'takeover-link');
  const nextFingerprint = (await next.page.locator('.fingerprint').first().textContent()) ?? '';
  await shoot(next.page, 'wallet-takeover-request');
  await recoverer.page.goto(takeoverLink);
  await click(recoverer.page, 'See the request');
  const shown = (await recoverer.page.locator('.fingerprint').first().textContent()) ?? '';
  if (shown !== nextFingerprint) throw new Error(`the recoverer sees ${shown}, the new phone ${nextFingerprint}`);
  log(`   both sides show ${shown}`);
  await tick(recoverer.page, 'I have made sure who is asking');
  await click(recoverer.page, 'Save it for this wallet');
  await click(recoverer.page, /Ask the network/);
  return next;
};

/**
 * The request the recoverer sent goes into a block, the waiting period passes, the recoverer completes the
 * move and hands the wallet over, and the new phone sweeps the coins to its own seed.
 */
export const completeTakeover = async ({ log, mine, passTime }: Course, recoverer: Device, next: Device, shoot: (page: Page, name: string) => Promise<void>): Promise<void> => {
  await see(recoverer.page, 'The request is sent');
  mine(1);
  await see(recoverer.page, 'Your request is waiting');
  log('   the request is in a block; the waiting period runs');
  log(`   ${passTime(700)}`);
  // On chipnet the chain's clock has to pass 512 seconds: the button is enabled when it has.
  await click(recoverer.page, 'Complete the move', chipnet ? 360_000 : 120_000);
  await see(recoverer.page, 'The wallet is moved');
  // The hand-over is made as soon as the network shows the completion: no block is waited for.
  const handOver = await valueOf(recoverer.page, 'handover-link', 120_000);
  log('   completed; the hand-over link is ready');
  await shoot(recoverer.page, 'recoverer-handover');
  await next.page.goto(handOver);
  await see(next.page, 'Bringing your coins over');
  await shoot(next.page, 'wallet-arrival');
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
  await shoot(next.page, 'wallet-home-after-takeover');
};
