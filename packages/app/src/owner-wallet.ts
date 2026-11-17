import { type Output, binToHex, decodeTransactionBch, hexToBin } from '@bitauth/libauth';
import {
  type AccountCoin,
  type Allocation,
  type ChainReader,
  type ChallengeDelay,
  type ControllerState,
  type ControllerUpdate,
  type KeyedAddressKind,
  type PreparedTransaction,
  type SeedKeys,
  type SpendableCoin,
  type TransactionRequest,
  type ViewingKey,
  type WalletSearch,
  type SeedView,
  type WalletAddress,
  type WalletBackend,
  ADDRESS_KIND,
  INPUT_BYTES,
  InsufficientFundsError,
  LARGEST_TRANSACTION_BYTES,
  afterOwnerAuthorize,
  afterOwnerUpdate,
  chooseCoins,
  controllerScript,
  decodeControllerState,
  emptyAllocation,
  encodeChallengeDelay,
  encodeControllerState,
  keepNumber,
  markUsed,
  planSendEverything,
  readControllerHistory,
  requiredFee,
  returnNumber,
  searchWallet,
  smallestOutputValue,
  takeNumber,
  transactionBytes,
  validateGenesis,
  walletAddress,
} from '@grandmas-wallet/core';

/**
 * The owner's wallet (proposal sections 7.7, 7.9 and 8): creating it, giving out addresses, paying, the
 * coin kept for cancelling, sending everything, and closing.
 *
 * The wallet's logic decides which coins a transaction spends and what its outputs are; a backend holds
 * the keys and builds exactly that. What the wallet has to remember is plain data, stored by the device
 * after every step, so that a device that stops continues from where it stopped.
 */

const CONTROLLER_SATOSHIS = 1_000n;
const hex = binToHex;

/** What a device stores about its wallet. */
export interface OwnerWalletState {
  /** The identity, once the transaction that defines it is known. It counts only when `creation.confirmed`. */
  identity?: string;
  creation: {
    /** The wallet's payment to itself that made a coin that is output 0, when one was needed. */
    prepareTransactionId?: string;
    createTransactionId?: string;
    /**
     * The servers have shown the transaction that defines the identity, or the one that creates the
     * controller. A transaction that was seen and is no longer there was replaced or undone; one that was
     * never seen may still be on its way, or may never have been sent.
     */
    identitySeen?: boolean;
    createSeen?: boolean;
    /** Both the transaction that defines the identity and the one that creates the controller are in a block. */
    confirmed: boolean;
  };
  allocation: Allocation;
  /** The change address the coin for cancelling was put at. */
  cancelCoinNumber?: number;
  /** The change address the rest of the wallet's first coins went to. */
  firstCoinNumber?: number;
  /** The recoverer has confirmed that it holds what a recovery needs (section 9.5). Set by the code that reads receipts. */
  recoveryConfirmed: boolean;
  /** A full pass has finished for every seed the wallet has had (section 7.7). Set by the code that searches. */
  fullySearched: boolean;
  /** The viewing keys of the seeds the wallet had before this one, oldest first, as far as the device was given them. */
  earlierSeeds?: StoredViewingKey[];
  /** Addresses of earlier seeds that a search found in use. They are watched, and what arrives there is swept. */
  earlierFound?: { seed: number; kind: 0 | 1 | 2; number: number }[];
  /** The chain shows, confirmed, that a key this device does not hold owns the wallet. */
  ownedElsewhere?: boolean;
  /** The identity the user moved on to (section 18.3). This one is kept: payments can still arrive at its addresses. */
  movedToIdentity?: string;
}

/** A viewing key as a device stores it. */
export interface StoredViewingKey {
  label: string;
  network: ViewingKey['network'];
  addressNodes: ViewingKey['addressNodes'];
  /** Hex. */
  blindingSeed: string;
}

const storedViewingKey = (label: string, viewingKey: ViewingKey): StoredViewingKey => ({ label, network: viewingKey.network, addressNodes: viewingKey.addressNodes, blindingSeed: binToHex(viewingKey.blindingSeed) });
const viewingKeyOf = (stored: StoredViewingKey): ViewingKey => ({ network: stored.network, addressNodes: stored.addressNodes, blindingSeed: hexToBin(stored.blindingSeed) });

export interface Swept {
  transactions: Sent[];
  /** How many coins were moved. */
  coins: number;
  /** Tokens that were moved, unchanged. The wallet does not know what they mean until it has their application's template. */
  tokens: { category: string; meaning: 'unknown' }[];
}

export const newOwnerWalletState = (): OwnerWalletState => ({
  creation: { confirmed: false },
  allocation: emptyAllocation(),
  recoveryConfirmed: false,
  fullySearched: false,
});

export type CreationStep = 'not funded' | 'funded' | 'prepared' | 'created' | 'confirmed';

export interface CreateOptions {
  recovererKeyHash: Uint8Array;
  challengeDelay: ChallengeDelay;
  /** Coins the owner gives the recoverer for its fees, at the recoverer's fee address. Offered, not required. */
  allowance?: { feeLockingBytecode: Uint8Array; satoshis: bigint };
}

export interface Balance {
  /** At the wallet's recoverable addresses, without the coin for cancelling. */
  recoverable: bigint;
  /** The coin kept to pay for a cancellation. */
  cancelling: bigint;
  /** At vault addresses. */
  vault: bigint;
  /**
   * At the funding address. The funding address is not recoverable: a coin there can be moved only while
   * the seed is at hand.
   */
  notRecoverable: bigint;
  /** Coins that carry tokens, at the wallet's addresses. */
  tokens: AccountCoin[];
  /** At an earlier seed's addresses, not yet swept. Until it is swept, the earlier seed can spend it too. */
  toSweep: bigint;
}

export interface Sent {
  transactionId: string;
  bytes: number;
  feeSatoshis: bigint;
  /** The part of the fee that was too small to return as change. */
  remainderSatoshis: bigint;
}

export interface SentEverything {
  transactions: Sent[];
  sentSatoshis: bigint;
  feeSatoshis: bigint;
  /** Coins that hold no more than it costs to spend them, left where they are. */
  leftOut: AccountCoin[];
}

/** Thrown when closing is asked for and something stands in the way. */
export class CannotCloseError extends Error {
  constructor(readonly reasons: string[]) {
    super(`The wallet cannot be closed: ${reasons.join(' ')}`);
    this.name = 'CannotCloseError';
  }
}

const tokenFree = (coin: AccountCoin): boolean => coin.utxo.output.token === undefined;
const sameCoin = (a: AccountCoin, b: AccountCoin): boolean => hex(a.utxo.transactionHash) === hex(b.utxo.transactionHash) && a.utxo.index === b.utxo.index;
const spendable = (coin: AccountCoin, inputBytes: number): SpendableCoin & { coin: AccountCoin } => ({ utxo: coin.utxo, inputBytes, coin });
const valueOf = (coins: AccountCoin[]): bigint => coins.reduce((sum, coin) => sum + coin.utxo.output.valueSatoshis, 0n);

export class OwnerWallet {
  /**
   * Coins that transactions of this wallet have spent since it was opened. A key holder may go on listing a
   * coin for a moment after the transaction that spends it was sent; the wallet does not use it again.
   */
  private readonly spent = new Set<string>();
  private readonly preparedInputs = new Map<string, string[]>();
  /** Addresses of earlier seeds that were made known to the key holder, by locking bytecode. */
  private readonly earlier = new Map<string, WalletAddress>();

