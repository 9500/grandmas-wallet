import { describe, expect, it } from 'vitest';

import { plainRefusal } from '../apps/wallet/src/ActionReview.js';

/** The network's refusals that a person can act on are put in plain words, with the network's own words after them. */
describe('a refusal by the network, as the wallet page shows it', () => {
  const engine = (said: string): string =>
    `Transaction broadcast failed for transaction hash "dd90" of invitation "c6be": Error: Failed to broadcast transaction: Error: Failed to request 'blockchain.transaction.broadcast': the transaction was rejected by network rules. ${said} (code 64)`;

  it('a lock time that has not passed by the chain\'s clock', () => {
    const shown = plainRefusal(engine('bad-txns-nonfinal, non-final transaction'));
    expect(shown).toMatch(/^The network does not take this transaction yet: the time it names has not come by the chain's clock/);
    expect(shown).toMatch(/\(The network said: bad-txns-nonfinal, non-final transaction\.\)$/);
  });

  it('a coin that has not waited long enough since it was confirmed', () => {
    expect(plainRefusal(engine('non-BIP68-final'))).toMatch(/^The network does not take this transaction yet: a coin it spends has not waited/);
  });

  it('anything else as it was said', () => {
    expect(plainRefusal('The user declined.')).toBe('The user declined.');
  });
});
