import { binToHex, decodeTransactionBch, generateBip39Mnemonic, hexToBin } from '@bitauth/libauth';
import { MemoryStore } from '@grandmas-wallet/archive';
import {
  type CreationRecord,
  type OwnerWalletState,
  type PendingSetUp,
  type SetUpAnswer,
  FundsMissingError,
  OwnerWallet,
  RecovererFunds,
  RecovererWallet,
  SetUpError,
  SetUpRefusal,
  acceptTakeover,
  checkRecovery,
  completeTakeover,
  creationCost,
  earlierFeeCoins,
  finishSetUp,
  finishTakeover,
  firstAddressFor,
  kitTemplates,
  openSetUpRequest,
  requestSetUp,
  setUpForRequest,
  startTakeover,
  walletTemplateNumbers,
} from '@grandmas-wallet/app';
import { type ChainReader, type ChallengeDelay, ADDRESS_KIND, controllerScript, deriveSeedKeys, encodeControllerState, p2pkhLockingBytecode, readControllerHistory, validateGenesis } from '@grandmas-wallet/core';
import { type KeptKit, credentialKeys, generateRecipientKeyPair } from '@grandmas-wallet/enrollment';
import { KeyBackend, SimulatedChain, testKey } from '@grandmas-wallet/testing';
import { describe, expect, it } from 'vitest';

/**
 * Setting a wallet up with the recoverer (proposal section 7.9, tests CR05 to CR09): the phone asks, the recoverer
 * creates the wallet from its own coins and keeps the kit, the phone checks the creation and opens its wallet. The
 * wallets' own code on the simulated chain, with backup stores in memory.
 */

const numbers = walletTemplateNumbers();
const PHONE = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const NEW_PHONE = 'zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong';
const FUNDS = 'letter advice cage absurd amount doctor acoustic avoid letter advice cage above';
const DELAY = { unit: 'time512', value: 1 } as const;
const STARTING = 20_000n;
const STORES = ['https://store1.example', 'https://store2.example'];
const payee = p2pkhLockingBytecode(testKey(0x44).keyHash);
const hex = binToHex;

const start = async (options: { blocksOnDemand?: boolean; balance?: bigint; reader?: (chain: SimulatedChain) => ChainReader } = {}) => {
  const chain = new SimulatedChain();
  chain.blocksOnDemand = options.blocksOnDemand ?? false;
  const reader = options.reader?.(chain) ?? chain;
  const stores = new Map(STORES.map((address) => [address, new MemoryStore(address)]));
  const storeAt = (address: string): MemoryStore => stores.get(address) as MemoryStore;
  const phone = deriveSeedKeys(PHONE, 'testnet', numbers);
  const fundsSeed = deriveSeedKeys(FUNDS, 'testnet', numbers);
  const fundsBackend = new KeyBackend(chain, fundsSeed);
  const funds = await RecovererFunds.open({ backend: fundsBackend, chain: reader });
  const fundsAddress = await funds.address();
  const fundedIn = chain.fund(fundsAddress, options.balance ?? 200_000n, 1);
  const device = await generateRecipientKeyPair();

  /** The recoverer's records, as its page keeps them: by request. */
  const records = new Map<string, CreationRecord>();
  const kits = new Map<string, KeptKit>();
  const recover = async (sealed: Uint8Array, offer = { challengeDelay: DELAY, startingSatoshis: STARTING }, using = funds) => {
    const read = await openSetUpRequest(sealed, device.privateKey, 'testnet');
    const id = read.request.requestId;
    const record = records.get(id) ?? { credentialWords: generateBip39Mnemonic() };
    records.set(id, record);
    return setUpForRequest({ read, funds: using, chain: reader, storeAt, offer, record, save: (next) => void records.set(id, next), label: 'Grandma', madeAt: 1_794_950_000, keepKit: (kept) => void kits.set(kept.kit.identity, kept) });
  };

  let state: OwnerWalletState | undefined;
  const ask = async (challengeDelay: ChallengeDelay = DELAY): Promise<PendingSetUp> =>
    requestSetUp({ seed: phone, stores: STORES, storeAt, recovererPublicKey: device.publicKey, challengeDelay, firstAddress: firstAddressFor(state) });
  const open = async (answer: SetUpAnswer, pending: PendingSetUp) =>
    finishSetUp({ answer, pending, seed: phone, backend: new KeyBackend(chain, phone), chain: reader, ...(state === undefined ? {} : { state }), save: (next) => (state = next) });
  return { chain, reader, storeAt, stores, phone, funds, fundsBackend, fundsAddress, fundedIn, device, records, kits, recover, ask, open, state: () => state as OwnerWalletState };
};

