// Test SJ03 on chipnet: an ordinary wallet, the Cashonize web wallet at https://cashonize.com as it is
// served, opens a savings jar with this project's Savings Jar page (apps/jar) and empties it. The page is
// the one Grandma's Wallet uses and the contract is the same; with an ordinary wallet the page builds each
// transaction and the wallet signs it after showing it (WizardConnect `sign_transaction_request`).
//
//   wallet       Cashonize makes a chipnet wallet; its address and seed phrase are written to disk
//   fund         the funding key pays the wallet (scripts/chipnet-pay.ts)
//   open         the jar page is connected to Cashonize, and a jar opened for ten minutes
//   wait         the page is watched until the jar can be emptied, noting what it offers before then
//   empty        the jar is emptied
//   pay in       the page pays into the jar again
//   empty again  and empties it again
//   check        the chain is read: the jar holds nothing, it is at the address the contract gives
//   return       Cashonize sends what it holds back to the funding address
//
// usage (from the repository's root):
//   npx tsx scripts/jar-cashonize.ts [--until <step>] [--headed]
//
// The run is kept in .chipnet/cashonize-run/ (not in git): the browser profile, which holds Cashonize's
// keys, wallet.json with its address and seed phrase (written before it is paid), run.json with every step
// done, and screenshots. Started again with the same command, it continues where it stopped. The jar page
// is built from this checkout into that directory and served on 127.0.0.1:8193 by deploy/serve.mjs with
// deploy/config/local.json (chipnet) for as long as the run lasts. The record is written to
// docs/runs/stage-8-cashonize-chipnet.md.
import { type ChildProcess, execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  type TransactionCommon,
  binToHex,
  cashAddressToLockingBytecode,
  decodeTransactionBch,
  deriveHdPath,
  deriveHdPrivateNodeFromBip39Mnemonic,
  deriveHdPublicNode,
  encodeLockingBytecodeP2pkh,
  hash160,
  hexToBin,
  lockingBytecodeToCashAddress,
} from '@bitauth/libauth';
import { savingsJarScript, unlockTimeOf } from '@grandmas-wallet/savings-jar';
import { type BrowserContext, type Locator, type Page, chromium } from 'playwright';

import { Electrum } from '../packages/chipnet/src/electrum.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const work = `${root}.chipnet/cashonize-run/`;
const profile = `${work}profile`;
const shots = `${work}shots/`;
const statePath = `${work}run.json`;
const walletPath = `${work}wallet.json`;
const recordPath = `${root}docs/runs/stage-8-cashonize-chipnet.md`;
const CASHONIZE = 'https://cashonize.com';
const PORT = 8193;
const JAR_PAGE = `http://127.0.0.1:${PORT}/`;
const CHAIN = 'wss://chipnet.9500.cash:443';
const FUNDING = 40_000;
const JAR_BCH = '0.00004';
const PAY_IN_BCH = '0.00003';
const PAY_IN_AGAIN_BCH = '0.00002';
const MINUTE = 60_000;

const STEPS = ['wallet', 'fund', 'open', 'wait', 'empty', 'pay in', 'empty again', 'pay in again', 'empty a third time', 'check', 'return'] as const;
type StepName = (typeof STEPS)[number];

const argument = (name: string): string | undefined => {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
};
const until = (argument('until') ?? 'return') as StepName;
if (!STEPS.includes(until)) throw new Error(`--until takes one of: ${STEPS.join(', ')}`);
const headed = process.argv.includes('--headed');

// ------------------------------------------------------------------ what the run keeps

interface Row {
  step: string;
  transactionId: string;
  note: string;
}
interface State {
  started: string;
  done: StepName[];
  /** Steps begun and not known to be finished: a step found here when the run starts again is looked into before it is repeated. */
  begun: StepName[];
  /** What was observed, by a name, in the order first seen. */
  notes: Record<string, string>;
  rows: Row[];
  cashonize?: { address: string; tokenAddress: string; build: string; browser: string };
  funderBefore?: string;
  funderAfter?: string;
  jar?: { category: string; unlockTime: number; address: string };
  outcome?: string;
}

const state: State = existsSync(statePath) ? (JSON.parse(readFileSync(statePath, 'utf8')) as State) : { started: new Date().toISOString(), done: [], begun: [], notes: {}, rows: [] };
const save = (): void => writeFileSync(statePath, `${JSON.stringify(state, undefined, 2)}\n`, { mode: 0o600 });
const startedAt = Date.now();
const say = (message: string): void => console.log(`[${String(Math.round((Date.now() - startedAt) / 1000)).padStart(5)}s] ${message}`);
const note = (key: string, text: string): void => {
  if (state.notes[key] === undefined) {
    state.notes[key] = text;
    save();
  }
  say(`  ${text}`);
};
const row = (step: string, transactionId: string, text: string): void => {
  if (!state.rows.some((existing) => existing.step === step)) state.rows.push({ step, transactionId, note: text });
  save();
  say(`  ${step}: ${transactionId}`);
};
const isDone = (step: StepName): boolean => state.done.includes(step);
/** The source of the page the steps were carried out with, as last noted. */
let pageNoted: string | undefined;
const begin = (step: StepName): void => {
  if (!state.begun.includes(step)) state.begun.push(step);
  save();
  say(`== ${step}`);
  if (['open', 'empty', 'pay in', 'empty again', 'pay in again', 'empty a third time'].includes(step) && pageNoted !== served) {
    pageNoted = served;
    note(`page-${served}`, `From "${step}" on, the jar page was built from ${served}.`);
  }
};
const finish = (step: StepName): void => {
  state.begun = state.begun.filter((name) => name !== step);
  if (!state.done.includes(step)) state.done.push(step);
  save();
};
const reached = (step: StepName): boolean => STEPS.indexOf(step) > STEPS.indexOf(until);
const words = (text: string): string => text.replaceAll(/\s+/g, ' ').trim();

