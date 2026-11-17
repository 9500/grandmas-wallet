import { type Output, binToHex, hash160, hexToBin } from '@bitauth/libauth';
import {
  type AccountCoin,
  type InputSpec,
  type KeyPair,
  type KeyedAddressKind,
  type PreparedTransaction,
  type RecoverableWalletAddress,
  type Role,
  type SeedKeys,
  type TransactionRequest,
  type VaultWalletAddress,
  type WalletBackend,
  type WalletTemplateName,
  ADDRESS_KIND,
  buildTransaction,
  checkBeforeSending,
  controllerScript,
  p2pkhInput,
  p2pkhLockingBytecode,
  recoverableAddressScript,
  recoverableInput,
  sweptInput,
  vaultInput,
} from '@grandmas-wallet/core';

import type { SimulatedChain } from './simulated-chain.js';

/**
 * The wallet's backend without the XO engine: the same keys, derived by this project's own code, and this
 * project's own transaction builder, on the simulated chain.
 *
 * It takes the same requests as an account of the engine and follows the same rules about them, so the
 * wallet's logic can be tested without a network. It signs as the engine does (signing type `0x41`).
 */

/** The engine's signing type for the wallet's templates: all inputs and outputs. */
const ENGINE_SIGNING_TYPE = 0x41;

type Known =
  | { template: 'coins' }
  | { template: 'controller'; identity: Uint8Array }
  | { template: 'givenOut' | 'change'; kind: KeyedAddressKind; number: number; tag: Uint8Array }
  | { template: 'actions'; identity: Uint8Array; earlier: RecoverableWalletAddress }
  | { template: 'actions'; identity: Uint8Array; vault: VaultWalletAddress };

const hex = binToHex;
const bytesOf = (value: string | number | bigint | undefined, name: string): Uint8Array => {
  if (typeof value !== 'string') throw new Error(`The action needs the variable ${name}.`);
  return hexToBin(value);
};

export class KeyBackend implements WalletBackend {
  private readonly known = new Map<string, Known>();
  private readonly prepared = new Map<string, { hex: string; inputs: string[] }>();
  /** Coins named by a prepared transaction that has not been sent or discarded. */
  private readonly held = new Set<string>();
  private readonly counters: Record<KeyedAddressKind, number> = { [ADDRESS_KIND.givenOut]: 0, [ADDRESS_KIND.change]: 0 };
  private nextHandle = 0;

  /**
   * @param keys - the seed's keys. For a recoverer, the credential's: the recovery key in the place of the
   * controller key and the fee key in the place of the funding key.
   */
  constructor(
    private readonly chain: SimulatedChain,
    private readonly keys: Pick<SeedKeys, 'controllerKey' | 'fundingKey' | 'addressKey'>,
  ) {}

  private remember(lockingBytecode: Uint8Array, known: Known): Uint8Array {
    this.known.set(hex(lockingBytecode), known);
    return lockingBytecode;
  }

  async controllerKey(_role: Role): Promise<{ publicKey: Uint8Array; keyHash: Uint8Array }> {
    return { publicKey: this.keys.controllerKey.publicKey, keyHash: hash160(this.keys.controllerKey.publicKey) };
  }

  async ordinaryAddress(): Promise<Uint8Array> {
    return this.remember(p2pkhLockingBytecode(this.keys.fundingKey.keyHash), { template: 'coins' });
  }

  async knowController(identity: Uint8Array): Promise<Uint8Array> {
    return this.remember(controllerScript(identity).lockingBytecode, { template: 'controller', identity });
  }

  async nextAddress(kind: KeyedAddressKind, tag: Uint8Array): Promise<{ lockingBytecode: Uint8Array; number: number }> {
    const number = this.counters[kind];
    this.counters[kind] += 1;
    const script = recoverableAddressScript(tag, this.keys.addressKey(kind, number).keyHash);
    this.remember(script.lockingBytecode, { template: kind === ADDRESS_KIND.givenOut ? 'givenOut' : 'change', kind, number, tag });
    return { lockingBytecode: script.lockingBytecode, number };
  }

  async addressCount(kind: KeyedAddressKind): Promise<number> {
    return this.counters[kind];
  }

  async knowEarlierAddress(identity: Uint8Array, address: RecoverableWalletAddress): Promise<Uint8Array> {
    return this.remember(address.lockingBytecode, { template: 'actions', identity, earlier: address });
  }

  async knowVaultAddress(identity: Uint8Array, address: VaultWalletAddress): Promise<Uint8Array> {
    return this.remember(address.lockingBytecode, { template: 'actions', identity, vault: address });
  }

  async coins(): Promise<AccountCoin[]> {
    const coins: AccountCoin[] = [];
    for (const [lockingBytecode, known] of this.known) {
      const heights = new Map((await this.chain.listUnspent(hexToBin(lockingBytecode))).map((entry) => [`${entry.transactionId}:${entry.index}`, entry.height]));
      for (const utxo of this.chain.outputsAt(hexToBin(lockingBytecode))) {
        const place = `${hex(utxo.transactionHash)}:${utxo.index}`;
        if (this.held.has(place)) continue;
        coins.push({ utxo, template: known.template as WalletTemplateName, height: heights.get(place) ?? 0 });
      }
    }
    return coins;
  }

