import {
  type Allocation,
  ADDRESS_KIND,
  ADDRESS_RANGE,
  ADDRESS_WINDOW,
  allocationFromUsed,
  emptyAllocation,
  keepNumber,
  markUsed,
  returnNumber,
  takeNumber,
  watchedNumbers,
} from '@grandmas-wallet/core';
import { describe, expect, it } from 'vitest';

/**
 * Acceptance tests KV08, KV09 and the first half of KV11 of the proposal: giving out addresses inside a
 * window and a range.
 */

const { givenOut, change, vault } = ADDRESS_KIND;

/** Take a number that must be given, and keep it as shown. */
const give = (allocation: Allocation, kind: 0 | 1 | 2): { allocation: Allocation; number: number } => {
  const result = takeNumber(allocation, kind);
  if (!('number' in result)) throw new Error(`refused: ${result.refused.reason}`);
  return { allocation: keepNumber(result.allocation, kind, result.number), number: result.number };
};
const giveMany = (allocation: Allocation, kind: 0 | 1 | 2, count: number): { allocation: Allocation; numbers: number[] } => {
  const numbers: number[] = [];
  let current = allocation;
  for (let n = 0; n < count; n++) {
    const next = give(current, kind);
    numbers.push(next.number);
    current = next.allocation;
  }
  return { allocation: current, numbers };
};

describe('the windows', () => {
  it.each([
    ['given out', givenOut, 20],
    ['change', change, 5],
    ['vault', vault, 5],
  ] as const)('KV08: %s: one more unused address than the window holds is not given', (_name, kind, window) => {
    expect(ADDRESS_WINDOW[kind]).toBe(window);
    const { allocation, numbers } = giveMany(emptyAllocation(), kind, window);
    expect(numbers).toEqual(Array.from({ length: window }, (_, n) => n));
    const refused = takeNumber(allocation, kind);
    // An address already given out is offered instead, and nothing changes.
    expect(refused).toEqual({ allocation, refused: { reason: 'window-full', offer: 0 } });

    // Once an address is used, the window moves on from it.
    const moved = markUsed(allocation, kind, 2);
    const afterUse = giveMany(moved, kind, 3);
    expect(afterUse.numbers).toEqual([window, window + 1, window + 2]);
    expect(takeNumber(afterUse.allocation, kind)).toMatchObject({ refused: { reason: 'window-full', offer: 0 } });
    // The offer is the oldest address given out that is still unused.
    expect(takeNumber(markUsed(markUsed(afterUse.allocation, kind, 0), kind, 1), kind)).toMatchObject({ refused: { reason: 'window-full', offer: 3 } });
  });

  it('KV08: two requests at once get different numbers, and the second is refused at the limit', () => {
    const nearly = giveMany(emptyAllocation(), change, 4).allocation;
    const first = takeNumber(nearly, change);
    if (!('number' in first)) throw new Error('refused');
    // The second request is served from the state the first one left, before either address is shown.
    const second = takeNumber(first.allocation, change);
    expect(first.number).toBe(4);
    expect(second).toMatchObject({ refused: { reason: 'window-full' } });

    const start = takeNumber(emptyAllocation(), givenOut);
    if (!('number' in start)) throw new Error('refused');
    const other = takeNumber(start.allocation, givenOut);
    expect('number' in other && other.number).toBe(1);
    expect(start.number).toBe(0);
  });

  it('KV08: no number is given twice or past a limit, however giving and using alternate', () => {
    let allocation = emptyAllocation();
    const given = new Set<number>();
    let highestUsed = -1;
    for (let round = 0; round < 400; round++) {
      const result = takeNumber(allocation, givenOut);
      if ('number' in result) {
        expect(given.has(result.number)).toBe(false);
        expect(result.number).toBeLessThanOrEqual(highestUsed + ADDRESS_WINDOW[givenOut]);
        given.add(result.number);
        allocation = keepNumber(result.allocation, givenOut, result.number);
      } else {
        // Someone pays an address near the end of the window.
        highestUsed = Math.max(...given) - (round % 3);
        allocation = markUsed(allocation, givenOut, highestUsed);
      }
    }
    expect(given.size).toBeGreaterThan(300);
  });
});

describe('an action that is not carried out', () => {
  it('KV09: the number is used again only if the address was never shown and nothing was signed', () => {
    const taken = takeNumber(emptyAllocation(), change);
    if (!('number' in taken)) throw new Error('refused');
    expect(taken.number).toBe(0);

    // Abandoned before the address was shown: the same number is handed out next.
    const abandoned = returnNumber(taken.allocation, change, 0);
    const again = takeNumber(abandoned, change);
    expect('number' in again && again.number).toBe(0);

    // Shown, or a signature left the wallet: the number stays taken, and the address stays watched.
    for (const reason of ['shown', 'signed']) {
      const kept = keepNumber(taken.allocation, change, 0);
      const next = takeNumber(kept, change);
      expect('number' in next && next.number, reason).toBe(1);
      expect(watchedNumbers(kept, change)).toContain(0);
      // What was kept cannot be given back afterwards.
      expect(() => returnNumber(kept, change, 0)).toThrow(/not held/);
    }
  });

  it('KV09: a number given back is still watched while it is inside the window', () => {
    const taken = takeNumber(emptyAllocation(), givenOut);
    if (!('number' in taken)) throw new Error('refused');
    const abandoned = returnNumber(taken.allocation, givenOut, 0);
    expect(watchedNumbers(abandoned, givenOut)).toContain(0);
    // The window beyond the last used address is watched even when nothing in it was given out.
    expect(watchedNumbers(emptyAllocation(), givenOut)).toEqual(Array.from({ length: 20 }, (_, n) => n));
    expect(watchedNumbers(markUsed(emptyAllocation(), givenOut, 7), givenOut).at(-1)).toBe(27);
  });
});

describe('a range that is used up', () => {
  it('KV11: no number at or above the size of the range; an address is offered to use again', () => {
    const last = ADDRESS_RANGE[vault] - 1;
    // A device that knows only which addresses a search found in use.
    const nearEnd = allocationFromUsed([{ kind: vault, number: last - 1 }]);
    const final = give(nearEnd, vault);
    expect(final.number).toBe(last);
    const refused = takeNumber(final.allocation, vault);
    expect(refused).toMatchObject({ refused: { reason: 'range-used-up' } });
    expect('refused' in refused && refused.refused.offer).toBeLessThanOrEqual(last);
    expect(watchedNumbers(final.allocation, vault).at(-1)).toBe(last);
    expect(() => markUsed(final.allocation, vault, last + 1)).toThrow(/numbered 0 to 999/);
    // The other kinds are not affected.
    expect(give(final.allocation, givenOut).number).toBe(0);
  });

  it('KV11: a device with no record of what was given out starts past everything a search found', () => {
    const restored = allocationFromUsed([
      { kind: givenOut, number: 3 },
      { kind: givenOut, number: 41 },
      { kind: change, number: 0 },
    ]);
    expect(give(restored, givenOut).number).toBe(42);
    expect(give(restored, change).number).toBe(1);
    expect(give(restored, vault).number).toBe(0);
  });
});