// ------------------------------------------------------------------ the chain

const electrum = await Electrum.connect(CHAIN);
const transactionOf = async (transactionId: string): Promise<TransactionCommon> => {
  const hex = await electrum.getTransaction(transactionId);
  if (hex === undefined) throw new Error(`the server does not know ${transactionId}`);
  const decoded = decodeTransactionBch(hexToBin(hex));
  if (typeof decoded === 'string') throw new Error(decoded);
  return decoded;
};
/** A transaction's size and fee, from its inputs' transactions. */
const sizeAndFee = async (transactionId: string): Promise<{ bytes: number; fee: bigint }> => {
  const hex = (await electrum.getTransaction(transactionId)) ?? '';
  const transaction = await transactionOf(transactionId);
  let spent = 0n;
  for (const input of transaction.inputs) {
    const previous = await transactionOf(binToHex(input.outpointTransactionHash));
    spent += previous.outputs[input.outpointIndex]?.valueSatoshis ?? 0n;
  }
  return { bytes: hex.length / 2, fee: spent - transaction.outputs.reduce((sum, output) => sum + output.valueSatoshis, 0n) };
};
const lockingOf = (address: string): Uint8Array => {
  const decoded = cashAddressToLockingBytecode(address);
  if (typeof decoded === 'string') throw new Error(decoded);
  return decoded.bytecode;
};
const addressOf = (lockingBytecode: Uint8Array, tokens = false): string => {
  const encoded = lockingBytecodeToCashAddress({ prefix: 'bchtest', bytecode: lockingBytecode, tokenSupport: tokens });
  if (typeof encoded === 'string') throw new Error(encoded);
  return encoded.address;
};
/** Cashonize's first addresses on both chains, from the seed phrase it showed (m/44'/145'/0'), by locking bytecode. */
let scanned: Map<string, string> | undefined;
const scannedAddresses = async (): Promise<Map<string, string>> => {
  if (scanned !== undefined) return scanned;
  const { seed } = JSON.parse(readFileSync(walletPath, 'utf8')) as { seed: string };
  const node = deriveHdPrivateNodeFromBip39Mnemonic(seed);
  scanned = new Map();
  for (const chain of [0, 1]) {
    for (let index = 0; index < 30; index++) {
      const child = deriveHdPath(node, `m/44'/145'/0'/${chain}/${index}`);
      if (typeof child === 'string') throw new Error(child);
      scanned.set(binToHex(encodeLockingBytecodeP2pkh(hash160(deriveHdPublicNode(child).publicKey))), `${chain === 0 ? 'receive' : 'change'} ${index}`);
    }
  }
  return scanned;
};
const pay = (...parameters: string[]): string => execFileSync('npx', ['tsx', 'scripts/chipnet-pay.ts', ...parameters], { cwd: root, encoding: 'utf8' }).trim();
const funderAddress = pay('address');
/** The amount in what `chipnet-pay.ts balance` prints. */
const satoshisIn = (balance: string): string => /^(\d+) satoshis/.exec(balance)?.[1] ?? balance;

// ------------------------------------------------------------------ the jar page, built from this checkout

