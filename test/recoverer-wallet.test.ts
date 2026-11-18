import { binToHex, hexToBin } from '@bitauth/libauth';
import { FundsMissingError, OwnerWallet, RecovererFunds, RecovererWallet, recoveryFees, walletTemplateNumbers } from '@grandmas-wallet/app';
import {
  type ControllerAction,
  type ControllerState,
  type FoundCoin,
  type InputSpec,
  type KeyPair,
  ADDRESS_KIND,
  INPUT_BYTES,
  buildTransaction,
  controllerInput,
  controllerOutput,
  controllerScript,
  decodeControllerState,
  deriveCredentialKeys,
  deriveSeedKeys,
  encodeControllerState,
  p2pkhInput,
  p2pkhLockingBytecode,
  quickPass,
  readControllerHistory,
  recoverableInput,
  sweptInput,
  vaultInput,
} from '@grandmas-wallet/core';
import { KeyBackend, SimulatedChain, testKey } from '@grandmas-wallet/testing';
import { describe, expect, it } from 'vitest';

import { type TestFunds, FUNDS_WORDS, recovererFunds } from './support/recoverer.js';

/**
 * Acceptance tests RC03, RC05 and RC06 of the proposal: what the recoverer's key can and cannot do, what
 * two wallets with one recoverer share, and how the recoverer pays its fees from its one balance.
 */

const numbers = walletTemplateNumbers();
const WORDS = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const OTHER_WORDS = 'letter advice cage absurd amount doctor acoustic avoid letter advice cage above';
const CREDENTIAL_WORDS = 'legal winner thank year wave sausage worth useful legal winner thank yellow';
const OTHER_CREDENTIAL_WORDS = 'zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong';
const DELAY = { unit: 'time512', value: 1 } as const;
const newDevice = testKey(0x77);
const payee = p2pkhLockingBytecode(testKey(0x44).keyHash);
const hex = binToHex;

/**
 * A wallet with its recoverer, on one chain. The recoverer holds its balance, with `balance` satoshis in one coin
 * unless a balance is given, and the wallet's credential; nothing of the owner's.
 */
const setup = async (options: { chain?: SimulatedChain; words?: string; credentialWords?: string; balance?: bigint; funds?: TestFunds } = {}) => {
  const chain = options.chain ?? new SimulatedChain();
  const seed = deriveSeedKeys(options.words ?? WORDS, 'testnet', numbers);
  const credential = deriveCredentialKeys(options.credentialWords ?? CREDENTIAL_WORDS, 'testnet', numbers);
  // Where an earlier version of the recoverer's software kept coins for this wallet's fees.
  const feeAddress = p2pkhLockingBytecode(credential.feeKey.keyHash);
  const owner = await OwnerWallet.open({ backend: new KeyBackend(chain, seed), chain, seed });
  chain.fund(p2pkhLockingBytecode(seed.fundingKey.keyHash), 100_000n);
  await owner.create({ recovererKeyHash: credential.recoveryKey.keyHash, challengeDelay: DELAY });
  const identity = hexToBin(owner.stored.identity as string);
  const balance = options.funds ?? (await recovererFunds(chain, options.balance ?? 0n));
  const recoverer = await RecovererWallet.open({ funds: balance.funds, chain, identity, recoveryKey: credential.recoveryKey });
  const controller = (): { utxo: ReturnType<SimulatedChain['outputsAt']>[number]; state: ControllerState } => {
    const [utxo] = chain.outputsAt(controllerScript(identity).lockingBytecode);
    if (utxo?.output.token?.nft === undefined) throw new Error('controller missing');
    return { utxo, state: decodeControllerState(utxo.output.token.nft.commitment) };
  };
  /** The waiting period passes on the chain's clock. */
  const wait = (): void => {
    chain.nowMs += 2 * 512 * 1000;
  };
  return { chain, seed, credential, owner, recoverer, identity, feeAddress, balance, controller, wait };
};

