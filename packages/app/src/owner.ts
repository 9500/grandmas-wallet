import { binToHex, encodeLockingBytecodeP2pkh, hexToBin } from '@bitauth/libauth';
import {
  type ArchiveStore,
  type JsonValue,
  type PositionDescription,
  type RestoreReport,
  type TemplateReference,
  type WriterState,
  ArchiveWriter,
  describeSavingsJar,
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
  savingsJarScript,
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
import {
  grandmasWalletTemplate,
  grandmasWalletTemplateIdentifier,
  savingsJarTemplate,
  savingsJarTemplateIdentifier,
} from '@grandmas-wallet/templates';

import type { Variables, XoAccount } from './account.js';
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
 */

export interface StoredPosition {
  position: PositionDescription;
  /** `prepared`: recorded, not yet paid into. `open`: paid into. `closed`: emptied by this wallet. */
  status: 'prepared' | 'open' | 'closed';
  transactionId?: string;
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
  templates: { wallet: TemplateReference; jar: TemplateReference };
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
  unlockTime: number | undefined;
  /** Satoshis at the position's address now. */
  held: bigint;
  outputs: { transactionId: string; index: number; valueSatoshis: bigint }[];
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
const jarTemplateJson = savingsJarTemplate as unknown as JsonValue;

export const templateReferences = (): WalletRecord['templates'] => ({
  wallet: { identifier: grandmasWalletTemplateIdentifier, contentHash: templateContentHash(walletTemplateJson) },
  jar: { identifier: savingsJarTemplateIdentifier, contentHash: templateContentHash(jarTemplateJson) },
});

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

    // Both templates are kept whole in the archive, so that restoring does not depend on finding them elsewhere.
    say('Checking the backup');
    await wallet.writer.putTemplate(walletTemplateJson);
    await wallet.writer.putTemplate(jarTemplateJson);
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
    const taken = new OwnerWallet(deps, record);
    await taken.refresh();
    if (!taken.view.ownedHere) throw new Error('This device does not hold the key the wallet names as its owner.');

    // The device starts following the wallet's address and each open position. Neither needs a key.
    const address = await deps.account.track('wallet', { identity: record.identity });
    if (address !== hex(assetScript(taken.identity).lockingBytecode)) throw new Error('This device derived a different wallet address.');
    for (const { position, status } of record.positions) {
      if (status === 'open') await taken.follow(position);
    }
    await taken.save();
    return taken;
  }

  /** Have the account's engine follow a savings jar, so that it can be emptied. */
  private async follow(position: PositionDescription): Promise<void> {
    const unlockTime = position.parameters['unlockTime'];
    if (position.kind !== 'savings-jar' || typeof unlockTime !== 'number') return;
    const tracked = await this.deps.account.track('jar', { identity: this.record.identity, unlockTime });
    if (tracked !== position.lockingBytecode) throw new Error('The savings jar address from its template differs from the recorded one.');
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
      const unlockTime = stored.position.parameters['unlockTime'];
      positions.push({
        ...stored,
        unlockTime: typeof unlockTime === 'number' ? unlockTime : undefined,
        held: outputs.reduce((sum, entry) => sum + entry.valueSatoshis, 0n),
        outputs: outputs.map(({ transactionId, index, valueSatoshis }) => ({ transactionId, index, valueSatoshis })),
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

  private actionFee(fundsOutputs: number): bigint {
    return OWNER_ACTION_FEE + EXTRA_FUNDS_FEE * BigInt(Math.max(fundsOutputs - 1, 0));
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

  /**
   * Open a savings jar: funds that stay under the wallet's control but cannot be touched before a time.
   * The jar is recorded in the archive first, and nothing is signed until the backup stores have confirmed.
   */
  openJar(satoshis: bigint, unlockTime: number, label = 'Savings jar', onRecorded?: () => void): Promise<Sent> {
    return this.exclusive(() => this.openJarNow(satoshis, unlockTime, label, onRecorded));
  }

  private async openJarNow(satoshis: bigint, unlockTime: number, label: string, onRecorded?: () => void): Promise<Sent> {
    // The jar pays the fee for emptying it from what it holds.
    const least = OWNER_ACTION_FEE + FUNDS_MINIMUM;
    if (satoshis < least) throw new Error(`A jar needs at least ${least} satoshis, so that it can pay the network fee when it is emptied.`);
    const jar = savingsJarScript(this.identity, unlockTime);
    const position = describeSavingsJar(this.record.identity, unlockTime, {
      positionId: `jar-${unlockTime}-${binToHex(crypto.getRandomValues(new Uint8Array(3)))}`,
      label,
      template: this.record.templates.jar,
    });
    const stored: StoredPosition = { position, status: 'prepared' };
    const sent = await this.writer.protect([position], async () => {
      onRecorded?.();
      this.record.positions.push(stored);
      await this.save();
      return this.act('send', { sentSatoshis: sats(satoshis), recipientLockingScript: hex(jar.lockingBytecode) }, ['paymentOutput'], satoshis);
    });
    stored.status = 'open';
    stored.transactionId = sent.transactionId;
    this.note(`Put ${satoshis} satoshis into "${label}"`, sent);
    await this.save();
    await this.writer.confirm(position, sent.transactionId);
    await this.follow(position);
    await this.refresh();
    return sent;
  }

  /**
   * Empty a savings jar into the wallet, once its time has come.
   * @throws NotYetValidError while the network's clock is still behind the jar's unlock time
   */
  emptyJar(positionId: string): Promise<Sent> {
    return this.exclusive(() => this.emptyJarNow(positionId));
  }

  private async emptyJarNow(positionId: string): Promise<Sent> {
    await this.refresh();
    const jar = this.view.positions.find((item) => item.position.positionId === positionId);
    if (jar === undefined || jar.unlockTime === undefined) throw new Error('This wallet has no such savings jar.');
    if (!this.view.ownedHere) throw new Error('This device no longer controls the wallet.');
    if (jar.outputs.length === 0) throw new Error('The savings jar is empty.');
    const fee = this.actionFee(jar.outputs.length);
    if (jar.held - fee < FUNDS_MINIMUM) throw new Error('The savings jar holds too little to pay the network fee for emptying it.');
    await this.follow(jar.position);
    const jarInputs = jar.outputs.map(({ transactionId, index }) => ({ transactionId, index }));
    await waitUntilSeen(this.deps.account, [this.controllerInput(''), ...jarInputs]);
    const built = await this.deps.account.start({
      action: 'approve',
      role: 'owner',
      variables: this.baseVariables(),
      inputs: [this.controllerInput('ownerControllerInput'), ...jarInputs],
      outputs: ['activeControllerOutput'],
      rawOutputs: [{ lockingBytecode: hex(assetScript(this.identity).lockingBytecode), satoshis: String(jar.held - fee) }],
      locktime: jar.unlockTime,
    });
    const sent = await checkAndSend(this.deps.account, this.deps.chain, built);
    const stored = this.record.positions.find((item) => item.position.positionId === positionId);
    if (stored !== undefined) stored.status = 'closed';
    this.note(`Emptied "${jar.position.label ?? 'Savings jar'}" into the wallet`, sent);
    await this.save();
    await this.writer.close(jar.position, sent.transactionId);
    await this.refresh();
    return sent;
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
