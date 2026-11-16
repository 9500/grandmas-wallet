import { type Output, binToHex, hexToBin } from '@bitauth/libauth';
import {
  type BuiltTransaction,
  type ChallengeDelay,
  type ControllerAction,
  type ControllerState,
  type KeyPair,
  type ProtectedScript,
  type Utxo,
  assetScript,
  buildTransaction,
  controllerInput,
  controllerOutput,
  controllerScript,
  controllerSuccessor,
  decodeControllerState,
  keyPairFromPrivateKey,
  p2pkhInput,
  p2pkhLockingBytecode,
  protectedInput,
  savingsJarScript,
} from '@grandmas-wallet/core';

import type { SimulatedChain } from './simulated-chain.js';

/**
 * A wallet on the simulated chain, driven directly with keys: enough to
 * create one, use it, and take it through a recovery in a test.
 */

export const testKey = (byte: number): KeyPair => keyPairFromPrivateKey(new Uint8Array(32).fill(byte));

export interface TestWalletOptions {
  owner: KeyPair;
  recovererKeyHash: Uint8Array;
  challengeDelay?: ChallengeDelay;
  /** Satoshis put into the wallet's funds at creation. */
  funds?: bigint;
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
    const identityHex = chain.fund(funderLocking, (options.funds ?? 50_000n) + 5_000n);
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
      changeLockingBytecode: assetScript(identity).lockingBytecode,
    });
    const wallet = new TestWallet(chain, identity, built.transactionId);
    wallet.send(built);
    return wallet;
  }

  get identityHex(): string {
    return binToHex(this.identity);
  }

  get funds(): ProtectedScript {
    return assetScript(this.identity);
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

  /** An owner-approved transaction: spends the wallet's funds and any given positions; change returns to the funds. */
  ownerTransaction(key: KeyPair, outputs: Output[], positions: { utxo: Utxo; script: ProtectedScript }[] = [], locktime?: number): BuiltTransaction {
    const { utxo, state } = this.controller();
    const action: ControllerAction = { kind: 'ownerAuthorize' };
    return buildTransaction({
      inputs: [
        controllerInput(utxo, state, action, key),
        ...this.chain.outputsAt(this.funds.lockingBytecode).map((coin) => protectedInput(coin, this.funds)),
        ...positions.map((position) => protectedInput(position.utxo, position.script)),
      ],
      outputs: [controllerSuccessor(utxo, state, action), ...outputs],
      changeLockingBytecode: this.funds.lockingBytecode,
      ...(locktime === undefined ? {} : { locktime }),
    });
  }

  /** Pay from the wallet's funds to any script. */
  pay(key: KeyPair, lockingBytecode: Uint8Array, valueSatoshis: bigint): string {
    return this.send(this.ownerTransaction(key, [{ lockingBytecode, valueSatoshis }]));
  }

  jar(unlockTime: number): ProtectedScript {
    return savingsJarScript(this.identity, unlockTime);
  }

  /** The transaction that opens a savings jar, not yet sent. */
  openJarTransaction(key: KeyPair, unlockTime: number, valueSatoshis = 5_000n): BuiltTransaction {
    return this.ownerTransaction(key, [{ lockingBytecode: this.jar(unlockTime).lockingBytecode, valueSatoshis }]);
  }

  /** Empty a savings jar back into the wallet's funds. */
  emptyJar(key: KeyPair, unlockTime: number): string {
    const script = this.jar(unlockTime);
    const positions = this.chain.outputsAt(script.lockingBytecode).map((utxo) => ({ utxo, script }));
    return this.send(this.ownerTransaction(key, [], positions, unlockTime));
  }

  /** A controller action by the recoverer, paying the fee from a coin of its own. */
  private recovererAction(recoverer: KeyPair, action: ControllerAction): string {
    const { utxo, state } = this.controller();
    const feeLocking = p2pkhLockingBytecode(recoverer.keyHash);
    const feeId = this.chain.fund(feeLocking, 5_000n);
    const [fee] = this.chain.outputsAt(feeLocking).filter((coin) => binToHex(coin.transactionHash) === feeId);
    if (fee === undefined) throw new Error('fee coin missing');
    return this.send(
      buildTransaction({
        inputs: [controllerInput(utxo, state, action, recoverer), p2pkhInput(fee, recoverer)],
        outputs: [controllerSuccessor(utxo, state, action)],
        changeLockingBytecode: feeLocking,
      }),
    );
  }

  requestRecovery(recoverer: KeyPair, proposedOwnerKeyHash: Uint8Array): string {
    return this.recovererAction(recoverer, { kind: 'requestRecovery', proposedOwnerKeyHash });
  }

  /** Complete a pending recovery; the chain's clock is moved past the challenge delay first. */
  finalizeRecovery(recoverer: KeyPair): string {
    this.chain.nowMs += 2 * 512 * 1000;
    return this.recovererAction(recoverer, { kind: 'finalizeRecovery' });
  }

  /** Request and complete a recovery in one go. */
  recover(recoverer: KeyPair, newOwner: KeyPair): void {
    this.requestRecovery(recoverer, newOwner.keyHash);
    this.finalizeRecovery(recoverer);
  }
}
