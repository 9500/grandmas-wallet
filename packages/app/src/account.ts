import { binToHex, decodeTransactionBch, hash160, hexToBin } from '@bitauth/libauth';
import {
  type AccountCoin,
  type KeyedAddressKind,
  type PreparedTransaction,
  type RecoverableWalletAddress,
  type Role,
  type TransactionRequest,
  type VaultWalletAddress,
  type WalletBackend,
  type WalletTemplateName,
  ADDRESS_KIND,
  checkBeforeSending,
} from '@grandmas-wallet/core';
import type { Engine } from '@xo-cash/engine';

import { WALLET_TEMPLATES } from './templates.js';

/**
 * One account of the XO engine with the wallet's templates: the owner's device, or the recoverer's.
 *
 * The engine holds the keys, signs, follows scripts and builds each transaction from a template. This
 * class is the thin layer between it and the wallet's code, which says which coins a transaction spends
 * and what its outputs are, to the satoshi (proposal section 13.2). Every transaction is checked with this
 * project's own rules before it is sent.
 *
 * Only one engine can be open in a process or a page.
 */

interface IntentLike {
  action: string;
  role?: string;
}

/** The intent a role acts on: the template's start entry, or a follow-up offered by one of its scripts. */
const intentFor = (template: WalletTemplateName, action: string, role: Role): IntentLike => {
  const definition = WALLET_TEMPLATES[template] as unknown as {
    start?: IntentLike[];
    lockingScripts?: Record<string, { roles?: Record<string, { actions?: IntentLike[] }> }>;
  };
  const start = definition.start?.find((intent) => intent.action === action && intent.role === role);
  if (start !== undefined) return start;
  for (const script of Object.values(definition.lockingScripts ?? {})) {
    const followUp = script.roles?.[role]?.actions?.find((intent) => intent.action === action);
    if (followUp !== undefined) return followUp;
  }
  throw new Error(`The ${template} template offers no action "${action}" to the ${role}.`);
};

const KEY_OF_ROLE: Record<Role, { secret: string; action: string }> = {
  owner: { secret: 'controllerKey', action: 'create' },
  recoverer: { secret: 'recovererKey', action: 'takeUp' },
};

const wait = (milliseconds: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, milliseconds));
const hex = binToHex;

export class Account implements WalletBackend {
  /** The invitation the controller key was made for: the handle by which the engine finds that key again. */
  private keyInvitation: Partial<Record<Role, string>> = {};
  private ordinary: Uint8Array | undefined;

  private constructor(
    private readonly engine: Engine,
    /** The identifier the engine gave each of the wallet's templates. */
    readonly templates: Record<WalletTemplateName, string>,
  ) {}

  /**
   * Bring the wallet's templates to an engine and wait until it can be relied on.
   *
   * What the engine hears about a transaction before its header check has reached the tip is dropped and
   * not asked for again, so nothing is made known to it before then.
   */
  static async open(engine: Engine, options: { headerCheckTimeoutMs?: number } = {}): Promise<Account> {
    const deadline = Date.now() + (options.headerCheckTimeoutMs ?? 120_000);
    for (;;) {
      const status = await engine.getChainStatus();
      if (status.verifiedHeight >= status.currentHeight) break;
      if (Date.now() > deadline) {
        throw new Error(`The engine's header check stands at ${status.verifiedHeight} of ${status.currentHeight}; what it reports cannot be relied on.`);
      }
      await wait(500);
    }
    const templates = {} as Record<WalletTemplateName, string>;
    for (const name of Object.keys(WALLET_TEMPLATES) as WalletTemplateName[]) {
      templates[name] = (await engine.importTemplate(WALLET_TEMPLATES[name])).templateIdentifier;
    }
    const account = new Account(engine, templates);
    await engine.setDefaultPolicies(account.coinPolicies);
    return account;
  }

  private get coinPolicies() {
    const templateIdentifier = this.templates.coins;
    return { change: { templateIdentifier }, receive: { templateIdentifier }, address: { templateIdentifier } };
  }

