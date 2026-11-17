import { type Output, type TransactionCommon, encodeTransactionBch } from '@bitauth/libauth';

import {
  type AddressKind,
  type ControllerAction,
  type ControllerState,
  type InputSpec,
  type RecoverableAddressScript,
  type Utxo,
  type VaultAddressScript,
  ADDRESS_KIND,
  addressSecret,
  addressTag,
  controllerInput,
  controllerOutput,
  controllerSuccessor,
  p2pkhInput,
  p2pkhLockingBytecode,
  recoverableAddressScript,
  recoverableInput,
  signInput,
  sweptInput,
  vaultAddressScript,
  vaultInput,
} from '../src/index.js';
import { type Key, type ResolvedSpend, CONTROLLER_VALUE, identity, key, stranger } from './harness.js';

/**
 * A wallet for tests of the two addresses: coins at recoverable and vault addresses, the controller, and a
 * way to put any of them into one transaction. Transactions are assembled as given, without the builder's
 * rules, so that a test can also make the transactions the network must refuse.
 */

export const blindingSeed = new Uint8Array(32).fill(0xb5);
export const funder = key(0x0f);
/** The key of address `number` of a kind. Any key will do in a test; the wallet derives them from its seed. */
export const addressKey = (kind: AddressKind, number: number): Key => key(0x20 + kind * 0x20 + number);

let outpoints = 0;
/** An unspent output at a place of its own. */
export const utxoOf = (output: Output): Utxo => {
  outpoints += 1;
  const transactionHash = new Uint8Array(32).fill(0xe0);
  transactionHash[0] = outpoints & 0xff;
  transactionHash[1] = outpoints >> 8;
  return { transactionHash, index: outpoints % 3, output };
};

export interface Coin {
  utxo: Utxo;
  secret: Uint8Array;
  script: RecoverableAddressScript;
  key: Key;
  /** Spent by the key the address was made for. */
  byKey: () => InputSpec;
  /** Released through the controller of `ofIdentity`, which defaults to the wallet's. */
  swept: (ofIdentity?: Uint8Array) => InputSpec;
}

/** A coin at recoverable address `number` of a kind, of the wallet `ofIdentity`. */
export const coinAt = (
  number: number,
  options: { kind?: AddressKind; valueSatoshis?: bigint; token?: Output['token']; ofIdentity?: Uint8Array } = {},
): Coin => {
  const kind = options.kind ?? ADDRESS_KIND.givenOut;
  const holder = addressKey(kind, number);
  const secret = addressSecret(blindingSeed, kind, number);
  const script = recoverableAddressScript(addressTag(options.ofIdentity ?? identity, secret), holder.keyHash);
  const utxo = utxoOf({
    lockingBytecode: script.lockingBytecode,
    valueSatoshis: options.valueSatoshis ?? 10_000n,
    ...(options.token === undefined ? {} : { token: options.token }),
  });
  return {
    utxo,
    secret,
    script,
    key: holder,
    byKey: () => recoverableInput(utxo, script, holder),
    swept: (ofIdentity = identity) => sweptInput(utxo, script, ofIdentity, secret),
  };
};

export interface VaultCoin {
  utxo: Utxo;
  secret: Uint8Array;
  script: VaultAddressScript;
  input: (ofIdentity?: Uint8Array) => InputSpec;
}

export const vaultCoinAt = (number: number, options: { valueSatoshis?: bigint; token?: Output['token'] } = {}): VaultCoin => {
  const secret = addressSecret(blindingSeed, ADDRESS_KIND.vault, number);
  const script = vaultAddressScript(addressTag(identity, secret));
  const utxo = utxoOf({
    lockingBytecode: script.lockingBytecode,
    valueSatoshis: options.valueSatoshis ?? 10_000n,
    ...(options.token === undefined ? {} : { token: options.token }),
  });
  return { utxo, secret, script, input: (ofIdentity = identity) => vaultInput(utxo, script, ofIdentity, secret) };
};

/** The controller in a given state, as an input for an action, with the output that must follow it. */
export const controllerStep = (
  state: ControllerState,
  action: ControllerAction,
  signer: Key,
  ofIdentity: Uint8Array = identity,
): { input: InputSpec; utxo: Utxo; successor: Output } => {
  const utxo = utxoOf(controllerOutput(ofIdentity, state, CONTROLLER_VALUE));
  return {
    utxo,
    input: controllerInput(utxo, state, action, signer),
    // Closing has no successor; a test that asks for one gets the controller unchanged, to try what must be refused.
    successor: action.kind === 'ownerClose' ? utxo.output : controllerSuccessor(utxo, state, action),
  };
};

/** An ordinary coin that pays a fee. */
export const plainCoin = (valueSatoshis = 5_000n, holder: Key = funder): { utxo: Utxo; input: InputSpec } => {
  const utxo = utxoOf({ lockingBytecode: p2pkhLockingBytecode(holder.keyHash), valueSatoshis });
  return { utxo, input: p2pkhInput(utxo, holder) };
};

export const payment = (valueSatoshis: bigint, to: Key = stranger, token?: Output['token']): Output => ({
  lockingBytecode: p2pkhLockingBytecode(to.keyHash),
  valueSatoshis,
  ...(token === undefined ? {} : { token }),
});

export interface Assembly {
  inputs: InputSpec[];
  outputs: Output[];
  signingType?: number;
  version?: number;
  locktime?: number;
}

/** Sign and assemble a transaction exactly as described. */
export const assemble = ({ inputs, outputs, signingType, version = 2, locktime = 0 }: Assembly): ResolvedSpend => {
  const sourceOutputs = inputs.map(({ utxo }) => utxo.output);
  const transaction: TransactionCommon = {
    version,
    locktime,
    inputs: inputs.map(({ utxo, sequence }) => ({
      outpointTransactionHash: utxo.transactionHash,
      outpointIndex: utxo.index,
      sequenceNumber: sequence ?? 0,
      unlockingBytecode: new Uint8Array(0),
    })),
    outputs,
  };
  const unlocking = inputs.map(({ unlock }, inputIndex) =>
    unlock((privateKey, coveredBytecode) =>
      signInput({ transaction, sourceOutputs, inputIndex, coveredBytecode, privateKey, ...(signingType === undefined ? {} : { signingType }) }),
    ),
  );
  unlocking.forEach((unlockingBytecode, index) => {
    const input = transaction.inputs[index];
    if (input !== undefined) input.unlockingBytecode = unlockingBytecode;
  });
  return { sourceOutputs, transaction };
};

/** The size in bytes of each input of a transaction, as it is encoded. */
export const inputSizes = ({ transaction }: ResolvedSpend): number[] =>
  transaction.inputs.map((input) => {
    const length = input.unlockingBytecode.length;
    const lengthPrefix = length < 0xfd ? 1 : 3;
    return 32 + 4 + lengthPrefix + length + 4;
  });

export const sizeOf = ({ transaction }: ResolvedSpend): number => encodeTransactionBch(transaction).length;