describe('the recoverer creates the wallet, the phone opens it', () => {
  it('CR05: one request, one creation from the recoverer\'s coins; the phone checks it, opens its wallet, and recovery is on with the receipt', async () => {
    const { chain, storeAt, phone, funds, fundsAddress, kits, recover, ask, open } = await start();
    const before = await funds.balance();
    const pending = await ask();
    const { answer, kept } = await recover(hexToBin(pending.sealed));

    // The creation: the controller naming the phone's key, the recoverer's key for this wallet and the waiting period,
    // and the starting balance at the phone's address. Nothing is kept apart for the recoverer's fees.
    const history = await readControllerHistory(chain, hexToBin(answer.identity));
    expect(history.transactions[0]?.transactionId).toBe(answer.creationTransactionId);
    expect(hex(history.current.state.ownerKeyHash)).toBe(hex(phone.controllerKey.keyHash));
    expect(hex(history.current.state.recovererKeyHash)).toBe(answer.recoveryKeyHash);
    expect(history.current.state.challengeDelay).toEqual(DELAY);
    const words = ((kits.get(answer.identity) as KeptKit).kit.credential as { words: string }).words;
    const feeAddress = p2pkhLockingBytecode(credentialKeys(words, 'testnet', kitTemplates()).feeKey.keyHash);
    expect(chain.balanceOf(feeAddress)).toBe(0n);
    expect((await chain.getTransaction(answer.creationTransactionId))?.length).toBeGreaterThan(0);
    // The recoverer paid for everything; no more than the cost it states.
    const spent = before - (await funds.balance());
    expect(spent).toBeLessThanOrEqual(creationCost(STARTING));
    expect(chain.balanceOf(fundsAddress)).toBe(await funds.balance());
    // The kit answers the request and holds what a recovery needs.
    expect(kept.answered).toBe(pending.requestHash);
    expect(kept.viewingKeyRecords).toHaveLength(1);
    expect(kept.kit.policy.ownerKeyHash).toBe(hex(phone.controllerKey.keyHash));

    const opened = await open(answer, pending);
    expect(opened.startingSatoshis).toBe(STARTING);
    expect(opened.wallet.created).toBe(true);
    expect((await opened.wallet.balance()).recoverable).toBe(STARTING);
    // The receipt is on the phone's stores: recovery is on.
    const status = await checkRecovery({ wallet: opened.wallet, chain, arrangement: opened.arrangement, storeAt, network: 'testnet' });
    expect(status.status).toMatchObject({ on: true });
    expect(opened.wallet.recovery).toBe('on');
  });

  it('CR05: the starting balance is spendable at once, before any block, and the phone can refuse a request at once', async () => {
    const { chain, recover, ask, open } = await start({ blocksOnDemand: true });
    const pending = await ask();
    const { answer } = await recover(hexToBin(pending.sealed));
    const { wallet } = await open(answer, pending);
    expect(chain.knows(answer.creationTransactionId)).toBe(true);
    expect(await wallet.creationStep()).toBe('created');
    expect(await wallet.canCancel()).toBe(true);
    const sent = await wallet.pay([{ lockingBytecode: payee, valueSatoshis: 5_000n }]);
    expect(chain.knows(sent.transactionId)).toBe(true);
    expect((await wallet.receiveAddress()).address.number).toBe(0);
    chain.mine();
    expect(await wallet.creationStep()).toBe('created');
    expect(wallet.stored.creation).toMatchObject({ byRecoverer: true, confirmed: true });
  });

  it('CR06: the phone refuses a creation that names another owner, another recoverer or another waiting period', async () => {
    const { storeAt, device, recover, ask, open, state } = await start();
    const pending = await ask();
    const { answer } = await recover(hexToBin(pending.sealed));
    // The answer names a recovery key that is not the one in the creation.
    await expect(open({ ...answer, recoveryKeyHash: '11'.repeat(20) }, pending)).rejects.toThrow(new SetUpError('The wallet that was created names another recoverer than the one that answered.'));
    // The phone was told another waiting period than the one the creation has.
    await expect(open(answer, { ...pending, challengeDelay: { unit: 'time512', value: 7 } })).rejects.toThrow(new SetUpError('The wallet that was created has another waiting period than the one you were told.'));
    // A creation for another phone's key: the answer names someone else's wallet.
    const other = deriveSeedKeys(NEW_PHONE, 'testnet', numbers);
    const theirs = await requestSetUp({ seed: other, stores: STORES, storeAt, recovererPublicKey: device.publicKey, challengeDelay: DELAY, firstAddress: 0 });
    const created = await recover(hexToBin(theirs.sealed));
    await expect(open(created.answer, pending)).rejects.toThrow(new SetUpError('The wallet that was created names another owner than this phone.'));
    // A transaction that is not a creation at all.
    await expect(open({ ...answer, identity: answer.creationTransactionId }, pending)).rejects.toThrow(/was not created as a wallet must be/);
    // Nothing was opened: the phone keeps no wallet.
    expect(state()).toBeUndefined();
  });

  it('CR06: a request is opened only with the recoverer\'s key; the recoverer refuses one for another waiting period than it uses now, and creates nothing', async () => {
    const { chain, recover, ask, records } = await start();
    const pending = await ask();
    await expect(openSetUpRequest(hexToBin(pending.sealed), (await generateRecipientKeyPair()).privateKey, 'testnet')).rejects.toThrow();
    const { answer } = await recover(hexToBin(pending.sealed));
    const transaction = decodeTransactionBch(hexToBin((await chain.getTransaction(answer.creationTransactionId)) as string));
    if (typeof transaction === 'string') throw new Error(transaction);
    expect(validateGenesis(transaction, hexToBin(answer.creationTransactionId), hexToBin(answer.identity)).state.challengeDelay).toEqual(DELAY);
    // The phone was told a day; the recoverer uses another period now.
    const second = await ask({ unit: 'time512', value: 169 });
    await expect(recover(hexToBin(second.sealed))).rejects.toThrow(SetUpRefusal);
    expect(records.get(second.requestId)?.identity).toBeUndefined();
  });

  it('CR07: a recoverer whose balance is too small says so with the figures, and creates nothing', async () => {
    const { chain, fundsAddress, recover, ask, records } = await start({ balance: 3_000n });
    const pending = await ask();
    const refused = recover(hexToBin(pending.sealed));
    await expect(refused).rejects.toBeInstanceOf(FundsMissingError);
    await expect(refused).rejects.toThrow(/Your balance is 3,000 satoshis and setting up a wallet takes [\d,]+\. Send at least [\d,]+ satoshis to your address\./);
    expect(records.get(pending.requestId)?.identity).toBeUndefined();
    // Coins arrive; the same request goes through.
    chain.fund(fundsAddress, 100_000n);
    const { answer } = await recover(hexToBin(pending.sealed));
    expect(answer.identity).toHaveLength(64);
  });
});

