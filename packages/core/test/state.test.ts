import { describe, expect, it } from 'vitest';

import {
  CONTROLLER_STATE_LENGTH,
  type ControllerState,
  ControllerStateError,
  type ControllerStateErrorCode,
  MAX_OWNER_EPOCH,
  decodeChallengeDelay,
  decodeControllerState,
  encodeChallengeDelay,
  encodeControllerState,
} from '../src/index.js';

const hash = (fill: number): Uint8Array => new Uint8Array(20).fill(fill);

const active: ControllerState = {
  version: 1,
  status: 'active',
  ownerEpoch: 0,
  ownerKeyHash: hash(0xaa),
  recovererKeyHash: hash(0xbb),
  challengeDelay: { unit: 'blocks', value: 3 },
};

const pending: ControllerState = { ...active, status: 'pending', ownerEpoch: 7, proposedOwnerKeyHash: hash(0xcc) };

const expectCode = (run: () => unknown, code: ControllerStateErrorCode): void => {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(ControllerStateError);
    expect((error as ControllerStateError).code).toBe(code);
    return;
  }
  expect.fail(`expected ControllerStateError "${code}"`);
};

describe('controller state layout', () => {
  it('encodes an active state to the documented byte layout', () => {
    const bytes = encodeControllerState({ ...active, ownerEpoch: 0x01020304 });
    expect(bytes.length).toBe(CONTROLLER_STATE_LENGTH);
    expect(bytes[0]).toBe(0x01);
    expect(bytes[1]).toBe(0x00);
    expect([...bytes.subarray(2, 6)]).toEqual([0x04, 0x03, 0x02, 0x01]);
    expect([...bytes.subarray(6, 26)]).toEqual([...hash(0xaa)]);
    expect([...bytes.subarray(26, 46)]).toEqual([...hash(0xbb)]);
    expect([...bytes.subarray(46, 49)]).toEqual([0x03, 0x00, 0x00]);
    expect([...bytes.subarray(49, 69)]).toEqual([...hash(0x00)]);
  });

  it('encodes a pending state with status byte and proposed owner', () => {
    const bytes = encodeControllerState(pending);
    expect(bytes[1]).toBe(0x01);
    expect([...bytes.subarray(49, 69)]).toEqual([...hash(0xcc)]);
  });

  it('round-trips active and pending states', () => {
    expect(decodeControllerState(encodeControllerState(active))).toEqual(active);
    expect(decodeControllerState(encodeControllerState(pending))).toEqual(pending);
  });

  it('round-trips boundary values', () => {
    const state: ControllerState = {
      ...pending,
      ownerEpoch: MAX_OWNER_EPOCH,
      challengeDelay: { unit: 'time512', value: 0xffff },
    };
    expect(decodeControllerState(encodeControllerState(state))).toEqual(state);
  });

  it('decodes from a view into a larger buffer', () => {
    const padded = new Uint8Array(CONTROLLER_STATE_LENGTH + 10);
    padded.set(encodeControllerState(pending), 5);
    expect(decodeControllerState(padded.subarray(5, 5 + CONTROLLER_STATE_LENGTH))).toEqual(pending);
  });
});

describe('challenge delay', () => {
  it('encodes blocks as a plain value and time as a flagged value', () => {
    expect(encodeChallengeDelay({ unit: 'blocks', value: 144 })).toBe(144);
    expect(encodeChallengeDelay({ unit: 'time512', value: 5063 })).toBe(0x400000 | 5063);
  });

  it('keeps every encoded delay positive when read as a 3-byte script number', () => {
    expect(encodeChallengeDelay({ unit: 'time512', value: 0xffff })).toBeLessThan(0x800000);
  });

  it('rejects zero, fractional, and oversized values', () => {
    for (const value of [0, -1, 1.5, 0x10000, Number.NaN]) {
      expectCode(() => encodeChallengeDelay({ unit: 'blocks', value }), 'invalid-challenge-delay');
    }
  });

  it('rejects sequence numbers with other bits set', () => {
    expectCode(() => decodeChallengeDelay(0x10000 | 5), 'invalid-challenge-delay');
    expectCode(() => decodeChallengeDelay(0x800000 | 5), 'invalid-challenge-delay');
    expectCode(() => decodeChallengeDelay(0x400000), 'invalid-challenge-delay');
  });
});

describe('rejected commitments', () => {
  const encoded = (): Uint8Array => encodeControllerState(pending);

  it('rejects unknown versions before anything else (X02)', () => {
    for (const version of [0x00, 0x02, 0xff]) {
      const bytes = encoded();
      bytes[0] = version;
      expectCode(() => decodeControllerState(bytes), 'unsupported-version');
      expectCode(() => decodeControllerState(bytes.subarray(0, 40)), 'unsupported-version');
    }
  });

  it('rejects wrong lengths', () => {
    expectCode(() => decodeControllerState(new Uint8Array(0)), 'invalid-length');
    expectCode(() => decodeControllerState(encoded().subarray(0, 68)), 'invalid-length');
    expectCode(() => decodeControllerState(new Uint8Array([...encoded(), 0])), 'invalid-length');
  });

  it('rejects unknown status bytes', () => {
    const bytes = encoded();
    bytes[1] = 0x02;
    expectCode(() => decodeControllerState(bytes), 'invalid-status');
  });

  it('rejects an epoch with the sign bit set', () => {
    const bytes = encoded();
    bytes[5] = 0x80;
    expectCode(() => decodeControllerState(bytes), 'invalid-owner-epoch');
  });

  it('rejects an active state carrying a proposed owner', () => {
    const bytes = encoded();
    bytes[1] = 0x00;
    expectCode(() => decodeControllerState(bytes), 'inconsistent-claim');
  });

  it('rejects a pending state without a proposed owner', () => {
    const bytes = encodeControllerState(active);
    bytes[1] = 0x01;
    expectCode(() => decodeControllerState(bytes), 'invalid-key-hash');
  });

  it('rejects zero owner or recoverer hashes', () => {
    const noOwner = encoded();
    noOwner.fill(0, 6, 26);
    expectCode(() => decodeControllerState(noOwner), 'invalid-key-hash');
    const noRecoverer = encoded();
    noRecoverer.fill(0, 26, 46);
    expectCode(() => decodeControllerState(noRecoverer), 'invalid-key-hash');
  });

  it('rejects an invalid delay field', () => {
    const bytes = encoded();
    bytes[48] = 0x80;
    expectCode(() => decodeControllerState(bytes), 'invalid-challenge-delay');
  });
});

describe('rejected states on encode', () => {
  it('rejects inconsistent claims', () => {
    expectCode(() => encodeControllerState({ ...active, proposedOwnerKeyHash: hash(1) }), 'inconsistent-claim');
    expectCode(() => encodeControllerState({ ...active, status: 'pending' }), 'inconsistent-claim');
  });

  it('rejects malformed fields', () => {
    expectCode(() => encodeControllerState({ ...active, ownerKeyHash: new Uint8Array(19) }), 'invalid-key-hash');
    expectCode(() => encodeControllerState({ ...active, recovererKeyHash: hash(0) }), 'invalid-key-hash');
    expectCode(() => encodeControllerState({ ...active, ownerEpoch: MAX_OWNER_EPOCH + 1 }), 'invalid-owner-epoch');
    expectCode(() => encodeControllerState({ ...active, ownerEpoch: -1 }), 'invalid-owner-epoch');
    expectCode(() => encodeControllerState({ ...active, version: 2 as 1 }), 'unsupported-version');
    expectCode(() => encodeControllerState({ ...active, status: 'closed' as 'active' }), 'invalid-status');
  });
});
