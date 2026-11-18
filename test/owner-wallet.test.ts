import { type Output, binToHex, decodeTransactionBch, hexToBin } from '@bitauth/libauth';
import { CannotCloseError, OwnerWallet, type OwnerWalletState, cancellationCost, creationFunding, suggestedAllowance, walletTemplateNumbers } from '@grandmas-wallet/app';
import {
  type AccountCoin,
  type ChainReader,
  type PreparedTransaction,
  type WalletBackend,
  ADDRESS_KIND,
  InsufficientFundsError,
  buildTransaction,
  controllerScript,
  decodeControllerState,
  deriveCredentialKeys,
  deriveSeedKeys,
  keepNumber,
  p2pkhInput,
  p2pkhLockingBytecode,
  readControllerHistory,
  takeNumber,
  validateGenesis,
} from '@grandmas-wallet/core';
import { KeyBackend, SimulatedChain, testKey } from '@grandmas-wallet/testing';
import { describe, expect, it } from 'vitest';

/**
 * Acceptance tests CR01 to CR04 and FE04 to FE08 of the proposal: creating a wallet, paying, sending
 * everything and closing. The wallet's logic runs here on the simulated chain, with this project's own
 * builder holding the keys the XO engine would hold.
 */

const numbers = walletTemplateNumbers();
const WORDS = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const CREDENTIAL_WORDS = 'legal winner thank year wave sausage worth useful legal winner thank yellow';
const credential = deriveCredentialKeys(CREDENTIAL_WORDS, 'testnet', numbers);
const DELAY = { unit: 'time512', value: 1 } as const;
const payee = p2pkhLockingBytecode(testKey(0x44).keyHash);
const createOptions = { recovererKeyHash: credential.recoveryKey.keyHash, challengeDelay: DELAY };
const { givenOut, change, vault } = ADDRESS_KIND;
const hex = binToHex;

/** A device: the seed's keys, a key holder with no memory of its own, and whatever state the device kept. */
const device = async (chain: SimulatedChain, options: { state?: OwnerWalletState; reader?: ChainReader; backend?: (inner: KeyBackend) => WalletBackend } = {}) => {
  const seed = deriveSeedKeys(WORDS, 'testnet', numbers);
  const inner = new KeyBackend(chain, seed);
  let kept = options.state;
  const wallet = await OwnerWallet.open({
    backend: options.backend?.(inner) ?? inner,
    chain: options.reader ?? chain,
    seed,
    ...(options.state === undefined ? {} : { state: options.state }),
    save: (state) => {
      kept = state;
    },
  });
  return { wallet, seed, state: () => kept as OwnerWalletState, funding: p2pkhLockingBytecode(seed.fundingKey.keyHash) };
};

/** A wallet that is created, with coins of the given values at addresses given out. */
const walletWith = async (...values: bigint[]) => {
  const chain = new SimulatedChain();
  const made = await device(chain);
  chain.fund(made.funding, 20_000n);
  expect(await made.wallet.create(createOptions)).toBe('created');
  for (const value of values) chain.fund((await made.wallet.receiveAddress()).address.lockingBytecode, value);
  return { chain, ...made };
};
const outputsOf = async (chain: SimulatedChain, transactionId: string): Promise<Output[]> => {
  const transaction = decodeTransactionBch(hexToBin((await chain.getTransaction(transactionId)) as string));
  if (typeof transaction === 'string') throw new Error(transaction);
  return transaction.outputs;
};
/** Put a token at an address: a new category, made from a coin, as any token is. */
const payToken = (chain: SimulatedChain, lockingBytecode: Uint8Array): void => {
  const minter = testKey(0xa7);
  const locking = p2pkhLockingBytecode(minter.keyHash);
  const category = chain.fund(locking, 5_000n);
  const [coin] = chain.outputsAt(locking).filter((candidate) => hex(candidate.transactionHash) === category);
  if (coin === undefined) throw new Error('minting coin missing');
  const built = buildTransaction({ inputs: [p2pkhInput(coin, minter)], outputs: [{ lockingBytecode, valueSatoshis: 1_000n, token: { amount: 50n, category: hexToBin(category) } }], changeLockingBytecode: locking });
  expect(chain.submit(hex(built.encoded)).accepted).toBe(true);
};