/** What the page is built from: the commit, and any changes to apps/jar not committed yet. */
const pageSource = (): string => {
  const git = (...parameters: string[]): string => execFileSync('git', parameters, { cwd: root, encoding: 'utf8' }).trim();
  const changed = git('diff', '--name-only', 'HEAD', '--', 'apps/jar').split('\n').filter((name) => name !== '');
  const commit = git('rev-parse', '--short', 'HEAD');
  if (changed.length === 0) return `commit \`${commit}\`, unchanged`;
  const digest = createHash('sha256').update(git('diff', 'HEAD', '--', 'apps/jar')).digest('hex').slice(0, 12);
  return `commit \`${commit}\` with uncommitted changes to ${changed.map((name) => `\`${name}\``).join(', ')} (diff ${digest})`;
};
const served = pageSource();

const serve = (): ChildProcess => {
  execFileSync('npx', ['vite', 'build', '--outDir', `${work}jar-dist`, '--emptyOutDir'], { cwd: `${root}apps/jar`, stdio: 'inherit' });
  const server = spawn('node', ['deploy/serve.mjs', '--root', `${work}jar-dist`, '--config', 'deploy/config/local.json', '--host', '127.0.0.1', '--port', String(PORT)], { cwd: root, stdio: ['ignore', 'inherit', 'inherit'] });
  say(`jar page served by process ${server.pid}`);
  return server;
};

// ------------------------------------------------------------------ the browser

let shot = 0;
const picture = async (page: Page, label: string): Promise<void> => {
  shot += 1;
  await page.screenshot({ path: `${shots}${new Date().toISOString().slice(0, 19).replaceAll(':', '-')}-${String(shot).padStart(2, '0')}-${label}.png`, fullPage: true }).catch(() => undefined);
};
const visible = (locator: Locator): Promise<boolean> => locator.isVisible().catch(() => false);
const pause = (milliseconds: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, milliseconds));

/** Cashonize's chipnet wallet: made on the first run, opened again on every later one. */
const openCashonize = async (context: BrowserContext): Promise<Page> => {
  const wallet = await context.newPage();
  wallet.on('pageerror', (error) => say(`  ! cashonize: ${error.message.slice(0, 300)}`));
  wallet.on('console', (message) => {
    if (message.type() === 'error' && !/icon\.svg|ERR_FAILED|loopback/.test(message.text())) say(`  ! cashonize console: ${message.text().slice(0, 300)}`);
  });
  await wallet.goto(CASHONIZE);
  return wallet;
};

const readSeed = async (wallet: Page): Promise<string[]> => {
  await wallet.locator('nav img[src*="settings"]').click();
  await wallet.getByText('Backup wallet').click();
  await wallet.getByRole('button', { name: 'Show seed phrase' }).click();
  await wallet.getByText('Copy Seed Phrase').waitFor({ timeout: MINUTE });
  const text = await wallet.locator('body').innerText();
  const found = [...text.matchAll(/^\s*(\d{1,2})\s*([a-z]+)\s*$/gm)].map((match) => ({ index: Number(match[1]), word: match[2] as string }));
  const seed = found.filter((entry, index) => entry.index === index + 1).map((entry) => entry.word);
  if (seed.length !== 12 && seed.length !== 24) throw new Error(`the seed phrase could not be read (${seed.length} words)`);
  return seed;
};

const homeOf = async (wallet: Page): Promise<{ address: string; tokenAddress: string; balance: string; network: string }> => {
  await wallet.locator('nav').getByText('Wallet', { exact: true }).click();
  await wallet.locator('.depositAddr').first().waitFor({ timeout: MINUTE });
  // The balance is filled in once the wallet has read the chain.
  await wallet.getByText(/tBCH balance:\s*[\d.]+/).first().waitFor({ timeout: MINUTE });
  const text = await wallet.locator('body').innerText();
  const address = /tBCH address:\s*(bchtest:[0-9a-z]+)/.exec(text)?.[1];
  const tokenAddress = /Token address:\s*(bchtest:[0-9a-z]+)/.exec(text)?.[1];
  const balance = /tBCH balance:\s*([^\n]+)/.exec(text)?.[1] ?? '?';
  if (address === undefined || tokenAddress === undefined) throw new Error(`Cashonize shows no chipnet address:\n${text.slice(0, 600)}`);
  return { address, tokenAddress, balance: balance.trim(), network: text.includes('chipnet') ? 'chipnet' : '?' };
};

/** Pairs the page with Cashonize, or waits for the session of an earlier run to be resumed by both. */
const connect = async (wallet: Page, jar: Page): Promise<void> => {
  await jar.goto(JAR_PAGE);
  const connected = jar.getByText(/^Connected to /).first();
  const address = jar.locator('.value-text[data-value^="wiz:"]').first();
  await Promise.race([connected.waitFor({ timeout: 2 * MINUTE }), address.waitFor({ timeout: 2 * MINUTE }), jar.getByText('Reaching the wallet that was connected before').waitFor({ timeout: 2 * MINUTE })]);
  if (!(await visible(connected)) && !(await visible(address))) {
    // An earlier session: Cashonize, open in the other tab, takes it up again by itself.
    const resumed = await connected.waitFor({ timeout: 45_000 }).then(
      () => true,
      () => false,
    );
    if (resumed) {
      say('the jar page and Cashonize resumed the earlier session');
    } else {
      say('the earlier session was not resumed; pairing again');
      await jar.getByRole('button', { name: 'Connect another wallet' }).click();
    }
  }
  if (!(await visible(connected))) {
    await address.waitFor({ timeout: MINUTE });
    const uri = (await address.getAttribute('data-value')) ?? '';
    await jar.getByText('Waiting for your wallet.').waitFor({ timeout: MINUTE }).catch(() => undefined);
    note('uri', `The jar page shows a connection address \`${uri.slice(0, 12)}…\` (a \`wiz://\` address) and says "${words(await jar.locator('.link-state').innerText())}"`);
    await picture(jar, 'jar-connect');
    await wallet.bringToFront();
    await wallet.locator('nav').getByText('Connect', { exact: true }).click();
    await wallet.getByPlaceholder('Connection URI').fill(uri);
    await wallet.getByText('Connect New dApp').click();
    const consent = wallet.locator('.q-dialog:visible').last();
    await consent.waitFor({ timeout: MINUTE });
    await pause(1_000);
    note('consent', `Cashonize, given the address in its Connect screen, asked: "${words(await consent.innerText())}"`);
    await picture(wallet, 'cashonize-consent');
    await consent.getByRole('button', { name: 'Connect', exact: true }).click();
    await connected.waitFor({ timeout: 2 * MINUTE });
  }
  const card = jar.locator('.connected').first();
  await jar.getByText(/Coins this page can use/).first().waitFor({ timeout: 2 * MINUTE });
  note('connected', `The jar page says: "${words(await card.innerText()).replace(/ Disconnect$/, '')}"`);
  await jar.getByText(/Looking for your jars/).waitFor({ state: 'hidden', timeout: 2 * MINUTE });
  await picture(jar, 'jar-connected');
};

/**
 * Starts an action on the jar page and answers Cashonize: every request it shows is noted in its words
 * and signed. Ends with the transaction the page names when it is done.
 * @throws Error with the page's words if it shows a failure
 */
