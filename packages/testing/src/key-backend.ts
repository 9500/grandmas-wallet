import { type Output, binToHex, hash160, hexToBin } from '@bitauth/libauth';
import {
  type AccountCoin,
  type FollowedScript,
  type GivenUnlocking,
  type InputSpec,
  type KeyPair,
  type KeyedAddressKind,
  type PreparedTransaction,
  type ReadTemplate,
  type RecoverableWalletAddress,
  type Role,
  type SeedKeys,
  type SharedActionFinish,
  type SharedActionStart,
  type SharedInvitationStarted,
  type SharedInvitationTaken,
  type TemplateValues,
  type TransactionRequest,
  type Utxo,
  type VaultWalletAddress,
  type WalletBackend,
  type WalletTemplateName,
  ADDRESS_KIND,
  InvitationNotTakenError,
  buildTransaction,
  checkBeforeSending,
  controllerScript,
  invitationFromText,
  invitationParts,
  invitationToText,
  p2pkhInput,
  p2pkhLockingBytecode,
  readTemplate,
  recoverableAddressScript,
  recoverableInput,
  sweptInput,
  templateLockingBytecode,
  templateOutput,
  templateSequenceNumber,
  templateTransaction,
  templateUnlockingBytecode,
  typedValues,
  vaultInput,
} from '@grandmas-wallet/core';

import type { SimulatedChain } from './simulated-chain.js';