  private constructor(
    private readonly backend: WalletBackend,
    private readonly chain: ChainReader,
    /** The seed's keys as the wallet's own code derives them: the viewing key gives every tag and address. */
    private readonly seed: Pick<SeedKeys, 'viewingKey' | 'network'>,
    private state: OwnerWalletState,
    private readonly save: (state: OwnerWalletState) => void,
    private readonly feeRate: number,
  ) {}

  /**
   * Open the wallet on a device. An account that has just been opened knows no script yet, so the
   * controller and every address given out so far are made known to it again, in order.
   */
  static async open(options: {
    backend: WalletBackend;
    chain: ChainReader;
    seed: Pick<SeedKeys, 'viewingKey' | 'network'>;
    state?: OwnerWalletState;
    save?: (state: OwnerWalletState) => void;
    feeRate?: number;
  }): Promise<OwnerWallet> {
    const wallet = new OwnerWallet(options.backend, options.chain, options.seed, options.state ?? newOwnerWalletState(), options.save ?? (() => undefined), options.feeRate ?? 1);
    await wallet.backend.ordinaryAddress();
    if (wallet.state.identity !== undefined) await wallet.makeKnown();
    return wallet;
  }

  /**
   * A device takes a wallet over, or opens it again from its twelve words and the identity (proposal
   * sections 11.1 and 18.1): the chain must show this device's controller key as the owner. No controller
   * transaction is needed for that. The viewing keys of earlier seeds, as far as the device was given them,
   * let it find and sweep what is at their addresses.
   *
   * @throws if the controller names another owner, or the wallet has been closed
   */
  static async takeOver(options: {
    backend: WalletBackend;
    chain: ChainReader;
    seed: Pick<SeedKeys, 'viewingKey' | 'network'>;
    identity: Uint8Array;
    /** Oldest first. */
    earlierViewingKeys?: ViewingKey[];
    save?: (state: OwnerWalletState) => void;
    feeRate?: number;
  }): Promise<OwnerWallet> {
    const history = await readControllerHistory(options.chain, options.identity);
    if (history.closed !== undefined) throw new Error('This wallet has been closed.');
    const key = await options.backend.controllerKey('owner');
    if (hex(history.current.state.ownerKeyHash) !== hex(key.keyHash)) {
      throw new Error('The wallet\'s controller names another owner than this device\'s key.');
    }
    const state: OwnerWalletState = {
      ...newOwnerWalletState(),
      identity: hex(options.identity),
      creation: { identitySeen: true, createSeen: true, confirmed: true },
      earlierSeeds: (options.earlierViewingKeys ?? []).map((viewingKey, index) => storedViewingKey(`earlier seed ${index + 1}`, viewingKey)),
    };
    options.save?.(state);
    return OwnerWallet.open({ ...options, state });
  }

  /** The coins the key holder follows, without those this wallet has already spent. */
  private async coins(): Promise<AccountCoin[]> {
    return (await this.backend.coins()).filter((coin) => !this.spent.has(`${hex(coin.utxo.transactionHash)}:${coin.utxo.index}`));
  }

  /** Have the key holder build, sign and check a transaction, and note which coins it spends. */
  private async prepareTransaction(request: TransactionRequest): Promise<PreparedTransaction> {
    const prepared = await this.backend.prepare(request);
    this.preparedInputs.set(prepared.invitationIdentifier, request.inputs.map(({ coin }) => `${hex(coin.utxo.transactionHash)}:${coin.utxo.index}`));
    return prepared;
  }

  /** Send a prepared transaction and remember which coins it spent. */
  private async sendPrepared(prepared: PreparedTransaction): Promise<void> {
    await this.backend.send(prepared);
    for (const place of this.preparedInputs.get(prepared.invitationIdentifier) ?? []) this.spent.add(place);
    this.preparedInputs.delete(prepared.invitationIdentifier);
  }

  private store(change: Partial<OwnerWalletState>): void {
    this.state = { ...this.state, ...change };
    this.save(this.state);
  }

  private get identity(): Uint8Array {
    if (this.state.identity === undefined) throw new Error('The wallet has not been created yet.');
    return hexToBin(this.state.identity);
  }

  /** Address `number` of a kind, as the wallet's own code works it out. */
  address(kind: 0 | 1 | 2, number: number): WalletAddress {
    return walletAddress(this.identity, this.seed.viewingKey, kind, number);
  }

  /** Make the controller and every address handed out so far known to the backend. */
  private async makeKnown(): Promise<void> {
    await this.backend.knowController(this.identity, 'owner');
    for (const kind of [ADDRESS_KIND.givenOut, ADDRESS_KIND.change] as const) await this.makeAddresses(kind, this.state.allocation[kind].next);
    for (let number = 0; number < this.state.allocation[ADDRESS_KIND.vault].next; number++) {
      const address = this.address(ADDRESS_KIND.vault, number);
      if (address.kind === ADDRESS_KIND.vault) await this.backend.knowVaultAddress(this.identity, address);
    }
    for (const found of this.state.earlierFound ?? []) await this.knowEarlier(found.seed, found.kind, found.number);
  }

  /** Make an address of an earlier seed known: the key holder follows it and can sweep it. */
  private async knowEarlier(seed: number, kind: 0 | 1 | 2, number: number): Promise<void> {
    const stored = this.state.earlierSeeds?.[seed];
    if (stored === undefined) return;
    const address = walletAddress(this.identity, viewingKeyOf(stored), kind, number);
    if (this.earlier.has(hex(address.lockingBytecode))) return;
    if (address.kind === ADDRESS_KIND.vault) await this.backend.knowVaultAddress(this.identity, address);
    else await this.backend.knowEarlierAddress(this.identity, address);
    this.earlier.set(hex(address.lockingBytecode), address);
  }

  /** Have the backend make addresses of a kind up to, not including, `count`: it hands out keys in order. */
  private async makeAddresses(kind: KeyedAddressKind, count: number): Promise<void> {
    for (let number = await this.backend.addressCount(kind); number < count; number++) {
      const ours = this.address(kind, number);
      const made = await this.backend.nextAddress(kind, ours.tag);
      if (made.number !== number || hex(made.lockingBytecode) !== hex(ours.lockingBytecode)) {
        throw new Error(`Address ${number} of kind ${kind} as the key holder made it differs from the one the wallet worked out.`);
      }
    }
  }

  // ---------------------------------------------------------------- creating

  /** Ordinary coins at the funding address. */
  private async fundingCoins(): Promise<AccountCoin[]> {
    return (await this.coins()).filter((coin) => coin.template === 'coins' && tokenFree(coin));
  }

  async fundingAddress(): Promise<Uint8Array> {
    return this.backend.ordinaryAddress();
  }

  /** Whether a transaction is known to the servers, and whether it is in a block. */
  private async seen(transactionId: string, lockingBytecode: Uint8Array): Promise<'missing' | 'unconfirmed' | 'confirmed'> {
    const entry = (await this.chain.getHistory(lockingBytecode)).find((candidate) => candidate.transactionId === transactionId);
    return entry === undefined ? 'missing' : entry.height > 0 ? 'confirmed' : 'unconfirmed';
  }