describe('creating a wallet', () => {
  it('CR01: a funding coin that is output 0 needs no self-payment; its transaction is the identity', async () => {
    const chain = new SimulatedChain();
    const { wallet, state, funding } = await device(chain);
    expect(await wallet.creationStep()).toBe('not funded');
    await expect(wallet.create(createOptions)).rejects.toThrow(/holds no coin yet/);
    const funded = chain.fund(funding, 20_000n);
    expect(await wallet.creationStep()).toBe('funded');
    expect(await wallet.create(createOptions)).toBe('created');
    expect(state().identity).toBe(funded);
    expect(state().creation.prepareTransactionId).toBeUndefined();
    // Two transactions touched the funding address: the funding and the creation.
    expect(await chain.getHistory(funding)).toHaveLength(2);
  });

  it('CR01: a funding coin at another position is first paid to the wallet itself; that payment is the identity', async () => {
    const chain = new SimulatedChain();
    const { wallet, state, funding } = await device(chain);
    const funded = chain.fund(funding, 20_000n, 2);
    expect(await wallet.create(createOptions)).toBe('created');
    expect(state().creation.prepareTransactionId).toBeDefined();
    expect(state().identity).toBe(state().creation.prepareTransactionId);
    expect(state().identity).not.toBe(funded);
    // The identity's controller exists, and was created by a transaction that spends output 0 of the identity.
    const history = await readControllerHistory(chain, hexToBin(state().identity as string));
    expect(history.genesis.state.ownerEpoch).toBe(0);
    expect(await chain.getHistory(funding)).toHaveLength(3);
  });

  it('CR01: the wallet says beforehand what the funding address must receive, and that amount is enough wherever the coin sits', async () => {
    const allowance = { feeLockingBytecode: p2pkhLockingBytecode(credential.feeKey.keyHash), satoshis: suggestedAllowance() };
    for (const [position, options, needed] of [
      [0, createOptions, creationFunding()],
      [2, createOptions, creationFunding()],
      [2, { ...createOptions, allowance }, creationFunding({ allowanceSatoshis: allowance.satoshis })],
    ] as const) {
      const chain = new SimulatedChain();
      const { wallet, funding } = await device(chain);
      chain.fund(funding, needed, position);
      expect(await wallet.create(options)).toBe('created');
      // The wallet's first coin pays for refusing a request.
      expect(await wallet.canCancel()).toBe(true);
    }
    // The controller, a first coin that pays for one cancellation, and the two fees.
    expect(creationFunding()).toBe(1_000n + 1_091n + 528n);
    expect(creationFunding({ allowanceSatoshis: 4_900n }) - creationFunding()).toBe(4_900n + 34n);
    // Less than the least the creation needs is refused with the figures, and nothing is created.
    const chain = new SimulatedChain();
    const { wallet, funding } = await device(chain);
    chain.fund(funding, 2_000n);
    await expect(wallet.create(createOptions)).rejects.toThrow(InsufficientFundsError);
  });

  it('CR02: every step goes on as soon as the network has the transaction before it; nothing waits for a block', async () => {
    const chain = new SimulatedChain();
    chain.blocksOnDemand = true;
    const { wallet, state, funding } = await device(chain);
    // The first coins arrive and are not in a block; the wallet pays itself and creates its controller at once.
    chain.fund(funding, 20_000n, 1);
    expect(await wallet.create(createOptions)).toBe('created');
    expect(state().creation).toMatchObject({ identitySeen: true, createSeen: true, confirmed: false });
    // Addresses of every kind are given out, coins received there are spent, and recovery can be on, all before any block.
    const given = (await wallet.receiveAddress()).address;
    expect((await wallet.vaultAddress()).address.number).toBe(0);
    chain.fund(given.lockingBytecode, 9_000n);
    await wallet.pay([{ lockingBytecode: payee, valueSatoshis: 1_000n }]);
    wallet.noteRecoveryConfirmed(true);
    expect(wallet.recovery).toBe('on');
    chain.mine();
    expect(await wallet.creationStep()).toBe('created');
    expect(state().creation).toMatchObject({ confirmed: true });
  });

  it('CR02: the transaction that prepared the wallet is replaced after addresses were given out: no coin is lost; the wallet makes a new identity, collects the coins by key, and says recovery must be set up again', async () => {
    const chain = new SimulatedChain();
    chain.blocksOnDemand = true;
    const { wallet, state, funding } = await device(chain);
    // The first coins are not in a block: whoever sent them can still replace their transaction.
    const fundedIn = chain.fund(funding, 20_000n, 1);
    expect(await wallet.create(createOptions)).toBe('created');
    const first = state().identity as string;
    wallet.noteRecoveryConfirmed(true);
    const paidAt = (await wallet.receiveAddress()).address;
    const tokenAt = (await wallet.receiveAddress()).address;
    chain.fund(paidAt.lockingBytecode, 8_000n);
    payToken(chain, tokenAt.lockingBytecode);
    const paidOut = await wallet.pay([{ lockingBytecode: payee, valueSatoshis: 1_000n }]);

    // The sender replaces the first coins' transaction: the payment to itself, the creation and the payment
    // made from the wallet's first coins disappear with it.
    chain.drop(fundedIn);
    expect(chain.knows(paidOut.transactionId)).toBe(false);
    expect(await wallet.creationStep()).toBe('funded');
    expect(state().identity).toBeUndefined();
    expect(wallet.voided).toEqual([{ identity: first, givenOut: [0, 2], change: [0, 2] }]);
    expect(wallet.recovery).toBe('off');
    await expect(wallet.receiveAddress()).rejects.toThrow(/not created yet/);
    // What others paid to the addresses given out is still the wallet's, by key, and counted as not recoverable.
    const voided = await wallet.balance();
    expect(voided.voided).toBe(8_000n);
    expect(voided.tokens).toHaveLength(1);

    // A new identity, made from those coins: no new funding is needed, and the first identity is not made again.
    expect(await wallet.create(createOptions)).toBe('created');
    const second = state().identity as string;
    expect(second).not.toBe(first);
    expect(state().creation.prepareTransactionId).toBe(second);
    // Its numbers come after those the first identity gave out, so that every address stays the wallet's.
    expect(state().firstCoinNumber).toBe(2);
    expect((await wallet.receiveAddress()).address.number).toBe(2);
    // The token is collected by key, unchanged, to an address of the new identity.
    const collected = await wallet.collectVoided();
    expect(collected).toBeDefined();
    const after = await wallet.balance();
    expect(after.voided).toBe(0n);
    expect(after.tokens).toHaveLength(1);
    expect(after.tokens[0]?.utxo.output.token?.amount).toBe(50n);
    expect(chain.outputsAt(tokenAt.lockingBytecode)).toHaveLength(0);

    // A payment that arrives later at an address of the first identity is found and collected the same way.
    chain.fund(paidAt.lockingBytecode, 5_000n);
    expect((await wallet.balance()).voided).toBe(5_000n);
    // A device that starts again from what it stored knows every address, those of the first identity included.
    const again = await device(chain, { state: state() });
    expect((await again.wallet.balance()).voided).toBe(5_000n);
    await again.wallet.collectVoided();
    expect((await again.wallet.balance()).voided).toBe(0n);
    expect(chain.outputsAt(paidAt.lockingBytecode)).toHaveLength(0);
  });

  it('CR02: a block that held the creation is undone and the first coins are spent elsewhere in its place: handled the same way', async () => {
    const chain = new SimulatedChain();
    chain.blocksOnDemand = true;
    const { wallet, funding } = await device(chain);
    const fundedIn = chain.fund(funding, 20_000n);
    expect(await wallet.create(createOptions)).toBe('created');
    const paidAt = (await wallet.receiveAddress()).address;
    chain.fund(paidAt.lockingBytecode, 6_000n);
    chain.mine();
    // The block is undone before the wallet looked again, and the coin that defined the identity goes elsewhere.
    chain.drop(fundedIn);
    expect(await wallet.creationStep()).toBe('funded');
    expect((await wallet.balance()).voided).toBe(6_000n);
    expect(await wallet.create(createOptions)).toBe('created');
    expect((await wallet.balance()).voided).toBe(0n);
    expect((await wallet.balance()).recoverable).toBeGreaterThan(0n);
  });

  it('CR02: the creating transaction disappears while the identity\'s coin is there again: the controller is made again, for the same identity', async () => {
    const chain = new SimulatedChain();
    chain.blocksOnDemand = true;
    const { wallet, state, funding } = await device(chain);
    chain.fund(funding, 20_000n);
    expect(await wallet.create(createOptions)).toBe('created');
    const identity = state().identity;
    const given = (await wallet.receiveAddress()).address;
    chain.drop(state().creation.createTransactionId as string);
    expect(await wallet.creationStep()).toBe('prepared');
    await expect(wallet.receiveAddress()).rejects.toThrow(/not created yet/);
    expect(await wallet.create(createOptions)).toBe('created');
    expect(state().identity).toBe(identity);
    expect(wallet.voided).toEqual([]);
    // The address given out before is still one of the identity's.
    expect(wallet.address(givenOut, given.number).address).toBe(given.address);
    expect(chain.outputsAt(controllerScript(hexToBin(identity as string)).lockingBytecode)).toHaveLength(1);
  });

  /** A key holder that stops, as a device does when it loses power, at the n-th transaction. */
  const stopping = (inner: KeyBackend, at: number, when: 'before sending' | 'after sending'): WalletBackend => {
    let sends = 0;
    const send = async (prepared: PreparedTransaction): Promise<string> => {
      sends += 1;
      if (sends === at && when === 'before sending') throw new Error('the device stopped');
      const sent = await inner.send(prepared);
      if (sends === at && when === 'after sending') throw new Error('the device stopped');
      return sent;
    };
    return new Proxy(inner, { get: (target, name) => (name === 'send' ? send : (Reflect.get(target, name) as unknown)) });
  };

  it.each([
    [1, 'before sending'],
    [1, 'after sending'],
    [2, 'before sending'],
    [2, 'after sending'],
  ] as const)('CR02: a device that stops at transaction %i, %s, continues and makes no second identity', async (at, when) => {
    const chain = new SimulatedChain();
    const first = await device(chain, { backend: (inner) => stopping(inner, at, when) });
    // Not an output 0, so that creating takes two transactions: the self-payment and the creation.
    chain.fund(first.funding, 20_000n, 1);
    await expect(first.wallet.create(createOptions)).rejects.toThrow('the device stopped');
    const identityBefore = first.state().identity;

    // The device starts again: a key holder with no memory, and the state the device stored.
    const again = await device(chain, { state: first.state() });
    expect(await again.wallet.create(createOptions)).toBe('created');
    // A transaction that was built and never sent is built again, and is the same transaction.
    expect(again.state().identity).toBe(identityBefore);
    const identity = hexToBin(again.state().identity as string);
    const history = await readControllerHistory(chain, identity);
    expect(history.transitions).toHaveLength(0);
    // One self-payment and one creation: the funding, the payment to itself, and the creation touched the funding address.
    expect(await chain.getHistory(again.funding)).toHaveLength(3);
    expect(chain.outputsAt(controllerScript(identity).lockingBytecode)).toHaveLength(1);
    // The same change address was used, not a second one.
    expect(again.state().firstCoinNumber).toBe(0);
    expect(again.state().allocation[change].next).toBe(1);
    expect(await again.wallet.canCancel()).toBe(true);
  });

  it('CR02: when the transaction that defined the identity is gone before any address was given out, the identity is forgotten with it', async () => {
    const chain = new SimulatedChain();
    const gone = new Set<string>();
    const reader: ChainReader = {
      getTransaction: (id) => chain.getTransaction(id),
      listUnspent: (script) => chain.listUnspent(script),
      getHistory: async (script) => (await chain.getHistory(script)).filter((entry) => !gone.has(entry.transactionId)).map((entry) => ({ ...entry, height: 0 })),
    };
    const { wallet, state, funding } = await device(chain, { reader });
    chain.fund(funding, 20_000n, 1);
    expect(await wallet.create(createOptions)).toBe('created');
    const identity = state().identity as string;
    // The self-payment is replaced or its block undone: the servers no longer know it.
    gone.add(identity);
    expect(await wallet.creationStep()).not.toBe('created');
    expect(state().identity).toBeUndefined();
    expect(state().creation).toEqual({ confirmed: false });
    expect(state().firstCoinNumber).toBeUndefined();
    // Only the change address of the creation was taken; it is kept, and the next identity's numbers follow it.
    expect(wallet.voided).toEqual([{ identity, givenOut: [0, 0], change: [0, 1] }]);
  });

  it.each([
    ['with an allowance for the recoverer', 6_000n],
    ['without one', undefined],
  ] as const)('CR03: the creating transaction, %s: a valid identity and every satoshi accounted for', async (_name, allowance) => {
    const chain = new SimulatedChain();
    const { wallet, state, funding, seed } = await device(chain);
    chain.fund(funding, 50_000n);
    const feeAddress = p2pkhLockingBytecode(credential.feeKey.keyHash);
    await wallet.create({ ...createOptions, ...(allowance === undefined ? {} : { allowance: { feeLockingBytecode: feeAddress, satoshis: allowance } }) });
    const identity = hexToBin(state().identity as string);
    const createdIn = state().creation.createTransactionId as string;
    const encoded = hexToBin((await chain.getTransaction(createdIn)) as string);
    const transaction = decodeTransactionBch(encoded);
    if (typeof transaction === 'string') throw new Error(transaction);

    // A valid identity, as any client checks it (section 5.7).
    const genesis = validateGenesis(transaction, hexToBin(createdIn), identity);
    expect(genesis.state).toMatchObject({ status: 'active', ownerEpoch: 0, ownerKeyHash: seed.controllerKey.keyHash, recovererKeyHash: credential.recoveryKey.keyHash, challengeDelay: DELAY });

    // The outputs: the controller, the allowance if one was given, the rest. No coin is kept apart.
    const [controller, ...others] = transaction.outputs;
    const rest = others.at(-1);
    expect(transaction.outputs).toHaveLength(allowance === undefined ? 2 : 3);
    expect(controller?.valueSatoshis).toBe(1_000n);
    expect(rest?.lockingBytecode).toEqual(wallet.address(change, 0).lockingBytecode);
    if (allowance === undefined) expect(chain.balanceOf(feeAddress)).toBe(0n);
    else expect(others[0]).toEqual({ lockingBytecode: feeAddress, valueSatoshis: allowance });

    // Every satoshi: what went in is what came out and the fee, and the fee is the size.
    const out = transaction.outputs.reduce((sum, output) => sum + output.valueSatoshis, 0n);
    expect(50_000n - out).toBe(BigInt(encoded.length));
    expect(await wallet.balance()).toMatchObject({ recoverable: rest?.valueSatoshis, vault: 0n, notRecoverable: 0n });
    expect(await wallet.canCancel()).toBe(true);
    expect(decodeControllerState(controller?.token?.nft?.commitment as Uint8Array).recovererKeyHash).toEqual(credential.recoveryKey.keyHash);
  });

  it('CR04: recovery is shown as off until the recoverer has confirmed; a later payment to the funding address is not recoverable', async () => {
    const { chain, wallet, funding } = await walletWith(10_000n);
    // Coins in the wallet do not mean that recovery is on.
    expect((await wallet.balance()).recoverable).toBeGreaterThan(10_000n);
    expect(wallet.recovery).toBe('off');
    wallet.noteRecoveryConfirmed(true);
    expect(wallet.recovery).toBe('on');

    expect((await wallet.balance()).notRecoverable).toBe(0n);
    chain.fund(funding, 7_000n);
    const balance = await wallet.balance();
    expect(balance.notRecoverable).toBe(7_000n);
    // It is not counted with the wallet's recoverable coins.
    expect(balance.recoverable).toBeLessThan(30_000n);
  });
});

