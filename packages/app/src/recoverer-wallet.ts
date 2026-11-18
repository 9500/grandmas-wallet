import { type Output, binToHex } from '@bitauth/libauth';
import {
  type AccountCoin,
  type ChainReader,
  type ControllerState,
  type WalletBackend,
  INPUT_BYTES,
  afterFinalizeRecovery,
  afterRequestRecovery,
  chooseCoins,
  controllerScript,
  decodeControllerState,
  encodeChallengeDelay,
  encodeControllerState,
  readControllerHistory,
  requiredFee,
  smallestOutputValue,
  transactionBytes,
} from '@grandmas-wallet/core';

import type { Sent } from './owner-wallet.js';

/**
 * The recoverer's side of one wallet (proposal sections 9.2, 9.6 and 11.1): its key for the controller,
 * its fee address, the request and the completion.
 *
 * The recoverer's key signs two kinds of transaction and no other: the request and the completion. Each
 * spends the controller and coins of the recoverer's own for the fee. It never signs for a coin of the wallet.
 */

const hex = binToHex;
const CONTROLLER_SATOSHIS = 1_000n;

/** Whether the recoverer can pay for what a recovery takes, and what is missing if it cannot. */
export interface FeeReadiness {
  /** What the fee address holds. */
  holds: bigint;
  /** What a request costs, paid by one coin with its change. */
  request: bigint;
  /** What a completion costs when it takes what is left, with no change: the least it can cost. */
  completion: bigint;
  /** Enough for a request now. */
  canRequest: boolean;
  /** Enough for a request and its completion. */
  canRecover: boolean;
  /** What has to be sent to the fee address before a recovery can be carried through; zero when nothing. */
  missing: bigint;
}

/** Thrown when the fee address does not hold what a transaction costs. The recoverer's power is not affected. */
export class FeeCoinsMissingError extends Error {
  constructor(
    readonly holds: bigint,
    readonly needed: bigint,
    what: string,
  ) {
    super(`The fee address holds ${holds} satoshis and ${what} costs ${needed}. Send at least ${needed - holds} satoshis to the fee address.`);
    this.name = 'FeeCoinsMissingError';
  }
}

const controllerSized: Output = { lockingBytecode: new Uint8Array(35), valueSatoshis: CONTROLLER_SATOSHIS, token: { amount: 0n, category: new Uint8Array(32), nft: { capability: 'mutable', commitment: new Uint8Array(69) } } };
const feeChange: Output = { lockingBytecode: new Uint8Array(25), valueSatoshis: 0n };

/**
 * What a recovery costs the recoverer (proposal section 9.6): a request paid by one coin with its change,
 * and a completion that takes what is left. The reserve and the readiness of the fee address are both
 * counted in these, so that a reserve used as intended never shows as short.
 */
export const recoveryFees = (feeRate = 1): { request: bigint; completion: bigint } => ({
  request: requiredFee(transactionBytes([INPUT_BYTES.controllerRequest, INPUT_BYTES.p2pkh], [controllerSized, feeChange]), feeRate),
  completion: requiredFee(transactionBytes([INPUT_BYTES.controller, INPUT_BYTES.p2pkh], [controllerSized]), feeRate),
});

/**
 * What the recoverer puts at a wallet's fee address when it creates the wallet (proposal section 9.6), from
 * its own coins: what four requests and one completion cost, so that three requests the owner cancels still
 * leave enough for a fourth and its completion.
 */
export const feeReserve = (feeRate = 1): bigint => {
  const { request, completion } = recoveryFees(feeRate);
  return 4n * request + completion;
};

/** Whether a fee address that holds this much can pay for a recovery. */
export const feeReadinessOf = (holds: bigint, feeRate = 1): FeeReadiness => {
  const { request, completion } = recoveryFees(feeRate);
  const both = request + completion;
  return { holds, request, completion, canRequest: holds >= request, canRecover: holds >= both, missing: holds >= both ? 0n : both - holds };
};

export class RecovererWallet {
  /** Coins that transactions of this account have spent since it was opened; a key holder may list one a moment longer. */
  private readonly spent = new Set<string>();

  private constructor(
    private readonly backend: WalletBackend,
    private readonly chain: ChainReader,
    readonly identity: Uint8Array,
    private readonly feeRate: number,
  ) {}