  /** Make one script known through a template's defaults, and leave the account's ordinary policies as they were. */
  private async withPolicy<Result>(policy: 'address' | 'receive', template: WalletTemplateName, work: () => Promise<Result>): Promise<Result> {
    await this.engine.setDefaultPolicies({ ...this.coinPolicies, [policy]: { templateIdentifier: this.templates[template] } });
    try {
      return await work();
    } finally {
      await this.engine.setDefaultPolicies(this.coinPolicies);
    }
  }

  private async secretsOf(template: WalletTemplateName, secretIdentifier: string): Promise<{ number: number; publicKey: Uint8Array }[]> {
    const secrets = (await this.engine.listSecretData()).filter((secret) => secret.secretIdentifier === secretIdentifier && secret.templateIdentifier === this.templates[template]);
    const keys: { number: number; publicKey: Uint8Array }[] = [];
    for (const secret of secrets) {
      const publicKey = await this.engine.getSecretPublicKey(secret.secretLookupKey);
      if (publicKey !== undefined) keys.push({ number: Number(secret.value), publicKey: hexToBin(publicKey) });
    }
    return keys.sort((a, b) => a.number - b.number);
  }

  /**
   * The account's key for the controller: the owner's controller key, or the recoverer's recovery key. It
   * is the first key under the controller template, made on first use; the same seed always gives the same one.
   */
  async controllerKey(role: Role): Promise<{ publicKey: Uint8Array; keyHash: Uint8Array }> {
    const { secret, action } = KEY_OF_ROLE[role];
    if (this.keyInvitation[role] === undefined) {
      // An engine whose state was kept has the invitation already; a second one would make a second key.
      const existing = (await this.engine.listInvitations())
        .filter(({ invitation }) => invitation.templateIdentifier === this.templates.controller && invitation.actionIdentifier === action)
        .sort((a, b) => (a.createdAtTimestampMs ?? 0) - (b.createdAtTimestampMs ?? 0))[0];
      const stored =
        existing ??
        (await this.engine.createInvitation({
          templateIdentifier: this.templates.controller,
          actionIdentifier: action,
          intent: intentFor('controller', action, role),
        } as Parameters<Engine['createInvitation']>[0]));
      this.keyInvitation[role] = stored.invitation.invitationIdentifier;
    }
    const [first, ...others] = await this.secretsOf('controller', secret);
    if (first === undefined || first.number !== 0 || others.length > 0) {
      throw new Error('This account holds more than one controller key, or not the first key of the controller template. The engine would sign with the wrong one; the account has to start from an empty state.');
    }
    return { publicKey: first.publicKey, keyHash: hash160(first.publicKey) };
  }

  /**
   * The account's address for ordinary coins: the funding address of an owner, the fee address of a
   * recoverer. It is the address of the first key under the standard wallet template. The engine would make
   * a new address at every asking, so the first one is kept.
   */
  async ordinaryAddress(): Promise<Uint8Array> {
    if (this.ordinary === undefined) {
      const existing = (await this.engine.listScriptHashes())
        .filter((entry) => entry.templateIdentifier === this.templates.coins)
        .sort((a, b) => (a.addedAtTimestampMs ?? 0) - (b.addedAtTimestampMs ?? 0));
      this.ordinary = hexToBin(existing[0]?.lockingBytecode ?? (await this.engine.generateLockingBytecodeFromDefaultPolicy('receive')));
    }
    return this.ordinary;
  }

  /**
   * Make the controller of an identity known to this account, under the key the account already has.
   * The recoverer's account also needs the state the controller is in now.
   */
  async knowController(identity: Uint8Array, role: Role, currentState?: Uint8Array): Promise<Uint8Array> {
    await this.controllerKey(role);
    const invitation = this.keyInvitation[role];
    if (role === 'owner') {
      return hexToBin(await this.withPolicy('address', 'controller', () => this.engine.generateLockingBytecodeFromDefaultPolicy('address', { identity: hex(identity) }, invitation)));
    }
    if (currentState === undefined) throw new Error('The recoverer\'s account is told the controller\'s current state.');
    return hexToBin(
      await this.withPolicy('receive', 'controller', () =>
        this.engine.generateLockingBytecodeFromDefaultPolicy('receive', { identity: hex(identity), nextState: hex(currentState) }, invitation),
      ),
    );
  }