describe('paying', () => {
  /** A wallet whose only coins are the given ones. */
  const exactly = async (...values: bigint[]) => {
    const made = await walletWith();
    // The rest of the first coins goes out, so that the test's own coins are all there is.
    await made.wallet.pay([{ lockingBytecode: payee, valueSatoshis: (await made.wallet.balance()).recoverable - 340n }]);
    for (const value of values) made.chain.fund((await made.wallet.receiveAddress()).address.lockingBytecode, value);
    return made;
  };

  it('FE04: a payment that some choice of coins makes without change has no change output', async () => {
    const { chain, wallet } = await exactly(10_000n, 5_340n, 3_000n);
    const sent = await wallet.pay([{ lockingBytecode: payee, valueSatoshis: 5_000n }]);
    expect(await outputsOf(chain, sent.transactionId)).toHaveLength(1);
    expect(sent).toMatchObject({ bytes: 340, feeSatoshis: 340n, remainderSatoshis: 0n });
    // The other coins are untouched, and no change address was used up.
    expect((await wallet.balance()).recoverable).toBe(13_000n);
    expect(wallet.stored.allocation[change]).toMatchObject({ held: [], free: [1] });
  });

  it('FE04: otherwise the rest returns to a fresh change address', async () => {
    const { chain, wallet } = await exactly(30_000n);
    const sent = await wallet.pay([{ lockingBytecode: payee, valueSatoshis: 12_000n }]);
    const outputs = await outputsOf(chain, sent.transactionId);
    expect(outputs).toHaveLength(2);
    expect(outputs[1]).toEqual({ lockingBytecode: wallet.address(change, 1).lockingBytecode, valueSatoshis: 30_000n - 12_000n - 384n });
    expect(sent).toMatchObject({ bytes: 384, feeSatoshis: 384n, remainderSatoshis: 0n });
    expect((await wallet.balance()).recoverable).toBe(17_616n);
  });

  it('FE05: a remainder too small to return goes to the fee when that is the cheaper way, and is shown', async () => {
    const { chain, wallet } = await exactly(6_000n, 2_000n);
    const sent = await wallet.pay([{ lockingBytecode: payee, valueSatoshis: 5_400n }]);
    expect(await outputsOf(chain, sent.transactionId)).toHaveLength(1);
    expect(sent).toMatchObject({ bytes: 340, feeSatoshis: 600n, remainderSatoshis: 260n });
    expect((await wallet.balance()).recoverable).toBe(2_000n);
  });

  it('FE05: a coin is added and change returned when that is the cheaper way', async () => {
    const { chain, wallet } = await exactly(6_000n, 2_000n);
    const sent = await wallet.pay([{ lockingBytecode: payee, valueSatoshis: 5_150n }]);
    expect(await outputsOf(chain, sent.transactionId)).toHaveLength(2);
    expect(sent).toMatchObject({ bytes: 680, feeSatoshis: 680n, remainderSatoshis: 0n });
    expect((await wallet.balance()).recoverable).toBe(8_000n - 5_150n - 680n);
  });

  it('the fee is known before the payment is approved: the figures quoted are the figures of the payment', async () => {
    const cases: [bigint[], bigint][] = [
      [[10_000n, 5_340n, 3_000n], 5_000n],
      [[30_000n], 12_000n],
      [[6_000n, 2_000n], 5_400n],
      [[6_000n, 2_000n], 5_150n],
    ];
    for (const [coins, amount] of cases) {
      const { wallet, state } = await exactly(...coins);
      const before = JSON.stringify(state().allocation);
      const quote = await wallet.quotePay([{ lockingBytecode: payee, valueSatoshis: amount }]);
      // Asking takes no change address and stores nothing.
      expect(JSON.stringify(state().allocation)).toBe(before);
      const sent = await wallet.pay([{ lockingBytecode: payee, valueSatoshis: amount }]);
      expect(quote).toEqual({ feeSatoshis: sent.feeSatoshis, remainderSatoshis: sent.remainderSatoshis, bytes: sent.bytes, change: sent.remainderSatoshis === 0n && sent.bytes > 340 });
    }
    const { wallet } = await exactly(6_000n);
    await expect(wallet.quotePay([{ lockingBytecode: payee, valueSatoshis: 9_000n }])).rejects.toThrow(InsufficientFundsError);
    // An amount the network would not relay is refused in words, before anything is chosen.
    await expect(wallet.quotePay([{ lockingBytecode: payee, valueSatoshis: 100n }])).rejects.toThrow(/smallest amount that can be sent to this address is 546/);
    await expect(wallet.pay([{ lockingBytecode: payee, valueSatoshis: 100n }])).rejects.toThrow(/smallest amount/);
  });

  it('a token is sent on unchanged, with the fee from another coin', async () => {
    const { chain, wallet } = await walletWith(10_000n);
    const { address } = await wallet.receiveAddress();
    payToken(chain, address.lockingBytecode);
    const [holding] = (await wallet.balance()).tokens;
    if (holding === undefined) throw new Error('token coin missing');
    const sent = await wallet.sendToken(holding, payee);
    const [moved] = await outputsOf(chain, sent.transactionId);
    expect(moved?.token).toEqual(holding.utxo.output.token);
    expect((await wallet.balance()).tokens).toEqual([]);
  });

});

