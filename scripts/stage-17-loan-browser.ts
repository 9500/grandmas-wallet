// The ParyonUSD course of stage 17 in browsers, on the local node or on chipnet (acceptance test PR20 of proposal v0.6,
// run H on chipnet): the wallet page, the recoverer page and the loan page, driven as a person would. On the local node
// Paryon's contracts as published are deployed on the local chain by this script (packages/paryon/src/local-deployment.ts)
// and named to the loan page in its configuration; on chipnet the public pages use Paryon's own test deployment. Each device is a browser profile of its own, kept on disk; the
// loan page is a second tab of the phone that uses it. The wallet reads no recovery declaration: the loan reaches it as
// Paryon's template, in the page's requests of `xo_v1` version 2.
//
//   1. Anna opens the recoverer's page and funds her balance    7. the phone is lost, with the loan open
//   2. Anna sets up Grandma's wallet: the phone scans her code   8. a new phone takes the wallet over and sweeps
//   3. the owner receives                                        9. the new phone trusts the template from the backup
//   4. the owner is paid for the loan, connects the wallet to       and lists the key under the template's name, with
//      the loan page, and the page has the wallet make a key        "Open the application to do this" and the page's
//      (the wallet asks for the user's tick, once)                   address, and offers no closing of its own
//   5. the page brings Paryon's contracts up to date and        10. the loan page is opened on the new phone, connects,
//      borrows 100.00 PUSD                                           finds the loan and closes it
//   6. collateral is added from the loan page                   11. the coins go back to where they came from
//
// Every request the new phone's browser makes, from the moment its profile is made, is recorded (to requests.json
// beside the profiles), with where the loan page was first opened on it; the run stops if one goes to the loan page
// before then.
//
// usage (from the repository's root, with the local node running and the pages built: deploy/preview.sh build):
//   npx tsx scripts/stage-17-loan-browser.ts [local] [--screens] [--headed] [--until <step>] [--from 7|9|10|11] [--ports <base>] [--directory <name>] [--within <minutes>]
// on chipnet, with the public pages and backup stores, paid from the key in .chipnet/funder-design-2.json:
//   npx tsx scripts/stage-17-loan-browser.ts chipnet [--screens] [--headed] [--until <step>] [--from 4|7|8|9|10|11] [--record-only]
// --from 4 continues a run that stopped before the wallet was paid for the loan, with its wallet set up.
// --from 8 continues a run whose new phone has sent its request: the move is completed with no new request.
// --record-only writes the record again from what the run kept, and runs nothing.
//
// The run pays from a key of its own (scripts/run-key.ts), given at the start what the run needs in one payment from the
// funding address and emptied back to it at the end. On chipnet that is what borrowing at 125% at the page's prices
// needs (about 0.6 BCH), or what the funding address can give less a reserve; the run pays the owner's wallet all the
// key holds but a small reserve, and borrows at the highest ratio from 125% down to the page's least, 115%, that the
// wallet can pay at the page's own prices; where not even 115% can be paid it stops before anything is paid. A run that stops keeps its
// profiles and words on disk and is continued with --from, so that the loan is closed and the collateral comes back.
//
// Served on this machine as the jar course is (scripts/browser-course.ts); the loan page with the deployment in its
// configuration. Profiles, the stores' data, the log and what the run knows between steps are under
// .local-runs/stage-17-loan-browser/. The record is written to docs/runs/stage-17-loan-browser-local-node.md; with
// --screens, pictures at 390x844 and 1280x800 go to docs/screens/ as live-loan-*.png. On chipnet: under
// .chipnet/stage-17-loan-browser-chipnet/, docs/runs/stage-17-loan-browser-chipnet.md and chipnet-loan-*.png.
import { createServer } from 'node:http';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

import { binToHex, hexToBin, lockingBytecodeToCashAddress } from '@bitauth/libauth';
import { type Utxo, controllerScript, keyPairFromPrivateKey, p2pkhLockingBytecode } from '@grandmas-wallet/core';
import { type ParyonDeployment, localDeployment, localRegistry, paryonContracts } from '@grandmas-wallet/paryon';
import type { Page } from 'playwright';

import { DEPLOYMENT, borrowPlan, formatPrice } from '../apps/loan/src/loan.js';
import { generalProtocolsOracle, readMarket } from '../apps/loan/src/market.js';
import { PAGE_WAIT, type Device, LIMIT, LOAN, RECOVERER, WALLET, argument, chainShows, chipnet, clearLeftovers, click, completeTakeover, config, course, firstSteps, newPhoneAsks, openDeskWorking, pageShows, pagesUsed, recordFile, reviewEverything, root, see, sendAllOfBalance, servedFrom, untilPage, valueOf } from './browser-course.js';
import { withChainLock } from './run-key.js';
import { type LedgerTransaction, addressOf, chainHeight, chainServer, ledgerSection, runTransactions } from './browser-ledger.js';
import { type RequestLog, controllerLabels, flat, localPayerLocking, lockingOf, openFolds, recordRequests, requestsSection, textOf, walletKept, walletPlaces } from './browser-live.js';

const until = Number(argument('until') ?? '99');
/** Only the record is written again, from what the run kept and the chain as it is now: nothing is run, and the run's log and requests are kept. */
const recordOnly = process.argv.includes('--record-only');
const from = Number(argument('from') ?? (recordOnly ? '11' : '1'));
if (![1, 4, 7, 8, 9, 10, 11].includes(from)) throw new Error('A run continues from step 4, 7, 8, 9, 10 or 11.');
// What the run pays on the local node: 400,000 satoshis to Anna's balance, 50,000 and 61,000,000 to the owner, with room
// for the fees. On chipnet the key is given what the loan needs at the page's prices (see below).
const theCourse = course({ directory: 'stage-17-loan-browser', continuing: from > 1, until, ports: 8340, need: 61_460_000 });
const { work, started, lines, log, pay, mine, prepare, device, watchPage, close, shot, state, begin, elsewhere, keepStorage } = theCourse;
const noShot = async (): Promise<void> => undefined;
const LOAN_ORIGIN = new URL(LOAN).origin;
/** US cents per BCH in the deployment's price threads, as in the earlier runs. */
const PRICE = 20_870n;

