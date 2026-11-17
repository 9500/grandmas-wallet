import { type ChainReader, IdentityValidationError, readControllerHistory } from '@grandmas-wallet/core';
import { SimulatedChain, TestWallet, testKey } from '@grandmas-wallet/testing';
import { describe, expect, it } from 'vitest';

import { ChainPool } from '../src/pool.js';

const owner = testKey(0x22);
const recoverer = testKey(0x33);

const setup = () => {
  const chain = new SimulatedChain();
  const wallet = TestWallet.create(chain, { owner, recovererKeyHash: recoverer.keyHash });
  wallet.authorize(owner);
  wallet.authorize(owner);
  return { chain, wallet };
};

/** A server that, like a node without a transaction index, cannot return some transactions. */
const forgetting = (chain: ChainReader, forgotten: (transactionId: string) => boolean): ChainReader => ({
  getTransaction: async (transactionId) => (forgotten(transactionId) ? undefined : chain.getTransaction(transactionId)),
  getHistory: (lockingBytecode) => chain.getHistory(lockingBytecode),
  listUnspent: (lockingBytecode) => chain.listUnspent(lockingBytecode),
});

describe('reading a wallet from several servers', () => {
  it('refuses to read a history with a transaction the server cannot return', async () => {
    const { chain, wallet } = setup();
    const partial = forgetting(chain, (transactionId) => transactionId === wallet.genesisTransactionId);
    await expect(readControllerHistory(partial, wallet.identity)).rejects.toThrow('is not available from the server');
    await expect(readControllerHistory(partial, wallet.identity)).rejects.toBeInstanceOf(IdentityValidationError);
  });

  it('takes from a second server what the first cannot return', async () => {
    const { chain, wallet } = setup();
    const partial = forgetting(chain, (transactionId) => transactionId === wallet.genesisTransactionId);
    const history = await readControllerHistory(new ChainPool([partial, chain]), wallet.identity);
    expect(history.transitions.map((step) => step.kind)).toEqual(['ownerAuthorize', 'ownerAuthorize']);
  });

  it('is not misled by a server that leaves the latest steps out of the history', async () => {
    const { chain, wallet } = setup();
    const stale: ChainReader = {
      getTransaction: (transactionId) => chain.getTransaction(transactionId),
      getHistory: async (lockingBytecode) => (await chain.getHistory(lockingBytecode)).slice(0, 1),
      listUnspent: (lockingBytecode) => chain.listUnspent(lockingBytecode),
    };
    expect((await readControllerHistory(stale, wallet.identity)).transitions).toHaveLength(0);
    expect((await readControllerHistory(new ChainPool([stale, chain]), wallet.identity)).transitions).toHaveLength(2);
  });

  it('refuses a transaction that does not match the identifier it was asked for', async () => {
    const { chain, wallet } = setup();
    const [first, second] = await chain.getHistory(wallet.controller().utxo.output.lockingBytecode);
    const lying: ChainReader = {
      getTransaction: (transactionId) => chain.getTransaction(transactionId === second?.transactionId ? (first?.transactionId ?? '') : transactionId),
      getHistory: (lockingBytecode) => chain.getHistory(lockingBytecode),
      listUnspent: (lockingBytecode) => chain.listUnspent(lockingBytecode),
    };
    await expect(readControllerHistory(lying, wallet.identity)).rejects.toThrow('returned something else');
  });

  it('works while one of the servers is down', async () => {
    const { chain, wallet } = setup();
    const down: ChainReader = {
      getTransaction: async () => { throw new Error('down'); },
      getHistory: async () => { throw new Error('down'); },
      listUnspent: async () => { throw new Error('down'); },
    };
    expect((await readControllerHistory(new ChainPool([chain, down]), wallet.identity)).transitions).toHaveLength(2);
    await expect(new ChainPool([down]).getHistory(new Uint8Array(1))).rejects.toThrow('No server returned');
  });

  it('OP01: two servers that disagree about a confirmation: it is reported, and nothing is treated as final', async () => {
    const { chain, wallet } = setup();
    const latest = wallet.authorize(owner);
    // One server says the latest step is in a block; the other has it unconfirmed.
    const behind: ChainReader = {
      getTransaction: (transactionId) => chain.getTransaction(transactionId),
      listUnspent: (lockingBytecode) => chain.listUnspent(lockingBytecode),
      getHistory: async (lockingBytecode) => (await chain.getHistory(lockingBytecode)).map((entry) => (entry.transactionId === latest ? { ...entry, height: 0 } : entry)),
    };
    const pool = new ChainPool([chain, behind]);
    const history = await readControllerHistory(pool, wallet.identity);
    // The step is seen, and it does not count as confirmed.
    expect(history.transitions).toHaveLength(3);
    expect(history.currentConfirmed).toBe(false);
    expect(pool.disagreements).toEqual([{ transactionId: latest, heights: [1, 0] }]);
    // A server that leaves a confirmed transaction out disagrees just as much.
    const silent: ChainReader = { ...behind, getHistory: async (lockingBytecode) => (await chain.getHistory(lockingBytecode)).filter((entry) => entry.transactionId !== latest) };
    const second = new ChainPool([chain, silent]);
    expect((await readControllerHistory(second, wallet.identity)).currentConfirmed).toBe(false);
    expect(second.disagreements).toEqual([{ transactionId: latest, heights: [1, undefined] }]);
    // Servers that agree leave nothing to report.
    const agreeing = new ChainPool([chain, chain]);
    expect((await readControllerHistory(agreeing, wallet.identity)).currentConfirmed).toBe(true);
    expect(agreeing.disagreements).toEqual([]);
  });
});