/** An XO invitation as the engine's types give it, read from core's reader so that this package needs no engine. */
type Invitation = ReturnType<typeof invitationFromText>;

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
  | { template: 'actions'; identity: Uint8Array; vault: VaultWalletAddress }
  /** A script of a template that is not the wallet's own. */
  | { template: string; imported: FollowedScript };

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
  /** Templates that are not the wallet's own, by identifier. */
  private readonly imported = new Map<string, ReadTemplate>();
  /** Invitations started for another participant to join, by identifier. */
  private readonly shared = new Map<string, { invitation: Invitation; entity: string; request: SharedActionStart; coins: AccountCoin[] }>();

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
  private inputFor(coin: AccountCoin, request: TransactionRequest, inputIdentifier: string | undefined, unlocking?: GivenUnlocking): InputSpec {
    // A coin of an application's contract given with its unlocking, as the engine takes another participant's input.
    if (unlocking !== undefined) return { utxo: coin.utxo, sequence: unlocking.sequenceNumber, unlock: () => unlocking.bytecode };
    const known = this.known.get(hex(coin.utxo.output.lockingBytecode));
    if (known === undefined) throw new Error('The transaction names a coin at a script this account does not follow.');
    const variables = request.variables ?? {};
    if ('imported' in known) {
      // A coin of an application's template is unlocked the way the template says, with no key of the account.
      const template = this.imported.get(known.template);
      if (template === undefined || request.template !== known.template) throw new Error('A coin of another template is spent by an action of its own template.');
      const values = typedValues(template.definition, { ...known.imported.variables, ...variables });
      const unlocking = templateUnlockingBytecode(template.definition, known.imported.lockingScript, inputIdentifier, values);
      const sequence = inputIdentifier === undefined ? undefined : templateSequenceNumber(template.definition, inputIdentifier, values);
      return { utxo: coin.utxo, ...(sequence === undefined ? {} : { sequence }), unlock: () => unlocking };
    }
    switch (known.template as WalletTemplateName) {
      case 'coins':
        return p2pkhInput(coin.utxo, this.keys.fundingKey);
      case 'givenOut':
      case 'change': {
        if (!('kind' in known)) throw new Error('unreachable');
        const key = this.keys.addressKey(known.kind, known.number);
        return recoverableInput(coin.utxo, recoverableAddressScript(known.tag, key.keyHash), key);
      }
      case 'actions':
        if (!('identity' in known) || known.template !== 'actions') throw new Error('unreachable');
        return 'earlier' in known
          ? sweptInput(coin.utxo, known.earlier.script, known.identity, known.earlier.secret)
          : vaultInput(coin.utxo, known.vault.script, known.identity, known.vault.secret);
      case 'controller': {
        if (!('identity' in known)) throw new Error('unreachable');
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
    const imported = this.imported.get(request.template);
    if (imported !== undefined) return templateOutput(imported.definition, output.outputIdentifier, typedValues(imported.definition, request.variables ?? {}));
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
    const imported = this.imported.get(request.template);
    const built = buildTransaction({
      inputs: request.inputs.map(({ coin, inputIdentifier, unlocking }) => this.inputFor(coin, request, inputIdentifier, unlocking)),
      outputs: request.outputs.map((output) => this.outputFor(output, request)),
      // An action of an application's template has the lock time its template gives it.
      ...(imported === undefined ? {} : { locktime: templateTransaction(imported.definition, request.action, typedValues(imported.definition, request.variables ?? {})).locktime }),
      signingType: ENGINE_SIGNING_TYPE,
      // Closing destroys the identity token on purpose. An application's action may destroy tokens of the
      // application's coins, or send tokens to a data output; the wallet has checked that none of its own is
      // dropped, and the network's rules decide the rest.
      allowTokenBurn: (request.template === 'controller' && request.action === 'close') || imported !== undefined,
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

  /**
   * Start an invitation another participant joins, as the engine would: one commit of the wallet's entity with its
   * role, its values tagged with that role and its coins, which are held. The commit carries no real signature: this
   * backend holds no XO key, and its `takeShared` compares the wallet's commits whole instead.
   */
  async startShared(request: SharedActionStart): Promise<SharedInvitationStarted> {
    const template = this.imported.get(request.template);
    if (template === undefined) throw new Error('This account does not hold that template.');
    this.nextHandle += 1;
    const invitationIdentifier = `shared-${this.nextHandle}`;
    const now = Date.now();
    const variables = Object.entries(typedValues(template.definition, request.variables ?? {})).map(([variableIdentifier, value]) => ({ variableIdentifier, roleIdentifier: request.role, value }));
    const inputs = request.inputs.map(({ coin, inputIdentifier }) => ({ outpointTransactionHash: coin.utxo.transactionHash, outpointIndex: coin.utxo.index, ...(inputIdentifier === undefined ? {} : { inputIdentifier }) }));
    const invitation = {
      invitationIdentifier,
      createdAtTimestamp: now,
      templateIdentifier: request.template,
      actionIdentifier: request.action,
      commits: [
        {
          commitIdentifier: `${invitationIdentifier}-1`,
          previousCommitIdentifier: undefined,
          entityIdentifier: `entity-${invitationIdentifier}`,
          createdAtTimestamp: now,
          expiresAtTimestamp: now + 3_600_000,
          signature: 'test-backend',
          data: { roleIdentifier: request.role, ...(variables.length === 0 ? {} : { variables }), ...(inputs.length === 0 ? {} : { inputs }) },
        },
      ],
    } as Invitation;
    const coins = request.inputs.map(({ coin }) => coin);
    for (const coin of coins) this.held.add(`${hex(coin.utxo.transactionHash)}:${coin.utxo.index}`);
    this.shared.set(invitationIdentifier, { invitation, entity: `entity-${invitationIdentifier}`, request, coins });
    return { invitationIdentifier, text: invitationToText(invitation) };
  }

  /**
   * Take the invitation back as the engine's `updateInvitation` would: the commits held come first and unchanged
   * (where the engine verifies signatures, this backend compares them whole), and each later commit follows the one
   * before. Nothing the other participant added is judged.
   */
  async takeShared(invitationIdentifier: string, text: string): Promise<SharedInvitationTaken> {
    const started = this.shared.get(invitationIdentifier);
    if (started === undefined) throw new InvitationNotTakenError('This account started no such invitation, or has put it aside.', 'not-started');
    let received: Invitation;
    try {
      received = invitationFromText(text);
    } catch (error) {
      throw new InvitationNotTakenError(`The invitation cannot be read: ${(error as Error).message.slice(0, 200)}`, 'changed');
    }
    const held = started.invitation;
    const alone = (commit: Invitation['commits'][number] | undefined): string => (commit === undefined ? '' : invitationToText({ ...held, commits: [commit] }));
    if (received.invitationIdentifier !== held.invitationIdentifier || received.templateIdentifier !== held.templateIdentifier || received.actionIdentifier !== held.actionIdentifier) {
      throw new InvitationNotTakenError('The invitation is another one.', 'not-valid');
    }
    if (held.commits.some((commit, index) => alone(commit) !== alone(received.commits[index]))) throw new InvitationNotTakenError('A commit the wallet made was changed: its signature would not verify.', 'not-valid');
    for (let index = held.commits.length; index < received.commits.length; index++) {
      if (received.commits[index]?.previousCommitIdentifier !== received.commits[index - 1]?.commitIdentifier) throw new InvitationNotTakenError('A commit does not follow the one before it.', 'not-valid');
    }
    started.invitation = received;
    const { own, others } = invitationParts(received, started.entity);
    return { invitationIdentifier, own, others };
  }

  /**
   * The wallet's part after the other participant's, built as the engine builds it: the values merged with the last
   * writer winning; every item placed where it says or where the template places it, the others after them in the
   * order they were committed; an output's stated fields over what the template works out. Then signed and checked
   * before sending as `prepare` does.
   */
  async finishShared(request: SharedActionFinish): Promise<PreparedTransaction> {
    const { invitationIdentifier } = request;
    const started = this.shared.get(invitationIdentifier);
    if (started === undefined) throw new Error('This account started no such invitation, or has put it aside.');
    try {
      const template = this.imported.get(started.request.template);
      if (template === undefined) throw new Error('This account does not hold that template.');
      const { definition } = template;
      const { invitation } = started;
      const merged: TemplateValues = {};
      for (const commit of invitation.commits) for (const variable of commit.data.variables ?? []) merged[variable.variableIdentifier] = typeof variable.value === 'boolean' ? String(variable.value) : variable.value;
      const values = typedValues(definition, merged);
      const shape = templateTransaction(definition, started.request.action, values);
      const inputPlace = new Map(shape.inputs.map(({ input, index }) => [input, index]));
      const outputPlace = new Map(shape.outputs.map(({ output, index }) => [output, index]));
      const asRequest: TransactionRequest = { template: started.request.template, action: started.request.action, role: started.request.role, variables: merged, inputs: [], outputs: [] };
      const ownCoins = new Map([...started.coins, ...request.inputs.map(({ coin }) => coin)].map((coin) => [`${hex(coin.utxo.transactionHash)}:${coin.utxo.index}`, coin]));
      const theirCoins = new Map<string, Utxo>(request.theirCoins.map((utxo) => [`${hex(utxo.transactionHash)}:${utxo.index}`, utxo]));
      const inputs: { spec: InputSpec; place: number | undefined }[] = [];
      const outputs: { output: Output; place: number | undefined }[] = [];
      for (const commit of invitation.commits) {
        const own = commit.entityIdentifier === started.entity;
        for (const input of commit.data.inputs ?? []) {
          if (input.mergesWith !== undefined) throw new Error('This backend does not merge items of different commits.');
          const outpoint = `${hex(input.outpointTransactionHash ?? new Uint8Array())}:${input.outpointIndex ?? -1}`;
          const place = input.transactionIndex ?? (input.inputIdentifier === undefined ? undefined : inputPlace.get(input.inputIdentifier));
          if (own) {
            const coin = ownCoins.get(outpoint);
            if (coin === undefined) throw new Error('The invitation names a coin of the wallet\'s that it did not bring.');
            inputs.push({ spec: this.inputFor(coin, asRequest, input.inputIdentifier), place });
          } else {
            const utxo = theirCoins.get(outpoint);
            if (utxo === undefined) throw new Error('The invitation names a coin of the other participant\'s that the wallet did not read.');
            const unlocking = input.unlockingBytecode ?? new Uint8Array();
            inputs.push({ spec: { utxo, sequence: input.sequenceNumber ?? 0, unlock: () => unlocking }, place });
          }
        }
        for (const output of commit.data.outputs ?? []) {
          if (output.mergesWith !== undefined) throw new Error('This backend does not merge items of different commits.');
          const place = output.transactionIndex ?? (output.outputIdentifier === undefined ? undefined : outputPlace.get(output.outputIdentifier));
          const compiled = output.outputIdentifier === undefined ? undefined : templateOutput(definition, output.outputIdentifier, values);
          const lockingBytecode = output.lockingBytecode ?? compiled?.lockingBytecode;
          const valueSatoshis = output.valueSatoshis === undefined ? compiled?.valueSatoshis : BigInt(output.valueSatoshis);
          if (lockingBytecode === undefined || valueSatoshis === undefined) throw new Error('An output of the invitation has no script or no value.');
          const token = output.token === undefined ? compiled?.token : (output.token as Output['token']);
          outputs.push({ output: { lockingBytecode, valueSatoshis, ...(token === undefined ? {} : { token }) }, place });
        }
      }
      for (const { coin, inputIdentifier } of request.inputs) inputs.push({ spec: this.inputFor(coin, asRequest, inputIdentifier), place: inputIdentifier === undefined ? undefined : inputPlace.get(inputIdentifier) });
      for (const output of request.outputs) {
        outputs.push('outputIdentifier' in output ? { output: templateOutput(definition, output.outputIdentifier, values), place: outputPlace.get(output.outputIdentifier) } : { output, place: undefined });
      }
      const byPlace = <Item extends { place: number | undefined }>(items: Item[]): Item[] => items.map((item, order) => ({ item, order })).sort((a, b) => (a.item.place ?? Infinity) - (b.item.place ?? Infinity) || a.order - b.order).map(({ item }) => item);
      const built = buildTransaction({
        inputs: byPlace(inputs).map(({ spec }) => spec),
        outputs: byPlace(outputs).map(({ output }) => output),
        locktime: shape.locktime,
        signingType: ENGINE_SIGNING_TYPE,
        // As for an action of an application's template in `prepare`.
        allowTokenBurn: true,
      });
      const check = checkBeforeSending(built);
      if (check !== true) throw new Error(`The transaction fails the check before sending: ${check}`);
      const held = [...ownCoins.keys()];
      for (const outpoint of held) this.held.add(outpoint);
      this.shared.delete(invitationIdentifier);
      this.prepared.set(invitationIdentifier, { hex: hex(built.encoded), inputs: held });
      return { invitationIdentifier, transactionId: built.transactionId, transactionHex: hex(built.encoded), bytes: built.encoded.length, feeSatoshis: built.feeSatoshis };
    } catch (error) {
      await this.abandonShared(invitationIdentifier);
      throw error;
    }
  }

  async abandonShared(invitationIdentifier: string): Promise<void> {
    for (const coin of this.shared.get(invitationIdentifier)?.coins ?? []) this.held.delete(`${hex(coin.utxo.transactionHash)}:${coin.utxo.index}`);
    this.shared.delete(invitationIdentifier);
    await this.discard(invitationIdentifier);
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

  async importTemplate(text: string): Promise<string> {
    const template = readTemplate(text);
    this.imported.set(template.identifier, template);
    return template.identifier;
  }

  async followScript(script: FollowedScript): Promise<Uint8Array> {
    const template = this.imported.get(script.template);
    if (template === undefined) throw new Error('This account does not hold that template.');
    const lockingBytecode = templateLockingBytecode(template.definition, script.lockingScript, typedValues(template.definition, script.variables));
    return this.remember(lockingBytecode, { template: script.template, imported: script });
  }
}
