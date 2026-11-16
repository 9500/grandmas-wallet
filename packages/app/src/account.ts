import { binToHex, decodeTransactionBch, hash160, hexToBin } from '@bitauth/libauth';
import { grandmasWalletTemplate } from '@grandmas-wallet/templates';
import { Engine, XO_SUPPORTED_NETWORKS } from '@xo-cash/engine';
import { p2pkhTemplate } from '@xo-cash/templates';
import type { XOTemplate } from '@xo-cash/types';
import { deserializeInvitation, serializeInvitation } from '@xo-cash/utils';

/**
 * One XO account: an engine for one mnemonic, with the wallet's template, the
 * template for ordinary coins and whatever templates applications brought, and
 * the handful of operations the wallet's actions are made of.
 *
 * Only one account can be open in a page or process at a time, because the
 * engine's network connection is shared.
 */

export type Variables = Record<string, string | number>;
export interface InputRequest { transactionId: string; index: number; inputIdentifier?: string }
export interface RawOutput { lockingBytecode: string; satoshis: string }
export interface Coin { transactionId: string; index: number; satoshis: string }
export interface TrackedOutput extends Coin {
  /** `wallet` and `coins` for the account's own templates; otherwise the template's identifier. */
  template: string;
  commitment?: string | undefined;
}

/** An action of an application's template, as the application asks for it. */
export interface ApplicationActionRequest {
  templateIdentifier: string;
  action: string;
  role: string;
  variables: Variables;
  /** Outputs the action spends, all given to the first input the action's transaction names. */
  inputs?: { transactionId: string; index: number }[];
}

/** What an action of an application's template comes to, worked out by the engine from the template alone. */
export interface ResolvedAction {
  /** The outputs the action's transaction creates, in the template's order. */
  outputs: { output: string; lockingBytecode: string; satoshis: bigint }[];
  locktime: number;
  /** Sequence numbers the template gives the action's inputs. */
  sequenceNumbers: number[];
}

/** An action taken as far as a signed transaction that has not been sent. */
export interface Built {
  invitationIdentifier: string;
  ownInputIndexes: number[];
  missing: unknown;
  transactionId: string;
  transactionHex: string;
  /** The invitation, serialized. */
  invitation: string;
}

export interface StartRequest {
  action: string;
  role: string;
  /** Keys to create for this invitation. */
  generate?: string[];
  variables?: Variables;
  inputs?: InputRequest[];
  /** Template outputs to add, by identifier. */
  outputs?: string[];
  rawOutputs?: RawOutput[];
  /** Variables to fill with the hash of a key this account holds: variable name to secret name. */
  derive?: Record<string, string>;
  locktime?: number;
}

export interface JoinRequest {
  invitation: string;
  role: string;
  generate?: string[];
  variables?: Variables;
  derive?: Record<string, string>;
}

export interface ContinueRequest {
  invitation: string;
  outputs?: string[];
  rawOutputs?: RawOutput[];
  build?: boolean;
}

/** Small values an account keeps between sessions, such as its receiving address. */
export interface Memory {
  get(name: string): string | undefined;
  set(name: string, value: string): void;
}

export const temporaryMemory = (): Memory => {
  const values = new Map<string, string>();
  return { get: (name) => values.get(name), set: (name, value) => void values.set(name, value) };
};

/** Values ending in "n" are whole numbers too large or too exact for JSON. */
const value = (raw: string | number): string | number | bigint => (typeof raw === 'string' && /^\d+n$/.test(raw) ? BigInt(raw.slice(0, -1)) : raw);
const variablesFor = (role: string, variables: Variables = {}) =>
  Object.entries(variables).map(([variableIdentifier, raw]) => ({ variableIdentifier, roleIdentifier: role, value: value(raw) }));
const inputsFor = (inputs: InputRequest[] = []) =>
  inputs.map(({ transactionId, index, inputIdentifier }) => ({
    outpointTransactionHash: hexToBin(transactionId),
    outpointIndex: index,
    ...(inputIdentifier === undefined ? {} : { inputIdentifier }),
  }));
const rawOutputsFor = (outputs: RawOutput[] = []) =>
  outputs.map(({ lockingBytecode, satoshis }) => ({ lockingBytecode: hexToBin(lockingBytecode), valueSatoshis: BigInt(satoshis) }));

const template = grandmasWalletTemplate;

/** The intent a role acts on: the template's start entry, or a follow-up offered by the controller script. */
const intentFor = (action: string, role: string, generate?: string[]) => {
  const start = template.start.find((entry) => entry.action === action && entry.role === role);
  if (start !== undefined) return start;
  const followUp = template.lockingScripts['controllerLockingScript']?.roles?.[role]?.actions?.find((entry) => entry.action === action);
  const intent = followUp ?? { action, role };
  return generate === undefined ? intent : { ...intent, generate };
};

