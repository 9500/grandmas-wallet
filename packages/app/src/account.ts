import { binToHex, decodeTransactionBch, hash160, hexToBin } from '@bitauth/libauth';
import { checkJoinedInvitation } from '@grandmas-wallet/connect';
import {
  type AccountCoin,
  type FollowedScript,
  type KeyedAddressKind,
  type PreparedTransaction,
  type RecoverableWalletAddress,
  type Role,
  type SharedActionFinish,
  type SharedActionStart,
  type SharedInvitationStarted,
  type SharedInvitationTaken,
  type TransactionRequest,
  type VaultWalletAddress,
  type WalletBackend,
  type WalletTemplateName,
  ADDRESS_KIND,
  InvitationNotTakenError,
  checkBeforeSending,
  invitationParts,
  templateGivenToFee,
  outputsToScriptInRole,
  typedValues,
} from '@grandmas-wallet/core';
import type { Engine } from '@xo-cash/engine';
import type { XOTemplate } from '@xo-cash/types';
import { deserializeInvitation, serializeInvitation } from '@xo-cash/utils';

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
const intentFor = (template: XOTemplate, action: string, role: string): IntentLike => {
  const definition = template as unknown as {
    name?: string;
    start?: IntentLike[];
    lockingScripts?: Record<string, { roles?: Record<string, { actions?: IntentLike[] }> }>;
  };
  const start = definition.start?.find((intent) => intent.action === action && intent.role === role);
  if (start !== undefined) return start;
  for (const script of Object.values(definition.lockingScripts ?? {})) {
    const followUp = script.roles?.[role]?.actions?.find((intent) => intent.action === action);
    if (followUp !== undefined) return followUp;
  }
  throw new Error(`The template "${definition.name ?? ''}" offers no action "${action}" to the role "${role}".`);
};

/**
 * An output of the template as the engine is given it. An output the wallet gives with its locking bytecode, to a
 * script the engine is not to follow (a contract the role only pays into, or one that many users' coins share), is
 * given so: the engine then neither follows the script nor asks for a role on it. Otherwise, where the output's
 * locking script names the account's role, it is tagged with that role: the engine reads a template's
 * `relevant: false` for the role an output is added in, and follows the script. A script that names no such role is
 * left untagged, as the engine refuses a role a locking script does not name.
 */
export const outputForEngine = <T extends object>(template: XOTemplate, output: T, role: string): T & { roleIdentifier?: string } => {
  if (!('outputIdentifier' in output) || typeof output.outputIdentifier !== 'string') return output;
  if ('lockingBytecode' in output && output.lockingBytecode instanceof Uint8Array) return output;
  const definition = template as unknown as { outputs?: Record<string, { lockingScript?: string }>; lockingScripts?: Record<string, { roles?: Record<string, unknown> }> };
  const lockingScript = definition.outputs?.[output.outputIdentifier]?.lockingScript;
  const named = lockingScript !== undefined && Object.hasOwn(definition.lockingScripts ?? {}, lockingScript) && Object.hasOwn(definition.lockingScripts?.[lockingScript]?.roles ?? {}, role);
  return named ? { ...output, roleIdentifier: role } : output;
};

/**
 * The inputs the engine is asked to sign: those it lists as its own, less the coins given with their unlocking. The
 * engine lists a coin at a script it follows as its own even where the wallet gave the coin's unlocking, and refuses to
 * set an unlocking a second time. Every input is given its place, so the engine's index of an input is its place in
 * the request.
 */
export const inputsToSign = (ownIndexes: number[], inputs: { unlocking?: unknown }[]): number[] => ownIndexes.filter((index) => inputs[index]?.unlocking === undefined);

const isWalletTemplate = (name: string): name is WalletTemplateName => Object.hasOwn(WALLET_TEMPLATES, name);
const isRole = (role: string): role is Role => role === 'owner' || role === 'recoverer';

const KEY_OF_ROLE: Record<Role, { secret: string; action: string }> = {
  owner: { secret: 'controllerKey', action: 'create' },
  recoverer: { secret: 'recovererKey', action: 'takeUp' },
};

