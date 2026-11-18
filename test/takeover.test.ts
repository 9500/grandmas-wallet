import { type Output, binToHex, decodeTransactionBch, hexToBin } from '@bitauth/libauth';
import { type AccountCoin, ADDRESS_KIND, buildTransaction, controllerScript, decodeControllerState, deriveCredentialKeys, deriveSeedKeys, p2pkhInput, p2pkhLockingBytecode, readControllerHistory, recoverableInput, walletAddress } from '@grandmas-wallet/core';
import { type OwnerWalletState, type Sent, OwnerWallet, RecovererWallet, walletTemplateNumbers } from '@grandmas-wallet/app';
import { KeyBackend, SimulatedChain, testKey } from '@grandmas-wallet/testing';
import { describe, expect, it } from 'vitest';

/**
 * Acceptance tests of the proposal for a new device taking over: SW01, SW03 to SW07, KV06, FE09, and the
 * wallet's part of MG01 and MG03 to MG06. On the simulated chain, with this project's own builder holding
 * the keys the XO engine would hold.
 */

const numbers = walletTemplateNumbers();
const WORDS = [
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
  'letter advice cage absurd amount doctor acoustic avoid letter advice cage above',
  'zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong',
];
const CREDENTIAL_WORDS = 'legal winner thank year wave sausage worth useful legal winner thank yellow';
const DELAY = { unit: 'time512', value: 1 } as const;
const payee = p2pkhLockingBytecode(testKey(0x44).keyHash);
const hex = binToHex;
const seedOf = (index: number) => deriveSeedKeys(WORDS[index] as string, 'testnet', numbers);
const credential = deriveCredentialKeys(CREDENTIAL_WORDS, 'testnet', numbers);

/** A wallet of the first seed, with its recoverer, and what a test needs to move it on. */
const start = async () => {
  const chain = new SimulatedChain();
  const first = seedOf(0);
  let kept: OwnerWalletState | undefined;
  const owner = await OwnerWallet.open({ backend: new KeyBackend(chain, first), chain, seed: first, save: (state) => (kept = state) });
  chain.fund(p2pkhLockingBytecode(first.fundingKey.keyHash), 100_000n);
  await owner.create({ recovererKeyHash: credential.recoveryKey.keyHash, challengeDelay: DELAY, allowance: { feeLockingBytecode: p2pkhLockingBytecode(credential.feeKey.keyHash), satoshis: 20_000n } });
  const identity = hexToBin(owner.stored.identity as string);
  const recovererBackend = () => new KeyBackend(chain, { controllerKey: credential.recoveryKey, fundingKey: credential.feeKey, addressKey: () => credential.feeKey });
  const recoverer = await RecovererWallet.open({ backend: recovererBackend(), chain, identity });
  /** A recovery to the seed with the given index: request, wait, complete. */
  const recoverTo = async (index: number): Promise<void> => {
    const again = await RecovererWallet.open({ backend: recovererBackend(), chain, identity });
    await again.request(seedOf(index).controllerKey.keyHash);
    chain.nowMs += 2 * 512 * 1000;
    await again.complete();
  };
  /** The device of a seed takes the wallet over, with the viewing keys of the seeds before it. */
  const takeOver = async (index: number, earlier: number[] = Array.from({ length: index }, (_, n) => n)) => {
    let stored: OwnerWalletState | undefined;
    const seed = seedOf(index);
    const wallet = await OwnerWallet.takeOver({ backend: new KeyBackend(chain, seed), chain, seed, identity, earlierViewingKeys: earlier.map((n) => seedOf(n).viewingKey), save: (state) => (stored = state) });
    /** The same device after a restart: a key holder with no memory, and the stored state. */
    const restart = async () => OwnerWallet.open({ backend: new KeyBackend(chain, seed), chain, seed, state: stored as OwnerWalletState, save: (state) => (stored = state) });
    return { wallet, restart, seed };
  };
  const state = () => {
    const [utxo] = chain.outputsAt(controllerScript(identity).lockingBytecode);
    return decodeControllerState(utxo?.output.token?.nft?.commitment as Uint8Array);
  };
  return { chain, owner, first, identity, recoverer, recoverTo, takeOver, state, kept: () => kept as OwnerWalletState };
};
const token = (chain: SimulatedChain, lockingBytecode: Uint8Array, kind: Omit<NonNullable<Output['token']>, 'category'>): string => {
  const minter = testKey(0xa0 + chain.outputsAt(lockingBytecode).length + Math.floor(Number(kind.amount % 7n)));
  const locking = p2pkhLockingBytecode(minter.keyHash);
  const category = chain.fund(locking, 5_000n + kind.amount);
  const [coin] = chain.outputsAt(locking).filter((candidate) => hex(candidate.transactionHash) === category);
  if (coin === undefined) throw new Error('minting coin missing');
  const built = buildTransaction({ inputs: [p2pkhInput(coin, minter)], outputs: [{ lockingBytecode, valueSatoshis: 1_000n, token: { category: hexToBin(category), ...kind } }], changeLockingBytecode: locking });
  expect(chain.submit(hex(built.encoded)).accepted).toBe(true);
  return category;
};