/** The intent for an action of an application's template: a start entry, or a follow-up offered by one of its scripts. */
const applicationIntent = (source: XOTemplate, action: string, role: string) => {
  const start = source.start?.find((entry) => entry.action === action && entry.role === role);
  if (start !== undefined) return start;
  for (const lockingScript of Object.values(source.lockingScripts ?? {})) {
    const followUp = lockingScript.roles?.[role]?.actions?.find((entry) => entry.action === action);
    if (followUp !== undefined) return followUp;
  }
  return { action, role };
};

/** Whole numbers arrive from applications as numbers or as text; the engine wants numbers for the template's numeric variables. */
const typed = (source: XOTemplate, variables: Variables): Variables =>
  Object.fromEntries(
    Object.entries(variables).map(([name, raw]) => {
      const type = source.variables?.[name]?.type;
      if ((type === 'integer' || type === 'satoshis' || type === 'timestamp' || type === 'bigint' || type === 'token_amount') && typeof raw === 'string' && /^\d+$/.test(raw)) {
        return [name, Number.isSafeInteger(Number(raw)) ? Number(raw) : `${raw}n`];
      }
      return [name, raw];
    }),
  );

export class XoAccount {
  private constructor(
    private readonly engine: Engine,
    private readonly templates: { coins: string; wallet: string },
    /** Where this account receives ordinary coins, as locking bytecode in hex. */
    readonly coinLockingBytecode: string,
  ) {}

  /**
   * @param memory - where the receiving address is kept, so that an account whose engine state persists
   * keeps one address instead of making a new one each time it is opened
   */
  static async open(mnemonic: string, memory: Memory = temporaryMemory()): Promise<XoAccount> {
    const engine = await Engine.create(mnemonic, { network: XO_SUPPORTED_NETWORKS.chipnet });
    const coins = (await engine.importTemplate(p2pkhTemplate)).templateIdentifier;
    const wallet = (await engine.importTemplate(grandmasWalletTemplate)).templateIdentifier;
    await engine.setDefaultPolicies({ change: { templateIdentifier: coins }, receive: { templateIdentifier: coins }, address: { templateIdentifier: coins } });
    let coinLockingBytecode = memory.get('coinLockingBytecode');
    if (coinLockingBytecode === undefined) {
      coinLockingBytecode = await engine.generateLockingBytecodeFromDefaultPolicy('receive');
      memory.set('coinLockingBytecode', coinLockingBytecode);
    }
    return new XoAccount(engine, { coins, wallet }, coinLockingBytecode);
  }

  get walletTemplate(): string {
    return this.templates.wallet;
  }

  /** Identifier of the template this account's ordinary coins are held under. */
  get coinTemplate(): string {
    return this.templates.coins;
  }

  private get coinPolicies() {
    const { coins } = this.templates;
    return { change: { templateIdentifier: coins }, receive: { templateIdentifier: coins }, address: { templateIdentifier: coins } };
  }

  /** Appending takes any subset of an invitation's fields; the engine's declared type asks for all of them. */
  private append(invitationIdentifier: string, fields: object) {
    return this.engine.appendInvitation(invitationIdentifier, fields as Parameters<Engine['appendInvitation']>[1]);
  }

  private async serialized(invitationIdentifier: string): Promise<string> {
    const stored = await this.engine.getInvitation(invitationIdentifier);
    if (stored === undefined) throw new Error(`invitation ${invitationIdentifier} is not stored`);
    return serializeInvitation(stored.invitation);
  }

  /** Sign this account's inputs and build the transaction, without sending it. */
  private async complete(invitationIdentifier: string): Promise<Built> {
    const own = await this.engine.listOwnInputIndexes(invitationIdentifier);
    for (const index of own) await this.engine.signInvitation(invitationIdentifier, index);
    const missing = await this.engine.listMissingRequirements(invitationIdentifier);
    const { builtTransaction } = await this.engine.executeAction(invitationIdentifier, { broadcastTransaction: false });
    return {
      invitationIdentifier,
      ownInputIndexes: own,
      missing,
      transactionId: builtTransaction.transactionHash,
      transactionHex: builtTransaction.serializedTransaction,
      invitation: await this.serialized(invitationIdentifier),
    };
  }