  /**
   * The next address of a kind: the engine makes the next key, in order, and the wallet's code supplies the
   * tag. A device that restores calls this from number 0 upward, with the tag of each number.
   *
   * @returns the address's script and the number of the key the engine used
   */
  async nextAddress(kind: KeyedAddressKind, tag: Uint8Array): Promise<{ lockingBytecode: Uint8Array; number: number }> {
    const template: WalletTemplateName = kind === ADDRESS_KIND.givenOut ? 'givenOut' : 'change';
    const before = (await this.secretsOf(template, 'addressKey')).length;
    const lockingBytecode = hexToBin(await this.withPolicy('address', template, () => this.engine.generateLockingBytecodeFromDefaultPolicy('address', { tag: hex(tag) })));
    return { lockingBytecode, number: before };
  }

  async addressCount(kind: KeyedAddressKind): Promise<number> {
    return (await this.secretsOf(kind === ADDRESS_KIND.givenOut ? 'givenOut' : 'change', 'addressKey')).length;
  }

  /** Make an address of an earlier seed known: this account follows it and can sweep it, and cannot spend it by key. */
  async knowEarlierAddress(identity: Uint8Array, address: RecoverableWalletAddress): Promise<Uint8Array> {
    const values = { keyHash: hex(address.keyHash), tag: hex(address.tag), identity: hex(identity), addressSecret: hex(address.secret) };
    return hexToBin(await this.withPolicy('address', 'actions', () => this.engine.generateLockingBytecodeFromDefaultPolicy('address', values)));
  }

  /** Make a vault address known. */
  async knowVaultAddress(identity: Uint8Array, address: VaultWalletAddress): Promise<Uint8Array> {
    const values = { tag: hex(address.tag), identity: hex(identity), addressSecret: hex(address.secret) };
    return hexToBin(await this.withPolicy('receive', 'actions', () => this.engine.generateLockingBytecodeFromDefaultPolicy('receive', values)));
  }

  /** Every coin the account follows, with its script and its tokens. */
  async coins(): Promise<AccountCoin[]> {
    const scripts = new Map((await this.engine.listScriptHashes()).map((entry) => [entry.scriptHash, entry.lockingBytecode]));
    const names = new Map(Object.entries(this.templates).map(([name, identifier]) => [identifier, name]));
    const coins: AccountCoin[] = [];
    for (const entry of await this.engine.listUnspentOutputs()) {
      const lockingBytecode = scripts.get(entry.scriptHash);
      if (lockingBytecode === undefined) continue;
      const token =
        entry.tokenCategory === undefined
          ? undefined
          : {
              category: hexToBin(entry.tokenCategory),
              amount: BigInt(entry.tokenAmount ?? 0),
              ...(entry.tokenNftCapability === undefined
                ? {}
                : { nft: { capability: entry.tokenNftCapability as 'none' | 'mutable' | 'minting', commitment: hexToBin(entry.tokenNftCommitment ?? '') } }),
            };
      coins.push({
        utxo: {
          transactionHash: hexToBin(entry.outpointTransactionHash),
          index: entry.outpointIndex,
          output: { lockingBytecode: hexToBin(lockingBytecode), valueSatoshis: BigInt(entry.valueSatoshis), ...(token === undefined ? {} : { token }) },
        },
        template: names.get(entry.templateIdentifier) ?? entry.templateIdentifier,
        height: entry.minedAtHeight ?? 0,
      });
    }
    return coins;
  }

  /** The coins at one script. */
  async coinsAt(lockingBytecode: Uint8Array): Promise<AccountCoin[]> {
    const wanted = hex(lockingBytecode);
    return (await this.coins()).filter((coin) => hex(coin.utxo.output.lockingBytecode) === wanted);
  }