const carry = async (wallet: Page, jar: Page, label: string, start: () => Promise<void>, doneText: string): Promise<{ transactionId: string; requests: string[]; listed: string }> => {
  const requests: string[] = [];
  await start();
  const deadline = Date.now() + 5 * MINUTE;
  const done = jar.locator('.notice.good', { hasText: doneText }).first();
  while (Date.now() < deadline) {
    const dialog = wallet.locator('.q-dialog:visible').last();
    if (await visible(dialog)) {
      await pause(1_500);
      const text = words(await dialog.innerText());
      requests.push(text);
      await picture(wallet, `${label}-cashonize-request`);
      const sign = dialog.getByRole('button', { name: /^Sign/ });
      if (!(await visible(sign))) throw new Error(`Cashonize's request has no Sign button: ${text}`);
      await sign.click();
      await dialog.waitFor({ state: 'hidden', timeout: MINUTE }).catch(() => undefined);
      continue;
    }
    if (await visible(done)) {
      // What the list shows at the moment the outcome is shown.
      const listed = words(await jar.locator('li.jar').first().innerText().catch(() => ''));
      const link = (await done.locator('a').first().getAttribute('href')) ?? '';
      const transactionId = /([0-9a-f]{64})$/.exec(link)?.[1];
      if (transactionId === undefined) throw new Error(`the page said "${words(await done.innerText())}" without a transaction`);
      await picture(jar, `${label}-done`);
      return { transactionId, requests, listed };
    }
    const problem = jar.locator('.notice.bad').first();
    if (await visible(problem)) {
      await picture(jar, `${label}-refused`);
      throw new Error(words(await problem.innerText()));
    }
    await pause(1_000);
  }
  await picture(jar, `${label}-no-answer`);
  await picture(wallet, `${label}-no-answer-cashonize`);
  throw new Error(`${label}: no outcome within five minutes`);
};

const theJar = (jar: Page): Locator => jar.locator('li.jar').first();

/** The jar address as the page shows it, for paying in from any wallet. */
const jarAddressOnPage = async (jar: Page): Promise<string> => {
  const item = theJar(jar);
  await item.getByRole('button', { name: 'Pay in' }).first().click();
  await item.getByText('Pay in from any wallet').click();
  const address = (await item.locator('.value-text[data-value^="bchtest:"]').first().getAttribute('data-value')) ?? '';
  await item.getByRole('button', { name: 'Close' }).click();
  return address;
};

/** What the chain says about the opening transaction: the key's category and date, and where the jar is. */
const readOpening = async (transactionId: string): Promise<{ category: string; unlockTime: number; jarLocking: Uint8Array; keyAddress: string; matches: boolean; jarSatoshis: bigint }> => {
  const opening = await transactionOf(transactionId);
  const [jarOutput, keyOutput] = opening.outputs;
  const token = keyOutput?.token;
  if (jarOutput === undefined || keyOutput === undefined || token?.nft === undefined) throw new Error('the opening transaction has no jar and key outputs');
  const category = binToHex(token.category);
  const unlockTime = unlockTimeOf(token.nft.commitment);
  const expected = savingsJarScript(hexToBin(category), unlockTime).lockingBytecode;
  return {
    category,
    unlockTime,
    jarLocking: jarOutput.lockingBytecode,
    keyAddress: addressOf(keyOutput.lockingBytecode, true),
    matches: binToHex(expected) === binToHex(jarOutput.lockingBytecode) && category === binToHex(opening.inputs[0]?.outpointTransactionHash ?? new Uint8Array()),
    jarSatoshis: jarOutput.valueSatoshis,
  };
};

/** A transaction of the jar address that the run has not named yet: for a step that was carried out but not written down. */
const unnamedAtJar = async (): Promise<string | undefined> => {
  if (state.jar === undefined) return undefined;
  const named = new Set(state.rows.map((entry) => entry.transactionId));
  const history = await electrum.getHistory(lockingOf(state.jar.address));
  return history.map((entry) => entry.transactionId).find((transactionId) => !named.has(transactionId));
};

// ------------------------------------------------------------------ the record

const writeRecord = async (): Promise<void> => {
  const commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const table: string[] = [];
  for (const entry of state.rows) {
    const { bytes, fee } = await sizeAndFee(entry.transactionId);
    const step = entry.step.startsWith('empty') ? entry.step.replace('empty', 'empty the jar') : entry.step;
    table.push(`| ${step} | \`${entry.transactionId}\` | ${bytes} | ${fee} | ${entry.note} |`);
  }
  const jar = state.jar;
  const lines = [
    '# Stage 8 run on chipnet (SJ03, an ordinary wallet): a savings jar opened and emptied with Cashonize',
    '',
    `Written by the run itself (\`scripts/jar-cashonize.ts\`). The ordinary wallet is the Cashonize web wallet at ${CASHONIZE}, unmodified, as it was served on the day of the run; the page that builds every transaction is this project's Savings Jar page (\`apps/jar\`), the page and contract Grandma's Wallet uses. Cashonize and the page ran in one Chromium (Playwright) profile kept on disk; the page was built from this checkout and served on 127.0.0.1:${PORT} by \`deploy/serve.mjs\` with \`deploy/config/local.json\` (chipnet). Every transaction was signed in Cashonize after its request was shown, and sent by the page.`,
    '',
    `- Date: ${state.started.slice(0, 10)}`,
    `- Cashonize: ${state.cashonize?.build ?? '?'}`,
    `- Browser: ${state.cashonize?.browser ?? '?'}`,
    `- Cashonize's chipnet wallet receives at \`${state.cashonize?.address ?? '?'}\` (keys in the browser profile; its seed phrase in \`.chipnet/cashonize-run/wallet.json\`, not in git)`,
    ...(jar === undefined
      ? []
      : [
          `- Jar key (token category): \`${jar.category}\`; the jar's date: ${new Date(jar.unlockTime * 1000).toISOString()}`,
          `- Jar address: \`${jar.address}\``,
        ]),
    `- Jar page: this repository's \`apps/jar\`; the source each step was carried out with is noted below (the record was written at commit \`${commit}\`)`,
    `- Started ${state.started}`,
    '',
    '| Step | Transaction | Bytes | Fee (sat) | Note |',
    '| --- | --- | --- | --- | --- |',
    ...table,
    '',
    'Also observed:',
    '',
    ...Object.values(state.notes).map((text) => `- ${text}`),
    '',
    `Outcome: ${state.outcome ?? 'not finished'}`,
    '',
  ];
  writeFileSync(recordPath, lines.join('\n'));
  say(`record written to ${recordPath.slice(root.length)}`);
};

