import { type Output, binToHex, hexToBin } from '@bitauth/libauth';
import {
  type ChainReader,
  type FoundCoin,
  type InputSpec,
  type TemplateNumbers,
  type ViewingKey,
  ADDRESS_KIND,
  ADDRESS_RANGE,
  allocationFromUsed,
  buildTransaction,
  controllerInput,
  controllerSuccessor,
  deriveSeedKeys,
  fullPass,
  keyPairFromPrivateKey,
  p2pkhInput,
  p2pkhLockingBytecode,
  quickPass,
  recoverableInput,
  searchWallet,
  sweptInput,
  takeNumber,
  vaultInput,
  walletAddress,
} from '@grandmas-wallet/core';
import { SimulatedChain, TestWallet, testKey } from '@grandmas-wallet/testing';
import { describe, expect, it } from 'vitest';

/**
 * Acceptance tests KV01 to KV04 and KV10 to KV12 of the proposal: finding a wallet's coins from its
 * identity and its viewing keys, and what a viewing key cannot do.
 */

const numbers: TemplateNumbers = { controller: 11, givenOut: 22, change: 33, standardWallet: 44 };
const WORDS = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const OTHER_WORDS = 'legal winner thank year wave sausage worth useful legal winner thank yellow';
const { givenOut, change, vault } = ADDRESS_KIND;
const recoverer = testKey(0x33);
const payee = testKey(0x44);

const setup = (words = WORDS) => {
  const chain = new SimulatedChain();
  const seed = deriveSeedKeys(words, 'testnet', numbers);
  const wallet = TestWallet.create(chain, { owner: seed.controllerKey, recovererKeyHash: recoverer.keyHash });
  const at = (kind: 0 | 1 | 2, number: number) => walletAddress(wallet.identity, seed.viewingKey, kind, number);
  const pay = (kind: 0 | 1 | 2, number: number, valueSatoshis = 10_000n): string => chain.fund(at(kind, number).lockingBytecode, valueSatoshis);
  /** Send a new token to an address: the category is a coin's transaction, as for any token. */
  const payToken = (kind: 0 | 1 | 2, number: number, token: Omit<NonNullable<Output['token']>, 'category'>): Uint8Array => {
    const minter = testKey(0xa0 + number);
    const locking = p2pkhLockingBytecode(minter.keyHash);
    const category = chain.fund(locking, 5_000n);
    const [coin] = chain.outputsAt(locking).filter((candidate) => binToHex(candidate.transactionHash) === category);
    if (coin === undefined) throw new Error('minting coin missing');
    const built = buildTransaction({
      inputs: [p2pkhInput(coin, minter)],
      outputs: [{ lockingBytecode: at(kind, number).lockingBytecode, valueSatoshis: 1_000n, token: { category: hexToBin(category), ...token } }],
      changeLockingBytecode: locking,
    });
    wallet.send(built);
    return hexToBin(category);
  };
  /** Spend what is at a recoverable address with its key, so that the address has history and nothing unspent. */
  const empty = (kind: 0 | 1, number: number): void => {
    const address = at(kind, number);
    if (address.kind === vault) throw new Error('a vault address has no key');
    const inputs = chain.outputsAt(address.lockingBytecode).map((utxo) => recoverableInput(utxo, address.script, seed.addressKey(kind, number)));
    wallet.send(buildTransaction({ inputs, outputs: [{ lockingBytecode: p2pkhLockingBytecode(payee.keyHash), valueSatoshis: 0n }], remainderOutputIndex: 0 }));
  };
  return { chain, seed, wallet, at, pay, payToken, empty };
};

/** One transaction that moves every found coin through the controller, tokens unchanged. */
const sweep = (wallet: TestWallet, owner: ReturnType<typeof testKey>, coins: FoundCoin[]) => {
  const { utxo, state } = wallet.controller();
  const action = { kind: 'ownerAuthorize' as const };
  const inputs: InputSpec[] = coins.map((coin) =>
    coin.address.kind === vault
      ? vaultInput(coin.utxo, coin.address.script, wallet.identity, coin.address.secret)
      : sweptInput(coin.utxo, coin.address.script, wallet.identity, coin.address.secret),
  );
  const to = p2pkhLockingBytecode(payee.keyHash);
  const tokens = coins.flatMap((coin) => (coin.utxo.output.token === undefined ? [] : [{ lockingBytecode: to, valueSatoshis: 1_000n, token: coin.utxo.output.token }]));
  return buildTransaction({
    inputs: [controllerInput(utxo, state, action, owner), ...inputs],
    outputs: [controllerSuccessor(utxo, state, action), ...tokens, { lockingBytecode: to, valueSatoshis: 0n }],
    remainderOutputIndex: 1 + tokens.length,
  });
};