describe('what the recoverer can do with everything it holds', () => {
  it('RC03: no path spends or sweeps a coin of the wallet, before a wait or during one', async () => {
    const { chain, seed, credential, owner, recoverer, identity, balance, controller, wait } = await setup({ balance: 20_000n });
    chain.fund((await owner.receiveAddress()).address.lockingBytecode, 10_000n);
    chain.fund((await owner.vaultAddress()).address.lockingBytecode, 10_000n);
    // The recoverer holds the viewing key: it finds every coin, with its secret.
    const coins = (await quickPass(chain, identity, seed.viewingKey)).found.flatMap((address) => address.coins);
    expect(coins.length).toBeGreaterThanOrEqual(3);
    // Every key the recoverer has: the wallet's recovery key and the key of its own balance.
    const held: KeyPair[] = [credential.recoveryKey, balance.key];
    // A coin of the balance, as it stands whenever an attempt is made.
    const feeCoin = () => {
      const [coin] = chain.outputsAt(balance.address);
      if (coin === undefined) throw new Error('the balance holds no coin');
      return coin;
    };

    const through = (coin: FoundCoin): InputSpec =>
      coin.address.kind === ADDRESS_KIND.vault ? vaultInput(coin.utxo, coin.address.script, identity, coin.address.secret) : sweptInput(coin.utxo, coin.address.script, identity, coin.address.secret);
    const refused = (inputs: InputSpec[], outputs: Parameters<typeof buildTransaction>[0]['outputs'], burn = false): void => {
      const built = buildTransaction({ inputs, outputs: [...outputs, { lockingBytecode: payee, valueSatoshis: 0n }], remainderOutputIndex: outputs.length, allowTokenBurn: burn });
      expect(chain.submit(hex(built.encoded)).accepted).toBe(false);
    };
    /** The controller spent with an action, signed by a key the recoverer holds, with the successor that action would have. */
    const attempt = (action: ControllerAction, signer: KeyPair, successorState: ControllerState | undefined, attached: InputSpec[]): void => {
      const { utxo, state } = controller();
      refused([controllerInput(utxo, state, action, signer), p2pkhInput(feeCoin(), balance.key), ...attached], successorState === undefined ? [] : [controllerOutput(identity, successorState, 1_000n)], successorState === undefined);
    };

    const tryEverything = (): void => {
      const { state } = controller();
      const active: ControllerState = { ...state, status: 'active' };
      delete (active as { proposedOwnerKeyHash?: Uint8Array }).proposedOwnerKeyHash;
      for (const key of held) {
        for (const coin of coins) {
          // By the address's own key path, with a key that is not the address's.
          if (coin.address.kind !== ADDRESS_KIND.vault) refused([recoverableInput(coin.utxo, coin.address.script, key)], []);
          // Through the controller, approved by that key as if it were the owner.
          attempt({ kind: 'ownerAuthorize' }, key, active, [through(coin)]);
          // A change of settings that would make that key the owner, with the coin attached and without.
          attempt({ kind: 'ownerUpdate', update: { ownerKeyHash: key.keyHash } }, key, { ...active, ownerKeyHash: key.keyHash, ownerEpoch: state.ownerEpoch + 1 }, [through(coin)]);
        }
        attempt({ kind: 'ownerUpdate', update: { ownerKeyHash: key.keyHash } }, key, { ...active, ownerKeyHash: key.keyHash, ownerEpoch: state.ownerEpoch + 1 }, []);
        // Closing the wallet to take the controller's value.
        attempt({ kind: 'ownerClose' }, key, undefined, []);
      }
    };

    // Before a wait. The request is the recoverer's to make; a coin attached to it is not.
    tryEverything();
    for (const coin of coins) {
      attempt({ kind: 'requestRecovery', proposedOwnerKeyHash: balance.key.keyHash }, credential.recoveryKey, { ...controller().state, status: 'pending', proposedOwnerKeyHash: balance.key.keyHash }, [through(coin)]);
    }

    // During a wait, to a key of the recoverer's own.
    await recoverer.request(balance.key.keyHash);
    expect(controller().state.status).toBe('pending');
    tryEverything();
    // The completion cannot carry a coin either: not before the waiting period has passed, and not after.
    const completed: ControllerState = { ...controller().state, status: 'active', ownerKeyHash: balance.key.keyHash, ownerEpoch: 1 };
    delete (completed as { proposedOwnerKeyHash?: Uint8Array }).proposedOwnerKeyHash;
    for (const coin of coins) attempt({ kind: 'finalizeRecovery' }, credential.recoveryKey, completed, [through(coin)]);
    await expect(recoverer.complete()).rejects.toThrow();
    wait();
    for (const coin of coins) attempt({ kind: 'finalizeRecovery' }, credential.recoveryKey, completed, [through(coin)]);

    // Nothing moved, and the owner still cancels.
    expect((await quickPass(chain, identity, seed.viewingKey)).found.flatMap((address) => address.coins)).toHaveLength(coins.length);
    await owner.cancel();
    expect(controller().state.status).toBe('active');
  });

  it('RC03: after a wait that nobody cancelled, to a key of its own, that key is the owner and can sweep: the stated limit', async () => {
    const { chain, seed, owner, recoverer, identity, balance, controller, wait } = await setup({ balance: 20_000n });
    chain.fund((await owner.receiveAddress()).address.lockingBytecode, 10_000n);
    chain.fund((await owner.vaultAddress()).address.lockingBytecode, 10_000n);
    const own = balance.key;
    await recoverer.request(own.keyHash);
    wait();
    await recoverer.complete();
    expect(controller().state).toMatchObject({ status: 'active', ownerEpoch: 1, ownerKeyHash: own.keyHash });

    const coins = (await quickPass(chain, identity, seed.viewingKey)).found.flatMap((address) => address.coins);
    const { utxo, state } = controller();
    const sweep = buildTransaction({
      inputs: [
        controllerInput(utxo, state, { kind: 'ownerAuthorize' }, own),
        ...coins.map((coin) => (coin.address.kind === ADDRESS_KIND.vault ? vaultInput(coin.utxo, coin.address.script, identity, coin.address.secret) : sweptInput(coin.utxo, coin.address.script, identity, coin.address.secret))),
      ],
      outputs: [controllerOutput(identity, state, 1_000n), { lockingBytecode: payee, valueSatoshis: 0n }],
      remainderOutputIndex: 1,
    });
    expect(chain.submit(hex(sweep.encoded)).accepted).toBe(true);
    // Everything the wallet held: its first coins and the two payments it received.
    expect(chain.balanceOf(payee)).toBeGreaterThan(95_000n);
    // The earlier owner's controller key no longer cancels or approves anything.
    await expect(owner.cancel()).rejects.toThrow();
  });
});

