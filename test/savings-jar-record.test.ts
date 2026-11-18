import { existsSync, readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

/**
 * The runs of the Savings Jar through this project's wallet on the XO engine (`scripts/run-d.ts`) write
 * their own records. These tests do not repeat a run: they read its record and check that it is of the
 * complete course, with every transaction named and every fee exactly the size.
 */

const STEPS = ['create', 'open the jar', 'request', 'complete', 'sweep', 'empty the jar', 'empty the jar again', 'send the key on', 'close', 'return the allowance'];

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

  it.runIf(onChipnet)('SJ04: on chipnet the device was lost with a jar open, and the new device found the jar from the swept key, with the application\'s site not consulted, and emptied it', () => {
    const record = complete('stage-8-chipnet.md');
    expect(record).toMatch(/on chipnet/);
    expect(record).toMatch(/No application takes part|with the application's site not consulted/);
  });
});