describe('a request that arrives again', () => {
  /** A key holder that stops, as a page does that is closed or loaded again, at the n-th transaction. */
  const stopping = (inner: KeyBackend, at: number, when: 'before sending' | 'after sending') => {
    let sends = 0;
    const send = async (prepared: Parameters<KeyBackend['send']>[0]): Promise<string> => {
      sends += 1;
      if (sends === at && when === 'before sending') throw new Error('the page stopped');
      const sent = await inner.send(prepared);
      if (sends === at && when === 'after sending') throw new Error('the page stopped');
      return sent;
    };
    return new Proxy(inner, { get: (target, name) => (name === 'send' ? send : (Reflect.get(target, name) as unknown)) });
  };

  it.each([
    [1, 'before sending'],
    [1, 'after sending'],
    [2, 'before sending'],
    [2, 'after sending'],
  ] as const)('CR08: the recoverer\'s page stops at its transaction %i, %s; the request arrives again and is carried on, with no second wallet', async (at, when) => {
    const { chain, reader, fundsBackend, recover, ask, open, records } = await start();
    const pending = await ask();
    const stopped = await RecovererFunds.open({ backend: stopping(fundsBackend, at, when), chain: reader });
    await expect(recover(hexToBin(pending.sealed), undefined, stopped)).rejects.toThrow('the page stopped');
    // The page is loaded again: a key holder with no memory, and the records it stored.
    const again = await RecovererFunds.open({ backend: new KeyBackend(chain, deriveSeedKeys(FUNDS, 'testnet', numbers)), chain: reader });
    const { answer } = await recover(hexToBin(pending.sealed), undefined, again);
    expect(records.get(pending.requestId)?.identity).toBe(answer.identity);
    // One wallet: the identity's coin was spent once, by the creation the phone is answered with.
    expect(chain.outputsAt(controllerScript(hexToBin(answer.identity)).lockingBytecode)).toHaveLength(1);
    // The answer was lost, or the phone was loaded again: the same request gets the same answer.
    const repeated = await recover(hexToBin(pending.sealed), undefined, again);
    expect(repeated.answer).toEqual(answer);
    expect((await open(answer, pending)).wallet.created).toBe(true);
  });

  it('CR08: the phone is loaded again after sending: the same request, sent again, is answered with the same wallet', async () => {
    const { recover, ask, open } = await start();
    const pending = await ask();
    const first = await recover(hexToBin(pending.sealed));
    // The phone kept its pending request; it sends the same bytes again.
    const second = await recover(hexToBin(pending.sealed));
    expect(second.answer).toEqual(first.answer);
    const { wallet } = await open(second.answer, pending);
    expect(wallet.stored.identity).toBe(first.answer.identity);
  });

  it('CR08: two phones asking at once get two wallets, each from a coin of its own', async () => {
    const { chain, recover, ask, storeAt, device } = await start();
    const pending = await ask();
    const other = deriveSeedKeys(NEW_PHONE, 'testnet', numbers);
    const theirs = await requestSetUp({ seed: other, stores: STORES, storeAt, recovererPublicKey: device.publicKey, challengeDelay: DELAY, firstAddress: 0 });
    const [mine, yours] = await Promise.all([recover(hexToBin(pending.sealed)), recover(hexToBin(theirs.sealed))]);
    expect(mine.answer.identity).not.toBe(yours.answer.identity);
    for (const { answer } of [mine, yours]) expect(chain.outputsAt(controllerScript(hexToBin(answer.identity)).lockingBytecode)).toHaveLength(1);
  });
});