describe('two wallets with the same recoverer', () => {
  it('RC05: their controllers have nothing in common, and the recoverer pays for both from its one balance', async () => {
    const chain = new SimulatedChain();
    const shared = await recovererFunds(chain, 20_000n);
    const first = await setup({ chain, funds: shared });
    const second = await setup({ chain, words: OTHER_WORDS, credentialWords: OTHER_CREDENTIAL_WORDS, funds: shared });
    // The recoverer uses a different credential for every wallet.
    const states = [first, second].map((wallet) => wallet.controller().state);
    const fields = states.map((state) => [hex(state.ownerKeyHash), hex(state.recovererKeyHash)]);
    expect(new Set(fields.flat()).size).toBe(4);
    expect(hex(first.identity)).not.toBe(hex(second.identity));
    expect(hex(controllerScript(first.identity).lockingBytecode)).not.toBe(hex(controllerScript(second.identity).lockingBytecode));

    // Nothing a controller's state shows leads to the balance, and nothing is kept at an address of a recovery key.
    for (const state of states) expect(hex(encodeControllerState(state))).not.toContain(hex(shared.key.keyHash));
    for (const wallet of [first, second]) expect(chain.balanceOf(p2pkhLockingBytecode(wallet.credential.recoveryKey.keyHash))).toBe(0n);

    // A request by one says nothing about the other's controller.
    const one = await first.recoverer.request(newDevice.keyHash);
    expect(second.controller().state.status).toBe('active');
    const other = await second.recoverer.request(newDevice.keyHash);
    // Both were paid from the same balance, and its change came back to it: on chain, the two requests share a payer.
    expect(chain.balanceOf(shared.address)).toBe(20_000n - one.feeSatoshis - other.feeSatoshis);
    const requests = await Promise.all([first, second].map(async (wallet) => (await readControllerHistory(chain, wallet.identity)).transactions.at(-1)?.transaction));
    for (const request of requests) expect(hex(request?.outputs[1]?.lockingBytecode ?? new Uint8Array())).toBe(hex(shared.address));
  });
});

