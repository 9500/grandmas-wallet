import { type Output, binToHex } from '@bitauth/libauth';
import {
  type ChainReader,
  type ControllerAction,
  type ControllerState,
  type KeyPair,
  type Utxo,
  INPUT_BYTES,
  controllerInput,
  controllerSuccessor,
  readControllerHistory,
  requiredFee,
  transactionBytes,
} from '@grandmas-wallet/core';

import type { Sent } from './owner-wallet.js';
import type { RecovererFunds } from './recoverer-funds.js';

/**
 * The recoverer's side of one wallet (proposal sections 9.2, 9.6 and 11.1): its key for the controller, the
 * request and the completion.
 *
 * The recoverer's key signs two kinds of transaction and no other: the request and the completion. Each spends
 * the controller, unlocked with that key, and coins of the recoverer's one balance for the fee, in one
 * transaction; the change goes back to the balance. It never signs for a coin of the wallet, and nothing of the
 * recoverer's is kept at an address of the wallet's own.
 */

const hex = binToHex;
const CONTROLLER_SATOSHIS = 1_000n;

const controllerSized: Output = { lockingBytecode: new Uint8Array(35), valueSatoshis: CONTROLLER_SATOSHIS, token: { amount: 0n, category: new Uint8Array(32), nft: { capability: 'mutable', commitment: new Uint8Array(69) } } };
const balanceChange: Output = { lockingBytecode: new Uint8Array(25), valueSatoshis: 0n };

/**
 * What a recovery costs the recoverer (proposal section 9.6): a request and a completion, each paid by one coin
 * of the balance with its change. The recoverer's page compares its balance with these before it asks.
 */
export const recoveryFees = (feeRate = 1): { request: bigint; completion: bigint } => ({
  request: requiredFee(transactionBytes([INPUT_BYTES.controllerRequest, INPUT_BYTES.p2pkh], [controllerSized, balanceChange]), feeRate),
  completion: requiredFee(transactionBytes([INPUT_BYTES.controller, INPUT_BYTES.p2pkh], [controllerSized, balanceChange]), feeRate),
});

export class RecovererWallet {
  /** Controller outputs that transactions sent from here have spent; a server may list one a moment longer. */
  private readonly spent = new Set<string>();

  private constructor(
    private readonly funds: RecovererFunds,
    private readonly chain: ChainReader,
    readonly identity: Uint8Array,
    private readonly recoveryKey: KeyPair,
    private readonly genesisTransactionId: string | undefined,
  ) {}

  /**
   * Take up a wallet: read and check its controller from the chain.
   *
   * @param options.funds - the recoverer's balance, which pays the fees
   * @param options.recoveryKey - the recoverer's key for this wallet
   * @throws if the identity's creation is not valid, or if the key is not the recoverer in the controller's state
   */
  static async open(options: { funds: RecovererFunds; chain: ChainReader; identity: Uint8Array; recoveryKey: KeyPair; genesisTransactionId?: string }): Promise<RecovererWallet> {
    const history = await readControllerHistory(options.chain, options.identity, options.genesisTransactionId);
    if (hex(history.current.state.recovererKeyHash) !== hex(options.recoveryKey.keyHash)) {
      throw new Error('This recovery key is not the recoverer named in the wallet\'s controller.');
    }
    return new RecovererWallet(options.funds, options.chain, options.identity, options.recoveryKey, options.genesisTransactionId);
  }

  /** The controller as the chain has it now, in a block or not. */
  private async controller(): Promise<{ utxo: Utxo; state: ControllerState }> {
    for (let attempt = 0; attempt < 60; attempt++) {
      const history = await readControllerHistory(this.chain, this.identity, this.genesisTransactionId);
      if (history.closed !== undefined) break;
      const { utxo, state } = history.current;
      // After a transaction of this account, a server may show the output it spent a moment longer.
      if (!this.spent.has(`${hex(utxo.transactionHash)}:${utxo.index}`)) return { utxo, state };
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error('The wallet\'s controller was not found. The owner may have closed the wallet.');
  }

  /** The state of the wallet's controller as the chain has it now. */
  async state(): Promise<ControllerState> {
    return (await this.controller()).state;
  }

  /** A transaction of the controller, unlocked with the recovery key, with the fee from the recoverer's balance. */
  private async act(action: ControllerAction, inputBytes: number, what: string, reserved: Set<string> | undefined): Promise<Sent> {
    const { utxo, state } = await this.controller();
    const sent = await this.funds.payFor({
      inputs: [{ ...controllerInput(utxo, state, action, this.recoveryKey), inputBytes }],
      outputs: [controllerSuccessor(utxo, state, action)],
      what,
      ...(reserved === undefined ? {} : { reserved }),
    });
    this.spent.add(`${hex(utxo.transactionHash)}:${utxo.index}`);
    return sent;
  }

  /**
   * Request recovery to a new owner key. The waiting period starts with the new controller output. Only
   * possible when no request is pending.
   *
   * @param options.reserved - identities unfinished creations of this recoverer are named after: their coins do not pay
   * @throws FundsMissingError when the balance does not hold what the request costs
   */
  async request(proposedOwnerKeyHash: Uint8Array, options: { reserved?: Set<string> } = {}): Promise<Sent> {
    return this.act({ kind: 'requestRecovery', proposedOwnerKeyHash }, INPUT_BYTES.controllerRequest, 'a request', options.reserved);
  }

  /**
   * Complete a pending request after the waiting period: the key named in the request becomes the owner.
   * No coin of the wallet moves. Before the waiting period has passed, the network refuses the transaction.
   *
   * @throws FundsMissingError when the balance does not hold what the completion costs
   */
  async complete(options: { reserved?: Set<string> } = {}): Promise<Sent> {
    return this.act({ kind: 'finalizeRecovery' }, INPUT_BYTES.controller, 'a completion', options.reserved);
  }
}