const wait = (milliseconds: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, milliseconds));
const hex = binToHex;

/**
 * The engine's check of block headers did not reach the chain's tip in time, or stood still for a while. `moved`
 * says whether it was still going on when the account stopped waiting: one that stands still may be stuck on a
 * block that a reorganization of the chain took away, which the engine does not undo by itself
 * (docs/xo-feedback-notes.md, 18 November).
 */
export class HeaderCheckBehind extends Error {
  constructor(
    readonly verifiedHeight: number,
    readonly currentHeight: number,
    readonly moved: boolean,
  ) {
    super(`The engine's header check stands at ${verifiedHeight} of ${currentHeight}; what it reports cannot be relied on.`);
    this.name = 'HeaderCheckBehind';
  }
}

/**
 * A transaction the account sent, with the XO invitation it was built from: the invitation as participants
 * share it, in the engine's own serialization. It holds no key.
 */
export interface SentInvitation {
  transactionId: string;
  /** The engine's handle to the invitation, by which `invitationText` reads it again later. */
  invitationIdentifier: string;
  /** The identifier the engine gave the template, and the template's own name. */
  templateIdentifier: string;
  templateName: string;
  action: string;
  role: string;
  text: string;
}

export class Account implements WalletBackend {
  /** The invitation the controller key was made for: the handle by which the engine finds that key again. */
  private keyInvitation: Partial<Record<Role, string>> = {};
  private ordinary: Uint8Array | undefined;
  /** Templates that are not the wallet's own, by the identifier the engine gave each. */
  private readonly imported = new Map<string, XOTemplate>();
  /** What each transaction that is prepared and not yet sent is an action of, by its invitation. */
  private readonly preparedAs = new Map<string, { templateIdentifier: string; templateName: string; action: string; role: string }>();
  /** Told of every transaction the account sends, with its invitation. */
  private onSent: ((sent: SentInvitation) => void | Promise<void>) | undefined;
  /** The satoshis per byte the transactions built from invitations are checked against before sending: 1 unless given. */
  private feeRate = 1;
  /** Invitations started for another participant to join, not yet finished or put aside, by their identifier. */
  private readonly shared = new Map<string, { text: string; entityIdentifier: string; templateIdentifier: string; templateName: string; definition: XOTemplate; action: string; role: string; coins: AccountCoin[] }>();

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
  static async open(
    engine: Engine,
    options: {
      headerCheckTimeoutMs?: number;
      headerCheckStillMs?: number;
      pollMs?: number;
      onProgress?: (checked: { verifiedHeight: number; currentHeight: number }) => void;
      /** Told of every transaction the account sends, with the invitation it was built from. */
      onSent?: (sent: SentInvitation) => void | Promise<void>;
      /** The satoshis per byte the wallet pays (its `feeRate`), against which each transaction is checked before sending; 1 unless given. */
      feeRate?: number;
    } = {},
  ): Promise<Account> {
    const deadline = Date.now() + (options.headerCheckTimeoutMs ?? 120_000);
    // A check that stands still this long while behind the tip is taken as stuck; a moving one gets until the deadline.
    const still = options.headerCheckStillMs ?? 30_000;
    let first: number | undefined;
    let last: { height: number; since: number } | undefined;
    for (;;) {
      const status = await engine.getChainStatus();
      // How far the header check has come, for a page that shows it while it waits.
      options.onProgress?.({ verifiedHeight: status.verifiedHeight, currentHeight: status.currentHeight });
      if (status.verifiedHeight >= status.currentHeight) break;
      const now = Date.now();
      first ??= status.verifiedHeight;
      if (last?.height !== status.verifiedHeight) last = { height: status.verifiedHeight, since: now };
      const standing = now - last.since >= still;
      if (standing || now > deadline) throw new HeaderCheckBehind(status.verifiedHeight, status.currentHeight, !standing && status.verifiedHeight !== first);
      await wait(options.pollMs ?? 500);
    }
    const templates = {} as Record<WalletTemplateName, string>;
    for (const name of Object.keys(WALLET_TEMPLATES) as WalletTemplateName[]) {
      templates[name] = (await engine.importTemplate(WALLET_TEMPLATES[name])).templateIdentifier;
    }
    const account = new Account(engine, templates);
    account.onSent = options.onSent;
    account.feeRate = options.feeRate ?? 1;
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
          intent: intentFor(WALLET_TEMPLATES.controller, action, role),
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
    // Every input and output is given its place. The engine puts items whose template gives them an index
    // first, in that order, and the others after them; a template that leaves a place free for the wallet
    // (the coin that defines a new token category is input 0) would otherwise be built in another order.
    // A coin of an application's contract that the account does not follow comes with its unlocking, which the
    // engine takes as another participant's input: it puts it into the transaction as given.
    const inputs = request.inputs.map(({ coin, inputIdentifier, unlocking }, transactionIndex) => ({
      outpointTransactionHash: coin.utxo.transactionHash,
      outpointIndex: coin.utxo.index,
      transactionIndex,
      ...(inputIdentifier === undefined ? {} : { inputIdentifier }),
      ...(unlocking === undefined ? {} : { unlockingBytecode: unlocking.bytecode, sequenceNumber: unlocking.sequenceNumber }),
    }));
    // An output of the template carries the account's role where its script names it (`outputForEngine`).
    const { identifier: templateIdentifier, definition: templateDefinition } = this.templateOf(request.template);
    const outputs = request.outputs.map((output, transactionIndex) => ({ ...outputForEngine(templateDefinition, output, request.role), transactionIndex }));
    // The engine unlocks a script with the key of the invitation that first made the script known. The
    // action that makes the controller key must therefore be carried out in the invitation the key was made
    // for: a new invitation for it would make a second key, and the controller would later be signed with that.
    const walletRole = isRole(request.role) ? request.role : undefined;
    const makesKey = request.template === 'controller' && walletRole !== undefined && request.action === KEY_OF_ROLE[walletRole].action;
    let invitationIdentifier: string;
    if (makesKey && walletRole !== undefined) {
      await this.controllerKey(walletRole);
      invitationIdentifier = this.keyInvitation[walletRole] as string;
      await this.engine.appendInvitation(invitationIdentifier, { variables, inputs } as unknown as Parameters<Engine['appendInvitation']>[1]);
    } else {
      const stored = await this.engine.createInvitation({
        templateIdentifier,
        actionIdentifier: request.action,
        intent: intentFor(templateDefinition, request.action, request.role),
        variables,
        inputs,
      } as Parameters<Engine['createInvitation']>[0]);
      invitationIdentifier = stored.invitation.invitationIdentifier;
    }
    try {
      await this.engine.appendInvitation(invitationIdentifier, { outputs } as unknown as Parameters<Engine['appendInvitation']>[1]);
      for (const index of inputsToSign(await this.engine.listOwnInputIndexes(invitationIdentifier), request.inputs)) await this.engine.signInvitation(invitationIdentifier, index);
      const { builtTransaction } = await this.engine.executeAction(invitationIdentifier, { broadcastTransaction: false });
      const transaction = decodeTransactionBch(hexToBin(builtTransaction.serializedTransaction));
      if (typeof transaction === 'string') throw new Error(`The engine built something that is not a transaction: ${transaction}`);
      // The transaction as built, against the coins as this account knows them.
      const sourceOutputs = request.inputs.map(({ coin }) => coin.utxo.output);
      const spendsWhatWasAsked = transaction.inputs.every(
        (input, index) => hex(input.outpointTransactionHash) === hex(request.inputs[index]?.coin.utxo.transactionHash ?? new Uint8Array()) && input.outpointIndex === request.inputs[index]?.coin.utxo.index,
      );
      if (transaction.inputs.length !== request.inputs.length || !spendsWhatWasAsked) throw new Error('The engine built a transaction with other inputs than the ones asked for.');
      // Coins whose template input leaves satoshis out of the change give them to the fee, as the template says.
      // They pay toward the template's own outputs first; only what is left of them may go to the fee.
      const templateOutputsSatoshis = request.outputs.reduce((sum, output, index) => ('outputIdentifier' in output ? sum + (transaction.outputs[index]?.valueSatoshis ?? 0n) : sum), 0n);
      const givenToFee = templateGivenToFee(templateDefinition, request.inputs.map(({ coin, inputIdentifier }) => ({ inputIdentifier, valueSatoshis: coin.utxo.output.valueSatoshis })), typedValues(templateDefinition, request.variables ?? {}), templateOutputsSatoshis);
      const check = checkBeforeSending({ transaction, sourceOutputs }, this.feeRate, givenToFee);
      if (check !== true) {
        throw new Error(`The transaction fails the check before sending: ${check}`, { cause: { transactionHex: builtTransaction.serializedTransaction, sourceOutputs } });
      }
      this.preparedAs.set(invitationIdentifier, { templateIdentifier, templateName: (templateDefinition as { name?: string }).name ?? '', action: request.action, role: request.role });
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

  /**
   * Start an invitation that another participant joins: the wallet's values, tagged with its role, and the coins it
   * brings in its first commit, which the engine holds for it. A coin given a place carries it as its index in the
   * transaction; the others are put where the template's places and the order of the wallet's items put them.
   */
  async startShared(request: SharedActionStart): Promise<SharedInvitationStarted> {
    const { identifier: templateIdentifier, definition } = this.templateOf(request.template);
    const variables = Object.entries(request.variables ?? {}).map(([variableIdentifier, value]) => ({ variableIdentifier, roleIdentifier: request.role, value }));
    const inputs = request.inputs.map(({ coin, inputIdentifier, place }) => ({
      outpointTransactionHash: coin.utxo.transactionHash,
      outpointIndex: coin.utxo.index,
      ...(inputIdentifier === undefined ? {} : { inputIdentifier }),
      ...(place === undefined ? {} : { transactionIndex: place }),
    }));
    const stored = await this.engine.createInvitation({
      templateIdentifier,
      actionIdentifier: request.action,
      intent: intentFor(definition, request.action, request.role),
      variables,
      inputs,
    } as Parameters<Engine['createInvitation']>[0]);
    const { invitationIdentifier } = stored.invitation;
    const text = serializeInvitation(stored.invitation);
    this.shared.set(invitationIdentifier, {
      text,
      entityIdentifier: stored.entityIdentifier,
      templateIdentifier,
      templateName: (definition as { name?: string }).name ?? '',
      definition,
      action: request.action,
      role: request.role,
      coins: request.inputs.map(({ coin }) => coin),
    });
    return { invitationIdentifier, text };
  }

  /**
   * Take back the invitation the other participant joined. It has to be the invitation that was sent with one commit
   * appended (`checkJoinedInvitation`); the engine's `updateInvitation` then checks every commit's signature and the
   * history (`acceptInvitation` would check neither). Nothing the other participant added is judged here.
   * @throws InvitationNotTakenError
   */
  async takeShared(invitationIdentifier: string, text: string): Promise<SharedInvitationTaken> {
    const started = this.shared.get(invitationIdentifier);
    if (started === undefined) throw new InvitationNotTakenError('This account started no such invitation, or has put it aside.', 'not-started');
    const joined = checkJoinedInvitation(started.text, text);
    if (!joined.ok) throw new InvitationNotTakenError(joined.reason, 'changed');
    let received;
    try {
      received = deserializeInvitation(text);
    } catch (error) {
      throw new InvitationNotTakenError(`The invitation cannot be read: ${String((error as Error).message).slice(0, 200)}`, 'changed');
    }
    try {
      await this.engine.updateInvitation(received);
    } catch (error) {
      throw new InvitationNotTakenError(`The engine refused the invitation: ${String((error as Error).message).replace(/\s+/g, ' ').slice(0, 300)}`, 'not-valid');
    }
    const { own, others } = invitationParts(received, started.entityIdentifier);
    return { invitationIdentifier, own, others };
  }

  /**
   * The wallet's part after the other participant's: its coins and outputs, each at the place given, then its
   * signatures. The transaction is built and checked before sending as `prepare` checks it, with the other
   * participant's coins as the wallet read them from the chain. Nothing is sent.
   * @throws if the engine cannot build it, or if it fails the check before sending; the invitation is then put aside
   */
  async finishShared(request: SharedActionFinish): Promise<PreparedTransaction> {
    const { invitationIdentifier } = request;
    const started = this.shared.get(invitationIdentifier);
    if (started === undefined) throw new Error('This account started no such invitation, or has put it aside.');
    try {
      const inputs = request.inputs.map(({ coin, inputIdentifier, place }) => ({
        outpointTransactionHash: coin.utxo.transactionHash,
        outpointIndex: coin.utxo.index,
        ...(inputIdentifier === undefined ? {} : { inputIdentifier }),
        ...(place === undefined ? {} : { transactionIndex: place }),
      }));
      // As in `prepare`: an output of the template carries the account's role where its script names it. A place becomes the engine's index.
      const outputs = request.outputs.map(({ place, ...output }) => ({ ...outputForEngine(started.definition, output, started.role), ...(place === undefined ? {} : { transactionIndex: place }) }));
      if (inputs.length > 0 || outputs.length > 0) {
        await this.engine.appendInvitation(invitationIdentifier, { ...(inputs.length === 0 ? {} : { inputs }), ...(outputs.length === 0 ? {} : { outputs }) } as unknown as Parameters<Engine['appendInvitation']>[1]);
      }
      for (const index of await this.engine.listOwnInputIndexes(invitationIdentifier)) await this.engine.signInvitation(invitationIdentifier, index);
      const { builtTransaction } = await this.engine.executeAction(invitationIdentifier, { broadcastTransaction: false });
      const transaction = decodeTransactionBch(hexToBin(builtTransaction.serializedTransaction));
      if (typeof transaction === 'string') throw new Error(`The engine built something that is not a transaction: ${transaction}`);
      // Every input is a coin the wallet planned: its own, or one of the other participant's as read from the chain.
      const known = new Map([...started.coins, ...request.inputs.map(({ coin }) => coin)].map((coin) => [`${hex(coin.utxo.transactionHash)}:${coin.utxo.index}`, coin.utxo.output]));
      for (const utxo of request.theirCoins) known.set(`${hex(utxo.transactionHash)}:${utxo.index}`, utxo.output);
      const sourceOutputs = transaction.inputs.map((input) => known.get(`${hex(input.outpointTransactionHash)}:${input.outpointIndex}`));
      if (transaction.inputs.length !== known.size || sourceOutputs.some((output) => output === undefined)) throw new Error('The engine built a transaction with other inputs than the ones planned.');
      const spent = sourceOutputs as NonNullable<(typeof sourceOutputs)[number]>[];
      const check = checkBeforeSending({ transaction, sourceOutputs: spent }, this.feeRate);
      if (check !== true) {
        throw new Error(`The transaction fails the check before sending: ${check}`, { cause: { transactionHex: builtTransaction.serializedTransaction, sourceOutputs: spent } });
      }
      this.shared.delete(invitationIdentifier);
      this.preparedAs.set(invitationIdentifier, { templateIdentifier: started.templateIdentifier, templateName: started.templateName, action: started.action, role: started.role });
      const inputTotal = spent.reduce((sum, output) => sum + output.valueSatoshis, 0n);
      const outputTotal = transaction.outputs.reduce((sum, output) => sum + output.valueSatoshis, 0n);
      return {
        invitationIdentifier,
        transactionId: builtTransaction.transactionHash,
        transactionHex: builtTransaction.serializedTransaction,
        bytes: builtTransaction.serializedTransaction.length / 2,
        feeSatoshis: inputTotal - outputTotal,
      };
    } catch (error) {
      await this.abandonShared(invitationIdentifier);
      throw error;
    }
  }

  /** Put aside an invitation started for another participant, and free the coins the engine held for it. */
  async abandonShared(invitationIdentifier: string): Promise<void> {
    this.shared.delete(invitationIdentifier);
    await this.discard(invitationIdentifier);
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
    await this.tellSent(prepared);
    return prepared.transactionId;
  }

  /** The transaction has gone out; a listener that fails does not change that. */
  private async tellSent(prepared: PreparedTransaction): Promise<void> {
    const as = this.preparedAs.get(prepared.invitationIdentifier);
    this.preparedAs.delete(prepared.invitationIdentifier);
    if (this.onSent === undefined || as === undefined) return;
    try {
      const text = await this.invitationText(prepared.invitationIdentifier);
      if (text !== undefined) await this.onSent({ transactionId: prepared.transactionId, invitationIdentifier: prepared.invitationIdentifier, ...as, text });
    } catch (error) {
      console.warn('The invitation of a sent transaction could not be handed on.', error);
    }
  }

  /**
   * An invitation this account holds, as text: the invitation as participants share it, in the engine's own
   * serialization, which the engine reads back and XO's tools open. It holds no key.
   */
  async invitationText(invitationIdentifier: string): Promise<string | undefined> {
    const stored = await this.engine.getInvitation(invitationIdentifier);
    return stored === undefined ? undefined : serializeInvitation(stored.invitation);
  }

  /** Put aside a transaction that will not be sent, so that the coins it named can be used again. */
  async discard(invitationIdentifier: string): Promise<void> {
    this.preparedAs.delete(invitationIdentifier);
    await this.engine.archiveInvitation(invitationIdentifier).catch(() => undefined);
  }

  /** A template by the wallet's name for it, or an imported one by its identifier. */
  private templateOf(template: string): { identifier: string; definition: XOTemplate } {
    if (isWalletTemplate(template)) return { identifier: this.templates[template], definition: WALLET_TEMPLATES[template] };
    const definition = this.imported.get(template);
    if (definition === undefined) throw new Error('This account does not hold that template.');
    return { identifier: template, definition };
  }

  /**
   * Take in a template an application brought, from its text. The engine checks it against the template
   * schema and keeps it; its identifier is the hash of the template as the engine's parser writes it out.
   */
  async importTemplate(text: string): Promise<string> {
    const { templateIdentifier } = await this.engine.importTemplate(text);
    const definition = await this.engine.getTemplate(templateIdentifier);
    if (definition === undefined) throw new Error('The engine did not keep the template.');
    this.imported.set(templateIdentifier, definition);
    return templateIdentifier;
  }

  /**
   * Make a script of an imported template known, so that the engine follows the coins there and unlocks
   * them in an action of that template.
   *
   * The engine follows a script once an output with it has been added to an invitation, and goes on
   * following it after the invitation is put aside. So an invitation is made for an action of the template
   * that has such an output, the output is added, and the invitation is put aside; nothing is built or sent.
   */
  async followScript(script: FollowedScript): Promise<Uint8Array> {
    const { identifier, definition } = this.templateOf(script.template);
    for (const { action, output: outputIdentifier } of outputsToScriptInRole(definition, script.lockingScript, script.role)) {
      const variables = Object.entries(typedValues(definition, script.variables)).map(([variableIdentifier, value]) => ({ variableIdentifier, roleIdentifier: script.role, value }));
      const stored = await this.engine.createInvitation({
        templateIdentifier: identifier,
        actionIdentifier: action,
        intent: intentFor(definition, action, script.role),
        variables,
      } as Parameters<Engine['createInvitation']>[0]);
      const { invitationIdentifier } = stored.invitation;
      try {
        return hexToBin(await this.engine.resolveInvitationOutputLockingBytecode(invitationIdentifier, outputIdentifier, script.role).then(async (lockingBytecode) => {
          await this.engine.appendInvitation(invitationIdentifier, { outputs: [{ outputIdentifier }] } as unknown as Parameters<Engine['appendInvitation']>[1]);
          return lockingBytecode;
        }));
      } finally {
        await this.discard(invitationIdentifier);
      }
    }
    throw new Error(`No action of the template pays to its script "${script.lockingScript}" in the role "${script.role}"; the engine cannot be told to follow it.`);
  }

  /** Stop the engine. */
  async close(): Promise<void> {
    await this.engine.stop().catch(() => undefined);
  }
}