// ------------------------------------------------------------------ what the run keeps between its parts

interface Kept {
  startHeight: number;
  /** The key that deployed Paryon's contracts and gets Paryon's fee. */
  deployer: string;
  deployment?: ParyonDeployment;
  /** On the local node: the registry the deployment published for its PUSD, as hex, served to the wallet's page as by an IPFS gateway. */
  registry?: string;
  category: string;
  fundsAddress: string;
  /** How many of the new phone's requests were made before the loan page was opened on it. */
  requestsBeforePage?: number;
  /** On chipnet: what the funding address paid the owner's wallet for the loan, and which release of the pages each part used. */
  paidForLoan?: string;
  /** What the wallet held, in satoshis, before it was paid for the loan. */
  heldBefore?: string;
  served?: string[];
  labels: Record<string, string>;
  facts: string[];
  continued: string[];
  screens: string[];
  /** The outcome as last written to the record. */
  outcome?: string;
  /** How the run was started, and when: for a record written again. */
  command?: string;
  startedAt?: number;
}
const keptFile = `${work}loan.json`;
const kept: Kept =
  from > 1 && existsSync(keptFile)
    ? (JSON.parse(readFileSync(keptFile, 'utf8')) as Kept)
    : { startHeight: await chainHeight(), deployer: binToHex(crypto.getRandomValues(new Uint8Array(32))), category: '', fundsAddress: '', labels: {}, facts: [], continued: [], screens: [] };
/** The names of the pictures and of the record: of the local node, or of chipnet. */
const where = chipnet ? 'chipnet' : 'local-node';
const prefix = chipnet ? 'chipnet-loan' : 'live-loan';
/** The collateral added from the page in step 6, in BCH as typed. */
const ADDED = chipnet ? '0.0001' : '0.001';
/** What the funding address keeps back when it pays the owner's wallet for the loan on chipnet. */
const RESERVE = 10_000n;
/**
 * What the first steps pay: Anna's balance and the owner. On chipnet Anna gets little more than the wallet she sets up
 * takes, so that the funding address's coins go to the loan's collateral.
 */
const FIRST = chipnet ? { balance: 130_000, receive: 50_000 } : { balance: 400_000, receive: 50_000 };
const FIRST_PAID = BigInt(FIRST.balance + FIRST.receive + 10_000);
/** 100.00 PUSD, in cents. */
const DEBT = 10_000n;
const save = (): void => writeFileSync(keptFile, JSON.stringify(kept, null, 1), { mode: 0o600 });
save();
const fact = (line: string): void => {
  kept.facts.push(line);
  save();
  log(`   (${line.slice(0, 300)}${line.length > 300 ? '…' : ''})`);
};
const label = (transactionId: string, what: string): void => {
  if (/^[0-9a-f]{64}$/.test(transactionId) && kept.labels[transactionId] === undefined) kept.labels[transactionId] = what;
  save();
};
const paid = (address: string, satoshis: number, what: string): string => {
  const said = pay(address, satoshis);
  const transactionId = /in ([0-9a-f]{64}):/.exec(said)?.[1];
  if (transactionId !== undefined) label(transactionId, what);
  return said;
};
const picture = async (page: Page, name: string): Promise<void> => {
  await shot(page, `${prefix}-${name}`);
  if (!kept.screens.includes(name)) kept.screens.push(name);
  save();
};
const requests: RequestLog = recordRequests(`${work}requests.json`, from > 1);
const cli = (...parameters: string[]): string => theCourse.run(`${root}deploy/regtest/regtest.sh`, ['cli', ...parameters]);

// ------------------------------------------------------------------ Paryon's contracts on the local chain

const deployer = keyPairFromPrivateKey(hexToBin(kept.deployer));
const deployerLocking = p2pkhLockingBytecode(deployer.keyHash);
/** The registry's name under the local gateway, and the gateway: a server of this run, on the port after the loan page's. */
const REGISTRY_NAME = 'pusd-local-registry.json';
const registryGateway = (): string => `http://localhost:${Number(new URL(LOAN).port) + 5}/ipfs/`;
/** Serve the deployment's registry as an IPFS gateway would, to any origin; it ends with the run. */
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

