import { binToHex, encodeLockingBytecodeP2pkh, hexToBin } from '@bitauth/libauth';
import {
  type ArchiveStore,
  type JsonValue,
  type PositionDescription,
  type RestoreReport,
  type TemplateReference,
  type WriterState,
  ArchiveWriter,
  TEMPLATE_OUTPUT_KIND,
  describeTemplateOutput,
  emptyWriterState,
  templateContentHash,
} from '@grandmas-wallet/archive';
import {
  type ChallengeDelay,
  type ControllerHistory,
  type KeyPair,
  type Utxo,
  assetScript,
  deriveXoTemplateKey,
  encodeControllerState,
  readControllerHistory,
  validateGenesis,
} from '@grandmas-wallet/core';
import {
  type EnrollmentPackage,
  type PackageReceipt,
  acknowledgmentStatus,
  createArchiveAccess,
  createEnrollmentPackage,
  createRecoveryCredential,
  enrollmentLink,
  receiptOf,
  recipientKeyFingerprint,
  sealPackage,
} from '@grandmas-wallet/enrollment';
import { grandmasWalletTemplate, grandmasWalletTemplateIdentifier } from '@grandmas-wallet/templates';
import type { XOTemplate } from '@xo-cash/types';
import { generateTemplateIdentifier, parseTemplate } from '@xo-cash/utils';

import type { Built, ResolvedAction, Variables, XoAccount } from './account.js';
import { type Eligibility, recoveryEligibility } from './eligibility.js';
import {
  type AppChain,
  type Sent,
  COIN_FEE,
  CONTROLLER_SATOSHIS,
  CREATE_FEE,
  DUST,
  EXTRA_COIN_FEE,
  FUNDS_MINIMUM,
  EXTRA_FUNDS_FEE,
  EXTRA_OUTPUT_FEE,
  OWNER_ACTION_FEE,
  RECOVERER_FEE_ALLOWANCE,
  addressOf,
  checkAndSend,
  delayHex,
  fetchUtxo,
  hex,
  outpointOf,
  sats,
  waitUntilSeen,
} from './support.js';

/**
 * The owner's wallet on one device: the XO account that holds the owner key,
 * what the chain says about the wallet, and the records that let another
 * device take it over.
 *
 * The wallet knows its own template and nothing of any application. An
 * application brings its XO template; once the user trusts it, the wallet
 * carries out the template's actions by having the engine work out what an
 * action pays and spends, and wrapping that in the owner's approval.
 */

export interface StoredPosition {
  position: PositionDescription;
  /** `prepared`: recorded, not yet paid into. `open`: paid into. `closed`: emptied by this wallet. */
  status: 'prepared' | 'open' | 'closed';
  transactionId?: string;
}

/** A template an application brought and the user chose to trust. Its content is kept by the engine and in the archive. */
export interface TrustedTemplate extends TemplateReference {
  name: string;
  /** Unix seconds. */
  trustedAt: number;
}

/** What a template says about itself, for the user to decide whether to trust it. */
export interface TemplateSummary extends TemplateReference {
  name: string;
  description: string;
  actions: { action: string; name: string; description: string }[];
}

/** Variable types that hold a number but which the engine reads back from its store as text. */
const NOT_READ_BACK_AS_GIVEN = new Set(['timestamp']);

/**
 * Read a template an application presents, without taking it in.
 * @throws if it is not a valid XO template, or one this wallet could not operate safely
 */
export const inspectTemplate = (template: unknown): TemplateSummary => {
  const parsed = parseTemplate(template as Parameters<typeof parseTemplate>[0]);
  // The engine keeps a script's variables as text and reads numbers back only for some types. A value of
  // another type that was given as a number builds a different script when an output is to be unlocked, so
  // money put under such a template could not be taken out again by this wallet.
  const unreadable = Object.entries(parsed.variables ?? {}).filter(([, variable]) => NOT_READ_BACK_AS_GIVEN.has(variable.type ?? ''));
  if (unreadable.length > 0) {
    throw new Error(`The template uses a kind of value ("${unreadable[0]?.[1].type}" for "${unreadable[0]?.[0]}") that this wallet's engine cannot yet read back reliably. Money put under it might not come out again.`);
  }
  return {
    identifier: generateTemplateIdentifier(parsed),
    contentHash: templateContentHash(template as JsonValue),
    name: parsed.name ?? 'Unnamed template',
    description: parsed.description ?? '',
    actions: Object.entries(parsed.actions).map(([action, definition]) => ({ action, name: definition.name ?? action, description: definition.description ?? '' })),
  };
};

/** An action of a trusted template, as an application or the user asks for it. */
export interface ApplicationAction {
  /** The template's identifier. */
  template: string;
  action: string;
  role: string;
  variables: Record<string, string | number>;
  /** Variables the wallet is to fill in: variable name to what with. A wallet has its identity to offer. */
  bindings?: Record<string, 'identity'>;
  /** A position of this wallet that the action spends. Its recorded variables are used where the action needs them. */
  positionId?: string;
  /** What the user calls a position the action creates. */
  label?: string;
}

