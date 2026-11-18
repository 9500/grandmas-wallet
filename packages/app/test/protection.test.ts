import { describe, expect, it } from 'vitest';

import { type ProtectionInput, assessProtection, emptyWatchLog, noteWatching, unwatched } from '../src/protection.js';

/**
 * Acceptance test OP02 of the proposal: the device was not running for part of a wait. The wallet says that
 * it could not watch then; it does not show full protection.
 */

const T = 1_800_000_000;
/** A device that checks every minute from `from` to `to`. */
const running = (from: number, to: number, log = emptyWatchLog()) => {
  let next = log;
  for (let now = from; now <= to; now += 60) next = noteWatching(next, now);
  return next;
};
const quiet: ProtectionInput = { recovery: 'on', watch: { kind: 'quiet' }, log: running(T - 3600, T), now: T, chainVerified: true };
const requested = { kind: 'recovery-requested', proposedOwnerKeyHash: 'ab'.repeat(20), requestedIn: 'cd'.repeat(32), confirmed: true } as const;

describe('what the wallet says about its protection', () => {
  it('shows full protection only when recovery is on and the servers agree', () => {
    expect(assessProtection(quiet)).toEqual({ full: true, canRefuse: true, gaps: [], notWatched: [] });
    expect(assessProtection({ ...quiet, recovery: 'off' }).full).toBe(false);
    expect(assessProtection({ ...quiet, chainVerified: false }).full).toBe(false);
  });

  it('does not depend on a coin kept apart: a waiting request is shown, and can be refused', () => {
    const waiting = assessProtection({ ...quiet, watch: requested, wait: { from: T - 600, until: T + 3000 } });
    expect(waiting.canRefuse).toBe(true);
    expect(waiting.gaps).toEqual(['A recovery request is waiting. It can be refused for about 50 minutes more.']);
    expect(waiting.gaps.join(' ')).not.toMatch(/coin/);
  });

  it('OP02: a device that was not running for part of a wait says that it could not watch then', () => {
    // It ran until an hour and a half ago, was off for an hour, and has been running for half an hour. A request was made two hours ago.
    const log = running(T - 1800, T, running(T - 7200, T - 5400));
    expect(unwatched(log, T - 7200, T)).toEqual([{ from: T - 5400, to: T - 1800 }]);
    const stated = assessProtection({ ...quiet, log, watch: requested, wait: { from: T - 7200, until: T + 7200 } });
    expect(stated.full).toBe(false);
    expect(stated.notWatched).toEqual([{ from: T - 5400, to: T - 1800 }]);
    expect(stated.gaps[0]).toMatch(/^This device was not running for 60 minutes of the waiting period \(first from 2027-01-15 06:30 UTC to 2027-01-15 07:30 UTC\)\. It could not watch then\./);

    // A device that ran through the whole wait says nothing of the kind, and still does not call the wallet fully protected while a request waits.
    const through = assessProtection({ ...quiet, log: running(T - 7200, T), watch: requested, wait: { from: T - 7200, until: T + 7200 } });
    expect(through.notWatched).toEqual([]);
    expect(through.gaps).toEqual(['A recovery request is waiting. It can be refused for about 2 hours more.']);
    expect(through.full).toBe(false);

    // A device started for the first time after the request: it did not watch from the request until its start.
    const late = assessProtection({ ...quiet, log: running(T - 300, T), watch: requested, wait: { from: T - 3600, until: T - 60 } });
    expect(late.notWatched).toEqual([{ from: T - 3600, to: T - 300 }]);
    expect(late.gaps.at(-1)).toMatch(/its waiting period has passed/);
  });

  it('a break shorter than the longest silence allowed between two checks is not a gap', () => {
    const log = noteWatching(noteWatching(emptyWatchLog(), T), T + 170);
    expect(log.spans).toEqual([{ from: T, to: T + 170 }]);
    expect(noteWatching(log, T + 400).spans).toHaveLength(2);
    expect(unwatched(log, T, T + 170)).toEqual([]);
  });

  it('a wallet owned by another key, or closed, is not shown as protected at all', () => {
    expect(assessProtection({ ...quiet, watch: { kind: 'owned-elsewhere', ownerKeyHash: 'ab'.repeat(20), ownerEpoch: 2 } })).toMatchObject({ full: false, canRefuse: false });
    expect(assessProtection({ ...quiet, watch: { kind: 'closed', closedIn: 'cd'.repeat(32), confirmed: true } })).toMatchObject({ full: false, canRefuse: false });
  });
});