/** Deployed once, before the pages are served: the loan page is told of the deployment in its configuration. */
const deploy = async (): Promise<ParyonDeployment> => {
  // On chipnet the page uses Paryon's own test deployment.
  if (chipnet) return DEPLOYMENT;
  if (kept.deployment !== undefined) return kept.deployment;
  const addressOf = (bytecode: Uint8Array): string => {
    const made = lockingBytecodeToCashAddress({ prefix: 'bchreg', bytecode });
    if (typeof made === 'string') throw new Error(made);
    return made.address;
  };
  // Two block rewards define the deployment's two categories; they are spendable after 100 more blocks.
  const hashes = withChainLock(() => {
    const made = JSON.parse(cli('generatetoaddress', '2', addressOf(deployerLocking))) as string[];
    cli('generatetoaddress', '100', addressOf(hexToBin(`76a914${'00'.repeat(20)}88ac`)));
    return made;
  });
  const coinbase = (hash: string): Utxo => {
    const block = JSON.parse(cli('getblock', hash, '2')) as { tx: { txid: string; vout: { value: number }[] }[] };
    const [first] = block.tx;
    if (first === undefined) throw new Error('no block reward');
    return { transactionHash: hexToBin(first.txid), index: 0, output: { lockingBytecode: deployerLocking, valueSatoshis: BigInt(Math.round((first.vout[0]?.value ?? 0) * 1e8)) } };
  };
  // PUSD's registry, published on its authchain as an issuer does, so that the wallet shows PUSD in its units.
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

// ------------------------------------------------------------------ the collateral on chipnet

/** Paryon's prices as the loan page reads them: the stored price, the oracle's, and the lower of the two. */
const chipnetMarket = async (): Promise<Awaited<ReturnType<typeof readMarket>>> => {
  const server = await chainServer();
  try {
    return await readMarket({ getTransaction: (id) => server.getTransaction(id), listUnspent: (bytecode) => server.listUnspent(bytecode, 'include'), tip: () => server.tip() }, 'chipnet', generalProtocolsOracle);
  } finally {
    await server.disconnect();
  }
};
/**
 * The highest ratio from the proposed 125% down to the page's least, 115%, at which a wallet holding `holds` can
 * borrow 100.00 PUSD and add the collateral of step 6, with room for the network fees.
 */
const affordable = (market: Awaited<ReturnType<typeof readMarket>>, holds: bigint): number | undefined => {
  const added = BigInt(Math.round(Number(ADDED) * 1e8));
  for (let percent = 125; percent >= 115; percent -= 1) if (borrowPlan(DEBT, percent, market).total + added + 30_000n <= holds) return percent;
  return undefined;
};

// ------------------------------------------------------------------ the pages

/** Connect the wallet to the loan page open in another tab: the page's address is pasted into the wallet. */
const connect = async (wallet: Page, loanPage: Page): Promise<void> => {
  await loanPage.goto(LOAN);
  const address = loanPage.locator('.value-text[data-value^="wiz:"]').first();
  // A page that was connected to this wallet in a part of the run that stopped takes that session up again.
  const resumed = loanPage.getByText('Your loans').first();
  // The page shows one or the other within seconds of loading: a short wait, and a stop with the page's picture and text otherwise.
  await pageShows(address.or(resumed).or(loanPage.getByText(/Reaching the wallet/).first()), 'the loan page\'s connection address, or the session it had before');
  if (!(await address.isVisible())) {
    // A session of a part that stopped may have gone through a relay that is gone with it: then the page is paired again.
    const back = await resumed.waitFor({ state: 'visible', timeout: PAGE_WAIT }).then(() => true, () => false);
    if (back) {
      log('   the loan page took up the session it had with this wallet before');
      return;
    }
    log(`   the loan page did not take up its earlier session within ${PAGE_WAIT / 1000} s ("${flat(await loanPage.locator('.link-state, .connect-card, main').first().innerText().catch(() => ''))}"); it is connected again with "Connect another wallet"`);
    await click(loanPage, 'Connect another wallet');
    await pageShows(address, 'the loan page\'s connection address after "Connect another wallet"');
  }
  const uri = (await address.getAttribute('data-value')) ?? '';
  log(`   the loan page shows its connection address (${uri.length} characters) and waits for a wallet`);
  await wallet.goto(`${WALLET}apps`);
  await click(wallet, 'Paste a link instead');
  await wallet.getByLabel('Connection link').fill(uri);
  await click(wallet, /^Connect$/);
  const row = wallet.locator('ul.connections li').filter({ has: wallet.getByText('Connected', { exact: true }) }).first();
  await pageShows(row, 'the wallet\'s Applications screen to say "Connected"');
  // A connection to the session of a part that stopped, which cannot come back, is ended.
  const stale = wallet.locator('ul.connections li').filter({ hasText: 'Connecting' });
  for (let round = 0; round < 5 && (await stale.first().isVisible()); round++) {
    const before = await stale.count();
    await stale.first().getByRole('button', { name: 'End the connection' }).click();
    log('   the wallet\'s connection to the session of the part that stopped is ended');
    await untilPage(async () => (await stale.count()) < before, 'the ended connection to leave the wallet\'s list');
  }
  log(`   the wallet's Applications screen: "${await textOf(row.locator('.connection-name'))}"; "Connected"`);
  await see(loanPage, 'Your loans');
  log('   the loan page shows "Your loans" and "Open a loan"');
};

/**
 * The wallet's review of the page's request: read with its folds closed, pictured, read again with them open, ticked
 * where it asks for the user's tick, and approved. Returns the transaction it sent.
 */
const approveRequest = async (wallet: Page, what: string, name: string | undefined, tick = false, shows?: string): Promise<string> => {
  const request = wallet.locator('.request-card').filter({ hasText: 'asks for your decision' }).first();
  await pageShows(request, `the wallet to show the loan page's request (${what})`);
  const approve = request.getByRole('button', { name: 'Approve' });
  await pageShows(approve, `Approve on the request (${what})`);
  const box = request.locator('input[type=checkbox]');
  if (tick) await pageShows(box, `the box to tick on the request (${what})`);
  else await untilPage(() => approve.isEnabled(), `Approve enabled on the request (${what})`);
  const first = await textOf(request);
  const ticks = await box.count();
  fact(`${what}: the wallet's review of the page's request, as it first appears${ticks > 0 ? `, with ${ticks} box to tick` : ''}: "${first}"`);
  if (shows !== undefined && !first.includes(shows)) throw new Error(`${what}: the wallet's review does not show "${shows}" as it first appears. It shows: "${first}"`);
  if (name !== undefined) await picture(wallet, name);
  if (tick) {
    if (await approve.isEnabled()) throw new Error('Approve works before the box is ticked');
    await box.first().check();
    await untilPage(() => approve.isEnabled(), `Approve enabled once the box is ticked (${what})`);
    log('   Approve was off until the box was ticked; ticked');
    if (name !== undefined) await picture(wallet, `${name}-ticked`);
  } else if (ticks > 0) throw new Error(`${what}: the wallet asks for a tick where none was expected`);
  await openFolds(request);
  log(`   ${what}, every fold opened: "${await textOf(request)}"`);
  await click(wallet, /^Approve$/);
  const outcome = wallet.locator('.request-card').filter({ hasText: /Done:|Not carried out:/ }).first();
  await pageShows(outcome, `"Done:" or "Not carried out:" after approving (${what})`);
  const title = await textOf(outcome.locator('h2, .card-title'));
  if (!title.startsWith('Done')) throw new Error(`${what} was not carried out: ${await textOf(outcome)}`);
  const transactionId = (await outcome.getByTestId('action-transaction').getAttribute('data-value')) ?? '';
  log(`   approved; the wallet: "${title}", transaction ${transactionId}`);
  await outcome.getByRole('button', { name: 'Dismiss' }).click();
  return transactionId;
};

/** Wait for the loan page to say an action is done, and read it. */
const pageDone = async (loanPage: Page, text: string | RegExp): Promise<void> => {
  await see(loanPage, text);
  log(`   the loan page: "${typeof text === 'string' ? text : flat((await loanPage.getByText(text).first().innerText()) ?? '')}"`);
};

// ------------------------------------------------------------------ the run

const steps = async (): Promise<void> => {
  let recoverer: Device;
  let next: Device | undefined;
  if (from === 1 || from === 4) {
    let old: Device;
    if (from === 1) {
      const reached = await firstSteps(theCourse, noShot, async (phone) => keepStorage(phone), FIRST);
      if (reached === undefined) return;
      old = reached.old;
      recoverer = reached.recoverer;
      kept.fundsAddress = await valueOf(recoverer.page, 'funds-address').catch(() => '');
      save();
    } else {
      // The part that stopped set the wallet up: the same profiles are opened where they were.
      recoverer = await device('recoverer', false);
      old = await device('old-phone', false);
      await recoverer.page.goto(RECOVERER);
      await old.page.goto(WALLET);
      state.step = 3;
      await theCourse.lookAround();
    }

    // 4 ------------------------------------------------------------------
    if (!begin('The owner is paid for the loan, connects the wallet to the loan page, and the page has the wallet make a loan key')) return;
    if (chipnet && kept.heldBefore === undefined) {
      // What the wallet holds already counts towards the loan: its starting balance and the first payment.
      await old.page.getByRole('link', { name: 'Home' }).first().click();
      const shown = Number.parseFloat((await old.page.getByTestId('balance').textContent()) ?? '');
      if (!Number.isFinite(shown)) throw new Error('The wallet\'s balance could not be read before it is paid for the loan. Nothing was paid.');
      kept.heldBefore = String(Math.round(shown * 1e8));
      save();
    }
    const heldBefore = BigInt(kept.heldBefore ?? '0');
    await old.page.getByRole('link', { name: 'Receive' }).first().click();
    const receiving = await valueOf(old.page, 'receive-address');
    if (chipnet) {
      if (kept.paidForLoan === undefined) {
        const balance = theCourse.keyBalance();
        const market = await chipnetMarket();
        const amount = balance - RESERVE;
        const percent = affordable(market, amount + heldBefore);
        if (percent === undefined) throw new Error(`The run's key holds ${balance} satoshis and the wallet ${heldBefore}. Borrowing 100.00 PUSD at no less than 115% of ${formatPrice(market.lower)} (the lower of the stored ${formatPrice(market.stored)} and the oracle's ${market.oracle === undefined ? 'none' : formatPrice(market.oracle.price)}) needs ${borrowPlan(DEBT, 115, market).total + 40_000n} satoshis in the wallet. Nothing was paid.`);
        log(`   at ${formatPrice(market.lower)} the wallet can borrow at ${percent}% with ${amount} satoshis beside the ${heldBefore} it holds`);
        kept.paidForLoan = paid(receiving, Number(amount), 'The funding address pays the owner\'s wallet for the loan\'s collateral');
        save();
      }
      log(`   ${kept.paidForLoan}`);
    } else log(`   ${paid(receiving, 61_000_000, 'The local payer pays the owner\'s wallet for the loan\'s collateral')}`);
    const oldLoan = await old.context.newPage();
    watchPage('old-phone, loan tab', oldLoan);
    await connect(old.page, oldLoan);
    await see(oldLoan, 'Make a loan key');
    await picture(oldLoan, 'page-connected');
    await oldLoan.getByRole('button', { name: 'Make a loan key' }).click();
    const made = await approveRequest(old.page, 'Making a loan key', 'key-review', true);
    label(made, 'The owner\'s phone makes a loan key, on the loan page\'s request, with the user\'s tick: the key is made from the wallet\'s coin and waits in Paryon\'s contract');
    await pageDone(oldLoan, 'The loan key is made. It waits in Paryon\'s contracts until you borrow.');
    mine(1);

    // 5 ------------------------------------------------------------------
    if (!begin('The page brings Paryon\'s contracts up to date and borrows 100.00 PUSD')) return;
    await oldLoan.locator('#loan-amount').fill('100');
    if (chipnet) {
      // The ratio the wallet can pay at the page's prices as they are now.
      const paidAmount = BigInt(/paid (\d+) satoshis/.exec(kept.paidForLoan ?? '')?.[1] ?? '0');
      const market = await chipnetMarket();
      const percent = affordable(market, paidAmount + heldBefore - 5_000n);
      if (percent === undefined) throw new Error(`At ${formatPrice(market.lower)} the ${paidAmount} satoshis paid to the wallet, beside the ${heldBefore} it held, do not borrow 100.00 PUSD at 115%. The key is made and no loan is open; the run can be continued with --from when the price allows.`);
      await oldLoan.locator('#loan-ratio').fill(String(percent));
      log(`   the collateral set to ${percent}% of the debt at ${formatPrice(market.lower)}`);
    }
    const move = oldLoan.getByRole('button', { name: 'Bring the contracts up to date' });
    const ready = oldLoan.getByText(/^Up to date\. A loan opened now/);
    await chainShows(move.or(ready), 'the loan page to read where Paryon\'s contracts stand', LIMIT.read);
    if (await move.isVisible()) {
      log(`   the page: "${await textOf(oldLoan.locator('.new-step').nth(1))}"`);
      await move.click();
      const moved = await approveRequest(old.page, 'Bringing Paryon\'s contracts up to date', undefined);
      label(moved, 'The owner\'s phone brings Paryon\'s Borrowing contract up to the current period, on the loan page\'s request');
      await pageDone(oldLoan, 'Paryon\'s contracts are up to date.');
    }
    await chainShows(ready, 'the loan page to read that Paryon\'s contracts are up to date', LIMIT.read);
    log(`   the page: "${await textOf(ready)}"; the borrowing form: "${await textOf(oldLoan.locator('.summary'))}"`);
    await picture(oldLoan, 'page-borrow');
    await oldLoan.getByRole('button', { name: /^Borrow 100\.00 PUSD/ }).click();
    // The PUSD the wallet receives, in the token's units already in the review of the first borrowing: the wallet looks up
    // the registry of a category it does not hold before the review opens.
    const borrowed = await approveRequest(old.page, 'Borrowing 100.00 PUSD', 'borrow-review', false, chipnet ? '100.00 PUSDTEST' : kept.registry === undefined ? undefined : '100.00 PUSDLOCAL');
    label(borrowed, 'The owner\'s phone borrows 100.00 PUSD, on the loan page\'s request: the collateral into Paryon\'s loan contract, the key and the PUSD to the wallet; the key\'s record on both stores before signing');
    await pageDone(oldLoan, 'The loan is open. The PUSD and the loan key are in your wallet.');
    mine(1);
    const loan = oldLoan.getByTestId('loan').first();
    await chainShows(loan, 'the loan page to list the loan, read from the chain', LIMIT.read);
    log(`   the loan page lists: "${await textOf(loan)}"`);

    // 6 ------------------------------------------------------------------
    if (!begin('Collateral is added from the loan page')) return;
    await loan.getByRole('button', { name: 'Change the collateral' }).click();
    await oldLoan.locator(`[id^="collateral-"]`).first().fill(ADDED);
    await loan.getByRole('button', { name: /^Add$/ }).click();
    const added = await approveRequest(old.page, `Adding ${ADDED} BCH of collateral`, 'manage-review');
    label(added, `The owner's phone adds ${ADDED} BCH of collateral, on the loan page's request: the key goes back to the address it came from (\`return\`)`);
    await pageDone(oldLoan, 'The collateral is changed. The key is back where it was in your wallet.');
    mine(1);
    await oldLoan.reload();
    const after = oldLoan.getByTestId('loan').first();
    await chainShows(after, 'the loan page, opened again, to list the loan from the chain', LIMIT.read);
    const listed = await textOf(after);
    log(`   the loan page lists: "${listed}"`);
    await picture(oldLoan, 'page-loan');
    kept.category = /Loan key ([0-9a-f]{8})…/.exec(listed)?.[1] ?? '';
    // The key in the wallet's own list: under the template's name, done through the application.
    await old.page.goto(`${WALLET}apps`);
    const held = old.page.getByTestId('position-held').first();
    await chainShows(held, 'the wallet to list the loan key from its record, read against the chain', LIMIT.read);
    kept.category = (await held.locator('.token-id [title]').first().getAttribute('title')) ?? kept.category;
    save();
    fact(`The loan was opened and given more collateral from the loan page: "${listed}". On the owner's phone the wallet lists the key from its record: "${await textOf(held)}". The key's category is \`${kept.category}\`.`);
    await picture(old.page, 'positions-owner');
    if (kept.registry !== undefined) {
      // The borrowed PUSD, in the token's units: from the registry the deployment published on PUSD's authchain, checked against the chain.
      const pusd = old.page.locator('li.token').filter({ hasText: '100.00 PUSDLOCAL' });
      await pageShows(pusd, 'the wallet to list the borrowed PUSD in the token\'s units, from its registry');
      fact(`The wallet lists the borrowed PUSD by the registry the deployment published on chain, checked against it: "${await textOf(pusd)}".`);
      await picture(old.page, 'registry-owner');
    }

    // 7 ------------------------------------------------------------------
    if (!begin('The phone is lost, with the loan open')) return;
    await close(old);
    log('   the old phone\'s profile, with its wallet tab and its loan tab, is no longer opened');
  } else {
    log(`   the loan key: ${kept.category}`);
    recoverer = await device('recoverer', false);
    state.step = from - 1;
    if (from === 7 && begin('The phone is lost, with the loan open')) log('   the old phone\'s profile is not opened again');
    if (from > 8) {
      next = await device('new-phone', false);
      requests.watch(next.context);
      // What the new phone's wallet shows before anything is done, and what a stopped part left on it.
      await next.page.goto(`${WALLET}apps`);
      await theCourse.lookAround();
      await clearLeftovers(next.page, log);
    } else await theCourse.lookAround();
    if (from === 8) {
      // The new phone sent its request in the part that stopped: the move is completed from there, with no request of its own.
      state.step = 7;
      if (!begin('A new phone takes the wallet over with Anna\'s help, and sweeps')) return;
      next = await device('new-phone', false);
      requests.watch(next.context);
      await completeTakeover(theCourse, recoverer, next, noShot, true);
      await keepStorage(next);
    }
  }

  // 8 ------------------------------------------------------------------
  if (next === undefined) {
    if (!begin('A new phone takes the wallet over with Anna\'s help, and sweeps')) return;
    next = await device('new-phone');
    requests.watch(next.context);
    await newPhoneAsks(theCourse, recoverer, '', noShot, next);
    await completeTakeover(theCourse, recoverer, next, noShot);
    await keepStorage(next);
  }
  const phone = next;
  const keyRow = (status: string) => phone.page.getByTestId(`position-${status}`).filter({ has: phone.page.locator(`.token-id [title="${kept.category}"]`) });

  // 9 ------------------------------------------------------------------
  if (state.step < 9) {
    if (!begin('The new phone trusts the template from the backup and lists the key under its name, with "Open the application to do this"')) return;
    await phone.page.goto(`${WALLET}apps`);
    const swept = phone.page.locator('li.token').filter({ has: phone.page.locator(`.token-id [title="${kept.category}"]`) });
    const trust = swept.getByRole('button', { name: 'Trust this template' });
    const held = keyRow('held');
    await chainShows(trust.or(held), 'the new phone to list the swept key, read from the chain', LIMIT.read);
    if (await trust.isVisible()) {
      const before = await textOf(swept);
      log(`   the Applications screen lists the swept key: "${before}"`);
      fact(`On the new phone, after the recovery, the wallet listed the swept key as a token of a template it does not trust yet: "${before}". The PUSD: "${await textOf(phone.page.locator('li.token').filter({ hasNotText: kept.category.slice(0, 8) }).first())}".`);
      await picture(phone.page, 'new-phone-untrusted');
      await trust.click();
      await see(phone.page, 'A template from your backup');
      await click(phone.page, 'Trust this template');
    } else log('   the template is trusted on this phone already, by the part of the run that stopped');
    await chainShows(held, 'the new phone to list the key from its record under the template\'s name', LIMIT.read);
    const listed = await textOf(held);
    // Its buttons, leaving out the "?" and the identifiers shown short, which open in full when tapped.
    const buttons = (await held.locator('button:not(.hex):not(.info-button)').allInnerTexts()).map(flat);
    const link = await held.locator('a.application-page').getAttribute('href');
    log(`   trusted; the wallet's list: "${listed}"; its buttons: ${buttons.map((text) => `"${text}"`).join(', ')}; the page's address: ${link}`);
    if (buttons.some((text) => !/^Send$/.test(text))) throw new Error(`the wallet offers to act on the key by itself: ${buttons.join(', ')}`);
    if (!/Open the application to do this/.test(listed) || link !== LOAN) throw new Error('the key is not listed with "Open the application to do this" and the page\'s address');
    await picture(phone.page, 'open-the-application');
    await held.getByRole('button', { name: /^Why this needs the application/ }).click();
    const help = held.locator('.info-bubble').first();
    await pageShows(help, 'the "?" bubble');
    const helpText = await textOf(help);
    log(`   the "?": "${helpText}"`);
    await picture(phone.page, 'open-the-application-help');
    await phone.page.keyboard.press('Escape');
    fact(`Once the user trusted the template the earlier owner had stored, the new phone listed the key from its record under the template's name: "${listed}". Its only button is "Send"; the "?" says: "${helpText}"; the link is the page's address from the record, ${link}. The wallet offers no closing of its own.`);
  }

  // 10 ------------------------------------------------------------------
  if (state.step < 10) {
    if (!begin('The loan page is opened on the new phone, connects, finds the loan and closes it')) return;
    // A part that stopped after the page was first opened here has checked and kept this already.
    if (kept.requestsBeforePage === undefined) {
      const before = requests.urls();
      const early = before.filter((url) => url.startsWith(LOAN_ORIGIN));
      if (early.length > 0) throw new Error(`the new phone asked the loan page before it was opened: ${early.join(', ')}`);
      kept.requestsBeforePage = before.length;
      save();
    }
    const newLoan = await phone.context.newPage();
    watchPage('new-phone, loan tab', newLoan);
    await connect(phone.page, newLoan);
    // The template came from the backup: the wallet asks before it tells this page which keys of it it holds.
    const ask = phone.page.locator('.request-card').filter({ hasText: 'asks to see your tokens' }).first();
    const loan = newLoan.getByTestId('loan').first();
    // The wallet's question, or the loan listed where it was allowed before: within seconds once the page is connected.
    // The two are on different pages: each is looked at.
    await untilPage(async () => (await ask.isVisible()) || (await loan.isVisible()), 'the wallet asking whether the page may see its tokens, or the loan listed where that was allowed before');
    if (await ask.isVisible()) {
      log(`   the wallet: "${await textOf(ask)}"`);
      await picture(phone.page, 'positions-ask');
      await ask.getByRole('button', { name: 'Allow' }).click();
    } else log('   the user had allowed the page to see the wallet\'s tokens of its template in the part of the run that stopped');
    await chainShows(loan, 'the loan page to find the loan from the key the wallet reported', LIMIT.read);
    const found = await textOf(loan);
    log(`   allowed; the loan page found the loan from the key: "${found}"`);
    await picture(newLoan, 'page-found');
    await loan.getByRole('button', { name: 'Repay and close' }).click();
    await newLoan.getByRole('button', { name: 'Repay and close the loan' }).click();
    const closed = await approveRequest(phone.page, 'Closing the loan on the new phone', 'close-review');
    label(closed, 'The new phone closes the loan, on the request of the loan page opened on it: the debt repaid and destroyed, the collateral and the key to the new seed');
    await pageDone(newLoan, 'The loan is closed. The collateral is back in your wallet, and so is the key.');
    mine(1);
    await newLoan.reload();
    const after = newLoan.getByTestId('loan').first();
    await chainShows(after, 'the loan page, opened again, to list the closed loan', LIMIT.read);
    log(`   the loan page lists: "${await textOf(after)}"`);
    await picture(newLoan, 'page-closed');
    fact(`On the new phone the loan page, connected and allowed by the user, found the loan from the key the wallet reported: "${found}". It closed it through the wallet (transaction \`${closed}\`), and then listed: "${await textOf(after)}".`);
  }

  // 11 ------------------------------------------------------------------
  if (!begin('The coins go back to where they came from')) return;
  const to = elsewhere();
  await phone.page.goto(`${WALLET}send`);
  await phone.page.getByLabel('To').fill(to);
  await reviewEverything(phone.page);
  const everything = phone.page.getByText('Arrives', { exact: true });
  const nothing = phone.page.getByText('Too little to send');
  await pageShows(everything.or(nothing), 'the review of sending everything, or "Too little to send"');
  if (await everything.isVisible()) {
    await click(phone.page, /^Send$/);
    await see(phone.page, 'Sent');
    log(`   the new phone sent everything to ${to}; tokens stay where they are, so the loan key stays in the wallet`);
  } else log('   the wallet has nothing left to send');
  mine(1);
  await openDeskWorking(theCourse, recoverer);
  const returned = await sendAllOfBalance(recoverer.page, to);
  log(returned === undefined ? '   Anna\'s balance holds nothing' : `   Anna sent her balance back: ${returned}`);
  mine(1);
  await keepStorage(phone);
};

// ------------------------------------------------------------------ the record

const writeRecord = async (outcome: string): Promise<void> => {
  kept.outcome = outcome;
  save();
  // On chipnet the wallet is closed after the run (scripts/close-run-wallet.ts), which writes its line beside the profiles.
  const closing = existsSync(`${work}closing.txt`) ? readFileSync(`${work}closing.txt`, 'utf8').trim() : '';
  const wallet = walletKept(work, ['old-phone', 'new-phone'], WALLET);
  const places = await walletPlaces(wallet);
  const identity = wallet.identity;
  const controller = identity === undefined ? '' : binToHex(controllerScript(hexToBin(identity)).lockingBytecode);
  const outside = lockingOf(elsewhere());
  const funds = kept.fundsAddress === '' ? '' : lockingOf(kept.fundsAddress);
  const payer = localPayerLocking();
  const ownKey = theCourse.keyLocking();
  const deployerHex = chipnet ? '' : binToHex(deployerLocking);
  // On chipnet the run's transactions are found from the run's own addresses; Paryon's contracts are everybody's.
  // The funding address is not read: others use it too, and what it paid the run is found through the run's addresses.
  const ledger = await runTransactions(kept.startHeight, [...places.keys(), controller, funds, ownKey, deployerHex]);
  const contracts = chipnet ? paryonContracts(DEPLOYMENT) : kept.deployment === undefined ? undefined : paryonContracts(kept.deployment);
  const paryonPlaces = new Map<string, string>();
  if (contracts !== undefined) {
    for (const [name, value] of Object.entries(contracts)) {
      const bytecode = (value as { lockingBytecode?: Uint8Array } | undefined)?.lockingBytecode;
      if (bytecode instanceof Uint8Array) paryonPlaces.set(binToHex(bytecode), `Paryon's ${name} contract`);
    }
    const fee = chipnet ? DEPLOYMENT.protocolFeeLockingBytecode : kept.deployment?.protocolFeeLockingBytecode;
    if (fee !== undefined && fee !== deployerHex) paryonPlaces.set(fee, 'Paryon\'s fee address (its borrowing fee)');
  }
  for (const entry of wallet.activity) label(entry.transactionId, `${entry.who === 'old-phone' ? 'The owner\'s phone' : 'The new phone'}: ${entry.what}`);
  const placeOf = (lockingBytecode: string): string | undefined =>
    lockingBytecode === controller ? 'the wallet\'s controller (its identity token)' : lockingBytecode === outside ? `the outside address the coins went back to (${addressOf(outside)})` : lockingBytecode === funds ? 'the recoverer\'s balance' : lockingBytecode === ownKey ? 'the run\'s own key (`scripts/run-key.ts`)' : lockingBytecode === payer ? (chipnet ? 'the funding address (`scripts/chipnet-pay.ts`)' : 'the local payer (`scripts/local-pay.ts`)') : lockingBytecode === deployerHex ? 'the key that deployed Paryon\'s contracts, which gets Paryon\'s fee' : (paryonPlaces.get(lockingBytecode) ?? places.get(lockingBytecode));
  const ofController = await controllerLabels(identity);
  const labelOf = (transaction: LedgerTransaction): string | undefined => {
    const named = kept.labels[transaction.transactionId] ?? ofController.get(transaction.transactionId);
    if (named !== undefined) return named;
    const fromFunds = funds !== '' && transaction.inputs.some((input) => input.lockingBytecode === funds);
    if (fromFunds && transaction.outputs.some((output) => output.lockingBytecode === outside)) return 'The recoverer sends her balance back';
    if (fromFunds) return 'Paid from the recoverer\'s balance';
    if (ownKey !== '' && transaction.inputs.some((input) => input.lockingBytecode === ownKey)) return transaction.outputs.some((output) => output.lockingBytecode === outside) ? 'The run\'s key sends what it holds back to the funding address' : 'The run\'s key pays';
    if (transaction.inputs.some((input) => input.lockingBytecode === payer)) return chipnet ? 'The funding address pays the run\'s key' : 'The local payer pays the run\'s key';
    return undefined;
  };
  const urls = requests.urls();
  const beforePage = kept.requestsBeforePage === undefined ? urls : urls.slice(0, kept.requestsBeforePage);
  const toPage = urls.filter((url) => url.startsWith(LOAN_ORIGIN));
  const early = beforePage.filter((url) => url.startsWith(LOAN_ORIGIN));
  const served = (kept.served ?? []).length === 0 ? '' : ` ${(kept.served ?? []).join(' Then, for the part that continued: ')}`;
  writeFileSync(
    recordFile(`stage-17-loan-browser-${where}.md`),
    [
      `# Stage 17 in browsers on ${chipnet ? 'chipnet (run H)' : 'the local node'}: a ParyonUSD loan from its template alone, through the loss of a phone (PR20)`,
      '',
      `Written by \`scripts/stage-17-loan-browser.ts${(kept.command ?? '') === '' ? '' : ` ${kept.command}`}\` on ${new Date(kept.startedAt ?? started).toISOString().slice(0, 16).replace('T', ' ')} UTC. Chromium (Playwright), one browser profile per device kept on disk under \`${work.slice(root.length)}\`; the loan page is a second tab of the phone that uses it. ${chipnet ? `${pagesUsed([WALLET, RECOVERER, LOAN], 'Blocks and the waiting period took their real time; the coins came from the funding address and went back to it.')}${served} The loan page used Paryon's own test deployment \`${DEPLOYMENT.name}\`, unchanged, and read the oracle's price.` : `The pages are this checkout's production builds (\`deploy/preview.sh build\`) served by \`deploy/serve.mjs\` with the content security policy at ${WALLET}, ${RECOVERER} and ${LOAN}, against the regtest node, with two backup stores and a relay for the sessions between the pages, all on this machine. Paryon's contracts as published (\`@paryonusd/contracts\` 1.1.0) were deployed on the local chain by the run (\`packages/paryon/src/local-deployment.ts\`, the price at $${(Number(PRICE) / 100).toFixed(2)}, periods of 10 blocks) and named to the loan page in its configuration; the oracle is not read for such a deployment. The run made the blocks and moved the chain's clock.`} The wallet reads no recovery declaration: the loan reached it as Paryon's template, in the page's requests of \`xo_v1\` version 2. Times in the log are seconds since the start.`,
      '',
      `Outcome: ${outcome}`,
      ...(kept.continued.length === 0 ? [] : ['', ...kept.continued]),
      '',
      ...(kept.deployment === undefined || chipnet ? [] : [`Paryon's deployment on the local chain: PUSD \`${kept.deployment.tokenIds.paryon}\`, key factories \`${kept.deployment.tokenIds.loanKeyFactory}\`. The loan key: \`${kept.category}\`.`, '']),
      'What the run showed:',
      '',
      ...kept.facts.map((line) => `- ${line}`),
      '',
      '## The new phone\'s requests',
      '',
      ...requestsSection(requests, LOAN_ORIGIN, 'the loan page', toPage, kept.requestsBeforePage === undefined ? '' : `The loan page was first opened on the new phone after its ${kept.requestsBeforePage}th request; ${early.length === 0 ? 'none of the requests before went to the loan page\'s origin' : `${early.length} before then went to the loan page's origin`}, and the requests to that origin listed below are those of the page itself once it was opened, with the requests it made of the chain's server and the relay.`),
      '## Transactions and coins',
      '',
      chipnet
        ? `Read from chipnet's server after the run: every transaction in the blocks after height ${kept.startHeight}, where the run started, or not yet in a block, that touches an address of the run (the wallet's addresses of both phones' seeds, its controller and the recoverer's balance). Paryon's contracts are named where the run's coins went into them. The fee is what the inputs held less what the outputs hold; the size is that of the transaction as sent.`
        : `Read from the local node after the run: every transaction in the blocks after height ${kept.startHeight}, where the run started, or in the node's pool, that touches an address of the run (the run's own key, the key that deployed Paryon's contracts, the wallet's addresses of both phones' seeds, its controller and the recoverer's balance), so that another run at the same time is left out. The fee is what the inputs held less what the outputs hold; the size is that of the transaction as sent.`,
      '',
      ...ledgerSection(ledger, labelOf, placeOf),
      ...(kept.screens.length === 0 ? [] : ['## Pictures', '', `In \`docs/screens/\`, each at 390×844 (\`-phone\`) and 1280×800 (\`-desktop\`): ${kept.screens.map((name) => `\`${prefix}-${name}\``).join(', ')}.`, '']),
      ...(closing === '' ? [] : ['## The wallet closed', '', closing, '']),
      '## Log',
      '',
      '```',
      ...lines,
      '```',
      '',
    ].join('\n'),
  );
  log(`record written to ${recordFile(`stage-17-loan-browser-${where}.md`).slice(root.length)}`);
};

