import { hexToBin } from '@bitauth/libauth';
import { keyPairFromPrivateKey, p2pkhLockingBytecode, readControllerHistory } from '@grandmas-wallet/core';
import { SimulatedChain } from '@grandmas-wallet/testing';
import { describe, expect, it } from 'vitest';

import { type Environment, MINIMUM_FUNDING, Run, readEndState, returnAll, runLifecycle } from '../src/lifecycle.js';
import type { RunState } from '../src/store.js';

/**
 * The scripted run of stage 1 on the simulated chain: the same script that runs on the local node and on
 * chipnet, with every step, every refusal and a stop at every point checked.
 */

const FUNDING = 100_000n;
const secrets = (byte: number) => ({ controllerKey: byte.toString(16).padStart(2, '0').repeat(32), blindingSeed: (byte + 1).toString(16).padStart(2, '0').repeat(32), addressKeys: (byte + 2).toString(16).padStart(2, '0').repeat(32) });
const freshState = (): RunState => ({
  version: 2,
  chain: 'simulated',
  keys: { funder: '11'.repeat(32), recoverer: '33'.repeat(32), recovererFee: '34'.repeat(32), old: secrets(0x22), new: secrets(0x44) },
  utxos: [],
  steps: {},
  stepOrder: [],
});
const funderLocking = p2pkhLockingBytecode(keyPairFromPrivateKey(hexToBin('11'.repeat(32))).keyHash);