/** What an action comes to, in the template's words and the wallet's own figures. */
export interface ActionPreview {
  template: { identifier: string; name: string };
  action: { name: string; description: string };
  /** The template's description of the transaction, with the values filled in. */
  outcome: string;
  variables: { name: string; description: string; type: string; value: string | number }[];
  /** What the transaction pays out, by the template's rules. `kept` marks what stays a position of this wallet. */
  creates: { name: string; description: string; satoshis: bigint; kept: boolean }[];
  /** Positions of this wallet the transaction spends. */
  spends: { label: string; satoshis: bigint }[];
  /** How the wallet's own funds change: negative when the action takes from them. Worked out by the wallet. */
  fundsChange: bigint;
  fee: bigint;
  /** Unix seconds before which the network will not accept the transaction, or 0. */
  notBefore: number;
}

export interface Activity {
  /** Unix seconds. */
  at: number;
  summary: string;
  transactionId: string;
  invitationIdentifier?: string;
}

/** Everything the device keeps about the wallet besides the account's mnemonic. Saved after every change. */
export interface WalletRecord {
  version: 1;
  network: string;
  identity: string;
  genesisTransactionId: string;
  archive: EnrollmentPackage['archive'];
  templates: { wallet: TemplateReference; applications?: TrustedTemplate[] };
  writer: WriterState;
  /**
   * The recovery credential, from the wallet's creation until the package for the recoverer is made.
   * It is removed from the device at that point.
   */
  awaitingEnrollment?: { recoveryMnemonic: string };
  enrollment?: {
    /** The sealed package as a link; only the recoverer can open it. */
    link: string;
    recoverer: string;
    fingerprint: string;
    receipt: PackageReceipt;
    confirmedAt?: number;
  };
  /** Set on a device that took the wallet over: the recoverer and its package are the earlier device's. */
  takenOver?: { at: number };
  positions: StoredPosition[];
  activity: Activity[];
}

export interface WalletDependencies {
  account: XoAccount;
  /** The account's mnemonic, from which the owner key is derived for signing records. */
  mnemonic: string;
  chain: AppChain;
  /** The device's copy of the archive. */
  local: ArchiveStore;
  openStore: (url: string) => ArchiveStore;
  save: (record: WalletRecord) => void | Promise<void>;
  /** Unix seconds. */
  now?: () => number;
  onProgress?: (step: string) => void;
}

export interface PositionView extends StoredPosition {
  /** Satoshis at the position's address now. */
  held: bigint;
  outputs: { transactionId: string; index: number; valueSatoshis: bigint }[];
  /** The name of the position's template, if this device holds it. */
  templateName?: string;
  /** The position's variables as the template names them. */
  details: { name: string; type: string; value: string | number }[];
  /** What the template lets the wallet do with the position. */
  actions: { action: string; role: string; name: string; description: string }[];
}

export interface WalletView {
  identity: string;
  /** Where the wallet receives. */
  address: string;
  balance: bigint;
  /** What one payment can send at most, after the fee and the smallest amount that must stay. */
  spendable: bigint;
  /** Whether this device holds the key the wallet currently names as owner. */
  ownedHere: boolean;
  ownerEpoch: number;
  status: 'active' | 'pending';
  /** While a recovery request is open: who would become owner, and whether that is this device. */
  pending?: { proposedOwnerKeyHash: string; requestedIn: string; confirmed: boolean; forThisDevice: boolean };
  challengeDelay: ChallengeDelay;
  recovererKeyHash: string;
  positions: PositionView[];
}

const KEY_INDEXES = [0, 1, 2, 3, 4, 5, 6, 7];
const walletTemplateJson = grandmasWalletTemplate as unknown as JsonValue;

export const templateReferences = (): WalletRecord['templates'] => ({
  wallet: { identifier: grandmasWalletTemplateIdentifier, contentHash: templateContentHash(walletTemplateJson) },
  applications: [],
});

/** Put values into a template's text where it refers to variables as `$(<name>)`. */
const fill = (text: string | undefined, variables: Record<string, string | number>): string =>
  (text ?? '').replaceAll(/\$\(<([A-Za-z0-9_]+)>\)/g, (whole, name: string) => (variables[name] === undefined ? whole : String(variables[name])));

/** The smallest amount the network relays at a script, which depends on the script's length. */
const smallestAt = (lockingBytecode: string): bigint => (lockingBytecode.length / 2 > 25 ? FUNDS_MINIMUM : DUST);

/** Everything worked out about an action before anything is recorded or signed. */
interface ActionPlan {
  preview: ActionPreview;
  resolved: ResolvedAction;
  spent: PositionView | undefined;
  /** Positions the action creates that are not yet on record. */
  created: PositionDescription[];
  useFunds: boolean;
  /** Everything the transaction takes in besides the controller. */
  incoming: bigint;
  outgoing: bigint;
  summary: string;
}

/** The keys the account's engine derives for the wallet template, in order. */
export const walletKeys = (mnemonic: string, network: string): KeyPair[] =>
  KEY_INDEXES.map((index) => deriveXoTemplateKey(mnemonic, grandmasWalletTemplateIdentifier, index, network === 'mainnet' ? 'mainnet' : 'testnet'));