describe('a new device takes over', () => {
  it('SW01: after the full pass the new device holds everything at its own addresses; the earlier seed can move nothing that was swept', async () => {
    const { chain, owner, first, identity, recoverTo, takeOver } = await start();
    const given = (await owner.receiveAddress()).address;
    chain.fund(given.lockingBytecode, 10_000n);
    chain.fund((await owner.receiveAddress()).address.lockingBytecode, 7_000n);
    chain.fund((await owner.vaultAddress()).address.lockingBytecode, 5_000n);
    const fungible = token(chain, (await owner.receiveAddress()).address.lockingBytecode, { amount: 250n });
    const before = await owner.balance();
    const held = before.recoverable + before.vault + 1_000n;

    // The owner's device is erased. The recoverer requests, waits and completes; no coin has moved.
    await recoverTo(1);
    const { wallet, seed } = await takeOver(1);
    expect((await wallet.balance()).recoverable).toBe(0n);
    const quick = await wallet.search({ passes: ['quick'] });
    expect(quick.status).toBe('searching');
    const search = await wallet.search();
    expect(search.status).toBe('fully-found');
    expect((await wallet.balance()).toSweep).toBe(held);

    const swept = await wallet.sweepEarlier();
    expect(swept.transactions).toHaveLength(1);
    // The fee came out of the swept coins, and the token arrived unchanged.
    const after = await wallet.balance();
    expect(after.toSweep).toBe(0n);
    expect(after.recoverable + 1_000n).toBe(held - (swept.transactions[0] as Sent).feeSatoshis);
    // The sweep put nothing aside; the new device pays for refusing a request from its ordinary coins.
    const sweep = decodeTransactionBch(hexToBin((await chain.getTransaction((swept.transactions[0] as Sent).transactionId)) as string));
    if (typeof sweep === 'string') throw new Error(sweep);
    // The controller, the token, and the rest in one coin.
    expect(sweep.outputs).toHaveLength(3);
    expect(await wallet.canCancel()).toBe(true);
    expect((swept.transactions[0] as Sent).feeSatoshis).toBe(BigInt((swept.transactions[0] as Sent).bytes));
    expect(after.tokens.map((coin) => hex((coin.utxo.output.token as NonNullable<Output['token']>).category))).toEqual([fungible]);
    expect((after.tokens[0] as AccountCoin).utxo.output.token).toMatchObject({ amount: 250n });
    expect(swept.tokens).toEqual([{ category: fungible, meaning: 'unknown' }]);

    // Everything is at addresses of the new seed, which the earlier seed's keys do not open.
    expect(await owner.balance()).toMatchObject({ recoverable: 0n, vault: 0n, tokens: [] });
    expect(chain.outputsAt(given.lockingBytecode)).toEqual([]);
    const mine = walletAddress(identity, seed.viewingKey, ADDRESS_KIND.change, 0);
    const [coin] = chain.outputsAt(mine.lockingBytecode);
    if (coin === undefined || mine.kind === ADDRESS_KIND.vault) throw new Error('swept coin missing');
    const theft = buildTransaction({ inputs: [recoverableInput(coin, mine.script, first.addressKey(ADDRESS_KIND.change, 0))], outputs: [{ lockingBytecode: payee, valueSatoshis: 0n }], remainderOutputIndex: 0, allowTokenBurn: true });
    expect(chain.submit(hex(theft.encoded)).accepted).toBe(false);
    // The earlier seed's controller key no longer acts on the controller either.
    await expect(owner.cancel()).rejects.toThrow();
    // The new owner pays from what it swept, by its own keys.
    await wallet.pay([{ lockingBytecode: payee, valueSatoshis: 20_000n }]);
  }, 60_000);

  it('SW03: a sweep in several transactions, interrupted between them, completes; nothing is lost or moved twice', async () => {
    const { chain, owner, recoverTo, takeOver } = await start();
    for (let count = 0; count < 8; count++) chain.fund((await owner.receiveAddress()).address.lockingBytecode, 3_000n + BigInt(count));
    const before = await owner.balance();
    const held = before.recoverable;
    await recoverTo(1);
    const { wallet, restart } = await takeOver(1);
    await wallet.search({ passes: ['quick'] });
    const coins = 9;
    // The device stops after the first of several transactions.
    const first = await wallet.sweepEarlier({ maximumCoins: 4, maximumTransactions: 1 });
    expect(first).toMatchObject({ coins: 4 });
    const again = await restart();
    expect((await again.balance()).toSweep).toBeGreaterThan(0n);
    const rest = await again.sweepEarlier({ maximumCoins: 4 });
    expect(first.coins + rest.coins).toBe(coins);
    expect(rest.transactions).toHaveLength(2);
    const fees = [...first.transactions, ...rest.transactions].reduce((sum, sent) => sum + sent.feeSatoshis, 0n);
    const after = await again.balance();
    expect(after.toSweep).toBe(0n);
    expect(after.recoverable).toBe(held - fees);
    // A third call finds nothing left to do.
    expect(await again.sweepEarlier()).toMatchObject({ coins: 0, transactions: [] });
  });

  it('SW04: a wallet that holds only tokens is swept once the fee has a source', async () => {
    const { chain, owner, recoverTo, takeOver } = await start();
    const category = token(chain, (await owner.receiveAddress()).address.lockingBytecode, { amount: 0n, nft: { capability: 'none', commitment: Uint8Array.of(7) } });
    await owner.sendEverything(payee);
    await recoverTo(1);
    const { wallet } = await takeOver(1);
    await wallet.search({ passes: ['quick'] });
    expect((await wallet.balance()).toSweep).toBe(1_000n);
    // The token's own coin cannot pay: a fee never comes from a token.
    await expect(wallet.sweepEarlier()).rejects.toThrow(/do not cover the outputs and the fee/);
    // A coin received at a new address pays.
    chain.fund((await wallet.receiveAddress()).address.lockingBytecode, 5_000n);
    const swept = await wallet.sweepEarlier();
    expect(swept.tokens).toEqual([{ category, meaning: 'unknown' }]);
    const after = await wallet.balance();
    expect(after.tokens).toHaveLength(1);
    expect((after.tokens[0] as AccountCoin).utxo.output.token).toEqual({ amount: 0n, category: hexToBin(category), nft: { capability: 'none', commitment: Uint8Array.of(7) } });
    expect(after.toSweep).toBe(0n);
  });

  it('SW05: a payment to an earlier address after the recovery is found and swept', async () => {
    const { chain, owner, recoverTo, takeOver } = await start();
    const old = (await owner.receiveAddress()).address;
    chain.fund(old.lockingBytecode, 10_000n);
    await recoverTo(1);
    const { wallet } = await takeOver(1);
    await wallet.search({ passes: ['quick'] });
    await wallet.sweepEarlier();
    expect((await wallet.balance()).toSweep).toBe(0n);
    // Someone pays the address the earlier phone gave out, and a later one inside its window.
    chain.fund(old.lockingBytecode, 4_000n);
    chain.fund((await owner.receiveAddress()).address.lockingBytecode, 6_000n);
    await wallet.search({ passes: ['quick'] });
    expect((await wallet.balance()).toSweep).toBe(10_000n);
    const before = (await wallet.balance()).recoverable;
    const swept = await wallet.sweepEarlier();
    expect(swept.coins).toBe(2);
    expect((await wallet.balance()).recoverable).toBe(before + 10_000n - (swept.transactions[0] as Sent).feeSatoshis);
  });

  it('SW06: a sweep while a request is pending cancels the request', async () => {
    const { chain, owner, recoverer, recoverTo, takeOver, state } = await start();
    chain.fund((await owner.receiveAddress()).address.lockingBytecode, 10_000n);
    await recoverTo(1);
    const { wallet } = await takeOver(1);
    await wallet.search({ passes: ['quick'] });
    // The recoverer asks again, for another key, before the new device has swept.
    const again = await RecovererWallet.open({ backend: new KeyBackend(chain, { controllerKey: credential.recoveryKey, fundingKey: credential.feeKey, addressKey: () => credential.feeKey }), chain, identity: recoverer.identity });
    await again.request(testKey(0x99).keyHash);
    expect(state().status).toBe('pending');
    await wallet.sweepEarlier();
    expect(state()).toMatchObject({ status: 'active', ownerEpoch: 1 });
  });

  it('a new device that holds nothing at its own addresses yet refuses a request with a coin at an earlier seed\'s address', async () => {
    const { chain, owner, recoverer, recoverTo, takeOver, state } = await start();
    chain.fund((await owner.receiveAddress()).address.lockingBytecode, 10_000n);
    await recoverTo(1);
    const { wallet } = await takeOver(1);
    await wallet.search({ passes: ['quick'] });
    const before = await wallet.balance();
    expect(before.recoverable).toBe(0n);
    const again = await RecovererWallet.open({ backend: new KeyBackend(chain, { controllerKey: credential.recoveryKey, fundingKey: credential.feeKey, addressKey: () => credential.feeKey }), chain, identity: recoverer.identity });
    await again.request(testKey(0x99).keyHash);
    expect(state().status).toBe('pending');
    expect(await wallet.canCancel()).toBe(true);
    const sent = await wallet.cancel();
    expect(state()).toMatchObject({ status: 'active', ownerEpoch: 1 });
    // The smallest earlier coin that pays alone went through the controller; its change is at this seed's address.
    const after = await wallet.balance();
    expect(after.recoverable + after.toSweep).toBe(before.toSweep - sent.feeSatoshis);
    expect(after.recoverable).toBeGreaterThan(0n);
  });

  it('SW07: an NFT of an application the wallet has never seen is swept, and reported as a token of unknown meaning', async () => {
    const { chain, owner, recoverTo, takeOver } = await start();
    const category = token(chain, (await owner.receiveAddress()).address.lockingBytecode, { amount: 0n, nft: { capability: 'mutable', commitment: Uint8Array.of(1, 2, 3, 4) } });
    chain.fund((await owner.receiveAddress()).address.lockingBytecode, 50_000n);
    await recoverTo(1);
    const { wallet } = await takeOver(1);
    await wallet.search({ passes: ['quick'] });
    const tokenCoin = (await wallet.balance()).toSweep;
    expect(tokenCoin).toBeGreaterThan(50_000n);
    // One coin to a transaction: the coin with the token goes first, though another holds fifty times as much.
    // It cannot pay its own fee, so the largest coin without a token goes with it.
    const swept = await wallet.sweepEarlier({ maximumCoins: 1 });
    expect(swept.transactions.length).toBeGreaterThan(1);
    const firstTransaction = decodeTransactionBch(hexToBin((await chain.getTransaction((swept.transactions[0] as Sent).transactionId)) as string));
    if (typeof firstTransaction === 'string') throw new Error(firstTransaction);
    expect(firstTransaction.inputs).toHaveLength(3);
    expect(firstTransaction.outputs[1]?.token?.category).toEqual(hexToBin(category));
    expect(swept.tokens).toEqual([{ category, meaning: 'unknown' }]);
    const [held] = (await wallet.balance()).tokens;
    expect(held?.utxo.output.token).toEqual({ amount: 0n, category: hexToBin(category), nft: { capability: 'mutable', commitment: Uint8Array.of(1, 2, 3, 4) } });
  });

  it('FE09: sending everything after a recovery includes coins at earlier addresses that are not yet swept, through the controller', async () => {
    const { chain, owner, recoverTo, takeOver } = await start();
    chain.fund((await owner.receiveAddress()).address.lockingBytecode, 10_000n);
    chain.fund((await owner.vaultAddress()).address.lockingBytecode, 5_000n);
    const before = await owner.balance();
    const held = before.recoverable + before.vault;
    await recoverTo(1);
    const { wallet } = await takeOver(1);
    await wallet.search({ passes: ['quick'] });
    chain.fund((await wallet.receiveAddress()).address.lockingBytecode, 3_000n);
    const result = await wallet.sendEverything(payee);
    expect(result.transactions).toHaveLength(1);
    expect(result.sentSatoshis).toBe(held + 3_000n - result.feeSatoshis);
    expect(result.feeSatoshis).toBe(BigInt((result.transactions[0] as Sent).bytes));
    expect(chain.balanceOf(payee)).toBe(result.sentSatoshis);
    expect(await wallet.balance()).toMatchObject({ recoverable: 0n, vault: 0n, toSweep: 0n });
  });
});

