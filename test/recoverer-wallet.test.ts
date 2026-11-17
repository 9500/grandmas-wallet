import { binToHex, hexToBin } from '@bitauth/libauth';
import { FeeCoinsMissingError, OwnerWallet, RecovererWallet, suggestedAllowance, walletTemplateNumbers } from '@grandmas-wallet/app';
import {
  type ControllerAction,
  type ControllerState,
  type FoundCoin,
  type InputSpec,
  type KeyPair,
  ADDRESS_KIND,
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

/**
 * Acceptance tests RC03, RC05 and RC06 of the proposal: what the recoverer's key can and cannot do, what
 * two wallets with one recoverer share, and how the recoverer pays its fees.
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

/** A wallet with its recoverer, on one chain. The recoverer's account holds the credential's two keys and nothing of the owner's. */
const setup = async (options: { chain?: SimulatedChain; words?: string; credentialWords?: string; allowance?: bigint } = {}) => {
  const chain = options.chain ?? new SimulatedChain();
  const seed = deriveSeedKeys(options.words ?? WORDS, 'testnet', numbers);
  const credential = deriveCredentialKeys(options.credentialWords ?? CREDENTIAL_WORDS, 'testnet', numbers);
  const feeAddress = p2pkhLockingBytecode(credential.feeKey.keyHash);
  const owner = await OwnerWallet.open({ backend: new KeyBackend(chain, seed), chain, seed });
  chain.fund(p2pkhLockingBytecode(seed.fundingKey.keyHash), 100_000n);
  await owner.create({
    recovererKeyHash: credential.recoveryKey.keyHash,
    challengeDelay: DELAY,
    ...(options.allowance === undefined ? {} : { allowance: { feeLockingBytecode: feeAddress, satoshis: options.allowance } }),
  });
  const identity = hexToBin(owner.stored.identity as string);
  const backend = new KeyBackend(chain, {
    controllerKey: credential.recoveryKey,
    fundingKey: credential.feeKey,
    addressKey: () => {
      throw new Error('a recoverer holds no address key');
    },
  });
  const recoverer = await RecovererWallet.open({ backend, chain, identity });
  const controller = (): { utxo: ReturnType<SimulatedChain['outputsAt']>[number]; state: ControllerState } => {
    const [utxo] = chain.outputsAt(controllerScript(identity).lockingBytecode);
    if (utxo?.output.token?.nft === undefined) throw new Error('controller missing');
    return { utxo, state: decodeControllerState(utxo.output.token.nft.commitment) };
  };
  /** The waiting period passes on the chain's clock. */
  const wait = (): void => {
    chain.nowMs += 2 * 512 * 1000;
  };
  return { chain, seed, credential, owner, recoverer, identity, feeAddress, controller, wait };
};

describe('what the recoverer can do with everything it holds', () => {
  it('RC03: no path spends or sweeps a coin of the wallet, before a wait or during one', async () => {
    const { chain, seed, credential, owner, recoverer, identity, controller, wait } = await setup({ allowance: 20_000n });
    chain.fund((await owner.receiveAddress()).address.lockingBytecode, 10_000n);
    chain.fund((await owner.vaultAddress()).address.lockingBytecode, 10_000n);
    // The recoverer holds the viewing key: it finds every coin, with its secret.
    const coins = (await quickPass(chain, identity, seed.viewingKey)).found.flatMap((address) => address.coins);
    expect(coins.length).toBeGreaterThanOrEqual(3);
    const held: KeyPair[] = [credential.recoveryKey, credential.feeKey];
    const [feeCoin] = chain.outputsAt(p2pkhLockingBytecode(credential.feeKey.keyHash));
    if (feeCoin === undefined) throw new Error('fee coin missing');

    const through = (coin: FoundCoin): InputSpec =>
      coin.address.kind === ADDRESS_KIND.vault ? vaultInput(coin.utxo, coin.address.script, identity, coin.address.secret) : sweptInput(coin.utxo, coin.address.script, identity, coin.address.secret);
    const refused = (inputs: InputSpec[], outputs: Parameters<typeof buildTransaction>[0]['outputs'], burn = false): void => {
      const built = buildTransaction({ inputs, outputs: [...outputs, { lockingBytecode: payee, valueSatoshis: 0n }], remainderOutputIndex: outputs.length, allowTokenBurn: burn });
      expect(chain.submit(hex(built.encoded)).accepted).toBe(false);
    };
    /** The controller spent with an action, signed by a key the recoverer holds, with the successor that action would have. */
    const attempt = (action: ControllerAction, signer: KeyPair, successorState: ControllerState | undefined, attached: InputSpec[]): void => {
      const { utxo, state } = controller();
      refused([controllerInput(utxo, state, action, signer), p2pkhInput(feeCoin, credential.feeKey), ...attached], successorState === undefined ? [] : [controllerOutput(identity, successorState, 1_000n)], successorState === undefined);
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
      attempt({ kind: 'requestRecovery', proposedOwnerKeyHash: credential.feeKey.keyHash }, credential.recoveryKey, { ...controller().state, status: 'pending', proposedOwnerKeyHash: credential.feeKey.keyHash }, [through(coin)]);
    }

    // During a wait, to a key of the recoverer's own.
    await recoverer.request(credential.feeKey.keyHash);
    expect(controller().state.status).toBe('pending');
    tryEverything();
    // The completion cannot carry a coin either: not before the waiting period has passed, and not after.
    const completed: ControllerState = { ...controller().state, status: 'active', ownerKeyHash: credential.feeKey.keyHash, ownerEpoch: 1 };
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
    const { chain, seed, credential, owner, recoverer, identity, controller, wait } = await setup({ allowance: 20_000n });
    chain.fund((await owner.receiveAddress()).address.lockingBytecode, 10_000n);
    chain.fund((await owner.vaultAddress()).address.lockingBytecode, 10_000n);
    const own = credential.feeKey;
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
    // Everything the wallet held: its first coins less the allowance, and the two payments it received.
    expect(chain.balanceOf(payee)).toBeGreaterThan(95_000n);
    // The earlier owner's controller key no longer cancels or approves anything.
    await expect(owner.cancel()).rejects.toThrow();
  });
});

describe('two wallets with the same recoverer', () => {
  it('RC05: nothing on chain is common to them, and neither fee address follows from a controller\'s state', async () => {
    const chain = new SimulatedChain();
    const first = await setup({ chain, allowance: 5_000n });
    const second = await setup({ chain, words: OTHER_WORDS, credentialWords: OTHER_CREDENTIAL_WORDS, allowance: 5_000n });
    // The recoverer uses a different credential for every wallet.
    const states = [first, second].map((wallet) => wallet.controller().state);
    const fields = states.map((state) => [hex(state.ownerKeyHash), hex(state.recovererKeyHash)]);
    expect(new Set(fields.flat()).size).toBe(4);
    expect(hex(first.identity)).not.toBe(hex(second.identity));
    expect(hex(controllerScript(first.identity).lockingBytecode)).not.toBe(hex(controllerScript(second.identity).lockingBytecode));

    // The fee addresses differ from each other and from anything a controller's state shows.
    const feeHashes = [first, second].map((wallet) => hex(wallet.credential.feeKey.keyHash));
    expect(feeHashes[0]).not.toBe(feeHashes[1]);
    for (const state of states) {
      const shown = hex(encodeControllerState(state));
      for (const feeHash of feeHashes) expect(shown).not.toContain(feeHash);
    }
    // The address of the recovery key itself, which the state does give, is not where the fee coins are.
    for (const wallet of [first, second]) {
      expect(chain.balanceOf(p2pkhLockingBytecode(wallet.credential.recoveryKey.keyHash))).toBe(0n);
      expect(chain.balanceOf(wallet.feeAddress)).toBe(5_000n);
      expect(hex(await wallet.recoverer.feeAddress())).toBe(hex(wallet.feeAddress));
    }
    // A request by one says nothing about the other.
    await first.recoverer.request(newDevice.keyHash);
    expect(second.controller().state.status).toBe('active');
  });
});

describe('the recoverer\'s fees', () => {
  /** Three requests that the owner cancels, then a fourth and its completion. Returns what the recoverer paid for each. */
  const fiveTransactions = async (wallet: Awaited<ReturnType<typeof setup>>): Promise<{ bytes: number; feeSatoshis: bigint; remainderSatoshis: bigint }[]> => {
    const paid = [];
    for (let round = 0; round < 3; round++) {
      paid.push(await wallet.recoverer.request(newDevice.keyHash));
      await wallet.owner.cancel();
      await wallet.owner.setAsideCancellingCoin();
    }
    paid.push(await wallet.recoverer.request(newDevice.keyHash));
    wallet.wait();
    paid.push(await wallet.recoverer.complete());
    expect(wallet.controller().state).toMatchObject({ status: 'active', ownerEpoch: 1, ownerKeyHash: newDevice.keyHash });
    return paid;
  };

  it('RC06: with the suggested allowance, the recoverer pays all five fees from its fee address, exactly', async () => {
    expect(suggestedAllowance()).toBe(4n * 991n + 936n);
    const wallet = await setup({ allowance: suggestedAllowance() });
    expect(await wallet.recoverer.feeReadiness()).toMatchObject({ holds: 4_900n, request: 991n, completion: 970n, canRequest: true, canRecover: true, missing: 0n });
    const paid = await fiveTransactions(wallet);
    expect(paid.map((sent) => sent.bytes)).toEqual([991, 991, 991, 991, 936]);
    // Every fee is the size at the stated rate, and nothing is left over.
    for (const sent of paid) expect(sent).toMatchObject({ feeSatoshis: BigInt(sent.bytes), remainderSatoshis: 0n });
    expect(wallet.chain.balanceOf(wallet.feeAddress)).toBe(0n);
    const history = await readControllerHistory(wallet.chain, wallet.identity);
    expect(history.transitions.map((step) => step.kind)).toEqual(['requestRecovery', 'ownerAuthorize', 'requestRecovery', 'ownerAuthorize', 'requestRecovery', 'ownerAuthorize', 'requestRecovery', 'finalizeRecovery']);
  });

  it('RC06: with no allowance and coins the recoverer added itself, the same', async () => {
    const wallet = await setup();
    expect(wallet.chain.balanceOf(wallet.feeAddress)).toBe(0n);
    // Anyone can send coins to the fee address, from any wallet.
    wallet.chain.fund(wallet.feeAddress, 3_000n);
    wallet.chain.fund(wallet.feeAddress, 2_500n);
    const paid = await fiveTransactions(wallet);
    const total = paid.reduce((sum, sent) => sum + sent.feeSatoshis, 0n);
    expect(total).toBe(5_500n - wallet.chain.balanceOf(wallet.feeAddress));
    // Each fee is the size, plus at most a remainder too small to return, which is reported.
    for (const sent of paid) expect(sent.feeSatoshis).toBe(BigInt(sent.bytes) + sent.remainderSatoshis);
    // The owner's coins did not pay for any of it.
    expect((await wallet.owner.balance()).recoverable).toBeGreaterThan(80_000n);
  });

  it('RC06: with an empty fee address, the recoverer says beforehand what is missing, and goes on once coins arrive', async () => {
    const wallet = await setup();
    // Known when the wallet is taken up, not only at the moment of a recovery.
    expect(await wallet.recoverer.feeReadiness()).toEqual({ holds: 0n, request: 991n, completion: 970n, canRequest: false, canRecover: false, missing: 1_961n });
    try {
      await wallet.recoverer.request(newDevice.keyHash);
      expect.unreachable('a request needs a coin for its fee');
    } catch (error) {
      expect(error).toBeInstanceOf(FeeCoinsMissingError);
      expect(error).toMatchObject({ holds: 0n, needed: 957n });
      expect((error as Error).message).toContain('Send at least 957 satoshis to the fee address');
    }
    // An empty fee address takes none of the recoverer's power away: nothing has changed on chain.
    expect(wallet.controller().state.status).toBe('active');

    wallet.chain.fund(wallet.feeAddress, 1_000n);
    expect(await wallet.recoverer.feeReadiness()).toMatchObject({ holds: 1_000n, canRequest: true, canRecover: false, missing: 961n });
    await wallet.recoverer.request(newDevice.keyHash);
    wallet.wait();
    // The request took the coin; the completion says what it needs.
    await expect(wallet.recoverer.complete()).rejects.toThrow(FeeCoinsMissingError);
    wallet.chain.fund(wallet.feeAddress, 936n);
    await wallet.recoverer.complete();
    expect(wallet.controller().state.ownerKeyHash).toEqual(newDevice.keyHash);
  });

  it('the recoverer can send what its fee address holds back; nothing obliges it to', async () => {
    const wallet = await setup({ allowance: 4_900n });
    await wallet.recoverer.request(newDevice.keyHash);
    const sent = await wallet.recoverer.returnFeeCoins(payee);
    // 4,900 less the request's 991, less the 185 of sending it on.
    expect(sent).toMatchObject({ bytes: 185, feeSatoshis: 185n });
    expect(wallet.chain.balanceOf(payee)).toBe(4_900n - 991n - 185n);
    expect(wallet.chain.balanceOf(wallet.feeAddress)).toBe(0n);
    // With nothing left there is nothing to send.
    expect(await wallet.recoverer.returnFeeCoins(payee)).toBeUndefined();
  });

  it('a recoverer\'s account takes up a wallet only when its key is the recoverer the controller names', async () => {
    const wallet = await setup();
    const stranger = deriveCredentialKeys(OTHER_CREDENTIAL_WORDS, 'testnet', numbers);
    const backend = new KeyBackend(wallet.chain, { controllerKey: stranger.recoveryKey, fundingKey: stranger.feeKey, addressKey: () => stranger.feeKey });
    await expect(RecovererWallet.open({ backend, chain: wallet.chain, identity: wallet.identity })).rejects.toThrow(/not the recoverer named/);
  });
});