  /**
   * Take up a wallet: read and check its controller from the chain, and make it known to this account
   * under the recovery key.
   *
   * @throws if the identity's creation is not valid, or if this account's key is not the recoverer in the controller's state
   */
  static async open(options: { backend: WalletBackend; chain: ChainReader; identity: Uint8Array; genesisTransactionId?: string; feeRate?: number }): Promise<RecovererWallet> {
    const wallet = new RecovererWallet(options.backend, options.chain, options.identity, options.feeRate ?? 1);
    const history = await readControllerHistory(options.chain, options.identity, options.genesisTransactionId);
    const key = await options.backend.controllerKey('recoverer');
    if (hex(history.current.state.recovererKeyHash) !== hex(key.keyHash)) {
      throw new Error('This account\'s recovery key is not the recoverer named in the wallet\'s controller.');
    }
    await options.backend.ordinaryAddress();
    await options.backend.knowController(options.identity, 'recoverer', encodeControllerState(history.current.state));
    return wallet;
  }

  /**
   * The account of a recoverer that the wallet does not name: one that was replaced, or one that is not
   * named yet. Its fee coins are its own and it can send them on; a request or a completion would find
   * that its key does not work on the controller.
   */
  static async unnamed(options: { backend: WalletBackend; chain: ChainReader; identity: Uint8Array; feeRate?: number }): Promise<RecovererWallet> {
    const wallet = new RecovererWallet(options.backend, options.chain, options.identity, options.feeRate ?? 1);
    await options.backend.ordinaryAddress();
    return wallet;
  }

  /** The address the recoverer's fee coins are kept at. Anyone can send coins there, from any wallet. */
  async feeAddress(): Promise<Uint8Array> {
    return this.backend.ordinaryAddress();
  }

  private async coins(): Promise<AccountCoin[]> {
    return (await this.backend.coins()).filter((coin) => !this.spent.has(`${hex(coin.utxo.transactionHash)}:${coin.utxo.index}`));
  }

  private async feeCoins(): Promise<AccountCoin[]> {
    return (await this.coins()).filter((coin) => coin.template === 'coins' && coin.utxo.output.token === undefined);
  }

  private controllerOutput(state: ControllerState): Output {
    return {
      lockingBytecode: controllerScript(this.identity).lockingBytecode,
      valueSatoshis: CONTROLLER_SATOSHIS,
      token: { amount: 0n, category: this.identity, nft: { capability: 'mutable', commitment: encodeControllerState(state) } },
    };
  }

  private async controller(): Promise<{ coin: AccountCoin; state: ControllerState }> {
    const locking = hex(controllerScript(this.identity).lockingBytecode);
    for (let attempt = 0; attempt < 60; attempt++) {
      const coin = (await this.coins()).find((candidate) => hex(candidate.utxo.output.lockingBytecode) === locking && candidate.utxo.output.token?.nft !== undefined);
      if (coin?.utxo.output.token?.nft !== undefined) return { coin, state: decodeControllerState(coin.utxo.output.token.nft.commitment) };
      await new Promise((resolve) => setTimeout(resolve, attempt === 0 ? 0 : 250));
    }
    throw new Error('The wallet\'s controller was not found. The owner may have closed the wallet.');
  }

  /** The state of the wallet's controller as this account sees it now. */
  async state(): Promise<ControllerState> {
    return (await this.controller()).state;
  }

  /**
   * Whether the fee address holds what a recovery takes. The recoverer's software shows this when a wallet
   * is taken up and whenever it is opened, not only at the moment of a recovery.
   */
  async feeReadiness(): Promise<FeeReadiness> {
    return feeReadinessOf((await this.feeCoins()).reduce((sum, coin) => sum + coin.utxo.output.valueSatoshis, 0n), this.feeRate);
  }