  /** The input that spends a coin the way its script says, as the engine would unlock it. */
  private inputFor(coin: AccountCoin, request: TransactionRequest, inputIdentifier: string | undefined): InputSpec {
    const known = this.known.get(hex(coin.utxo.output.lockingBytecode));
    if (known === undefined) throw new Error('The transaction names a coin at a script this account does not follow.');
    const variables = request.variables ?? {};
    switch (known.template) {
      case 'coins':
        return p2pkhInput(coin.utxo, this.keys.fundingKey);
      case 'givenOut':
      case 'change': {
        const key = this.keys.addressKey(known.kind, known.number);
        return recoverableInput(coin.utxo, recoverableAddressScript(known.tag, key.keyHash), key);
      }
      case 'actions':
        return 'earlier' in known
          ? sweptInput(coin.utxo, known.earlier.script, known.identity, known.earlier.secret)
          : vaultInput(coin.utxo, known.vault.script, known.identity, known.vault.secret);
      case 'controller': {
        if (request.template !== 'controller') throw new Error('The controller is spent by an action of its own template.');
        const script = controllerScript(known.identity);
        const key: KeyPair = this.keys.controllerKey;
        const authorized = (sign: Parameters<InputSpec['unlock']>[0]) => ({ publicKey: key.publicKey, signature: sign(key.privateKey, script.redeemBytecode) });
        switch (inputIdentifier) {
          case 'approveInput':
            return { utxo: coin.utxo, unlock: (sign) => script.unlock.ownerAuthorize(authorized(sign)) };
          case 'closeInput':
            return { utxo: coin.utxo, unlock: (sign) => script.unlock.ownerClose(authorized(sign)) };
          case 'requestInput':
            return { utxo: coin.utxo, unlock: (sign) => script.unlock.requestRecovery(authorized(sign), bytesOf(variables['proposedOwnerKeyHash'], 'proposedOwnerKeyHash')) };
          case 'completeInput':
            return { utxo: coin.utxo, sequence: Number(variables['waitingSequence']), unlock: (sign) => script.unlock.finalizeRecovery(authorized(sign)) };
          case 'changeSettingsInput':
            return {
              utxo: coin.utxo,
              unlock: (sign) =>
                script.unlock.ownerUpdate(authorized(sign), {
                  ownerKeyHash: bytesOf(variables['newOwnerKeyHash'], 'newOwnerKeyHash'),
                  recovererKeyHash: bytesOf(variables['newRecovererKeyHash'], 'newRecovererKeyHash'),
                  challengeDelay: bytesOf(variables['newDelay'], 'newDelay'),
                }),
            };
          default:
            throw new Error(`The controller template has no input "${String(inputIdentifier)}".`);
        }
      }
    }
  }

  private outputFor(output: { outputIdentifier: string } | Output, request: TransactionRequest): Output {
    if (!('outputIdentifier' in output)) return output;
    if (request.template !== 'controller' || output.outputIdentifier !== 'controllerOutput') {
      throw new Error(`The ${request.template} template has no output "${output.outputIdentifier}".`);
    }
    const identity = bytesOf(request.variables?.['identity'], 'identity');
    return {
      lockingBytecode: controllerScript(identity).lockingBytecode,
      valueSatoshis: 1_000n,
      token: { amount: 0n, category: identity, nft: { capability: 'mutable', commitment: bytesOf(request.variables?.['nextState'], 'nextState') } },
    };
  }

  async prepare(request: TransactionRequest): Promise<PreparedTransaction> {
    const built = buildTransaction({
      inputs: request.inputs.map(({ coin, inputIdentifier }) => this.inputFor(coin, request, inputIdentifier)),
      outputs: request.outputs.map((output) => this.outputFor(output, request)),
      signingType: ENGINE_SIGNING_TYPE,
      // Closing destroys the identity token on purpose; nothing else may drop a token.
      allowTokenBurn: request.template === 'controller' && request.action === 'close',
    });
    const check = checkBeforeSending(built);
    if (check !== true) throw new Error(`The transaction fails the check before sending: ${check}`);
    this.nextHandle += 1;
    const invitationIdentifier = `prepared-${this.nextHandle}`;
    const inputs = request.inputs.map(({ coin }) => `${hex(coin.utxo.transactionHash)}:${coin.utxo.index}`);
    for (const input of inputs) this.held.add(input);
    this.prepared.set(invitationIdentifier, { hex: hex(built.encoded), inputs });
    return { invitationIdentifier, transactionId: built.transactionId, transactionHex: hex(built.encoded), bytes: built.encoded.length, feeSatoshis: built.feeSatoshis };
  }

  async send(prepared: PreparedTransaction): Promise<string> {
    const stored = this.prepared.get(prepared.invitationIdentifier);
    if (stored === undefined) throw new Error('This transaction was not prepared here, or was discarded.');
    const result = await this.chain.broadcast(stored.hex);
    if (!result.accepted) {
      // A refused transaction is put aside, so that the coins it named can be used again.
      await this.discard(prepared.invitationIdentifier);
      throw new Error(`The transaction was refused: ${result.reason}`);
    }
    await this.discard(prepared.invitationIdentifier);
    return result.transactionId;
  }

  async discard(invitationIdentifier: string): Promise<void> {
    for (const input of this.prepared.get(invitationIdentifier)?.inputs ?? []) this.held.delete(input);
    this.prepared.delete(invitationIdentifier);
  }
}
