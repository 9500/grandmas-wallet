import {
  type Output,
  binToHex,
  decodeTransactionBch,
  encodeTransactionBch,
  hashTransactionUiOrder,
  hexToBin,
} from '@bitauth/libauth';
import { decodeControllerState, keyPairFromPrivateKey, p2pkhLockingBytecode, verifyTransaction } from '@grandmas-wallet/core';
import { describe, expect, it } from 'vitest';

import type { BroadcastResult, UnspentEntry } from '../src/electrum.js';
import { type Chain, type Environment, MINIMUM_FUNDING, Run, runLifecycle, sweepAll } from '../src/lifecycle.js';
import type { RunState } from '../src/store.js';

/**
 * A stand-in for the network: keeps a set of unspent outputs, checks every
 * submitted transaction with the same rules as the real network scripts, and
 * enforces relative and absolute time locks against a clock the test controls.
 */
class SimulatedChain implements Chain {
  nowMs = 1_800_000_000_000;
  broadcasts = 0;
  /** Fail the n-th broadcast: 'before' loses the transaction, 'after' accepts it but loses the reply. */
  failure?: { at: number; when: 'before' | 'after' };
  private readonly unspent = new Map<string, { output: Output; createdMs: number }>();
  private readonly transactions = new Map<string, string>();

  fund(lockingBytecode: Uint8Array, valueSatoshis: bigint): void {
    const encoded = encodeTransactionBch({
      version: 2,
      locktime: 0,
      inputs: [
        {
          outpointTransactionHash: new Uint8Array(32).fill(this.transactions.size + 1),
          outpointIndex: 3,
          sequenceNumber: 0,
          unlockingBytecode: new Uint8Array(0),
        },
      ],
      outputs: [{ lockingBytecode, valueSatoshis }],
    });
    const transactionId = binToHex(hashTransactionUiOrder(encoded));
    this.transactions.set(transactionId, binToHex(encoded));
    this.unspent.set(`${transactionId}:0`, { output: { lockingBytecode, valueSatoshis }, createdMs: this.nowMs });
  }

  balanceOf(lockingBytecode: Uint8Array): bigint {
    const wanted = binToHex(lockingBytecode);
    return [...this.unspent.values()]
      .filter(({ output }) => binToHex(output.lockingBytecode) === wanted)
      .reduce((sum, { output }) => sum + output.valueSatoshis, 0n);
  }

  totalValue(): bigint {
    return [...this.unspent.values()].reduce((sum, { output }) => sum + output.valueSatoshis, 0n);
  }

  listUnspent = async (lockingBytecode: Uint8Array): Promise<UnspentEntry[]> => {
    const wanted = binToHex(lockingBytecode);
    return [...this.unspent.entries()]
      .filter(([, { output }]) => binToHex(output.lockingBytecode) === wanted)
      .map(([outpoint, { output }]) => {
        const [transactionId = '', index = '0'] = outpoint.split(':');
        return { transactionId, index: Number(index), valueSatoshis: output.valueSatoshis, height: 0, hasToken: output.token !== undefined };
      });
  };

  getTransaction = async (transactionId: string): Promise<string | undefined> => this.transactions.get(transactionId);

  broadcast = async (transactionHex: string): Promise<BroadcastResult> => {
    this.broadcasts += 1;
    const failing = this.failure?.at === this.broadcasts ? this.failure.when : undefined;
    if (failing === 'before') throw new Error('connection lost');
    const result = this.submit(transactionHex);
    if (failing === 'after') throw new Error('connection lost');
    return result;
  };

  private submit(transactionHex: string): BroadcastResult {
    const encoded = hexToBin(transactionHex);
    const transaction = decodeTransactionBch(encoded);
    if (typeof transaction === 'string') return { accepted: false, reason: transaction };
    const transactionId = binToHex(hashTransactionUiOrder(encoded));
    if (this.transactions.has(transactionId)) return { accepted: false, reason: 'transaction already in block chain' };

    const outpoints = transaction.inputs.map((input) => `${binToHex(input.outpointTransactionHash)}:${input.outpointIndex}`);
    const sources = outpoints.map((outpoint) => this.unspent.get(outpoint));
    if (sources.some((source) => source === undefined)) return { accepted: false, reason: 'bad-txns-inputs-missingorspent' };
    const spent = sources as { output: Output; createdMs: number }[];

    const check = verifyTransaction({ transaction, sourceOutputs: spent.map(({ output }) => output) });
    if (check !== true) return { accepted: false, reason: `mandatory-script-verify-flag-failed (${check})` };

    if (transaction.locktime >= 500_000_000 && transaction.locktime >= this.nowMs / 1000) {
      return { accepted: false, reason: 'non-final' };
    }
    for (const [index, input] of transaction.inputs.entries()) {
      const sequence = input.sequenceNumber;
      if ((sequence & 0x80000000) !== 0 || (sequence & 0x40ffff) === 0) continue;
      const seconds = (sequence & 0x400000) !== 0 ? (sequence & 0xffff) * 512 : (sequence & 0xffff) * 600;
      if (this.nowMs - (spent[index]?.createdMs ?? 0) < seconds * 1000) {
        return { accepted: false, reason: 'non-BIP68-final' };
      }
    }

    outpoints.forEach((outpoint) => this.unspent.delete(outpoint));
    transaction.outputs.forEach((output, index) => {
      this.unspent.set(`${transactionId}:${index}`, { output, createdMs: this.nowMs });
    });
    this.transactions.set(transactionId, transactionHex);
    return { accepted: true, transactionId };
  }
}

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
    expect(chain.totalValue() - returned).toBe(11_000n);
    expect(FUNDING - returned).toBeLessThan(11_000n + 6_000n);
  });
});
