import { type Output, type TransactionCommon, binToHex, decodeTransactionBch, hexToBin } from '@bitauth/libauth';
import {
  type AccountCoin,
  type ChainReader,
  type ChallengeDelay,
  type ControllerState,
  type InputSpec,
  type PreparedTransaction,
  type ViewingKey,
  type WalletBackend,
  type XoNetwork,
  ADDRESS_KIND,
  INPUT_BYTES,
  InsufficientFundsError,
  chooseCoins,
  controllerScript,
  encodeControllerState,
  planSendEverything,
  requiredFee,
  signInput,
  smallestOutputValue,
  transactionBytes,
  validateGenesis,
  walletAddress,
} from '@grandmas-wallet/core';
import { credentialKeys } from '@grandmas-wallet/enrollment';

import { cancellationCost } from './owner-wallet.js';
import { kitTemplates } from './recovery-flow.js';
import type { Sent, SentEverything } from './owner-wallet.js';

/**
 * The recoverer's own coins (proposal sections 7.9 and 9.6): its one balance, the address anyone can fund it at,
 * the wallets it creates from it, and the fees of everything it does for them. Whoever has the coins creates the
 * wallet: a bank from its own Bitcoin Cash, a friend from theirs. The creation names the owner's controller key
 * from the phone's request, the recoverer's recovery key for this wallet alone, and the waiting period; it pays
 * the starting balance to an address of the new wallet. The phone pays nothing.
 *
 * A request and a completion are paid from the same balance, each in one transaction: the wallet's controller,
 * unlocked with the recovery key for that wallet, and coins of the balance for the fee, with the change back to
 * the balance. Nothing is kept apart for a wallet.
 *
 * Creating a wallet takes one transaction that spends a coin that is output 0 of its own transaction, since a token
 * category is named after that transaction. When the balance has no such coin of the size needed, the recoverer
 * pays itself first. Every step is recorded before it is sent, so that a page that stops goes on from there and
 * never makes a second identity for one request.
 */

const CONTROLLER_SATOSHIS = 1_000n;
const hex = binToHex;
const placeOf = (coin: { utxo: { transactionHash: Uint8Array; index: number } }): string => `${hex(coin.utxo.transactionHash)}:${coin.utxo.index}`;

/**
 * The signing type of the signatures this code makes for a coin it unlocks itself: every input and every output,
 * as the key holder signs the balance's coins.
 */
const SIGNING_TYPE = 0x41;

/**
 * The recoverer's balance does not cover what it is asked to pay for. The figures are for the recoverer's page; a
 * phone is told less.
 */
export class FundsMissingError extends Error {
  constructor(
    readonly holds: bigint,
    readonly needed: bigint,
    what = 'setting up a wallet',
  ) {
    super(`Your balance is ${holds.toLocaleString('en-US')} satoshis and ${what} takes ${needed.toLocaleString('en-US')}. Send at least ${(needed - holds).toLocaleString('en-US')} satoshis to your address.`);
    this.name = 'FundsMissingError';
  }
}

/**
 * A coin that is not at the balance's address, spent in a transaction of the balance: the controller of a wallet,
 * unlocked with the recovery key for it. The key holder of the balance does not follow it or sign for it; this
 * code unlocks it, and the key holder takes it as another participant's input.
 */
export interface GivenInput extends InputSpec {
  /** The size of the input, for the fee. */
  inputBytes: number;
}

/** One creation, as the recoverer records it before each step. Plain data. */
export interface CreationRecord {
  /** The recoverer's credential for this wallet: twelve words of its own, made for this wallet alone. */
  credentialWords: string;
  /** The transaction whose output 0 the creation spends: the identity. */
  identity?: string;
  /** The recoverer's payment to itself that made that coin, when one was needed. */
  prepareTransactionId?: string;
  createTransactionId?: string;
  /** The network has the creating transaction, in a block or not. */
  createSeen?: boolean;
}

/** What a creation is asked to do. */
export interface CreationOrder {
  network: XoNetwork;
  /** hash160 of the phone's controller key. */
  ownerKeyHash: Uint8Array;
  /** The phone's viewing key, which gives the address of the starting balance. */
  viewingKey: ViewingKey;
  /** The number of the change address the starting balance goes to. */
  firstAddress: number;
  challengeDelay: ChallengeDelay;
  startingSatoshis: bigint;
}