/** What a new wallet needs in ordinary coins: its controller, fees, the recoverer's fee allowance, and something to hold. */
export const MINIMUM_TO_CREATE = CONTROLLER_SATOSHIS + CREATE_FEE + COIN_FEE + EXTRA_OUTPUT_FEE + RECOVERER_FEE_ALLOWANCE + OWNER_ACTION_FEE + DUST + FUNDS_MINIMUM;

export interface CreateOptions {
  network: string;
  stores: string[];
  challengeDelay: ChallengeDelay;
}

export class OwnerWallet {
  private history!: ControllerHistory;
  private funds: Utxo[] = [];
  private view!: WalletView;
  private readonly writer: ArchiveWriter;
  /** Actions run one after another: each spends the controller the one before it made. */
  private last: Promise<unknown> = Promise.resolve();

  private constructor(
    private readonly deps: WalletDependencies,
    readonly record: WalletRecord,
  ) {
    this.writer = new ArchiveWriter({
      network: record.network,
      identity: record.identity,
      archiveId: hexToBin(record.archive.archiveId),
      contentKey: hexToBin(record.archive.contentKey),
      local: deps.local,
      stores: record.archive.stores.map(deps.openStore),
      signer: () => {
        const key = this.ownerKey();
        if (key === undefined) throw new Error('This device does not hold the wallet\'s owner key.');
        return { key, ownerEpoch: this.history.current.state.ownerEpoch };
      },
      state: record.writer,
      persist: async (state) => {
        record.writer = state;
        await deps.save(record);
      },
      ...(deps.now === undefined ? {} : { now: deps.now }),
    });
  }

  private now(): number {
    return this.deps.now?.() ?? Math.floor(Date.now() / 1000);
  }

  private exclusive<T>(work: () => Promise<T>): Promise<T> {
    const result = this.last.then(work, work);
    this.last = result.catch(() => undefined);
    return result;
  }

  private async save(): Promise<void> {
    await this.deps.save(this.record);
  }

  private get identity(): Uint8Array {
    return hexToBin(this.record.identity);
  }

  private ownerKey(): KeyPair | undefined {
    const owner = hex(this.history.current.state.ownerKeyHash);
    return walletKeys(this.deps.mnemonic, this.record.network).find((key) => hex(key.keyHash) === owner);
  }

  private note(summary: string, sent: Pick<Sent, 'transactionId' | 'invitationIdentifier'>): void {
    this.record.activity.unshift({ at: this.now(), summary, transactionId: sent.transactionId, invitationIdentifier: sent.invitationIdentifier });
    this.record.activity.splice(50);
  }

  /** Open the wallet a device already has. */
  static async open(deps: WalletDependencies, record: WalletRecord): Promise<OwnerWallet> {
    const wallet = new OwnerWallet(deps, record);
    await wallet.refresh();
    return wallet;
  }

  /**
   * Create a wallet from the account's ordinary coins.
   *
   * The recovery credential is made here, and its key hash goes into the wallet as the recoverer. Part of
   * the coins is set aside at the credential's own address, so that whoever receives the credential can
   * pay the fees of a recovery. The backup stores are written to before the wallet is created, so a wallet
   * is never made that could not be recorded.
   */
  static async create(deps: WalletDependencies, options: CreateOptions): Promise<OwnerWallet> {
    const { account, chain } = deps;
    const say = deps.onProgress ?? (() => undefined);
    const coins = await account.coins();
    const total = coins.reduce((sum, coin) => sum + BigInt(coin.satoshis), 0n);
    if (total < MINIMUM_TO_CREATE) throw new Error(`Creating a wallet needs at least ${MINIMUM_TO_CREATE} satoshis; ${total} have arrived.`);

    const credential = createRecoveryCredential(grandmasWalletTemplateIdentifier, options.network);
    // The engine of whoever holds the credential receives ordinary coins at the first key of the coin template.
    const feeKey = deriveXoTemplateKey(credential.mnemonic, account.coinTemplate, 0, options.network === 'mainnet' ? 'mainnet' : 'testnet');
    const recovererCoins = hex(encodeLockingBytecodeP2pkh(feeKey.keyHash));

    // The identity is the hash of a transaction whose first output funds the wallet; make such an output.
    say('Preparing the coins');
    const fee = COIN_FEE + EXTRA_COIN_FEE * BigInt(coins.length - 1) + EXTRA_OUTPUT_FEE;
    const funding = total - fee - RECOVERER_FEE_ALLOWANCE;
    const prepared = await account.pay(account.coinLockingBytecode, sats(funding), [{ lockingBytecode: recovererCoins, satoshis: String(RECOVERER_FEE_ALLOWANCE) }]);
    await checkAndSend(account, chain, prepared);
    await waitUntilSeen(account, [{ transactionId: prepared.transactionId, index: 0 }]);
    const identity = prepared.transactionId;

    const record: WalletRecord = {
      version: 1,
      network: options.network,
      identity,
      genesisTransactionId: '',
      archive: createArchiveAccess(options.stores),
      templates: templateReferences(),
      writer: emptyWriterState(),
      awaitingEnrollment: { recoveryMnemonic: credential.mnemonic },
      positions: [],
      activity: [],
    };
    const wallet = new OwnerWallet(deps, record);

    // The template is kept whole in the archive, so that restoring does not depend on finding it elsewhere.
    say('Checking the backup');
    await wallet.writer.putTemplate(walletTemplateJson);
    await wallet.writer.flush();

    say('Creating the wallet');
    const received = funding - CONTROLLER_SATOSHIS - CREATE_FEE;
    const built = await account.start({
      action: 'createWallet',
      role: 'owner',
      variables: {
        identity,
        recovererKeyHash: hex(credential.keyHash),
        challengeDelay: delayHex(options.challengeDelay),
        controllerSatoshis: sats(CONTROLLER_SATOSHIS),
        receivedSatoshis: sats(received),
      },
      derive: { ownerKeyHash: 'ownerKey' },
      inputs: [{ transactionId: identity, index: 0 }],
      outputs: ['newControllerOutput', 'receivedFundsOutput'],
    });
    const sent = await checkAndSend(account, chain, built);
    validateGenesis(sent.transaction, hexToBin(sent.transactionId), hexToBin(identity));
    if (hex(sent.transaction.outputs[1]?.lockingBytecode ?? new Uint8Array()) !== hex(assetScript(hexToBin(identity)).lockingBytecode)) {
      throw new Error('The wallet address the engine produced differs from the one this wallet derives.');
    }
    record.genesisTransactionId = sent.transactionId;
    wallet.note('Wallet created', sent);
    await wallet.save();
    await wallet.refresh();
    return wallet;
  }

