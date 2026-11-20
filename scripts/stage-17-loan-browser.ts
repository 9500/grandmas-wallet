// The ParyonUSD course of stage 17 in browsers, on the local node (acceptance test PR20 of proposal v0.6, its local
// part): the wallet page, the recoverer page and the loan page of this checkout, driven as a person would, with
// Paryon's contracts as published deployed on the local chain by this script (packages/paryon/src/local-deployment.ts)
// and named to the loan page in its configuration. Each device is a browser profile of its own, kept on disk; the
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
//   npx tsx scripts/stage-17-loan-browser.ts [--screens] [--headed] [--until <step>] [--from 7|9|10|11] [--ports <base>]
//
// Served on this machine as the jar course is (scripts/browser-course.ts); the loan page with the deployment in its
// configuration. Profiles, the stores' data, the log and what the run knows between steps are under
// .local-runs/stage-17-loan-browser/. The record is written to docs/runs/stage-17-loan-browser-local-node.md; with
// --screens, pictures at 390x844 and 1280x800 go to docs/screens/ as live-loan-*.png.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

import { binToHex, hexToBin, lockingBytecodeToCashAddress } from '@bitauth/libauth';
import { type Utxo, controllerScript, keyPairFromPrivateKey, p2pkhLockingBytecode } from '@grandmas-wallet/core';
import { type ParyonDeployment, localDeployment, paryonContracts } from '@grandmas-wallet/paryon';
import type { Page } from 'playwright';

import { type Device, LOAN, RECOVERER, WALLET, argument, click, completeTakeover, config, course, firstSteps, newPhoneAsks, openDeskWorking, patience, recordFile, reviewEverything, root, see, sendAllOfBalance, valueOf, wait } from './browser-course.js';
import { type LedgerTransaction, addressOf, ledgerSection, localHeight, runTransactions } from './browser-ledger.js';
import { type RequestLog, controllerLabels, flat, localPayerLocking, lockingOf, openFolds, recordRequests, requestsSection, textOf, walletKept, walletPlaces } from './browser-live.js';

const until = Number(argument('until') ?? '99');
const from = Number(argument('from') ?? '1');
if (![1, 7, 9, 10, 11].includes(from)) throw new Error('A run continues from step 7, 9, 10 or 11.');
const theCourse = course({ directory: 'stage-17-loan-browser', continuing: from > 1, until });
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
  category: string;
  fundsAddress: string;
  /** How many of the new phone's requests were made before the loan page was opened on it. */
  requestsBeforePage?: number;
  labels: Record<string, string>;
  facts: string[];
  continued: string[];
  screens: string[];
}
const keptFile = `${work}loan.json`;
const kept: Kept =
  from > 1 && existsSync(keptFile)
    ? (JSON.parse(readFileSync(keptFile, 'utf8')) as Kept)
    : { startHeight: localHeight(), deployer: binToHex(crypto.getRandomValues(new Uint8Array(32))), category: '', fundsAddress: '', labels: {}, facts: [], continued: [], screens: [] };
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
  await shot(page, `live-loan-${name}`);
  if (!kept.screens.includes(name)) kept.screens.push(name);
  save();
};
const requests: RequestLog = recordRequests(`${work}requests.json`, from > 1);
const cli = (...parameters: string[]): string => theCourse.run(`${root}deploy/regtest/regtest.sh`, ['cli', ...parameters]);

// ------------------------------------------------------------------ Paryon's contracts on the local chain