describe('the recoverer\'s fees', () => {
  /** Three requests that the owner cancels, then a fourth and its completion. Returns what the recoverer paid for each. */
  const fiveTransactions = async (wallet: Awaited<ReturnType<typeof setup>>): Promise<{ bytes: number; feeSatoshis: bigint; remainderSatoshis: bigint }[]> => {
    const paid = [];
    for (let round = 0; round < 3; round++) {
      paid.push(await wallet.recoverer.request(newDevice.keyHash));
      await wallet.owner.cancel();
    }
    paid.push(await wallet.recoverer.request(newDevice.keyHash));
    wallet.wait();
    paid.push(await wallet.recoverer.complete());
    expect(wallet.controller().state).toMatchObject({ status: 'active', ownerEpoch: 1, ownerKeyHash: newDevice.keyHash });
    return paid;
  };

  it('RC06: the recoverer pays all five fees from its balance, each in the one transaction that spends the controller', async () => {
    expect(recoveryFees()).toEqual({ request: 991n, completion: 970n });
    const wallet = await setup({ balance: 20_000n });
    const paid = await fiveTransactions(wallet);
    expect(paid.map((sent) => sent.bytes)).toEqual([991, 991, 991, 991, 970]);
    // Every fee is the size at the stated rate, and the change came back to the balance each time.
    for (const sent of paid) expect(sent).toMatchObject({ feeSatoshis: BigInt(sent.bytes), remainderSatoshis: 0n });
    expect(wallet.chain.balanceOf(wallet.balance.address)).toBe(20_000n - 4n * 991n - 970n);
    expect(await wallet.balance.funds.balance()).toBe(20_000n - 4n * 991n - 970n);
    const history = await readControllerHistory(wallet.chain, wallet.identity);
    expect(history.transitions.map((step) => step.kind)).toEqual(['requestRecovery', 'ownerAuthorize', 'requestRecovery', 'ownerAuthorize', 'requestRecovery', 'ownerAuthorize', 'requestRecovery', 'finalizeRecovery']);
    // Each of the recoverer's transactions is the controller and one coin of the balance, to the controller and the change.
    for (const [index, step] of history.transitions.entries()) {
      if (step.kind === 'ownerAuthorize') continue;
      const { transaction } = history.transactions[index + 1] as (typeof history.transactions)[number];
      expect(transaction.inputs).toHaveLength(2);
      expect(transaction.outputs.map((output) => hex(output.lockingBytecode))).toEqual([hex(controllerScript(wallet.identity).lockingBytecode), hex(wallet.balance.address)]);
    }
    // Nothing was ever kept at the wallet's fee address, and the owner's coins did not pay for any of it.
    expect(wallet.chain.balanceOf(wallet.feeAddress)).toBe(0n);
    expect((await wallet.owner.balance()).recoverable).toBeGreaterThan(80_000n);
  });

  it('RC06: with a balance of small coins, the same', async () => {
    const wallet = await setup();
    for (const coin of [700n, 700n, 700n, 700n, 700n, 700n, 700n, 700n, 700n, 700n]) wallet.chain.fund(wallet.balance.address, coin);
    const paid = await fiveTransactions(wallet);
    const total = paid.reduce((sum, sent) => sum + sent.feeSatoshis, 0n);
    expect(total).toBe(7_000n - wallet.chain.balanceOf(wallet.balance.address));
    // Each fee is the size, plus at most a remainder too small to return, which is reported.
    for (const sent of paid) expect(sent.feeSatoshis).toBe(BigInt(sent.bytes) + sent.remainderSatoshis);
  });

  it('RC06: with an empty balance, the recoverer is told what is missing, and goes on once coins arrive', async () => {
    const wallet = await setup();
    expect(await wallet.balance.funds.balance()).toBe(0n);
    try {
      await wallet.recoverer.request(newDevice.keyHash);
      expect.unreachable('a request needs a coin for its fee');
    } catch (error) {
      expect(error).toBeInstanceOf(FundsMissingError);
      expect(error).toMatchObject({ holds: 0n, needed: 957n });
      expect((error as Error).message).toContain('a request takes 957');
      expect((error as Error).message).toContain('Send at least 957 satoshis to your address');
    }
    // An empty balance takes none of the recoverer's power away: nothing has changed on chain.
    expect(wallet.controller().state.status).toBe('active');

    wallet.chain.fund(wallet.balance.address, 1_000n);
    await wallet.recoverer.request(newDevice.keyHash);
    wallet.wait();
    // The request took the coin; the completion says what it needs.
    await expect(wallet.recoverer.complete()).rejects.toThrow(FundsMissingError);
    wallet.chain.fund(wallet.balance.address, 936n);
    await wallet.recoverer.complete();
    expect(wallet.controller().state.ownerKeyHash).toEqual(newDevice.keyHash);
  });

  it('the change of a request pays for the completion, also when the key holder is slow to list it', async () => {
    const chain = new SimulatedChain();
    const keys = deriveSeedKeys(FUNDS_WORDS, 'testnet', numbers);
    const address = p2pkhLockingBytecode(keys.fundingKey.keyHash);
    chain.fund(address, 5_000n);
    const backend = new KeyBackend(chain, keys);
    // A key holder that goes on listing the coins as they were, for its next three listings after a transaction.
    let stale: Awaited<ReturnType<KeyBackend['coins']>> | undefined;
    let lag = 0;
    const slow = new Proxy(backend, {
      get: (target, property) => {
        if (property === 'coins') {
          return async () => {
            if (stale !== undefined && lag > 0) {
              lag -= 1;
              return stale;
            }
            return target.coins();
          };
        }
        if (property === 'send') {
          return async (prepared: Parameters<KeyBackend['send']>[0]) => {
            stale = await target.coins();
            const sent = await target.send(prepared);
            lag = 3;
            return sent;
          };
        }
        const value = Reflect.get(target, property) as unknown;
        return typeof value === 'function' ? (value as (...values: unknown[]) => unknown).bind(target) : value;
      },
    });
    const funds = await RecovererFunds.open({ backend: slow, chain });
    const wallet = await setup({ chain, funds: { funds, key: keys.fundingKey, address } });
    await wallet.recoverer.request(newDevice.keyHash);
    // The balance is not read as empty while the change is not listed, and the completion is paid from it.
    expect(await funds.balance()).toBe(5_000n - 991n);
    wallet.wait();
    await wallet.recoverer.complete();
    expect(await funds.balance()).toBe(5_000n - 991n - 970n);
    expect(wallet.controller().state.ownerKeyHash).toEqual(newDevice.keyHash);
  });

  it('a recoverer takes up a wallet only when its key is the recoverer the controller names', async () => {
    const wallet = await setup();
    const stranger = deriveCredentialKeys(OTHER_CREDENTIAL_WORDS, 'testnet', numbers);
    await expect(RecovererWallet.open({ funds: wallet.balance.funds, chain: wallet.chain, identity: wallet.identity, recoveryKey: stranger.recoveryKey })).rejects.toThrow(/not the recoverer named/);
  });
});