  /**
   * Take over a wallet on a new device, from what restoring found. The account must already hold the
   * key the wallet names as owner.
   */
  static async takeOver(
    deps: WalletDependencies,
    wallet: Pick<WalletRecord, 'network' | 'identity' | 'genesisTransactionId' | 'archive'>,
    report: RestoreReport,
  ): Promise<OwnerWallet> {
    const record: WalletRecord = {
      version: 1,
      ...wallet,
      templates: templateReferences(),
      writer: report.writerState,
      takenOver: { at: deps.now?.() ?? Math.floor(Date.now() / 1000) },
      positions: report.positions.map(({ position, recorded, onChain }) => ({
        position,
        status: recorded === 'closed' || onChain === 'spent' ? 'closed' : onChain === 'live' ? 'open' : 'prepared',
      })),
      activity: [],
    };
    // The templates the earlier device trusted come with the archive; this device takes them in as they are.
    const trusted = new Map<string, TrustedTemplate>();
    for (const { position, template } of report.positions) {
      if (template === undefined || position.template === undefined || trusted.has(position.template.identifier)) continue;
      const identifier = await deps.account.importTemplate(template).catch(() => undefined);
      if (identifier !== position.template.identifier) continue;
      trusted.set(identifier, { ...position.template, name: inspectTemplate(template).name, trustedAt: record.takenOver?.at ?? 0 });
    }
    record.templates.applications = [...trusted.values()];

    const taken = new OwnerWallet(deps, record);
    await taken.refresh();
    if (!taken.view.ownedHere) throw new Error('This device does not hold the key the wallet names as its owner.');

    // The device starts following the wallet's address and each open position. Neither needs a key.
    const address = await deps.account.trackWallet({ identity: record.identity });
    if (address !== hex(assetScript(taken.identity).lockingBytecode)) throw new Error('This device derived a different wallet address.');
    for (const { position, status } of record.positions) {
      // A position this device cannot follow is still listed; it just cannot be operated from here.
      if (status === 'open') await taken.follow(position).catch(() => undefined);
    }
    await taken.save();
    await taken.refresh();
    return taken;
  }

  /**
   * Have the account's engine follow a position, so that what is there can be spent. The script is worked
   * out again from the position's template and must be the recorded one.
   */
  private async follow(position: PositionDescription): Promise<void> {
    const { origin, template } = position;
    if (position.kind !== TEMPLATE_OUTPUT_KIND || origin === undefined || template === undefined) {
      throw new Error('This wallet does not know how to operate that position.');
    }
    const resolved = await this.deps.account.resolveAction({ templateIdentifier: template.identifier, action: origin.action, role: origin.role, variables: position.parameters });
    if (!resolved.outputs.some((output) => output.output === origin.output && output.lockingBytecode === position.lockingBytecode)) {
      throw new Error('The position\'s address from its template differs from the recorded one.');
    }
  }

