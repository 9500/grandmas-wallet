import { type Output, binToHex, decodeTransactionBch, hexToBin } from '@bitauth/libauth';
import {
  type AccountCoin,
  type Allocation,
  type ChainReader,
  type ChallengeDelay,
  type CoinChoice,
  type CoinChoiceRequest,
  type ControllerState,
  type ControllerUpdate,
  type KeyedAddressKind,
  type PreparedTransaction,
  type SeedKeys,
  type SpendableCoin,
  type TransactionRequest,
  type Utxo,
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

import type { ApplicationsState } from './applications.js';

/**
 * The owner's wallet (proposal sections 7.7, 7.9 and 8): creating it, giving out addresses, paying,
 * cancelling a request, sending everything, and closing.
 *
 * The wallet's logic decides which coins a transaction spends and what its outputs are; a backend holds
 * the keys and builds exactly that. What the wallet has to remember is plain data, stored by the device
 * after every step, so that a device that stops continues from where it stopped.
 */

const CONTROLLER_SATOSHIS = 1_000n;
const hex = binToHex;

/** What a device stores about its wallet. */
export interface OwnerWalletState {
  /**
   * The identity, once the transaction that defines it is known. The wallet is in use as soon as the
   * network has the transaction that creates the controller (`creation.createSeen`), in a block or not.
   */
  identity?: string;
  creation: {
    /** The wallet's payment to itself that made a coin that is output 0, when one was needed. */
    prepareTransactionId?: string;
    createTransactionId?: string;
    /**
     * The network has the transaction that defines the identity, or the one that creates the controller: a
     * server accepted it or shows it. A transaction that was seen and is no longer there was replaced or
     * undone; one that was never seen may still be on its way, or may never have been sent.
     */
    identitySeen?: boolean;
    createSeen?: boolean;
    /**
     * Both the transaction that defines the identity and the one that creates the controller are in a
     * block. Nothing waits for this. Until then the wallet watches the two transactions at every check, and
     * if one disappears it makes a new identity (`voided`).
     */
    confirmed: boolean;
  };
  /**
   * Identities this wallet made whose creation the network no longer has: the transaction that defined one,
   * or the one that created its controller, was replaced or undone. Their addresses keep their numbers, stay
   * watched, and are spent by their keys; what arrives there is moved to the current identity's addresses.
   */
  voided?: VoidedIdentity[];
  allocation: Allocation;
  /**
   * Stored by wallets created while a coin was kept apart for cancelling: the change address of that coin.
   * Nothing reads it any more. The coin there is an ordinary coin of the wallet, counted and spent as any other.
   */
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
  /** The chain shows, in a block, that a key this device does not hold owns the wallet. */
  ownedElsewhere?: boolean;
  /**
   * The network shows a key this device does not hold as the owner, not yet in a block. The wallet gives out
   * no address and takes on no action meanwhile; if the change disappears, this clears by itself.
   */
  otherOwnerSeen?: boolean;
  /** The identity the user moved on to (section 18.3). This one is kept: payments can still arrive at its addresses. */
  movedToIdentity?: string;
  /** The templates of applications the user trusted on this device, and notes on the tokens made with them. */
  applications?: ApplicationsState;
}

/** An identity whose creation disappeared, with the numbers of the addresses it gave out of each kind with a key. */
export interface VoidedIdentity {
  identity: string;
  /** From the first number to the one after the last, for addresses given out and for change. */
  givenOut: [number, number];
  change: [number, number];
}

/** An address the wallet sets aside for something that is about to happen. */
export interface ReservedAddress {
  address: WalletAddress;
  /** Whether the number was taken now. Otherwise the window is full and an address given out before is used again. */
  fresh: boolean;
}

/** A coin that carries a token, with where it is. */
export interface TokenCoin {
  coin: AccountCoin;
  /** `address`: at an address of this seed, spent by its key. `vault`: at a vault address. `earlier`: at an address of an earlier seed, to be swept. */
  place: 'address' | 'vault' | 'earlier';
}

/**
 * What the code that carries out actions of other templates works with (`applications.ts`). It is the
 * wallet's own coins, addresses and key holder, with nothing about any template.
 */
export interface WalletParts {
  backend: WalletBackend;
  chain: ChainReader;
  feeRate: number;
  /** @throws when the wallet takes on no action: it is not created yet, or another key owns it */
  requireUsable(): void;
  /** Coins without a token at this seed's addresses. */
  ownCoins(): Promise<AccountCoin[]>;
  tokenCoins(): Promise<TokenCoin[]>;
  /**
   * Set addresses aside, in order, without recording anything: the same call gives the same addresses until
   * one of them is held.
   */
  reserve(kinds: (1 | 2)[]): ReservedAddress[];
  /** Record the addresses as held for an action and make them known to the key holder. */
  hold(reserved: ReservedAddress[]): Promise<void>;
  /** A signature that names the addresses has left the wallet: they stay taken. */
  keep(reserved: ReservedAddress[]): void;
  /** The action did not happen and nothing was signed: the numbers may be handed out again. */
  giveBack(reserved: ReservedAddress[]): void;
  prepare(request: TransactionRequest): Promise<PreparedTransaction>;
  send(prepared: PreparedTransaction): Promise<void>;
  /** Pay the wallet itself, so that it has a coin that is output 0 of its transaction. Returns that coin. */
  payItself(satoshis: bigint): Promise<{ coin: AccountCoin; sent: Sent }>;
  /** What paying itself that amount costs. */
  quotePayItself(satoshis: bigint): Promise<bigint>;
  kept(): ApplicationsState | undefined;
  store(applications: ApplicationsState): void;
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

/**
 * Where creating a wallet stands. `created`: the network has the transaction that creates the controller,
 * and the wallet is in use; it is not waited for in a block.
 */
export type CreationStep = 'not funded' | 'funded' | 'prepared' | 'created';

export interface CreateOptions {
  recovererKeyHash: Uint8Array;
  challengeDelay: ChallengeDelay;
  /** Coins the owner gives the recoverer for its fees, at the recoverer's fee address. Offered, not required. */
  allowance?: { feeLockingBytecode: Uint8Array; satoshis: bigint };
}

export interface Balance {
  /** At the wallet's recoverable addresses. */
  recoverable: bigint;
  /** At vault addresses. */
  vault: bigint;
  /**
   * At the funding address. The funding address is not recoverable: a coin there can be moved only while
   * the seed is at hand.
   */
  notRecoverable: bigint;
  /**
   * At addresses given out under an identity whose creation the network no longer has (`voided`). Their
   * keys spend them and they are the wallet's, but no recovery reaches them; `collectVoided` moves them.
   */
  voided: bigint;
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
/** What a payment will cost, worked out as the wallet will make it and before anything is signed. */
export interface PaymentQuote {
  feeSatoshis: bigint;
  /** What is too small to come back as change and goes to the fee. */
  remainderSatoshis: bigint;
  bytes: number;
  change: boolean;
}

/** What sending everything will deliver, before anything is signed. */
export interface EverythingQuote {
  sentSatoshis: bigint;
  feeSatoshis: bigint;
  bytes: number;
  transactions: number;
  /** Coins that hold no more than it costs to spend them, which stay where they are. */
  leftOut: number;
}

const controllerSized: Output = { lockingBytecode: new Uint8Array(35), valueSatoshis: CONTROLLER_SATOSHIS, token: { amount: 0n, category: new Uint8Array(32), nft: { capability: 'mutable', commitment: new Uint8Array(69) } } };

/**
 * The least a cancellation costs: the fee when the controller and one coin of the wallet are its inputs and
 * nothing is left over. A wallet whose coins hold less than this cannot pay for one.
 */
export const cancellationCost = (feeRate = 1): bigint => requiredFee(transactionBytes([INPUT_BYTES.controller, INPUT_BYTES.byKey], [controllerSized]), feeRate);

/** The least the wallet's first coin may hold: what an output may hold, and enough to pay for refusing a request. */
const leastFirstCoin = (feeRate: number): bigint => {
  const least = smallestOutputValue({ lockingBytecode: new Uint8Array(35), valueSatoshis: 0n });
  const cancelling = cancellationCost(feeRate);
  return cancelling > least ? cancelling : least;
};

/**
 * What the funding address must receive for a wallet to be created (proposal section 7.9): the controller,
 * the allowance if one is given, a first coin of the wallet that pays for one cancellation, and the
 * fees of the creating transaction and of the payment to itself that comes before it when the funding coin
 * is not the first output of its transaction.
 */
export const creationFunding = (options: { allowanceSatoshis?: bigint; feeRate?: number } = {}): bigint => {
  const feeRate = options.feeRate ?? 1;
  const keyed: Output = { lockingBytecode: new Uint8Array(25), valueSatoshis: 0n };
  const own: Output = { lockingBytecode: new Uint8Array(35), valueSatoshis: 0n };
  const outputs = [controllerSized, ...(options.allowanceSatoshis === undefined ? [] : [{ ...keyed, valueSatoshis: options.allowanceSatoshis }]), own];
  const creating = requiredFee(transactionBytes([INPUT_BYTES.p2pkh], outputs), feeRate);
  const toItself = requiredFee(transactionBytes([INPUT_BYTES.p2pkh], [keyed]), feeRate);
  return outputs.reduce((sum, output) => sum + output.valueSatoshis, 0n) + leastFirstCoin(feeRate) + creating + toItself;
};

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
type Payer = ReturnType<typeof spendable>;

/**
 * Choose the coins that pay for a controller transaction. Those coins and their change are in a transaction
 * with the identity for anyone to see (proposal section 16), so the smallest coin that pays alone is taken,
 * and several only when no single coin does.
 *
 * @throws InsufficientFundsError when the coins together do not cover the fee
 */
const choosePayers = (available: Payer[], request: Omit<CoinChoiceRequest, 'available'>): CoinChoice => {
  const smallestFirst = [...available].sort((a, b) => (a.utxo.output.valueSatoshis < b.utxo.output.valueSatoshis ? -1 : a.utxo.output.valueSatoshis > b.utxo.output.valueSatoshis ? 1 : 0));
  for (const single of smallestFirst) {
    try {
      return chooseCoins({ ...request, available: [single] });
    } catch (error) {
      if (!(error instanceof InsufficientFundsError)) throw error;
    }
  }
  return chooseCoins({ ...request, available });
};

/** What a node says when a transaction spends a coin that is already spent. */
const DOUBLE_SPEND = /missingorspent|mempool-conflict|missing.?inputs|inputs.?missing|already.?spent|double.?spen|conflict/i;

export class OwnerWallet {
  /**
   * Coins that transactions of this wallet have spent since it was opened. A key holder may go on listing a
   * coin for a moment after the transaction that spends it was sent; the wallet does not use it again.
   */
  private readonly spent = new Set<string>();
  private readonly preparedInputs = new Map<string, string[]>();
  /** Addresses of earlier seeds that were made known to the key holder, by locking bytecode. */
  private readonly earlier = new Map<string, WalletAddress>();
  /** Addresses of voided identities, by locking bytecode. */
  private readonly voidedAt = new Set<string>();

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
    if (wallet.state.identity !== undefined || (wallet.state.voided?.length ?? 0) > 0) await wallet.makeKnown();
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

  /**
   * The coins the key holder follows, without those this wallet has already spent. A coin is forgotten as
   * spent once the key holder no longer lists it: should the transaction that spent it disappear later, the
   * coin is the wallet's to use again.
   */
  private async coins(): Promise<AccountCoin[]> {
    const listed = await this.backend.coins();
    const places = new Set(listed.map((coin) => `${hex(coin.utxo.transactionHash)}:${coin.utxo.index}`));
    for (const place of this.spent) if (!places.has(place)) this.spent.delete(place);
    return listed.filter((coin) => !this.spent.has(`${hex(coin.utxo.transactionHash)}:${coin.utxo.index}`));
  }

  /** Have the key holder build, sign and check a transaction, and note which coins it spends. */
  private async prepareTransaction(request: TransactionRequest): Promise<PreparedTransaction> {
    const prepared = await this.backend.prepare(request);
    this.preparedInputs.set(prepared.invitationIdentifier, request.inputs.map(({ coin }) => `${hex(coin.utxo.transactionHash)}:${coin.utxo.index}`));
    return prepared;
  }

  /** Send a prepared transaction and remember which coins it spent. */
  private async sendPrepared(prepared: PreparedTransaction): Promise<void> {
    try {
      await this.backend.send(prepared);
    } catch (error) {
      this.preparedInputs.delete(prepared.invitationIdentifier);
      throw error;
    }
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

  /** Where the current identity's numbers start, for a kind with a key: after those of the identities voided before it. */
  private keyedStart(kind: KeyedAddressKind): number {
    const last = this.state.voided?.at(-1);
    return last === undefined ? 0 : (kind === ADDRESS_KIND.givenOut ? last.givenOut : last.change)[1];
  }

  /** Address `number` of a kind with a key, of whichever identity gave that number out. */
  private keyedAddress(kind: KeyedAddressKind, number: number): WalletAddress {
    const owner = this.state.voided?.find((voided) => {
      const [from, to] = kind === ADDRESS_KIND.givenOut ? voided.givenOut : voided.change;
      return number >= from && number < to;
    });
    return walletAddress(owner === undefined ? this.identity : hexToBin(owner.identity), this.seed.viewingKey, kind, number);
  }

  /** Note the addresses of voided identities, so that what is there is told apart from the current identity's coins. */
  private noteVoided(): void {
    for (const voided of this.state.voided ?? []) {
      for (const kind of [ADDRESS_KIND.givenOut, ADDRESS_KIND.change] as const) {
        const [from, to] = kind === ADDRESS_KIND.givenOut ? voided.givenOut : voided.change;
        for (let number = from; number < to; number++) this.voidedAt.add(hex(walletAddress(hexToBin(voided.identity), this.seed.viewingKey, kind, number).lockingBytecode));
      }
    }
  }

  /** Make the controller and every address handed out so far known to the backend, those of voided identities included. */
  private async makeKnown(): Promise<void> {
    this.noteVoided();
    if (this.state.identity !== undefined) await this.backend.knowController(this.identity, 'owner');
    for (const kind of [ADDRESS_KIND.givenOut, ADDRESS_KIND.change] as const) await this.makeAddresses(kind, this.state.identity === undefined ? this.keyedStart(kind) : this.state.allocation[kind].next);
    if (this.state.identity === undefined) return;
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
      const ours = this.keyedAddress(kind, number);
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
    if (entry !== undefined) return entry.height > 0 ? 'confirmed' : 'unconfirmed';
    // A server may list a transaction it has just taken only seconds later (Fulcrum without notifications of new
    // transactions does), while it gives the transaction out at once: one it still gives out is not gone.
    return (await this.chain.getTransaction(transactionId)) === undefined ? 'missing' : 'unconfirmed';
  }

  /**
   * Where the creation stands, read from the chain (proposal section 7.9). Each step goes on as soon as the
   * network has the transaction before it; none waits for a block. Until both the transaction that defines
   * the identity and the one that creates the controller are in a block, every call looks at them again:
   *
   * - The transaction that defines the identity was seen and is gone (replaced, or in a block that was undone
   *   and not mined again): the identity is void, and so is everything built on it. The wallet keeps the
   *   addresses it gave out under it (`voided`) and starts a new identity from the coins it has.
   * - The creating transaction was seen and is gone while the identity's coin is there again: the controller
   *   is made again, for the same identity, so the addresses given out stay the wallet's.
   * - A transaction that was never seen is kept: it may be on its way, or the device stopped before sending it.
   *
   * A look that overlaps `create()` (the page looks every few seconds) may have read the chain before the
   * creation went on: when the creation's record changed while it read, it looks again rather than write back
   * what it read before.
   */
  async creationStep(): Promise<CreationStep> {
    if (this.state.identity !== undefined && !this.state.creation.confirmed) {
      const { identity, creation } = this.state;
      const definedIn = await this.seen(identity, await this.fundingAddress());
      const createdIn = creation.createTransactionId === undefined ? 'missing' : await this.seen(creation.createTransactionId, controllerScript(this.identity).lockingBytecode);
      if (this.state.identity !== identity || this.state.creation !== creation) return this.creationStep();
      if (definedIn === 'missing' && creation.identitySeen === true) {
        this.voidIdentity();
      } else if (createdIn === 'missing' && creation.createSeen === true) {
        // The identity's coin is unspent again; the wallet may spend it once more.
        this.spent.delete(`${this.state.identity}:0`);
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
    if (this.state.identity !== undefined && this.state.creation.createSeen === true) return 'created';
    if (this.state.identity !== undefined) return 'prepared';
    return (await this.creationCoins()).length > 0 ? 'funded' : 'not funded';
  }

  /**
   * The identity is void: the transaction that defined it is gone. Everything built on it is gone with it:
   * the controller and payments made from the wallet's first coins. What others
   * paid to the addresses given out under it is still there and still the wallet's, by key. Those addresses
   * keep their numbers; the next identity's numbers start after them.
   */
  private voidIdentity(): void {
    const { identity, allocation } = this.state;
    if (identity === undefined) return;
    const range = (kind: KeyedAddressKind): [number, number] => [this.keyedStart(kind), Math.max(this.keyedStart(kind), allocation[kind].next)];
    const voided: VoidedIdentity = { identity, givenOut: range(ADDRESS_KIND.givenOut), change: range(ADDRESS_KIND.change) };
    const gaveOut = voided.givenOut[1] > voided.givenOut[0] || voided.change[1] > voided.change[0];
    const all = [...(this.state.voided ?? []), ...(gaveOut ? [voided] : [])];
    // The next identity gives out numbers after those already given; for the window they count as used.
    let next = emptyAllocation();
    for (const kind of [ADDRESS_KIND.givenOut, ADDRESS_KIND.change] as const) {
      const end = all.at(-1)?.[kind === ADDRESS_KIND.givenOut ? 'givenOut' : 'change'][1] ?? 0;
      for (let number = 0; number < end; number++) next = markUsed(next, kind, number);
    }
    const { identity: _gone, cancelCoinNumber: _coin, firstCoinNumber: _first, otherOwnerSeen: _seen, ...rest } = this.state;
    this.state = { ...rest, creation: { confirmed: false }, allocation: next, voided: all, recoveryConfirmed: false, fullySearched: false };
    this.save(this.state);
    this.noteVoided();
    // Coins that the vanished transactions spent are unspent again.
    this.spent.clear();
  }

  /** The identities this wallet made whose creation the network no longer has, oldest first. */
  get voided(): VoidedIdentity[] {
    return this.state.voided ?? [];
  }

  /**
   * The coins a new identity is made from: what is at the funding address, and, when that is not enough,
   * what is at addresses of a voided identity too, without tokens.
   */
  private async creationCoins(): Promise<AccountCoin[]> {
    const funding = await this.fundingCoins();
    if (valueOf(funding) >= creationFunding({ feeRate: this.feeRate })) return funding;
    const voided = (await this.sorted()).voided.filter(tokenFree);
    return [...funding, ...voided];
  }

  /**
   * The wallet's payment to itself: the coins to one output at the funding address, which is then output 0.
   * Funding coins are spent with the funding key, coins at a voided identity's addresses with their own keys.
   */
  private async selfPayment(coins: AccountCoin[]): Promise<PreparedTransaction> {
    const funding = await this.fundingAddress();
    const bytes = transactionBytes(coins.map((coin) => (coin.template === 'coins' ? INPUT_BYTES.p2pkh : INPUT_BYTES.byKey)), [{ lockingBytecode: funding, valueSatoshis: 0n }]);
    return this.prepareTransaction({
      template: 'actions',
      action: 'pay',
      role: 'owner',
      inputs: coins.map((coin) => ({ coin })),
      outputs: [{ lockingBytecode: funding, valueSatoshis: valueOf(coins) - requiredFee(bytes, this.feeRate) }],
    });
  }

  /** Make and send the payment to itself that defines the identity. It is recorded before it is sent. */
  private async prepareIdentity(coins: AccountCoin[]): Promise<void> {
    const prepared = await this.selfPayment(coins);
    this.store({ identity: prepared.transactionId, creation: { prepareTransactionId: prepared.transactionId, confirmed: false } });
    await this.sendPrepared(prepared);
    // A server took it: the network has it.
    this.store({ creation: { ...this.state.creation, identitySeen: true } });
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
   * done and can be repeated after an interruption; it never starts a second identity while the first still
   * exists. After an identity was voided, it makes the next one from the coins the wallet has.
   *
   * @returns where the creation stands afterwards: `created` as soon as the network has the creating transaction
   */
  async create(options: CreateOptions): Promise<CreationStep> {
    const step = await this.creationStep();
    if (step === 'not funded') throw new Error('The funding address holds no coin yet.');
    if (step === 'created') return step;

    if (step === 'funded') {
      const coins = await this.creationCoins();
      // A token category is the transaction whose output 0 is spent: the wallet needs a coin that is output 0.
      const first = coins.find((coin) => coin.template === 'coins' && coin.utxo.index === 0);
      if (first !== undefined && coins.every((coin) => coin.template === 'coins')) {
        this.store({ identity: hex(first.utxo.transactionHash), creation: { identitySeen: true, confirmed: false } });
      } else {
        await this.prepareIdentity(coins);
      }
    }

    // The identity is known. What is still to be sent is sent; a transaction that is on its way is left alone.
    let coin = await this.identityCoin(1);
    if (coin === undefined && this.state.creation.prepareTransactionId !== undefined && this.state.creation.identitySeen !== true && this.state.creation.createTransactionId === undefined) {
      // The payment to itself was recorded and the servers have not shown it. If the coins it spends are
      // still there, the device stopped before sending it; the same coins give the same transaction again.
      const unspent = (await this.creationCoins()).filter((candidate) => hex(candidate.utxo.transactionHash) !== this.state.identity);
      if (unspent.length > 0) await this.prepareIdentity(unspent);
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

    // The rest goes to a change address, which exists as soon as the identity does. A device that stopped
    // after taking the number uses the same one again.
    if (this.state.firstCoinNumber === undefined) {
      const next = takeNumber(this.state.allocation, ADDRESS_KIND.change);
      if (!('number' in next)) throw new Error('No change address is free for the wallet\'s first coins.');
      this.store({ allocation: keepNumber(next.allocation, ADDRESS_KIND.change, next.number), firstCoinNumber: next.number });
    }
    const restNumber = this.state.firstCoinNumber as number;
    await this.makeAddresses(ADDRESS_KIND.change, this.state.allocation[ADDRESS_KIND.change].next);
    const allowance = options.allowance === undefined ? [] : [{ lockingBytecode: options.allowance.feeLockingBytecode, valueSatoshis: options.allowance.satoshis }];
    const rest = { lockingBytecode: this.address(ADDRESS_KIND.change, restNumber).lockingBytecode, valueSatoshis: 0n };
    const outputs = [controller, ...allowance, rest];
    const fee = requiredFee(transactionBytes([INPUT_BYTES.p2pkh], outputs), this.feeRate);
    const left = coin.utxo.output.valueSatoshis - outputs.reduce((sum, output) => sum + output.valueSatoshis, 0n) - fee;
    // A wallet that is created can refuse a request at once: its first coin pays for that.
    const least = leastFirstCoin(this.feeRate);
    if (left < least) {
      throw new InsufficientFundsError(coin.utxo.output.valueSatoshis, fee, coin.utxo.output.valueSatoshis - left + least, 'the funding coin does not cover the controller, the allowance, the fee and a first coin that pays for refusing a request.');
    }
    const prepared = await this.prepareTransaction({
      template: 'controller',
      action: 'create',
      role: 'owner',
      variables: { identity: hex(identity), nextState: hex(encodeControllerState(first)) },
      inputs: [{ coin }],
      outputs: [{ outputIdentifier: 'controllerOutput' }, ...allowance, { ...rest, valueSatoshis: left }],
    });
    // The creation is checked as any client would check it, before it is sent and before the identity is used.
    const transaction = decodeTransactionBch(hexToBin(prepared.transactionHex));
    if (typeof transaction === 'string') throw new Error(transaction);
    validateGenesis(transaction, hexToBin(prepared.transactionId), identity);
    const { createSeen: _unseen, ...creation } = this.state.creation;
    this.store({ creation: { ...creation, createTransactionId: prepared.transactionId, confirmed: false } });
    await this.sendPrepared(prepared);
    // A server took it: the network has it, and the wallet is in use from here on.
    this.store({ creation: { ...this.state.creation, createSeen: true } });
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

  // ---------------------------------------------------------------- what the wallet shows

  /** Whether the wallet is in use: the network has its creating transaction, in a block or not. */
  get created(): boolean {
    return this.state.identity !== undefined && this.state.creation.createSeen === true;
  }

  private requireCreated(): void {
    if (this.state.ownedElsewhere === true || this.state.otherOwnerSeen === true) {
      throw new Error('The chain shows that another key owns this wallet. It gives out no address and takes on no action; coins that have not been swept can still be moved out.');
    }
    if (!this.created) throw new Error('The wallet is not created yet.');
  }

  /** Whether recovery is on: the recoverer has confirmed that it holds what a recovery needs. Coins in the wallet do not mean that it is. */
  get recovery(): 'on' | 'off' {
    return this.created && this.state.recoveryConfirmed ? 'on' : 'off';
  }

  private async controllerCoin(): Promise<{ coin: AccountCoin; state: ControllerState }> {
    const locking = hex(controllerScript(this.identity).lockingBytecode);
    const coin = await this.waitForCoin(async () => (await this.coins()).find((candidate) => hex(candidate.utxo.output.lockingBytecode) === locking && candidate.utxo.output.token !== undefined));
    const commitment = coin.utxo.output.token?.nft?.commitment;
    if (commitment === undefined) throw new Error('The controller carries no state.');
    return { coin, state: decodeControllerState(commitment) };
  }

  /** The wallet's coins by where they are. */
  private async sorted(): Promise<{ own: AccountCoin[]; vault: AccountCoin[]; earlier: AccountCoin[]; funding: AccountCoin[]; tokens: AccountCoin[]; voided: AccountCoin[] }> {
    const all = await this.coins();
    // Coins at addresses of a voided identity are the wallet's by key, and are kept apart: no recovery reaches them.
    const voided = all.filter((coin) => (coin.template === 'givenOut' || coin.template === 'change') && this.voidedAt.has(hex(coin.utxo.output.lockingBytecode)));
    const coins = all.filter((coin) => !voided.includes(coin));
    const controllerAt = this.state.identity === undefined ? undefined : hex(controllerScript(this.identity).lockingBytecode);
    // Coins at the wallet's own addresses. A key holder may also follow scripts of other templates, for an
    // action that spends from them; what is there is not the wallet's.
    const atAddress = coins.filter((coin) => hex(coin.utxo.output.lockingBytecode) !== controllerAt && (coin.template === 'givenOut' || coin.template === 'change' || coin.template === 'actions'));
    const keyed = atAddress.filter((coin) => coin.template === 'givenOut' || coin.template === 'change');
    return {
      own: keyed.filter(tokenFree),
      vault: atAddress.filter((coin) => coin.template === 'actions' && tokenFree(coin) && !this.earlier.has(hex(coin.utxo.output.lockingBytecode))),
      // At an earlier seed's addresses, with or without tokens: what a sweep is for.
      earlier: atAddress.filter((coin) => this.earlier.has(hex(coin.utxo.output.lockingBytecode))),
      funding: coins.filter((coin) => coin.template === 'coins' && tokenFree(coin)),
      tokens: atAddress.filter((coin) => !tokenFree(coin) && !this.earlier.has(hex(coin.utxo.output.lockingBytecode))),
      voided,
    };
  }

  async balance(): Promise<Balance> {
    const { own, vault, earlier, funding, tokens, voided } = await this.sorted();
    return {
      recoverable: valueOf(own),
      vault: valueOf(vault),
      // Before the wallet is created, what is at the funding address is what it is being created from.
      notRecoverable: this.created ? valueOf(funding) : 0n,
      voided: valueOf(voided.filter(tokenFree)),
      tokens: [...tokens, ...voided.filter((coin) => !tokenFree(coin))],
      toSweep: valueOf(earlier),
    };
  }

  /**
   * Whether the wallet's coins pay for a cancellation now. Only a wallet that holds less than
   * `cancellationCost()` without tokens, at its own, vault and earlier addresses together, cannot.
   */
  async canCancel(): Promise<boolean> {
    if (this.state.identity === undefined) return false;
    const controller: Utxo = { transactionHash: new Uint8Array(32), index: 0, output: controllerSized };
    try {
      await this.cancelPayment(controller, controllerSized, new Uint8Array(35));
      return true;
    } catch (error) {
      if (error instanceof InsufficientFundsError) return false;
      throw error;
    }
  }

  /**
   * The coins that pay for a cancellation. Ordinary coins pay when they can. When they hold less than the fee,
   * a coin at a vault address or at an earlier seed's address pays: the controller releases it in the same
   * transaction, and the change goes to a change address of this seed.
   *
   * @throws InsufficientFundsError when all of them together do not cover the fee
   */
  private async cancelPayment(controller: Utxo, next: Output, changeLockingBytecode: Uint8Array): Promise<{ choice: CoinChoice; payers: AccountCoin[] }> {
    const { own, vault, earlier } = await this.sorted();
    const request = { fixedInputs: [{ utxo: controller, inputBytes: INPUT_BYTES.controller }], outputs: [next], changeLockingBytecode, feeRate: this.feeRate };
    const ordinary = own.map((coin) => spendable(coin, INPUT_BYTES.byKey));
    let choice: CoinChoice;
    try {
      choice = choosePayers(ordinary, request);
    } catch (error) {
      if (!(error instanceof InsufficientFundsError)) throw error;
      const bound = [...vault.map((coin) => spendable(coin, INPUT_BYTES.vault)), ...earlier.filter(tokenFree).map((coin) => spendable(coin, this.earlierInputBytes(coin)))];
      choice = choosePayers([...ordinary, ...bound], request);
    }
    return { choice, payers: choice.coins.map((entry) => (entry as Payer).coin) };
  }

  // ---------------------------------------------------------------- for actions of other templates

  /** The wallet's parts, for the code that carries out actions of other templates. */
  get parts(): WalletParts {
    const numbersOf = (reserved: ReservedAddress[], change: (allocation: Allocation, kind: 1 | 2, number: number) => Allocation): void => {
      let allocation = this.state.allocation;
      for (const { address, fresh } of reserved) if (fresh && allocation[address.kind].held.includes(address.number)) allocation = change(allocation, address.kind as 1 | 2, address.number);
      this.store({ allocation });
    };
    const reserve = (kinds: (1 | 2)[]): { reserved: ReservedAddress[]; allocation: Allocation } => {
      let allocation = this.state.allocation;
      const reserved = kinds.map((kind) => {
        const taken = takeNumber(allocation, kind);
        allocation = taken.allocation;
        return { address: this.address(kind, 'number' in taken ? taken.number : taken.refused.offer), fresh: 'number' in taken };
      });
      return { reserved, allocation };
    };
    const selfPayment = async (satoshis: bigint): Promise<Output> => {
      const [{ address } = { address: undefined }] = reserve([ADDRESS_KIND.change]).reserved;
      if (address === undefined) throw new Error('No address is free.');
      return { lockingBytecode: address.lockingBytecode, valueSatoshis: satoshis };
    };
    return {
      backend: this.backend,
      chain: this.chain,
      feeRate: this.feeRate,
      requireUsable: () => this.requireCreated(),
      ownCoins: async () => (await this.sorted()).own,
      tokenCoins: async () => {
        const { tokens, earlier } = await this.sorted();
        return [
          ...tokens.map((coin) => ({ coin, place: coin.template === 'actions' ? ('vault' as const) : ('address' as const) })),
          ...earlier.filter((coin) => !tokenFree(coin)).map((coin) => ({ coin, place: 'earlier' as const })),
        ];
      },
      reserve: (kinds) => reserve(kinds).reserved,
      hold: async (reserved) => {
        // The numbers are recorded as held before anything is built with them.
        const again = reserve(reserved.map(({ address }) => address.kind as 1 | 2));
        if (again.reserved.some((entry, index) => entry.address.number !== reserved[index]?.address.number)) throw new Error('The wallet\'s addresses changed while the action was being worked out. Try again.');
        this.store({ allocation: again.allocation });
        for (const { address } of reserved) {
          if (address.kind === ADDRESS_KIND.vault) await this.backend.knowVaultAddress(this.identity, address);
          else await this.makeAddresses(address.kind, address.number + 1);
        }
      },
      keep: (reserved) => numbersOf(reserved, keepNumber),
      giveBack: (reserved) => numbersOf(reserved, returnNumber),
      prepare: (request) => this.prepareTransaction(request),
      send: (prepared) => this.sendPrepared(prepared),
      payItself: async (satoshis) => {
        // The address is held before the payment is built, so that the payment's own change takes the next one.
        const made = reserve([ADDRESS_KIND.change]);
        const [first] = made.reserved;
        if (first === undefined) throw new Error('No address is free.');
        this.store({ allocation: made.allocation });
        await this.makeAddresses(ADDRESS_KIND.change, first.address.number + 1);
        const sent = await this.pay([{ lockingBytecode: first.address.lockingBytecode, valueSatoshis: satoshis }]);
        numbersOf(made.reserved, keepNumber);
        const coin = await this.waitForCoin(async () => (await this.coins()).find((candidate) => hex(candidate.utxo.transactionHash) === sent.transactionId && candidate.utxo.index === 0));
        return { coin, sent };
      },
      quotePayItself: async (satoshis) => (await this.quotePay([await selfPayment(satoshis)])).feeSatoshis,
      kept: () => this.state.applications,
      store: (applications) => this.store({ applications }),
    };
  }

  // ---------------------------------------------------------------- addresses

  /**
   * A fresh address to be paid at. Inside the window it is a new one; when the window is full, an address
   * that was already given out and is still unused is given again, and the wallet says so.
   */
  async receiveAddress(): Promise<{ address: WalletAddress; again: boolean }> {
    return this.giveOut(ADDRESS_KIND.givenOut);
  }

  /**
   * An address without a key, for a payer who will use it for years. It is given out as soon as the wallet
   * is created, like any other. Only the identity's controller releases what is paid to it, so a payment to
   * one of an identity that disappeared (proposal section 7.9) could not be spent.
   */
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
   * is possible; change goes to a fresh change address.
   *
   * @param moving - coins that carry tokens which the outputs move; a fee never comes from one
   */
  async pay(outputs: Output[], moving: AccountCoin[] = []): Promise<Sent> {
    this.requireCreated();
    const { own, taken, changeNumber, changeAddress, choice } = await this.choosePayment(outputs, moving);
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

  /** The coins a payment takes and its change, chosen as `pay` will choose them. Nothing is stored. */
  private async choosePayment(outputs: Output[], moving: AccountCoin[]) {
    for (const output of outputs) {
      const smallest = smallestOutputValue(output);
      if (output.valueSatoshis < smallest) throw new Error(`The smallest amount that can be sent to this address is ${smallest} satoshis.`);
    }
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
    return { own, taken, changeNumber, changeAddress, choice };
  }

  /**
   * What paying these outputs will cost, so that the fee can be shown before the user approves.
   *
   * @throws InsufficientFundsError, with the figures, when the wallet's coins do not cover it
   */
  async quotePay(outputs: Output[], moving: AccountCoin[] = []): Promise<PaymentQuote> {
    this.requireCreated();
    const { choice } = await this.choosePayment(outputs, moving);
    return { feeSatoshis: choice.feeSatoshis, remainderSatoshis: choice.remainderSatoshis, bytes: choice.bytes, change: choice.changeSatoshis !== undefined };
  }

  /** Send a coin that carries a token on, token unchanged, with the smallest value its new output may hold. */
  async sendToken(coin: AccountCoin, toLockingBytecode: Uint8Array): Promise<Sent> {
    const { token } = coin.utxo.output;
    if (token === undefined) throw new Error('This coin carries no token.');
    const output = { lockingBytecode: toLockingBytecode, valueSatoshis: 0n, token };
    return this.pay([{ ...output, valueSatoshis: smallestOutputValue(output) }], [coin]);
  }

  /**
   * Cancel a pending request: the owner approves, and the wallet's coins pay the fee as they pay for a
   * payment, with change to a fresh change address (proposal section 8). The smallest coin that pays alone is
   * taken. A coin that the key holder still listed may have been spent a moment before by another payment of
   * this wallet; when the network refuses the cancellation for that, the coins are chosen again once.
   *
   * @throws InsufficientFundsError when the wallet holds less than the fee, at its own, vault and earlier addresses together
   */
  async cancel(): Promise<Sent> {
    this.requireCreated();
    for (let attempt = 1; ; attempt++) {
      const { coin, state } = await this.controllerCoin();
      const next = afterOwnerAuthorize(state);
      const taken = takeNumber(this.state.allocation, ADDRESS_KIND.change);
      const changeNumber = 'number' in taken ? taken.number : taken.refused.offer;
      const changeAddress = this.address(ADDRESS_KIND.change, changeNumber);
      let planned: { choice: CoinChoice; payers: AccountCoin[] };
      try {
        planned = await this.cancelPayment(coin.utxo, this.controllerOutput(next), changeAddress.lockingBytecode);
      } catch (error) {
        if (!(error instanceof InsufficientFundsError)) throw error;
        throw new InsufficientFundsError(error.totalSatoshis, error.feeSatoshis, error.neededSatoshis, 'the wallet holds less than the fee of a cancellation; a little Bitcoin Cash has to arrive first.');
      }
      const { choice, payers } = planned;
      if (choice.changeSatoshis !== undefined && 'number' in taken) this.store({ allocation: keepNumber(taken.allocation, ADDRESS_KIND.change, taken.number) });
      if (choice.changeSatoshis !== undefined) await this.makeAddresses(ADDRESS_KIND.change, changeNumber + 1);
      const prepared = await this.prepareTransaction({
        template: 'controller',
        action: 'approve',
        role: 'owner',
        variables: { identity: hex(this.identity), nextState: hex(encodeControllerState(next)) },
        inputs: [{ coin, inputIdentifier: 'approveInput' }, ...payers.map((payer) => ({ coin: payer }))],
        outputs: [{ outputIdentifier: 'controllerOutput' }, ...(choice.changeSatoshis === undefined ? [] : [{ lockingBytecode: changeAddress.lockingBytecode, valueSatoshis: choice.changeSatoshis }])],
      });
      try {
        await this.sendPrepared(prepared);
      } catch (error) {
        if (attempt > 1 || !DOUBLE_SPEND.test((error as Error).message)) throw error;
        // The coins the chain no longer lists as unspent are not chosen again.
        await this.noteSpentElsewhere(payers);
        continue;
      }
      return { transactionId: prepared.transactionId, bytes: prepared.bytes, feeSatoshis: prepared.feeSatoshis, remainderSatoshis: choice.remainderSatoshis };
    }
  }

  /** Of these coins, set aside those that the chain shows are spent: they are not offered again. */
  private async noteSpentElsewhere(coins: AccountCoin[]): Promise<void> {
    for (const coin of coins) {
      const unspent = await this.chain.listUnspent(coin.utxo.output.lockingBytecode);
      const place = `${hex(coin.utxo.transactionHash)}:${coin.utxo.index}`;
      if (!unspent.some((entry) => `${entry.transactionId}:${entry.index}` === place)) this.spent.add(place);
    }
  }

  /**
   * Change the wallet's settings (proposal section 5.6): the owner key, the recoverer or the waiting period,
   * with the owner's signature alone and at once. Any pending request is cleared. The smallest coin of the
   * wallet that pays alone pays the fee, and its change returns to a change address.
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
    const choice = choosePayers(own.map((other) => spendable(other, INPUT_BYTES.byKey)), {
      fixedInputs: [{ utxo: coin.utxo, inputBytes: INPUT_BYTES.controllerUpdate }],
      outputs: [this.controllerOutput(next)],
      changeLockingBytecode: changeAddress.lockingBytecode,
      feeRate: this.feeRate,
    });
    if (choice.changeSatoshis !== undefined && 'number' in taken) this.store({ allocation: keepNumber(taken.allocation, ADDRESS_KIND.change, taken.number) });
    else if ('number' in taken) this.store({ allocation: returnNumber(taken.allocation, ADDRESS_KIND.change, taken.number) });
    if (choice.changeSatoshis !== undefined) await this.makeAddresses(ADDRESS_KIND.change, changeNumber + 1);
    const payers = choice.coins.map((entry) => (entry as Payer).coin);
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
      const { own, earlier } = await this.sorted();
      if (earlier.length === 0) return swept;
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
      const inputBytesOf = (coin: AccountCoin): number => this.earlierInputBytes(coin);
      const tokenOutput = (coin: AccountCoin): Output => {
        const output = { lockingBytecode: destination, valueSatoshis: 0n, token: coin.utxo.output.token as NonNullable<Output['token']> };
        const smallest = smallestOutputValue(output);
        return { ...output, valueSatoshis: coin.utxo.output.valueSatoshis > smallest ? coin.utxo.output.valueSatoshis : smallest };
      };
      const part: AccountCoin[] = [];
      const outputsFor = (coins: AccountCoin[]): Output[] => [this.controllerOutput(next), ...coins.filter((coin) => !tokenFree(coin)).map(tokenOutput)];
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
          // Coins with tokens alone cannot pay: the largest swept coin without a token joins them.
          const payer = ordered.find((coin) => tokenFree(coin) && !part.includes(coin));
          if (!(error instanceof InsufficientFundsError) || payer === undefined) throw error;
          part.push(payer);
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

  /** The size of the input that releases a coin at an earlier seed's address through the controller. */
  private earlierInputBytes(coin: AccountCoin): number {
    return this.earlier.get(hex(coin.utxo.output.lockingBytecode))?.kind === ADDRESS_KIND.vault ? INPUT_BYTES.vault : INPUT_BYTES.swept;
  }

  /**
   * Check who owns the wallet, as the chain shows it (proposal section 17). When the network shows a key this
   * device does not hold as the owner, the wallet at once stops giving out addresses and taking on actions.
   * While the change is not in a block it can still disappear (a completion that loses to the owner's
   * cancellation, a change that is replaced), and then this clears by itself at the next check. Once a block
   * holds it, on servers that agree, the device has stopped for good (`ownedElsewhere`).
   *
   * @param settled - whether what the servers say may be taken as settled: more than one server was asked and none disagreed
   */
  async checkOwnership(settled = true): Promise<'this device' | 'another key' | 'closed'> {
    const history = await readControllerHistory(this.chain, this.identity);
    if (history.closed !== undefined) return 'closed';
    const key = await this.backend.controllerKey('owner');
    if (hex(history.current.state.ownerKeyHash) === hex(key.keyHash)) {
      if (this.state.ownedElsewhere === true || this.state.otherOwnerSeen === true) this.store({ ownedElsewhere: false, otherOwnerSeen: false });
      return 'this device';
    }
    // The transaction that put the present owner in place, in a block or not.
    const since = history.owners.at(-1)?.sinceTransactionId;
    const inBlock = history.transactions.find((entry) => entry.transactionId === since)?.confirmed === true;
    if (settled && inBlock) this.store({ ownedElsewhere: true, otherOwnerSeen: false });
    else if (this.state.otherOwnerSeen !== true) this.store({ otherOwnerSeen: true });
    return 'another key';
  }

  /**
   * Move what is at addresses of a voided identity to addresses of the current one, by key: coins without a
   * token in one output, each coin with a token to an address of its own with its token unchanged. A coin of
   * the current identity pays the fee only when what is moved does not.
   *
   * @returns the transaction, or `undefined` when there is nothing to move or it cannot pay its fee yet
   */
  async collectVoided(): Promise<Sent | undefined> {
    this.requireCreated();
    const { voided, own } = await this.sorted();
    if (voided.length === 0) return undefined;
    const withTokens = voided.filter((coin) => !tokenFree(coin));
    const addresses: WalletAddress[] = [];
    for (let index = 0; index <= withTokens.length; index++) {
      const taken = takeNumber(this.state.allocation, ADDRESS_KIND.change);
      const number = 'number' in taken ? taken.number : taken.refused.offer;
      if ('number' in taken) this.store({ allocation: keepNumber(taken.allocation, ADDRESS_KIND.change, taken.number) });
      addresses.push(this.address(ADDRESS_KIND.change, number));
    }
    const [changeAddress, ...tokenAddresses] = addresses as [WalletAddress, ...WalletAddress[]];
    await this.makeAddresses(ADDRESS_KIND.change, Math.max(...addresses.map((address) => address.number)) + 1);
    const tokenOutputs = withTokens.map((coin, index): Output => {
      const output = { lockingBytecode: (tokenAddresses[index] as WalletAddress).lockingBytecode, valueSatoshis: 0n, token: coin.utxo.output.token as NonNullable<Output['token']> };
      const smallest = smallestOutputValue(output);
      return { ...output, valueSatoshis: coin.utxo.output.valueSatoshis > smallest ? coin.utxo.output.valueSatoshis : smallest };
    });
    let choice: ReturnType<typeof chooseCoins>;
    try {
      choice = chooseCoins({
        available: own.map((coin) => spendable(coin, INPUT_BYTES.byKey)),
        fixedInputs: voided.map((coin) => spendable(coin, INPUT_BYTES.byKey)),
        outputs: tokenOutputs,
        changeLockingBytecode: changeAddress.lockingBytecode,
        feeRate: this.feeRate,
      });
    } catch (error) {
      if (error instanceof InsufficientFundsError) return undefined;
      throw error;
    }
    const payers = choice.coins.map(({ utxo }) => own.find((coin) => coin.utxo === utxo) as AccountCoin);
    const prepared = await this.prepareTransaction({
      template: 'actions',
      action: 'pay',
      role: 'owner',
      inputs: [...voided, ...payers].map((coin) => ({ coin })),
      outputs: [...tokenOutputs, ...(choice.changeSatoshis === undefined ? [] : [{ lockingBytecode: changeAddress.lockingBytecode, valueSatoshis: choice.changeSatoshis }])],
    });
    await this.sendPrepared(prepared);
    return { transactionId: prepared.transactionId, bytes: prepared.bytes, feeSatoshis: prepared.feeSatoshis, remainderSatoshis: choice.remainderSatoshis };
  }

  /**
   * Move out every coin this device's keys still spend, to an address outside the wallet: for an owner whose
   * wallet has gone to another key against their will. This is a race against the new owner's sweep. Coins
   * at vault addresses cannot be moved this way, and nothing is offered for them.
   */
  async moveOut(toLockingBytecode: Uint8Array): Promise<SentEverything> {
    const { own } = await this.sorted();
    const destination = { lockingBytecode: toLockingBytecode, valueSatoshis: 0n };
    const plan = planSendEverything({ coins: own.map((coin) => spendable(coin, INPUT_BYTES.byKey)), destination, feeRate: this.feeRate });
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
   * Send every coin without a token to one address: no change, the exact fee. Coins that only the controller
   * can move go with the controller, which keeps its value. Coins with tokens stay where they are. Afterwards
   * the wallet cannot pay for a cancellation until it holds a coin again.
   *
   * @throws InsufficientFundsError, with the figures, when what is left after the fee is below what the receiving output must hold
   */
  async sendEverything(toLockingBytecode: Uint8Array): Promise<SentEverything> {
    return this.everything(toLockingBytecode, true);
  }

  /**
   * What sending everything to an address will deliver and cost, so that it can be shown before the user approves.
   *
   * @throws InsufficientFundsError as `sendEverything` does
   */
  async quoteSendEverything(toLockingBytecode: Uint8Array): Promise<EverythingQuote> {
    const planned = await this.everything(toLockingBytecode, false);
    return { sentSatoshis: planned.sentSatoshis, feeSatoshis: planned.feeSatoshis, bytes: planned.transactions.reduce((sum, sent) => sum + sent.bytes, 0), transactions: planned.transactions.length, leftOut: planned.leftOut.length };
  }

  /** Plan sending everything and, if asked to, carry the plan out. */
  private async everything(toLockingBytecode: Uint8Array, carryOut: boolean): Promise<SentEverything> {
    this.requireCreated();
    const sorted = await this.sorted();
    const { own } = sorted;
    // Coins that only the controller releases: at vault addresses, and at earlier seeds' addresses not yet swept.
    const unswept = sorted.earlier.filter(tokenFree);
    const vault = [...sorted.vault, ...unswept];
    const boundBytes = (coin: AccountCoin): number => (unswept.includes(coin) && this.earlier.get(hex(coin.utxo.output.lockingBytecode))?.kind !== ADDRESS_KIND.vault ? INPUT_BYTES.swept : INPUT_BYTES.vault);
    const destination = { lockingBytecode: toLockingBytecode, valueSatoshis: 0n };
    const byKey = own.map((coin) => spendable(coin, INPUT_BYTES.byKey));
    const transactions: Sent[] = [];
    const leftOut: AccountCoin[] = [];
    let sentSatoshis = 0n;

    const send = async (coins: AccountCoin[], withController: boolean, part: { sentSatoshis: bigint; feeSatoshis: bigint; bytes: number }): Promise<void> => {
      const sent = part.sentSatoshis;
      if (!carryOut) {
        transactions.push({ transactionId: '', bytes: part.bytes, feeSatoshis: part.feeSatoshis, remainderSatoshis: 0n });
        sentSatoshis += sent;
        return;
      }
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
      await send(inFirst, true, first);
      remaining = byKey.filter((entry) => !inFirst.includes(entry.coin));
      leftOut.push(...plan.leftOut.filter((entry) => !byKey.includes(entry as (typeof byKey)[number])).map((entry) => (entry as ReturnType<typeof spendable>).coin));
    }
    if (remaining.length > 0) {
      const plan = planSendEverything({ coins: remaining, destination, feeRate: this.feeRate });
      for (const part of plan.parts) await send(part.coins.map((entry) => (entry as ReturnType<typeof spendable>).coin), false, part);
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
    const { own } = await this.sorted();
    const { coin: controller } = await this.controllerCoin();
    const destination = { lockingBytecode: toLockingBytecode, valueSatoshis: 0n };
    const coins = own.map((coin) => spendable(coin, INPUT_BYTES.byKey));
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