  /**
   * Where the creation stands, read from the chain. A transaction of the creation that the servers showed
   * and no longer show (replaced, or in a block that was undone) is forgotten, which is safe: no address is
   * given out before both are confirmed. One they have not shown yet is kept: it may be on its way.
   */
  async creationStep(): Promise<CreationStep> {
    if (this.state.identity !== undefined && !this.state.creation.confirmed) {
      const { creation } = this.state;
      const definedIn = await this.seen(this.state.identity, await this.fundingAddress());
      const createdIn = creation.createTransactionId === undefined ? 'missing' : await this.seen(creation.createTransactionId, controllerScript(this.identity).lockingBytecode);
      if (definedIn === 'missing' && creation.identitySeen === true) {
        // The transaction that defined the identity is gone, and the identity with it.
        const { identity: _gone, cancelCoinNumber: _coin, firstCoinNumber: _first, ...rest } = this.state;
        this.state = { ...rest, creation: { confirmed: false }, allocation: emptyAllocation() };
        this.save(this.state);
      } else if (createdIn === 'missing' && creation.createSeen === true) {
        const { createTransactionId: _gone, createSeen: _seen, ...rest } = creation;
        this.store({ creation: { ...rest, identitySeen: definedIn !== 'missing' || creation.identitySeen === true } });
      } else {
        this.store({
          creation: {
            ...creation,
            ...(definedIn !== 'missing' ? { identitySeen: true } : {}),
            ...(createdIn !== 'missing' ? { createSeen: true } : {}),
            confirmed: definedIn === 'confirmed' && createdIn === 'confirmed',
          },
        });
      }
    }
    if (this.state.creation.confirmed) return 'confirmed';
    if (this.state.creation.createTransactionId !== undefined) return 'created';
    if (this.state.identity !== undefined) return 'prepared';
    return (await this.fundingCoins()).length > 0 ? 'funded' : 'not funded';
  }

  /** The wallet's payment to itself: every funding coin to one output at the funding address, which is then output 0. */
  private async selfPayment(coins: AccountCoin[]): Promise<PreparedTransaction> {
    const funding = await this.fundingAddress();
    const bytes = transactionBytes(coins.map(() => INPUT_BYTES.p2pkh), [{ lockingBytecode: funding, valueSatoshis: 0n }]);
    return this.prepareTransaction({
      template: 'actions',
      action: 'pay',
      role: 'owner',
      inputs: coins.map((coin) => ({ coin })),
      outputs: [{ lockingBytecode: funding, valueSatoshis: valueOf(coins) - requiredFee(bytes, this.feeRate) }],
    });
  }