describe('the twelve words and the identity on another device', () => {
  it('KV06: the same wallet, with no controller transaction', async () => {
    const { chain, owner, first, identity } = await start();
    chain.fund((await owner.receiveAddress()).address.lockingBytecode, 10_000n);
    chain.fund((await owner.vaultAddress()).address.lockingBytecode, 5_000n);
    await owner.pay([{ lockingBytecode: payee, valueSatoshis: 2_000n }]);
    const balance = await owner.balance();
    const steps = (await readControllerHistory(chain, identity)).transitions.length;

    const other = await OwnerWallet.takeOver({ backend: new KeyBackend(chain, first), chain, seed: first, identity });
    const search = await other.search();
    expect(search.status).toBe('fully-found');
    const found = await other.balance();
    // Everything, at the same addresses.
    expect(found.recoverable).toBe(balance.recoverable);
    expect(found).toMatchObject({ vault: balance.vault, toSweep: 0n });
    expect((await readControllerHistory(chain, identity)).transitions).toHaveLength(steps);
    // It goes on where the first device stopped: the next address is one that was never given out.
    expect((await other.receiveAddress()).address.number).toBe(1);
    await other.pay([{ lockingBytecode: payee, valueSatoshis: 3_000n }]);
  }, 60_000);

  it('KV06: for a wallet that has had earlier seeds, earlier addresses are found when the earlier viewing keys are supplied, and the device says so when they are not', async () => {
    const { chain, owner, recoverTo, takeOver } = await start();
    chain.fund((await owner.receiveAddress()).address.lockingBytecode, 10_000n);
    await recoverTo(1);

    const without = await takeOver(1, []);
    const blind = await without.wallet.search({ passes: ['quick'] });
    expect(blind.status).toBe('incomplete');
    expect(blind.reasons).toEqual(['The viewing key of an earlier seed is missing: its addresses cannot be searched.']);
    expect((await without.wallet.balance()).toSweep).toBe(0n);
    // It is not taken for a fully searched wallet, and so cannot be closed either.
    expect(without.wallet.stored.fullySearched).toBe(false);

    const supplied = await takeOver(1, [0]);
    const search = await supplied.wallet.search({ passes: ['quick'] });
    expect(search.status).toBe('searching');
    expect((await supplied.wallet.balance()).toSweep).toBeGreaterThan(10_000n);
  });
});

