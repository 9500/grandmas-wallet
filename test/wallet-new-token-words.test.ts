import { describe, expect, it } from 'vitest';

import { NOT_YET_MADE, PAYING_ITSELF_IDENTIFIER, notYetMadeWords } from '../apps/wallet/src/ActionReview.js';

/**
 * A request whose new token is made from a coin the wallet first pays itself (the first Savings Jar of a wallet that
 * has no coin at output 0): the review is worked out before that payment, with zeros for the token's identifier.
 * The review says so in words instead of showing "0000…0000" as if it were the token.
 */
describe('a token not made yet, in the review of a request', () => {
  it('its identifier of zeros is said in words', () => {
    expect(notYetMadeWords(NOT_YET_MADE)).toBe('new, made by this action');
    expect(notYetMadeWords(NOT_YET_MADE.toUpperCase())).toBe('new, made by this action');
  });

  it('any other value, a real token\'s identifier or shorter zeros, is shown as it is', () => {
    expect(notYetMadeWords('1163be4e8402aafce823bb4e3086767bf460791747cf770b11fdcfd39653151e')).toBeUndefined();
    expect(notYetMadeWords('00'.repeat(20))).toBeUndefined();
    expect(notYetMadeWords('')).toBeUndefined();
  });

  it('the notice of paying itself says that the identifier and what is made with it come from that payment', () => {
    expect(PAYING_ITSELF_IDENTIFIER).toMatch(/identifier comes from that payment/);
    expect(PAYING_ITSELF_IDENTIFIER).toMatch(/worked out again with it before anything is signed/);
  });
});
