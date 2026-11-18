import { existsSync, readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

/**
 * The browser courses run again on chipnet with this checkout's pages after the wallet stopped waiting for a
 * block (proposal section 17, "What still waits for a block"). These tests do not repeat a run: they read its
 * record and check that the steps that need no block went on before one held what they used.
 */

const read = (name: string): string | undefined => {
  const url = new URL(`../docs/runs/${name}`, import.meta.url);
  return existsSync(url) ? readFileSync(url, 'utf8') : undefined;
};
const WALLET = read('no-waits-browser-chipnet.md');
const JAR = read('no-waits-jar-browser-chipnet.md');

/** A line of the record's head about waits: the seconds it names and what was not in a block yet. */
const waitLine = (record: string, start: string): { seconds: number; open: string } => {
  const line = record.split('\n').find((candidate) => candidate.startsWith(`- ${start}`));
  expect(line, `the record has no line "${start}"`).toBeDefined();
  const [, seconds = '', open = ''] = /(\d+) s[^;]*; the chain is at height \d+; not in a block yet: ([^;]*); in a block: /.exec(line ?? '') ?? [];
  expect(seconds).not.toBe('');
  return { seconds: Number(seconds), open };
};

/** What the first steps of every course show: the wallet in use and recovery on before the creation is in a block. */
const firstSteps = (record: string): void => {
  expect(record).toMatch(/wallet page: http:\/\/localhost:8101\/, this checkout at [0-9a-f]{7}, chipnet/);
  expect(record).toMatch(/recoverer page: http:\/\/localhost:8102\/, this checkout at [0-9a-f]{7}, chipnet/);
  expect(record).toMatch(/the wallet's words among it, is copied to \S+ before anything is paid/);
  const inUse = waitLine(record, 'From the payment to the wallet in use, its kit link shown');
  expect(inUse.open).toMatch(/the creation [0-9a-f]{12}…/);
  expect(inUse.open).not.toMatch(/unknown to the server/);
  expect(inUse.seconds).toBeLessThan(60);
  expect(record).toMatch(/^- From the payment that funded the wallet to a wallet in use with recovery on \(\d+ s\), no step waited for a block: /m);
  const on = waitLine(record, 'From the payment to "Protected", recovery on');
  expect(on.seconds).toBeLessThan(120);
  expect(on.open).toMatch(/the creation [0-9a-f]{12}…/);
};

/** What a takeover shows: the hand-over and the sweep before the completion is in a block. */
/**
 * What a takeover shows: the hand-over and the sweep sent within seconds of the completion. With `beforeBlock`,
 * the completion was still not in a block when the sweep was sent; on chipnet a block can come within those
 * seconds, and a record where one did says that it cannot show this by itself.
 */
const takeover = (record: string, beforeBlock: boolean): void => {
  // The waiting period of the request is the wait that is kept: the request is in a block before it runs.
  expect(record).toMatch(/the request is in a block; the waiting period runs/);
  const [, handOver = ''] = /^- From the completion to the hand-over link: (\d+) s; the chain is at height \d+\.$/m.exec(record) ?? [];
  expect(Number(handOver)).toBeLessThan(60);
  const sweep = waitLine(record, 'From the completion to the sweep sent by the new phone');
  expect(sweep.open).toMatch(/"Moved \d+ coins from earlier addresses" [0-9a-f]{12}…/);
  expect(sweep.seconds).toBeLessThan(120);
  if (beforeBlock) {
    // When the new phone sent its sweep, neither the sweep nor the completion it rests on was in a block.
    expect(sweep.open).toMatch(/the completion [0-9a-f]{12}…/);
    expect(record).toMatch(/^- From the completed recovery to the swept coins, no step waited for a block: /m);
  } else {
    expect(record).toMatch(/^- (From the completed recovery to the swept coins, no step waited for a block: |When the new phone sent its sweep \(\d+ s after the completion\), a block held the completion already)/m);
  }
  expect(waitLine(record, 'From the completion to the swept coins in the new phone\'s wallet').seconds).toBeLessThan(300);
  expect(record).toMatch(/^- From the completion to "Protected" on the new phone: \d+ s\.$/m);
};

describe('the courses in browsers on chipnet without waits for a block, as recorded', () => {
  it.runIf(WALLET !== undefined)('the wallet course: in use and protected, paying, refusing, recovered and swept, moved and given a new recoverer, with no step waiting for a block but the waiting period', () => {
    const record = WALLET ?? '';
    expect(record).toMatch(/^# The wallet course in a browser, on chipnet with the pages of this checkout/);
    expect(record).toMatch(/^Outcome: every step was carried out/m);
    const steps = [...record.matchAll(/^\s*\d+ s {2}(\d+)\. /gm)].map((match) => Number(match[1]));
    expect(steps.filter((step, index) => step !== steps[index - 1])).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    firstSteps(record);
    // A payment from coins whose creation is not in a block yet.
    expect(waitLine(record, 'A payment from the wallet').open).toMatch(/"Sent [\d,]+ sat to [^"]+" [0-9a-f]{12}…/);
    // The vault address too is given before a block holds the creation.
    const vault = waitLine(record, 'From the payment to the vault address shown');
    expect(vault.open).toMatch(/the creation [0-9a-f]{12}…/);
    expect(vault.seconds).toBeLessThan(120);
    expect(record).not.toMatch(/vault address waits/);
    takeover(record, true);
    expect(waitLine(record, 'From the move link opened on the newer phone').seconds).toBeLessThan(300);
    expect(waitLine(record, 'From Ben keeping the kit to "Recovery is on with Ben"').seconds).toBeLessThan(300);
    // The coins went back to the funding address.
    expect(record).toMatch(/the wallet sent everything: [\d.]+ +BCH · [\d,]+ sat arrives, fee \d+ sat/);
    expect(record).toMatch(/Anna, no longer the recoverer, sent the rest of her allowance back/);
    expect(record.match(/funding address: \d+ satoshis in \d+ coins? at bchtest:qphf9jdtnrpag3dcu58r6uf8apf72kz6rynty9q77u/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it.runIf(JAR !== undefined)('the jar course: a jar opened from a wallet whose creation is not in a block yet, and emptied after the takeover once the jar\'s date had passed', () => {
    const record = JAR ?? '';
    expect(record).toMatch(/^# The jar course in a browser, on chipnet with the pages of this checkout: a savings jar through the loss of a phone/);
    expect(record).toMatch(/^Outcome: every step was carried out/m);
    expect(record).toMatch(/jar page: http:\/\/localhost:8103\/, this checkout at [0-9a-f]{7}, chipnet/);
    firstSteps(record);
    expect(waitLine(record, 'From the payment to the vault address shown').open).toMatch(/the creation [0-9a-f]{12}…/);
    // The jar was opened from coins of a wallet whose creation was not in a block yet.
    expect(waitLine(record, 'The jar opened from the wallet').open).toMatch(/the creation [0-9a-f]{12}…, "Open a savings jar · Savings Jar" [0-9a-f]{12}…/);
    takeover(record, false);
    // The jar's date is a wait of the jar itself, and it is said.
    expect(record).toMatch(/^- The jar's date, a time lock the network checks against the median time of the last eleven blocks/m);
    expect(record).toMatch(/the new phone's browser made \d+ requests, to [^;]+; none to the Savings Jar page \(http:\/\/localhost:8103\)/);
    expect(record.match(/^ +\d+ s {5}done: [0-9a-f]{64}$/gm)?.length).toBe(2);
    expect(record).toMatch(/the new phone sent everything to bchtest:\S+: [^;]+ arrives, fee [\d,]+ sat/);
    expect(record).toMatch(/Anna sent her fee coins back: Sent; the fee was \d+ satoshis/);
  });
});