  /** A transaction of the controller, with the fee from the recoverer's own coins and the change back to its fee address. */
  private async act(action: 'requestRecovery' | 'completeRecovery', inputIdentifier: string, inputBytes: number, next: ControllerState, variables: Record<string, string | number>, what: string): Promise<Sent> {
    const { coin } = await this.controller();
    const available = await this.feeCoins();
    const feeAddress = await this.feeAddress();
    let choice;
    try {
      choice = chooseCoins({
        available: available.map((fee) => ({ utxo: fee.utxo, inputBytes: INPUT_BYTES.p2pkh })),
        fixedInputs: [{ utxo: coin.utxo, inputBytes }],
        outputs: [this.controllerOutput(next)],
        changeLockingBytecode: feeAddress,
        changeSpendBytes: INPUT_BYTES.p2pkh,
        feeRate: this.feeRate,
      });
    } catch {
      // The controller's own value cannot pay: its successor must carry at least the same value.
      const holds = available.reduce((sum, fee) => sum + fee.utxo.output.valueSatoshis, 0n);
      const needed = requiredFee(transactionBytes([inputBytes, ...available.map(() => INPUT_BYTES.p2pkh), ...(available.length === 0 ? [INPUT_BYTES.p2pkh] : [])], [this.controllerOutput(next)]), this.feeRate);
      throw new FeeCoinsMissingError(holds, needed, what);
    }
    const payers = choice.coins.map(({ utxo }) => available.find((fee) => fee.utxo === utxo) as AccountCoin);
    const prepared = await this.backend.prepare({
      template: 'controller',
      action,
      role: 'recoverer',
      variables: { identity: hex(this.identity), nextState: hex(encodeControllerState(next)), ...variables },
      inputs: [{ coin, inputIdentifier }, ...payers.map((fee) => ({ coin: fee }))],
      outputs: [{ outputIdentifier: 'controllerOutput' }, ...(choice.changeSatoshis === undefined ? [] : [{ lockingBytecode: feeAddress, valueSatoshis: choice.changeSatoshis }])],
    });
    await this.backend.send(prepared);
    for (const spent of [coin, ...payers]) this.spent.add(`${hex(spent.utxo.transactionHash)}:${spent.utxo.index}`);
    return { transactionId: prepared.transactionId, bytes: prepared.bytes, feeSatoshis: prepared.feeSatoshis, remainderSatoshis: choice.remainderSatoshis };
  }

  /**
   * Send what the fee address holds to another address: for a recoverer that no longer serves the wallet, or
   * that moves its fee coins back to its own balance. The coins are its own.
   *
   * @returns `undefined` when the fee address holds too little to send on
   */
  async returnFeeCoins(toLockingBytecode: Uint8Array): Promise<Sent | undefined> {
    const coins = await this.feeCoins();
    const destination = { lockingBytecode: toLockingBytecode, valueSatoshis: 0n };
    const fee = requiredFee(transactionBytes(coins.map(() => INPUT_BYTES.p2pkh), [destination]), this.feeRate);
    const total = coins.reduce((sum, coin) => sum + coin.utxo.output.valueSatoshis, 0n);
    if (coins.length === 0 || total - fee < smallestOutputValue(destination)) return undefined;
    const prepared = await this.backend.prepare({ template: 'actions', action: 'pay', role: 'owner', inputs: coins.map((coin) => ({ coin })), outputs: [{ ...destination, valueSatoshis: total - fee }] });
    await this.backend.send(prepared);
    for (const coin of coins) this.spent.add(`${hex(coin.utxo.transactionHash)}:${coin.utxo.index}`);
    return { transactionId: prepared.transactionId, bytes: prepared.bytes, feeSatoshis: prepared.feeSatoshis, remainderSatoshis: 0n };
  }

  /**
   * Request recovery to a new owner key. The waiting period starts with the new controller output. Only
   * possible when no request is pending.
   *
   * @throws FeeCoinsMissingError when the fee address does not hold what the request costs
   */
  async request(proposedOwnerKeyHash: Uint8Array): Promise<Sent> {
    const next = afterRequestRecovery(await this.state(), proposedOwnerKeyHash);
    return this.act('requestRecovery', 'requestInput', INPUT_BYTES.controllerRequest, next, { proposedOwnerKeyHash: hex(proposedOwnerKeyHash) }, 'a request');
  }

  /**
   * Complete a pending request after the waiting period: the key named in the request becomes the owner.
   * No coin moves. Before the waiting period has passed, the network refuses the transaction.
   *
   * @throws FeeCoinsMissingError when the fee address does not hold what the completion costs
   */
  async complete(): Promise<Sent> {
    const state = await this.state();
    const next = afterFinalizeRecovery(state);
    return this.act('completeRecovery', 'completeInput', INPUT_BYTES.controller, next, { waitingSequence: encodeChallengeDelay(state.challengeDelay) }, 'a completion');
  }
}