  /** The account's ordinary coins that can be spent now. */
  async coins(): Promise<Coin[]> {
    return (await this.engine.listSpendableUnspentOutputs({ templateIdentifier: this.templates.coins })).map((coin) => ({
      transactionId: coin.outpointTransactionHash,
      index: coin.outpointIndex,
      satoshis: String(coin.valueSatoshis),
    }));
  }

  /** Every unspent output the engine follows for this account. */
  async unspent(): Promise<TrackedOutput[]> {
    return (await this.engine.listUnspentOutputs()).map((output) => ({
      transactionId: output.outpointTransactionHash,
      index: output.outpointIndex,
      satoshis: String(output.valueSatoshis),
      template: output.templateIdentifier === this.templates.wallet ? 'wallet' : output.templateIdentifier === this.templates.coins ? 'coins' : output.templateIdentifier,
      commitment: output.tokenNftCommitment,
    }));
  }

  /** Whether this account has created a key for a secret of the wallet template. */
  async hasKey(secretIdentifier: string): Promise<boolean> {
    return (await this.engine.listSecretData()).some(
      (secret) => secret.secretIdentifier === secretIdentifier && secret.templateIdentifier === this.templates.wallet,
    );
  }

  /** Hash of the public key of the newest key this account generated for a secret of the wallet template, as hex. */
  async keyHash(secretIdentifier: string): Promise<string> {
    const secrets = (await this.engine.listSecretData())
      .filter((secret) => secret.secretIdentifier === secretIdentifier && secret.templateIdentifier === this.templates.wallet)
      .sort((a, b) => (b.createdAtTimestampMs ?? 0) - (a.createdAtTimestampMs ?? 0));
    const [newest] = secrets;
    if (newest === undefined) throw new Error(`this account has no ${secretIdentifier}`);
    const publicKey = await this.engine.getSecretPublicKey(newest.secretLookupKey);
    if (publicKey === undefined) throw new Error(`no public key for ${secretIdentifier}`);
    return binToHex(hash160(hexToBin(publicKey)));
  }

  /** Start an action and, when outputs are given, take it as far as a built transaction. */
  async start(request: StartRequest & ({ outputs: string[] } | { rawOutputs: RawOutput[] })): Promise<Built>;
  async start(request: StartRequest): Promise<Built | { invitationIdentifier: string; invitation: string }>;
  async start(request: StartRequest): Promise<Built | { invitationIdentifier: string; invitation: string }> {
    const { action, role, generate, variables, inputs, outputs, rawOutputs, derive, locktime } = request;
    const stored = await this.engine.createInvitation({
      templateIdentifier: this.templates.wallet,
      actionIdentifier: action,
      intent: intentFor(action, role, generate),
      variables: variablesFor(role, variables),
      inputs: inputsFor(inputs),
      ...(locktime === undefined ? {} : { transactionLocktime: locktime }),
    });
    const { invitationIdentifier } = stored.invitation;
    try {
      for (const [variableIdentifier, secret] of Object.entries(derive ?? {})) {
        await this.append(invitationIdentifier, { variables: variablesFor(role, { [variableIdentifier]: await this.keyHash(secret) }) });
      }
      if (outputs !== undefined || rawOutputs !== undefined) {
        await this.append(invitationIdentifier, {
          outputs: [...(outputs ?? []).map((outputIdentifier) => ({ outputIdentifier })), ...rawOutputsFor(rawOutputs)],
        });
        return await this.complete(invitationIdentifier);
      }
      return { invitationIdentifier, invitation: await this.serialized(invitationIdentifier) };
    } catch (error) {
      await this.discard(invitationIdentifier);
      throw error;
    }
  }

  /** Join an invitation another account started, generating the keys the role needs. */
  async join(request: JoinRequest): Promise<{ invitationIdentifier: string; invitation: string; derived: Variables }> {
    const { invitation, role, generate, variables, derive } = request;
    const incoming = deserializeInvitation(invitation);
    // Keys the role does not generate by itself are created only when asked for, on first use. The role is
    // then named by the intent; the engine refuses it being given twice.
    const stored = await this.engine.acceptInvitation(
      incoming,
      generate === undefined ? { roleIdentifier: role } : { intent: { action: incoming.actionIdentifier, role, generate } },
    );
    const { invitationIdentifier } = stored.invitation;
    const all: Variables = { ...variables };
    for (const [variableIdentifier, secret] of Object.entries(derive ?? {})) all[variableIdentifier] = await this.keyHash(secret);
    if (Object.keys(all).length > 0) await this.append(invitationIdentifier, { variables: variablesFor(role, all) });
    return { invitationIdentifier, invitation: await this.serialized(invitationIdentifier), derived: all };
  }