// ------------------------------------------------------------------ the run

mkdirSync(shots, { recursive: true });
save();
let server: ChildProcess | undefined;
let context: BrowserContext | undefined;
try {
  server = serve();
  context = await chromium.launchPersistentContext(profile, { headless: !headed, viewport: { width: 1000, height: 1100 } });
  for (const blank of context.pages()) await blank.close();
  const wallet = await openCashonize(context);

  // wallet ------------------------------------------------------------
  if (!isDone('wallet')) {
    begin('wallet');
    const create = wallet.getByRole('button', { name: 'Create new wallet' });
    await Promise.race([create.waitFor({ timeout: MINUTE }), wallet.locator('nav').waitFor({ timeout: MINUTE })]);
    if (await visible(create)) {
      await wallet.getByRole('button', { name: 'Create new wallet' }).click();
      await wallet.getByRole('button', { name: 'Create wallet' }).click();
      await wallet.getByRole('button', { name: 'Finish Setup' }).click();
    }
    await wallet.locator('nav').waitFor({ timeout: MINUTE });
    if (!(await wallet.locator('body').innerText()).includes('chipnet')) {
      await wallet.locator('nav img[src*="settings"]').click();
      await wallet.getByText('Developer settings').click();
      await wallet.getByText('Add development wallet').click();
      const network = await wallet.locator('#addWalletNetwork').inputValue();
      if (network !== 'chipnet') throw new Error(`Cashonize offers a development wallet on ${network}`);
      await wallet.getByRole('button', { name: 'Continue' }).click();
      await wallet.getByRole('button', { name: 'Create new wallet' }).click();
      await wallet.locator('.depositAddr').first().waitFor({ timeout: MINUTE });
    }
    const home = await homeOf(wallet);
    const seed = await readSeed(wallet);
    const browserVersion = /Chrome\/([\d.]+)/.exec(await wallet.evaluate(() => navigator.userAgent))?.[1] ?? '?';
    const script = await wallet.evaluate(() => Array.from(document.querySelectorAll('script[src]')).map((element) => element.getAttribute('src')).join(', '));
    writeFileSync(walletPath, `${JSON.stringify({ wallet: 'Cashonize development wallet on chipnet', ...home, seed: seed.join(' '), derivation: "m/44'/145'/0'", profile: profile.slice(root.length) }, undefined, 2)}\n`, { mode: 0o600 });
    state.cashonize = {
      address: home.address,
      tokenAddress: home.tokenAddress,
      build: `the page shows no version number; its main script was \`${script}\`, fetched ${new Date().toISOString().slice(0, 10)}`,
      browser: `Chromium ${browserVersion} (Playwright), headless`,
    };
    note('wallet', `Cashonize made a chipnet "development wallet" (HD, derivation m/44'/145'/0') and shows the address \`${home.address}\`; its seed phrase was written to disk before it was paid.`);
    await picture(wallet, 'cashonize-wallet');
    finish('wallet');
  }
  const cashonize = state.cashonize;
  if (cashonize === undefined) throw new Error('the run has no Cashonize wallet');

  // fund --------------------------------------------------------------
  if (!isDone('fund') && !reached('fund')) {
    const already = state.begun.includes('fund') ? (await electrum.getHistory(lockingOf(cashonize.address)))[0]?.transactionId : undefined;
    begin('fund');
    state.funderBefore ??= pay('balance');
    save();
    let transactionId = already;
    if (transactionId === undefined) {
      const paid = pay(cashonize.address, String(FUNDING));
      transactionId = /in ([0-9a-f]{64}):0/.exec(paid)?.[1];
      if (transactionId === undefined) throw new Error(`the payment did not go through: ${paid}`);
    }
    row('fund the wallet', transactionId, `${FUNDING.toLocaleString('en-US')} satoshis from the funding key to Cashonize's address, as output 0`);
    note('funder-before', `The funding address \`${funderAddress}\` held ${satoshisIn(state.funderBefore)} satoshis before the run.`);
    finish('fund');
  }

  const jar = await context.newPage();
  jar.on('pageerror', (error) => say(`  ! jar page: ${error.message.slice(0, 300)}`));
  jar.on('console', (message) => {
    if (message.type() === 'error') say(`  ! jar page console: ${message.text().slice(0, 300)}`);
  });

  if (!reached('open')) {
    await connect(wallet, jar);
    // The page finds Cashonize's coins from the keys it shared.
    const deadline = Date.now() + 3 * MINUTE;
    while (!isDone('open') && Date.now() < deadline && /Coins this page can use: 0\.00 BCH/.test(await jar.locator('.connected').innerText())) {
      await pause(10_000);
      await jar.reload();
      await jar.getByText(/Coins this page can use/).first().waitFor({ timeout: 2 * MINUTE });
    }
    note('coins', `With Cashonize's shared keys the page finds its coins: "${words(await jar.locator('.connected').innerText()).replace(/ Disconnect$/, '').replace(/^.*?(Coins this page can use)/, '$1')}"`);
  }

  // open --------------------------------------------------------------
  if (!isDone('open') && !reached('open')) {
    const interrupted = state.begun.includes('open');
    begin('open');
    let transactionId: string | undefined;
    if (interrupted && (await visible(theJar(jar)))) {
      // The jar was opened by a run that stopped before writing it down.
      const address = await jarAddressOnPage(jar);
      transactionId = (await electrum.getHistory(lockingOf(address)))[0]?.transactionId;
      say('  the jar was opened by the run that stopped');
    }
    if (transactionId === undefined) {
      await jar.locator('#jar-amount').fill(JAR_BCH);
      await jar.getByRole('button', { name: '10 minutes' }).click();
      note('summary', `The page's form, with ${JAR_BCH} BCH and "10 minutes" chosen: "${words(await jar.locator('.summary').innerText())}"`);
      await picture(jar, 'open-form');
      const opened = await carry(wallet, jar, 'open', () => jar.getByRole('button', { name: 'Open the jar' }).click(), 'The jar is open.');
      opened.requests.forEach((text, index) => note(`open-request-${index}`, `Opening: Cashonize asked "${text}"; it was signed.`));
      note('open-done', `The page then said: "${words(await jar.locator('.notice.good', { hasText: 'The jar is open.' }).first().innerText())}"`);
      transactionId = opened.transactionId;
    }
    if (transactionId === undefined) throw new Error('no opening transaction');
    const read = await readOpening(transactionId);
    state.jar = { category: read.category, unlockTime: read.unlockTime, address: addressOf(read.jarLocking) };
    row('open the jar', transactionId, `${read.jarSatoshis} satoshis into the jar (output 0), its key to Cashonize's address \`${read.keyAddress}\` (output 1); built by the page, signed by Cashonize`);
    note('opening-address', `On chain, the opening output is at the address \`savingsJarScript(category, unlockTime)\` gives for the key's category and date: ${read.matches}.`);
    await theJar(jar).waitFor({ timeout: 2 * MINUTE });
    note('listed', `The page lists the jar: "${words(await theJar(jar).innerText())}"`);
    await picture(jar, 'jar-listed');
    finish('open');
  }

  // wait --------------------------------------------------------------
  if (!isDone('wait') && !reached('wait')) {
    begin('wait');
    const item = theJar(jar);
    const empty = item.getByRole('button', { name: 'Empty the jar' });
    const deadline = Date.now() + 45 * MINUTE;
    for (;;) {
      await item.waitFor({ timeout: 2 * MINUTE });
      const text = words(await item.innerText());
      if (!(await visible(empty))) {
        note('early-locked', `Before its date the page offers no way to empty the jar: no "Empty the jar" button; the jar shows "${text}"`);
      } else if (await empty.isDisabled()) {
        if (state.notes['early-network'] === undefined) await picture(jar, 'jar-opening');
        note('early-network', `After its date, while the network's median time was still behind it, "Empty the jar" was shown but disabled; the jar showed "${text}"`);
      } else {
        note('ready', `At ${new Date().toISOString().slice(11, 19)} UTC, ${Math.round(Date.now() / 1000 - (state.jar?.unlockTime ?? 0))} seconds after the jar's date, the page offers to empty it: "${text}"`);
        await picture(jar, 'jar-ready');
        break;
      }
      if (Date.now() > deadline) throw new Error('the jar did not become ready within 45 minutes');
      await pause(20_000);
    }
    finish('wait');
  }

  const ROW_NOTES: Record<string, string> = {
    empty: 'the jar\'s coin and the key in one transaction; the savings and the key back to Cashonize\'s addresses; built by the page, signed by Cashonize',
    'pay in': `${PAY_IN_BCH} BCH from Cashonize's coins into the emptied jar, with the page's "Pay in"`,
    'empty again': 'what was paid in after the first withdrawal, with the same key',
    'pay in again': `${PAY_IN_AGAIN_BCH} BCH more, with the page rebuilt with the fixes found in this run`,
    'empty a third time': 'the same, emptied with the rebuilt page',
  };
  /** The page's words about the jar once it agrees with what was done. */
  const settled = async (emptied: boolean): Promise<string> => {
    const deadline = Date.now() + 2 * MINUTE;
    const item = theJar(jar);
    const sign = emptied ? item.locator('.jar-note', { hasText: /^Emptied\./ }) : item.getByRole('button', { name: 'Empty the jar' });
    while (Date.now() < deadline && !(await visible(sign))) await pause(1_000);
    return words(await item.innerText());
  };

  /** Empties the jar from the page; a refusal for being early is noted and tried again. */
  const emptyTheJar = async (step: 'empty' | 'empty again' | 'empty a third time', label: string): Promise<void> => {
    const interrupted = state.begun.includes(step);
    begin(step);
    let transactionId = interrupted ? await unnamedAtJar() : undefined;
    if (transactionId === undefined) {
      for (let attempt = 0; ; attempt++) {
        try {
          const emptied = await carry(wallet, jar, step.replaceAll(' ', '-'), () => theJar(jar).getByRole('button', { name: 'Empty the jar' }).click(), 'The jar is emptied.');
          emptied.requests.forEach((text, index) => note(`${step}-request-${index}`, `${label}: Cashonize asked "${text}"; it was signed.`));
          note(`${step}-done`, `${label}: when the page said "The jar is emptied.", it listed the jar as "${emptied.listed}"`);
          transactionId = emptied.transactionId;
          break;
        } catch (error) {
          const message = (error as Error).message;
          if (!/does not take this yet/.test(message) || attempt > 20) throw error;
          note(`${step}-too-early`, `${label}: the network refused the signed transaction at first, and the page said: "${message}"`);
          await pause(MINUTE);
        }
      }
    }
    row(step, transactionId, ROW_NOTES[step] ?? '');
    note(`${step}-after`, `${label}: then the page lists the jar as "${await settled(true)}"`);
    await picture(jar, `${step.replaceAll(' ', '-')}-after`);
    finish(step);
  };

  /** Pays into the jar from the page. */
  const payIn = async (step: 'pay in' | 'pay in again', label: string, amount: string): Promise<void> => {
    const interrupted = state.begun.includes(step);
    begin(step);
    let transactionId = interrupted ? await unnamedAtJar() : undefined;
    if (transactionId === undefined) {
      const item = theJar(jar);
      if (!(await visible(item.locator('.panel input')))) await item.getByRole('button', { name: 'Pay in' }).first().click();
      await item.locator('.panel input').first().fill(amount);
      const paid = await carry(wallet, jar, step.replaceAll(' ', '-'), () => item.locator('.panel').getByRole('button', { name: 'Pay in' }).click(), 'Paid in.');
      paid.requests.forEach((text, index) => note(`${step}-request-${index}`, `${label}: Cashonize asked "${text}"; it was signed.`));
      note(`${step}-done`, `${label}: when the page said "Paid in.", it listed the jar as "${paid.listed}"`);
      transactionId = paid.transactionId;
    }
    row(step, transactionId, ROW_NOTES[step] ?? '');
    await settled(false);
    await theJar(jar).getByRole('button', { name: 'Close' }).click().catch(() => undefined);
    note(`${step}-after`, `${label}: then the page lists the jar as "${words(await theJar(jar).innerText())}"`);
    finish(step);
  };

  if (!isDone('empty') && !reached('empty')) await emptyTheJar('empty', 'Emptying');
  if (!isDone('pay in') && !reached('pay in')) await payIn('pay in', 'Paying in', PAY_IN_BCH);
  if (!isDone('empty again') && !reached('empty again')) await emptyTheJar('empty again', 'Emptying again');
  if (!isDone('pay in again') && !reached('pay in again')) await payIn('pay in again', 'Paying in again, with the rebuilt page', PAY_IN_AGAIN_BCH);
  if (!isDone('empty a third time') && !reached('empty a third time')) await emptyTheJar('empty a third time', 'Emptying a third time, with the rebuilt page');

  // check -------------------------------------------------------------
  if (!isDone('check') && !reached('check')) {
    begin('check');
    const jarState = state.jar;
    if (jarState === undefined) throw new Error('no jar');
    const left = await electrum.listUnspent(lockingOf(jarState.address), 'include');
    note('jar-empty', `On chain the jar address holds ${left.reduce((sum, entry) => sum + entry.valueSatoshis, 0n)} satoshis in ${left.length} outputs; its history has ${(await electrum.getHistory(lockingOf(jarState.address))).length} transactions.`);
    const emptiedLast = [...state.rows].reverse().find((entry) => entry.step.startsWith('empty'));
    if (emptiedLast !== undefined) {
      const keyBack = (await transactionOf(emptiedLast.transactionId)).outputs[0];
      const keyAddress = keyBack === undefined ? '?' : addressOf(keyBack.lockingBytecode, true);
      const atKey = keyBack === undefined ? [] : await electrum.listUnspent(keyBack.lockingBytecode, 'include');
      const held = atKey.some((entry) => entry.token !== undefined);
      note('key-held', `After the last withdrawal the key is still held by Cashonize: output 0 of that transaction, at \`${keyAddress}\`, is unspent and carries the key: ${held}.`);
    }
    await wallet.bringToFront();
    await wallet.locator('nav').getByText('Tokens', { exact: true }).click();
    await pause(4_000);
    // Cashonize's notices ("… transaction signed and returned to the dApp") are left out.
    const tokens = words(await wallet.locator('body').innerText())
      .replace(/^Wallet Addresses Tokens History Connect /, '')
      .replace(/ Savings Jar: transaction signed.*$/, '');
    note('cashonize-tokens', `Cashonize's Tokens screen lists the key: "${tokens.slice(0, 400)}"`);
    await picture(wallet, 'cashonize-tokens');
    finish('check');
  }

  // return ------------------------------------------------------------
  if (!isDone('return') && !reached('return')) {
    const interrupted = state.begun.includes('return');
    begin('return');
    const funderLocking = lockingOf(funderAddress);
    /** A payment to the funding address that the funding key did not make itself. */
    const returned = async (): Promise<string | undefined> => {
      const named = new Set(state.rows.map((entry) => entry.transactionId));
      for (const { transactionId } of (await electrum.getHistory(funderLocking)).reverse()) {
        if (named.has(transactionId)) continue;
        const transaction = await transactionOf(transactionId);
        const fromCashonize = await Promise.all(
          transaction.inputs.map(async (input) => {
            const previous = (await transactionOf(binToHex(input.outpointTransactionHash))).outputs[input.outpointIndex];
            return previous !== undefined && (await scannedAddresses()).has(binToHex(previous.lockingBytecode));
          }),
        );
        if (fromCashonize.every(Boolean)) return transactionId;
      }
      return undefined;
    };
    let transactionId = state.rows.find((entry) => entry.step === 'return')?.transactionId ?? (interrupted ? await returned() : undefined);
    if (transactionId === undefined) {
      await wallet.bringToFront();
      const home = await homeOf(wallet);
      note('return-before', `Before sending back, Cashonize shows a balance of ${home.balance}.`);
      await wallet.getByPlaceholder('address').first().fill(funderAddress);
      await wallet.locator('button.fillInMaxBch').first().click();
      await pause(1_000);
      const amount = await wallet.getByPlaceholder('amount').first().inputValue();
      await picture(wallet, 'return-form');
      await wallet.locator('input.primaryButton[value="Send"]').first().click();
      const confirm = wallet.locator('.q-dialog:visible').last();
      await confirm.waitFor({ timeout: MINUTE });
      await pause(1_000);
      note('return-confirm', `With the funding address and "max" (${amount} tBCH) in its send form, Cashonize asked: "${words(await confirm.innerText())}"`);
      await picture(wallet, 'return-confirm');
      await confirm.getByRole('button', { name: /Confirm|Send/i }).last().click();
      const deadline = Date.now() + 2 * MINUTE;
      while (transactionId === undefined && Date.now() < deadline) {
        await pause(5_000);
        transactionId = await returned();
      }
      if (transactionId === undefined) throw new Error('the payment back to the funding address was not found on chain');
    }
    row('return', transactionId, 'Cashonize\'s own send with "max": its coins without tokens to the funding address');
    const sent = wallet.locator('.q-dialog:visible', { hasText: 'Transaction Sent' }).last();
    if (await visible(sent)) {
      note('return-sent', `Cashonize then said: "${words(await sent.innerText()).replace(/ Add a personal note.*$/, '')}"`);
      await sent.getByRole('button', { name: 'Done' }).click();
    }
    finish('return');
  }

  if (isDone('return')) {
    // What is left at Cashonize's addresses, read from the chain.
    const left: string[] = [];
    for (const [locking, name] of await scannedAddresses()) {
      for (const entry of await electrum.listUnspent(hexToBin(locking), 'include')) {
        left.push(`${entry.valueSatoshis} satoshis${entry.token === undefined ? '' : ' with a token (the jar\'s key)'} at \`${addressOf(hexToBin(locking), entry.token !== undefined)}\` (${name}), output ${entry.transactionId}:${entry.index}`);
      }
    }
    await wallet.reload();
    const after = await homeOf(wallet);
    note('return-after', `At the end Cashonize shows a balance of ${after.balance}.`);
    await picture(wallet, 'return-after');
    note('left', left.length === 0 ? 'Nothing is left at Cashonize\'s first 30 addresses of either chain.' : `Left with Cashonize, from the chain: ${left.join('; ')}.`);
    state.funderAfter ??= pay('balance');
    // Payments to the funding address during the run that the run did not make.
    const named = new Set(state.rows.map((entry) => entry.transactionId));
    const fundedAt = (await electrum.getHistory(lockingOf(funderAddress))).findIndex((entry) => entry.transactionId === state.rows[0]?.transactionId);
    let elsewhere = 0n;
    const others: string[] = [];
    for (const { transactionId } of (await electrum.getHistory(lockingOf(funderAddress))).slice(fundedAt + 1)) {
      if (named.has(transactionId)) continue;
      const transaction = await transactionOf(transactionId);
      const received = transaction.outputs.filter((output) => binToHex(output.lockingBytecode) === binToHex(lockingOf(funderAddress))).reduce((sum, output) => sum + output.valueSatoshis, 0n);
      elsewhere += received;
      others.push(`${received} satoshis in \`${transactionId}\``);
    }
    let fees = 0n;
    for (const entry of state.rows) fees += (await sizeAndFee(entry.transactionId)).fee;
    const before = BigInt(satoshisIn(state.funderBefore ?? '0'));
    const now = BigInt(satoshisIn(state.funderAfter));
    note(
      'funder-after',
      `The funding address held ${before} satoshis before the run and holds ${now} after it${others.length === 0 ? '' : `; in between it also received ${others.join(', ')}, which are not part of this run`}. The run cost ${before + elsewhere - now} satoshis: ${fees} in fees for its ${state.rows.length} transactions and the ${before + elsewhere - now - fees} satoshis that stay with the jar's key.`,
    );
    const n = state.notes;
    const steps = ['fund the wallet', 'open the jar', 'empty', 'pay in', 'empty again', 'pay in again', 'empty a third time', 'return'].every((step) => state.rows.some((entry) => entry.step === step));
    const passed = steps && /: true\.$/.test(n['opening-address'] ?? '') && /holds 0 satoshis in 0 outputs/.test(n['jar-empty'] ?? '') && /carries the key: true\./.test(n['key-held'] ?? '');
    state.outcome ??= passed
      ? 'passed. Cashonize, unmodified, connected to the jar page and signed the opening of a jar, three withdrawals and two payments into it, each built by the page; the page offered no withdrawal before the date; the jar ends empty on chain at the address the contract gives, and the key stays with Cashonize.'
      : 'failed: see the observations above.';
    save();
  }
  await writeRecord();
  say('Done.');
} catch (error) {
  say(`STOPPED: ${(error as Error).stack ?? String(error)}`);
  for (const page of context?.pages() ?? []) await picture(page, 'stopped');
  await writeRecord().catch(() => undefined);
  process.exitCode = 1;
} finally {
  await context?.close().catch(() => undefined);
  server?.kill();
  await electrum.disconnect().catch(() => undefined);
}
process.exit();
