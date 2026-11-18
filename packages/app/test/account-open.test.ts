import type { Engine } from '@xo-cash/engine';
import { describe, expect, it } from 'vitest';

import { Account, HeaderCheckBehind } from '../src/account.js';

/** An engine of which only the header check is asked: it reports the heights it is given, one per question. */
const engineAt = (heights: { verifiedHeight: number; currentHeight: number }[]): Engine => {
  let asked = 0;
  return {
    getChainStatus: async () => heights[Math.min(asked++, heights.length - 1)],
  } as unknown as Engine;
};

describe('opening an account while the engine\'s header check stands behind the chain', () => {
  it('says that the check did not move at all, as one stuck on a block a reorganization took away', async () => {
    const opening = Account.open(engineAt([{ verifiedHeight: 336473, currentHeight: 336483 }]), { headerCheckTimeoutMs: 30, pollMs: 5 });
    await expect(opening).rejects.toBeInstanceOf(HeaderCheckBehind);
    await expect(opening).rejects.toMatchObject({ verifiedHeight: 336473, currentHeight: 336483, moved: false, message: 'The engine\'s header check stands at 336473 of 336483; what it reports cannot be relied on.' });
  });

  it('says that a check that went on but did not reach the tip in time moved', async () => {
    const heights = Array.from({ length: 50 }, (_, index) => ({ verifiedHeight: 300_000 + index, currentHeight: 336_483 }));
    await expect(Account.open(engineAt(heights), { headerCheckTimeoutMs: 30, pollMs: 5 })).rejects.toMatchObject({ moved: true });
  });
});