const places = (coins: FoundCoin[]): string[] => coins.map((coin) => `${coin.address.kind}/${coin.address.number}`).sort();

describe('the quick pass', () => {
  it('KV01: finds every coin, token and NFT, with its secret', async () => {
    const { chain, seed, wallet, pay, payToken, empty } = setup();
    // Used addresses with gaps inside the window, an address that was emptied, change, a vault coin, tokens.
    pay(givenOut, 0);
    pay(givenOut, 1);
    empty(givenOut, 1);
    pay(givenOut, 5);
    pay(givenOut, 5, 4_000n);
    pay(givenOut, 23);
    pay(change, 0);
    pay(change, 4);
    pay(vault, 0);
    pay(vault, 3);
    const fungible = payToken(givenOut, 7, { amount: 250n });
    const nft = payToken(change, 2, { amount: 0n, nft: { capability: 'none', commitment: Uint8Array.of(9, 9) } });

    const result = await quickPass(chain, wallet.identity, seed.viewingKey);
    expect(result.status).toBe('complete');
    const coins = result.found.flatMap((address) => address.coins);
    expect(places(coins)).toEqual(['0/0', '0/23', '0/5', '0/5', '0/7', '1/0', '1/2', '1/4', '2/0', '2/3']);
    // The emptied address is known to have been used, with nothing left there.
    expect(result.found.find((entry) => entry.address.kind === givenOut && entry.address.number === 1)?.coins).toEqual([]);
    expect(coins.find((coin) => coin.utxo.output.token?.amount === 250n)?.utxo.output.token?.category).toEqual(fungible);
    expect(coins.find((coin) => coin.utxo.output.token?.nft !== undefined)?.utxo.output.token).toEqual({ amount: 0n, category: nft, nft: { capability: 'none', commitment: Uint8Array.of(9, 9) } });
    // It stopped after a run of unused addresses as long as the window of each kind.
    expect(result.progress).toEqual({ [givenOut]: 44, [change]: 10, [vault]: 9 });

    // The secrets are the right ones: every coin moves through the controller with them.
    const before = chain.balanceOf(p2pkhLockingBytecode(payee.keyHash));
    wallet.send(sweep(wallet, seed.controllerKey, coins));
    expect(chain.balanceOf(p2pkhLockingBytecode(payee.keyHash))).toBeGreaterThan(before + 60_000n);
    expect((await quickPass(chain, wallet.identity, seed.viewingKey)).found.flatMap((address) => address.coins)).toEqual([]);
  });

  it('KV02: finds nothing with another wallet\'s viewing key, or with the right one and another identity', async () => {
    const { chain, seed, wallet, pay } = setup();
    pay(givenOut, 0);
    pay(change, 0);
    pay(vault, 0);
    expect((await quickPass(chain, wallet.identity, seed.viewingKey)).found).toHaveLength(3);
    const other = deriveSeedKeys(OTHER_WORDS, 'testnet', numbers).viewingKey;
    expect((await quickPass(chain, wallet.identity, other)).found).toEqual([]);
    expect((await quickPass(chain, new Uint8Array(32).fill(0x12), seed.viewingKey)).found).toEqual([]);
  });
});