const deployer = keyPairFromPrivateKey(hexToBin(kept.deployer));
const deployerLocking = p2pkhLockingBytecode(deployer.keyHash);
/** Deployed once, before the pages are served: the loan page is told of the deployment in its configuration. */
const deploy = async (): Promise<ParyonDeployment> => {
  if (kept.deployment !== undefined) return kept.deployment;
  const addressOf = (bytecode: Uint8Array): string => {
    const made = lockingBytecodeToCashAddress({ prefix: 'bchreg', bytecode });
    if (typeof made === 'string') throw new Error(made);
    return made.address;
  };
  // Two block rewards define the deployment's two categories; they are spendable after 100 more blocks.
  const hashes = JSON.parse(cli('generatetoaddress', '2', addressOf(deployerLocking))) as string[];
  cli('generatetoaddress', '100', addressOf(hexToBin(`76a914${'00'.repeat(20)}88ac`)));
  const coinbase = (hash: string): Utxo => {
    const block = JSON.parse(cli('getblock', hash, '2')) as { tx: { txid: string; vout: { value: number }[] }[] };
    const [first] = block.tx;
    if (first === undefined) throw new Error('no block reward');
    return { transactionHash: hexToBin(first.txid), index: 0, output: { lockingBytecode: deployerLocking, valueSatoshis: BigInt(Math.round((first.vout[0]?.value ?? 0) * 1e8)) } };
  };
  const deployed = localDeployment({ funder: deployer, paryonCoin: coinbase(hashes[0] as string), factoryCoin: coinbase(hashes[1] as string), price: PRICE, period: 1, periodLengthBlocks: 10 });
  for (const built of deployed.transactions) {
    cli('sendrawtransaction', binToHex(built.encoded));
    label(built.transactionId, 'Paryon\'s contracts as published are deployed on the local chain (by the run, not the user)');
  }
  mine(1);
  kept.deployment = deployed.deployment;
  save();
  return deployed.deployment;
};

// ------------------------------------------------------------------ the pages

/** Connect the wallet to the loan page open in another tab: the page's address is pasted into the wallet. */
const connect = async (wallet: Page, loanPage: Page): Promise<void> => {
  await loanPage.goto(LOAN);
  const address = loanPage.locator('.value-text[data-value^="wiz:"]').first();
  await address.waitFor({ state: 'visible', timeout: 120_000 * patience });
  const uri = (await address.getAttribute('data-value')) ?? '';
  log(`   the loan page shows its connection address (${uri.length} characters) and waits for a wallet`);
  await wallet.goto(`${WALLET}apps`);
  await click(wallet, 'Paste a link instead');
  await wallet.getByLabel('Connection link').fill(uri);
  await click(wallet, /^Connect$/);
  const row = wallet.locator('ul.connections li').first();
  await row.getByText('Connected', { exact: true }).waitFor({ state: 'visible', timeout: 120_000 * patience });
  log(`   the wallet's Applications screen: "${await textOf(row.locator('.connection-name'))}"; "Connected"`);
  await see(loanPage, 'Your loans', 120_000);
  log('   the loan page shows "Your loans" and "Open a loan"');
};

/**
 * The wallet's review of the page's request: read with its folds closed, pictured, read again with them open, ticked
 * where it asks for the user's tick, and approved. Returns the transaction it sent.
 */
const approveRequest = async (wallet: Page, what: string, name: string | undefined, tick = false): Promise<string> => {
  const request = wallet.locator('.request-card').filter({ hasText: 'asks for your decision' }).first();
  await request.waitFor({ state: 'visible', timeout: 180_000 * patience });
  const approve = request.getByRole('button', { name: 'Approve' });
  await approve.waitFor({ state: 'visible', timeout: 180_000 * patience });
  const box = request.locator('input[type=checkbox]');
  if (tick) await box.first().waitFor({ state: 'visible', timeout: 120_000 * patience });
  else for (let attempt = 0; attempt < 240 && !(await approve.isEnabled()); attempt++) await wait(500);
  const first = await textOf(request);
  const ticks = await box.count();
  fact(`${what}: the wallet's review of the page's request, as it first appears${ticks > 0 ? `, with ${ticks} box to tick` : ''}: "${first}"`);
  if (name !== undefined) await picture(wallet, name);
  if (tick) {
    if (await approve.isEnabled()) throw new Error('Approve works before the box is ticked');
    await box.first().check();
    for (let attempt = 0; attempt < 20 && !(await approve.isEnabled()); attempt++) await wait(250);
    log('   Approve was off until the box was ticked; ticked');
    if (name !== undefined) await picture(wallet, `${name}-ticked`);
  } else if (ticks > 0) throw new Error(`${what}: the wallet asks for a tick where none was expected`);
  await openFolds(request);
  log(`   ${what}, every fold opened: "${await textOf(request)}"`);
  await click(wallet, /^Approve$/);
  const outcome = wallet.locator('.request-card').filter({ hasText: /Done:|Not carried out:/ }).first();
  await outcome.waitFor({ state: 'visible', timeout: 240_000 * patience });
  const title = await textOf(outcome.locator('h2, .card-title'));
  if (!title.startsWith('Done')) throw new Error(`${what} was not carried out: ${await textOf(outcome)}`);
  const transactionId = (await outcome.getByTestId('action-transaction').getAttribute('data-value')) ?? '';
  log(`   approved; the wallet: "${title}", transaction ${transactionId}`);
  await outcome.getByRole('button', { name: 'Dismiss' }).click();
  return transactionId;
};

