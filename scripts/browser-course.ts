// What the scripted courses in a browser share (scripts/browser-run.ts, scripts/stage-17-jar-browser.ts and
// scripts/stage-17-loan-browser.ts; scripts/browser-run-jar.ts at the tag `design-2`): the log
// kept line by line, the chain and the servers of the local node, the devices (one browser profile each, kept on
// disk), the ways of waiting for a page, the screenshots, and the first steps that every course begins with:
// a recoverer gives its link, the owner makes a wallet with it, the recoverer keeps the kit, the owner receives.
//
// The first argument of a course is `local` (the default) or `chipnet`; `--screens` takes screenshots and
// `--headed` shows the browser. On chipnet, `--local-pages` serves the pages of this checkout on this machine
// (deploy/config/local.json) instead of using the public ones. `--directory <name>` keeps the profiles, the
// stores' data and the log under `.local-runs/<name>/` on the local node, or `.chipnet/<name>-chipnet/` on
// chipnet, instead of the course's own directory, and `--record <file name>` writes the record to that file in
// docs/runs/ instead of the course's own, so that a run does not touch an earlier run's profiles or record.
//
// On the local node the pages and the two backup stores of a run are served on ports of their own, on
// 127.0.0.1 only: from `--ports <base>` (8300 when not given) the wallet at base + 1, the recoverer at + 2, the
// Savings Jar at + 3, the loan page at + 4, and the stores at + 11 and + 12. Nothing else on this machine is
// used or touched.
//
// The wallet is made with its recoverer as a person would first do it (proposal section 14.4): the owner's phone
// reads the code on the recoverer's "Your link" screen, which carries the link and a session, and the wallet
// sends the kit straight to the recoverer's page, which stays open on that screen. `--links` makes it with the
// pasted links instead (the recoverer's link opened on the phone, the kit link opened on the recoverer's page),
// and a recoverer's page whose code offers no session (an older public page, or one that reaches no relay)
// is given the links in the same way. On the local node the pages' sessions go through a relay on this machine
// (packages/connect/test/memory-relay.ts) that the run starts, and that the pages' configuration names.
import { type ChildProcess, execFileSync, spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { hexToBin, lockingBytecodeToCashAddress } from '@bitauth/libauth';
import { controllerScript } from '@grandmas-wallet/core';
import { type BrowserContext, type Page, chromium } from 'playwright';

import { Electrum } from '../packages/chipnet/src/electrum.js';
import { type MemoryRelay, startMemoryRelay } from '../packages/connect/test/memory-relay.js';

export const root = fileURLToPath(new URL('..', import.meta.url));
export const chipnet = process.argv[2] === 'chipnet';
export const argument = (name: string): string | undefined => {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : (process.argv[index + 1] ?? '');
};
export const takeScreens = process.argv.includes('--screens');
export const headed = process.argv.includes('--headed');
/** The wallet is made with the pasted links, not over the session the recoverer's code offers. */
export const viaLinks = process.argv.includes('--links');
/** On chipnet: the pages of this checkout, served on this machine, instead of the public ones. */
export const localPages = !chipnet || process.argv.includes('--local-pages');
const configName = chipnet ? (localPages ? 'local' : 'production') : 'local-regtest';
type App = 'wallet' | 'recoverer' | 'jar' | 'loan';
/** The ports of a run's pages and stores on the local node; on chipnet with the pages of this checkout, those of deploy/config/local.json. */
const portBase = chipnet ? 8100 : Number(argument('ports') ?? '8300');
if (!Number.isInteger(portBase) || portBase < 1024 || portBase > 65_000) throw new Error(`--ports takes a port number to count from, such as 8300, not ${argument('ports')}`);
const PORTS: Record<App, number> = { wallet: portBase + 1, recoverer: portBase + 2, jar: portBase + 3, loan: portBase + 4 };
const STORE_PORTS = [portBase + 11, portBase + 12] as const;
const fromFile = JSON.parse(readFileSync(`${root}deploy/config/${configName}.json`, 'utf8')) as { walletUrl: string; recovererUrl: string; jarUrl: string; loanUrl?: string; stores: string[]; network: string; relays?: string[]; chain: string[] };
export const config = chipnet
  ? fromFile
  : {
      ...fromFile,
      walletUrl: `http://localhost:${PORTS.wallet}/`,
      recovererUrl: `http://localhost:${PORTS.recoverer}/`,
      jarUrl: `http://localhost:${PORTS.jar}/`,
      loanUrl: `http://localhost:${PORTS.loan}/`,
      stores: STORE_PORTS.map((port) => `http://localhost:${port}`),
    };
/**
 * The file in docs/runs/ the record is written to: the course's own, or the one `--record` names. A name that
 * is not a plain file name ending in `.md` is refused, so that a record never lands outside docs/runs/.
 */
export const recordFile = (own: string): string => {
  const named = argument('record') ?? own;
  if (!/^[a-z0-9][a-z0-9.-]*\.md$/.test(named)) throw new Error(`--record takes a file name in docs/runs/, such as no-waits-browser-chipnet.md, not ${named}`);
  return `${root}docs/runs/${named}`;
};
export const WALLET = config.walletUrl;
export const RECOVERER = config.recovererUrl;
export const JAR = config.jarUrl;
export const LOAN = config.loanUrl ?? `http://localhost:${PORTS.loan}/`;
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

/** Servers a page alone may talk to, besides those of the configuration. */
const EXTRA: Partial<Record<App, string[]>> = { loan: ['--connect', 'https://oracles.generalprotocols.com'] };

/**
 * A course: its log, its devices and its servers.
 * @param directory - under `.local-runs/` on the local node, or `.chipnet/` with `-chipnet` added on chipnet: the profiles, the stores' data and the log
 * @param continuing - the log goes on from the lines a stopped run left
 * @param until - the last step to carry out
 */
export const course = (options: { directory: string; continuing: boolean; until: number }) => {
  const directory = argument('directory') ?? options.directory;
  if (!/^[a-z0-9][a-z0-9-]*$/.test(directory)) throw new Error(`--directory takes a plain name, made a directory of the run's own, not ${directory}`);
  const work = chipnet ? `${root}.chipnet/${directory}-chipnet/` : `${root}.local-runs/${directory}/`;
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

  // ------------------------------------------------------------------ what waited for a block

  /** Moments of the run by name, for the time between them. */
  const marks = new Map<string, number>();
  const mark = (name: string): void => void marks.set(name, Date.now());
  const since = (name: string): string => {
    const at = marks.get(name);
    return at === undefined ? '(not measured)' : `${((Date.now() - at) / 1000).toFixed(0)} s`;
  };
  /** What the run measured about waits for a block, for the head of the record; kept on disk for a run that continues. */
  const blocksFile = `${work}blocks.json`;
  const blockFacts: string[] = options.continuing && existsSync(blocksFile) ? (JSON.parse(readFileSync(blocksFile, 'utf8')) as string[]) : [];
  const blockFact = (line: string): void => {
    blockFacts.push(line);
    writeFileSync(blocksFile, JSON.stringify(blockFacts, null, 1));
    log(`   ${line}`);
  };

  /**
   * Where a wallet's transactions stand on the chain, as the first server of the configuration has them: the
   * height of its last block, and which of the controller's transactions, the transactions that made the wallet
   * and those the phone sent are not in a block yet. What the page keeps is read from its local storage.
   */
  /** Transactions the run named when they were sent (the completion of a takeover, a move's change), and the wallet's identity last read. */
  const labels = new Map<string, string>();
  let identitySeen: string | undefined;
  /** Every transaction a reading of the chain has named already, so that a newer one is told from it. */
  const seenBefore = new Set<string>();
  /**
   * Name the controller's newest transaction, as the server lists it right after a page sent it: the server lists
   * those not in a block last, in the order it took them.
   */
  const nameNewest = async (label: string): Promise<void> => {
    if (identitySeen === undefined) return;
    const electrum = await Electrum.connect(config.chain[0] ?? '');
    try {
      // The page may have sent it through the other server: it is looked for a few times.
      for (let attempt = 0; attempt < 15; attempt++) {
        const history = await electrum.getHistory(controllerScript(hexToBin(identitySeen)).lockingBytecode);
        const newest = history[history.length - 1];
        if (newest !== undefined && newest.height <= 0 && !labels.has(newest.transactionId) && !seenBefore.has(newest.transactionId)) {
          labels.set(newest.transactionId, label);
          return;
        }
        await wait(1_000);
      }
    } catch {
      // Not named: it is listed as a transaction of the controller.
    } finally {
      await electrum.disconnect();
    }
  };
  const standing = async (page: Page): Promise<{ height: number; open: string[]; settled: number; text: string }> => {
    const stored = await page.evaluate(() => ({ state: localStorage.getItem('gw2-wallet:state'), activity: localStorage.getItem('gw2-wallet:activity') }));
    const state = stored.state === null ? undefined : (JSON.parse(stored.state) as { identity?: string; creation?: { prepareTransactionId?: string; createTransactionId?: string; byRecoverer?: boolean } });
    const activity = stored.activity === null ? [] : (JSON.parse(stored.activity) as { what: string; transactionId: string }[]);
    const named = new Map<string, string>();
    if (state?.identity !== undefined) named.set(state.identity, state.creation?.byRecoverer === true ? 'the recoverer\'s payment that defines the identity' : 'the payment that defines the identity');
    if (state?.creation?.prepareTransactionId !== undefined) named.set(state.creation.prepareTransactionId, 'the wallet\'s payment to itself');
    if (state?.creation?.createTransactionId !== undefined) named.set(state.creation.createTransactionId, 'the creation');
    for (const entry of activity) if (!named.has(entry.transactionId)) named.set(entry.transactionId, `"${entry.what}"`);
    if (state?.identity !== undefined) identitySeen = state.identity;
    const electrum = await Electrum.connect(config.chain[0] ?? '');
    try {
      const { height } = await electrum.tip();
      const heights = new Map<string, number>();
      const unknown = new Set<string>();
      if (state?.identity !== undefined) {
        // The server lists a script's history in the chain's order, those not in a block last.
        const history = await electrum.getHistory(controllerScript(hexToBin(state.identity)).lockingBytecode);
        for (const [index, entry] of history.entries()) {
          heights.set(entry.transactionId, entry.height);
          if (!named.has(entry.transactionId)) named.set(entry.transactionId, labels.get(entry.transactionId) ?? (index === history.length - 1 ? 'the controller\'s last transaction' : 'a transaction of the controller'));
        }
      }
      for (const transactionId of named.keys()) {
        if (heights.has(transactionId)) continue;
        const confirmations = await electrum.confirmations(transactionId);
        if (confirmations === undefined) unknown.add(transactionId);
        else heights.set(transactionId, confirmations > 0 ? height - confirmations + 1 : 0);
      }
      // A height of 0 or less is a transaction not in a block (-1: one that spends another not in a block either).
      for (const transactionId of named.keys()) seenBefore.add(transactionId);
      const open = [...named].filter(([transactionId]) => unknown.has(transactionId) || (heights.get(transactionId) ?? 0) <= 0).map(([transactionId, label]) => `${label} ${transactionId.slice(0, 12)}…${unknown.has(transactionId) ? ' (unknown to the server)' : ''}`);
      const settled = named.size - open.length;
      const text = `the chain is at height ${height}; not in a block yet: ${open.length === 0 ? 'none' : open.join(', ')}; in a block: ${settled} of the ${named.size} transactions looked at`;
      return { height, open, settled, text };
    } finally {
      await electrum.disconnect();
    }
  };
  /** The height of the chain's last block, as the first server of the configuration has it. */
  const height = async (): Promise<string> => {
    try {
      const electrum = await Electrum.connect(config.chain[0] ?? '');
      try {
        return String((await electrum.tip()).height);
      } finally {
        await electrum.disconnect();
      }
    } catch {
      return '(not read)';
    }
  };
  /** Whether the wallet page has noted a sweep of coins from earlier addresses among what it sent: it does as soon as it sends one. */
  const sweepSent = (page: Page): Promise<boolean> => page.evaluate(() => /from earlier addresses/.test(localStorage.getItem('gw2-wallet:activity') ?? '')).catch(() => false);
  /** The same, said in the log and in the head of the record, with what was just done. */
  const standingNow = async (page: Page, what: string): Promise<{ height: number; open: string[] }> => {
    const seen = await standing(page).catch((error: unknown) => ({ height: 0, open: [], settled: 0, text: `the chain could not be read: ${(error as Error).message.slice(0, 120)}` }));
    blockFact(`${what}; ${seen.text}.`);
    return seen;
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

  /** The relay on this machine that the pages' sessions go through, on the local node. */
  let relay: MemoryRelay | undefined;
  /** What a run needs before its first step: the public pages' version on chipnet, or the pages and stores of this checkout on this machine. */
  /**
   * @param apps - the pages the course uses
   * @param served - on the local node, more of the configuration the pages are served with (the loan page's deployment of Paryon's contracts)
   */
  const prepare = async (apps: App[], served: Record<string, unknown> = {}): Promise<void> => {
    if (chipnet && !localPages) {
      for (const app of apps) {
        const url = app === 'wallet' ? WALLET : app === 'recoverer' ? RECOVERER : app === 'jar' ? JAR : LOAN;
        const version = (await (await fetch(`${url}version.json`)).json()) as { commit?: string; branch?: string; network?: string; releasedAt?: string };
        if (version.network !== 'chipnet') throw new Error(`${url} does not serve chipnet`);
        log(`${app} page: ${url}, commit ${version.commit} of ${version.branch}, released ${version.releasedAt}`);
      }
      log(`funding address: ${run('npx', ['tsx', 'scripts/chipnet-pay.ts', 'balance'])}`);
      return;
    }
    if (chipnet) log(`funding address: ${run('npx', ['tsx', 'scripts/chipnet-pay.ts', 'balance'])}`);
    else log(`local node: ${run(`${root}deploy/regtest/regtest.sh`, ['status']).split('\n')[0]}`);
    for (const app of apps) if (!existsSync(`${root}apps/${app}/dist/index.html`)) throw new Error(`apps/${app} is not built`);
    // On the local node the sessions between the pages go through a relay on this machine, named in a copy of
    // the configuration that the run's pages are served with: nothing goes to a public relay.
    let configFile = `deploy/config/${configName}.json`;
    if (!chipnet) {
      relay = await startMemoryRelay();
      configFile = `${work}config.json`;
      writeFileSync(configFile, JSON.stringify({ ...config, ...served, relays: [relay.url] }, null, 2));
      log(`relay: ${relay.url}, on this machine, for the sessions between the pages`);
    }
    mkdirSync(`${work}store1`, { recursive: true });
    mkdirSync(`${work}store2`, { recursive: true });
    const origins = ['--origin', new URL(WALLET).origin, '--origin', new URL(RECOVERER).origin];
    for (const [index, port] of STORE_PORTS.entries()) {
      await serve(`http://127.0.0.1:${port}/`, process.execPath, ['--import', 'tsx', 'apps/archive-store/src/cli.ts', '--port', String(port), '--host', '127.0.0.1', '--directory', `${work}store${index + 1}`, ...origins], `store ${index + 1}`);
    }
    // Each is started as a process of its own, not through a wrapper, so that it ends when the run does.
    for (const app of apps) {
      const port = PORTS[app];
      await serve(`http://127.0.0.1:${port}/`, process.execPath, ['deploy/serve.mjs', '--root', `apps/${app}/dist`, '--config', configFile, '--host', '127.0.0.1', '--port', String(port), ...(EXTRA[app] ?? [])], `the ${app} page`);
      const version = (await (await fetch(`http://127.0.0.1:${port}/version.json`)).json()) as { commit?: string; network?: string };
      if (version.network !== config.network) throw new Error(`the ${app} page on port ${port} serves ${version.network}, not ${config.network}: something else answers there`);
      log(`${app} page: http://localhost:${port}/, this checkout at ${version.commit}, ${version.network}`);
      // Pages that something else serves may name other relays: said, so that the record shows where sessions went.
      const relays = ((await (await fetch(`http://127.0.0.1:${port}/config.json`)).json()) as { relays?: string[] }).relays ?? [];
      if (relay !== undefined && !(relays.length === 1 && relays[0] === relay.url)) log(`   the ${app} page was already served on port ${port}, with the relays ${relays.join(', ')}`);
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
      const text = message.text();
      if (message.type() !== 'error' || /favicon|Failed to load resource/.test(text)) return;
      // The engine's failed header checks: the device is marked, and each message is logged once.
      if (/Server reported merkle root \S+ for checkpoint|Could not validate a block header/.test(text)) {
        stuck.add(name);
        const kind = `${name}|${text.replace(/[0-9a-f]{16,}|\d+/g, '…').slice(0, 160)}`;
        if (logged.has(kind)) return;
        logged.add(kind);
        log(`  [${name}] console: ${text.slice(0, 200)} (logged once; the same message again is not)`);
        return;
      }
      log(`  [${name}] console: ${text.slice(0, 200)}`);
    });
  };
  /** Devices whose page's engine failed a header check, and the messages logged once. */
  const stuck = new Set<string>();
  const logged = new Set<string>();
  /**
   * After a reorganization of the chain, a page's engine may keep a checkpoint of a block that is no longer in
   * the chain and fail every header check from then on (docs/xo-feedback-notes.md, 18 November): the page then
   * stays at "Opening this wallet". The engine's header store is a cache of what the servers give; it
   * is deleted (the IndexedDB databases named Electrum_…, on the page's origin) and the page is opened again.
   * What the page keeps itself, its keys and kits, is not touched. Nothing is done for a device whose engine
   * did not fail.
   */
  const freshEngine = async (owner: Device, url: string, sayStuck = false): Promise<void> => {
    if (!stuck.has(owner.name) && !sayStuck) return;
    // A page of the same origin that runs no engine, so that the database is not in use while it is deleted.
    await owner.page.goto(`${new URL(url).origin}/version.json`);
    const deleted = await owner.page.evaluate(async () => {
      const names = (await indexedDB.databases()).map((entry) => entry.name ?? '').filter((name) => name.startsWith('Electrum'));
      for (const name of names) {
        await new Promise<void>((resolve, reject) => {
          const request = indexedDB.deleteDatabase(name);
          request.onsuccess = () => resolve();
          request.onerror = () => reject(new Error(`could not delete ${name}`));
          request.onblocked = () => reject(new Error(`${name} is still in use`));
        });
      }
      return names;
    });
    stuck.delete(owner.name);
    log(`   the ${owner.name}'s page had ${sayStuck ? 'said that its engine\'s header check stood behind the chain' : 'failed its engine\'s header checks'}, as after a reorganization of the chain; its engine's header store (${deleted.join(', ') || 'none found'}) was deleted and the page opened again`);
    await owner.page.goto(url);
  };
  /**
   * What the device's pages keep in local storage (the wallet's words among it), copied to a file beside the
   * profile, by origin: so that coins can still be reached by script if a profile cannot be opened again.
   */
  const keepStorage = async (owner: Device): Promise<void> => {
    const file = `${work}storage-${owner.name}.json`;
    const all = existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as Record<string, Record<string, string>>) : {};
    for (const page of owner.context.pages()) {
      const origin = (() => {
        try {
          return new URL(page.url()).origin;
        } catch {
          return 'null';
        }
      })();
      if (origin === 'null') continue;
      const items = await page.evaluate(() => Object.fromEntries(Object.entries(localStorage))).catch(() => undefined);
      if (items !== undefined) all[origin] = items;
    }
    writeFileSync(file, JSON.stringify(all, null, 1), { mode: 0o600 });
  };
  const close = async (gone: Device): Promise<void> => {
    await keepStorage(gone).catch(() => undefined);
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
        // The decision bar of a request, which sticks to the foot of the screen, at the foot of its card; the rail of a
        // desktop, a screen high, as high as the page.
        document.querySelectorAll<HTMLElement>('.request-card .decide').forEach((element) => element.style.setProperty('position', 'static'));
        document.querySelectorAll<HTMLElement>('.rail').forEach((element) => element.style.setProperty('height', 'auto'));
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
      await page.evaluate(() => document.querySelectorAll<HTMLElement>('.toast, .topbar, .request-card .decide, .rail').forEach((element) => ['display', 'position', 'height'].forEach((property) => element.style.removeProperty(property))));
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
      for (const [index, page] of gone.context.pages().entries()) {
        const name = `failure-${gone.name}${index === 0 ? '' : `-${index + 1}`}`;
        await page.screenshot({ path: `${work}${name}.png`, fullPage: true }).catch(() => undefined);
        // What the page said when the run stopped, beside its picture.
        const said = await page.locator('body').innerText({ timeout: 5_000 }).catch(() => '');
        writeFileSync(`${work}${name}.txt`, `${page.url()}\n\n${said}\n`);
      }
    }
  };
  const end = async (): Promise<void> => {
    for (const gone of [...devices]) await keepStorage(gone).catch(() => undefined);
    for (const gone of [...devices]) await gone.context.close().catch(() => undefined);
    for (const child of children) child.kill();
    await relay?.close();
  };

  return { work, started, lines, note, log, run, pay, mine, passTime, elsewhere, prepare, device, watchPage, close, keepStorage, freshEngine, devices, shot, state, begin, failed, end, mark, since, blockFacts, blockFact, standing, standingNow, height, sweepSent, nameNewest };
};