  /** Take in a newer copy of an invitation; optionally add outputs and build the transaction. */
  async continue(request: ContinueRequest & { build: true }): Promise<Built>;
  async continue(request: ContinueRequest): Promise<Built | { invitationIdentifier: string; invitation: string }>;
  async continue(request: ContinueRequest): Promise<Built | { invitationIdentifier: string; invitation: string }> {
    const { invitation, outputs, rawOutputs, build } = request;
    const stored = await this.engine.updateInvitation(deserializeInvitation(invitation));
    const { invitationIdentifier } = stored.invitation;
    if (outputs !== undefined || rawOutputs !== undefined) {
      await this.append(invitationIdentifier, {
        outputs: [...(outputs ?? []).map((outputIdentifier) => ({ outputIdentifier })), ...rawOutputsFor(rawOutputs)],
      });
    }
    if (build === true) return this.complete(invitationIdentifier);
    return { invitationIdentifier, invitation: await this.serialized(invitationIdentifier) };
  }

  /** Send the transaction built for an invitation. */
  async broadcast(invitationIdentifier: string): Promise<{ transactionId: string | undefined; invitation: string; note?: string }> {
    try {
      const { builtTransaction } = await this.engine.executeAction(invitationIdentifier, { broadcastTransaction: true });
      return { transactionId: builtTransaction.transactionHash, invitation: await this.serialized(invitationIdentifier) };
    } catch (error) {
      // The engine can fail while clearing reservations after the transaction has gone out.
      if ((error as Error).name !== 'UnspentOutputNotFoundInStoreError') throw error;
      return {
        transactionId: undefined,
        invitation: await this.serialized(invitationIdentifier),
        note: 'engine raised UnspentOutputNotFoundInStoreError after broadcasting',
      };
    }
  }

  /**
   * Put aside an invitation that will not be sent. The coins it named as inputs are held for it until
   * then, and could not be used by anything else.
   */
  async discard(invitationIdentifier: string): Promise<void> {
    await this.engine.archiveInvitation(invitationIdentifier).catch(() => undefined);
  }

  /** Put aside every stored invitation for an action of the wallet template. */
  async discardAll(action: string): Promise<void> {
    for (const { invitation } of await this.engine.listInvitations()) {
      if (invitation.actionIdentifier === action && invitation.templateIdentifier === this.templates.wallet) await this.discard(invitation.invitationIdentifier);
    }
  }

  /**
   * Make the wallet's own address known to this account, so that it follows the outputs there and can spend
   * them. Returns the locking bytecode as hex.
   */
  async trackWallet(variables: Variables = {}): Promise<string> {
    const templateIdentifier = this.templates.wallet;
    await this.engine.setDefaultPolicies({ change: { templateIdentifier: this.templates.coins }, receive: { templateIdentifier }, address: { templateIdentifier } });
    try {
      const values = Object.fromEntries(Object.entries(variables).map(([name, raw]) => [name, value(raw)]));
      return await this.engine.generateLockingBytecodeFromDefaultPolicy('address', values);
    } finally {
      await this.engine.setDefaultPolicies(this.coinPolicies);
    }
  }

  /**
   * Take in a template an application brought. The engine checks it against the template schema.
   * @returns the template's identifier, which is the hash of its content
   */
  async importTemplate(template: unknown): Promise<string> {
    return (await this.engine.importTemplate(template as Parameters<Engine['importTemplate']>[0])).templateIdentifier;
  }

  /** A template this account holds, by identifier. */
  async template(templateIdentifier: string): Promise<XOTemplate | undefined> {
    return this.engine.getTemplate(templateIdentifier);
  }

  /** An invitation on an application's template that is never sent: it exists to ask the engine what the template means. */
  private async probe<T>(request: ApplicationActionRequest, work: (invitationIdentifier: string, template: XOTemplate) => Promise<T>): Promise<T> {
    const template = await this.engine.getTemplate(request.templateIdentifier);
    if (template === undefined) throw new Error('This account does not hold that template.');
    const action = template.actions[request.action];
    if (action === undefined) throw new Error(`The template has no action "${request.action}".`);
    if (action.roles?.[request.role] === undefined) throw new Error(`The action "${request.action}" has no role "${request.role}".`);
    const transaction = template.transactions?.[action.transaction ?? ''];
    const [inputIdentifier] = (transaction?.inputs ?? []).map(({ input }) => input);
    if ((request.inputs ?? []).length > 0 && inputIdentifier === undefined) throw new Error(`The action "${request.action}" spends nothing.`);
    const stored = await this.engine.createInvitation({
      templateIdentifier: request.templateIdentifier,
      actionIdentifier: request.action,
      intent: applicationIntent(template, request.action, request.role),
      variables: variablesFor(request.role, typed(template, request.variables)),
      inputs: inputsFor((request.inputs ?? []).map((input) => ({ ...input, ...(inputIdentifier === undefined ? {} : { inputIdentifier }) }))),
    });
    try {
      return await work(stored.invitation.invitationIdentifier, template);
    } finally {
      // The invitation would otherwise keep holding the outputs it names.
      await this.discard(stored.invitation.invitationIdentifier);
    }
  }