/** A run whose state survives only through what it persisted, like a process restarted from its state file. */
const setup = (funding = FUNDING, outputIndex = 0) => {
  const chain = new SimulatedChain();
  chain.fund(funderLocking, funding, outputIndex);
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

const ACCEPTED = ['create', 'receive', 'pay', 'fund-fee', 'request-1', 'cancel', 'request-2', 'complete', 'sweep', 'vault-spend', 'close', 'return-fee'];
const REFUSED = ['refuse-request-with-sweep', 'refuse-early-completion', 'refuse-sweep-by-earlier-owner'];

const expectCompleted = async (chain: SimulatedChain, start: () => Run, saved: () => RunState, funding = FUNDING): Promise<bigint> => {
  const state = saved();
  for (const name of ACCEPTED) expect(state.steps[name]?.status, name).toBe('done');
  for (const name of REFUSED) expect(state.steps[name]?.status, name).toBe('refused-as-expected');
  expect(state.steps['refuse-early-completion']?.networkReply).toContain('BIP68');
  // Only chain time refuses the early completion; the other two fail their scripts.
  expect(state.steps['refuse-early-completion']?.localCheck).toContain('passes');
  // The request passes on the controller (input 0) and its fee coin (input 1); the attached coin's script refuses.
  expect(state.steps['refuse-request-with-sweep']?.localCheck).toContain('input index 2');
  // The earlier owner's key is refused by the controller itself.
  expect(state.steps['refuse-sweep-by-earlier-owner']?.localCheck).toContain('input index 0');

  // Every transaction that was sent pays exactly what nodes require for its size.
  for (const name of ACCEPTED) {
    const step = state.steps[name];
    expect(step?.feeSatoshis, name).toBe(step?.requiredFeeSatoshis);
    expect(step?.feeSatoshis, name).toBe(String(step?.bytes));
  }

  // Nothing of the run is left anywhere but at the funding address, and the wallet is closed.
  expect(state.utxos.every((utxo) => utxo.role === 'funder')).toBe(true);
  const end = await readEndState(start());
  expect(end.leftBehind).toEqual([]);
  expect(end.closed).toBe(true);
  expect(chain.totalValue()).toBe(end.returnedSatoshis);
  const fees = ACCEPTED.reduce((sum, name) => sum + BigInt(state.steps[name]?.feeSatoshis ?? 0), 0n) + BigInt(state.steps['prepare']?.feeSatoshis ?? 0);
  expect(funding - end.returnedSatoshis).toBe(fees);
  return fees;
};

describe('the stage 1 run against a simulated network', () => {
  it('completes, has every attack refused, and returns everything but the fees', async () => {
    const { chain, start, saved } = setup();
    await runLifecycle(start());
    const fees = await expectCompleted(chain, start, saved);
    expect(fees).toBeGreaterThan(9_000n);
    expect(fees).toBeLessThan(12_000n);
    // The funding coin was output 0 of its transaction, so the wallet did not pay itself first.
    expect(saved().steps['prepare']).toBeUndefined();
  });

  it('records the sizes the proposal gives for a payment, a request, a cancellation, a completion and a sweep', async () => {
    const { start, saved } = setup();
    await runLifecycle(start());
    const bytes = (name: string): number | undefined => saved().steps[name]?.bytes;
    expect(bytes('pay')).toBe(384);
    expect(bytes('request-1')).toBe(991);
    expect(bytes('cancel')).toBe(1_135);
    expect(bytes('complete')).toBe(970);
    // The controller, three swept coins, the controller's successor and one output.
    expect(bytes('sweep')).toBe(1_619);
  });

  it('follows the controller from its creation to its closing, as any client would', async () => {
    const { chain, start, saved } = setup();
    await runLifecycle(start());
    const state = saved();
    const history = await readControllerHistory(chain, hexToBin(state.identity ?? ''), state.steps['create']?.transactionId);
    expect(history.transitions.map((step) => step.kind)).toEqual(['requestRecovery', 'ownerAuthorize', 'requestRecovery', 'finalizeRecovery', 'ownerAuthorize', 'ownerAuthorize']);
    expect(history.owners.map((owner) => owner.ownerEpoch)).toEqual([0, 1]);
    expect(history.closed?.transactionId).toBe(state.steps['close']?.transactionId);
  });

  it('pays itself first when the funding coin is not output 0 of its transaction', async () => {
    const { chain, start, saved } = setup(FUNDING, 1);
    await runLifecycle(start());
    await expectCompleted(chain, start, saved);
    const state = saved();
    expect(state.steps['prepare']?.status).toBe('done');
    expect(state.identity).toBe(state.steps['prepare']?.transactionId);
    expect(state.stepOrder[0]).toBe('prepare');
  });

  it('does not take a reply that is no refusal for a refusal', async () => {
    const { chain, start, saved } = setup();
    const broadcast = chain.broadcast;
    let answers = 0;
    // The server fails to answer properly the first time a transaction that must be refused is sent.
    chain.broadcast = async (transactionHex) => {
      const built = saved().steps['fund-fee']?.status === 'done' && saved().steps['request-1'] === undefined;
      if (built && answers++ === 0) return { accepted: false, reason: 'Request timed out' };
      return broadcast(transactionHex);
    };
    await expect(runLifecycle(start())).rejects.toThrow(/not refused for the reason it should be/);
    expect(saved().steps['refuse-request-with-sweep']).toBeUndefined();
    // Continued, the step is tried again and the run completes.
    await runLifecycle(start());
    await expectCompleted(chain, start, saved);
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

  it.each(['before', 'after'] as const)('resumes without losing coins when the connection drops %s any broadcast is processed', async (when) => {
    const reference = setup();
    await runLifecycle(reference.start());
    const total = reference.chain.broadcasts;
    expect(total).toBeGreaterThanOrEqual(ACCEPTED.length + REFUSED.length);

    for (let at = 1; at <= total; at++) {
      const { chain, start, saved } = setup();
      chain.failure = { at, when };
      await expect(runLifecycle(start()), `broadcast ${at}`).rejects.toThrow('connection lost');
      // Restart from the saved state only, as a new process would.
      await runLifecycle(start());
      await expectCompleted(chain, start, saved);
    }
  });

  it.each(['before', 'after'] as const)('returns everything from wherever a run stopped, with the connection lost %s a broadcast', async (when) => {
    const reference = setup();
    await runLifecycle(reference.start());
    const total = reference.chain.broadcasts;
    for (let at = 1; at <= total; at++) {
      const { chain, start, saved } = setup();
      chain.failure = { at, when };
      await expect(runLifecycle(start())).rejects.toThrow('connection lost');
      delete chain.failure;
      await returnAll(start());
      const end = await readEndState(start());
      expect(end.leftBehind, `stopped at broadcast ${at}`).toEqual([]);
      expect(chain.totalValue(), `stopped at broadcast ${at}`).toBe(end.returnedSatoshis);
      expect(FUNDING - end.returnedSatoshis).toBeLessThan(12_000n);
      // Whatever was sent to return the coins passed the check before sending.
      for (const step of Object.values(saved().steps)) {
        if (step.status !== 'done') continue;
        expect(step.feeSatoshis).toBe(step.requiredFeeSatoshis);
      }
    }
  });
});