  /** The coin that defines the identity: output 0 of the identity's transaction, at the funding address. */
  private async identityCoin(attempts: number): Promise<AccountCoin | undefined> {
    for (let attempt = 0; attempt < attempts; attempt++) {
      const coin = (await this.fundingCoins()).find((candidate) => hex(candidate.utxo.transactionHash) === this.state.identity && candidate.utxo.index === 0);
      if (coin !== undefined) return coin;
      if (attempt + 1 < attempts) await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return undefined;
  }

  /**
   * Create the wallet, or continue creating it (proposal section 7.9). Each call does what is still to be
   * done and can be repeated after an interruption; it never starts a second identity.
   *
   * @returns where the creation stands afterwards
   */
  async create(options: CreateOptions): Promise<CreationStep> {
    const step = await this.creationStep();
    if (step === 'not funded') throw new Error('The funding address holds no coin yet.');
    if (step === 'confirmed') return step;

    if (step === 'funded') {
      const coins = await this.fundingCoins();
      // A token category is the transaction whose output 0 is spent: the wallet needs a coin that is output 0.
      const first = coins.find((coin) => coin.utxo.index === 0);
      if (first !== undefined) {
        this.store({ identity: hex(first.utxo.transactionHash), creation: { identitySeen: true, confirmed: false } });
      } else {
        const prepared = await this.selfPayment(coins);
        // The identity is recorded before the transaction that defines it is sent.
        this.store({ identity: prepared.transactionId, creation: { prepareTransactionId: prepared.transactionId, confirmed: false } });
        await this.sendPrepared(prepared);
      }
    }

    // The identity is known. What is still to be sent is sent; a transaction that is on its way is left alone.
    let coin = await this.identityCoin(1);
    if (coin === undefined && this.state.creation.prepareTransactionId !== undefined && this.state.creation.identitySeen !== true && this.state.creation.createTransactionId === undefined) {
      // The payment to itself was recorded and the servers have not shown it. If the coins it spends are
      // still there, the device stopped before sending it; the same coins give the same transaction again.
      const unspent = (await this.fundingCoins()).filter((candidate) => hex(candidate.utxo.transactionHash) !== this.state.identity);
      if (unspent.length > 0) {
        const prepared = await this.selfPayment(unspent);
        this.store({ identity: prepared.transactionId, creation: { prepareTransactionId: prepared.transactionId, confirmed: false } });
        await this.sendPrepared(prepared);
      }
    }
    // A coin of the wallet's own last transaction may take a moment to be listed.
    if (coin === undefined) coin = await this.identityCoin(this.state.creation.createTransactionId === undefined ? 40 : 2);
    if (coin === undefined) {
      // The coin is spent: the creating transaction has been sent and is on its way, or is there already.
      if (this.state.creation.createTransactionId === undefined) throw new Error('The coin that defines the wallet\'s identity was not found.');
      await this.backend.knowController(this.identity, 'owner');
      return this.creationStep();
    }

    const identity = this.identity;
    const owner = await this.backend.controllerKey('owner');
    const first: ControllerState = { version: 1, status: 'active', ownerEpoch: 0, ownerKeyHash: owner.keyHash, recovererKeyHash: options.recovererKeyHash, challengeDelay: options.challengeDelay };
    const controller = this.controllerOutput(first);

    // The coin for cancelling and the rest go to change addresses, which exist as soon as the identity does.
    // A device that stopped after taking the two numbers uses the same ones again.
    if (this.state.cancelCoinNumber === undefined || this.state.firstCoinNumber === undefined) {
      let allocation = this.state.allocation;
      const taken: number[] = [];
      for (let count = 0; count < 2; count++) {
        const next = takeNumber(allocation, ADDRESS_KIND.change);
        if (!('number' in next)) throw new Error('No change address is free for the wallet\'s first coins.');
        allocation = keepNumber(next.allocation, ADDRESS_KIND.change, next.number);
        taken.push(next.number);
      }
      this.store({ allocation, cancelCoinNumber: taken[0] as number, firstCoinNumber: taken[1] as number });
    }
    const cancelNumber = this.state.cancelCoinNumber as number;
    const restNumber = this.state.firstCoinNumber as number;
    await this.makeAddresses(ADDRESS_KIND.change, this.state.allocation[ADDRESS_KIND.change].next);
    const cancelling = { lockingBytecode: this.address(ADDRESS_KIND.change, cancelNumber).lockingBytecode, valueSatoshis: this.cancellationCost() };
    const allowance = options.allowance === undefined ? [] : [{ lockingBytecode: options.allowance.feeLockingBytecode, valueSatoshis: options.allowance.satoshis }];
    const rest = { lockingBytecode: this.address(ADDRESS_KIND.change, restNumber).lockingBytecode, valueSatoshis: 0n };
    const outputs = [controller, cancelling, ...allowance, rest];
    const fee = requiredFee(transactionBytes([INPUT_BYTES.p2pkh], outputs), this.feeRate);
    const left = coin.utxo.output.valueSatoshis - outputs.reduce((sum, output) => sum + output.valueSatoshis, 0n) - fee;
    if (left < smallestOutputValue(rest)) {
      throw new InsufficientFundsError(coin.utxo.output.valueSatoshis, fee, coin.utxo.output.valueSatoshis - left + smallestOutputValue(rest), 'the funding coin does not cover the controller, the coin for cancelling, the allowance and the fee.');
    }
    const prepared = await this.prepareTransaction({
      template: 'controller',
      action: 'create',
      role: 'owner',
      variables: { identity: hex(identity), nextState: hex(encodeControllerState(first)) },
      inputs: [{ coin }],
      outputs: [{ outputIdentifier: 'controllerOutput' }, cancelling, ...allowance, { ...rest, valueSatoshis: left }],
    });
    // The creation is checked as any client would check it, before it is sent and before the identity is used.
    const transaction = decodeTransactionBch(hexToBin(prepared.transactionHex));
    if (typeof transaction === 'string') throw new Error(transaction);
    validateGenesis(transaction, hexToBin(prepared.transactionId), identity);
    const { createSeen: _unseen, ...creation } = this.state.creation;
    this.store({ creation: { ...creation, createTransactionId: prepared.transactionId, confirmed: false } });
    await this.sendPrepared(prepared);
    await this.backend.knowController(identity, 'owner');
    return this.creationStep();
  }

  /** A coin the backend is about to see: it may take a moment after a transaction of the wallet's own. */
  private async waitForCoin(find: () => Promise<AccountCoin | undefined>): Promise<AccountCoin> {
    for (let attempt = 0; attempt < 60; attempt++) {
      const coin = await find();
      if (coin !== undefined) return coin;
      await new Promise((resolve) => setTimeout(resolve, attempt === 0 ? 0 : 250));
    }
    throw new Error('A coin the wallet expects was not found.');
  }

  private controllerOutput(state: ControllerState): Output {
    return {
      lockingBytecode: controllerScript(this.identity).lockingBytecode,
      valueSatoshis: CONTROLLER_SATOSHIS,
      token: { amount: 0n, category: this.identity, nft: { capability: 'mutable', commitment: encodeControllerState(state) } },
    };
  }

  /** What a cancellation costs when the coin kept for it pays and nothing is left over. */
  private cancellationCost(): bigint {
    const controller = { lockingBytecode: new Uint8Array(35), valueSatoshis: CONTROLLER_SATOSHIS, token: { amount: 0n, category: new Uint8Array(32), nft: { capability: 'mutable' as const, commitment: new Uint8Array(69) } } };
    return requiredFee(transactionBytes([INPUT_BYTES.controller, INPUT_BYTES.byKey], [controller]), this.feeRate);
  }

  // ---------------------------------------------------------------- what the wallet shows

  private requireCreated(): void {
    if (this.state.ownedElsewhere === true) {
      throw new Error('The chain shows that another key owns this wallet. It gives out no address and takes on no action; coins that have not been swept can still be moved out.');
    }
    if (!this.state.creation.confirmed) {
      throw new Error('The wallet\'s identity is not confirmed yet. Until it is, no address is given out: if the transaction that defines the identity were replaced, the identity would be another.');
    }
  }

  /** Whether recovery is on: the recoverer has confirmed that it holds what a recovery needs. Coins in the wallet do not mean that it is. */
  get recovery(): 'on' | 'off' {
    return this.state.creation.confirmed && this.state.recoveryConfirmed ? 'on' : 'off';
  }

  private async controllerCoin(): Promise<{ coin: AccountCoin; state: ControllerState }> {
    const locking = hex(controllerScript(this.identity).lockingBytecode);
    const coin = await this.waitForCoin(async () => (await this.coins()).find((candidate) => hex(candidate.utxo.output.lockingBytecode) === locking && candidate.utxo.output.token !== undefined));
    const commitment = coin.utxo.output.token?.nft?.commitment;
    if (commitment === undefined) throw new Error('The controller carries no state.');
    return { coin, state: decodeControllerState(commitment) };
  }

  /** The wallet's coins by where they are. */
  private async sorted(): Promise<{ own: AccountCoin[]; cancelling: AccountCoin[]; vault: AccountCoin[]; earlier: AccountCoin[]; funding: AccountCoin[]; tokens: AccountCoin[] }> {
    const coins = await this.coins();
    const cancelAt = this.state.cancelCoinNumber === undefined || this.state.identity === undefined ? undefined : hex(this.address(ADDRESS_KIND.change, this.state.cancelCoinNumber).lockingBytecode);
    const controllerAt = this.state.identity === undefined ? undefined : hex(controllerScript(this.identity).lockingBytecode);
    const atAddress = coins.filter((coin) => hex(coin.utxo.output.lockingBytecode) !== controllerAt && coin.template !== 'coins');
    const keyed = atAddress.filter((coin) => coin.template === 'givenOut' || coin.template === 'change');
    // The coin for cancelling is the one the wallet put aside; anything else that arrives at its address is an ordinary coin.
    const cancelling = keyed.filter((coin) => tokenFree(coin) && hex(coin.utxo.output.lockingBytecode) === cancelAt && coin.utxo.output.valueSatoshis === this.cancellationCost()).slice(0, 1);
    return {
      own: keyed.filter((coin) => tokenFree(coin) && !cancelling.includes(coin)),
      cancelling,
      vault: atAddress.filter((coin) => coin.template === 'actions' && tokenFree(coin) && !this.earlier.has(hex(coin.utxo.output.lockingBytecode))),
      // At an earlier seed's addresses, with or without tokens: what a sweep is for.
      earlier: atAddress.filter((coin) => this.earlier.has(hex(coin.utxo.output.lockingBytecode))),
      funding: coins.filter((coin) => coin.template === 'coins' && tokenFree(coin)),
      tokens: atAddress.filter((coin) => !tokenFree(coin) && !this.earlier.has(hex(coin.utxo.output.lockingBytecode))),
    };
  }

  async balance(): Promise<Balance> {
    const { own, cancelling, vault, earlier, funding, tokens } = await this.sorted();
    return { recoverable: valueOf(own), cancelling: valueOf(cancelling), vault: valueOf(vault), notRecoverable: this.state.creation.confirmed ? valueOf(funding) : 0n, tokens, toSweep: valueOf(earlier) };
  }

  /** Whether the wallet can cancel a request now: it holds the coin kept for that. */
  async canCancel(): Promise<boolean> {
    return (await this.sorted()).cancelling.length > 0;
  }

  // ---------------------------------------------------------------- addresses

  /**
   * A fresh address to be paid at. Inside the window it is a new one; when the window is full, an address
   * that was already given out and is still unused is given again, and the wallet says so.
   */
  async receiveAddress(): Promise<{ address: WalletAddress; again: boolean }> {
    return this.giveOut(ADDRESS_KIND.givenOut);
  }

  /** An address without a key, for a payer who will use it for years. */
  async vaultAddress(): Promise<{ address: WalletAddress; again: boolean }> {
    return this.giveOut(ADDRESS_KIND.vault);
  }

  private async giveOut(kind: 0 | 1 | 2): Promise<{ address: WalletAddress; again: boolean }> {
    this.requireCreated();
    const taken = takeNumber(this.state.allocation, kind);
    const number = 'number' in taken ? taken.number : taken.refused.offer;
    if ('number' in taken) {
      // The number is recorded as taken before the address is shown.
      this.store({ allocation: keepNumber(taken.allocation, kind, taken.number) });
    }
    const address = this.address(kind, number);
    if (address.kind === ADDRESS_KIND.vault) await this.backend.knowVaultAddress(this.identity, address);
    else await this.makeAddresses(address.kind, number + 1);
    return { address, again: !('number' in taken) };
  }

  /** Take account of what the chain shows: an address with history is used, and the window moves on from it. */
  async noteUsed(used: { kind: 0 | 1 | 2; number: number }[]): Promise<void> {
    let allocation = this.state.allocation;
    for (const { kind, number } of used) allocation = markUsed(allocation, kind, number);
    this.store({ allocation });
    if (this.state.identity !== undefined) await this.makeKnown();
  }

  // ---------------------------------------------------------------- paying

  /**
   * Pay the given outputs from the wallet's coins. Coins are chosen so that no change is needed where that
   * is possible; change goes to a fresh change address. The coin kept for cancelling is left alone.
   *
   * @param moving - coins that carry tokens which the outputs move; a fee never comes from one
   */
  async pay(outputs: Output[], moving: AccountCoin[] = []): Promise<Sent> {
    this.requireCreated();
    const { own } = await this.sorted();
    const taken = takeNumber(this.state.allocation, ADDRESS_KIND.change);
    const changeNumber = 'number' in taken ? taken.number : taken.refused.offer;
    const changeAddress = this.address(ADDRESS_KIND.change, changeNumber);
    const choice = chooseCoins({
      available: own.map((coin) => spendable(coin, INPUT_BYTES.byKey)),
      fixedInputs: moving.map((coin) => spendable(coin, INPUT_BYTES.byKey)),
      outputs,
      changeLockingBytecode: changeAddress.lockingBytecode,
      feeRate: this.feeRate,
    });
    if (choice.changeSatoshis !== undefined && 'number' in taken) {
      this.store({ allocation: keepNumber(taken.allocation, ADDRESS_KIND.change, taken.number) });
      await this.makeAddresses(ADDRESS_KIND.change, taken.number + 1);
    } else if (choice.changeSatoshis !== undefined) {
      await this.makeAddresses(ADDRESS_KIND.change, changeNumber + 1);
    } else if ('number' in taken) {
      // No change after all: the number was never shown and nothing was signed for it.
      this.store({ allocation: returnNumber(taken.allocation, ADDRESS_KIND.change, taken.number) });
    }
    const chosen = choice.coins.map(({ utxo }) => own.find((coin) => coin.utxo === utxo) as AccountCoin);
    const prepared = await this.prepareTransaction({
      template: 'actions',
      action: 'pay',
      role: 'owner',
      inputs: [...moving, ...chosen].map((coin) => ({ coin })),
      outputs: [...outputs, ...(choice.changeSatoshis === undefined ? [] : [{ lockingBytecode: changeAddress.lockingBytecode, valueSatoshis: choice.changeSatoshis }])],
    });
    await this.sendPrepared(prepared);
    return { transactionId: prepared.transactionId, bytes: prepared.bytes, feeSatoshis: prepared.feeSatoshis, remainderSatoshis: choice.remainderSatoshis };
  }

  /** Send a coin that carries a token on, token unchanged, with the smallest value its new output may hold. */
  async sendToken(coin: AccountCoin, toLockingBytecode: Uint8Array): Promise<Sent> {
    const { token } = coin.utxo.output;
    if (token === undefined) throw new Error('This coin carries no token.');
    const output = { lockingBytecode: toLockingBytecode, valueSatoshis: 0n, token };
    return this.pay([{ ...output, valueSatoshis: smallestOutputValue(output) }], [coin]);
  }

  /** Put a coin aside that pays for one cancellation, when the wallet holds none. */
  async setAsideCancellingCoin(): Promise<Sent | undefined> {
    this.requireCreated();
    if (await this.canCancel()) return undefined;
    const number = this.state.cancelCoinNumber ?? (await this.giveOut(ADDRESS_KIND.change)).address.number;
    this.store({ cancelCoinNumber: number });
    return this.pay([{ lockingBytecode: this.address(ADDRESS_KIND.change, number).lockingBytecode, valueSatoshis: this.cancellationCost() }]);
  }

  /** Cancel a pending request: the owner approves, and the coin kept for this pays the fee. */
  async cancel(): Promise<Sent> {
    this.requireCreated();
    const { coin, state } = await this.controllerCoin();
    const { cancelling } = await this.sorted();
    const [payer] = cancelling;
    if (payer === undefined) throw new Error('The wallet holds no coin for cancelling. It cannot cancel until that coin is restored.');
    const next = afterOwnerAuthorize(state);
    const prepared = await this.prepareTransaction({
      template: 'controller',
      action: 'approve',
      role: 'owner',
      variables: { identity: hex(this.identity), nextState: hex(encodeControllerState(next)) },
      inputs: [{ coin, inputIdentifier: 'approveInput' }, { coin: payer }],
      outputs: [{ outputIdentifier: 'controllerOutput' }],
    });
    await this.sendPrepared(prepared);
    return { transactionId: prepared.transactionId, bytes: prepared.bytes, feeSatoshis: prepared.feeSatoshis, remainderSatoshis: prepared.feeSatoshis - requiredFee(prepared.bytes, this.feeRate) };
  }

  /**
   * Change the wallet's settings (proposal section 5.6): the owner key, the recoverer or the waiting period,
   * with the owner's signature alone and at once. Any pending request is cleared. A coin of the wallet pays
   * the fee, and its change returns to a change address.
   *
   * The preparation around a change (the recoverer's receipt before a new seed or a new recoverer takes
   * effect, section 9.7) is the caller's: the contract cannot require it.
   */
  async changeSettings(update: ControllerUpdate): Promise<Sent> {
    this.requireCreated();
    const { coin, state } = await this.controllerCoin();
    const next = afterOwnerUpdate(state, update);
    const delay = encodeChallengeDelay(next.challengeDelay);
    const { own } = await this.sorted();
    const taken = takeNumber(this.state.allocation, ADDRESS_KIND.change);
    const changeNumber = 'number' in taken ? taken.number : taken.refused.offer;
    const changeAddress = this.address(ADDRESS_KIND.change, changeNumber);
    const choice = chooseCoins({
      available: own.map((other) => spendable(other, INPUT_BYTES.byKey)),
      fixedInputs: [{ utxo: coin.utxo, inputBytes: INPUT_BYTES.controllerUpdate }],
      outputs: [this.controllerOutput(next)],
      changeLockingBytecode: changeAddress.lockingBytecode,
      feeRate: this.feeRate,
    });
    if (choice.changeSatoshis !== undefined && 'number' in taken) this.store({ allocation: keepNumber(taken.allocation, ADDRESS_KIND.change, taken.number) });
    else if ('number' in taken) this.store({ allocation: returnNumber(taken.allocation, ADDRESS_KIND.change, taken.number) });
    if (choice.changeSatoshis !== undefined) await this.makeAddresses(ADDRESS_KIND.change, changeNumber + 1);
    const payers = choice.coins.map(({ utxo }) => own.find((other) => other.utxo === utxo) as AccountCoin);
    const prepared = await this.prepareTransaction({
      template: 'controller',
      action: 'changeSettings',
      role: 'owner',
      variables: {
        identity: hex(this.identity),
        nextState: hex(encodeControllerState(next)),
        newOwnerKeyHash: hex(next.ownerKeyHash),
        newRecovererKeyHash: hex(next.recovererKeyHash),
        newDelay: hex(Uint8Array.of(delay & 0xff, (delay >> 8) & 0xff, (delay >> 16) & 0xff)),
      },
      inputs: [{ coin, inputIdentifier: 'changeSettingsInput' }, ...payers.map((other) => ({ coin: other }))],
      outputs: [{ outputIdentifier: 'controllerOutput' }, ...(choice.changeSatoshis === undefined ? [] : [{ lockingBytecode: changeAddress.lockingBytecode, valueSatoshis: choice.changeSatoshis }])],
    });
    await this.sendPrepared(prepared);
    return { transactionId: prepared.transactionId, bytes: prepared.bytes, feeSatoshis: prepared.feeSatoshis, remainderSatoshis: choice.remainderSatoshis };
  }

  // ---------------------------------------------------------------- finding and sweeping

  private searchProgress: WalletSearch['seeds'] | undefined;

  /**
   * Search for the wallet's coins over every seed it has had (proposal section 7.7), and take account of
   * what is found: used addresses of this seed move its windows on, and used addresses of earlier seeds are
   * made known to the key holder so that their coins can be swept. A search that was interrupted continues
   * where it stopped.
   *
   * The wallet is fully found only after the full pass has finished for every seed. An earlier seed whose
   * viewing key the device was not given makes the result incomplete, and the device says so.
   */
  async search(options: { passes?: ('quick' | 'full')[]; batchSize?: number } = {}): Promise<WalletSearch> {
    const history = await readControllerHistory(this.chain, this.identity);
    const earlier = this.state.earlierSeeds ?? [];
    // Every earlier owner the chain shows had a seed of its own.
    const unknown = Math.max(0, history.owners.length - 1 - earlier.length);
    const seeds: SeedView[] = [
      ...Array.from({ length: unknown }, (_, index) => ({ label: unknown === 1 ? 'an earlier seed' : `earlier seed ${index + 1} of ${unknown} without a viewing key`, missing: true as const })),
      ...earlier.map((stored) => ({ label: stored.label, viewingKey: viewingKeyOf(stored) })),
      { label: 'the current seed', viewingKey: this.seed.viewingKey },
    ];
    const result = await searchWallet(this.chain, this.identity, seeds, {
      ...(options.passes === undefined ? {} : { passes: options.passes }),
      ...(options.batchSize === undefined ? {} : { batchSize: options.batchSize }),
      // A pass that finished is run afresh, since coins may have arrived; one that was interrupted continues.
      ...(this.searchProgress === undefined
        ? {}
        : {
            resume: this.searchProgress.map((entry) => ({
              label: entry.label,
              ...(entry.quick?.status === 'incomplete' ? { quick: entry.quick } : {}),
              ...(entry.full?.status === 'incomplete' ? { full: entry.full } : {}),
            })),
          }),
    });
    this.searchProgress = result.seeds;

    let allocation = this.state.allocation;
    const earlierFound = [...(this.state.earlierFound ?? [])];
    for (const entry of result.seeds) {
      const seedIndex = earlier.findIndex((stored) => stored.label === entry.label);
      for (const found of [...(entry.quick?.found ?? []), ...(entry.full?.found ?? [])]) {
        const { kind, number } = found.address;
        if (entry.label === 'the current seed') allocation = markUsed(allocation, kind, number);
        else if (seedIndex >= 0 && !earlierFound.some((known) => known.seed === seedIndex && known.kind === kind && known.number === number)) earlierFound.push({ seed: seedIndex, kind, number });
      }
    }
    // A full pass that has finished for every seed stays finished; a later quick pass does not undo it.
    this.store({ allocation, earlierFound, fullySearched: result.status === 'fully-found' || (this.state.fullySearched && result.status !== 'incomplete') });
    // A device that opens the wallet again from its words does not remember which coin was put aside for
    // cancelling. A coin of exactly that value at one of this seed's change addresses is that coin.
    if (this.state.cancelCoinNumber === undefined) {
      const cost = this.cancellationCost();
      const current = result.seeds.find((entry) => entry.label === 'the current seed');
      const kept = [...(current?.quick?.found ?? []), ...(current?.full?.found ?? [])].find(
        (found) => found.address.kind === ADDRESS_KIND.change && found.coins.some((coin) => coin.utxo.output.valueSatoshis === cost && coin.utxo.output.token === undefined),
      );
      if (kept !== undefined) this.store({ cancelCoinNumber: kept.address.number });
    }
    await this.makeKnown();
    return result;
  }

  /**
   * Sweep what is at earlier seeds' addresses to addresses of this seed (proposal section 11.2): one
   * transaction, or several, each with the controller approving. Tokens are carried over unchanged. What a
   * token means is not known here; a token may give authority over a position worth far more than its
   * coin, so coins with tokens go first, then the largest coins. A sweep also cancels a pending request.
   *
   * It can be repeated: what was swept is gone from the earlier addresses, and what is left is found again.
   *
   * @param options.maximumCoins - how many coins one transaction carries at most, besides what its size allows
   * @param options.maximumTransactions - stop after this many transactions; the rest is swept by the next call
   */
  async sweepEarlier(options: { maximumCoins?: number; maximumTransactions?: number } = {}): Promise<Swept> {
    this.requireCreated();
    const swept: Swept = { transactions: [], coins: 0, tokens: [] };
    for (;;) {
      const { own, earlier, cancelling } = await this.sorted();
      if (earlier.length === 0) return swept;
      // A device that has just taken the wallet over holds no coin for cancelling. The sweep puts one aside
      // (section 11.1, step 9) as one more output, when what it carries pays for it.
      let aside: Output | undefined;
      if (cancelling.length === 0) {
        const asideNumber = this.state.cancelCoinNumber ?? (await this.giveOut(ADDRESS_KIND.change)).address.number;
        if (this.state.cancelCoinNumber === undefined) this.store({ cancelCoinNumber: asideNumber });
        aside = { lockingBytecode: this.address(ADDRESS_KIND.change, asideNumber).lockingBytecode, valueSatoshis: this.cancellationCost() };
      }
      const ordered = [...earlier].sort((a, b) => {
        if (tokenFree(a) !== tokenFree(b)) return tokenFree(a) ? 1 : -1;
        return a.utxo.output.valueSatoshis > b.utxo.output.valueSatoshis ? -1 : 1;
      });
      const { coin: controller, state } = await this.controllerCoin();
      const next = afterOwnerAuthorize(state);
      const taken = takeNumber(this.state.allocation, ADDRESS_KIND.change);
      const number = 'number' in taken ? taken.number : taken.refused.offer;
      if ('number' in taken) this.store({ allocation: keepNumber(taken.allocation, ADDRESS_KIND.change, taken.number) });
      await this.makeAddresses(ADDRESS_KIND.change, number + 1);
      const destination = this.address(ADDRESS_KIND.change, number).lockingBytecode;

      // As many coins as one transaction holds.
      const inputBytesOf = (coin: AccountCoin): number => (this.earlier.get(hex(coin.utxo.output.lockingBytecode))?.kind === ADDRESS_KIND.vault ? INPUT_BYTES.vault : INPUT_BYTES.swept);
      const tokenOutput = (coin: AccountCoin): Output => {
        const output = { lockingBytecode: destination, valueSatoshis: 0n, token: coin.utxo.output.token as NonNullable<Output['token']> };
        const smallest = smallestOutputValue(output);
        return { ...output, valueSatoshis: coin.utxo.output.valueSatoshis > smallest ? coin.utxo.output.valueSatoshis : smallest };
      };
      const part: AccountCoin[] = [];
      const outputsFor = (coins: AccountCoin[]): Output[] => [this.controllerOutput(next), ...coins.filter((coin) => !tokenFree(coin)).map(tokenOutput), ...(aside === undefined ? [] : [aside])];
      for (const coin of ordered) {
        const candidate = [...part, coin];
        const bytes = transactionBytes([INPUT_BYTES.controller, ...candidate.map(inputBytesOf)], [...outputsFor(candidate), { lockingBytecode: destination, valueSatoshis: 0n }]);
        if (part.length > 0 && (bytes > LARGEST_TRANSACTION_BYTES || part.length >= (options.maximumCoins ?? Number.MAX_SAFE_INTEGER))) break;
        part.push(coin);
      }
      // The fee comes from the swept coins. A wallet that holds only tokens there pays it from a coin of this seed.
      const choose = (): ReturnType<typeof chooseCoins> =>
        chooseCoins({
          available: own.map((coin) => spendable(coin, INPUT_BYTES.byKey)),
          fixedInputs: [{ utxo: controller.utxo, inputBytes: INPUT_BYTES.controller }, ...part.map((coin) => ({ utxo: coin.utxo, inputBytes: inputBytesOf(coin) }))],
          outputs: outputsFor(part),
          changeLockingBytecode: destination,
          feeRate: this.feeRate,
        });
      let choice: ReturnType<typeof chooseCoins> | undefined;
      while (choice === undefined) {
        try {
          choice = choose();
        } catch (error) {
          // Coins with tokens alone cannot pay: the largest swept coin without a token joins them. When
          // nothing more can join, the coin for cancelling is left for later.
          const payer = ordered.find((coin) => tokenFree(coin) && !part.includes(coin));
          if (!(error instanceof InsufficientFundsError) || (payer === undefined && aside === undefined)) throw error;
          if (payer === undefined) aside = undefined;
          else part.push(payer);
        }
      }
      const payers = choice.coins.map(({ utxo }) => own.find((coin) => coin.utxo === utxo) as AccountCoin);
      const prepared = await this.prepareTransaction({
        template: 'controller',
        action: 'approve',
        role: 'owner',
        variables: { identity: hex(this.identity), nextState: hex(encodeControllerState(next)) },
        inputs: [{ coin: controller, inputIdentifier: 'approveInput' }, ...part.map((coin) => ({ coin })), ...payers.map((coin) => ({ coin }))],
        outputs: [{ outputIdentifier: 'controllerOutput' }, ...outputsFor(part).slice(1), ...(choice.changeSatoshis === undefined ? [] : [{ lockingBytecode: destination, valueSatoshis: choice.changeSatoshis }])],
      });
      await this.sendPrepared(prepared);
      swept.transactions.push({ transactionId: prepared.transactionId, bytes: prepared.bytes, feeSatoshis: prepared.feeSatoshis, remainderSatoshis: choice.remainderSatoshis });
      swept.coins += part.length;
      for (const coin of part) if (coin.utxo.output.token !== undefined) swept.tokens.push({ category: hex(coin.utxo.output.token.category), meaning: 'unknown' });
      if (options.maximumTransactions !== undefined && swept.transactions.length >= options.maximumTransactions) return swept;
    }
  }

  /**
   * Check who owns the wallet, as the chain shows it. When a key this device does not hold is the owner, and
   * that is confirmed, the wallet stops giving out addresses and taking on actions (proposal section 17).
   *
   * @param settled - whether what the servers say may be taken as settled: more than one server was asked and none disagreed
   */
  async checkOwnership(settled = true): Promise<'this device' | 'another key' | 'closed'> {
    const history = await readControllerHistory(this.chain, this.identity);
    if (history.closed !== undefined) return 'closed';
    const key = await this.backend.controllerKey('owner');
    if (hex(history.current.state.ownerKeyHash) === hex(key.keyHash)) {
      if (this.state.ownedElsewhere === true) this.store({ ownedElsewhere: false });
      return 'this device';
    }
    if (settled && history.currentConfirmed) this.store({ ownedElsewhere: true });
    return 'another key';
  }

  /**
   * Move out every coin this device's keys still spend, to an address outside the wallet: for an owner whose
   * wallet has gone to another key against their will. This is a race against the new owner's sweep. Coins
   * at vault addresses cannot be moved this way, and nothing is offered for them.
   */
  async moveOut(toLockingBytecode: Uint8Array): Promise<SentEverything> {
    const { own, cancelling } = await this.sorted();
    const destination = { lockingBytecode: toLockingBytecode, valueSatoshis: 0n };
    const plan = planSendEverything({ coins: [...own, ...cancelling].map((coin) => spendable(coin, INPUT_BYTES.byKey)), destination, feeRate: this.feeRate });
    const transactions: Sent[] = [];
    for (const part of plan.parts) {
      const prepared = await this.prepareTransaction({ template: 'actions', action: 'pay', role: 'owner', inputs: part.coins.map((entry) => ({ coin: (entry as ReturnType<typeof spendable>).coin })), outputs: [{ ...destination, valueSatoshis: part.sentSatoshis }] });
      await this.sendPrepared(prepared);
      transactions.push({ transactionId: prepared.transactionId, bytes: prepared.bytes, feeSatoshis: prepared.feeSatoshis, remainderSatoshis: 0n });
    }
    return { transactions, sentSatoshis: plan.sentSatoshis, feeSatoshis: plan.feeSatoshis, leftOut: plan.leftOut.map((entry) => (entry as ReturnType<typeof spendable>).coin) };
  }

  // ---------------------------------------------------------------- sending everything, closing

  /**
   * Send every coin without a token to one address: no change, the exact fee, the coin for cancelling
   * included. Coins that only the controller can move go with the controller, which keeps its value.
   * Coins with tokens stay where they are. Afterwards the wallet cannot cancel until it holds a coin again.
   *
   * @throws InsufficientFundsError, with the figures, when what is left after the fee is below what the receiving output must hold
   */
  async sendEverything(toLockingBytecode: Uint8Array): Promise<SentEverything> {
    this.requireCreated();
    const sorted = await this.sorted();
    const { own, cancelling } = sorted;
    // Coins that only the controller releases: at vault addresses, and at earlier seeds' addresses not yet swept.
    const unswept = sorted.earlier.filter(tokenFree);
    const vault = [...sorted.vault, ...unswept];
    const boundBytes = (coin: AccountCoin): number => (unswept.includes(coin) && this.earlier.get(hex(coin.utxo.output.lockingBytecode))?.kind !== ADDRESS_KIND.vault ? INPUT_BYTES.swept : INPUT_BYTES.vault);
    const destination = { lockingBytecode: toLockingBytecode, valueSatoshis: 0n };
    const byKey = [...own, ...cancelling].map((coin) => spendable(coin, INPUT_BYTES.byKey));
    const transactions: Sent[] = [];
    const leftOut: AccountCoin[] = [];
    let sentSatoshis = 0n;

    const send = async (coins: AccountCoin[], withController: boolean, sent: bigint): Promise<void> => {
      let prepared;
      if (withController) {
        const { coin, state } = await this.controllerCoin();
        prepared = await this.prepareTransaction({
          template: 'controller',
          action: 'approve',
          role: 'owner',
          variables: { identity: hex(this.identity), nextState: hex(encodeControllerState(afterOwnerAuthorize(state))) },
          inputs: [{ coin, inputIdentifier: 'approveInput' }, ...coins.map((other) => ({ coin: other }))],
          outputs: [{ outputIdentifier: 'controllerOutput' }, { ...destination, valueSatoshis: sent }],
        });
      } else {
        prepared = await this.prepareTransaction({ template: 'actions', action: 'pay', role: 'owner', inputs: coins.map((coin) => ({ coin })), outputs: [{ ...destination, valueSatoshis: sent }] });
      }
      await this.sendPrepared(prepared);
      transactions.push({ transactionId: prepared.transactionId, bytes: prepared.bytes, feeSatoshis: prepared.feeSatoshis, remainderSatoshis: 0n });
      sentSatoshis += sent;
    };

    let remaining = byKey;
    if (vault.length > 0) {
      // One transaction with the controller carries the coins that need it, and as many others as it holds.
      const { coin: controller, state } = await this.controllerCoin();
      const plan = planSendEverything({
        coins: [...vault.map((coin) => spendable(coin, boundBytes(coin))), ...byKey],
        destination,
        fixedInputs: [{ utxo: controller.utxo, inputBytes: INPUT_BYTES.controller }],
        fixedOutputs: [this.controllerOutput(afterOwnerAuthorize(state))],
        feeRate: this.feeRate,
      });
      const [first] = plan.parts;
      if (first === undefined) throw new Error('Nothing to send.');
      const inFirst = first.coins.map((entry) => (entry as ReturnType<typeof spendable>).coin);
      if (vault.some((coin) => !inFirst.includes(coin))) throw new Error('The vault coins do not fit one transaction with the controller.');
      await send(inFirst, true, first.sentSatoshis);
      remaining = byKey.filter((entry) => !inFirst.includes(entry.coin));
      leftOut.push(...plan.leftOut.filter((entry) => !byKey.includes(entry as (typeof byKey)[number])).map((entry) => (entry as ReturnType<typeof spendable>).coin));
    }
    if (remaining.length > 0) {
      const plan = planSendEverything({ coins: remaining, destination, feeRate: this.feeRate });
      for (const part of plan.parts) await send(part.coins.map((entry) => (entry as ReturnType<typeof spendable>).coin), false, part.sentSatoshis);
      leftOut.push(...plan.leftOut.map((entry) => (entry as ReturnType<typeof spendable>).coin));
    } else if (vault.length === 0) {
      throw new InsufficientFundsError(0n, 0n, smallestOutputValue(destination), 'the wallet holds no coin without a token.');
    }
    return { transactions, sentSatoshis, feeSatoshis: transactions.reduce((sum, sent) => sum + sent.feeSatoshis, 0n), leftOut };
  }

  /** What stands in the way of closing the wallet, if anything. */
  async closingObstacles(): Promise<string[]> {
    const { vault, earlier, tokens } = await this.sorted();
    const reasons: string[] = [];
    if (vault.length > 0) reasons.push('A coin is at a vault address; after closing nobody could spend it.');
    if (earlier.length > 0) reasons.push('A coin is at an earlier seed\'s address and has not been swept; after closing only that seed could spend it.');
    if (tokens.length > 0) reasons.push('The wallet holds a token; a token may give authority over a position.');
    if (!this.state.fullySearched) reasons.push('The full search has not finished for every seed; a coin that only the controller can move may not have been found yet.');
    return reasons;
  }

  /**
   * Send everything and close the wallet (proposal section 5.8): the controller's value goes with the
   * wallet's last coins to one address, and the identity ends. Vault addresses cannot be spent from
   * afterwards and there is no recovery. Not offered in the wallet's ordinary interface.
   *
   * @throws CannotCloseError while a vault coin or a token is held, or before the full search has finished
   */
  async close(toLockingBytecode: Uint8Array): Promise<SentEverything> {
    this.requireCreated();
    const reasons = await this.closingObstacles();
    if (reasons.length > 0) throw new CannotCloseError(reasons);
    const { own, cancelling } = await this.sorted();
    const { coin: controller } = await this.controllerCoin();
    const destination = { lockingBytecode: toLockingBytecode, valueSatoshis: 0n };
    const coins = [...own, ...cancelling].map((coin) => spendable(coin, INPUT_BYTES.byKey));
    const plan = planSendEverything({ coins, destination, fixedInputs: [{ utxo: controller.utxo, inputBytes: INPUT_BYTES.controller }], feeRate: this.feeRate });
    if (plan.parts.length !== 1) {
      // More coins than one transaction holds: the others go first, and the wallet is closed with what is left.
      const [last] = plan.parts.slice(-1);
      const before = coins.filter((entry) => !last?.coins.includes(entry)).map((entry) => entry.coin);
      const earlier = planSendEverything({ coins: before.map((coin) => spendable(coin, INPUT_BYTES.byKey)), destination, feeRate: this.feeRate });
      const transactions: Sent[] = [];
      for (const part of earlier.parts) {
        const prepared = await this.prepareTransaction({ template: 'actions', action: 'pay', role: 'owner', inputs: part.coins.map((entry) => ({ coin: (entry as ReturnType<typeof spendable>).coin })), outputs: [{ ...destination, valueSatoshis: part.sentSatoshis }] });
        await this.sendPrepared(prepared);
        transactions.push({ transactionId: prepared.transactionId, bytes: prepared.bytes, feeSatoshis: prepared.feeSatoshis, remainderSatoshis: 0n });
      }
      const closing = await this.close(toLockingBytecode);
      return { transactions: [...transactions, ...closing.transactions], sentSatoshis: earlier.sentSatoshis + closing.sentSatoshis, feeSatoshis: earlier.feeSatoshis + closing.feeSatoshis, leftOut: closing.leftOut };
    }
    const [part] = plan.parts as [(typeof plan.parts)[number]];
    const prepared = await this.prepareTransaction({
      template: 'controller',
      action: 'close',
      role: 'owner',
      variables: { identity: hex(this.identity) },
      inputs: [{ coin: controller, inputIdentifier: 'closeInput' }, ...part.coins.map((entry) => ({ coin: (entry as ReturnType<typeof spendable>).coin }))],
      outputs: [{ ...destination, valueSatoshis: part.sentSatoshis }],
    });
    await this.sendPrepared(prepared);
    return {
      transactions: [{ transactionId: prepared.transactionId, bytes: prepared.bytes, feeSatoshis: prepared.feeSatoshis, remainderSatoshis: 0n }],
      sentSatoshis: part.sentSatoshis,
      feeSatoshis: prepared.feeSatoshis,
      leftOut: plan.leftOut.map((entry) => (entry as ReturnType<typeof spendable>).coin),
    };
  }

  /** Whether the owner has closed the wallet, as the chain shows it. */
  async closed(): Promise<boolean> {
    return (await readControllerHistory(this.chain, this.identity)).closed !== undefined;
  }

  /** The code that searches reports that a full pass has finished for every seed. */
  noteFullySearched(done: boolean): void {
    this.store({ fullySearched: done });
  }

  /** The code that reads receipts reports whether the recoverer has confirmed. */
  noteRecoveryConfirmed(confirmed: boolean): void {
    this.store({ recoveryConfirmed: confirmed });
  }

  /** The user has moved on to a wallet with another identity (section 18.3), for example one with newer controller rules. */
  noteMovedTo(identity: string): void {
    this.store({ movedToIdentity: identity });
  }

  /**
   * Where this identity stands (section 18.3). An identity the user has moved on from is kept, not retired:
   * a vault address that was published, or a payout address stored in a contract, goes on being paid, and
   * only this identity's controller releases what arrives there. So it stays watched and recoverable, and a
   * change of owner or of recoverer is made on it as on the new one. A balance of zero changes nothing.
   * Only closing ends an identity, and that is for when nothing can arrive any more.
   */
  async standing(): Promise<{ state: 'in use' | 'kept' | 'closed'; watched: boolean; recovery: 'on' | 'off'; movedTo?: string; note?: string }> {
    if (await this.closed()) return { state: 'closed', watched: false, recovery: 'off', note: 'This wallet was closed. What arrives at its vault addresses from now on cannot be spent.' };
    const { movedToIdentity } = this.state;
    if (movedToIdentity === undefined) return { state: 'in use', watched: true, recovery: this.recovery };
    return {
      state: 'kept',
      watched: true,
      recovery: this.recovery,
      movedTo: movedToIdentity,
      note: 'Payments can still arrive at this wallet\'s addresses, and only its own controller releases what arrives at its vault addresses. It stays watched and recoverable, whatever it holds.',
    };
  }

  /** What the device stores. */
  get stored(): OwnerWalletState {
    return this.state;
  }
}

export { sameCoin };