export type Course = ReturnType<typeof course>;

/** The part of a record that says what the run measured about waits for a block, if it measured anything. */
export const blockSection = (facts: string[]): string[] =>
  facts.length === 0
    ? []
    : [
        'Waits for a block (proposal section 17, "What still waits for a block"): the times are wall-clock times measured by the run; after each, the chain as the pages\' first server had it at that moment, and which of the wallet\'s transactions were not in a block yet when the page had already gone on.',
        '',
        ...facts.map((line) => `- ${line}`),
        '',
        ...waitsConcluded(facts),
      ];

/**
 * What the measured facts show, said in the record: whether a step went on before a block held the transaction
 * it rested on. Only what the facts show is said; where a block came first, the record says that it cannot tell.
 */
const waitsConcluded = (facts: string[]): string[] => {
  const fact = (start: string): { seconds: string; open: string } | undefined => {
    const line = facts.find((candidate) => candidate.startsWith(start));
    const found = line === undefined ? null : /(\d+) s[^;]*; the chain is at height \d+; not in a block yet: ([^;]*); in a block: /.exec(line);
    return found === null ? undefined : { seconds: found[1] ?? '', open: found[2] ?? '' };
  };
  const said: string[] = [];
  const protectedAt = fact('From "Set it up" to "Protected"') ?? fact('From the payment to "Protected"');
  if (protectedAt !== undefined) {
    said.push(
      /the creation /.test(protectedAt.open)
        ? `From the moment the wallet was asked for to a wallet in use with recovery on (${protectedAt.seconds} s), no step waited for a block: the transaction that created the wallet was still not in one when the wallet showed "Protected".`
        : `A block held the wallet's creation before the wallet showed "Protected" (${protectedAt.seconds} s), so this record alone does not show that no step of the creation waited for one.`,
    );
  }
  const sweptAt = fact('From the completion to the sweep sent by the new phone');
  if (sweptAt !== undefined) {
    said.push(
      /the completion /.test(sweptAt.open) && /"Moved /.test(sweptAt.open)
        ? `From the completed recovery to the swept coins, no step waited for a block: ${sweptAt.seconds} s after the completion the new phone sent its sweep, and neither the completion nor the sweep was in a block yet.`
        : `When the new phone sent its sweep (${sweptAt.seconds} s after the completion), a block held the completion already, so this record alone does not show that no step of the takeover waited for one.`,
    );
  }
  if (said.length === 0) return [];
  said.push('The waits that remain are those the proposal keeps: the waiting period of a recovery request, which counts from the block that holds the request; a device retiring for good only once a block holds another owner; and the time locks of applications.');
  return ['What these show:', '', ...said.map((line) => `- ${line}`), ''];
};