describe('moving on without a loss', () => {
  it('MG01: a move to a new seed by ownerUpdate needs no waiting period; after the sweep the earlier seed can move nothing that was swept', async () => {
    const { chain, owner, takeOver, state } = await start();
    const old = (await owner.receiveAddress()).address;
    chain.fund(old.lockingBytecode, 10_000n);
    const next = seedOf(1);
    // The old device, still working, names the new device's key. It takes effect at once.
    await owner.changeSettings({ ownerKeyHash: next.controllerKey.keyHash });
    expect(state()).toMatchObject({ status: 'active', ownerEpoch: 1, ownerKeyHash: next.controllerKey.keyHash });
    const { wallet } = await takeOver(1);
    await wallet.search({ passes: ['quick'] });
    const swept = await wallet.sweepEarlier();
    expect(swept.coins).toBeGreaterThanOrEqual(2);
    expect(chain.outputsAt(old.lockingBytecode)).toEqual([]);
    expect(await owner.balance()).toMatchObject({ recoverable: 0n });
    expect((await wallet.balance()).toSweep).toBe(0n);
  });

  it('MG03: replacing the recoverer while a request is pending clears the request; the earlier recoverer\'s key can neither request nor complete', async () => {
    const { chain, owner, identity, recoverer, state } = await start();
    chain.fund((await owner.receiveAddress()).address.lockingBytecode, 10_000n);
    await recoverer.request(testKey(0x99).keyHash);
    expect(state().status).toBe('pending');
    const replacement = deriveCredentialKeys(WORDS[2] as string, 'testnet', numbers);
    await owner.changeSettings({ recovererKeyHash: replacement.recoveryKey.keyHash });
    expect(state()).toMatchObject({ status: 'active', ownerEpoch: 0, recovererKeyHash: replacement.recoveryKey.keyHash });
    // The earlier recoverer: its account is no longer taken for the wallet's recoverer, and its transactions are refused.
    chain.nowMs += 2 * 512 * 1000;
    await expect(recoverer.complete()).rejects.toThrow();
    await expect(recoverer.request(testKey(0x98).keyHash)).rejects.toThrow();
    const earlierAccount = new KeyBackend(chain, { controllerKey: credential.recoveryKey, fundingKey: credential.feeKey, addressKey: () => credential.feeKey });
    await expect(RecovererWallet.open({ backend: earlierAccount, chain, identity })).rejects.toThrow(/not the recoverer named/);
    expect(state().status).toBe('active');
  });

  it('MG04: what the earlier recoverer holds is not counted as available; the new one has a fee address of its own, with an allowance only if the user gives one', async () => {
    const { chain, owner, identity } = await start();
    const earlierFeeAddress = p2pkhLockingBytecode(credential.feeKey.keyHash);
    expect(chain.balanceOf(earlierFeeAddress)).toBe(20_000n);
    const replacement = deriveCredentialKeys(WORDS[2] as string, 'testnet', numbers);
    const balance = await owner.balance();
    await owner.changeSettings({ recovererKeyHash: replacement.recoveryKey.keyHash });
    // The wallet's balance never included the allowance, and the earlier recoverer keeps it.
    expect((await owner.balance()).recoverable).toBeLessThan(balance.recoverable);
    expect(chain.balanceOf(earlierFeeAddress)).toBe(20_000n);
    const account = new KeyBackend(chain, { controllerKey: replacement.recoveryKey, fundingKey: replacement.feeKey, addressKey: () => replacement.feeKey });
    const next = await RecovererWallet.open({ backend: account, chain, identity });
    expect(hex(await next.feeAddress())).not.toBe(hex(earlierFeeAddress));
    // No allowance was given: the new recoverer says what it needs.
    expect(await next.feeReadiness()).toMatchObject({ holds: 0n, canRequest: false });
    // The user gives one: an ordinary payment to the new fee address.
    await owner.pay([{ lockingBytecode: await next.feeAddress(), valueSatoshis: 4_900n }]);
    expect(await next.feeReadiness()).toMatchObject({ holds: 4_900n, canRecover: true });
  });

  it('MG05: a device that sees another key own the wallet stops giving out addresses and offers to move unswept coins out; nothing is offered for vault coins', async () => {
    const { chain, owner, recoverTo } = await start();
    chain.fund((await owner.receiveAddress()).address.lockingBytecode, 10_000n);
    chain.fund((await owner.vaultAddress()).address.lockingBytecode, 5_000n);
    expect(await owner.checkOwnership()).toBe('this device');
    await recoverTo(1);
    // Seen, but not settled (one server only, or servers that disagree): the device gives out nothing and
    // takes on nothing at once; it has not stopped for good.
    expect(await owner.checkOwnership(false)).toBe('another key');
    expect(owner.stored).toMatchObject({ otherOwnerSeen: true });
    expect(owner.stored.ownedElsewhere).toBeUndefined();
    await expect(owner.receiveAddress()).rejects.toThrow(/another key owns this wallet/);
    // Settled: in a block, and on more than one server.
    expect(await owner.checkOwnership()).toBe('another key');
    expect(owner.stored).toMatchObject({ ownedElsewhere: true, otherOwnerSeen: false });
    await expect(owner.receiveAddress()).rejects.toThrow(/another key owns this wallet/);
    await expect(owner.pay([{ lockingBytecode: payee, valueSatoshis: 1_000n }])).rejects.toThrow(/another key owns this wallet/);
    await expect(owner.sendEverything(payee)).rejects.toThrow(/another key owns this wallet/);

    // The owner did not want this: the device's keys still spend what has not been swept.
    const before = await owner.balance();
    const moved = await owner.moveOut(payee);
    expect(moved.sentSatoshis).toBe(before.recoverable - moved.feeSatoshis);
    expect(chain.balanceOf(payee)).toBe(moved.sentSatoshis);
    // The vault coin stays where it is: no key of this device opens it.
    expect((await owner.balance()).vault).toBe(5_000n);
  });

  it('MG05: a completion that is not in a block pauses the device; when the owner\'s cancellation wins, it goes on by itself', async () => {
    const { chain, owner, identity } = await start();
    chain.blocksOnDemand = true;
    const recoverer = await RecovererWallet.open({ backend: new KeyBackend(chain, { controllerKey: credential.recoveryKey, fundingKey: credential.feeKey, addressKey: () => credential.feeKey }), chain, identity });
    await recoverer.request(seedOf(1).controllerKey.keyHash);
    chain.mine();
    chain.nowMs += 2 * 512 * 1000;
    const completion = await recoverer.complete();
    expect(await owner.checkOwnership()).toBe('another key');
    expect(owner.stored).toMatchObject({ otherOwnerSeen: true });
    expect(owner.stored.ownedElsewhere).toBeUndefined();
    await expect(owner.receiveAddress()).rejects.toThrow(/another key owns this wallet/);
    // The completion loses the race to the owner's cancellation, sent from elsewhere with the owner's key.
    chain.drop(completion.transactionId);
    expect(await owner.checkOwnership()).toBe('this device');
    expect(owner.stored).toMatchObject({ otherOwnerSeen: false });
    expect((await owner.receiveAddress()).again).toBe(false);
    await owner.cancel();
  });

  it('MG06: after two recoveries, first payments to an ordinary and to a vault address of the first seed are found and swept by the current owner', async () => {
    const { chain, owner, first, identity, recoverTo, takeOver } = await start();
    // Addresses the first phone gave out and that nobody has paid yet.
    const ordinary = (await owner.receiveAddress()).address;
    const vault = (await owner.vaultAddress()).address;
    await owner.sendEverything(payee);
    await recoverTo(1);
    const second = await takeOver(1);
    await second.wallet.search({ passes: ['quick'] });
    await recoverTo(2);
    const third = await takeOver(2);

    chain.fund(ordinary.lockingBytecode, 8_000n);
    chain.fund(vault.lockingBytecode, 6_000n);
    const search = await third.wallet.search({ passes: ['quick'] });
    expect(search.reasons).toEqual([]);
    expect((await third.wallet.balance()).toSweep).toBe(14_000n);
    // Only the ordinary one could also have been spent by the first seed: its key still opens that address.
    expect(await owner.balance()).toMatchObject({ recoverable: 8_000n, vault: 6_000n });
    if (ordinary.kind === ADDRESS_KIND.vault) throw new Error('unexpected');
    expect(hex(first.addressKey(ordinary.kind, ordinary.number).keyHash)).toBe(hex(ordinary.keyHash));
    await expect(owner.sendEverything(payee)).rejects.toThrow();
    // The vault coin never obeyed a key; the first seed's device cannot move it, by any path it has.
    const swept = await third.wallet.sweepEarlier();
    expect(swept.coins).toBe(2);
    expect(await third.wallet.balance()).toMatchObject({ toSweep: 0n, recoverable: 14_000n - (swept.transactions[0] as Sent).feeSatoshis });
    expect((await readControllerHistory(chain, identity)).owners).toHaveLength(3);
  });

  it('MG07: after a move to a new identity the old one is kept, not retired: a later payment to its vault address is found, released by its own controller, and it can still be recovered', async () => {
    const { chain, owner, identity, recoverTo, takeOver } = await start();
    const vault = (await owner.vaultAddress()).address;
    chain.fund(vault.lockingBytecode, 6_000n);
    expect(await owner.standing()).toMatchObject({ state: 'in use', watched: true });

    // A wallet with a new identity, here of another seed, and the move: ordinary payments from the old addresses, the vault coin released by the old controller.
    const next = seedOf(1);
    const successor = await OwnerWallet.open({ backend: new KeyBackend(chain, next), chain, seed: next });
    chain.fund(p2pkhLockingBytecode(next.fundingKey.keyHash), 50_000n);
    await successor.create({ recovererKeyHash: credential.recoveryKey.keyHash, challengeDelay: DELAY });
    expect(successor.stored.identity).not.toBe(owner.stored.identity);
    await owner.sendEverything((await successor.receiveAddress()).address.lockingBytecode);
    owner.noteMovedTo(successor.stored.identity as string);

    // The old identity holds nothing, and is kept all the same.
    expect(await owner.balance()).toMatchObject({ recoverable: 0n, vault: 0n });
    const kept = await owner.standing();
    expect(kept).toMatchObject({ state: 'kept', watched: true, movedTo: successor.stored.identity });
    expect(kept.note).toMatch(/stays watched and recoverable, whatever it holds/);
    expect(await owner.closed()).toBe(false);

    // The published vault address is paid later. The old wallet sees it, and its own controller releases it.
    chain.fund(vault.lockingBytecode, 9_000n);
    chain.fund((await owner.receiveAddress()).address.lockingBytecode, 3_000n);
    expect((await owner.balance()).vault).toBe(9_000n);
    const released = await owner.sendEverything((await successor.receiveAddress()).address.lockingBytecode);
    expect(released.sentSatoshis).toBeGreaterThan(9_000n);
    expect((await owner.balance()).vault).toBe(0n);

    // And it is still recoverable: after a recovery of the old identity, a new device finds what arrives at that address.
    chain.fund(vault.lockingBytecode, 7_000n);
    await recoverTo(2);
    const { wallet } = await takeOver(2, [0]);
    await wallet.search({ passes: ['quick'] });
    expect((await wallet.balance()).toSweep).toBe(7_000n);
    expect((await readControllerHistory(chain, identity)).closed).toBeUndefined();
  });
});