/** The least starting balance: enough for the new wallet to pay for refusing a request at once. */
export const leastStartingBalance = (feeRate = 1): bigint => {
  const smallest = smallestOutputValue({ lockingBytecode: new Uint8Array(35), valueSatoshis: 0n });
  const cancelling = cancellationCost(feeRate);
  return cancelling > smallest ? cancelling : smallest;
};

const controllerOutput = (identity: Uint8Array, state: ControllerState): Output => ({
  lockingBytecode: controllerScript(identity).lockingBytecode,
  valueSatoshis: CONTROLLER_SATOSHIS,
  token: { amount: 0n, category: identity, nft: { capability: 'mutable', commitment: encodeControllerState(state) } },
});

/** The outputs of a creation: the controller and the starting balance. */
const creationOutputs = (identity: Uint8Array, order: CreationOrder, credentialWords: string): Output[] => {
  const keys = credentialKeys(credentialWords, order.network, kitTemplates());
  const state: ControllerState = { version: 1, status: 'active', ownerEpoch: 0, ownerKeyHash: order.ownerKeyHash, recovererKeyHash: keys.recoveryKey.keyHash, challengeDelay: order.challengeDelay };
  return [
    controllerOutput(identity, state),
    { lockingBytecode: walletAddress(identity, order.viewingKey, ADDRESS_KIND.change, order.firstAddress).lockingBytecode, valueSatoshis: order.startingSatoshis },
  ];
};

/** Outputs of the sizes a creation's outputs have, for working out its fee before the identity exists. */
const sizedOutputs = (startingSatoshis: bigint): Output[] => [
  { lockingBytecode: new Uint8Array(35), valueSatoshis: CONTROLLER_SATOSHIS, token: { amount: 0n, category: new Uint8Array(32), nft: { capability: 'mutable', commitment: new Uint8Array(69) } } },
  { lockingBytecode: new Uint8Array(35), valueSatoshis: startingSatoshis },
];

/** What the coin a creation spends must hold: the two outputs and the creation's fee. */
const creationNeeds = (startingSatoshis: bigint, feeRate: number): bigint => {
  const sized = sizedOutputs(startingSatoshis);
  return sized.reduce((sum, output) => sum + output.valueSatoshis, 0n) + requiredFee(transactionBytes([INPUT_BYTES.p2pkh], sized), feeRate);
};

/**
 * What one creation takes from the recoverer's balance: the controller's 1,000 satoshis, the starting balance,
 * the creation's fee, and the fee of a payment to itself with change, which most creations need.
 */
export const creationCost = (startingSatoshis: bigint, feeRate = 1): bigint => {
  const keyed: Output = { lockingBytecode: new Uint8Array(25), valueSatoshis: 0n };
  return creationNeeds(startingSatoshis, feeRate) + requiredFee(transactionBytes([INPUT_BYTES.p2pkh], [keyed, keyed]), feeRate);
};

export class RecovererFunds {
  /** Coins that transactions of this account have spent since it was opened; a key holder may list one a moment longer. */
  private readonly spent = new Set<string>();
  /**
   * Coins that transactions of this account have made for the balance and that the key holder has not listed
   * yet: the change of a payment. A key holder may take a moment to list one.
   */
  private readonly expected = new Set<string>();

  private constructor(
    private readonly backend: WalletBackend,
    private readonly chain: ChainReader,
    private readonly feeRate: number,
  ) {}

  static async open(options: { backend: WalletBackend; chain: ChainReader; feeRate?: number }): Promise<RecovererFunds> {
    await options.backend.ordinaryAddress();
    return new RecovererFunds(options.backend, options.chain, options.feeRate ?? 1);
  }

  /** The address the recoverer's balance is funded at. Anyone can send coins there, from any wallet. */
  async address(): Promise<Uint8Array> {
    return this.backend.ordinaryAddress();
  }