/** Which release each public page serves, as its `version.json` says: one sentence for a record. */
export const servedFrom = async (urls: string[]): Promise<string> => {
  const said: string[] = [];
  for (const url of urls) {
    try {
      const version = (await (await fetch(`${url}version.json`)).json()) as { commit?: string; branch?: string; releasedAt?: string };
      said.push(`${url} commit ${version.commit} of ${version.branch}, released ${version.releasedAt}`);
    } catch (error) {
      said.push(`${url} (its version could not be read: ${(error as Error).message})`);
    }
  }
  return `Served from: ${said.join('; ')}.`;
};

/** The sentence of a record that says which pages the run used. */
export const pagesUsed = (apps: string[], timed: string): string =>
  chipnet && !localPages
    ? `The pages are the public ones, ${apps.join(', ')}, as served, on chipnet with the public backup stores. ${timed}`
    : chipnet
      ? `The pages are this checkout's production builds (\`deploy/preview.sh build\`), served on this machine by \`deploy/serve.mjs\` with the content security policy and \`deploy/config/local.json\` (${apps.join(', ')}), with two backup stores of the run's own, on chipnet. ${timed}`
      : 'The pages are the production builds served by `deploy/serve.mjs` with the content security policy, against the regtest node, two backup stores and a relay for the sessions between the pages, all on this machine. The run made the blocks and moved the chain\'s clock.';

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
/**
 * On the Send screen, with the address filled in: "Max", then the review of sending everything. When the wallet holds too
 * little, "Max" itself shows "Too little to send", and there is nothing to review.
 */
