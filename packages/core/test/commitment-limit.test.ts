import { createVirtualMachineBch2025, createVirtualMachineBch2026, hexToBin } from '@bitauth/libauth';
import { describe, expect, it } from 'vitest';

import { CONTROLLER_STATE_LENGTH, encodeControllerState } from '../src/index.js';

/**
 * Confirms that the network rules the wallet targets accept an NFT commitment
 * large enough for the plain (unhashed) controller state.
 */

const anyoneCanSpend = hexToBin('51'); // OP_1
const genesisOutpointHash = new Uint8Array(32).fill(0x11);

const createsNftWithCommitment = (commitment: Uint8Array) => ({
  sourceOutputs: [{ lockingBytecode: anyoneCanSpend, valueSatoshis: 10_000n }],
  transaction: {
    version: 2,
    locktime: 0,
    inputs: [
      {
        outpointTransactionHash: genesisOutpointHash,
        outpointIndex: 0,
        sequenceNumber: 0,
        unlockingBytecode: new Uint8Array(0),
      },
    ],
    outputs: [
      {
        lockingBytecode: anyoneCanSpend,
        valueSatoshis: 9_000n,
        token: {
          amount: 0n,
          category: genesisOutpointHash,
          nft: { capability: 'mutable' as const, commitment },
        },
      },
    ],
  },
});

describe('NFT commitment limit', () => {
  const vm2026 = createVirtualMachineBch2026(true);

  it('accepts a commitment holding the controller state', () => {
    const state = encodeControllerState({
      version: 1,
      status: 'pending',
      ownerEpoch: 1,
      ownerKeyHash: new Uint8Array(20).fill(0xaa),
      recovererKeyHash: new Uint8Array(20).fill(0xbb),
      challengeDelay: { unit: 'blocks', value: 3 },
      proposedOwnerKeyHash: new Uint8Array(20).fill(0xcc),
    });
    expect(state.length).toBe(CONTROLLER_STATE_LENGTH);
    expect(vm2026.verify(createsNftWithCommitment(state))).toBe(true);
  });

  it('accepts 128 bytes and rejects 129 bytes', () => {
    expect(vm2026.verify(createsNftWithCommitment(new Uint8Array(128).fill(1)))).toBe(true);
    expect(vm2026.verify(createsNftWithCommitment(new Uint8Array(129).fill(1)))).not.toBe(true);
  });

  it('would have been rejected under the previous 40-byte limit', () => {
    const vm2025 = createVirtualMachineBch2025(false);
    expect(vm2025.verify(createsNftWithCommitment(new Uint8Array(40).fill(1)))).toBe(true);
    expect(vm2025.verify(createsNftWithCommitment(new Uint8Array(CONTROLLER_STATE_LENGTH).fill(1)))).not.toBe(true);
  });
});
