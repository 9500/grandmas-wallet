import { existsSync, readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

/**
 * The runs of the Savings Jar through this project's wallet on the XO engine (`scripts/run-d.ts` at the tag `design-2`) write
 * their own records. These tests do not repeat a run: they read its record and check that it is of the
 * complete course, with every transaction named and every fee exactly the size.
 */

const STEPS = ['create', 'open the jar', 'request', 'complete', 'sweep', 'empty the jar', 'empty the jar again', 'send the key on', 'close', 'return the recoverer\'s balance'];

const read = (name: string) => {
  const record = readFileSync(new URL(`../docs/runs/${name}`, import.meta.url), 'utf8');
  const rows = record
    .split('\n')
    .filter((line) => /^\| [a-z]/.test(line))
    .map((line) => line.split('|').map((cell) => cell.trim()))
    .map(([, step, transaction, bytes, fee]) => ({ step: step as string, transactionId: (transaction as string).replaceAll('`', ''), bytes: Number(bytes), fee: Number(fee) }));
  return { record, rows };
};

const complete = (name: string): string => {
  const { record, rows } = read(name);
  // A wallet whose funding coin was not the first output of its transaction pays itself first.
  expect(rows.map((row) => row.step).filter((step) => step !== 'prepare')).toEqual(STEPS);
  for (const row of rows) {
    expect(row.transactionId).toMatch(/^[0-9a-f]{64}$/);
    // 1 sat/byte, exactly.
    expect(row.fee).toBe(row.bytes);
  }
  expect(new Set(rows.map((row) => row.transactionId)).size).toBe(rows.length);
  expect(record).toMatch(/Emptying the jar before its date was refused by the network: "non-final"\./);
  expect(record).toMatch(/The sweep reported the jar's key as a token of unknown meaning/);
  expect(record).toMatch(/it is not trusted on this device yet/);
  expect(record).toMatch(/The new device finds the jar from the swept key and the template, with the application's site not consulted: open, 30000 satoshis/);
  expect(record).toMatch(/After the withdrawal the key is still in the wallet/);
  expect(record).toMatch(/8,000 satoshis that someone paid in after the first withdrawal, with the same key/);
  expect(record).toMatch(/then closed\. It has had 2 owners\./);
  expect(record).toMatch(/Nothing is left anywhere else\./);
  return record;
};

describe('a savings jar through the loss of a device, as recorded', () => {
  it('on the local node: a jar was opened, the device lost, the wallet recovered, and the new device found the jar from the swept key and emptied it, twice', () => {
    expect(complete('stage-8-local-node.md')).toMatch(/^# Stage 8 run on the local node/);
  });

  const onChipnet = existsSync(new URL('../docs/runs/stage-8-chipnet.md', import.meta.url));
  it.runIf(onChipnet)('SJ02: a jar was opened, paid into and emptied with this wallet on chipnet', () => {
    expect(complete('stage-8-chipnet.md')).toMatch(/^# Stage 8 run on chipnet \(run D, this wallet\)/);
  });

  // `scripts/jar-cashonize.ts`: the Cashonize web wallet, unmodified, with this project's jar page.
  const withCashonize = existsSync(new URL('../docs/runs/stage-8-cashonize-chipnet.md', import.meta.url));
  const CASHONIZE_STEPS = ['fund the wallet', 'open the jar', 'empty the jar', 'pay in', 'empty the jar again', 'pay in again', 'empty the jar a third time', 'return'];

  it.runIf(withCashonize)('SJ03: an ordinary wallet (Cashonize) opened a savings jar with the jar page on chipnet, and emptied it three times, every transaction named and paid for', () => {
    const { record, rows } = read('stage-8-cashonize-chipnet.md');
    expect(record).toMatch(/^# Stage 8 run on chipnet \(SJ03, an ordinary wallet\)/);
    expect(record).toMatch(/^- Date: \d{4}-\d{2}-\d{2}$/m);
    expect(record).toMatch(/^- Cashonize: .+$/m);
    expect(rows.map((row) => row.step)).toEqual(CASHONIZE_STEPS);
    for (const row of rows) {
      expect(row.transactionId).toMatch(/^[0-9a-f]{64}$/);
      // At least 1 sat/byte; the page allows a few satoshis per input for a longer signature.
      expect(row.fee).toBeGreaterThanOrEqual(row.bytes);
      expect(row.fee).toBeLessThan(row.bytes * 2);
    }
    expect(new Set(rows.map((row) => row.transactionId)).size).toBe(rows.length);
    expect(record).toMatch(/^Outcome: passed/m);
  });

  it.runIf(withCashonize)('SJ03: Cashonize connected to the page as an ordinary wallet and signed what the page built, after showing it', () => {
    const { record } = read('stage-8-cashonize-chipnet.md');
    expect(record).toMatch(/The jar page shows a connection address `wiz:\/\//);
    expect(record).toMatch(/Cashonize, given the address in its Connect screen, asked: "SHARE WALLET ADDRESSES WITH THIS DAPP\?/);
    expect(record).toMatch(/The jar page says: "Connected to Cashonize An ordinary wallet\. This page builds each transaction and your wallet signs it\./);
    expect(record).toMatch(/Opening: Cashonize asked "SIGN TRANSACTION Open a savings jar with [\d,]+ satoshis/);
    expect(record).toMatch(/Emptying: Cashonize asked "SIGN TRANSACTION Empty a savings jar/);
    expect(record).toMatch(/Paying in: Cashonize asked "SIGN TRANSACTION Pay [\d,]+ satoshis into a savings jar/);
    expect(record).toMatch(/Emptying again: Cashonize asked "SIGN TRANSACTION Empty a savings jar/);
    expect(record).toMatch(/Emptying a third time, with the rebuilt page: Cashonize asked "SIGN TRANSACTION Empty a savings jar/);
  });

  it.runIf(withCashonize)('SJ03: with the page rebuilt after the run\'s findings, the list agrees with an outcome as soon as it is shown', () => {
    const { record } = read('stage-8-cashonize-chipnet.md');
    // Before the fix the list still showed the emptied jar with its old amount; after it, the jar is listed as emptied.
    expect(record).toMatch(/Emptying: when the page said "The jar is emptied\.", it still listed the jar as "[^"]*Ready to empty/);
    expect(record).toMatch(/From "pay in again" on, the jar page was built from commit `[0-9a-f]+` with uncommitted changes to [^.]*`apps\/jar\/src\/main\.tsx`/);
    expect(record).toMatch(/Emptying a third time, with the rebuilt page: when the page said "The jar is emptied\.", it listed the jar as "[^"]*Empty [^"]*Emptied\./);
  });

  it.runIf(withCashonize)('SJ03: the page offered no withdrawal before the date, and on chain the jar was at the contract\'s address, ends empty, and its key stays with Cashonize', () => {
    const { record } = read('stage-8-cashonize-chipnet.md');
    expect(record).toMatch(/Before its date the page offers no way to empty the jar: no "Empty the jar" button; the jar shows "[^"]*Locked/);
    expect(record).toMatch(/the opening output is at the address `savingsJarScript\(category, unlockTime\)` gives for the key's category and date: true\./);
    expect(record).toMatch(/On chain the jar address holds 0 satoshis in 0 outputs/);
    expect(record).toMatch(/the key is still held by Cashonize: .* carries the key: true\./);
    // What was not spent on fees went back to the funding address, except the key's own satoshis.
    expect(record).toMatch(/The funding address held \d+ satoshis before the run and holds \d+ after it.* The run cost \d+ satoshis: \d+ in fees for its 8 transactions and the 1000 satoshis that stay with the jar's key\./);
  });

  it.runIf(onChipnet)('SJ04: on chipnet the device was lost with a jar open, and the new device found the jar from the swept key, with the application\'s site not consulted, and emptied it', () => {
    const record = complete('stage-8-chipnet.md');
    expect(record).toMatch(/on chipnet/);
    expect(record).toMatch(/No application takes part|with the application's site not consulted/);
  });

  // `scripts/browser-run-jar.ts` at the tag `design-2`: the wallet page, the recoverer page and the jar page in real browsers.
  it('SJ04: in real browsers, a new phone found the jar from the swept key and the template without a request to the jar page, and emptied it twice', () => {
    const record = readFileSync(new URL('../docs/runs/stage-8-browser-local-node.md', import.meta.url), 'utf8');
    expect(record).toMatch(/^Outcome: every step was carried out\.$/m);
    expect(record).toMatch(/template "Savings Jar", "Template not verified"/);
    expect(record).toMatch(/stores it in your backup first, before anything is signed/);
    expect(record).toMatch(/"Not carried out": "The network does not take this transaction yet/);
    expect(record).toMatch(/it is not trusted on this device yet/);
    expect(record).toMatch(/trusted; the key: "Jar key · Savings Jar" \(Open\), "Holds 0\.0003 BCH · 30,000 sat"/);
    expect(record).toMatch(/the new phone's browser made \d+ requests, to [^;]+; none to the Savings Jar page/);
    expect(record).toMatch(/the key is still listed: "Jar key · Savings Jar" \(Closed\)/);
    expect(record).toMatch(/the key: \(Open\), "Holds 0\.00008 BCH · 8,000 sat"/);
    expect(record.match(/^ +\d+ s {5}done: [0-9a-f]{64}$/gm)?.length).toBe(2);
    expect(record).toMatch(/allowed; the Savings Jar page lists, from the wallet's answer/);
    // The template stopped being trusted, the key stayed, and the page's offer of its template brought the jar back.
    expect(record).toMatch(/the wallet no longer trusts the template: its list says "Savings Jar Not trusted · you stopped trusting it/);
    expect(record).toMatch(/the key is still in the wallet: "A note says the template "Savings Jar" made this token\. You stopped trusting that template\."/);
    expect(record).toMatch(/the page offers its template; the wallet: "Savings Jar offers its template"/);
    expect(record).toMatch(/trusted again in the wallet \("Savings Jar Trusted · in your backup[^)]*"\); the Savings Jar page lists the jar again/);
  });

  // The same course on chipnet with the public pages. A run that stopped and was continued says so, and what that means.
  const browserOnChipnet = existsSync(new URL('../docs/runs/stage-8-browser-chipnet.md', import.meta.url));
  it.runIf(browserOnChipnet)('SJ04: on chipnet with the public pages, a new phone found the jar from the swept key and the template, emptied it twice, and the coins went back', () => {
    const record = readFileSync(new URL('../docs/runs/stage-8-browser-chipnet.md', import.meta.url), 'utf8');
    expect(record).toMatch(/^Outcome: every step was carried out/m);
    expect(record).toMatch(/on chipnet with the public pages/);
    expect(record).toMatch(/jar page: https:\/\/jar\.9500\.cash\/, commit [0-9a-f]{7}/);
    // Each part that stopped is named; a continuation from step 9 says what the request list does and does not cover.
    const parts = record.match(/^ +continued from step (\d+) on /gm)?.length ?? 0;
    expect(record.match(/^A part of the run stopped: /gm)?.length ?? 0).toBe(parts);
    if (/continued from step 9 on/.test(record)) expect(record).toMatch(/the requests of the new phone's browser were recorded only in the continued part[^\n]*none of the Savings Jar page \(https:\/\/jar\.9500\.cash\)[^\n]*it does not show, as a recording would/);
    expect(record).toMatch(/template "Savings Jar", "Not verified"/);
    expect(record).toMatch(/"Not carried out": "The network does not take this transaction yet/);
    expect(record).toMatch(/it is not trusted on this device yet/);
    // The withdrawal waited for the network's clock, not the wall clock.
    expect(record).toMatch(/the chain's median time is \S+ at height \d+, past the jar's date/);
    expect(record).toMatch(/the new phone's browser made \d+ requests, to [^;]+; none to the Savings Jar page \(https:\/\/jar\.9500\.cash\)/);
    expect(record.match(/^ +\d+ s {5}done: [0-9a-f]{64}$/gm)?.length).toBe(2);
    expect(record).toMatch(/the key: \(Open\), "Holds 0\.00008 BCH · 8,000 sat"/);
    expect(record).toMatch(/allowed; the Savings Jar page lists, from the wallet's answer/);
    expect(record).toMatch(/the new phone sent everything to bchtest:\S+: [^;]+ arrives, fee [\d,]+ sat/);
    expect(record).toMatch(/Anna sent her fee coins back: Sent; the fee was \d+ satoshis/);
    expect(record).toMatch(/What is left: the jar's key, an NFT on a coin of 1,000 satoshis, in the new phone's wallet/);
  });
});
