// The ParyonUSD course of stage 17 in browsers on the local node, with version 3 of the loan template and Paryon's loan
// service (docs/xo-service.md): the wallet page, the recoverer page and the loan page, driven as a person would, and the
// service app (apps/paryon-service) started beside the loan page as it runs in production. The loan page only offers
// the template; with its tab closed, the user carries the loan out from the wallet's own screens, the service joining
// each action. One action is then started from the loan page over `xo_v1`, to show that path too. The phone is lost,
// the wallet recovered to a new browser profile, which trusts the template again from the backup, has not spoken to the
// service until the user presses Connect, and closes the loan from the key's follow-ups.
//
// The earlier course, scripts/stage-17-loan-browser.ts, drives the page-driven flow of version 2 and is kept for chipnet.
//
//    1. Anna opens the recoverer's page and funds her balance       8. the user changes the interest rate, from the key
//    2. Anna sets up Grandma's wallet: the phone scans her code      9. the user repays part of the loan, from the key
//    3. the owner receives                                          10. the loan page adds collateral over xo_v1
//    4. the owner is paid for the loan, connects the wallet to      11. the phone is lost, with the loan open
//       the loan page, and trusts the template it offers; the       12. a new phone takes the wallet over and sweeps
//       Service card says what the contact at trust found          13. the new phone trusts the template from the backup;
//    5. the loan page's tab is closed; the user makes a loan key         the service is "Not asked yet" and was asked
//       from the template's Actions card                                 nothing; the user presses Connect under the key
//    6. Paryon is brought up to date if the service says so,         14. the new phone closes the loan from the key
//       and the user borrows from the "Waiting elsewhere" card      15. the coins go back to where they came from
//    7. the user adds collateral, from the key's follow-ups
//
// Every request the service answered is read from its log (one line per message: its kind, network, outcome and time;
// no address, token or value) and counted under the moment it came in; outside the moments in which the wallet may
// speak to the service (trust, Connect, an action) none may come. Every console error and refused request of every page
// is kept for the record.
//
// usage (from the repository's root, with the local node running and the pages built: deploy/preview.sh build):
//   npx tsx scripts/stage-17-loan-service-browser.ts [--screens] [--headed] [--until <step>] [--ports <base>] [--directory <name>] [--within <minutes>]
//
// Served on this machine as the other courses are (scripts/browser-course.ts), from port 8360 when --ports names none:
// the wallet at + 1, the recoverer at + 2, the loan page at + 4 (forwarding /service/ to the service at + 6), PUSD's
// registry at + 9, the stores at + 11 and + 12. The wallet page may also connect to the loan page's origin, where the
// service is (`--connect`). Profiles, the stores' data, the service's log and the log of the run are under
// .local-runs/stage-17-loan-service-browser/. The record is written to docs/runs/stage-17-loan-service-browser-local-node.md;
// with --screens, pictures at 390x844 and 1280x800 go to docs/screens/ as live-loan-service-*.png.
import { type ChildProcess, spawn } from 'node:child_process';
import { closeSync, existsSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';

import { binToHex, hexToBin, lockingBytecodeToCashAddress } from '@bitauth/libauth';
import { type Utxo, controllerScript, keyPairFromPrivateKey, p2pkhLockingBytecode } from '@grandmas-wallet/core';
import { type ParyonDeployment, localDeployment, localRegistry, paryonContracts } from '@grandmas-wallet/paryon';
import type { Locator, Page } from 'playwright';

import { collateralAtRatio } from '../packages/paryon/src/amounts.js';
import { LIMIT, LOAN, RECOVERER, WALLET, argument, chainShows, click, completeTakeover, config, course, firstSteps, newPhoneAsks, openDeskWorking, pageShows, recordFile, reviewEverything, root, see, sendAllOfBalance, untilChain, untilPage } from './browser-course.js';
import { type LedgerTransaction, addressOf, chainHeight, ledgerSection, runTransactions } from './browser-ledger.js';
import { type RequestLog, controllerLabels, flat, localPayerLocking, lockingOf, openFolds, recordRequests, requestsSection, textOf, walletKept, walletPlaces } from './browser-live.js';
import { withChainLock } from './run-key.js';

const until = Number(argument('until') ?? '99');
/** PUSD cents borrowed, the collateral's share of the debt, what is added from the wallet and from the page, what is repaid, the new rate. */
const DEBT = 200_00n;
const PERCENT = 125n;
const PRICE = 20_870n;
const COLLATERAL = collateralAtRatio(DEBT, PRICE, PERCENT);
const WALLET_ADD = 100_000n;
/** Added from the loan page, in BCH as typed there. */
const PAGE_ADD = '0.001';
const REPAY = 100_00n;
const NEW_RATE = 100;
/** What the first steps pay, and what the owner is paid for the loan: the collateral, both additions and the fees. */
const FIRST = { balance: 400_000, receive: 50_000 };
const FOR_LOAN = Number(COLLATERAL + WALLET_ADD) + 100_000 + 400_000;
const theCourse = course({ directory: 'stage-17-loan-service-browser', continuing: false, until, ports: 8360, need: FIRST.balance + FIRST.receive + 10_000 + FOR_LOAN + 20_000 });
const { work, started, lines, log, pay, mine, prepare, device, watchPage, close, shot, state, begin, elsewhere, keepStorage } = theCourse;
const LOAN_ORIGIN = new URL(LOAN).origin;
const SERVICE_PORT = Number(new URL(LOAN).port) + 2;
const SERVICE_URL = new URL('service/v1', LOAN).href;
const prefix = 'live-loan-service';
const cli = (...parameters: string[]): string => theCourse.run(`${root}deploy/regtest/regtest.sh`, ['cli', ...parameters]);
const noShot = async (): Promise<void> => undefined;

// ------------------------------------------------------------------ what the run keeps

interface ServiceMoment {
  moment: string;
  /** The service's log lines answered in it: kind, network, outcome, duration. */
  lines: string[];
}
const kept = {
  startHeight: await chainHeight(),
  deployer: binToHex(crypto.getRandomValues(new Uint8Array(32))),
  deployment: undefined as ParyonDeployment | undefined,
  registry: undefined as string | undefined,
  category: '',
  fundsAddress: '',
  labels: {} as Record<string, string>,
  facts: [] as string[],
  screens: [] as string[],
  moments: [] as ServiceMoment[],
  consoleSeen: [] as string[],
  defects: [] as string[],
};
const save = (): void => writeFileSync(`${work}loan.json`, JSON.stringify(kept, null, 1), { mode: 0o600 });
const fact = (line: string): void => {
  kept.facts.push(line);
  save();
  log(`   (${line.slice(0, 400)}${line.length > 400 ? '…' : ''})`);
};
const label = (transactionId: string, what: string): void => {
  if (/^[0-9a-f]{64}$/.test(transactionId) && kept.labels[transactionId] === undefined) kept.labels[transactionId] = what;
  save();
};
const picture = async (page: Page, name: string): Promise<void> => {
  await shot(page, `${prefix}-${name}`);
  if (!kept.screens.includes(name)) kept.screens.push(name);
  save();
};
const requests: RequestLog = recordRequests(`${work}requests.json`, false);

/** Console errors, warnings about the content security policy, and failed requests of a page: logged and kept for the record. */
const watchClosely = (name: string, page: Page, watched = false): void => {
  if (!watched) watchPage(name, page);
  page.on('console', (message) => {
    const text = message.text();
    if (message.type() === 'error' || /Content Security Policy|CORS|preflight/i.test(text)) kept.consoleSeen.push(`[${name}] ${message.type()}: ${text.slice(0, 400)}`);
  });
  page.on('pageerror', (error) => kept.consoleSeen.push(`[${name}] page error: ${error.message.slice(0, 300)}`));
  page.on('requestfailed', (request) => {
    const failure = request.failure()?.errorText ?? '';
    // A page that is left or closed aborts what it was loading; that is not a refusal.
    if (/ERR_ABORTED/.test(failure)) return;
    const line = `[${name}] request failed: ${request.method()} ${request.url().slice(0, 160)}: ${failure}`;
    kept.consoleSeen.push(line);
    log(`  ${line}`);
  });
};

// ------------------------------------------------------------------ Paryon's contracts on the local chain

const deployer = keyPairFromPrivateKey(hexToBin(kept.deployer));
const deployerLocking = p2pkhLockingBytecode(deployer.keyHash);
const REGISTRY_NAME = 'pusd-local-registry.json';
const registryGateway = (): string => `http://localhost:${Number(new URL(LOAN).port) + 5}/ipfs/`;
/** PUSD's registry, served as an IPFS gateway would; it ends with the run. */
const serveRegistry = async (): Promise<void> => {
  if (kept.registry === undefined) return;
  const file = hexToBin(kept.registry);
  const gateway = new URL(registryGateway());
  const server = createServer((request, response) => {
    const found = request.url === `${gateway.pathname}${REGISTRY_NAME}`;
    response.writeHead(found ? 200 : 404, { 'access-control-allow-origin': '*', 'content-type': 'application/json' }).end(found ? file : undefined);
  });
  await new Promise<void>((resolve) => server.listen(Number(gateway.port), '127.0.0.1', resolve));
  server.unref();
  log(`   PUSD's registry, published on chain, served at ${gateway.href}${REGISTRY_NAME}`);
};
/** Paryon's contracts as published, deployed on the local chain by the run, before the pages are served. */
const deploy = (): ParyonDeployment => {
  const addressOfBytecode = (bytecode: Uint8Array): string => {
    const made = lockingBytecodeToCashAddress({ prefix: 'bchreg', bytecode });
    if (typeof made === 'string') throw new Error(made);
    return made.address;
  };
  const hashes = withChainLock(() => {
    const made = JSON.parse(cli('generatetoaddress', '2', addressOfBytecode(deployerLocking))) as string[];
    cli('generatetoaddress', '100', addressOfBytecode(hexToBin(`76a914${'00'.repeat(20)}88ac`)));
    return made;
  });
  const coinbase = (hash: string): Utxo => {
    const block = JSON.parse(cli('getblock', hash, '2')) as { tx: { txid: string; vout: { value: number }[] }[] };
    const [first] = block.tx;
    if (first === undefined) throw new Error('no block reward');
    return { transactionHash: hexToBin(first.txid), index: 0, output: { lockingBytecode: deployerLocking, valueSatoshis: BigInt(Math.round((first.vout[0]?.value ?? 0) * 1e8)) } };
  };
  const registry = localRegistry(binToHex(coinbase(hashes[0] as string).transactionHash));
  kept.registry = binToHex(registry);
  const deployed = localDeployment({ funder: deployer, paryonCoin: coinbase(hashes[0] as string), factoryCoin: coinbase(hashes[1] as string), price: PRICE, period: 1, periodLengthBlocks: 10, registry: { file: registry, uri: `ipfs://${REGISTRY_NAME}` } });
  for (const built of deployed.transactions) {
    cli('sendrawtransaction', binToHex(built.encoded));
    label(built.transactionId, 'Paryon\'s contracts as published are deployed on the local chain (by the run, not the user)');
  }
  mine(1);
  kept.deployment = deployed.deployment;
  save();
  return deployed.deployment;
};

// ------------------------------------------------------------------ Paryon's service

const serviceLog = `${work}paryon-service.log`;
let serviceProcess: ChildProcess | undefined;
/** A line of the service's log for a message it answered. */
const REQUEST_LINE = /^(hello|possible|join|unreadable) \S+ \S+ \d+ms$/;
const serviceLines = (): string[] => (existsSync(serviceLog) ? readFileSync(serviceLog, 'utf8').split('\n').filter((line) => REQUEST_LINE.test(line)) : []);
/** The service app from its command line, with the configuration the pages are served with: the deployment, the loan page's address, the node's server. */
const startService = async (): Promise<void> => {
  writeFileSync(serviceLog, '');
  const out = openSync(serviceLog, 'a');
  const child = spawn(process.execPath, ['--import', 'tsx', `${root}apps/paryon-service/src/cli.ts`, '--config', `${work}config.json`, '--host', '127.0.0.1', '--port', String(SERVICE_PORT)], { cwd: root, stdio: ['ignore', out, out] });
  closeSync(out);
  serviceProcess = child;
  writeFileSync(`${work}paryon-service.pid`, String(child.pid));
  const end = Date.now() + 30_000;
  while (!/^serves regtest: template /m.test(readFileSync(serviceLog, 'utf8'))) {
    if (child.exitCode !== null) throw new Error(`Paryon's service ended at its start (${child.exitCode}): ${readFileSync(serviceLog, 'utf8').slice(-400)}`);
    if (Date.now() > end) throw new Error(`Paryon's service did not start within 30 s: ${readFileSync(serviceLog, 'utf8').slice(-400)}`);
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  const said = readFileSync(serviceLog, 'utf8');
  log(`   Paryon's service (process ${child.pid}) at http://127.0.0.1:${SERVICE_PORT}/service/v1, reached by the wallet at ${SERVICE_URL} through the loan page's server; ${/^serves regtest: (.*)$/m.exec(said)?.[1] ?? ''}`);
};
const stopService = async (): Promise<void> => {
  const child = serviceProcess;
  serviceProcess = undefined;
  if (child === undefined || child.exitCode !== null) return;
  const ended = new Promise((resolve) => child.once('exit', resolve));
  child.kill('SIGTERM');
  await Promise.race([ended, new Promise((resolve) => setTimeout(resolve, 5_000))]);
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
};
process.on('exit', () => serviceProcess?.kill('SIGKILL'));

/** The service's lines counted so far, under the moments they came in. */
let counted = 0;
/**
 * A moment in which the wallet may speak to the service: what the service answers from its start until the next moment
 * starts (or a check that none came) is counted under it.
 */
let open: ServiceMoment | undefined;
const moment = (name: string): void => {
  settle();
  open = { moment: name, lines: [] };
  kept.moments.push(open);
  save();
};
/** Lines that came since the last count go to the moment under way; with none under way, the run stops. */
const settle = (where?: string): void => {
  const all = serviceLines();
  const fresh = all.slice(counted);
  counted = all.length;
  if (fresh.length === 0) return;
  if (open === undefined) throw new Error(`the service answered ${fresh.length} requests ${where ?? ''} outside the moments in which the wallet may speak to it: ${fresh.join('; ')}`);
  open.lines.push(...fresh);
  save();
};
/** No moment under way from here: the service is to hear nothing until the next. */
const quiet = (where: string): void => {
  settle(where);
  if (open !== undefined) log(`   the service answered ${open.lines.length} requests in the moment "${open.moment}": ${open.lines.join('; ') || 'none'}`);
  open = undefined;
};

// ------------------------------------------------------------------ the wallet's screens

/** The wallet's Applications screen, the template's screen opened from its list. */
const templateScreen = async (wallet: Page): Promise<void> => {
  await wallet.goto(`${WALLET}apps`);
  const row = wallet.getByTestId('template-row').filter({ hasText: 'ParyonUSD loan' }).first();
  await pageShows(row, 'the template in the wallet\'s list of templates');
  await row.click();
  await pageShows(wallet.locator('.service-card'), 'the Service card on the template\'s screen');
};
/** The Service card as it reads, once it is not asking the service any more. */
const serviceCard = async (wallet: Page, expected: RegExp, what: string): Promise<string> => {
  const card = wallet.locator('.service-card');
  const state = card.locator('.service-state');
  // An exchange under way shows "Asking the service…"; it ends within the client's own bound.
  await untilChain(`the Service card to settle (${what})`, LIMIT.read, async () => !(await state.innerText()).includes('Asking the service') && expected.test(await state.innerText()));
  return textOf(card);
};

/** A starting action's button on the template's Actions card, or an action of a token waiting elsewhere. */
const actionButton = (scope: Locator, name: string): Locator => scope.getByRole('button', { name, exact: true }).first();

/**
 * The action screen the wallet opened: the values typed where it asks for them, the review read (the headline, the
 * template's words, "From the service"), pictured, ticked where it asks for the user's tick, and carried out. Returns the
 * transaction it sent. Every exchange with the service in it is counted under `moment`.
 */
const carryOut = async (wallet: Page, what: string, typed: Record<string, string>, name: string | undefined, tick = false): Promise<string> => {
  await pageShows(wallet.locator('h1, .page-head').filter({ hasText: what }), `the action screen of "${what}"`);
  if (Object.keys(typed).length > 0) {
    const form = wallet.locator('.card').filter({ hasText: 'What the action needs' }).first();
    await pageShows(form, `the values "${what}" asks for`);
    const asked = await textOf(form);
    fact(`"${what}": the wallet asks for: "${asked}"`);
    if (name !== undefined) await picture(wallet, `${name}-form`);
    for (const [variable, value] of Object.entries(typed)) await wallet.locator(`#value-${variable}`).fill(value);
    await click(wallet, /^Review$/);
  }
  const review = wallet.locator('.request-card').filter({ hasText: 'Check and carry out' }).first();
  const refused = wallet.getByTestId('refusal').first();
  // The review is worked out with the service: its exchange is bounded by the client; the wait here a little longer.
  await chainShows(review.or(refused), `the wallet's review of "${what}", worked out with the service`, LIMIT.read);
  if (await refused.isVisible()) throw new Error(`the wallet refused "${what}": ${await textOf(wallet.locator('.refused-card, .request-card').first())}`);
  const carry = review.getByRole('button', { name: 'Carry it out' });
  await pageShows(carry, `"Carry it out" on the review of "${what}"`);
  const box = review.locator('input[type=checkbox]');
  const headline = await textOf(review.locator('.review-summary')).catch(() => '(none)');
  const words = await textOf(review.locator('.their-words')).catch(() => '(none)');
  const fromService = (await review.locator('.from-service').count()) > 0 ? await textOf(review.locator('.from-service')) : '(no part from the service)';
  const cautions = flat(await review.locator(':is(.notice, .destroyed-warning, .controls):not(:is(.notice, .destroyed-warning, .controls) *)').allInnerTexts().then((texts) => texts.join(' | ')).catch(() => ''));
  fact(`"${what}": the review's headline (the wallet's own figures): "${headline}"`);
  fact(`"${what}": in the template's words: "${words}"`);
  fact(`"${what}": from the service: "${fromService}"`);
  if (cautions !== '') fact(`"${what}": what asks for care: "${cautions}"`);
  if (name !== undefined) await picture(wallet, name);
  if (tick) {
    await pageShows(box, `the box to tick on the review of "${what}"`);
    if (await carry.isEnabled()) throw new Error(`"Carry it out" works before the box is ticked (${what})`);
    await box.first().check();
    log('   "Carry it out" was off until the box was ticked; ticked');
  } else if ((await box.count()) > 0) throw new Error(`the wallet asks for a tick on "${what}", where none was expected`);
  await untilPage(() => carry.isEnabled(), `"Carry it out" enabled (${what})`);
  await openFolds(review);
  log(`   "${what}", every fold opened: "${(await textOf(review)).slice(0, 1500)}"`);
  await carry.click();
  // What the screen says while it carries the action out, each change with its time: a screen that says nothing for
  // long would look frozen.
  const begun = Date.now();
  const said: string[] = [];
  const done = wallet.locator('.card').filter({ has: wallet.getByTestId('action-transaction') }).first();
  const failed = wallet.locator('.refused-card').first();
  await untilChain(`"${what}" to be carried out (the service's join, signing, sending)`, LIMIT.read, async () => {
    const status = flat(await wallet.locator('main .notice:has(.spinner), main .notice.bad, main [role=status]').allInnerTexts().then((texts) => texts.join(' | ')).catch(() => ''));
    const entry = status === '' ? '(nothing said)' : status;
    if (said.length === 0 || !said[said.length - 1]?.endsWith(`: ${entry}`)) said.push(`${((Date.now() - begun) / 1000).toFixed(1)} s: ${entry}`);
    return (await done.isVisible()) || (await failed.isVisible());
  }, 250);
  log(`   what the screen said while carrying "${what}" out: ${said.join('; ')}`);
  if (await failed.isVisible()) throw new Error(`"${what}" was not carried out: ${await textOf(failed)}`);
  const transactionId = (await done.getByTestId('action-transaction').getAttribute('data-value')) ?? '';
  fact(`"${what}" was carried out in ${((Date.now() - begun) / 1000).toFixed(1)} s from "Carry it out" (the screen said: ${said.join('; ')}); transaction \`${transactionId}\`. The wallet: "${await textOf(done)}"`);
  return transactionId;
};

/** The key's row under Tokens on the Applications screen. */
const keyRow = (wallet: Page): Locator => wallet.locator('li.token.position').filter({ has: wallet.locator(`.token-id [title="${kept.category}"]`) }).first();
/** An action from the key's follow-ups under Tokens, opened. */
const fromTheKey = async (wallet: Page, action: string): Promise<void> => {
  await wallet.goto(`${WALLET}apps`);
  const row = keyRow(wallet);
  await chainShows(row, 'the wallet to list the loan key under Tokens', LIMIT.read);
  const button = actionButton(row, action);
  await chainShows(button, `"${action}" among the key's follow-ups`, LIMIT.read);
  await untilPage(() => button.isEnabled(), `"${action}" enabled under the key`);
  await button.click();
};

// ------------------------------------------------------------------ the loan page

/** Connect the wallet to the loan page open in another tab: the page's address is pasted into the wallet. */
const connect = async (wallet: Page, loanPage: Page): Promise<void> => {
  await loanPage.goto(LOAN);
  const address = loanPage.locator('.value-text[data-value^="wiz:"]').first();
  const resumed = loanPage.getByText('Your loans').first();
  await pageShows(address.or(resumed), 'the loan page\'s connection address, or the session it had before');
  if (!(await address.isVisible())) {
    log('   the loan page took up the session it had with this wallet before');
    return;
  }
  const uri = (await address.getAttribute('data-value')) ?? '';
  log(`   the loan page shows its connection address (${uri.length} characters) and waits for a wallet`);
  await wallet.goto(`${WALLET}apps`);
  await click(wallet, 'Paste a link instead');
  await wallet.getByLabel('Connection link').fill(uri);
  await click(wallet, /^Connect$/);
  const row = wallet.locator('ul.connections li').filter({ has: wallet.getByText('Connected', { exact: true }) }).first();
  await pageShows(row, 'the wallet\'s Applications screen to say "Connected"');
  log(`   the wallet's Applications screen: "${await textOf(row.locator('.connection-name'))}"; "Connected"`);
  await see(loanPage, 'Your loans');
};

/** The wallet's review of a page's request: read, pictured, approved. Returns the transaction it sent. */
const approveRequest = async (wallet: Page, what: string, name: string | undefined): Promise<string> => {
  await wallet.goto(`${WALLET}apps`).catch(() => undefined);
  const request = wallet.locator('.request-card').filter({ hasText: 'asks for your decision' }).first();
  await pageShows(request, `the wallet to show the loan page's request (${what})`);
  const approve = request.getByRole('button', { name: 'Approve' });
  // The review is worked out with the service before Approve is offered.
  await chainShows(approve.or(request.getByTestId('refusal')), `the review of the page's request, worked out with the service (${what})`, LIMIT.read);
  if (!(await approve.isVisible())) throw new Error(`the wallet refused the page's request (${what}): ${await textOf(request)}`);
  await untilPage(() => approve.isEnabled(), `Approve enabled on the request (${what})`);
  fact(`${what}: the wallet's review of the page's request, as it first appears: "${await textOf(request)}"`);
  const fromService = (await request.locator('.from-service').count()) > 0 ? await textOf(request.locator('.from-service')) : '(no part from the service)';
  fact(`${what}: from the service: "${fromService}"`);
  if (name !== undefined) await picture(wallet, name);
  await openFolds(request);
  await approve.click();
  const outcome = wallet.locator('.request-card').filter({ hasText: /Done:|Not carried out:/ }).first();
  await chainShows(outcome, `"Done:" or "Not carried out:" after approving (${what})`, LIMIT.read);
  const title = await textOf(outcome.locator('h2, .card-title'));
  if (!title.startsWith('Done')) throw new Error(`${what} was not carried out: ${await textOf(outcome)}`);
  const transactionId = (await outcome.getByTestId('action-transaction').getAttribute('data-value')) ?? '';
  log(`   approved; the wallet: "${title}", transaction ${transactionId}`);
  await outcome.getByRole('button', { name: 'Dismiss' }).click();
  return transactionId;
};

// ------------------------------------------------------------------ the run

const steps = async (): Promise<void> => {
  const reached = await firstSteps(theCourse, noShot, async (phone) => keepStorage(phone), FIRST);
  if (reached === undefined) return;
  const { old, recoverer } = reached;
  watchClosely('old-phone', old.page, true);
  watchClosely('recoverer', recoverer.page, true);
  kept.fundsAddress = await recoverer.page.getByTestId('funds-address').first().getAttribute('data-value').catch(() => '') ?? '';
  save();
  const wallet = old.page;

  // 4 ------------------------------------------------------------------
  if (!begin('The owner is paid for the loan, connects the wallet to the loan page, and trusts the template it offers')) return;
  await wallet.getByRole('link', { name: 'Receive' }).first().click();
  const receiving = (await wallet.getByTestId('receive-address').first().getAttribute('data-value')) ?? '';
  log(`   ${pay(receiving, FOR_LOAN)}`);
  quiet('before the loan page was opened');
  const loanTab = await old.context.newPage();
  watchClosely('old-phone, loan tab', loanTab);
  await connect(wallet, loanTab);
  const pageText = await textOf(loanTab.locator('main'));
  fact(`The loan page, connected: "${pageText.slice(0, 1500)}"`);
  await picture(loanTab, 'page-connected');
  const offer = loanTab.getByRole('button', { name: 'Show the loans my wallet holds' });
  await pageShows(offer, 'the loan page\'s offer of its template ("Show the loans my wallet holds")');
  quiet('before the template was offered');
  await offer.click();
  await wallet.goto(`${WALLET}apps`);
  const offerCard = wallet.locator('.offer-card').first();
  await pageShows(offerCard, 'the wallet to show the loan page\'s offer of its template');
  fact(`The wallet shows the page's offer: "${(await textOf(offerCard)).slice(0, 800)}"`);
  await picture(wallet, 'offer');
  moment('the user trusts the template');
  await click(wallet, 'Trust this template');
  await pageShows(offerCard, 'the offer to leave the wallet\'s screen once trusted', 'hidden');
  await templateScreen(wallet);
  const right = await textOf(wallet.locator('.service-card'));
  fact(`The Service card right after trusting, before the contact at trust ended: "${right}"`);
  const card = await serviceCard(wallet, /Connected|Not reached|Not asked yet|not usable/, 'the contact at trust');
  fact(`The Service card once the contact at trust ended: "${card}"`);
  if (!/Connected/.test(card)) throw new Error(`the service was not reached when the template was trusted: "${card}"`);
  await picture(wallet, 'template-after-trust');
  const actions = wallet.locator('.template-actions-card');
  await pageShows(actions, 'the template\'s Actions card');
  fact(`The Actions card: "${await textOf(actions)}"`);
  fact(`The template card: "${(await textOf(wallet.locator('.template-card'))).slice(0, 600)}"`);
  quiet('after the contact at trust');

  // 5 ------------------------------------------------------------------
  if (!begin('The loan page\'s tab is closed; the user makes a loan key from the template\'s Actions card')) return;
  await keepStorage(old);
  await loanTab.close();
  log('   the loan page\'s tab is closed: from here the wallet carries the loan out with the service alone');
  moment('the user makes a loan key');
  await actionButton(actions, 'Make a loan key').click();
  const made = await carryOut(wallet, 'Make a loan key', {}, 'key-review', true);
  label(made, 'The owner\'s phone makes a loan key from the template\'s Actions card, with the user\'s tick, joined by the service: the key waits in Paryon\'s contract');
  await picture(wallet, 'key-done');
  await wallet.getByRole('button', { name: 'Back to the template' }).click();
  mine(1);

  // 6 ------------------------------------------------------------------
  if (!begin('Paryon is brought up to date if the service says so; the user borrows 200.00 PUSD from the "Waiting elsewhere" card')) return;
  const waiting = wallet.locator('.waiting-card');
  // The template's screen, opened again after the action: what it lists then.
  await chainShows(waiting, 'the "Waiting elsewhere" card with the key made', LIMIT.read).catch(async (error: unknown) => {
    fact(`After "Make a loan key" and "Back to the template", the template's screen showed no "Waiting elsewhere" card: "${(await textOf(wallet.locator('main'))).slice(0, 800)}"`);
    throw error;
  });
  fact(`The "Waiting elsewhere" card after the key was made: "${await textOf(waiting)}"`);
  const move = actionButton(wallet.locator('.template-actions-card'), 'Bring Paryon up to date');
  const moveNote = await textOf(wallet.locator('.template-actions-card .offered-action').filter({ hasText: 'Bring Paryon up to date' }));
  fact(`"Bring Paryon up to date" on the Actions card: "${moveNote}", ${(await move.isEnabled()) ? 'enabled' : 'not offered now'}`);
  await picture(wallet, 'template-waiting');
  quiet('after the key was made');
  if (await move.isEnabled()) {
    moment('the user brings Paryon up to date');
    await move.click();
    const moved = await carryOut(wallet, 'Bring Paryon up to date', {}, 'move-review');
    label(moved, 'The owner\'s phone brings Paryon\'s Borrowing contract up to the current period, from the Actions card, joined by the service');
    await wallet.getByRole('button', { name: 'Back to the template' }).click();
    mine(1);
    quiet('after Paryon was brought up to date');
  }
  moment('the user borrows');
  await templateScreen(wallet);
  const borrow = actionButton(wallet.locator('.waiting-card'), 'Borrow PUSD');
  await chainShows(borrow, '"Borrow PUSD" on the "Waiting elsewhere" card', LIMIT.read);
  await untilPage(() => borrow.isEnabled(), '"Borrow PUSD" enabled');
  await borrow.click();
  const borrowed = await carryOut(wallet, 'Borrow PUSD', { debt: String(DEBT), collateral: String(COLLATERAL), startingRate: '0' }, 'borrow-review');
  label(borrowed, `The owner's phone borrows ${DEBT / 100n}.00 PUSD from the "Waiting elsewhere" card, joined by the service: the collateral into Paryon's loan contract, the key and the PUSD to the wallet`);
  await picture(wallet, 'borrow-done');
  await wallet.getByRole('button', { name: 'Back to the template' }).click();
  mine(1);
  // The key under Tokens, with its follow-ups.
  await wallet.goto(`${WALLET}apps`);
  const anyKey = wallet.locator('li.token.position').filter({ hasText: 'ParyonUSD loan' }).first();
  await chainShows(anyKey, 'the wallet to list the loan key under Tokens', LIMIT.read);
  kept.category = (await anyKey.locator('.token-id [title]').first().getAttribute('title')) ?? '';
  save();
  const row = keyRow(wallet);
  await chainShows(actionButton(row, 'Change the collateral'), 'the key\'s follow-ups under Tokens', LIMIT.read);
  fact(`Under Tokens after borrowing, the key: "${await textOf(row)}". The key's category is \`${kept.category}\`.`);
  const pusd = wallet.locator('li.token').filter({ hasText: 'PUSDLOCAL' }).first();
  if (await pusd.isVisible()) fact(`The borrowed PUSD under Tokens: "${await textOf(pusd)}"`);
  await picture(wallet, 'key-follow-ups');
  quiet('after borrowing');

  // 7 ------------------------------------------------------------------
  if (!begin('The user adds collateral, from the key\'s follow-ups')) return;
  moment('the user adds collateral');
  await fromTheKey(wallet, 'Change the collateral');
  const addedTx = await carryOut(wallet, 'Change the collateral', { collateral: String(COLLATERAL + WALLET_ADD) }, 'manage-review');
  label(addedTx, `The owner's phone adds ${WALLET_ADD} satoshis of collateral from the key's follow-ups, joined by the service: the key back to the address it came from`);
  await wallet.getByRole('button', { name: 'Back to the tokens' }).click();
  mine(1);
  quiet('after collateral was added');

  // 8 ------------------------------------------------------------------
  if (!begin('The user changes the interest rate, from the key\'s follow-ups')) return;
  moment('the user changes the interest rate');
  await fromTheKey(wallet, 'Change the interest rate');
  const rated = await carryOut(wallet, 'Change the interest rate', { interestRate: String(NEW_RATE) }, 'interest-review');
  label(rated, `The owner's phone changes the loan's interest rate to ${NEW_RATE} per 10,000,000 per period from the key's follow-ups, joined by the service`);
  await wallet.getByRole('button', { name: 'Back to the tokens' }).click();
  mine(1);
  quiet('after the interest rate was changed');

  // 9 ------------------------------------------------------------------
  if (!begin('The user repays part of the loan, from the key\'s follow-ups')) return;
  moment('the user repays part of the loan');
  await fromTheKey(wallet, 'Repay part of the loan');
  const repaid = await carryOut(wallet, 'Repay part of the loan', { repayAmount: String(REPAY) }, 'repay-review');
  label(repaid, `The owner's phone repays ${REPAY / 100n}.00 PUSD from the key's follow-ups, joined by the service`);
  await wallet.getByRole('button', { name: 'Back to the tokens' }).click();
  mine(1);
  await wallet.goto(`${WALLET}apps`);
  await chainShows(keyRow(wallet), 'the key under Tokens after the repayment', LIMIT.read);
  // The follow-ups as the service says after the repayment: 100.00 PUSD owed, no part repayment any more.
  await untilChain('the key\'s follow-ups to leave out "Repay part of the loan"', LIMIT.read, async () => !(await actionButton(keyRow(wallet), 'Repay part of the loan').isVisible()) || !(await actionButton(keyRow(wallet), 'Repay part of the loan').isEnabled())).catch(() => log('   the key still offers "Repay part of the loan" after the repayment'));
  fact(`Under Tokens after the repayment, the key: "${await textOf(keyRow(wallet))}"`);
  await picture(wallet, 'key-after-repay');
  quiet('after part of the loan was repaid');

  // 10 ------------------------------------------------------------------
  if (!begin('The loan page adds collateral over xo_v1: the page asks, the wallet\'s review shows the service\'s part')) return;
  const pageTab = await old.context.newPage();
  watchClosely('old-phone, loan tab again', pageTab);
  moment('the loan page asks for an action (and connects again)');
  await connect(wallet, pageTab);
  const loan = pageTab.getByTestId('loan').first();
  await chainShows(loan, 'the loan page to list the loan from the key the wallet reports', LIMIT.read);
  fact(`The loan page lists: "${await textOf(loan)}"`);
  await picture(pageTab, 'page-loan');
  // The interest-rate panel, as the page shows it, not used here.
  await loan.getByRole('button', { name: 'Change the interest rate' }).click();
  const interestPanel = pageTab.locator(`[id^="interest-"]`).first();
  await pageShows(interestPanel, 'the loan page\'s interest-rate panel');
  fact(`The loan page's interest-rate panel: "${await textOf(loan.locator('.panel'))}"`);
  await picture(pageTab, 'page-interest-panel');
  await loan.getByRole('button', { name: 'Change the collateral' }).click();
  await pageTab.locator(`[id^="collateral-"]`).first().fill(PAGE_ADD);
  await loan.getByRole('button', { name: /^Add$/ }).click();
  const pageAdded = await approveRequest(wallet, `Adding ${PAGE_ADD} BCH of collateral, asked by the loan page`, 'page-review');
  label(pageAdded, `The owner's phone adds ${PAGE_ADD} BCH of collateral on the loan page's request over xo_v1, joined by the service`);
  const pageSaid = pageTab.getByText(/collateral is changed/i).first();
  await chainShows(pageSaid, 'the loan page to say the collateral is changed', LIMIT.read);
  fact(`The loan page then said: "${await textOf(pageSaid)}"`);
  mine(1);
  await keepStorage(old);
  quiet('after the page-driven action');

  // 11 ------------------------------------------------------------------
  if (!begin('The phone is lost, with the loan open')) return;
  await close(old);
  quiet('when the phone was lost');
  const atLoss = serviceLines().length;
  log(`   the old phone's profile, with its wallet tab and its loan tab, is no longer opened; the service had answered ${atLoss} requests`);

  // 12 ------------------------------------------------------------------
  if (!begin('A new phone takes the wallet over with Anna\'s help, and sweeps')) return;
  const next = await device('new-phone');
  watchClosely('new-phone', next.page, true);
  requests.watch(next.context);
  await newPhoneAsks(theCourse, recoverer, '', noShot, next);
  await completeTakeover(theCourse, recoverer, next, noShot);
  await keepStorage(next);
  quiet('during the recovery');

  // 13 ------------------------------------------------------------------
  if (!begin('The new phone trusts the template from the backup; the service is "Not asked yet"; the user presses Connect under the key')) return;
  const phone = next.page;
  await phone.goto(`${WALLET}apps`);
  const swept = phone.locator('li.token').filter({ has: phone.locator(`.token-id [title="${kept.category}"]`) }).first();
  const trust = swept.getByRole('button', { name: 'Trust this template' });
  await chainShows(trust, 'the new phone to list the swept key, with "Trust this template"', LIMIT.read);
  fact(`On the new phone, after the recovery, the swept key: "${await textOf(swept)}"`);
  await trust.click();
  await see(phone, 'A template from your backup');
  await click(phone, 'Trust this template');
  // The wallet trusts it, stores it in the new phone's backup and says so: the screen is left only then.
  await see(phone, 'The template is trusted on this phone.');
  await templateScreen(phone);
  fact(`The new phone's template card once trusted from the backup: "${(await textOf(phone.locator('.template-card'))).replace(/^.*?(Trusted since)/, '$1')}"`);
  const restored = await serviceCard(phone, /Not asked yet/, 'the template restored from the backup');
  quiet('after the new phone trusted the template from the backup');
  const asked = serviceLines().length - atLoss;
  const toService = requests.urls().filter((url) => url.startsWith(SERVICE_URL));
  fact(`On the new phone the template restored from the backup shows the Service card: "${restored}". Since the old phone was lost the service has answered ${asked} requests, and the new phone's browser has sent ${toService.length} to ${SERVICE_URL}.`);
  if (asked !== 0 || toService.length !== 0) throw new Error('the service was asked before the user pressed Connect on the new phone');
  await picture(phone, 'new-phone-template');
  const newActions = phone.locator('.template-actions-card');
  await untilPage(async () => !(await newActions.innerText()).includes('Reading its actions'), 'the new phone\'s Actions card to be read');
  fact(`The new phone's Actions card: "${await textOf(newActions)}"`);
  await phone.goto(`${WALLET}apps`);
  const key = keyRow(phone);
  await chainShows(key, 'the new phone to list the key under the template\'s name', LIMIT.read);
  const connectButton = key.getByRole('button', { name: 'Connect', exact: true });
  await chainShows(connectButton, 'Connect under the key on the new phone', LIMIT.read);
  fact(`Under Tokens on the new phone, before Connect: "${await textOf(key)}"`);
  await picture(phone, 'new-phone-key-connect');
  moment('the user presses Connect on the new phone');
  await connectButton.click();
  await chainShows(actionButton(keyRow(phone), 'Repay and close the loan'), 'the key\'s follow-ups after Connect', LIMIT.read);
  fact(`Under Tokens on the new phone, after Connect: "${await textOf(keyRow(phone))}"`);
  await picture(phone, 'new-phone-key-follow-ups');
  quiet('after Connect on the new phone');

  // 14 ------------------------------------------------------------------
  if (!begin('The new phone closes the loan from the key\'s follow-ups')) return;
  moment('the user closes the loan on the new phone');
  await fromTheKey(phone, 'Repay and close the loan');
  const closed = await carryOut(phone, 'Repay and close the loan', {}, 'close-review');
  label(closed, 'The new phone closes the loan from the key\'s follow-ups, joined by the service: the debt repaid and destroyed, the collateral and the key to the new seed');
  await phone.getByRole('button', { name: 'Back to the tokens' }).click();
  mine(1);
  await phone.goto(`${WALLET}apps`);
  await chainShows(keyRow(phone), 'the key under Tokens after closing', LIMIT.read);
  await untilChain('the key to show the loan closed, or no follow-ups', LIMIT.read, async () => !(await actionButton(keyRow(phone), 'Repay and close the loan').isVisible())).catch(() => log('   the key still offers "Repay and close the loan" after the loan was closed'));
  fact(`Under Tokens on the new phone after closing: "${await textOf(keyRow(phone))}"`);
  await picture(phone, 'new-phone-closed');
  quiet('after the loan was closed');

  // 15 ------------------------------------------------------------------
  if (!begin('The coins go back to where they came from')) return;
  const to = elsewhere();
  await phone.goto(`${WALLET}send`);
  await phone.getByLabel('To').fill(to);
  await reviewEverything(phone);
  const everything = phone.getByText('Arrives', { exact: true });
  const nothing = phone.getByText('Too little to send');
  await pageShows(everything.or(nothing), 'the review of sending everything, or "Too little to send"');
  if (await everything.isVisible()) {
    await click(phone, /^Send$/);
    await see(phone, 'Sent');
    log(`   the new phone sent everything to ${to}; tokens stay where they are`);
  }
  mine(1);
  await openDeskWorking(theCourse, recoverer);
  const returned = await sendAllOfBalance(recoverer.page, to);
  log(returned === undefined ? '   Anna\'s balance holds nothing' : `   Anna sent her balance back: ${returned}`);
  mine(1);
  await keepStorage(next);
};

// ------------------------------------------------------------------ the record

const KIND = /^(\S+) \S+ (\S+) (\d+)ms$/;
const momentRows = (): string[] =>
  kept.moments.map((entry) => {
    const kinds = new Map<string, { count: number; outcomes: Set<string>; ms: number[] }>();
    for (const line of entry.lines) {
      const [, kind = '?', outcome = '?', ms = '0'] = KIND.exec(line) ?? [];
      const known = kinds.get(kind) ?? { count: 0, outcomes: new Set<string>(), ms: [] };
      known.count += 1;
      known.outcomes.add(outcome);
      known.ms.push(Number(ms));
      kinds.set(kind, known);
    }
    const each = [...kinds].map(([kind, { count, outcomes, ms }]) => `${count} ${kind} (${[...outcomes].join(', ')}; ${ms.join(', ')} ms)`).join('; ');
    return `| ${entry.moment} | ${entry.lines.length} | ${each === '' ? 'none' : each} |`;
  });

const writeRecord = async (outcome: string): Promise<void> => {
  const wallet = walletKept(work, ['old-phone', 'new-phone'], WALLET);
  const places = await walletPlaces(wallet);
  const identity = wallet.identity;
  const controller = identity === undefined ? '' : binToHex(controllerScript(hexToBin(identity)).lockingBytecode);
  const outside = lockingOf(elsewhere());
  const funds = kept.fundsAddress === '' ? '' : lockingOf(kept.fundsAddress);
  const payer = localPayerLocking();
  const ownKey = theCourse.keyLocking();
  const deployerHex = binToHex(deployerLocking);
  const ledger = await runTransactions(kept.startHeight, [...places.keys(), controller, funds, ownKey, deployerHex]);
  const paryonPlaces = new Map<string, string>();
  if (kept.deployment !== undefined) {
    for (const [name, value] of Object.entries(paryonContracts(kept.deployment))) {
      const bytecode = (value as { lockingBytecode?: Uint8Array } | undefined)?.lockingBytecode;
      if (bytecode instanceof Uint8Array) paryonPlaces.set(binToHex(bytecode), `Paryon's ${name} contract`);
    }
  }
  for (const entry of wallet.activity) label(entry.transactionId, `${entry.who === 'old-phone' ? 'The owner\'s phone' : 'The new phone'}: ${entry.what}`);
  const placeOf = (lockingBytecode: string): string | undefined =>
    lockingBytecode === controller ? 'the wallet\'s controller (its identity token)' : lockingBytecode === outside ? `the outside address the coins went back to (${addressOf(outside)})` : lockingBytecode === funds ? 'the recoverer\'s balance' : lockingBytecode === ownKey ? 'the run\'s own key (`scripts/run-key.ts`)' : lockingBytecode === payer ? 'the local payer (`scripts/local-pay.ts`)' : lockingBytecode === deployerHex ? 'the key that deployed Paryon\'s contracts, which gets Paryon\'s fee' : (paryonPlaces.get(lockingBytecode) ?? places.get(lockingBytecode));
  const ofController = await controllerLabels(identity);
  const labelOf = (transaction: LedgerTransaction): string | undefined => {
    const named = kept.labels[transaction.transactionId] ?? ofController.get(transaction.transactionId);
    if (named !== undefined) return named;
    const fromFunds = funds !== '' && transaction.inputs.some((input) => input.lockingBytecode === funds);
    if (fromFunds && transaction.outputs.some((output) => output.lockingBytecode === outside)) return 'The recoverer sends her balance back';
    if (fromFunds) return 'Paid from the recoverer\'s balance';
    if (ownKey !== '' && transaction.inputs.some((input) => input.lockingBytecode === ownKey)) return 'The run\'s key pays';
    if (transaction.inputs.some((input) => input.lockingBytecode === payer)) return 'The local payer pays the run\'s key';
    return undefined;
  };
  const toPage = requests.urls().filter((url) => url.startsWith(LOAN_ORIGIN));
  const record = recordFile('stage-17-loan-service-browser-local-node.md');
  writeFileSync(
    record,
    [
      '# Stage 17 in browsers on the local node: a ParyonUSD loan carried out from the wallet\'s screens with Paryon\'s loan service, through the loss of a phone',
      '',
      `Written by \`scripts/stage-17-loan-service-browser.ts ${process.argv.slice(2).join(' ')}\` on ${new Date(started).toISOString().slice(0, 16).replace('T', ' ')} UTC. Chromium (Playwright), one browser profile per device kept on disk under \`${work.slice(root.length)}\`. The pages are this checkout's production builds (\`deploy/preview.sh build\`) served by \`deploy/serve.mjs\` with the content security policy at ${WALLET}, ${RECOVERER} and ${LOAN}, against the regtest node, with two backup stores and a relay for the sessions between the pages, all on this machine. Paryon's contracts as published were deployed on the local chain by the run (the price at $${(Number(PRICE) / 100).toFixed(2)}, periods of 10 blocks) and named to the loan page and to Paryon's service app in their configuration. The service app (\`apps/paryon-service\`) ran from its command line on 127.0.0.1:${SERVICE_PORT}, with the same configuration file as the pages; the loan page's server passed \`/service/\` to it (\`--forward\`), so that the template's service is at ${SERVICE_URL}, beside the loan page, as in production. The wallet page was allowed to connect to the loan page's origin (\`--connect ${LOAN_ORIGIN}\`), and gave the template's service to its client as one of a chain of its own (\`local\`, where an \`http:\` address is allowed). The loan page only offered the template; with its tab closed, every action but one was carried out from the wallet's own screens. Times in the log are seconds since the start.`,
      '',
      `Outcome: ${outcome}`,
      '',
      ...(kept.deployment === undefined ? [] : [`Paryon's deployment on the local chain: PUSD \`${kept.deployment.tokenIds.paryon}\`. The loan key: \`${kept.category}\`. The loan: ${DEBT / 100n}.00 PUSD against ${COLLATERAL} satoshis (${PERCENT}% at the stored price); ${WALLET_ADD} satoshis added from the wallet, ${PAGE_ADD} BCH from the page; the rate changed to ${NEW_RATE} per 10,000,000 per period; ${REPAY / 100n}.00 PUSD repaid; the rest repaid when the new phone closed the loan.`, '']),
      'What the run showed (the screens\' texts as read, with real data):',
      '',
      ...kept.facts.map((line) => `- ${line}`),
      '',
      '## Requests to the service, by moment',
      '',
      'From the service\'s own log, which holds one line per message (its kind, network, outcome and duration) and nothing else. A moment runs from its start to the next one; between moments the run checked that no line came.',
      '',
      '| Moment | Requests | What they were |',
      '| --- | --- | --- |',
      ...momentRows(),
      '',
      `In all: ${serviceLines().length} requests.`,
      '',
      '## Console errors and refused requests',
      '',
      ...(kept.consoleSeen.length === 0 ? ['None: no page logged an error, a content security policy refusal or a failed request in the whole run.'] : kept.consoleSeen.map((line) => `- ${line}`)),
      '',
      '## The new phone\'s requests',
      '',
      ...requestsSection(requests, LOAN_ORIGIN, 'the loan page\'s origin (the service is under it)', toPage, 'The new phone never opened the loan page; requests to its origin are the wallet\'s to the service, which come only after the user pressed Connect.'),
      '## Transactions and coins',
      '',
      `Read from the local node after the run: every transaction in the blocks after height ${kept.startHeight}, where the run started, or in the node's pool, that touches an address of the run.`,
      '',
      ...ledgerSection(ledger, labelOf, placeOf),
      ...(kept.screens.length === 0 ? [] : ['## Pictures', '', `In \`docs/screens/\`, each at 390×844 (\`-phone\`) and 1280×800 (\`-desktop\`): ${kept.screens.map((name) => `\`${prefix}-${name}\``).join(', ')}.`, '']),
      '## Log',
      '',
      '```',
      ...lines,
      '```',
      '',
    ].join('\n'),
  );
  log(`record written to ${record.slice(root.length)}`);
};

try {
  const deployment = deploy();
  await serveRegistry();
  await prepare(
    ['wallet', 'recoverer', 'loan'],
    { paryon: deployment, ...(kept.registry === undefined ? {} : { registries: { mode: 'chain', ipfsGateway: registryGateway() } }) },
    { wallet: ['--connect', LOAN_ORIGIN], loan: ['--forward', `/service/=http://127.0.0.1:${SERVICE_PORT}`] },
  );
  await startService();
  theCourse.fundRunKey();
  log(`   the run starts after block ${kept.startHeight}; Paryon's deployment "${deployment.name}" on ${config.network}, PUSD ${deployment.tokenIds.paryon.slice(0, 12)}…`);
  await steps();
  quiet('at the end');
  const all = state.step >= 15 && until >= 15;
  if (all) theCourse.returnCoins();
  await writeRecord(all ? 'every step was carried out.' : `stopped after step ${Math.min(state.step, until)}, as asked.`);
} catch (error) {
  await theCourse.failed(error);
  await writeRecord(`failed at step ${state.step}: ${String((error as Error).message).split('\n')[0]?.slice(0, 400)}`).catch((problem: unknown) => log(`the record could not be written: ${(problem as Error).message}`));
  process.exitCode = 1;
} finally {
  await theCourse.end();
  await stopService();
}