describe('servers that list a transaction a moment after they take it', () => {
  it('CR09: the recoverer checks its creation and the phone opens its wallet while no server lists the creation yet', async () => {
    let lagging = 3;
    const { chain, recover, ask, open } = await start({
      blocksOnDemand: true,
      reader: (chain) => ({
        getTransaction: (id) => chain.getTransaction(id),
        listUnspent: (script) => chain.listUnspent(script),
        // The next readings of a history leave out what is not in a block yet.
        getHistory: async (script) => {
          const entries = await chain.getHistory(script);
          if (lagging <= 0) return entries;
          lagging -= 1;
          return entries.filter((entry) => entry.height > 0);
        },
      }),
    });
    chain.mine();
    const pending = await ask();
    const { answer } = await recover(hexToBin(pending.sealed));
    lagging = 5;
    const { wallet } = await open(answer, pending);
    // Looking at the creation while the servers do not list it does not take it for gone.
    expect(await wallet.creationStep()).toBe('created');
    expect(await wallet.creationStep()).toBe('created');
    expect(wallet.voided).toEqual([]);
  });
});

describe('a creation that disappears', () => {
  it('CR10: the recoverer\'s creation is replaced before a block holds it: the phone says the set-up did not hold, keeps what arrived by key, and is set up again', async () => {
    const { chain, fundsAddress, fundedIn, recover, ask, open, state } = await start({ blocksOnDemand: true });
    const pending = await ask();
    const { answer } = await recover(hexToBin(pending.sealed));
    const { wallet } = await open(answer, pending);
    // Someone pays the phone at a fresh address before a block holds the creation.
    const given = (await wallet.receiveAddress()).address;
    chain.fund(given.lockingBytecode, 8_000n);
    // Whoever paid the recoverer takes those coins back: the recoverer's payment to itself and the creation are gone.
    chain.drop(fundedIn);
    expect(chain.knows(answer.creationTransactionId)).toBe(false);
    chain.fund(fundsAddress, 150_000n);
    expect(await wallet.creationStep()).not.toBe('created');
    expect(wallet.created).toBe(false);
    expect(wallet.voided).toEqual([{ identity: answer.identity, givenOut: [0, 1], change: [0, 1] }]);
    await expect(wallet.receiveAddress()).rejects.toThrow(/not created yet/);
    // What others paid is still the phone's, by key.
    expect((await wallet.balance()).voided).toBe(8_000n);

    // Set up again with the recoverer: a new request, from the numbers after those given out.
    const again = await ask();
    expect(again.firstAddress).toBe(1);
    const second = await recover(hexToBin(again.sealed));
    expect(second.answer.identity).not.toBe(answer.identity);
    const reopened = await open(second.answer, again);
    expect(reopened.wallet.voided).toHaveLength(1);
    expect((await reopened.wallet.balance()).recoverable).toBe(STARTING);
    // What arrived at the earlier addresses is moved over by key.
    expect(await reopened.wallet.collectVoided()).toBeDefined();
    expect((await reopened.wallet.balance()).voided).toBe(0n);
    expect(chain.outputsAt(given.lockingBytecode)).toHaveLength(0);
    expect(state().identity).toBe(second.answer.identity);
  });

  it('CR10: only the creating transaction is gone and the recoverer\'s coin is there again: the set-up is done again, and may give the same identity, whose addresses are the phone\'s again', async () => {
    const { chain, reader, recover, ask, open } = await start({ blocksOnDemand: true });
    const pending = await ask();
    const { answer } = await recover(hexToBin(pending.sealed));
    const { wallet } = await open(answer, pending);
    const given = (await wallet.receiveAddress()).address;
    chain.drop(answer.creationTransactionId);
    expect(await wallet.creationStep()).not.toBe('created');
    // The coin the identity is named after is unspent again; the recoverer's page, loaded again, spends it the same way.
    const again = await ask();
    const reloaded = await RecovererFunds.open({ backend: new KeyBackend(chain, deriveSeedKeys(FUNDS, 'testnet', numbers)), chain: reader });
    const second = await recover(hexToBin(again.sealed), undefined, reloaded);
    expect(second.answer.identity).toBe(answer.identity);
    const reopened = await open(second.answer, again);
    expect(reopened.wallet.voided).toEqual([]);
    expect(reopened.wallet.address(ADDRESS_KIND.givenOut, given.number).address).toBe(given.address);
    expect((await reopened.wallet.balance()).recoverable).toBe(STARTING);
  });
});

