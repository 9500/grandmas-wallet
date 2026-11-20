import { existsSync, readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

/**
 * The ParyonUSD loan by script on chipnet (`scripts/run-e.ts`, run E, step 1) writes its own record. These
 * tests do not repeat the run: they read its record and check that it is of the complete course, with every
 * transaction named and every fee exactly the size. The transactions themselves, the repayment that leaves a
 * loan open among them, are checked in the virtual machine against Paryon's live outputs in
 * `packages/paryon/test/transactions.test.ts`.
 */

const STEPS = [
  'fund the wallet',
  'create',
  'pay the wallet',
  'create a loan key',
  'move the Borrowing thread on',
  'borrow',
  'manage, adding collateral',
  'close',
  'send the key on',
  'close the wallet',
  'return the allowance',
  'destroy the key',
];

const NAME = 'stage-9-loan-chipnet.md';
const recorded = existsSync(new URL(`../docs/runs/${NAME}`, import.meta.url));

const read = () => {
  const record = readFileSync(new URL(`../docs/runs/${NAME}`, import.meta.url), 'utf8');
  const rows = record
    .split('\n')
    .filter((line) => /^\| [a-z]/.test(line))
    .map((line) => line.split('|').map((cell) => cell.trim()))
    .map(([, step, transaction, bytes, fee, note]) => ({ step: step as string, transactionId: (transaction as string).replaceAll('`', ''), bytes: Number(bytes), fee: Number(fee), note: note as string }));
  return { record, rows };
};

describe('a ParyonUSD loan by script on chipnet, as recorded', () => {
  it.runIf(recorded)('PY01: a loan was opened, managed and closed from recoverable addresses by plain script, accepted by Paryon\'s contracts on chipnet', () => {
    const { record, rows } = read();
    expect(record).toMatch(/^# Stage 9 run on chipnet \(run E, step 1\): a ParyonUSD loan of 100\.00 PUSD by script, from recoverable addresses/);
    // A wallet whose funding coin was not the first output of its transaction pays itself first.
    expect(rows.map((row) => row.step).filter((step) => step !== 'prepare')).toEqual(STEPS);
    for (const row of rows) {
      expect(row.transactionId).toMatch(/^[0-9a-f]{64}$/);
      // 1 sat/byte, exactly.
      expect(row.fee).toBe(row.bytes);
    }
    expect(new Set(rows.map((row) => row.transactionId)).size).toBe(rows.length);
    expect(record).toMatch(/^Outcome: passed\./m);
    expect(record).toMatch(/unlocked by the everyday path of the recoverable address/);
    expect(record).toMatch(/the whole course \(\d+ transactions: create a loan key, move the Borrowing thread on, borrow, manage, adding collateral, close\) was built against Paryon's live outputs/);
    expect(record).toMatch(/The way out was proven right after the loan was opened: the closing transaction .* passed the virtual machine and testmempoolaccept on the owner's node/);
    expect(record).toMatch(/The loan was found from its key alone, through its sidecar/);
    expect(record).toMatch(/After the loan was opened, the wallet's own listing .* the loan key \(a minting NFT of its category\) and 100 PUSD at its recoverable addresses/);
    expect(rows.find((row) => row.step === 'borrow')?.note).toMatch(/the key, the PUSD and the change to three fresh addresses of the wallet/);
    expect(record).toMatch(/Nothing is left anywhere else/);
  });

  it.runIf(recorded)('PY04: managed without a repayment with the key back where it was; closed with the repaid PUSD and the loan\'s NFT burned; the repayment that leaves a loan open was not sent, and the record says why', () => {
    const { record, rows } = read();
    expect(rows.find((row) => row.step === 'manage, adding collateral')?.note).toMatch(/no repayment; the key back to the address it was spent from/);
    expect(record).toMatch(/The way out was proven after collateral was added/);
    expect(record).toMatch(/the key is at the same address as before \(true\)/);
    expect(rows.find((row) => row.step === 'close')?.note).toMatch(/the PUSD and the loan's own NFT burned in data outputs/);
    expect(record).toMatch(/After closing, the key opens no loan any more: the finder found none \(true\)/);
    expect(record).toMatch(/Managing with a repayment that leaves the loan open was not sent\. .* it needs a loan of at least 200\.00 PUSD/);
  });
});

const TEMPLATE_NAME = 'stage-9-template-chipnet.md';
const templateRecorded = existsSync(new URL(`../docs/runs/${TEMPLATE_NAME}`, import.meta.url));
const MOVE = 'move the Borrowing thread on';
const TEMPLATE_STEPS = ['fund the wallet', 'create', 'pay the wallet', 'create a loan key', 'borrow', 'manage, adding collateral', 'request', 'complete', 'sweep', 'close', 'send the key on', 'close the wallet', 'return the recoverer\'s balance', 'destroy the key'];

const readTemplateRun = () => {
  const record = readFileSync(new URL(`../docs/runs/${TEMPLATE_NAME}`, import.meta.url), 'utf8');
  const rows = record
    .split('\n')
    .filter((line) => /^\| [a-z]/.test(line))
    .map((line) => line.split('|').map((cell) => cell.trim()))
    .map(([, step, transaction, bytes, fee, note]) => ({ step: step as string, transactionId: (transaction as string).replaceAll('`', ''), bytes: Number(bytes), fee: Number(fee), note: note as string }));
  return { record, rows };
};

/**
 * Run E, steps 2 and 3 (`scripts/run-e-template.ts` at the tag `design-2`): the same loan through the wallet from the Paryon template,
 * and through the loss of the device. The transactions themselves are checked on the simulated chain against
 * Paryon's recorded outputs in `packages/paryon/test/applications.test.ts`.
 */
describe('a ParyonUSD loan through the wallet from the template on chipnet, as recorded', () => {
  it.runIf(templateRecorded)('PY02: the loan\'s actions were actions of the Paryon template, carried out by the wallet on the engine, accepted by Paryon\'s contracts on chipnet', () => {
    const { record, rows } = readTemplateRun();
    expect(record).toMatch(/^# Stage 9 run on chipnet \(run E, steps 2 and 3\)/);
    expect([...new Set(rows.map((row) => row.step).filter((step) => step !== 'prepare' && !step.endsWith(', not used') && step !== MOVE))]).toEqual(TEMPLATE_STEPS);
    for (const row of rows) {
      expect(row.transactionId).toMatch(/^[0-9a-f]{64}$/);
      expect(row.fee).toBe(row.bytes);
    }
    expect(new Set(rows.map((row) => row.transactionId)).size).toBe(rows.length);
    // The Borrowing thread is moved on only when it is behind the current period; a run that found it there says so.
    const moved = rows.some((row) => row.step === MOVE);
    if (!moved) expect(record).toMatch(/The Borrowing thread was not moved on: .* was in period \d+ already, the current one\./);
    for (const step of ['create a loan key', ...(moved ? [MOVE] : []), 'borrow', 'manage, adding collateral', 'close']) expect(rows.find((row) => row.step === step)?.note).toMatch(/^an action of the template/);
    expect(record).toMatch(/built by the unmodified engine, which signed the wallet's own inputs/);
    expect(record).toMatch(/the whole course \([45] transactions: .*\) was built by step 1's builders against Paryon's outputs/);
    expect(record).toMatch(/The way out was proven right after the loan was opened, twice: the closing through the template .* and the closing by plain script .* passed the virtual machine and testmempoolaccept on the owner's node/);
    expect(record).toMatch(/After managing, the key is at the same address as before \(true\)/);
    expect(record).toMatch(/^Outcome: passed\./m);
  });

  it.runIf(templateRecorded)('PY03: with the loan open the device was lost; the new device swept the key, found the loan from the template in the backup and the chain, and closed it from its own list of tokens', () => {
    const { record, rows } = readTemplateRun();
    const at = (step: string): number => rows.findIndex((row) => row.step === step);
    expect(at('borrow')).toBeLessThan(at('request'));
    expect(at('complete')).toBeLessThan(at('sweep'));
    expect(at('sweep')).toBeLessThan(at('close'));
    expect(rows.find((row) => row.step === 'sweep')?.note).toMatch(/the loan key and the PUSD among them/);
    expect(record).toMatch(/The new device found the loan from the swept key, with the template from the backup and the chain alone/);
    expect(record).toMatch(/The way out was proven after the takeover, with the new seed, twice/);
    expect(rows.find((row) => row.step === 'close')?.note).toMatch(/from the new device's own list of tokens, every value read from the chain/);
    expect(record).toMatch(/Nothing is left anywhere else/);
  });
});

const BROWSER_NAME = 'stage-9-browser-chipnet.md';
const browserRecorded = existsSync(new URL(`../docs/runs/${BROWSER_NAME}`, import.meta.url)) && /^Outcome: every step was carried out/m.test(readFileSync(new URL(`../docs/runs/${BROWSER_NAME}`, import.meta.url), 'utf8'));

/**
 * The same loan in browsers (`scripts/browser-run-loan.ts chipnet --local-pages` at the tag `design-2`): the wallet page driven by the
 * loan page of this project over WizardConnect, and after the loss of the phone, the new phone's wallet page alone.
 */
describe('a ParyonUSD loan in browsers on chipnet, from the loan page, as recorded', () => {
  it.runIf(browserRecorded)('PY02 (browser): the loan page paired with the wallet and had it make a key, borrow and add collateral, each an action of the template the wallet showed and the user approved', () => {
    const record = readFileSync(new URL(`../docs/runs/${BROWSER_NAME}`, import.meta.url), 'utf8');
    expect(record).toMatch(/^# Stage 9 scripted run in a browser, on chipnet/);
    expect(record).toMatch(/loan page: http:\/\/localhost:8104\/, this checkout at [0-9a-f]{7}, chipnet/);
    expect(record).toMatch(/The wallet was paired with the loan page over WizardConnect/);
    expect(record).toMatch(/it says: "An independent demonstration on chipnet, Bitcoin Cash's test network\. This page is not Paryon's site/);
    // The key: the first request of the page, for a template the wallet did not have; shown, approved and carried out.
    expect(record).toMatch(/making a loan key: template "ParyonUSD loan \(chipnet-fast-periods-6\)", "Not verified"/);
    expect(record).toMatch(/it says: "This wallet does not have this template yet\. Approving trusts it on this phone, and stores it in your backup first/);
    expect(record).toMatch(/approved; the wallet: "Done: Make a loan key", transaction [0-9a-f]{64}/);
    // Each part of the run that stopped is named, with where the next took over.
    expect(record.match(/^ +\d+ s {2}FAILED at step \d+: /gm)?.length ?? 0).toBe(record.match(/^ +continued from step \d+ on /gm)?.length ?? 0);
    expect(record).toMatch(/Before anything of the loan was sent, the whole course, by script from the wallet's words on disk, .* passed the virtual machine/);
    expect(record).toMatch(/The loan page borrowed 100\.00 PUSD at \d+% collateral at the lower price/);
    expect(record).toMatch(/Tokens: Your wallet receives Of token e7979ccd…30e6b8 \+10,000 units/);
    expect(record).toMatch(/The page then listed the loan, found through the wallet's answer to its question about the template's tokens and read from the chain: 100\.00 ?PUSD; Collateral: /);
    expect(record).toMatch(/The way out was proven right after the loan was opened, from the first phone's words on disk and the chain alone, without the browser: .* passed the virtual machine and testmempoolaccept/);
    expect(record).toMatch(/The loan page added 0\.001 BCH of collateral/);
    expect(record).toMatch(/The way out was proven after collateral was added/);
    for (const step of ['a loan key, asked by the loan page', 'borrow 100.00 PUSD, asked by the loan page', 'collateral added, asked by the loan page']) expect(record).toMatch(new RegExp(`^\\| ${step.replace(/[.()]/g, '\\$&')} \\| \`[0-9a-f]{64}\` \\|$`, 'm'));
  });

  it.runIf(browserRecorded)('PY03 (browser): after the loss of the phone the new phone found the loan from the swept key and the template in the backup, and closed it from its own list of tokens without the loan page', () => {
    const record = readFileSync(new URL(`../docs/runs/${BROWSER_NAME}`, import.meta.url), 'utf8');
    const at = (text: string): number => record.indexOf(text);
    expect(at('The phone is lost, with the loan open')).toBeGreaterThan(at('The loan page adds collateral'));
    expect(record).toMatch(/On the new phone the swept loan key was listed; once the template stored in the backup was trusted, the wallet found the loan from the key and the chain: Holds [^;]+; Debt: 10,000 units; Collateral: /);
    expect(record).toMatch(/The way out was proven after the takeover, from the new phone's words on disk/);
    expect(record).toMatch(/The new phone closed the loan from its own list of tokens, with the loan page not opened \(transaction `[0-9a-f]{64}`\)/);
    expect(record).toMatch(/Destroyed: PUSD repaid/);
    expect(record).toMatch(/new phone's browser made \d+ requests, to .*: none to the loan page \(http:\/\/localhost:8104\)/);
    expect(record).toMatch(/the key is still listed: "[^"]+" \(Closed\), "It holds nothing now\."/);
    expect(record).toMatch(/At the end the coins went back to bchtest:\S+, the address that paid for the run/);
  });
});