describe('cancelling', () => {
  /** A wallet whose ordinary coins have all been paid out. */
  const emptied = async () => {
    const made = await walletWith();
    await made.wallet.pay([{ lockingBytecode: payee, valueSatoshis: (await made.wallet.balance()).recoverable - 340n }]);
    expect((await made.wallet.balance()).recoverable).toBe(0n);
    return made;
  };
  const kinds = async (chain: SimulatedChain, wallet: OwnerWallet) => (await readControllerHistory(chain, hexToBin(wallet.stored.identity as string))).transitions.map((step) => step.kind);

  it('the smallest coin that pays alone pays for a cancellation, with change to a fresh change address', async () => {
    const { chain, wallet } = await walletWith(800n, 3_000n, 10_000n);
    const before = await wallet.balance();
    expect(await wallet.canCancel()).toBe(true);
    const sent = await wallet.cancel();
    expect(await kinds(chain, wallet)).toEqual(['ownerAuthorize']);
    // The controller and one coin by its key in, the controller and the change out.
    expect(sent).toMatchObject({ bytes: 1_135, feeSatoshis: 1_135n, remainderSatoshis: 0n });
    const outputs = await outputsOf(chain, sent.transactionId);
    expect(outputs[1]).toEqual({ lockingBytecode: wallet.address(change, 1).lockingBytecode, valueSatoshis: 3_000n - 1_135n });
    // 800 does not pay alone; the coin of 3,000 paid, and the others are untouched.
    expect([0, 1, 2].map((number) => chain.balanceOf(wallet.address(givenOut, number).lockingBytecode))).toEqual([800n, 0n, 10_000n]);
    expect((await wallet.balance()).recoverable).toBe(before.recoverable - 1_135n);
    // Nothing was kept apart, and the wallet can pay for the next one as well.
    expect(await wallet.canCancel()).toBe(true);
  });

  it('with less than the fee in ordinary coins, a coin at a vault address pays, through the controller', async () => {
    const { chain, wallet } = await emptied();
    chain.fund((await wallet.receiveAddress()).address.lockingBytecode, 600n);
    const vaultAddress = (await wallet.vaultAddress()).address;
    chain.fund(vaultAddress.lockingBytecode, 5_000n);
    expect(await wallet.canCancel()).toBe(true);
    const sent = await wallet.cancel();
    expect(await kinds(chain, wallet)).toEqual(['ownerAuthorize']);
    expect(chain.balanceOf(vaultAddress.lockingBytecode)).toBe(0n);
    // The ordinary coin of 600 is untouched; the vault coin's change is now an ordinary coin.
    expect(await wallet.balance()).toMatchObject({ recoverable: 600n + 5_000n - sent.feeSatoshis, vault: 0n });
  });

  it('a wallet that holds only a token cannot pay for a cancellation, and can once a little Bitcoin Cash arrives', async () => {
    const { chain, wallet } = await emptied();
    payToken(chain, (await wallet.receiveAddress()).address.lockingBytecode);
    expect(await wallet.canCancel()).toBe(false);
    await expect(wallet.cancel()).rejects.toThrow(/a little Bitcoin Cash has to arrive first/);
    expect(await kinds(chain, wallet)).toEqual([]);
    // What arrives need be no more than the least a cancellation costs.
    chain.fund((await wallet.receiveAddress()).address.lockingBytecode, cancellationCost());
    expect(await wallet.canCancel()).toBe(true);
    expect(await wallet.cancel()).toMatchObject({ bytes: 1_091, feeSatoshis: 1_091n, remainderSatoshis: 0n });
    expect(await kinds(chain, wallet)).toEqual(['ownerAuthorize']);
    expect((await wallet.balance()).tokens).toHaveLength(1);
  });

  it('a coin spent a moment before by another payment of the wallet is not chosen again: the cancellation is retried once', async () => {
    const chain = new SimulatedChain();
    const listing: { stale?: AccountCoin[] } = {};
    let sends = 0;
    let backend: WalletBackend | undefined;
    // A key holder that goes on listing the coins it had, as one can for a moment after a coin is spent.
    const lagging = (inner: KeyBackend): WalletBackend =>
      (backend = new Proxy(inner, {
        get: (target, name) => {
          if (name === 'coins') return async () => listing.stale ?? (await target.coins());
          if (name === 'send') return async (prepared: PreparedTransaction) => ((sends += 1), target.send(prepared));
          return Reflect.get(target, name) as unknown;
        },
      }));
    const made = await device(chain, { backend: lagging });
    chain.fund(made.funding, 20_000n);
    await made.wallet.create(createOptions);
    const small = (await made.wallet.receiveAddress()).address;
    chain.fund(small.lockingBytecode, 3_000n);
    // Another payment of the wallet, which this wallet object did not make, spends the coin of 3,000.
    const other = await device(chain, { state: made.state() });
    listing.stale = await (backend as WalletBackend).coins();
    await other.wallet.pay([{ lockingBytecode: payee, valueSatoshis: 2_660n }]);
    expect(chain.balanceOf(small.lockingBytecode)).toBe(0n);

    sends = 0;
    const sent = await made.wallet.cancel();
    expect(sends).toBe(2);
    expect(await kinds(chain, made.wallet)).toEqual(['ownerAuthorize']);
    expect((await outputsOf(chain, sent.transactionId))[0]?.token).toBeDefined();
  });
});

