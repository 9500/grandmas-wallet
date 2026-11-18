import { existsSync, readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

/**
 * The wallet course in a browser on the local node, with the wallet set up by its recoverer (proposal section 7.9).
 * This test does not repeat the run: it reads its record and checks that the recoverer created the wallet from its
 * own coins over the session of its code, that nothing waited for a block, that the lost phone's request and the
 * hand-over went over the session, and that the course went on to the end.
 */

const url = new URL('../docs/runs/wallet-set-up-local-node.md', import.meta.url);
const RECORD = existsSync(url) ? readFileSync(url, 'utf8') : undefined;

describe('the wallet course on the local node, the wallet set up by its recoverer, as recorded', () => {
  it.runIf(RECORD !== undefined)('the phone asked over the session, the recoverer created the wallet from its coins, and every step was carried out', () => {
    const record = RECORD ?? '';
    expect(record).toMatch(/^# The wallet course in a browser, against the local node, the wallet set up by its recoverer/);
    expect(record).toMatch(/^Outcome: every step was carried out/m);
    const steps = [...record.matchAll(/^\s*\d+ s {2}(\d+)\. /gm)].map((match) => Number(match[1]));
    expect(steps).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(record).toMatch(/relay: ws:\/\/127\.0\.0\.1:\d+, on this machine, for the sessions between the pages/);
    expect(record).not.toMatch(/was already served on port \d+, with the relays/);
    // The recoverer's balance is funded, and the wallet is created from it after one tap.
    expect(record).toMatch(/Anna's page shows her balance: \d+ satoshis/);
    expect(record).toMatch(/the phone asked over the session; Anna's page asks "Set up Grandma's wallet\?", the phone waits for her/);
    expect(record).toMatch(/the phone shows "Your wallet is ready" with 100,000 satoshis/);
    // Ready, and protected, before a block held the creation.
    expect(record).toMatch(/^- From "Set it up" to "Your wallet is ready": \d+ s; the chain is at height \d+; not in a block yet: the creation [0-9a-f]{12}…/m);
    expect(record).toMatch(/^- From "Set it up" to "Protected", recovery on: \d+ s; the chain is at height \d+; not in a block yet: the creation [0-9a-f]{12}…/m);
    // A lost phone's request over the session of the recoverer's code; the hand-over back the same way.
    expect(record).toMatch(/the new phone sent its request over the session of the code/);
    expect(record).toMatch(/the hand-over reached the new phone over the session/);
    expect(record).toMatch(/the fee of the refusal came from the wallet's coins; protected again/);
    expect(record).toMatch(/the kit reached Ben's page over the session of his code/);
    expect(record).not.toMatch(/allowance/);
    expect(record).not.toMatch(/page error:/);
  });
});