describe('what a viewing key cannot do', () => {
  it('KV03: it neither signs nor sweeps', async () => {
    const { chain, seed, wallet, pay, at } = setup();
    pay(givenOut, 0);
    pay(vault, 0);
    const coins = (await quickPass(chain, wallet.identity, seed.viewingKey)).found.flatMap((address) => address.coins);
    expect(coins).toHaveLength(2);
    // Everything a holder of the viewing key has, tried as a key: the blinding seed, and the public data.
    const address = at(givenOut, 0);
    if (address.kind === vault) throw new Error('unexpected');
    const madeUp = [keyPairFromPrivateKey(seed.viewingKey.blindingSeed), keyPairFromPrivateKey(address.secret), keyPairFromPrivateKey(address.tag)];
    for (const key of madeUp) {
      // Spending by key: the address names another key hash.
      const [coin] = coins.filter((candidate) => candidate.address.kind === givenOut);
      if (coin === undefined) throw new Error('coin missing');
      const byKey = buildTransaction({ inputs: [recoverableInput(coin.utxo, address.script, key)], outputs: [{ lockingBytecode: p2pkhLockingBytecode(payee.keyHash), valueSatoshis: 0n }], remainderOutputIndex: 0 });
      expect(chain.submit(binToHex(byKey.encoded)).accepted).toBe(false);
      // Sweeping: the secrets are right, and the controller wants its owner's signature.
      expect(chain.submit(binToHex(sweep(wallet, key, coins).encoded)).accepted).toBe(false);
    }
    // Nothing moved.
    expect((await quickPass(chain, wallet.identity, seed.viewingKey)).found.flatMap((entry) => entry.coins)).toHaveLength(2);
    // With the owner's key the same sweep is accepted.
    expect(chain.submit(binToHex(sweep(wallet, seed.controllerKey, coins).encoded)).accepted).toBe(true);
  });

  it('KV04: either half without the other gives no ordinary address; the blinding seed with the identity gives the vault addresses', async () => {
    const { chain, seed, wallet, pay } = setup();
    pay(givenOut, 0);
    pay(givenOut, 1);
    pay(change, 0);
    pay(vault, 0);
    pay(vault, 1);
    const whole = seed.viewingKey;
    const strangers = deriveSeedKeys(OTHER_WORDS, 'testnet', numbers).viewingKey;
    // The extended public keys without the blinding seed.
    const keysOnly: ViewingKey = { ...whole, blindingSeed: new Uint8Array(32) };
    expect((await quickPass(chain, wallet.identity, keysOnly)).found).toEqual([]);
    // The blinding seed without the extended public keys.
    const seedOnly: ViewingKey = { ...whole, addressNodes: strangers.addressNodes };
    const found = (await quickPass(chain, wallet.identity, seedOnly)).found;
    expect(found.map((entry) => `${entry.address.kind}/${entry.address.number}`).sort()).toEqual(['2/0', '2/1']);
    // And without the identity, not even those.
    expect((await quickPass(chain, new Uint8Array(32).fill(0x12), seedOnly)).found).toEqual([]);
  });
});

describe('the full pass', () => {
  it('KV10: a payment beyond the window is missed by the quick pass and found by the full pass', async () => {
    const { chain, seed, wallet, pay } = setup();
    pay(givenOut, 2);
    // Given out when number 30 was inside the window; the transaction that made it so was later dropped.
    pay(givenOut, 45);
    pay(change, 300);
    pay(vault, 77);
    const seeds = [{ label: 'the current seed', viewingKey: seed.viewingKey }];

    const quick = await searchWallet(chain, wallet.identity, seeds, { passes: ['quick'] });
    expect(places(quick.coins)).toEqual(['0/2']);
    // Not reported as fully found before the full pass has ended.
    expect(quick.status).toBe('searching');

    const full = await searchWallet(chain, wallet.identity, seeds, { resume: quick.seeds });
    expect(full.status).toBe('fully-found');
    expect(places(full.coins)).toEqual(['0/2', '0/45', '1/300', '2/77']);
    expect(full.seeds[0]?.full?.lookups).toBe(ADDRESS_RANGE[givenOut] + ADDRESS_RANGE[change] + ADDRESS_RANGE[vault]);
  }, 60_000);

  it('KV11: a restore on a device with no record of what was given out finds everything, up to the last number of a range', async () => {
    const { chain, seed, wallet, pay, at } = setup();
    const last = ADDRESS_RANGE[givenOut] - 1;
    pay(givenOut, last);
    pay(change, ADDRESS_RANGE[change] - 1);
    pay(vault, ADDRESS_RANGE[vault] - 1);
    const result = await fullPass(chain, wallet.identity, seed.viewingKey);
    expect(result.status).toBe('complete');
    expect(places(result.found.flatMap((entry) => entry.coins))).toEqual(['0/9999', '1/9999', '2/999']);
    // There is no address at or above the size of a range.
    expect(() => at(givenOut, last + 1)).toThrow(/numbered 0 to 9999/);
    // The device takes up the counters from what it found: the range of addresses given out is used up.
    const allocation = allocationFromUsed(result.found.map((entry) => ({ kind: entry.address.kind, number: entry.address.number })));
    expect(takeNumber(allocation, givenOut)).toMatchObject({ refused: { reason: 'range-used-up' } });
    // Spending still works: the coin at the last address moves by its key.
    const [coin] = chain.outputsAt(at(givenOut, last).lockingBytecode);
    const address = at(givenOut, last);
    if (coin === undefined || address.kind === vault) throw new Error('coin missing');
    wallet.send(buildTransaction({ inputs: [recoverableInput(coin, address.script, seed.addressKey(givenOut, last))], outputs: [{ lockingBytecode: p2pkhLockingBytecode(payee.keyHash), valueSatoshis: 0n }], remainderOutputIndex: 0 }));
  }, 60_000);
});