describe('changing settings', () => {
  it('the owner replaces the recoverer and the waiting period at once; a coin of the wallet pays, with change', async () => {
    const { chain, wallet } = await walletWith(10_000n);
    const identity = hexToBin(wallet.stored.identity as string);
    const other = testKey(0x55).keyHash;
    const sent = await wallet.changeSettings({ recovererKeyHash: other, challengeDelay: { unit: 'time512', value: 3 } });
    // The controller changing its settings, one coin by its key, the controller and the change: 1,181 bytes.
    expect(sent).toMatchObject({ bytes: 1_181, feeSatoshis: 1_181n, remainderSatoshis: 0n });
    const history = await readControllerHistory(chain, identity);
    expect(history.transitions.map((step) => step.kind)).toEqual(['ownerUpdate']);
    expect(history.current.state).toMatchObject({ recovererKeyHash: other, challengeDelay: { unit: 'time512', value: 3 }, ownerEpoch: 0, status: 'active' });
  });
});

describe('sending everything', () => {
  it('FE06: every coin without a token goes, from ordinary and vault addresses, in as many transactions as it takes', async () => {
    const { chain, wallet } = await walletWith(10_000n, 30_000n);
    chain.fund((await wallet.vaultAddress()).address.lockingBytecode, 8_000n);
    const tokenAddress = (await wallet.receiveAddress()).address;
    payToken(chain, tokenAddress.lockingBytecode);
    // More coins than one transaction holds: 400 payments to one address.
    const busy = (await wallet.receiveAddress()).address;
    for (let count = 0; count < 400; count++) chain.fund(busy.lockingBytecode, 2_000n + BigInt(count));
    expect(chain.outputsAt(busy.lockingBytecode)).toHaveLength(400);

    const before = await wallet.balance();
    const total = before.recoverable + before.vault;
    // What will arrive and what it costs is known before it is approved, and nothing moves by asking.
    const quote = await wallet.quoteSendEverything(payee);
    expect(chain.balanceOf(payee)).toBe(0n);
    const result = await wallet.sendEverything(payee);
    expect(quote).toEqual({ sentSatoshis: result.sentSatoshis, feeSatoshis: result.feeSatoshis, bytes: result.transactions.reduce((sum, sent) => sum + sent.bytes, 0), transactions: result.transactions.length, leftOut: 0 });
    expect(result.transactions.length).toBeGreaterThan(1);
    for (const sent of result.transactions) {
      expect(sent.feeSatoshis).toBe(BigInt(sent.bytes));
      expect(sent.bytes).toBeLessThanOrEqual(100_000);
    }
    // What arrives is the total less the exact fees.
    expect(result.sentSatoshis).toBe(total - result.feeSatoshis);
    expect(chain.balanceOf(payee)).toBe(result.sentSatoshis);
    expect(result.leftOut).toEqual([]);

    // No coin without a token is left besides the controller; the coin with a token is untouched.
    const after = await wallet.balance();
    expect(after).toMatchObject({ recoverable: 0n, vault: 0n });
    expect(after.tokens).toHaveLength(1);
    expect(chain.outputsAt(tokenAddress.lockingBytecode)).toHaveLength(1);
    const identity = hexToBin(wallet.stored.identity as string);
    expect(chain.outputsAt(controllerScript(identity).lockingBytecode)[0]?.output.valueSatoshis).toBe(1_000n);
    // The wallet stays usable, and says that it cannot pay for a cancellation until it holds a coin again.
    expect(await wallet.canCancel()).toBe(false);
    expect(await wallet.closed()).toBe(false);
  }, 60_000);

  it('FE07: when the total less the fee is below what the receiving output must hold, nothing is sent and the figures are shown', async () => {
    const { chain, wallet } = await walletWith();
    await wallet.sendEverything(payee);
    const arrived = chain.balanceOf(payee);
    chain.fund((await wallet.receiveAddress()).address.lockingBytecode, 600n);
    try {
      await expect(wallet.quoteSendEverything(payee)).rejects.toThrow(InsufficientFundsError);
      await wallet.sendEverything(payee);
      expect.unreachable('600 satoshis cannot be sent on');
    } catch (error) {
      expect(error).toBeInstanceOf(InsufficientFundsError);
      const figures = error as InsufficientFundsError;
      // The total, the fee, and what the total would have to be: the fee and the smallest output of 546.
      expect([figures.totalSatoshis, figures.feeSatoshis, figures.neededSatoshis]).toEqual([600n, 340n, 886n]);
    }
    expect(chain.balanceOf(payee)).toBe(arrived);
    expect((await wallet.balance()).recoverable).toBe(600n);
    // With nothing at all, it says so too.
    const empty = await walletWith();
    await empty.wallet.sendEverything(payee);
    await expect(empty.wallet.sendEverything(payee)).rejects.toThrow(InsufficientFundsError);
  });
});