  /**
   * The recoverer's coins without a token, without those it has spent; one no longer listed is forgotten as spent.
   * A coin that a transaction of this account has just made for the balance is waited for, for a few seconds, so
   * that the balance does not read as less than it is between that transaction and the key holder's listing of
   * its change.
   */
  private async coins(): Promise<AccountCoin[]> {
    for (let attempt = 0; ; attempt++) {
      const listed = (await this.backend.coins()).filter((coin) => coin.template === 'coins' && coin.utxo.output.token === undefined);
      const places = new Set(listed.map(placeOf));
      for (const place of this.expected) if (places.has(place)) this.expected.delete(place);
      if (this.expected.size === 0 || attempt >= 40) {
        // A coin that did not come is no longer waited for: its transaction may not have stayed.
        this.expected.clear();
        for (const place of this.spent) if (!places.has(place)) this.spent.delete(place);
        return listed.filter((coin) => !this.spent.has(placeOf(coin)));
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  async balance(): Promise<bigint> {
    return (await this.coins()).reduce((sum, coin) => sum + coin.utxo.output.valueSatoshis, 0n);
  }

  /** A coin of this account's own last transaction may take a moment to be listed. */
  private async coinAt(transactionId: string, index: number, attempts: number): Promise<AccountCoin | undefined> {
    for (let attempt = 0; attempt < attempts; attempt++) {
      const coin = (await this.coins()).find((candidate) => hex(candidate.utxo.transactionHash) === transactionId && candidate.utxo.index === index);
      if (coin !== undefined) return coin;
      if (attempt + 1 < attempts) await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return undefined;
  }

  private async sendPaying(inputs: AccountCoin[], outputs: Output[]): Promise<Sent & { prepared: { transactionId: string; transactionHex: string } }> {
    const prepared = await this.backend.prepare({ template: 'actions', action: 'pay', role: 'owner', inputs: inputs.map((coin) => ({ coin })), outputs });
    await this.backend.send(prepared);
    for (const coin of inputs) this.spent.add(placeOf(coin));
    return { transactionId: prepared.transactionId, bytes: prepared.bytes, feeSatoshis: prepared.feeSatoshis, remainderSatoshis: 0n, prepared };
  }

  /**
   * Create a wallet for a phone's request, or go on creating it (proposal section 7.9). Each call does what is
   * still to be done; `save` is called with the record before each transaction is sent, so that it is stored
   * first. A creation that the network has is not made again.
   *
   * @param options.reserved - identities other unfinished creations of this recoverer are named after: their coins are not used here
   * @returns the identity and the transaction that created it
   * @throws FundsMissingError when the balance does not cover the creation
   */
  async create(options: { order: CreationOrder; record: CreationRecord; save: (record: CreationRecord) => void | Promise<void>; reserved?: Set<string> }): Promise<{ identity: string; creationTransactionId: string; record: CreationRecord }> {
    const { order } = options;
    let record = options.record;
    const store = async (next: CreationRecord): Promise<void> => {
      record = next;
      await options.save(record);
    };
    const done = (): { identity: string; creationTransactionId: string; record: CreationRecord } => ({ identity: record.identity as string, creationTransactionId: record.createTransactionId as string, record });

    // A creation that was sent and that the network has: nothing more to do.
    if (record.identity !== undefined && record.createTransactionId !== undefined && (await this.chain.getTransaction(record.createTransactionId)) !== undefined) {
      if (record.createSeen !== true) await store({ ...record, createSeen: true });
      return done();
    }
    const funding = await this.address();
    const needed = creationNeeds(order.startingSatoshis, this.feeRate);

    if (record.identity === undefined) {
      const coins = await this.coins();
      const reserved = options.reserved ?? new Set<string>();
      // A coin that is output 0 of its transaction and holds enough needs no payment to itself.
      const ready = coins.find((coin) => coin.utxo.index === 0 && coin.utxo.output.valueSatoshis >= needed && !reserved.has(hex(coin.utxo.transactionHash)));
      if (ready !== undefined) {
        await store({ ...record, identity: hex(ready.utxo.transactionHash) });
      } else {
        const usable = coins.filter((coin) => !(coin.utxo.index === 0 && reserved.has(hex(coin.utxo.transactionHash))));
        let choice;
        try {
          choice = chooseCoins({
            available: usable.map((coin) => ({ utxo: coin.utxo, inputBytes: INPUT_BYTES.p2pkh })),
            outputs: [{ lockingBytecode: funding, valueSatoshis: needed }],
            changeLockingBytecode: funding,
            changeSpendBytes: INPUT_BYTES.p2pkh,
            feeRate: this.feeRate,
          });
        } catch (error) {
          if (error instanceof InsufficientFundsError) throw new FundsMissingError(usable.reduce((sum, coin) => sum + coin.utxo.output.valueSatoshis, 0n), creationCost(order.startingSatoshis, this.feeRate));
          throw error;
        }
        const inputs = choice.coins.map(({ utxo }) => usable.find((coin) => coin.utxo === utxo) as AccountCoin);
        // Output 0 is the coin the identity is named after; the rest comes back as change.
        const outputs: Output[] = [{ lockingBytecode: funding, valueSatoshis: needed }, ...(choice.changeSatoshis === undefined ? [] : [{ lockingBytecode: funding, valueSatoshis: choice.changeSatoshis }])];
        const prepared = await this.backend.prepare({ template: 'actions', action: 'pay', role: 'owner', inputs: inputs.map((coin) => ({ coin })), outputs });
        await store({ ...record, identity: prepared.transactionId, prepareTransactionId: prepared.transactionId });
        await this.backend.send(prepared);
        for (const coin of inputs) this.spent.add(placeOf(coin));
        if (choice.changeSatoshis !== undefined) this.expected.add(`${prepared.transactionId}:1`);
      }
    }

    // The payment to itself was recorded and never reached the network (the page stopped before sending it, or it
    // disappeared): it is made again from the coins there are now.
    if (record.prepareTransactionId !== undefined && (await this.chain.getTransaction(record.prepareTransactionId)) === undefined) {
      const { identity: _never, prepareTransactionId: _unsent, createTransactionId: _unbuilt, createSeen: _unseen, ...rest } = record;
      await store(rest);
      return this.create({ ...options, record });
    }
    const identityHex = record.identity as string;
    const coin = await this.coinAt(identityHex, 0, record.createTransactionId === undefined ? 40 : 4);
    if (coin === undefined) throw new Error('The coin the new wallet is to be named after is spent or was not found. Set the wallet up again.');
    const identity = hexToBin(identityHex);
    const outputs = creationOutputs(identity, order, record.credentialWords);
    let choice;
    try {
      choice = chooseCoins({ available: [], fixedInputs: [{ utxo: coin.utxo, inputBytes: INPUT_BYTES.p2pkh }], outputs, changeLockingBytecode: funding, changeSpendBytes: INPUT_BYTES.p2pkh, feeRate: this.feeRate });
    } catch (error) {
      if (error instanceof InsufficientFundsError) throw new FundsMissingError(coin.utxo.output.valueSatoshis, needed);
      throw error;
    }
    const prepared = await this.backend.prepare({
      template: 'actions',
      action: 'pay',
      role: 'owner',
      inputs: [{ coin }],
      outputs: [...outputs, ...(choice.changeSatoshis === undefined ? [] : [{ lockingBytecode: funding, valueSatoshis: choice.changeSatoshis }])],
    });
    // The creation is checked as any client would check it, before it is sent.
    const transaction = decodeTransactionBch(hexToBin(prepared.transactionHex));
    if (typeof transaction === 'string') throw new Error(transaction);
    validateGenesis(transaction, hexToBin(prepared.transactionId), identity);
    const { createSeen: _unseen, ...rest } = record;
    await store({ ...rest, createTransactionId: prepared.transactionId });
    await this.backend.send(prepared);
    this.spent.add(`${identityHex}:0`);
    if (choice.changeSatoshis !== undefined) this.expected.add(`${prepared.transactionId}:${outputs.length}`);
    await store({ ...record, createSeen: true });
    return done();
  }

  /** The coins a transaction other than a creation may spend: not the coin an unfinished creation is named after. */
  private async free(reserved: Set<string> | undefined, among?: AccountCoin[]): Promise<AccountCoin[]> {
    const coins = among ?? (await this.coins());
    return reserved === undefined ? coins : coins.filter((coin) => !(coin.utxo.index === 0 && reserved.has(hex(coin.utxo.transactionHash))));
  }

  /**
   * Build a transaction whose first inputs are coins this code unlocks itself, followed by coins of the balance.
   *
   * A signature commits to the whole transaction and to nothing in the other inputs' unlocking, so the given
   * coins are signed here against the transaction as the key holder builds it: version 2, no lock time, the
   * balance's coins with sequence number 0. The key holder signs the balance's coins and checks the whole
   * transaction before it is sent; had it built anything else, the check would refuse it.
   */
  private async prepareWith(given: InputSpec[], own: AccountCoin[], outputs: Output[]): Promise<PreparedTransaction> {
    const sourceOutputs = [...given.map(({ utxo }) => utxo.output), ...own.map(({ utxo }) => utxo.output)];
    const transaction: TransactionCommon = {
      version: 2,
      locktime: 0,
      inputs: [
        ...given.map(({ utxo, sequence }) => ({ outpointTransactionHash: utxo.transactionHash, outpointIndex: utxo.index, sequenceNumber: sequence ?? 0, unlockingBytecode: new Uint8Array(0) })),
        ...own.map(({ utxo }) => ({ outpointTransactionHash: utxo.transactionHash, outpointIndex: utxo.index, sequenceNumber: 0, unlockingBytecode: new Uint8Array(0) })),
      ],
      outputs,
    };
    const unlocked = given.map((input, inputIndex) => input.unlock((privateKey, coveredBytecode) => signInput({ transaction, sourceOutputs, inputIndex, coveredBytecode, privateKey, signingType: SIGNING_TYPE })));
    return this.backend.prepare({
      template: 'actions',
      action: 'pay',
      role: 'owner',
      inputs: [
        ...given.map((input, index) => ({ coin: { utxo: input.utxo, template: 'given', height: 0 }, unlocking: { bytecode: unlocked[index] as Uint8Array, sequenceNumber: input.sequence ?? 0 } })),
        ...own.map((coin) => ({ coin })),
      ],
      outputs,
    });
  }

  /**
   * Send a transaction that spends coins this code unlocks itself, with the given outputs, and pay its fee from
   * the balance; the change comes back to the balance. This is how a request and a completion are paid: the
   * controller is the given coin, its successor the output.
   *
   * @param options.what - what is being paid for, for the message when the balance does not cover it
   * @param options.reserved - identities unfinished creations are named after: their coins are not used here
   * @throws FundsMissingError when the balance does not cover the fee
   */
  async payFor(options: { inputs: GivenInput[]; outputs: Output[]; what: string; reserved?: Set<string> }): Promise<Sent> {
    const funding = await this.address();
    const coins = await this.free(options.reserved);
    let choice;
    try {
      choice = chooseCoins({
        available: coins.map((coin) => ({ utxo: coin.utxo, inputBytes: INPUT_BYTES.p2pkh })),
        fixedInputs: options.inputs.map(({ utxo, inputBytes }) => ({ utxo, inputBytes })),
        outputs: options.outputs,
        changeLockingBytecode: funding,
        changeSpendBytes: INPUT_BYTES.p2pkh,
        feeRate: this.feeRate,
      });
    } catch (error) {
      if (!(error instanceof InsufficientFundsError)) throw error;
      // What the balance would have to hold: the fee of the transaction with one coin of the balance and its change.
      const holds = coins.reduce((sum, coin) => sum + coin.utxo.output.valueSatoshis, 0n);
      const given = options.inputs.reduce((sum, { utxo }) => sum + utxo.output.valueSatoshis, 0n);
      const out = options.outputs.reduce((sum, output) => sum + output.valueSatoshis, 0n);
      const fee = requiredFee(transactionBytes([...options.inputs.map(({ inputBytes }) => inputBytes), ...coins.map(() => INPUT_BYTES.p2pkh), ...(coins.length === 0 ? [INPUT_BYTES.p2pkh] : [])], options.outputs), this.feeRate);
      throw new FundsMissingError(holds, out + fee - given, options.what);
    }
    const payers = choice.coins.map(({ utxo }) => coins.find((coin) => coin.utxo === utxo) as AccountCoin);
    const prepared = await this.prepareWith(options.inputs, payers, [...options.outputs, ...(choice.changeSatoshis === undefined ? [] : [{ lockingBytecode: funding, valueSatoshis: choice.changeSatoshis }])]);
    await this.backend.send(prepared);
    for (const coin of payers) this.spent.add(placeOf(coin));
    if (choice.changeSatoshis !== undefined) this.expected.add(`${prepared.transactionId}:${options.outputs.length}`);
    return { transactionId: prepared.transactionId, bytes: prepared.bytes, feeSatoshis: prepared.feeSatoshis, remainderSatoshis: choice.remainderSatoshis };
  }

  /** Plan sending the whole balance to an address and, if asked to, carry the plan out. */
  private async everything(toLockingBytecode: Uint8Array, reserved: Set<string> | undefined, carryOut: boolean): Promise<SentEverything & { heldBack: bigint }> {
    const all = await this.coins();
    const coins = await this.free(reserved, all);
    const heldBack = all.filter((coin) => !coins.includes(coin)).reduce((sum, coin) => sum + coin.utxo.output.valueSatoshis, 0n);
    const plan = planSendEverything({ coins: coins.map((coin) => ({ utxo: coin.utxo, inputBytes: INPUT_BYTES.p2pkh })), destination: { lockingBytecode: toLockingBytecode, valueSatoshis: 0n }, feeRate: this.feeRate });
    const transactions: Sent[] = [];
    for (const part of plan.parts) {
      if (!carryOut) {
        transactions.push({ transactionId: '', bytes: part.bytes, feeSatoshis: part.feeSatoshis, remainderSatoshis: 0n });
        continue;
      }
      const inputs = part.coins.map(({ utxo }) => coins.find((coin) => coin.utxo === utxo) as AccountCoin);
      const sent = await this.sendPaying(inputs, [{ lockingBytecode: toLockingBytecode, valueSatoshis: part.sentSatoshis }]);
      transactions.push({ transactionId: sent.transactionId, bytes: sent.bytes, feeSatoshis: sent.feeSatoshis, remainderSatoshis: 0n });
    }
    return { transactions, sentSatoshis: plan.sentSatoshis, feeSatoshis: plan.feeSatoshis, leftOut: plan.leftOut.map(({ utxo }) => coins.find((coin) => coin.utxo === utxo) as AccountCoin), heldBack };
  }

  /**
   * What sending the whole balance to an address will deliver and cost, so that it can be shown first.
   *
   * @param options.reserved - identities unfinished creations are named after: their coins stay, and are counted in `heldBack`
   * @throws InsufficientFundsError, with the figures, when what is left after the fee is below what the receiving output must hold
   */
  async quoteSendEverything(toLockingBytecode: Uint8Array, options: { reserved?: Set<string> } = {}): Promise<{ sentSatoshis: bigint; feeSatoshis: bigint; transactions: number; leftOut: number; heldBack: bigint }> {
    const planned = await this.everything(toLockingBytecode, options.reserved, false);
    return { sentSatoshis: planned.sentSatoshis, feeSatoshis: planned.feeSatoshis, transactions: planned.transactions.length, leftOut: planned.leftOut.length, heldBack: planned.heldBack };
  }

  /**
   * Send the whole balance to an address: every coin, no change, the exact fee.
   *
   * @throws InsufficientFundsError as `quoteSendEverything` does
   */
  async sendEverything(toLockingBytecode: Uint8Array, options: { reserved?: Set<string> } = {}): Promise<SentEverything> {
    const { heldBack: _kept, ...sent } = await this.everything(toLockingBytecode, options.reserved, true);
    return sent;
  }

  /** What bringing coins into the balance would deliver: the coins worth their own fee, and what arrives after it. */
  private takeInPlan(inputs: GivenInput[]): { inputs: GivenInput[]; arrives: bigint; feeSatoshis: bigint } | undefined {
    // A coin that holds no more than its own input costs adds nothing. One transaction takes a few hundred coins.
    const worth = inputs.filter(({ utxo, inputBytes }) => utxo.output.valueSatoshis > requiredFee(inputBytes, this.feeRate)).slice(0, 500);
    const destination = { lockingBytecode: new Uint8Array(25), valueSatoshis: 0n };
    const feeSatoshis = requiredFee(transactionBytes(worth.map(({ inputBytes }) => inputBytes), [destination]), this.feeRate);
    const total = worth.reduce((sum, { utxo }) => sum + utxo.output.valueSatoshis, 0n);
    if (worth.length === 0 || total - feeSatoshis < smallestOutputValue(destination)) return undefined;
    return { inputs: worth, arrives: total - feeSatoshis, feeSatoshis };
  }

  /**
   * What `takeIn` would bring into the balance, after its fee.
   *
   * @returns `undefined` when the coins hold too little to be worth moving
   */
  takeInQuote(inputs: GivenInput[]): { arrives: bigint; feeSatoshis: bigint } | undefined {
    const plan = this.takeInPlan(inputs);
    return plan === undefined ? undefined : { arrives: plan.arrives, feeSatoshis: plan.feeSatoshis };
  }

  /**
   * Bring coins this code unlocks itself into the balance, paying the fee from them: what an earlier version of
   * this software kept at a wallet's fee address.
   *
   * @returns `undefined` when they hold too little to be worth moving
   */
  async takeIn(inputs: GivenInput[]): Promise<Sent | undefined> {
    const plan = this.takeInPlan(inputs);
    if (plan === undefined) return undefined;
    const prepared = await this.prepareWith(plan.inputs, [], [{ lockingBytecode: await this.address(), valueSatoshis: plan.arrives }]);
    await this.backend.send(prepared);
    this.expected.add(`${prepared.transactionId}:0`);
    return { transactionId: prepared.transactionId, bytes: prepared.bytes, feeSatoshis: prepared.feeSatoshis, remainderSatoshis: 0n };
  }
}