/** Wait for the loan page to say an action is done, and read it. */
const pageDone = async (loanPage: Page, text: string | RegExp): Promise<void> => {
  await see(loanPage, text, 240_000);
  log(`   the loan page: "${typeof text === 'string' ? text : flat((await loanPage.getByText(text).first().innerText()) ?? '')}"`);
};

// ------------------------------------------------------------------ the run

const steps = async (): Promise<void> => {
  let recoverer: Device;
  let next: Device | undefined;
  if (from === 1) {
    const reached = await firstSteps(theCourse, noShot, async (old) => keepStorage(old));
    if (reached === undefined) return;
    const { old } = reached;
    recoverer = reached.recoverer;
    kept.fundsAddress = await valueOf(recoverer.page, 'funds-address').catch(() => '');
    save();

    // 4 ------------------------------------------------------------------
    if (!begin('The owner is paid for the loan, connects the wallet to the loan page, and the page has the wallet make a loan key')) return;
    await old.page.getByRole('link', { name: 'Receive' }).first().click();
    const receiving = await valueOf(old.page, 'receive-address');
    log(`   ${paid(receiving, 61_000_000, 'The local payer pays the owner\'s wallet for the loan\'s collateral')}`);
    const oldLoan = await old.context.newPage();
    watchPage('old-phone, loan tab', oldLoan);
    await connect(old.page, oldLoan);
    await see(oldLoan, 'Make a loan key', 120_000);
    await picture(oldLoan, 'page-connected');
    await oldLoan.getByRole('button', { name: 'Make a loan key' }).click();
    const made = await approveRequest(old.page, 'Making a loan key', 'key-review', true);
    label(made, 'The owner\'s phone makes a loan key, on the loan page\'s request, with the user\'s tick: the key is made from the wallet\'s coin and waits in Paryon\'s contract');
    await pageDone(oldLoan, 'The loan key is made. It waits in Paryon\'s contracts until you borrow.');
    mine(1);

    // 5 ------------------------------------------------------------------
    if (!begin('The page brings Paryon\'s contracts up to date and borrows 100.00 PUSD')) return;
    await oldLoan.locator('#loan-amount').fill('100');
    const move = oldLoan.getByRole('button', { name: 'Bring the contracts up to date' });
    const ready = oldLoan.getByText(/^Up to date\. A loan opened now/);
    await move.or(ready).first().waitFor({ state: 'visible', timeout: 120_000 * patience });
    if (await move.isVisible()) {
      log(`   the page: "${await textOf(oldLoan.locator('.new-step').nth(1))}"`);
      await move.click();
      const moved = await approveRequest(old.page, 'Bringing Paryon\'s contracts up to date', undefined);
      label(moved, 'The owner\'s phone brings Paryon\'s Borrowing contract up to the current period, on the loan page\'s request');
      await pageDone(oldLoan, 'Paryon\'s contracts are up to date.');
    }
    await ready.waitFor({ state: 'visible', timeout: 120_000 * patience });
    log(`   the page: "${await textOf(ready)}"; the borrowing form: "${await textOf(oldLoan.locator('.summary'))}"`);
    await picture(oldLoan, 'page-borrow');
    await oldLoan.getByRole('button', { name: /^Borrow 100\.00 PUSD/ }).click();
    const borrowed = await approveRequest(old.page, 'Borrowing 100.00 PUSD', 'borrow-review');
    label(borrowed, 'The owner\'s phone borrows 100.00 PUSD, on the loan page\'s request: the collateral into Paryon\'s loan contract, the key and the PUSD to the wallet; the key\'s record on both stores before signing');
    await pageDone(oldLoan, 'The loan is open. The PUSD and the loan key are in your wallet.');
    mine(1);
    const loan = oldLoan.getByTestId('loan').first();
    await loan.waitFor({ state: 'visible', timeout: 120_000 * patience });
    log(`   the loan page lists: "${await textOf(loan)}"`);

    // 6 ------------------------------------------------------------------
    if (!begin('Collateral is added from the loan page')) return;
    await loan.getByRole('button', { name: 'Change the collateral' }).click();
    await oldLoan.locator(`[id^="collateral-"]`).first().fill('0.001');
    await loan.getByRole('button', { name: /^Add$/ }).click();
    const added = await approveRequest(old.page, 'Adding 0.001 BCH of collateral', 'manage-review');
    label(added, 'The owner\'s phone adds 0.001 BCH of collateral, on the loan page\'s request: the key goes back to the address it came from (`return`)');
    await pageDone(oldLoan, 'The collateral is changed. The key is back where it was in your wallet.');
    mine(1);
    await oldLoan.reload();
    const after = oldLoan.getByTestId('loan').first();
    await after.waitFor({ state: 'visible', timeout: 120_000 * patience });
    const listed = await textOf(after);
    log(`   the loan page lists: "${listed}"`);
    await picture(oldLoan, 'page-loan');
    kept.category = /Loan key ([0-9a-f]{8})…/.exec(listed)?.[1] ?? '';
    // The key in the wallet's own list: under the template's name, done through the application.
    await old.page.goto(`${WALLET}apps`);
    const held = old.page.getByTestId('position-held').first();
    await held.waitFor({ state: 'visible', timeout: 120_000 * patience });
    kept.category = (await held.locator('.token-id [title]').first().getAttribute('title')) ?? kept.category;
    save();
    fact(`The loan was opened and given more collateral from the loan page: "${listed}". On the owner's phone the wallet lists the key from its record: "${await textOf(held)}". The key's category is \`${kept.category}\`.`);
    await picture(old.page, 'positions-owner');

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
    await trust.or(held).first().waitFor({ state: 'visible', timeout: 180_000 * patience });
    if (await trust.isVisible()) {
      const before = await textOf(swept);
      log(`   the Applications screen lists the swept key: "${before}"`);
      fact(`On the new phone, after the recovery, the wallet listed the swept key as a token of a template it does not trust yet: "${before}". The PUSD: "${await textOf(phone.page.locator('li.token').filter({ hasNotText: kept.category.slice(0, 8) }).first())}".`);
      await picture(phone.page, 'new-phone-untrusted');
      await trust.click();
      await see(phone.page, 'A template from your backup');
      await click(phone.page, 'Trust this template');
    } else log('   the template is trusted on this phone already, by the part of the run that stopped');
    await held.waitFor({ state: 'visible', timeout: 180_000 * patience });
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
    await help.waitFor({ state: 'visible', timeout: 10_000 });
    const helpText = await textOf(help);
    log(`   the "?": "${helpText}"`);
    await picture(phone.page, 'open-the-application-help');
    await phone.page.keyboard.press('Escape');
    fact(`Once the user trusted the template the earlier owner had stored, the new phone listed the key from its record under the template's name: "${listed}". Its only button is "Send"; the "?" says: "${helpText}"; the link is the page's address from the record, ${link}. The wallet offers no closing of its own.`);
  }

  // 10 ------------------------------------------------------------------
  if (state.step < 10) {
    if (!begin('The loan page is opened on the new phone, connects, finds the loan and closes it')) return;
    const before = requests.urls();
    const early = before.filter((url) => url.startsWith(LOAN_ORIGIN));
    if (early.length > 0) throw new Error(`the new phone asked the loan page before it was opened: ${early.join(', ')}`);
    kept.requestsBeforePage = before.length;
    save();
    const newLoan = await phone.context.newPage();
    watchPage('new-phone, loan tab', newLoan);
    await connect(phone.page, newLoan);
    // The template came from the backup: the wallet asks before it tells this page which keys of it it holds.
    const ask = phone.page.locator('.request-card').filter({ hasText: 'asks to see your tokens' }).first();
    await ask.waitFor({ state: 'visible', timeout: 180_000 * patience });
    log(`   the wallet: "${await textOf(ask)}"`);
    await picture(phone.page, 'positions-ask');
    await ask.getByRole('button', { name: 'Allow' }).click();
    const loan = newLoan.getByTestId('loan').first();
    await loan.waitFor({ state: 'visible', timeout: 180_000 * patience });
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
    await after.waitFor({ state: 'visible', timeout: 120_000 * patience });
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
  await everything.or(nothing).first().waitFor({ state: 'visible', timeout: 120_000 * patience });
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
  const ledger = await runTransactions(kept.startHeight);
  const wallet = walletKept(work, ['old-phone', 'new-phone'], WALLET);
  const places = await walletPlaces(wallet);
  const identity = wallet.identity;
  const controller = identity === undefined ? '' : binToHex(controllerScript(hexToBin(identity)).lockingBytecode);
  const outside = lockingOf(elsewhere());
  const funds = kept.fundsAddress === '' ? '' : lockingOf(kept.fundsAddress);
  const payer = localPayerLocking();
  const deployerHex = binToHex(deployerLocking);
  const contracts = kept.deployment === undefined ? undefined : paryonContracts(kept.deployment);
  const paryonPlaces = new Map<string, string>();
  if (contracts !== undefined) {
    for (const [name, value] of Object.entries(contracts)) {
      const bytecode = (value as { lockingBytecode?: Uint8Array } | undefined)?.lockingBytecode;
      if (bytecode instanceof Uint8Array) paryonPlaces.set(binToHex(bytecode), `Paryon's ${name} contract`);
    }
  }
  for (const entry of wallet.activity) label(entry.transactionId, `${entry.who === 'old-phone' ? 'The owner\'s phone' : 'The new phone'}: ${entry.what}`);
  const placeOf = (lockingBytecode: string): string | undefined =>
    lockingBytecode === controller ? 'the wallet\'s controller (its identity token)' : lockingBytecode === outside ? `the outside address the coins went back to (${addressOf(outside)})` : lockingBytecode === funds ? 'the recoverer\'s balance' : lockingBytecode === payer ? 'the local payer (`scripts/local-pay.ts`)' : lockingBytecode === deployerHex ? 'the key that deployed Paryon\'s contracts, which gets Paryon\'s fee' : (paryonPlaces.get(lockingBytecode) ?? places.get(lockingBytecode));
  const ofController = await controllerLabels(identity);
  const labelOf = (transaction: LedgerTransaction): string | undefined => {
    const named = kept.labels[transaction.transactionId] ?? ofController.get(transaction.transactionId);
    if (named !== undefined) return named;
    const fromFunds = funds !== '' && transaction.inputs.some((input) => input.lockingBytecode === funds);
    if (fromFunds && transaction.outputs.some((output) => output.lockingBytecode === outside)) return 'The recoverer sends her balance back';
    if (fromFunds) return 'Paid from the recoverer\'s balance';
    if (transaction.inputs.some((input) => input.lockingBytecode === payer)) return 'The local payer pays';
    return undefined;
  };
  const urls = requests.urls();
  const beforePage = kept.requestsBeforePage === undefined ? urls : urls.slice(0, kept.requestsBeforePage);
  const toPage = urls.filter((url) => url.startsWith(LOAN_ORIGIN));
  const early = beforePage.filter((url) => url.startsWith(LOAN_ORIGIN));
  writeFileSync(
    recordFile('stage-17-loan-browser-local-node.md'),
    [
      '# Stage 17 in browsers on the local node: a ParyonUSD loan from its template alone, through the loss of a phone (PR20)',
      '',
      `Written by \`scripts/stage-17-loan-browser.ts${process.argv.slice(2).length === 0 ? '' : ` ${process.argv.slice(2).join(' ')}`}\` on ${new Date(started).toISOString().slice(0, 16).replace('T', ' ')} UTC. Chromium (Playwright), one browser profile per device kept on disk under \`${work.slice(root.length)}\`; the loan page is a second tab of the phone that uses it. The pages are this checkout's production builds (\`deploy/preview.sh build\`) served by \`deploy/serve.mjs\` with the content security policy at ${WALLET}, ${RECOVERER} and ${LOAN}, against the regtest node, with two backup stores and a relay for the sessions between the pages, all on this machine. Paryon's contracts as published (\`@paryonusd/contracts\` 1.1.0) were deployed on the local chain by the run (\`packages/paryon/src/local-deployment.ts\`, the price at $${(Number(PRICE) / 100).toFixed(2)}, periods of 10 blocks) and named to the loan page in its configuration; the oracle is not read for such a deployment. The run made the blocks and moved the chain's clock. The wallet reads no recovery declaration: the loan reached it as Paryon's template, in the page's requests of \`xo_v1\` version 2. Times in the log are seconds since the start.`,
      '',
      `Outcome: ${outcome}`,
      ...(kept.continued.length === 0 ? [] : ['', ...kept.continued]),
      '',
      ...(kept.deployment === undefined ? [] : [`Paryon's deployment on the local chain: PUSD \`${kept.deployment.tokenIds.paryon}\`, key factories \`${kept.deployment.tokenIds.loanKeyFactory}\`. The loan key: \`${kept.category}\`.`, '']),
      'What the run showed:',
      '',
      ...kept.facts.map((line) => `- ${line}`),
      '',
      '## The new phone\'s requests',
      '',
      ...requestsSection(requests, LOAN_ORIGIN, 'the loan page', toPage, kept.requestsBeforePage === undefined ? '' : `The loan page was first opened on the new phone after its ${kept.requestsBeforePage}th request; ${early.length === 0 ? 'none of the requests before went to the loan page\'s origin' : `${early.length} before then went to the loan page's origin`}, and the requests to that origin listed below are those of the page itself once it was opened, with the requests it made of the chain's server and the relay.`),
      '## Transactions and coins',
      '',
      `Read from the local node after the run: every transaction in the blocks after height ${kept.startHeight}, where the run started, and in the node's pool. The fee is what the inputs held less what the outputs hold; the size is that of the transaction as sent.`,
      '',
      ...ledgerSection(ledger, labelOf, placeOf),
      ...(kept.screens.length === 0 ? [] : ['## Pictures', '', `In \`docs/screens/\`, each at 390×844 (\`-phone\`) and 1280×800 (\`-desktop\`): ${kept.screens.map((name) => `\`live-loan-${name}\``).join(', ')}.`, '']),
      '## Log',
      '',
      '```',
      ...lines,
      '```',
      '',
    ].join('\n'),
  );
  log(`record written to ${recordFile('stage-17-loan-browser-local-node.md').slice(root.length)}`);
};

try {
  if (from > 1) {
    kept.continued.push(`The run was continued from step ${from} on ${new Date(started).toISOString().slice(0, 16).replace('T', ' ')} UTC with the same browser profiles; the line "continued from step ${from}" in the log marks where, and the times after it count from then.`);
    save();
    theCourse.note(`       continued from step ${from}`);
  }
  const deployment = await deploy();
  await prepare(['wallet', 'recoverer', 'loan'], { paryon: deployment });
  log(`   the run starts after block ${kept.startHeight}; Paryon's deployment "${deployment.name}" on ${config.network}, PUSD ${deployment.tokenIds.paryon.slice(0, 12)}…`);
  await steps();
  const all = state.step >= 11 && until >= 11;
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