describe('a recovery of a wallet set up this way', () => {
  it('SW09: the recoverer requests with its own key, completes after the wait, hands over; the new phone sweeps everything', async () => {
    const { chain, storeAt, device, funds, recover, ask, open, kits } = await start();
    const pending = await ask();
    const { answer, recoveryKey } = await recover(hexToBin(pending.sealed));
    const { wallet } = await open(answer, pending);
    chain.fund((await wallet.receiveAddress()).address.lockingBytecode, 10_000n);
    chain.fund((await wallet.vaultAddress()).address.lockingBytecode, 5_000n);
    const before = await wallet.balance();
    const held = before.recoverable + before.vault;

    // The phone is lost. A new phone asks the recoverer, over the session of the recoverer's code.
    const seed = deriveSeedKeys(NEW_PHONE, 'testnet', numbers);
    const asked = await startTakeover({ seed, stores: STORES, storeAt, recovererPublicKey: device.publicKey });
    const kept = kits.get(answer.identity) as KeptKit;
    const saved = await acceptTakeover({ sealed: asked.sealed, privateKey: device.privateKey, kept, chain });
    // The recoverer's key for this wallet, from its own credential; its balance pays, as it paid for the creation.
    const words = (kept.kit.credential as { words: string }).words;
    const credential = credentialKeys(words, 'testnet', kitTemplates());
    const recoverer = await RecovererWallet.open({ funds, chain, identity: hexToBin(answer.identity), recoveryKey: credential.recoveryKey });
    expect(await earlierFeeCoins(chain, kept)).toEqual([]);
    await recoverer.request(saved.proposedKeyHash);
    chain.nowMs += 2 * 512 * 1000;
    await recoverer.complete();
    const handed = await completeTakeover({ kept: saved.kept, chain, recoveryKey, storeAt });
    const taken = await finishTakeover({ sealedHandOver: handed.sealed, pending: asked.pending, seed, backend: new KeyBackend(chain, seed), chain });
    expect(taken.wallet.stored.identity).toBe(answer.identity);
    expect(taken.recovery.on).toBe(true);
    await taken.wallet.search({ passes: ['quick'] });
    await taken.wallet.sweepEarlier();
    const after = await taken.wallet.balance();
    expect(after.toSweep).toBe(0n);
    // Everything but the sweep's fee is at the new phone's addresses.
    expect(after.recoverable).toBeGreaterThan(held - 3_000n);
    expect(after.recoverable).toBeLessThan(held);
  });
});

describe('what a device stored before', () => {
  it('a wallet the phone created itself, before this change, opens and goes on as before', async () => {
    const chain = new SimulatedChain();
    const phone = deriveSeedKeys(PHONE, 'testnet', numbers);
    let state: OwnerWalletState | undefined;
    const made = await OwnerWallet.open({ backend: new KeyBackend(chain, phone), chain, seed: phone, save: (next) => (state = next) });
    chain.fund(p2pkhLockingBytecode(phone.fundingKey.keyHash), 20_000n);
    await made.create({ recovererKeyHash: testKey(0x31).keyHash, challengeDelay: DELAY });
    const stored = JSON.parse(JSON.stringify(state, (_, value: unknown) => (typeof value === 'bigint' ? value.toString() : value))) as OwnerWalletState;
    expect(stored.creation.byRecoverer).toBeUndefined();
    const again = await OwnerWallet.open({ backend: new KeyBackend(chain, phone), chain, seed: phone, state: stored });
    expect(await again.creationStep()).toBe('created');
    expect((await again.balance()).recoverable).toBeGreaterThan(0n);
    expect(hex(encodeControllerState((await readControllerHistory(chain, hexToBin(stored.identity as string))).current.state)).length).toBe(138);
  });
});
