import { binToHex, hexToBin } from '@bitauth/libauth';
import {
  type BuiltTransaction,
  type ChallengeDelay,
  type ControllerAction,
  type ControllerState,
  type KeyPair,
  type Utxo,
  buildTransaction,
  controllerInput,
  controllerOutput,
  controllerScript,
  controllerSuccessor,
  decodeControllerState,
  keyPairFromPrivateKey,
  p2pkhInput,
  p2pkhLockingBytecode,
} from '@grandmas-wallet/core';

import type { SimulatedChain } from './simulated-chain.js';

/**
 * A wallet's controller on the simulated chain, driven directly with keys:
 * enough to create one, act as its owner, and take it through a recovery in
 * a test. It holds no coins besides the controller.
 */

export const testKey = (byte: number): KeyPair => keyPairFromPrivateKey(new Uint8Array(32).fill(byte));

export interface TestWalletOptions {
  owner: KeyPair;
  recovererKeyHash: Uint8Array;
  challengeDelay?: ChallengeDelay;
}

export class TestWallet {
  private constructor(
    readonly chain: SimulatedChain,
    readonly identity: Uint8Array,
    readonly genesisTransactionId: string,
  ) {}

  static create(chain: SimulatedChain, options: TestWalletOptions): TestWallet {
    const funder = testKey(0xf0);
    const funderLocking = p2pkhLockingBytecode(funder.keyHash);
    // The identity is named after the transaction whose first output its creation spends.
    const identityHex = chain.fund(funderLocking, 5_000n);
    const identity = hexToBin(identityHex);
    const [funding] = chain.outputsAt(funderLocking).filter((utxo) => binToHex(utxo.transactionHash) === identityHex);
    if (funding === undefined) throw new Error('funding output missing');
    const state: ControllerState = {
      version: 1,
      status: 'active',
      ownerEpoch: 0,
      ownerKeyHash: options.owner.keyHash,
      recovererKeyHash: options.recovererKeyHash,
      challengeDelay: options.challengeDelay ?? { unit: 'time512', value: 1 },
    };
    const built = buildTransaction({
      inputs: [p2pkhInput(funding, funder)],
      outputs: [controllerOutput(identity, state, 1_000n)],
      changeLockingBytecode: funderLocking,
    });
    const wallet = new TestWallet(chain, identity, built.transactionId);
    wallet.send(built);
    return wallet;
  }

  get identityHex(): string {
    return binToHex(this.identity);
  }

  controller(): { utxo: Utxo; state: ControllerState } {
    const [utxo] = this.chain.outputsAt(controllerScript(this.identity).lockingBytecode);
    const commitment = utxo?.output.token?.nft?.commitment;
    if (utxo === undefined || commitment === undefined) throw new Error('the controller is not on the chain');
    return { utxo, state: decodeControllerState(commitment) };
  }

  /** Submit a transaction that must be accepted. */
  send(built: BuiltTransaction): string {
    const result = this.chain.submit(binToHex(built.encoded));
    if (!result.accepted) throw new Error(`refused: ${result.reason}`);
    return result.transactionId;
  }

  /** A controller action, with the fee paid from a coin of the signer's own. */
  private act(signer: KeyPair, action: ControllerAction): string {
    const { utxo, state } = this.controller();
    const feeLocking = p2pkhLockingBytecode(signer.keyHash);
    const feeId = this.chain.fund(feeLocking, 5_000n);
    const [fee] = this.chain.outputsAt(feeLocking).filter((coin) => binToHex(coin.transactionHash) === feeId);
    if (fee === undefined) throw new Error('fee coin missing');
    return this.send(
      buildTransaction({
        inputs: [controllerInput(utxo, state, action, signer), p2pkhInput(fee, signer)],
        outputs: [controllerSuccessor(utxo, state, action)],
        changeLockingBytecode: feeLocking,
      }),
    );
  }

  /** The owner approves a transaction; this also cancels a pending recovery request. */
  authorize(owner: KeyPair): string {
    return this.act(owner, { kind: 'ownerAuthorize' });
  }

  requestRecovery(recoverer: KeyPair, proposedOwnerKeyHash: Uint8Array): string {
    return this.act(recoverer, { kind: 'requestRecovery', proposedOwnerKeyHash });
  }

  /** Complete a pending recovery; the chain's clock is moved past the challenge delay first. */
  finalizeRecovery(recoverer: KeyPair): string {
    this.chain.nowMs += 2 * 512 * 1000;
    return this.act(recoverer, { kind: 'finalizeRecovery' });
  }

  /** Request and complete a recovery in one go. */
  recover(recoverer: KeyPair, newOwner: KeyPair): void {
    this.requestRecovery(recoverer, newOwner.keyHash);
    this.finalizeRecovery(recoverer);
  }
}