describe('the recoverer\'s balance', () => {
  it('goes whole to another address: every coin, no change, the exact fee', async () => {
    const wallet = await setup({ balance: 20_000n });
    wallet.chain.fund(wallet.balance.address, 5_000n);
    await wallet.recoverer.request(newDevice.keyHash);
    const { funds } = wallet.balance;
    const holds = await funds.balance();
    expect(holds).toBe(25_000n - 991n);
    const quote = await funds.quoteSendEverything(payee);
    // Two coins and one output: 326 bytes.
    expect(quote).toEqual({ sentSatoshis: holds - 326n, feeSatoshis: 326n, transactions: 1, leftOut: 0, heldBack: 0n });
    expect(await funds.balance()).toBe(holds);
    const sent = await funds.sendEverything(payee);
    expect(sent).toMatchObject({ sentSatoshis: quote.sentSatoshis, feeSatoshis: 326n });
    expect(sent.transactions).toHaveLength(1);
    expect(wallet.chain.balanceOf(payee)).toBe(holds - 326n);
    expect(wallet.chain.balanceOf(wallet.balance.address)).toBe(0n);
    expect(await funds.balance()).toBe(0n);
    // With nothing left there is nothing to send, and the page is told so with the figures.
    await expect(funds.quoteSendEverything(payee)).rejects.toThrow(/Insufficient funds/);
  });

  it('keeps the coin a set-up under way is named after when it is sent elsewhere, and says how much stays', async () => {
    const wallet = await setup();
    const held = wallet.chain.fund(wallet.balance.address, 12_000n);
    wallet.chain.fund(wallet.balance.address, 5_000n);
    const { funds } = wallet.balance;
    const reserved = new Set([held]);
    expect(await funds.quoteSendEverything(payee, { reserved })).toMatchObject({ sentSatoshis: 5_000n - 185n, heldBack: 12_000n });
    await funds.sendEverything(payee, { reserved });
    expect(wallet.chain.balanceOf(payee)).toBe(5_000n - 185n);
    expect(await funds.balance()).toBe(12_000n);
    // The same coin does not pay for a request either.
    await expect(wallet.recoverer.request(newDevice.keyHash, { reserved })).rejects.toThrow(FundsMissingError);
    await wallet.recoverer.request(newDevice.keyHash);
    expect(wallet.controller().state.status).toBe('pending');
  });

  it('takes in what an earlier version kept at a wallet\'s fee address', async () => {
    const wallet = await setup({ balance: 1_000n });
    const { funds } = wallet.balance;
    const earlier = (key: KeyPair = wallet.credential.feeKey) => wallet.chain.outputsAt(wallet.feeAddress).map((utxo) => ({ ...p2pkhInput(utxo, key), inputBytes: INPUT_BYTES.p2pkh }));
    // Nothing there, or too little to be worth its own fee: nothing is moved.
    expect(funds.takeInQuote(earlier())).toBeUndefined();
    expect(await funds.takeIn(earlier())).toBeUndefined();
    wallet.chain.fund(wallet.feeAddress, 120n);
    expect(funds.takeInQuote(earlier())).toBeUndefined();

    wallet.chain.fund(wallet.feeAddress, 4_900n);
    // The coin of 120 satoshis costs more to spend than it holds and stays; the reserve comes back less its fee.
    expect(funds.takeInQuote(earlier())).toEqual({ arrives: 4_900n - 185n, feeSatoshis: 185n });
    // Only the credential's fee key unlocks it: with another key the transaction fails the check and is not sent.
    await expect(funds.takeIn(earlier(wallet.credential.recoveryKey))).rejects.toThrow(/fails the check before sending/);
    const taken = await funds.takeIn(earlier());
    expect(taken).toMatchObject({ bytes: 185, feeSatoshis: 185n });
    expect(await funds.balance()).toBe(1_000n + 4_900n - 185n);
    expect(wallet.chain.balanceOf(wallet.feeAddress)).toBe(120n);
  });
});
