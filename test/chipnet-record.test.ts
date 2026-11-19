import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

/**
 * Acceptance test SW02 of the proposal is a run on chipnet through the XO engine (`scripts/run-b.ts chipnet`),
 * which writes its own record. This test does not repeat the run: it reads the record and checks that it is
 * of a complete course, with every transaction named and every fee exactly the size.
 */

const record = readFileSync(new URL('../docs/runs/stage-5-chipnet.md', import.meta.url), 'utf8');
const rows = record
  .split('\n')
  .filter((line) => /^\| [a-z]/.test(line))
  .map((line) => line.split('|').map((cell) => cell.trim()))
  .map(([, step, transaction, bytes, fee]) => ({ step: step as string, transactionId: (transaction as string).replaceAll('`', ''), bytes: Number(bytes), fee: Number(fee) }));

describe('the complete course on chipnet, as recorded', () => {
  it('SW02: a wallet was created, recovered to a new device, swept and closed on chipnet through the engine, with its transactions', () => {
    expect(record).toMatch(/^# Stage 5 run on chipnet \(run B\)/);
    expect(rows.map((row) => row.step)).toEqual(['create', 'pay', 'request', 'complete', 'sweep', 'pay', 'send the NFT', 'close', 'return the recoverer\'s balance']);
    for (const row of rows) {
      expect(row.transactionId).toMatch(/^[0-9a-f]{64}$/);
      // 1 sat/byte, exactly.
      expect(row.fee).toBe(row.bytes);
    }
    expect(new Set(rows.map((row) => row.transactionId)).size).toBe(rows.length);
    expect(record).toMatch(/Completing right after the request was refused: "non-BIP68-final"/);
    expect(record).toMatch(/the wallet was then "fully-found"/);
    expect(record).toMatch(/then closed\. It has had 2 owners\./);
    expect(record).toMatch(/Nothing is left anywhere else\./);
  });
});
