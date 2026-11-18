import { binToHex } from '@bitauth/libauth';
import { type ChainReader, controllerScript } from '@grandmas-wallet/core';
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

const setup = (autoCancel = false, on?: () => boolean) => {
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
          ...(on === undefined ? {} : { autoCancelOn: on }),
        }
      : {}),
  });
  return { chain, wallet, first, second, monitor, seen, cancellations, errors, clock };
};

describe('watching for recovery requests', () => {
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

  it('RC08: a request to an unknown key raises the alarm when only one of the servers shows it', async () => {
    const { wallet, first, monitor } = setup();
    first.hidden.add(wallet.requestRecovery(recoverer, stranger.keyHash));
    expect((await monitor.check())?.kind).toBe('recovery-requested');
  });

  it('RC09: when a request drops out of the chain, the status is rebuilt from the chain and is quiet again', async () => {
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

  it('asks whether to cancel each time it sees a request, so that a changed setting counts at the next check', async () => {
    const setting = { on: false };
    const { wallet, monitor, cancellations } = setup(true, () => setting.on);
    wallet.requestRecovery(recoverer, stranger.keyHash);
    expect((await monitor.check())?.kind).toBe('recovery-requested');
    expect(cancellations).toHaveLength(0);
    // Turned on while the request is open: the next check cancels it, without waiting for a retry.
    setting.on = true;
    await monitor.check();
    expect(cancellations).toHaveLength(1);
    expect(await monitor.check()).toEqual({ kind: 'quiet' });
    // Turned off again: a new request is left to the owner.
    setting.on = false;
    wallet.requestRecovery(recoverer, stranger.keyHash);
    expect((await monitor.check())?.kind).toBe('recovery-requested');
    await monitor.check();
    expect(cancellations).toHaveLength(1);
  });

  it('RC09: when its cancellation does not stay in the chain, the request is seen again and cancelled again', async () => {
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

  it('RC08: a request to this device\'s own key is no alarm', async () => {
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

  it('RC09: a request that is seen unconfirmed warns and is not reported as confirmed', async () => {
    const { chain, wallet } = setup();
    const unconfirmed = new Set<string>();
    const reader: ChainReader = {
      getTransaction: (transactionId) => chain.getTransaction(transactionId),
      listUnspent: (lockingBytecode) => chain.listUnspent(lockingBytecode),
      getHistory: async (lockingBytecode) => (await chain.getHistory(lockingBytecode)).map((entry) => (unconfirmed.has(entry.transactionId) ? { ...entry, height: 0 } : entry)),
    };
    const monitor = new Monitor({ servers: [reader, reader], identity: wallet.identityHex, genesisTransactionId: wallet.genesisTransactionId, ownKeyHashes: [binToHex(owner.keyHash)], onStatus: () => undefined });
    const requestedIn = wallet.requestRecovery(recoverer, stranger.keyHash);
    unconfirmed.add(requestedIn);
    // It warns at once, and says that the request is not in a block yet.
    expect(await monitor.check()).toMatchObject({ kind: 'recovery-requested', requestedIn, confirmed: false });
    unconfirmed.delete(requestedIn);
    expect(await monitor.check()).toMatchObject({ kind: 'recovery-requested', requestedIn, confirmed: true });
  });

  it('RC09: a request that only one server shows as confirmed is not reported as confirmed', async () => {
    const { chain, wallet } = setup();
    const lagging: ChainReader = {
      getTransaction: (transactionId) => chain.getTransaction(transactionId),
      listUnspent: (lockingBytecode) => chain.listUnspent(lockingBytecode),
      getHistory: async (lockingBytecode) => (await chain.getHistory(lockingBytecode)).map((entry) => (entry.transactionId === requestedIn ? { ...entry, height: 0 } : entry)),
    };
    const monitor = new Monitor({ servers: [server(chain).reader, lagging], identity: wallet.identityHex, genesisTransactionId: wallet.genesisTransactionId, ownKeyHashes: [binToHex(owner.keyHash)], onStatus: () => undefined });
    const requestedIn = wallet.requestRecovery(recoverer, stranger.keyHash);
    expect(await monitor.check()).toMatchObject({ kind: 'recovery-requested', confirmed: false });
  });

  it('reports a wallet its owner has closed, and nothing after it', async () => {
    const { wallet, monitor, chain } = setup();
    expect(await monitor.check()).toEqual({ kind: 'quiet' });
    wallet.requestRecovery(recoverer, stranger.keyHash);
    const closedIn = wallet.close(owner);
    const status = await monitor.check();
    expect(status).toMatchObject({ kind: 'closed', closedIn });
    // The identity token is gone: no controller output is left, and the recoverer has nothing to complete.
    expect(() => wallet.controller()).toThrow('the controller is not on the chain');
    expect((await chain.listUnspent(controllerScript(wallet.identity).lockingBytecode))).toHaveLength(0);
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