  /** Read the wallet's state from the chain. */
  async refresh(): Promise<WalletView> {
    const { chain } = this.deps;
    const { record } = this;
    const funds = assetScript(this.identity);
    if (record.genesisTransactionId === '') {
      throw new Error('The wallet\'s creation was not completed on this device.');
    }
    this.history = await readControllerHistory(chain, this.identity, record.genesisTransactionId);
    const unspent = await chain.listUnspent(funds.lockingBytecode);
    this.funds = await Promise.all(unspent.map((entry) => fetchUtxo(chain, entry.transactionId, entry.index)));
    const balance = this.funds.reduce((sum, utxo) => sum + utxo.output.valueSatoshis, 0n);

    const positions: PositionView[] = [];
    for (const stored of record.positions) {
      const outputs = stored.status === 'closed' ? [] : await chain.listUnspent(hexToBin(stored.position.lockingBytecode));
      positions.push({
        ...stored,
        held: outputs.reduce((sum, entry) => sum + entry.valueSatoshis, 0n),
        outputs: outputs.map(({ transactionId, index, valueSatoshis }) => ({ transactionId, index, valueSatoshis })),
        ...(await this.describePosition(stored.position)),
      });
    }

    const { state } = this.history.current;
    const mine = new Set(walletKeys(this.deps.mnemonic, record.network).map((key) => hex(key.keyHash)));
    const last = this.history.transactions.at(-1);
    const spendable = balance - this.actionFee(this.funds.length) - FUNDS_MINIMUM;
    this.view = {
      identity: record.identity,
      address: addressOf(funds.lockingBytecode, record.network),
      balance,
      spendable: spendable > 0n ? spendable : 0n,
      ownedHere: mine.has(hex(state.ownerKeyHash)),
      ownerEpoch: state.ownerEpoch,
      status: state.status,
      ...(state.proposedOwnerKeyHash === undefined || last === undefined
        ? {}
        : {
            pending: {
              proposedOwnerKeyHash: hex(state.proposedOwnerKeyHash),
              requestedIn: last.transactionId,
              confirmed: last.confirmed,
              forThisDevice: mine.has(hex(state.proposedOwnerKeyHash)),
            },
          }),
      challengeDelay: state.challengeDelay,
      recovererKeyHash: hex(state.recovererKeyHash),
      positions,
    };
    return this.view;
  }

  get current(): WalletView {
    return this.view;
  }

  get controller(): ControllerHistory {
    return this.history;
  }

  /** About what an owner's action costs: one for the controller with one further input and two further outputs, more for more. */
  private actionFee(furtherInputs: number, furtherOutputs = 2): bigint {
    return OWNER_ACTION_FEE + EXTRA_FUNDS_FEE * BigInt(Math.max(furtherInputs - 1, 0)) + EXTRA_OUTPUT_FEE * BigInt(Math.max(furtherOutputs - 2, 0));
  }

  private controllerInput(inputIdentifier: string) {
    return { ...outpointOf(this.history.current.utxo), inputIdentifier };
  }

  private baseVariables(): Variables {
    return {
      identity: this.record.identity,
      controllerState: hex(encodeControllerState(this.history.current.state)),
      controllerSatoshis: sats(this.history.current.utxo.output.valueSatoshis),
    };
  }

  /** An action by the owner that spends the controller and the wallet's funds, returning what is left to the wallet. */
  private async act(action: string, variables: Variables, middleOutputs: string[], spending: bigint): Promise<Sent> {
    await this.refresh();
    if (!this.view.ownedHere) throw new Error('This device no longer controls the wallet.');
    if (this.funds.length === 0) throw new Error('The wallet holds no funds to pay the network fee with.');
    const fee = this.actionFee(this.funds.length);
    const change = this.view.balance - spending - fee;
    if (change < FUNDS_MINIMUM) {
      throw new Error(`Not enough funds: after the fee of ${fee} satoshis, at most ${this.view.spendable} can be used and ${FUNDS_MINIMUM} must stay in the wallet.`);
    }
    const fundsInputs = this.funds.map((utxo) => ({ ...outpointOf(utxo), inputIdentifier: 'walletInput' }));
    await waitUntilSeen(this.deps.account, [this.controllerInput(''), ...fundsInputs]);
    const built = await this.deps.account.start({
      action,
      role: 'owner',
      variables: { ...this.baseVariables(), changeSatoshis: sats(change), ...variables },
      inputs: [this.controllerInput('ownerControllerInput'), ...fundsInputs],
      outputs: ['activeControllerOutput', ...middleOutputs, 'changeOutput'],
    });
    return checkAndSend(this.deps.account, this.deps.chain, built);
  }

  /** Pay from the wallet's funds. */
  send(lockingBytecode: Uint8Array, satoshis: bigint, summary = `Sent ${satoshis} satoshis`): Promise<Sent> {
    return this.exclusive(() => this.sendNow(lockingBytecode, satoshis, summary));
  }

  private async sendNow(lockingBytecode: Uint8Array, satoshis: bigint, summary: string): Promise<Sent> {
    if (satoshis < DUST) throw new Error(`The smallest amount that can be sent is ${DUST} satoshis.`);
    const sent = await this.act('send', { sentSatoshis: sats(satoshis), recipientLockingScript: hex(lockingBytecode) }, ['paymentOutput'], satoshis);
    this.note(summary, sent);
    await this.save();
    await this.refresh();
    return sent;
  }

  private async applicationTemplate(identifier: string): Promise<XOTemplate | undefined> {
    return this.deps.account.template(identifier).catch(() => undefined);
  }