export const reviewEverything = async (page: Page, timeout = 120_000): Promise<void> => {
  await click(page, /^Max$/);
  const filled = page.getByText('Everything the wallet can send', { exact: true });
  const nothing = page.getByText('Too little to send');
  await filled.or(nothing).first().waitFor({ state: 'visible', timeout: timeout * patience });
  if (await filled.isVisible()) await click(page, /^Review$/);
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

/**
 * The recoverer's screen of its wallet, with the wallet's account open. A page whose engine failed its header
 * checks after a reorganization of the chain stays at "Opening this wallet": after three minutes of
 * that, its engine's header store is made afresh (see `freshEngine`) and the screen opened again.
 */
export const openDeskWorking = async ({ freshEngine }: Course, recoverer: Device): Promise<void> => {
  await openDesk(recoverer.page);
  const opening = recoverer.page.getByText('Opening this wallet');
  const behind = recoverer.page.getByText(/The engine's header check stands at \d+ of \d+/);
  for (let attempt = 0; attempt < 90 && (await opening.isVisible()) && !(await behind.isVisible()); attempt++) await wait(2_000);
  if (!(await opening.isVisible()) && !(await behind.isVisible())) return;
  await freshEngine(recoverer, RECOVERER, await behind.isVisible());
  await openDesk(recoverer.page);
  for (let attempt = 0; attempt < 150 && (await opening.isVisible()); attempt++) await wait(2_000);
  if (await behind.isVisible()) throw new Error(`the recoverer's page still says: ${await behind.first().textContent()}`);
};

/**
 * The recoverer sends its whole balance to an address, from the card that shows the balance: "Send all", the
 * address, the review, and the sending. Returns what the page says afterwards, or `undefined` when the balance
 * holds nothing to send.
 */
export const sendAllOfBalance = async (page: Page, to: string): Promise<string | undefined> => {
  const balance = page.getByTestId('funds-balance').first();
  await balance.waitFor({ state: 'visible', timeout: 240_000 * patience });
  if ((await balance.getAttribute('data-value')) === '0') return undefined;
  await click(page, 'Send all');
  await page.getByLabel('To').fill(to);
  await click(page, 'Review');
  await see(page, 'Arrives');
  await click(page, 'Send all');
  const sent = page.getByText(/The fee was [\d,]+ sat/).first();
  await sent.waitFor({ state: 'visible', timeout: 120_000 * patience });
  return ((await sent.textContent()) ?? '').replace(/\s+/g, ' ').trim();
};

/** The wallet's balance as its home screen shows it, in satoshis. */
export const balanceOf = async (page: Page): Promise<bigint> => {
  const text = (await page.getByTestId('balance').first().textContent()) ?? '';
  const [whole = '0', fraction = ''] = text.replace(/[^0-9.]/g, '').split('.');
  return BigInt(whole) * 100_000_000n + BigInt(fraction.padEnd(8, '0').slice(0, 8) || '0');
};

// ------------------------------------------------------------------ the first steps of every course

/**
 * A code taken in on the phone as a person without a camera would: the scanner that opens by itself is closed, and the
 * code's text is pasted under "No camera?" (scripts/scan-check.ts and scripts/session-check.ts cover the camera).
 */
export const pasteCode = async (page: Page, code: string): Promise<void> => {
  const cancel = page.locator('dialog.scan-dialog').getByRole('button', { name: 'Cancel' });
  await cancel.waitFor({ state: 'visible', timeout: 30_000 }).then(() => cancel.click(), () => undefined);
  await page.getByText('No camera?').first().click();
  await page.locator('#code-text').fill(code);
  await click(page, 'Use it');
};

/** The code a recoverer's screen shows, once its session is reachable. */
const codeOn = async (page: Page, testId: string): Promise<string> => {
  await see(page, /Waiting for (their|the new) phone to scan the code/, 60_000);
  await wait(300);
  return valueOf(page, testId);
};

/**
 * Steps 1 to 3: Anna opens the recoverer's page as someone helping a person she knows, sets the waiting period of
 * new wallets, and funds her balance; she sets up Grandma's wallet: the phone scans her code and asks, Anna says
 * yes, and the wallet is created from her coins, the phone opens it and recovery is on; the owner receives.
 * @param shoot - takes the screenshots of these screens, under their names in docs/screens
 * @returns the devices, the code of Anna's set-up screen, and that the wallet was set up over its session; or
 * nothing when the run was asked to stop earlier
 */
export const firstSteps = async (
  { begin, device, log, pay, mine, mark, since, standingNow, keepStorage, work }: Course,
  shoot: (page: Page, name: string) => Promise<void>,
  /** Called once the owner's phone has its words and before anything is created for it: to keep them on disk. */
  beforeFunding: (old: Device) => Promise<void> = async () => undefined,
): Promise<{ recoverer: Device; old: Device; recovererLink: string; overSession: boolean } | undefined> => {
  // 1 ------------------------------------------------------------------
  if (!begin('Anna opens the recoverer\'s page to help someone she knows, and funds her balance')) return;
  const recoverer = await device('recoverer');
  await recoverer.page.goto(RECOVERER);
  await see(recoverer.page, 'How will you use this page?');
  await recoverer.page.getByTestId('mode-friend').click();
  await recoverer.page.getByLabel('Your name, as their wallet shows it').fill('Anna');
  await shoot(recoverer.page, 'recoverer-start');
  await click(recoverer.page, 'Continue');
  await see(recoverer.page, 'No wallets yet.');
  // The shortest waiting period, so that the course's recovery can complete: the run moves the chain's clock.
  await recoverer.page.getByRole('link', { name: 'Settings' }).first().click();
  await recoverer.page.getByLabel(/about 9 minutes/).check();
  await recoverer.page.getByLabel('Starting balance, in satoshis').fill('100000');
  await shoot(recoverer.page, 'recoverer-settings');
  await click(recoverer.page, 'Save');
  log('   friend mode; new wallets get 100,000 satoshis and a waiting period of about 9 minutes');
  await recoverer.page.getByRole('link', { name: 'People' }).first().click();
  const fundsAddress = await valueOf(recoverer.page, 'funds-address');
  await keepStorage(recoverer);
  log(`   Anna's balance is funded at ${fundsAddress}; what her page keeps, her words among it, is copied to ${work.slice(root.length)}storage-recoverer.json first`);
  log(`   ${pay(fundsAddress, 400_000)}`);
  const balance = recoverer.page.locator('[data-testid="funds-balance"]:not([data-value="0"])');
  await balance.first().waitFor({ state: 'visible', timeout: 120_000 * patience });
  log(`   Anna's page shows her balance: ${(await balance.first().getAttribute('data-value')) ?? ''} satoshis`);
  await shoot(recoverer.page, 'recoverer-empty');

  // 2 ------------------------------------------------------------------
  if (!begin('Anna sets up Grandma\'s wallet: the phone scans her code, she says yes')) return;
  await recoverer.page.getByTestId('new-wallet').click();
  await recoverer.page.getByLabel('Who are you helping?').fill('Grandma');
  await click(recoverer.page, 'Show the code');
  const code = await codeOn(recoverer.page, 'recoverer-code');
  log(`   Anna's code carries her name, her key and a session, ${code.length} characters`);
  const old = await device('old-phone');
  await old.page.goto(WALLET);
  await see(old.page, 'Someone I trust is setting it up');
  await shoot(old.page, 'wallet-welcome');
  await click(old.page, 'Someone I trust is setting it up');
  await pasteCode(old.page, code);
  await beforeFunding(old);
  await see(recoverer.page, 'Set up Grandma\'s wallet with', 120_000);
  await see(old.page, 'Waiting for Anna to say yes', 120_000);
  log('   the phone asked over the session; Anna\'s page asks "Set up Grandma\'s wallet?", the phone waits for her');
  await keepStorage(old);
  await shoot(old.page, 'wallet-setting-up');
  await shoot(recoverer.page, 'recoverer-friend-confirm');
  await click(recoverer.page, 'Set it up');
  mark('paid');
  // Anna's page says the wallet is set up for some seconds and then offers a new code for the next phone: it is
  // watched for from the moment she says yes, since on a public network the phone may say so later than that.
  const setUpShown = recoverer.page
    .getByText('Grandma\'s wallet is set up')
    .first()
    .waitFor({ state: 'visible', timeout: 240_000 * patience })
    .then(
      () => undefined,
      (error: unknown) => error,
    );
  // The phone goes on as soon as the network has the creation: no block is waited for.
  await see(old.page, 'Your wallet is ready', 180_000);
  log(`   the phone shows "Your wallet is ready" with ${(await old.page.locator('.set-up-balance .balance-sub').first().textContent())?.trim()}`);
  await standingNow(old.page, `From "Set it up" to "Your wallet is ready": ${since('paid')}`);
  await shoot(old.page, 'wallet-ready');
  const notShown = await setUpShown;
  if (notShown !== undefined) throw notShown;
  log('   Anna\'s page says the wallet is set up and keeps what a recovery needs');
  await click(old.page, 'Open my wallet');
  await see(old.page, 'Protected', 180_000);
  log('   the wallet shows "Protected": Anna\'s receipt is on the backup stores');
  await standingNow(old.page, `From "Set it up" to "Protected", recovery on: ${since('paid')}`);
  mine(1);

  // 3 ------------------------------------------------------------------
  if (!begin('The owner receives')) return;
  await old.page.getByRole('link', { name: 'Receive' }).first().click();
  const receiving = await valueOf(old.page, 'receive-address');
  log(`   address ${receiving}`);
  log(`   ${pay(receiving, 50_000)}`);
  await shoot(old.page, 'wallet-receive');
  // The vault address is given as soon as the wallet is created, as every other address.
  await old.page.getByRole('button', { name: 'For regular payments' }).click();
  const vaultShown = old.page.locator(`[data-testid="receive-address"]:not([data-value="${receiving}"])`);
  await vaultShown.first().waitFor({ state: 'visible', timeout: 60_000 * patience });
  log(`   vault address ${(await vaultShown.first().getAttribute('data-value')) ?? ''}`);
  await standingNow(old.page, `From "Set it up" to the vault address shown: ${since('paid')}`);
  await shoot(old.page, 'wallet-receive-vault');
  await old.page.getByRole('link', { name: 'Home' }).first().click();
  await see(old.page, /^0\.00\d+/);
  for (let attempt = 0; attempt < 30; attempt++) {
    const balance = (await old.page.getByTestId('balance').textContent()) ?? '';
    if (Number(balance.replace(/[^0-9.]/g, '')) > 0.0014) break;
    await wait(1_000);
  }
  log(`   the wallet holds ${(await old.page.getByTestId('balance').textContent())?.replace('BCH', ' BCH')}`);
  await shoot(old.page, 'wallet-home');
  return { recoverer, old, recovererLink: code, overSession: true };
};

// ------------------------------------------------------------------ a takeover

/**
 * A phone asks to take the wallet over: on the recoverer's screen of the wallet, "Grandma lost their phone" shows a
 * code; the phone chooses "I lost my phone" and scans it; its request goes over the session, and the recoverer's
 * page asks the network at once.
 * @param _link - kept for the courses that pass it; the code comes from the recoverer's screen of the wallet
 * @param made - the new phone, if it is already opened; otherwise a new profile is made
 */
export const newPhoneAsks = async (theCourse: Course, recoverer: Device, _link: string, shoot: (page: Page, name: string) => Promise<void>, made?: Device): Promise<Device> => {
  const { device, log } = theCourse;
  const next = made ?? (await device('new-phone'));
  await openDeskWorking(theCourse, recoverer);
  await click(recoverer.page, /lost their phone/);
  const code = await codeOn(recoverer.page, 'lost-phone-code');
  await shoot(recoverer.page, 'recoverer-lost-phone');
  await next.page.goto(WALLET);
  await click(next.page, 'I lost my phone');
  await pasteCode(next.page, code);
  await see(next.page, /Waiting for Anna/, 120_000);
  log('   the new phone sent its request over the session of the code');
  await shoot(next.page, 'wallet-takeover-request');
  return next;
};

/**
 * The request the recoverer sent goes into a block, the waiting period passes, the recoverer completes the
 * move and hands the wallet over, and the new phone sweeps the coins to its own seed.
 */
export const completeTakeover = async (
  { log, mine, passTime, mark, since, blockFact, standingNow, keepStorage, height, sweepSent, nameNewest }: Course,
  recoverer: Device,
  next: Device,
  shoot: (page: Page, name: string) => Promise<void>,
  /** The request was sent by a part of the run that stopped: the pages are opened again where they were. */
  resumed = false,
): Promise<void> => {
  // The new phone's words, kept beside its profile before any coin is swept to them.
  await keepStorage(next);
  if (resumed) {
    await openDesk(recoverer.page);
    await next.page.goto(WALLET);
  } else {
    await see(recoverer.page, 'The request is sent');
  }
  mine(1);
  await see(recoverer.page, 'Your request is waiting');
  if (chipnet) {
    // The page shows the request at once; the waiting period counts from the block that holds it. On chipnet a
    // block may leave it out for a while when blocks are full.
    log('   the request is sent and waiting for a block');
    await recoverer.page.getByTestId('waiting-clock').first().waitFor({ state: 'visible', timeout: 90 * 60_000 });
  }
  log('   the request is in a block; the waiting period runs');
  // The recoverer's page shows the chain's clock, and the waiting period measured against it.
  const shown = async (testId: string): Promise<string> => {
    const element = recoverer.page.getByTestId(testId).first();
    await element.waitFor({ state: 'visible', timeout: 120_000 * patience });
    return ((await element.textContent()) ?? '').trim();
  };
  const clockBefore = await valueOf(recoverer.page, 'chain-clock');
  log(`   the recoverer's page shows the chain's clock at ${await shown('waiting-clock')}, block ${await valueOf(recoverer.page, 'chain-height')}; the waiting period ends when it passes ${await shown('waiting-ends')}`);
  log(`   ${passTime(700)}`);
  if (!chipnet) {
    // The clock on the page moves with the blocks that were made.
    const moved = recoverer.page.locator(`[data-testid="chain-clock"]:not([data-value="${clockBefore}"])`).first();
    await moved.waitFor({ state: 'visible', timeout: 60_000 });
    log(`   the chain's clock on the page moved on by ${Number(await moved.getAttribute('data-value')) - Number(clockBefore)} seconds, to block ${await valueOf(recoverer.page, 'chain-height')}`);
  }
  // On chipnet the chain's clock has to pass 512 seconds: the button is enabled when it has.
  await click(recoverer.page, 'Complete the move', chipnet ? 360_000 : 120_000);
  await see(recoverer.page, 'The wallet is moved');
  mark('completed');
  await nameNewest('the completion');
  // The hand-over is made as soon as the network shows the completion: no block is waited for.
  const handOver = await valueOf(recoverer.page, 'handover-link', 120_000);
  log('   completed; the hand-over is ready');
  blockFact(`From the completion to the hand-over: ${since('completed')}; the chain is at height ${await height()}.`);
  await shoot(recoverer.page, 'recoverer-handover');
  // Over the session of the lost phone's code, when the new phone is still on it; otherwise by the hand-over's code.
  const arrived = await next.page.getByText('Bringing your coins over').first().waitFor({ state: 'visible', timeout: 45_000 }).then(() => true, () => false);
  if (arrived) {
    log('   the hand-over reached the new phone over the session');
    const told = await recoverer.page.getByText('The new phone has the wallet').first().waitFor({ state: 'visible', timeout: 30_000 }).then(() => true, () => false);
    log(told ? '   the recoverer\'s page says that the new phone has the wallet' : '   the recoverer\'s page was not told that the new phone has the wallet');
  } else {
    log('   the hand-over did not arrive over the session; the new phone opens the hand-over\'s code');
    await next.page.goto(handOver);
  }
  await see(next.page, 'Bringing your coins over');
  await shoot(next.page, 'wallet-arrival');
  // The sweep is looked at on the chain as soon as the page has sent it, before the full search ends.
  let swept = false;
  for (let attempt = 0; attempt < 120; attempt++) {
    if (!swept && (await sweepSent(next.page))) {
      swept = true;
      await standingNow(next.page, `From the completion to the sweep sent by the new phone: ${since('completed')}`);
    }
    if (await next.page.getByRole('button', { name: 'Open the wallet' }).isVisible()) break;
    if (attempt % 3 === 0) mine(1);
    await wait(1_000);
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
  await standingNow(next.page, `From the completion to the swept coins in the new phone's wallet: ${since('completed')}`);
  await see(next.page, 'Protected', 120_000);
  log('   recovery is on for the new phone');
  blockFact(`From the completion to "Protected" on the new phone: ${since('completed')}.`);
  await shoot(next.page, 'wallet-home-after-takeover');
};
