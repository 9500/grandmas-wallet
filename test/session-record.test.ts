import { existsSync, readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

/**
 * The wallet course in a browser on the local node, with the recoverer set up through the session its code offers
 * (proposal section 14.4). This test does not repeat the run: it reads its record and checks that the wallet was
 * made with one scan, that the kit went straight to the recoverer's page, and that the course went on to the end.
 */

const url = new URL('../docs/runs/wallet-session-local-node.md', import.meta.url);
const RECORD = existsSync(url) ? readFileSync(url, 'utf8') : undefined;

describe('the wallet course on the local node, the recoverer set up with one scan, as recorded', () => {
  it.runIf(RECORD !== undefined)('the code carried a session through a relay on this machine, the kit arrived on the recoverer\'s open page, and every step was carried out', () => {
    const record = RECORD ?? '';
    expect(record).toMatch(/^# The wallet course in a browser, against the local node, the recoverer set up with one scan/);
    expect(record).toMatch(/^Outcome: every step was carried out/m);
    const steps = [...record.matchAll(/^\s*\d+ s {2}(\d+)\. /gm)].map((match) => Number(match[1]));
    expect(steps).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    // The sessions went through a relay on this machine, which the pages were served with.
    expect(record).toMatch(/relay: ws:\/\/127\.0\.0\.1:\d+, on this machine, for the sessions between the pages/);
    expect(record).not.toMatch(/was already served on port \d+, with the relays/);
    expect(record).toMatch(/wallet page: http:\/\/localhost:8101\/, this checkout at [0-9a-f]{7}, regtest/);
    expect(record).toMatch(/recoverer page: http:\/\/localhost:8102\/, this checkout at [0-9a-f]{7}, regtest/);
    // One scan: the code carries more than the link, the phone connects, and the kit goes straight to the page.
    const [, link = '0'] = /link of (\d+) characters/.exec(record) ?? [];
    const [, code = '0'] = /the code on "Your link" carries the link and a session, (\d+) characters/.exec(record) ?? [];
    expect(Number(code)).toBeGreaterThan(Number(link));
    expect(record).toMatch(/the recoverer's page shows that a phone is connected/);
    expect(record).toMatch(/created; the wallet sends the kit to Anna's page \(its link, \d+ characters, folded away\)/);
    expect(record).toMatch(/the wallet shows that Anna's page has the kit/);
    expect(record).toMatch(/the kit arrived on Anna's page, still on "Your link"/);
    expect(record).not.toMatch(/offers no session with its code/);
    expect(record).toMatch(/the recoverer kept the kit and left its receipt/);
    // Recovery on before a block held the creation; refusing paid from the wallet's coins.
    expect(record).toMatch(/^- From the payment to "Protected", recovery on: \d+ s; the chain is at height \d+; not in a block yet: the creation [0-9a-f]{12}…/m);
    expect(record).toMatch(/the fee of the refusal came from the wallet's coins; protected again/);
    expect(record).toMatch(/Anna, no longer the recoverer, sent the rest of her allowance back/);
    expect(record).not.toMatch(/page error:/);
  });
});
