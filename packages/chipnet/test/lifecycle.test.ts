import { hexToBin } from '@bitauth/libauth';
import { decodeControllerState, keyPairFromPrivateKey, p2pkhLockingBytecode } from '@grandmas-wallet/core';
import { SimulatedChain } from '@grandmas-wallet/testing';
import { describe, expect, it } from 'vitest';

import { type Environment, MINIMUM_FUNDING, Run, runLifecycle, sweepAll } from '../src/lifecycle.js';
import type { RunState } from '../src/store.js';

const FUNDING = 100_000n;
const destination = p2pkhLockingBytecode(new Uint8Array(20).fill(0xdd));

const freshState = (): RunState => ({
  version: 1,
  keys: {
    funder: '11'.repeat(32),
    owner: '22'.repeat(32),
    recoverer: '33'.repeat(32),
    replacement: '44'.repeat(32),
  },
  utxos: [],
  steps: {},
  stepOrder: [],
});

/** A run whose state survives only through what it persisted, like a process restarted from its state file. */
const setup = (funding = FUNDING) => {
  const chain = new SimulatedChain();
  const funder = keyPairFromPrivateKey(hexToBin('11'.repeat(32)));
  chain.fund(p2pkhLockingBytecode(funder.keyHash), funding);
  let disk = JSON.stringify(freshState());
  const environment: Environment = {
    persist: (state) => {
      disk = JSON.stringify(state);
    },
    sleep: async (milliseconds) => {
      chain.nowMs += milliseconds;
    },
    now: () => chain.nowMs,
    log: () => undefined,
  };
  const start = (): Run => new Run(JSON.parse(disk) as RunState, chain, environment);
  return { chain, start, saved: (): RunState => JSON.parse(disk) as RunState };
};

const expectCompleted = (state: RunState): void => {
  const status = (name: string): string | undefined => state.steps[name]?.status;
  for (const name of ['prepare', 'genesis', 'owner-send', 'claim-1', 'cancel', 'claim-2', 'finalize', 'new-owner-send', 'jar-withdraw']) {
    expect(status(name), name).toBe('done');
  }
  for (const name of ['attack-claim-with-spend', 'attack-early-finalize', 'attack-old-owner-spend']) {
    expect(status(name), name).toBe('refused-as-expected');
  }
  expect(state.steps['attack-early-finalize']?.networkReply).toContain('BIP68');
  expect(state.steps['attack-claim-with-spend']?.networkReply).toContain('script');
  expect(state.steps['attack-old-owner-spend']?.networkReply).toContain('script');

  const controller = state.utxos.find((utxo) => utxo.role === 'controller');
  const commitment = controller?.token?.nft?.commitment;
  if (commitment === undefined) throw new Error('no controller tracked');
  const controllerState = decodeControllerState(hexToBin(commitment));
  const replacement = keyPairFromPrivateKey(hexToBin(state.keys.replacement));
  expect(controllerState.ownerKeyHash).toEqual(replacement.keyHash);
  expect(controllerState.ownerEpoch).toBe(1);
  expect(controllerState.status).toBe('active');
  expect(state.utxos.filter((utxo) => utxo.role === 'jar')).toEqual([]);
};

/** After sweeping, everything except the controller's own value and fees is back at the destination. */
const expectReturned = (chain: SimulatedChain, funding = FUNDING): bigint => {
  const returned = chain.balanceOf(destination);
  const lost = funding - returned;
  expect(chain.totalValue()).toBe(returned + 1_000n);
  // 1,000 sat stay in the controller; fees for the whole run are about 9,000 sat at 1 sat/byte.
  expect(lost).toBeLessThan(12_000n);
  return lost;
};

describe('chipnet run against a simulated network', () => {
  it('completes the lifecycle, has every attack refused, and returns the coins', async () => {
    const { chain, start, saved } = setup();
    await runLifecycle(start());
    expectCompleted(saved());
    await sweepAll(start(), destination);
    const lost = expectReturned(chain);
    // 1,000 sat stay in the controller; the rest of the loss is fees.
    expect(lost).toBeGreaterThanOrEqual(1_000n);
  });

  it('does nothing when run again after completing', async () => {
    const { chain, start, saved } = setup();
    await runLifecycle(start());
    const broadcasts = chain.broadcasts;
    const before = JSON.stringify(saved());
    await runLifecycle(start());
    expect(chain.broadcasts).toBe(broadcasts);
    expect(JSON.stringify(saved())).toBe(before);
  });

  it('refuses to start without enough funds, before sending anything', async () => {
    const { chain, start } = setup(MINIMUM_FUNDING - 1n);
    await expect(runLifecycle(start())).rejects.toThrow(/at least/);
    expect(chain.broadcasts).toBe(0);
  });

  it.each(['before', 'after'] as const)(
    'resumes without losing coins when the connection drops %s any broadcast is processed',
    async (when) => {
      const reference = setup();
      await runLifecycle(reference.start());
      await sweepAll(reference.start(), destination);
      const total = reference.chain.broadcasts;
      expect(total).toBeGreaterThan(12);

      for (let at = 1; at <= total; at++) {
        const { chain, start, saved } = setup();
        chain.failure = { at, when };
        let interrupted = false;
        try {
          await runLifecycle(start());
          await sweepAll(start(), destination);
        } catch {
          interrupted = true;
        }
        expect(interrupted, `broadcast ${at}`).toBe(true);
        // Restart from the saved state only, as a new process would.
        await runLifecycle(start());
        expectCompleted(saved());
        await sweepAll(start(), destination);
        expectReturned(chain);
      }
    },
  );

  it('sweeps partway through a run, leaving nothing but the controller and a locked jar', async () => {
    const { chain, start } = setup();
    chain.failure = { at: 5, when: 'before' };
    await expect(runLifecycle(start())).rejects.toThrow();
    await sweepAll(start(), destination);
    const returned = chain.balanceOf(destination);
    // Controller (1,000) and the still-locked jar (10,000) remain; the rest came back minus fees.
    expect(chain.totalValue() - returned).toBe(6_000n);
    expect(FUNDING - returned).toBeLessThan(6_000n + 6_000n);
  });
});