describe('a search that cannot be relied on says so', () => {
  /** A server that stops answering after a number of history requests. */
  const failingAfter = (chain: ChainReader, answers: number): ChainReader & { calls: number } => {
    const reader = {
      calls: 0,
      getTransaction: (transactionId: string) => chain.getTransaction(transactionId),
      listUnspent: (lockingBytecode: Uint8Array) => chain.listUnspent(lockingBytecode),
      getHistory: async (lockingBytecode: Uint8Array) => {
        reader.calls += 1;
        if (reader.calls > answers) throw new Error('connection lost');
        return chain.getHistory(lockingBytecode);
      },
    };
    return reader;
  };

  it('KV12: a server that does not answer gives "incomplete", never an empty wallet, and the pass continues where it stopped', async () => {
    const { chain, seed, wallet, pay } = setup();
    pay(givenOut, 0);
    pay(givenOut, 15);
    pay(change, 1);
    const silent = failingAfter(chain, 0);
    const nothing = await searchWallet(silent, wallet.identity, [{ label: 'the current seed', viewingKey: seed.viewingKey }], { passes: ['quick'] });
    expect(nothing.status).toBe('incomplete');
    expect(nothing.coins).toEqual([]);
    expect(nothing.reasons[0]).toMatch(/the current seed, quick pass: A server did not answer .* connection lost/);

    // Interrupted in the third batch of the first kind: what was found so far is kept.
    const interrupted = await quickPass(failingAfter(chain, 25), wallet.identity, seed.viewingKey, { batchSize: 10 });
    expect(interrupted.status).toBe('incomplete');
    expect(interrupted.progress).toEqual({ [givenOut]: 20, [change]: 0, [vault]: 0 });
    expect(places(interrupted.found.flatMap((entry) => entry.coins))).toEqual(['0/0', '0/15']);
    // Continued: the addresses already looked up are not asked about again.
    const continued = await quickPass(chain, wallet.identity, seed.viewingKey, { resume: interrupted, batchSize: 10 });
    expect(continued.status).toBe('complete');
    // Addresses given out 20 to 35, then seven change addresses and five vault addresses.
    expect(continued.lookups).toBe(16 + 7 + 5);
    expect(places(continued.found.flatMap((entry) => entry.coins))).toEqual(['0/0', '0/15', '1/1']);
  });

  it('KV12: a missing viewing key, or two that conflict, gives "incomplete" with the reason', async () => {
    const { chain, seed, wallet, pay } = setup();
    pay(givenOut, 0);
    const current = { label: 'the current seed', viewingKey: seed.viewingKey };
    const other = deriveSeedKeys(OTHER_WORDS, 'testnet', numbers).viewingKey;

    const missing = await searchWallet(chain, wallet.identity, [{ label: 'the first seed', missing: true }, current], { passes: ['quick'] });
    expect(missing.status).toBe('incomplete');
    expect(missing.reasons).toEqual(['The viewing key of the first seed is missing: its addresses cannot be searched.']);
    // What the other seed has is still found.
    expect(places(missing.coins)).toEqual(['0/0']);

    const conflicting = await searchWallet(chain, wallet.identity, [{ label: 'the first seed', conflicting: [seed.viewingKey, other] }], { passes: ['quick'] });
    expect(conflicting.status).toBe('incomplete');
    expect(conflicting.reasons[0]).toMatch(/2 different viewing keys are claimed for the first seed/);
    expect(conflicting.coins).toEqual([]);

    // A wallet with no seed to search is not "fully found" either.
    expect((await searchWallet(chain, wallet.identity, [])).status).toBe('searching');
  });

  it('KV12: an output listed as unspent whose transaction cannot be read stops the pass', async () => {
    const { chain, seed, wallet, pay } = setup();
    const paid = pay(givenOut, 0);
    const forgetful: ChainReader = {
      getHistory: (lockingBytecode) => chain.getHistory(lockingBytecode),
      listUnspent: (lockingBytecode) => chain.listUnspent(lockingBytecode),
      getTransaction: async (transactionId) => (transactionId === paid ? undefined : chain.getTransaction(transactionId)),
    };
    const result = await quickPass(forgetful, wallet.identity, seed.viewingKey);
    expect(result.status).toBe('incomplete');
    expect(result.reason).toMatch(/cannot be read/);
  });
});
