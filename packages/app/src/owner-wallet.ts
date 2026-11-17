import { type Output, binToHex, decodeTransactionBch, hexToBin } from '@bitauth/libauth';
import {
  type AccountCoin,
  type Allocation,
  type ChainReader,
  type ChallengeDelay,
  type ControllerState,
  type KeyedAddressKind,
  type SeedKeys,
  type SpendableCoin,
  type WalletAddress,
  type WalletBackend,
  ADDRESS_KIND,
  INPUT_BYTES,
  InsufficientFundsError,
  afterOwnerAuthorize,
  chooseCoins,
  controllerScript,
  decodeControllerState,
  emptyAllocation,
  encodeControllerState,
  keepNumber,
  markUsed,
  planSendEverything,
  readControllerHistory,
  requiredFee,
  returnNumber,
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
    return (await this.backend.coins()).filter((coin) => coin.template === 'coins' && tokenFree(coin));
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
   * Where the creation stands, read from the chain. A transaction of the creation that is no longer there
   * (replaced, or in a block that was undone) is forgotten, which is safe: no address is given out before
   * both are confirmed.
   */
  async creationStep(): Promise<CreationStep> {
    const { creation } = this.state;
    const funding = await this.fundingAddress();
    if (this.state.identity !== undefined && !creation.confirmed) {
      const definedIn = await this.seen(this.state.identity, funding);
      const createdIn = creation.createTransactionId === undefined ? 'missing' : await this.seen(creation.createTransactionId, controllerScript(this.identity).lockingBytecode);
      if (definedIn === 'missing') {
        // The transaction that defined the identity is gone, and the identity with it.
        this.store({ creation: { confirmed: false }, allocation: emptyAllocation() });
        const { identity: _gone, cancelCoinNumber: _coin, firstCoinNumber: _first, ...rest } = this.state;
        this.state = rest;
        this.save(this.state);
      } else if (createdIn === 'missing' && creation.createTransactionId !== undefined) {
        const { createTransactionId: _gone, ...rest } = creation;
        this.store({ creation: rest });
      } else if (definedIn === 'confirmed' && createdIn === 'confirmed') {
        this.store({ creation: { ...creation, confirmed: true } });
      }
    }
    if (this.state.creation.confirmed) return 'confirmed';
    if (this.state.creation.createTransactionId !== undefined) return 'created';
    if (this.state.identity !== undefined) return 'prepared';
    return (await this.fundingCoins()).length > 0 ? 'funded' : 'not funded';
  }

  /**
   * Create the wallet, or continue creating it (proposal section 7.9). Each call does what is still to be
   * done and can be repeated after an interruption; it never starts a second identity.
   *
   * @returns where the creation stands afterwards
   */
  async create(options: CreateOptions): Promise<CreationStep> {
    let step = await this.creationStep();
    if (step === 'not funded') throw new Error('The funding address holds no coin yet.');

    if (step === 'funded') {
      const coins = await this.fundingCoins();
      // A token category is the transaction whose output 0 is spent: the wallet needs a coin that is output 0.
      const first = coins.find((coin) => coin.utxo.index === 0);
      if (first !== undefined) {
        this.store({ identity: hex(first.utxo.transactionHash) });
      } else {
        const funding = await this.fundingAddress();
        const inputs = coins.map((coin) => ({ coin }));
        const bytes = transactionBytes(coins.map(() => INPUT_BYTES.p2pkh), [{ lockingBytecode: funding, valueSatoshis: 0n }]);
        const prepared = await this.backend.prepare({
          template: 'actions',
          action: 'pay',
          role: 'owner',
          inputs,
          outputs: [{ lockingBytecode: funding, valueSatoshis: valueOf(coins) - requiredFee(bytes, this.feeRate) }],
        });
        // The identity is recorded before the transaction that defines it is sent.
        this.store({ identity: prepared.transactionId, creation: { prepareTransactionId: prepared.transactionId, confirmed: false } });
        await this.backend.send(prepared);
      }
      step = 'prepared';
    }

    if (step === 'prepared') {
      const identity = this.identity;
      const coin = await this.waitForCoin(async () => (await this.fundingCoins()).find((candidate) => hex(candidate.utxo.transactionHash) === this.state.identity && candidate.utxo.index === 0));
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
      const prepared = await this.backend.prepare({
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
      this.store({ creation: { ...this.state.creation, createTransactionId: prepared.transactionId, confirmed: false } });
      await this.backend.send(prepared);
      await this.backend.knowController(identity, 'owner');
      step = 'created';
    }
    return step === 'created' ? this.creationStep() : step;
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
    const coin = await this.waitForCoin(async () => (await this.backend.coins()).find((candidate) => hex(candidate.utxo.output.lockingBytecode) === locking && candidate.utxo.output.token !== undefined));
    const commitment = coin.utxo.output.token?.nft?.commitment;
    if (commitment === undefined) throw new Error('The controller carries no state.');
    return { coin, state: decodeControllerState(commitment) };
  }

  /** The wallet's coins by where they are. */
  private async sorted(): Promise<{ own: AccountCoin[]; cancelling: AccountCoin[]; vault: AccountCoin[]; funding: AccountCoin[]; tokens: AccountCoin[] }> {
    const coins = await this.backend.coins();
    const cancelAt = this.state.cancelCoinNumber === undefined || this.state.identity === undefined ? undefined : hex(this.address(ADDRESS_KIND.change, this.state.cancelCoinNumber).lockingBytecode);
    const controllerAt = this.state.identity === undefined ? undefined : hex(controllerScript(this.identity).lockingBytecode);
    const atAddress = coins.filter((coin) => hex(coin.utxo.output.lockingBytecode) !== controllerAt && coin.template !== 'coins');
    const keyed = atAddress.filter((coin) => coin.template === 'givenOut' || coin.template === 'change');
    // The coin for cancelling is the one the wallet put aside; anything else that arrives at its address is an ordinary coin.
    const cancelling = keyed.filter((coin) => tokenFree(coin) && hex(coin.utxo.output.lockingBytecode) === cancelAt && coin.utxo.output.valueSatoshis === this.cancellationCost()).slice(0, 1);
    return {
      own: keyed.filter((coin) => tokenFree(coin) && !cancelling.includes(coin)),
      cancelling,
      vault: atAddress.filter((coin) => coin.template === 'actions' && tokenFree(coin)),
      funding: coins.filter((coin) => coin.template === 'coins' && tokenFree(coin)),
      tokens: atAddress.filter((coin) => !tokenFree(coin)),
    };
  }

  async balance(): Promise<Balance> {
    const { own, cancelling, vault, funding, tokens } = await this.sorted();
    return { recoverable: valueOf(own), cancelling: valueOf(cancelling), vault: valueOf(vault), notRecoverable: this.state.creation.confirmed ? valueOf(funding) : 0n, tokens };
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
    const prepared = await this.backend.prepare({
      template: 'actions',
      action: 'pay',
      role: 'owner',
      inputs: [...moving, ...chosen].map((coin) => ({ coin })),
      outputs: [...outputs, ...(choice.changeSatoshis === undefined ? [] : [{ lockingBytecode: changeAddress.lockingBytecode, valueSatoshis: choice.changeSatoshis }])],
    });
    await this.backend.send(prepared);
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
    const prepared = await this.backend.prepare({
      template: 'controller',
      action: 'approve',
      role: 'owner',
      variables: { identity: hex(this.identity), nextState: hex(encodeControllerState(next)) },
      inputs: [{ coin, inputIdentifier: 'approveInput' }, { coin: payer }],
      outputs: [{ outputIdentifier: 'controllerOutput' }],
    });
    await this.backend.send(prepared);
    return { transactionId: prepared.transactionId, bytes: prepared.bytes, feeSatoshis: prepared.feeSatoshis, remainderSatoshis: prepared.feeSatoshis - requiredFee(prepared.bytes, this.feeRate) };
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
    const { own, cancelling, vault } = await this.sorted();
    const destination = { lockingBytecode: toLockingBytecode, valueSatoshis: 0n };
    const byKey = [...own, ...cancelling].map((coin) => spendable(coin, INPUT_BYTES.byKey));
    const transactions: Sent[] = [];
    const leftOut: AccountCoin[] = [];
    let sentSatoshis = 0n;

    const send = async (coins: AccountCoin[], withController: boolean, sent: bigint): Promise<void> => {
      let prepared;
      if (withController) {
        const { coin, state } = await this.controllerCoin();
        prepared = await this.backend.prepare({
          template: 'controller',
          action: 'approve',
          role: 'owner',
          variables: { identity: hex(this.identity), nextState: hex(encodeControllerState(afterOwnerAuthorize(state))) },
          inputs: [{ coin, inputIdentifier: 'approveInput' }, ...coins.map((other) => ({ coin: other }))],
          outputs: [{ outputIdentifier: 'controllerOutput' }, { ...destination, valueSatoshis: sent }],
        });
      } else {
        prepared = await this.backend.prepare({ template: 'actions', action: 'pay', role: 'owner', inputs: coins.map((coin) => ({ coin })), outputs: [{ ...destination, valueSatoshis: sent }] });
      }
      await this.backend.send(prepared);
      transactions.push({ transactionId: prepared.transactionId, bytes: prepared.bytes, feeSatoshis: prepared.feeSatoshis, remainderSatoshis: 0n });
      sentSatoshis += sent;
    };

    let remaining = byKey;
    if (vault.length > 0) {
      // One transaction with the controller carries the coins that need it, and as many others as it holds.
      const { coin: controller, state } = await this.controllerCoin();
      const plan = planSendEverything({
        coins: [...vault.map((coin) => spendable(coin, INPUT_BYTES.vault)), ...byKey],
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
    const { vault, tokens } = await this.sorted();
    const reasons: string[] = [];
    if (vault.length > 0) reasons.push('A coin is at a vault address; after closing nobody could spend it.');
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
        const prepared = await this.backend.prepare({ template: 'actions', action: 'pay', role: 'owner', inputs: part.coins.map((entry) => ({ coin: (entry as ReturnType<typeof spendable>).coin })), outputs: [{ ...destination, valueSatoshis: part.sentSatoshis }] });
        await this.backend.send(prepared);
        transactions.push({ transactionId: prepared.transactionId, bytes: prepared.bytes, feeSatoshis: prepared.feeSatoshis, remainderSatoshis: 0n });
      }
      const closing = await this.close(toLockingBytecode);
      return { transactions: [...transactions, ...closing.transactions], sentSatoshis: earlier.sentSatoshis + closing.sentSatoshis, feeSatoshis: earlier.feeSatoshis + closing.feeSatoshis, leftOut: closing.leftOut };
    }
    const [part] = plan.parts as [(typeof plan.parts)[number]];
    const prepared = await this.backend.prepare({
      template: 'controller',
      action: 'close',
      role: 'owner',
      variables: { identity: hex(this.identity) },
      inputs: [{ coin: controller, inputIdentifier: 'closeInput' }, ...part.coins.map((entry) => ({ coin: (entry as ReturnType<typeof spendable>).coin }))],
      outputs: [{ ...destination, valueSatoshis: part.sentSatoshis }],
    });
    await this.backend.send(prepared);
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

  /** What the device stores. */
  get stored(): OwnerWalletState {
    return this.state;
  }
}

export { sameCoin };
