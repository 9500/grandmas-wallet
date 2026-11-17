import { binToHex } from '@bitauth/libauth';
import type { ChainReader } from '@grandmas-wallet/core';
import { SimulatedChain, TestWallet, testKey } from '@grandmas-wallet/testing';
import { describe, expect, it } from 'vitest';

import { type WatchStatus, Monitor } from '../src/monitor.js';

const owner = testKey(0x11);
const recoverer = testKey(0x22);
const stranger = testKey(0x33);

/** A server that can leave transactions out, as after a reorganization or when it withholds them. */
const server = (chain: SimulatedChain) => {
  const hidden = new Set<string>();
  const reader: ChainReader = {
    getTransaction: async (transactionId) => (hidden.has(transactionId) ? undefined : chain.getTransaction(transactionId)),
    getHistory: async (lockingBytecode) => (await chain.getHistory(lockingBytecode)).filter((entry) => !hidden.has(entry.transactionId)),
    listUnspent: (lockingBytecode) => chain.listUnspent(lockingBytecode),
  };
  return { reader, hidden };
};

const setup = (autoCancel = false) => {
  const chain = new SimulatedChain();
  const wallet = TestWallet.create(chain, { owner, recovererKeyHash: recoverer.keyHash });
  const first = server(chain);
  const second = server(chain);
  const seen: WatchStatus[] = [];
  const cancellations: string[] = [];
  const errors: string[] = [];
  const clock = { ms: 1_000_000 };
  const monitor = new Monitor({
    now: () => clock.ms,
    servers: [first.reader, second.reader],
    identity: wallet.identityHex,
    genesisTransactionId: wallet.genesisTransactionId,
    ownKeyHashes: [binToHex(owner.keyHash)],
    onStatus: (status) => seen.push(status),
    onError: (error) => errors.push(error.message),
    ...(autoCancel
      ? {
          autoCancel: async () => {
            // Any action by the owner clears the request.
            cancellations.push(wallet.authorize(owner));
          },
        }
      : {}),
  });
  return { chain, wallet, first, second, monitor, seen, cancellations, errors, clock };
};

describe('watching for recovery requests (C13)', () => {
  it('is quiet for a wallet nobody has asked for', async () => {
    const { monitor, seen } = setup();
    expect(await monitor.check()).toEqual({ kind: 'quiet' });
    await monitor.check();
    expect(seen).toEqual([{ kind: 'quiet' }]);
  });

  it('reports a request to someone else\'s key', async () => {
    const { wallet, monitor, seen } = setup();
    await monitor.check();
    const requestedIn = wallet.requestRecovery(recoverer, stranger.keyHash);
    const status = await monitor.check();
    expect(status).toMatchObject({ kind: 'recovery-requested', proposedOwnerKeyHash: binToHex(stranger.keyHash), requestedIn });
    expect(seen).toHaveLength(2);
  });

  it('still sees the request when one of the servers leaves it out', async () => {
    const { wallet, first, monitor } = setup();
    first.hidden.add(wallet.requestRecovery(recoverer, stranger.keyHash));
    expect((await monitor.check())?.kind).toBe('recovery-requested');
  });

  it('goes quiet again when the request drops out of the chain', async () => {
    const { wallet, first, second, monitor, seen } = setup();
    const requestedIn = wallet.requestRecovery(recoverer, stranger.keyHash);
    expect((await monitor.check())?.kind).toBe('recovery-requested');
    first.hidden.add(requestedIn);
    second.hidden.add(requestedIn);
    expect(await monitor.check()).toEqual({ kind: 'quiet' });
    expect(seen.map((status) => status.kind)).toEqual(['recovery-requested', 'quiet']);
  });

  it('cancels a request by itself when set to, once', async () => {
    const { wallet, monitor, cancellations } = setup(true);
    wallet.requestRecovery(recoverer, stranger.keyHash);
    await monitor.check();
    expect(cancellations).toHaveLength(1);
    expect(await monitor.check()).toEqual({ kind: 'quiet' });
    expect(cancellations).toHaveLength(1);
    expect(wallet.controller().state.status).toBe('active');
  });

  it('cancels again when its cancellation does not stay in the chain', async () => {
    const { wallet, first, second, monitor, cancellations, clock } = setup(true);
    wallet.requestRecovery(recoverer, stranger.keyHash);
    await monitor.check();
    const [cancellation] = cancellations as [string];
    first.hidden.add(cancellation);
    second.hidden.add(cancellation);
    // The chain shows the request again, with the controller where it was before the cancellation.
    expect((await monitor.check())?.kind).toBe('recovery-requested');
    expect(cancellations).toHaveLength(1);
    clock.ms += 120_000;
    await monitor.check();
    expect(cancellations).toHaveLength(2);
  });

  it('cancels a second request made after the first was cancelled', async () => {
    const { wallet, monitor, cancellations } = setup(true);
    wallet.requestRecovery(recoverer, stranger.keyHash);
    await monitor.check();
    await monitor.check();
    wallet.requestRecovery(recoverer, stranger.keyHash);
    await monitor.check();
    expect(cancellations).toHaveLength(2);
    expect(wallet.controller().state.status).toBe('active');
  });

  it('does not treat a request to this device\'s own key as an alarm', async () => {
    const { chain, wallet } = setup();
    const seen: WatchStatus[] = [];
    const newDevice = new Monitor({
      servers: [server(chain).reader, server(chain).reader],
      identity: wallet.identityHex,
      genesisTransactionId: wallet.genesisTransactionId,
      ownKeyHashes: [binToHex(stranger.keyHash)],
      onStatus: (status) => seen.push(status),
    });
    expect((await newDevice.check())?.kind).toBe('owned-elsewhere');
    wallet.requestRecovery(recoverer, stranger.keyHash);
    expect((await newDevice.check())?.kind).toBe('own-request');
  });

  it('tells the earlier device when the wallet has gone to another key', async () => {
    const { chain, wallet, monitor } = setup();
    await monitor.check();
    wallet.requestRecovery(recoverer, stranger.keyHash);
    chain.nowMs += 3 * 3_600_000;
    wallet.finalizeRecovery(recoverer);
    expect(await monitor.check()).toEqual({ kind: 'owned-elsewhere', ownerKeyHash: binToHex(stranger.keyHash), ownerEpoch: 1 });
  });

  it('keeps the last status and reports the problem when no server answers', async () => {
    const { chain, wallet, errors } = setup();
    const failing: ChainReader = {
      getTransaction: async () => undefined,
      getHistory: async () => {
        throw new Error('unreachable');
      },
      listUnspent: (lockingBytecode) => chain.listUnspent(lockingBytecode),
    };
    const monitor = new Monitor({
      servers: [failing, failing],
      identity: wallet.identityHex,
      genesisTransactionId: wallet.genesisTransactionId,
      ownKeyHashes: [binToHex(owner.keyHash)],
      onStatus: () => undefined,
      onError: (error) => errors.push(error.message),
    });
    expect(await monitor.check()).toBeUndefined();
    expect(errors).toEqual(['No server returned the history.']);
  });
});