  /** What a position's template says about it: its name, its variables, and what can be done with it. */
  private async describePosition(position: PositionDescription): Promise<Pick<PositionView, 'templateName' | 'details' | 'actions'>> {
    const template = position.template === undefined ? undefined : await this.applicationTemplate(position.template.identifier);
    const { origin } = position;
    if (template === undefined || origin === undefined) {
      return { details: Object.entries(position.parameters).map(([name, value]) => ({ name, type: 'string', value })), actions: [] };
    }
    const lockingScript = template.lockingScripts?.[template.outputs?.[origin.output]?.lockingScript ?? ''];
    // The position is described by what its script is made from, not by everything its creating action was given.
    const shown = lockingScript?.state?.variables ?? Object.keys(position.parameters);
    return {
      templateName: template.name ?? 'Unnamed template',
      details: shown.flatMap((name) => {
        const value = position.parameters[name];
        const definition = template.variables?.[name];
        return value === undefined ? [] : [{ name: definition?.name ?? name, type: definition?.type ?? 'string', value }];
      }),
      actions: (lockingScript?.roles?.[origin.role]?.actions ?? []).flatMap(({ action, role }) => {
        const definition = template.actions[action];
        return definition === undefined ? [] : [{ action, role: role ?? origin.role, name: definition.name ?? action, description: definition.description ?? '' }];
      }),
    };
  }

  get trustedTemplates(): TrustedTemplate[] {
    return this.record.templates.applications ?? [];
  }

  /**
   * Trust a template an application brought, and remember it. The template is checked against the XO
   * template schema, taken in by the engine, and kept whole in the archive, so that a device taking the
   * wallet over can operate what was made with it.
   */
  async trustTemplate(template: unknown): Promise<TrustedTemplate> {
    const summary = inspectTemplate(template);
    const known = this.trustedTemplates.find((item) => item.identifier === summary.identifier);
    if (known !== undefined) return known;
    const identifier = await this.deps.account.importTemplate(template);
    if (identifier !== summary.identifier) throw new Error('The engine gives this template a different identifier.');
    await this.writer.putTemplate(template as JsonValue);
    await this.writer.flush();
    const trusted: TrustedTemplate = { identifier, contentHash: summary.contentHash, name: summary.name, trustedAt: this.now() };
    this.record.templates.applications = [...this.trustedTemplates, trusted];
    await this.save();
    return trusted;
  }

  /** Work out everything about an action: what its template makes of it, and what it means for this wallet. */
  private async plan(request: ApplicationAction): Promise<ActionPlan> {
    await this.refresh();
    if (!this.view.ownedHere) throw new Error('This device no longer controls the wallet.');
    const reference = this.trustedTemplates.find((item) => item.identifier === request.template);
    const template = reference === undefined ? undefined : await this.applicationTemplate(reference.identifier);
    if (reference === undefined || template === undefined) throw new Error('This wallet has not been told to trust that template.');
    const action = template.actions[request.action];
    const role = action?.roles?.[request.role];
    if (action === undefined || role === undefined) throw new Error(`The template "${reference.name}" has no action "${request.action}" for the role "${request.role}".`);
    const transaction = template.transactions?.[action.transaction ?? ''];
    if (transaction === undefined) throw new Error(`The action "${request.action}" has no transaction.`);

    const spent = request.positionId === undefined ? undefined : this.view.positions.find((item) => item.position.positionId === request.positionId);
    if (request.positionId !== undefined) {
      if (spent === undefined || spent.position.template?.identifier !== reference.identifier) throw new Error('This wallet has no such position of that template.');
      if (spent.outputs.length === 0) throw new Error(`"${spent.position.label ?? 'The position'}" holds nothing.`);
      await this.follow(spent.position);
    }
    if (transaction.inputs.length > 0 && spent === undefined) throw new Error(`The action "${action.name ?? request.action}" spends a position; none was named.`);
    if (transaction.inputs.length === 0 && spent !== undefined) throw new Error(`The action "${action.name ?? request.action}" spends no position.`);

    // The values: the position's own, then the application's, then what the wallet itself supplies.
    const given: Record<string, string | number> = { ...spent?.position.parameters, ...request.variables };
    for (const [name, source] of Object.entries(request.bindings ?? {})) {
      if (source !== 'identity') throw new Error(`This wallet has nothing called "${String(source)}" to offer.`);
      given[name] = this.record.identity;
    }
    const declared = role.requirements?.variables ?? [];
    const variables: Record<string, string | number> = {};
    for (const name of declared) {
      const value = given[name];
      if (value === undefined) throw new Error(`The action needs a value for "${template.variables?.[name]?.name ?? name}".`);
      variables[name] = value;
    }

    const resolved = await this.deps.account.resolveAction({
      templateIdentifier: reference.identifier,
      action: request.action,
      role: request.role,
      variables,
      ...(spent === undefined ? {} : { inputs: spent.outputs.map(({ transactionId, index }) => ({ transactionId, index })) }),
    });
    if (resolved.sequenceNumbers.some((sequence) => sequence !== 0)) throw new Error('This wallet cannot yet carry out actions whose inputs need a waiting period of their own.');
    for (const output of resolved.outputs) {
      if (output.satoshis < smallestAt(output.lockingBytecode)) throw new Error(`The action would pay ${output.satoshis} satoshis to one place, less than the network relays.`);
    }

    // The wallet's part: its funds are used when what the action spends does not cover what it pays.
    const incoming = spent?.held ?? 0n;
    const outgoing = resolved.outputs.reduce((sum, output) => sum + output.satoshis, 0n);
    const alone = this.actionFee(spent?.outputs.length ?? 0, resolved.outputs.length + 1);
    const useFunds = incoming < outgoing + alone + FUNDS_MINIMUM;
    const fee = useFunds ? this.actionFee((spent?.outputs.length ?? 0) + this.funds.length, resolved.outputs.length + 1) : alone;
    const returned = incoming + (useFunds ? this.view.balance : 0n) - outgoing - fee;
    if (returned < FUNDS_MINIMUM) {
      throw new Error(`Not enough funds: the action pays out ${outgoing} satoshis, the fee is about ${fee}, and ${FUNDS_MINIMUM} must stay in the wallet.`);
    }

    const created: PositionDescription[] = [];
    const creates = resolved.outputs.map((output) => {
      const definition = template.outputs?.[output.output];
      // What the wallet has a role on stays its own, as a position; anything else is a payment away.
      const kept = template.lockingScripts?.[definition?.lockingScript ?? '']?.roles?.[request.role] !== undefined;
      const onRecord = this.record.positions.some((item) => item.status !== 'closed' && item.position.lockingBytecode === output.lockingBytecode);
      if (kept && !onRecord) {
        created.push(
          describeTemplateOutput({
            positionId: `${output.output}-${binToHex(crypto.getRandomValues(new Uint8Array(6)))}`,
            template: { identifier: reference.identifier, contentHash: reference.contentHash },
            origin: { action: request.action, role: request.role, output: output.output },
            variables,
            lockingBytecode: output.lockingBytecode,
            label: (request.label ?? definition?.name ?? reference.name).slice(0, 40),
          }),
        );
      }
      return { name: definition?.name ?? output.output, description: fill(definition?.description, variables), satoshis: output.satoshis, kept };
    });

    const name = action.name ?? request.action;
    const label = spent?.position.label ?? created[0]?.label;
    return {
      resolved,
      spent,
      created,
      useFunds,
      incoming,
      outgoing,
      summary: label === undefined ? name : `${name}: "${label}"`,
      preview: {
        template: { identifier: reference.identifier, name: reference.name },
        action: { name, description: action.description ?? '' },
        outcome: fill(transaction.description, variables),
        variables: declared.map((variable) => {
          const definition = template.variables?.[variable];
          return { name: definition?.name ?? variable, description: definition?.description ?? '', type: definition?.type ?? 'string', value: variables[variable] as string | number };
        }),
        creates,
        spends: spent === undefined ? [] : [{ label: spent.position.label ?? 'Position', satoshis: spent.held }],
        fundsChange: returned - (useFunds ? this.view.balance : 0n),
        fee,
        notBefore: resolved.locktime >= 500_000_000 ? resolved.locktime : 0,
      },
    };
  }