describe('closing', () => {
  it('FE08: the address paid receives every satoshi, the controller\'s included, less the exact fee; nothing of the identity is left', async () => {
    const { chain, wallet } = await walletWith(10_000n, 4_000n);
    wallet.noteFullySearched(true);
    const before = await wallet.balance();
    const total = before.recoverable + 1_000n;
    const identity = hexToBin(wallet.stored.identity as string);
    const result = await wallet.close(payee);
    expect(result.transactions).toHaveLength(1);
    expect(result.feeSatoshis).toBe(BigInt(result.transactions[0]?.bytes ?? 0));
    expect(result.sentSatoshis).toBe(total - result.feeSatoshis);
    expect(chain.balanceOf(payee)).toBe(result.sentSatoshis);
    expect(await outputsOf(chain, result.transactions[0]?.transactionId as string)).toEqual([{ lockingBytecode: payee, valueSatoshis: result.sentSatoshis }]);
    // Nothing of the identity is left on chain.
    expect(chain.outputsAt(controllerScript(identity).lockingBytecode)).toEqual([]);
    expect(await wallet.closed()).toBe(true);
    expect(await wallet.balance()).toMatchObject({ recoverable: 0n, vault: 0n });
  });

  it('FE08: closing after everything else was sent takes the controller\'s value with a coin received later', async () => {
    const { chain, wallet } = await walletWith(10_000n);
    wallet.noteFullySearched(true);
    await wallet.sendEverything(payee);
    // The controller alone leaves less than an output may hold.
    await expect(wallet.close(payee)).rejects.toThrow(InsufficientFundsError);
    expect(await wallet.closed()).toBe(false);
    chain.fund((await wallet.receiveAddress()).address.lockingBytecode, 5_000n);
    const before = chain.balanceOf(payee);
    const result = await wallet.close(payee);
    // 5,000 and the controller's 1,000, less 977.
    expect(result).toMatchObject({ sentSatoshis: 5_023n, feeSatoshis: 977n });
    expect(chain.balanceOf(payee)).toBe(before + 5_023n);
    expect(await wallet.closed()).toBe(true);
  });

  it('FE08: refused while a vault coin or a token is held, or before the full search has finished', async () => {
    const { chain, wallet } = await walletWith(10_000n);
    await expect(wallet.close(payee)).rejects.toThrow(/full search has not finished/);
    wallet.noteFullySearched(true);

    chain.fund((await wallet.vaultAddress()).address.lockingBytecode, 3_000n);
    await expect(wallet.close(payee)).rejects.toThrow(CannotCloseError);
    expect(await wallet.closingObstacles()).toEqual(['A coin is at a vault address; after closing nobody could spend it.']);
    // The vault coin is moved out through the controller; then a token stands in the way.
    await wallet.sendEverything(payee);
    payToken(chain, (await wallet.receiveAddress()).address.lockingBytecode);
    chain.fund((await wallet.receiveAddress()).address.lockingBytecode, 5_000n);
    await expect(wallet.close(payee)).rejects.toThrow(/holds a token/);
    expect(await wallet.closed()).toBe(false);

    const [holding] = (await wallet.balance()).tokens;
    await wallet.sendToken(holding as NonNullable<typeof holding>, payee);
    await wallet.close(payee);
    expect(await wallet.closed()).toBe(true);
  });
});

