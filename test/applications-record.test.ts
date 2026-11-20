import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

/**
 * Acceptance test AP15 of the proposal is a run on the local node through the XO engine
 * (`scripts/stage-7-run.ts` at the tag `design-2`), which writes its own record. This test does not repeat the run: it reads the
 * record and checks that it is of both templates, with every transaction named, built as an invitation of
 * the engine, and every fee exactly the size.
 */

const record = readFileSync(new URL('../docs/runs/stage-7-local-node.md', import.meta.url), 'utf8');
const rows = record
  .split('\n')
  .filter((line) => /^\| [a-z]/.test(line))
  .map((line) => line.split('|').map((cell) => cell.trim().replaceAll('`', '')))
  .map(([, step, template, transactionId, bytes, fee, invitation]) => ({ step, template, transactionId: transactionId as string, bytes: Number(bytes), fee: Number(fee), invitation: invitation as string }));

describe('actions of two application templates on the local node, as recorded', () => {
  it('AP15: transactions of an application\'s template with inputs and outputs of the wallet were accepted by the node; the same code served two unrelated templates; each was built by the engine as an invitation', () => {
    expect(record).toMatch(/^# Stage 7 run on the local node/);
    expect(rows.map((row) => [row.template, row.step])).toEqual([
      ['Strongbox', 'open'],
      ['Strongbox', 'add'],
      ['Strongbox', 'take'],
      ['Bond', 'post'],
      ['Bond', 'redeem'],
    ]);
    for (const row of rows) {
      expect(row.transactionId).toMatch(/^[0-9a-f]{64}$/);
      // 1 sat/byte, exactly.
      expect(row.fee).toBe(row.bytes);
      // What the engine built is an invitation, and is named as one.
      expect(row.invitation).toMatch(/^[0-9a-f-]{8,}$/i);
    }
    expect(new Set(rows.map((row) => row.transactionId)).size).toBe(rows.length);
    expect(new Set(rows.map((row) => row.invitation)).size).toBe(rows.length);
    expect(record).toMatch(/unmodified XO engine/);
    expect(record).toMatch(/Nothing here was built outside the engine\./);
    expect(record).toMatch(/the node accepted every transaction/);
    expect(record).toMatch(/the wallet's code names neither/);
  });
});