  /** What an action would do, for showing to the user. Nothing is recorded, signed or sent. */
  previewAction(request: ApplicationAction): Promise<ActionPreview> {
    return this.exclusive(async () => (await this.plan(request)).preview);
  }

  /**
   * Carry out an action of a trusted template.
   *
   * The engine works out from the template what the action pays and spends. The wallet wraps that in the
   * owner's approval: the controller, the position being spent if any, the wallet's funds if they are
   * needed, and whatever is left over returned to the wallet. Positions the action creates are recorded in
   * the archive first, and nothing is signed until the backup stores have confirmed.
   *
   * @param onRecorded - called once the records are safe and signing begins
   * @throws NotYetValidError while the network's clock is still behind a time the action waits for
   */
  runAction(request: ApplicationAction, onRecorded?: () => void): Promise<Sent & { positions: string[] }> {
    return this.exclusive(() => this.runActionNow(request, onRecorded));
  }

  private async runActionNow(request: ApplicationAction, onRecorded?: () => void): Promise<Sent & { positions: string[] }> {
    const plan = await this.plan(request);
    const { account, chain } = this.deps;
    const spentInputs = (plan.spent?.outputs ?? []).map(({ transactionId, index }) => ({ transactionId, index }));
    const fundsInputs = plan.useFunds ? this.funds.map((utxo) => outpointOf(utxo)) : [];
    const available = plan.incoming + (plan.useFunds ? this.view.balance : 0n);
    const wallet = hex(assetScript(this.identity).lockingBytecode);

    const build = (fee: bigint): Promise<Built> => {
      const returned = available - plan.outgoing - fee;
      if (returned < FUNDS_MINIMUM) throw new Error(`Not enough funds: after the fee of ${fee} satoshis, less than ${FUNDS_MINIMUM} would stay in the wallet.`);
      return account.start({
        action: 'approve',
        role: 'owner',
        variables: this.baseVariables(),
        inputs: [this.controllerInput('ownerControllerInput'), ...spentInputs, ...fundsInputs],
        outputs: ['activeControllerOutput'],
        rawOutputs: [...plan.resolved.outputs.map((output) => ({ lockingBytecode: output.lockingBytecode, satoshis: String(output.satoshis) })), { lockingBytecode: wallet, satoshis: String(returned) }],
        ...(plan.resolved.locktime === 0 ? {} : { locktime: plan.resolved.locktime }),
      });
    };
    const send = async (): Promise<Sent> => {
      await waitUntilSeen(account, [this.controllerInput(''), ...spentInputs, ...fundsInputs]);
      // The fee is set from the size of the transaction as built, since its size depends on the application's scripts.
      let built = await build(plan.preview.fee);
      const size = BigInt(built.transactionHex.length / 2);
      if (plan.preview.fee < size || plan.preview.fee > size + 200n) {
        await account.discard(built.invitationIdentifier);
        built = await build(size + 20n);
      }
      return checkAndSend(account, chain, built);
    };

    let sent: Sent;
    const stored: StoredPosition[] = plan.created.map((position) => ({ position, status: 'prepared' }));
    if (stored.length > 0) {
      sent = await this.writer.protect(plan.created, async () => {
        onRecorded?.();
        this.record.positions.push(...stored);
        await this.save();
        return send();
      });
    } else {
      onRecorded?.();
      sent = await send();
    }
    for (const item of stored) {
      item.status = 'open';
      item.transactionId = sent.transactionId;
    }
    const closed = plan.spent === undefined ? undefined : this.record.positions.find((item) => item.position.positionId === plan.spent?.position.positionId);
    if (closed !== undefined) closed.status = 'closed';
    this.note(plan.summary, sent);
    await this.save();
    for (const position of plan.created) await this.writer.confirm(position, sent.transactionId);
    if (plan.spent !== undefined) await this.writer.close(plan.spent.position, sent.transactionId);
    await this.refresh();
    return { ...sent, positions: plan.created.map((position) => position.positionId) };
  }

