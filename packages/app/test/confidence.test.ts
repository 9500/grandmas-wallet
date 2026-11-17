import { describe, expect, it } from 'vitest';

import { chainConfidence } from '../src/confidence.js';

describe('what a device says about the state of the chain', () => {
  it('OP01: chain state is never called verified while confirmations rest on servers', () => {
    const quiet = chainConfidence({ headers: { verifiedHeight: 900, currentHeight: 900 }, disagreements: [] });
    expect(quiet).toMatchObject({ verified: false, headerCheck: 'at the tip', final: true });
    expect(quiet.statement).toContain('has not verified them itself');
    expect(quiet.statement).not.toMatch(/\bverified chain state\b/);
  });

  it('OP01: when the engine\'s header check fails, the device says so and treats nothing as final', () => {
    const failed = chainConfidence({});
    expect(failed).toMatchObject({ verified: false, headerCheck: 'failed', final: false });
    expect(failed.statement).toContain('rests on the servers alone and is not treated as final');
    const behind = chainConfidence({ headers: { verifiedHeight: 880, currentHeight: 900 } });
    expect(behind).toMatchObject({ headerCheck: 'behind', final: true });
    expect(behind.statement).toContain('880 of 900');
  });

  it('OP01: when two servers disagree about a confirmation, the disagreement is reported and nothing is treated as final', () => {
    const disagreement = { transactionId: 'ab'.repeat(32), heights: [120, 0] };
    const confidence = chainConfidence({ headers: { verifiedHeight: 900, currentHeight: 900 }, disagreements: [disagreement] });
    expect(confidence).toMatchObject({ verified: false, final: false, disagreements: [disagreement] });
    expect(confidence.statement).toContain('The servers disagree about a confirmation');
  });
});
