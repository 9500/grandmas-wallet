import { type Output, binToHex, decodeTransactionBch, hexToBin } from '@bitauth/libauth';
import {
  type AccountCoin,
  type ChainReader,
  type ChallengeDelay,
  type ControllerState,
  type ViewingKey,
  type WalletBackend,
  type XoNetwork,
  ADDRESS_KIND,
  INPUT_BYTES,
  InsufficientFundsError,
  chooseCoins,
  controllerScript,
  encodeControllerState,
  p2pkhLockingBytecode,
  requiredFee,
  smallestOutputValue,
  transactionBytes,
  validateGenesis,
  walletAddress,
} from '@grandmas-wallet/core';
import { credentialKeys } from '@grandmas-wallet/enrollment';

import { cancellationCost } from './owner-wallet.js';
import { feeReserve } from './recoverer-wallet.js';
import { kitTemplates } from './recovery-flow.js';
import type { Sent } from './owner-wallet.js';

/**
 * The recoverer's own coins (proposal sections 7.9 and 9.6): its balance, the address anyone can fund it at, and
 * the wallets it creates from them. Whoever has the coins creates the wallet: a bank from its own Bitcoin Cash, a
 * friend from theirs. The creation names the owner's controller key from the phone's request, the recoverer's
 * recovery key for this wallet alone, and the waiting period; it pays the starting balance to an address of the
 * new wallet and the fee reserve to the wallet's fee address, from which the recoverer pays a request and a
 * completion. The phone pays nothing.
 *
 * Creating a wallet takes one transaction that spends a coin that is output 0 of its own transaction, since a token
 * category is named after that transaction. When the balance has no such coin of the size needed, the recoverer
 * pays itself first. Every step is recorded before it is sent, so that a page that stops goes on from there and
 * never makes a second identity for one request.
 */

const CONTROLLER_SATOSHIS = 1_000n;
const hex = binToHex;

/** The recoverer's balance does not cover a creation. The figures are for the recoverer's page; the phone is told less. */
export class FundsMissingError extends Error {
  constructor(
    readonly holds: bigint,
    readonly needed: bigint,
  ) {
    super(`Your balance is ${holds.toLocaleString('en-US')} satoshis and setting up a wallet takes ${needed.toLocaleString('en-US')}. Send at least ${(needed - holds).toLocaleString('en-US')} satoshis to your address.`);
    this.name = 'FundsMissingError';
  }
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

/** The outputs of a creation: the controller, the starting balance, the fee reserve. */
const creationOutputs = (identity: Uint8Array, order: CreationOrder, credentialWords: string, feeRate: number): Output[] => {
  const keys = credentialKeys(credentialWords, order.network, kitTemplates());
  const state: ControllerState = { version: 1, status: 'active', ownerEpoch: 0, ownerKeyHash: order.ownerKeyHash, recovererKeyHash: keys.recoveryKey.keyHash, challengeDelay: order.challengeDelay };
  return [
    controllerOutput(identity, state),
    { lockingBytecode: walletAddress(identity, order.viewingKey, ADDRESS_KIND.change, order.firstAddress).lockingBytecode, valueSatoshis: order.startingSatoshis },
    { lockingBytecode: p2pkhLockingBytecode(keys.feeKey.keyHash), valueSatoshis: feeReserve(feeRate) },
  ];
};

/** Outputs of the sizes a creation's outputs have, for working out its fee before the identity exists. */
const sizedOutputs = (startingSatoshis: bigint, feeRate: number): Output[] => [
  { lockingBytecode: new Uint8Array(35), valueSatoshis: CONTROLLER_SATOSHIS, token: { amount: 0n, category: new Uint8Array(32), nft: { capability: 'mutable', commitment: new Uint8Array(69) } } },
  { lockingBytecode: new Uint8Array(35), valueSatoshis: startingSatoshis },
  { lockingBytecode: new Uint8Array(25), valueSatoshis: feeReserve(feeRate) },
];

/** What the coin a creation spends must hold: the three outputs and the creation's fee. */
const creationNeeds = (startingSatoshis: bigint, feeRate: number): bigint => {
  const sized = sizedOutputs(startingSatoshis, feeRate);
  return sized.reduce((sum, output) => sum + output.valueSatoshis, 0n) + requiredFee(transactionBytes([INPUT_BYTES.p2pkh], sized), feeRate);
};

/**
 * What one creation takes from the recoverer's balance: the controller's 1,000 satoshis, the starting balance, the
 * fee reserve, the creation's fee, and the fee of a payment to itself with change, which most creations need.
 */
export const creationCost = (startingSatoshis: bigint, feeRate = 1): bigint => {
  const keyed: Output = { lockingBytecode: new Uint8Array(25), valueSatoshis: 0n };
  return creationNeeds(startingSatoshis, feeRate) + requiredFee(transactionBytes([INPUT_BYTES.p2pkh], [keyed, keyed]), feeRate);
};

export class RecovererFunds {
  /** Coins that transactions of this account have spent since it was opened; a key holder may list one a moment longer. */
  private readonly spent = new Set<string>();

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

  /** The recoverer's coins without a token, without those it has spent; one no longer listed is forgotten as spent. */
  private async coins(): Promise<AccountCoin[]> {
    const listed = (await this.backend.coins()).filter((coin) => coin.template === 'coins' && coin.utxo.output.token === undefined);
    const places = new Set(listed.map((coin) => `${hex(coin.utxo.transactionHash)}:${coin.utxo.index}`));
    for (const place of this.spent) if (!places.has(place)) this.spent.delete(place);
    return listed.filter((coin) => !this.spent.has(`${hex(coin.utxo.transactionHash)}:${coin.utxo.index}`));
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
    for (const coin of inputs) this.spent.add(`${hex(coin.utxo.transactionHash)}:${coin.utxo.index}`);
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
        for (const coin of inputs) this.spent.add(`${hex(coin.utxo.transactionHash)}:${coin.utxo.index}`);
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
    const outputs = creationOutputs(identity, order, record.credentialWords, this.feeRate);
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
    await store({ ...record, createSeen: true });
    return done();
  }

  /**
   * Pay from the balance to an address: the fee reserve of a wallet whose fee address runs short, or coins sent
   * on. Change comes back to the balance.
   */
  async pay(toLockingBytecode: Uint8Array, satoshis: bigint): Promise<Sent> {
    const funding = await this.address();
    const coins = await this.coins();
    let choice;
    try {
      choice = chooseCoins({ available: coins.map((coin) => ({ utxo: coin.utxo, inputBytes: INPUT_BYTES.p2pkh })), outputs: [{ lockingBytecode: toLockingBytecode, valueSatoshis: satoshis }], changeLockingBytecode: funding, changeSpendBytes: INPUT_BYTES.p2pkh, feeRate: this.feeRate });
    } catch (error) {
      if (error instanceof InsufficientFundsError) throw new FundsMissingError(coins.reduce((sum, coin) => sum + coin.utxo.output.valueSatoshis, 0n), error.neededSatoshis);
      throw error;
    }
    const inputs = choice.coins.map(({ utxo }) => coins.find((coin) => coin.utxo === utxo) as AccountCoin);
    const sent = await this.sendPaying(inputs, [{ lockingBytecode: toLockingBytecode, valueSatoshis: satoshis }, ...(choice.changeSatoshis === undefined ? [] : [{ lockingBytecode: funding, valueSatoshis: choice.changeSatoshis }])]);
    return { transactionId: sent.transactionId, bytes: sent.bytes, feeSatoshis: sent.feeSatoshis, remainderSatoshis: choice.remainderSatoshis };
  }
}