  /** Cancel an open recovery request. Only the current owner can. */
  cancelRecovery(): Promise<Sent> {
    return this.exclusive(() => this.cancelRecoveryNow());
  }

  private async cancelRecoveryNow(): Promise<Sent> {
    await this.refresh();
    if (this.view.status !== 'pending') throw new Error('There is no recovery request to cancel.');
    const sent = await this.act('cancelRecovery', {}, [], 0n);
    this.note('Cancelled a recovery request', sent);
    await this.save();
    await this.refresh();
    return sent;
  }

  /**
   * Make the package for the recoverer and seal it to the recoverer's key. Returns a link only the
   * recoverer can open. The recovery credential is removed from this device.
   */
  async enroll(recoverer: { publicKey: Uint8Array; name: string; page: string }): Promise<string> {
    const pending = this.record.awaitingEnrollment;
    if (pending === undefined) throw new Error('The package for the recoverer has already been made.');
    const ownerKey = this.ownerKey();
    if (ownerKey === undefined) throw new Error('This device no longer controls the wallet.');
    const signed = createEnrollmentPackage({
      network: this.record.network,
      identity: this.identity,
      genesisTransactionId: this.record.genesisTransactionId,
      state: this.history.current.state,
      template: this.record.templates.wallet,
      credential: {
        mnemonic: pending.recoveryMnemonic,
        derivation: { scheme: 'xo-template', templateIdentifier: grandmasWalletTemplateIdentifier, keyIndex: 0 },
      },
      archive: this.record.archive,
      manifest: this.record.positions.filter((item) => item.status === 'open').map((item) => item.position),
      recoverer: recoverer.name,
      ownerKey,
      now: this.now(),
    });
    const link = enrollmentLink(recoverer.page, await sealPackage(signed, recoverer.publicKey));
    this.record.enrollment = { link, recoverer: recoverer.name, fingerprint: recipientKeyFingerprint(recoverer.publicKey), receipt: receiptOf(signed) };
    delete this.record.awaitingEnrollment;
    await this.save();
    return link;
  }

  /** Whether the recoverer has confirmed receiving the package. */
  async checkEnrollment(): Promise<boolean> {
    const { enrollment } = this.record;
    if (enrollment === undefined) return false;
    if (enrollment.confirmedAt !== undefined) return true;
    const status = await acknowledgmentStatus(enrollment.receipt, this.record.archive.stores.map(this.deps.openStore));
    if (status.status !== 'recoverer-confirmed') return false;
    enrollment.confirmedAt = status.receivedAt;
    await this.save();
    return true;
  }

  /** When an open recovery request could be completed, by the chain. */
  async pendingEligibility(): Promise<Eligibility | undefined> {
    const pending = this.view.pending;
    if (pending === undefined) return undefined;
    const entries = await this.deps.chain.getHistory(this.history.current.utxo.output.lockingBytecode);
    const height = entries.find((entry) => entry.transactionId === pending.requestedIn)?.height ?? 0;
    return recoveryEligibility(this.deps.chain, height, this.view.challengeDelay);
  }

  /** How far each backup store is behind the device's copy. */
  backupStatus(): Promise<{ name: string; held: number; total: number }[]> {
    return this.writer.status();
  }

  /** Send the backup stores anything they lack. */
  async syncBackup(): Promise<void> {
    await this.writer.flush();
  }
}