try {
  if (!recordOnly && kept.command === undefined) {
    kept.command = process.argv.slice(2).join(' ');
    kept.startedAt = started;
    save();
  }
  if (recordOnly) {
    await writeRecord(kept.outcome ?? 'not known');
    process.exit(0);
  }
  if (from > 1) {
    kept.continued.push(`The run was continued from step ${from} on ${new Date(started).toISOString().slice(0, 16).replace('T', ' ')} UTC with the same browser profiles; the line "continued from step ${from}" in the log marks where, and the times after it count from then.`);
    save();
    theCourse.note(`       continued from step ${from}`);
  }
  const deployment = await deploy();
  /** On chipnet, what the run's key is given: what the first steps pay, and what borrowing at 125% needs, or what the funding address can give less a reserve. */
  let need: number | undefined;
  if (chipnet && from === 1) {
    // Before anything is set up: whether the funding address can pay for the loan at the page's prices as they are now.
    // The first steps give the recoverer her balance, of which the wallet gets 100,000, and pay the wallet 50,000.
    const balance = BigInt(/^(\d+) satoshis/.exec(theCourse.run('npx', ['tsx', 'scripts/chipnet-pay.ts', 'balance']))?.[1] ?? '0');
    const market = await chipnetMarket();
    const wanted = borrowPlan(DEBT, 125, market).total + BigInt(Math.round(Number(ADDED) * 1e8)) + 30_000n + RESERVE + FIRST_PAID;
    const given = wanted < balance - RESERVE ? wanted : balance - RESERVE;
    const holds = given - FIRST_PAID - RESERVE + 150_000n;
    if (affordable(market, holds) === undefined) throw new Error(`The funding address holds ${balance} satoshis. Borrowing 100.00 PUSD at no less than 115% of ${formatPrice(market.lower)} needs about ${borrowPlan(DEBT, 115, market).total + 40_000n} satoshis in the wallet, which would hold about ${holds}. Nothing was set up or paid.`);
    need = Number(given);
  }
  if (!chipnet) await serveRegistry();
  await prepare(['wallet', 'recoverer', 'loan'], chipnet ? {} : { paryon: deployment, ...(kept.registry === undefined ? {} : { registries: { mode: 'chain', ipfsGateway: registryGateway() } }) });
  if (from === 1) theCourse.fundRunKey(need);
  if (chipnet) {
    const now = await servedFrom([WALLET, RECOVERER, LOAN]);
    if (!(kept.served ?? []).includes(now)) kept.served = [...(kept.served ?? []), now];
    save();
  }
  log(`   the run starts after block ${kept.startHeight}; Paryon's deployment "${deployment.name}" on ${config.network}, PUSD ${deployment.tokenIds.paryon.slice(0, 12)}…`);
  await steps();
  const all = state.step >= 11 && until >= 11;
  if (all) theCourse.returnCoins();
  await writeRecord(all ? (kept.continued.length > 0 ? 'every step was carried out, in parts with the same browser profiles (see below).' : 'every step was carried out.') : `stopped after step ${Math.min(state.step, until)}, as asked.`);
} catch (error) {
  await theCourse.failed(error);
  kept.continued.push(`A part of the run stopped at step ${state.step}: "${String((error as Error).message).split('\n')[0]?.slice(0, 300)}".`);
  save();
  await writeRecord(`failed at step ${state.step}; see the last lines of the log.`).catch((problem: unknown) => log(`the record could not be written: ${(problem as Error).message}`));
  process.exitCode = 1;
} finally {
  await theCourse.end();
}