describe('a device that starts again', () => {
  it('makes the same addresses known again, in order, and goes on from its stored state', async () => {
    const first = await walletWith(10_000n, 7_000n);
    const given = (await first.wallet.receiveAddress()).address;
    const vaultAddress = (await first.wallet.vaultAddress()).address;
    first.chain.fund(vaultAddress.lockingBytecode, 3_000n);
    const balance = await first.wallet.balance();

    const again = await device(first.chain, { state: first.state() });
    expect(await again.wallet.balance()).toEqual(balance);
    // The next address is the one after those already given out.
    expect((await again.wallet.receiveAddress()).address.number).toBe(given.number + 1);
    expect(again.wallet.address(givenOut, given.number).address).toBe(given.address);
    expect(again.wallet.address(vault, 0).address).toBe(vaultAddress.address);
    await again.wallet.pay([{ lockingBytecode: payee, valueSatoshis: 9_000n }]);
  });

  /**
   * A device that stored its state while the wallet kept a coin apart for cancelling: a change number kept
   * for that coin, the coin of 1,091 satoshis there, and the number under `cancelCoinNumber`. The state is
   * read back as a device reads it, from text.
   */
  const storedBefore = async () => {
    const first = await walletWith(10_000n);
    const taken = takeNumber(first.state().allocation, change);
    if (!('number' in taken)) throw new Error('no change number free');
    const stored = { ...first.state(), allocation: keepNumber(taken.allocation, change, taken.number), cancelCoinNumber: taken.number };
    const coinAt = first.wallet.address(change, taken.number).lockingBytecode;
    first.chain.fund(coinAt, 1_091n);
    const again = await device(first.chain, { state: JSON.parse(JSON.stringify(stored)) as OwnerWalletState });
    return { ...again, chain: first.chain, coinAt, before: await first.wallet.balance() };
  };

  it('reads a state stored while a coin was kept apart for cancelling: that coin is an ordinary coin, counted and spent', async () => {
    const { wallet, chain, coinAt, before } = await storedBefore();
    const balance = await wallet.balance();
    expect(balance).not.toHaveProperty('cancelling');
    expect(balance.recoverable).toBe(before.recoverable + 1_091n);
    // A cancellation takes it first: it is the smallest coin that pays alone, and it pays exactly.
    expect(await wallet.canCancel()).toBe(true);
    expect(await wallet.cancel()).toMatchObject({ bytes: 1_091, feeSatoshis: 1_091n, remainderSatoshis: 0n });
    expect(chain.balanceOf(coinAt)).toBe(0n);
    expect((await wallet.balance()).recoverable).toBe(before.recoverable);
  });

  it('an ordinary payment spends that coin too, and sending everything takes it', async () => {
    const { wallet, chain, coinAt, before } = await storedBefore();
    const total = before.recoverable + 1_091n;
    // A payment that only all the coins together cover.
    await wallet.pay([{ lockingBytecode: payee, valueSatoshis: total - 1_200n }]);
    expect(chain.balanceOf(coinAt)).toBe(0n);
    const rest = await storedBefore();
    const everything = await rest.wallet.sendEverything(payee);
    expect(everything.sentSatoshis).toBe(total - everything.feeSatoshis);
    expect(rest.chain.balanceOf(rest.coinAt)).toBe(0n);
  });
});