  /** The script a template gives one of an action's outputs for these variables, as hex. Nothing is followed. */
  async resolveOutput(request: ApplicationActionRequest, output: string): Promise<string> {
    return this.probe(request, (invitationIdentifier) => this.engine.resolveInvitationOutputLockingBytecode(invitationIdentifier, output, request.role));
  }

  /**
   * What an action of an application's template would create and require. The scripts of its outputs are
   * followed by this account from here on, so that what is paid there can later be spent.
   */
  async resolveAction(request: ApplicationActionRequest): Promise<ResolvedAction> {
    return this.probe(request, async (invitationIdentifier, template) => {
      const transaction = template.transactions?.[template.actions[request.action]?.transaction ?? ''];
      if (transaction === undefined) throw new Error(`The action "${request.action}" has no transaction.`);
      const outputs = transaction.outputs.map(({ output }) => output);
      if (outputs.length > 0) await this.append(invitationIdentifier, { outputs: outputs.map((outputIdentifier) => ({ outputIdentifier })) });
      const built = await this.engine.buildInvitationTransactionFromMergedCommit(invitationIdentifier);
      const decoded = decodeTransactionBch(hexToBin(built.serializedTransaction));
      if (typeof decoded === 'string') throw new Error(`The engine built something that is not a transaction: ${decoded}`);
      if (decoded.outputs.length !== outputs.length) throw new Error('The action\'s transaction has outputs the template does not name.');
      if (decoded.outputs.some((output) => output.token !== undefined)) throw new Error('This wallet cannot yet carry out actions that create tokens.');
      return {
        outputs: decoded.outputs.map((output, index) => ({ output: outputs[index] as string, lockingBytecode: binToHex(output.lockingBytecode), satoshis: output.valueSatoshis })),
        locktime: decoded.locktime,
        sequenceNumbers: decoded.inputs.map((input) => input.sequenceNumber),
      };
    });
  }

  /**
   * An ordinary payment from all of this account's coins. What is left beyond the fee returns to the account.
   * @param also - further outputs to add after the payment
   */
  async pay(lockingBytecode: string, satoshis: string, also: RawOutput[] = []): Promise<Built> {
    const coins = await this.engine.listSpendableUnspentOutputs({ templateIdentifier: this.templates.coins });
    const intent = p2pkhTemplate.lockingScripts['receivingLockingScript']?.roles?.['receiver']?.actions?.find((entry) => entry.action === 'sendSatoshis');
    const stored = await this.engine.createInvitation({
      templateIdentifier: this.templates.coins,
      actionIdentifier: 'sendSatoshis',
      ...(intent === undefined ? {} : { intent }),
      variables: variablesFor('sender', { transferredSatoshis: satoshis, recipientLockingscript: lockingBytecode }),
      inputs: coins.map((coin) => ({ outpointTransactionHash: hexToBin(coin.outpointTransactionHash), outpointIndex: coin.outpointIndex })),
    });
    const { invitationIdentifier } = stored.invitation;
    await this.append(invitationIdentifier, { outputs: [{ outputIdentifier: 'transferSatoshisOutput' }, ...rawOutputsFor(also)] });
    const change = await this.engine.calculateChange(invitationIdentifier);
    if (BigInt(change.valueSatoshis) > 1_000n) await this.engine.addChangeToInvitation(invitationIdentifier);
    return this.complete(invitationIdentifier);
  }

  /** Stored invitations, newest first, serialized: what the debugging tool loads. */
  async invitations(): Promise<{ invitationIdentifier: string; action: string; invitation: string }[]> {
    const stored = await this.engine.listInvitations();
    return stored
      .map(({ invitation }) => ({
        invitationIdentifier: invitation.invitationIdentifier,
        action: invitation.actionIdentifier,
        invitation: serializeInvitation(invitation),
        createdAt: invitation.createdAtTimestamp ?? 0,
      }))
      .sort((a, b) => b.createdAt - a.createdAt)
      .map(({ invitationIdentifier, action, invitation }) => ({ invitationIdentifier, action, invitation }));
  }

  async stop(): Promise<void> {
    await this.engine.stop?.();
  }
}