  /**
   * Build and sign a transaction, and check it. Nothing is sent. The coins it names are held for it until
   * it is sent or discarded.
   *
   * @throws if the engine cannot build it, or if it fails this project's check before sending
   */
  async prepare(request: TransactionRequest): Promise<PreparedTransaction> {
    const variables = Object.entries(request.variables ?? {}).map(([variableIdentifier, value]) => ({ variableIdentifier, roleIdentifier: request.role, value }));
    const inputs = request.inputs.map(({ coin, inputIdentifier }) => ({
      outpointTransactionHash: coin.utxo.transactionHash,
      outpointIndex: coin.utxo.index,
      ...(inputIdentifier === undefined ? {} : { inputIdentifier }),
    }));
    // The engine unlocks a script with the key of the invitation that first made the script known. The
    // action that makes the controller key must therefore be carried out in the invitation the key was made
    // for: a new invitation for it would make a second key, and the controller would later be signed with that.
    const makesKey = request.template === 'controller' && request.action === KEY_OF_ROLE[request.role].action;
    let invitationIdentifier: string;
    if (makesKey) {
      await this.controllerKey(request.role);
      invitationIdentifier = this.keyInvitation[request.role] as string;
      await this.engine.appendInvitation(invitationIdentifier, { variables, inputs } as unknown as Parameters<Engine['appendInvitation']>[1]);
    } else {
      const stored = await this.engine.createInvitation({
        templateIdentifier: this.templates[request.template],
        actionIdentifier: request.action,
        intent: intentFor(request.template, request.action, request.role),
        variables,
        inputs,
      } as Parameters<Engine['createInvitation']>[0]);
      invitationIdentifier = stored.invitation.invitationIdentifier;
    }
    try {
      await this.engine.appendInvitation(invitationIdentifier, { outputs: request.outputs } as unknown as Parameters<Engine['appendInvitation']>[1]);
      for (const index of await this.engine.listOwnInputIndexes(invitationIdentifier)) await this.engine.signInvitation(invitationIdentifier, index);
      const { builtTransaction } = await this.engine.executeAction(invitationIdentifier, { broadcastTransaction: false });
      const transaction = decodeTransactionBch(hexToBin(builtTransaction.serializedTransaction));
      if (typeof transaction === 'string') throw new Error(`The engine built something that is not a transaction: ${transaction}`);
      // The transaction as built, against the coins as this account knows them.
      const sourceOutputs = request.inputs.map(({ coin }) => coin.utxo.output);
      const spendsWhatWasAsked = transaction.inputs.every(
        (input, index) => hex(input.outpointTransactionHash) === hex(request.inputs[index]?.coin.utxo.transactionHash ?? new Uint8Array()) && input.outpointIndex === request.inputs[index]?.coin.utxo.index,
      );
      if (transaction.inputs.length !== request.inputs.length || !spendsWhatWasAsked) throw new Error('The engine built a transaction with other inputs than the ones asked for.');
      const check = checkBeforeSending({ transaction, sourceOutputs });
      if (check !== true) {
        throw new Error(`The transaction fails the check before sending: ${check}`, { cause: { transactionHex: builtTransaction.serializedTransaction, sourceOutputs } });
      }
      const inputTotal = sourceOutputs.reduce((sum, output) => sum + output.valueSatoshis, 0n);
      const outputTotal = transaction.outputs.reduce((sum, output) => sum + output.valueSatoshis, 0n);
      return {
        invitationIdentifier,
        transactionId: builtTransaction.transactionHash,
        transactionHex: builtTransaction.serializedTransaction,
        bytes: builtTransaction.serializedTransaction.length / 2,
        feeSatoshis: inputTotal - outputTotal,
      };
    } catch (error) {
      await this.discard(invitationIdentifier);
      throw error;
    }
  }

  /** Send a prepared transaction. Returns its identifier. */
  async send(prepared: PreparedTransaction): Promise<string> {
    try {
      await this.engine.executeAction(prepared.invitationIdentifier, { broadcastTransaction: true });
    } catch (error) {
      // The engine can fail while clearing its hold on the coins after the transaction has gone out.
      if ((error as Error).name !== 'UnspentOutputNotFoundInStoreError') {
        // A transaction the network refused is put aside, so that the coins it named can be used again.
        await this.discard(prepared.invitationIdentifier);
        throw error;
      }
    }
    return prepared.transactionId;
  }

  /** Put aside a transaction that will not be sent, so that the coins it named can be used again. */
  async discard(invitationIdentifier: string): Promise<void> {
    await this.engine.archiveInvitation(invitationIdentifier).catch(() => undefined);
  }

  /** Stop the engine. */
  async close(): Promise<void> {
    await this.engine.stop().catch(() => undefined);
  }
}
