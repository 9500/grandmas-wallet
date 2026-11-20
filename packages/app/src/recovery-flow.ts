import { binToHex, hash160, hexToBin, sha256, utf8ToBin } from '@bitauth/libauth';
import {
  type ArchiveStore,
  type PositionRecordEntry,
  type RecordEntry,
  type RecoveryStatus,
  type Sent as SentToRecoverer,
  type SignedMessage,
  type WriteResult,
  Archive,
  preparedReceipt,
  readArchive,
  readViewingKeyRecord,
  recoveryStatus,
  peekRecordEntry,
  safelyStored,
  signRecord,
  signViewingKeyRecord,
  viewingKeyRecordHash,
} from '@grandmas-wallet/archive';
import {
  type ChainReader,
  type ChallengeDelay,
  type ControllerHistory,
  type ControllerUpdate,
  type KeyPair,
  type SeedKeys,
  type WalletBackend,
  ADDRESS_SCHEME_VERSION,
  CONTROLLER_STATE_VERSION,
  IdentityValidationError,
  afterOwnerUpdate,
  readControllerHistory,
} from '@grandmas-wallet/core';
import {
  type KeptKit,
  type KitArchive,
  type KitCredential,
  type SignedJson,
  type TemplateReference,
  checkEnrollment,
  checkHandOver,
  enrollmentLink,
  envelopeFromLink,
  fromSignedJson,
  generateRecipientKeyPair,
  handOver,
  keyFingerprint,
  messageHash,
  openEnrollment,
  openPackage,
  readKit,
  readTakeover,
  readUpdate,
  receiptFor,
  recoveryKeyOf,
  saveTakeover,
  settlePending,
  sealEnrollment,
  sealPackage,
  signKit,
  signTakeover,
  signUpdate,
  takeUpdate,
  toSignedJson,
  viewingKeyRecordsIn,
} from '@grandmas-wallet/enrollment';

import { type OwnerWalletState, type Sent, OwnerWallet } from './owner-wallet.js';
import { WALLET_TEMPLATES, walletTemplateIdentifiers } from './templates.js';

/**
 * How the three devices come to rely on each other (proposal sections 9.5 and 11.1): the owner's device
 * enrolls a recoverer and learns from the backup stores whether recovery is on; a new device asks to take
 * the wallet over and is handed what it needs after completion; the recoverer checks, keeps and answers.
 *
 * Everything that passes between devices is a sealed message or a record on the backup stores. Nothing
 * here moves a coin: the transactions are the wallets' (`OwnerWallet`, `RecovererWallet`).
 */

const hex = binToHex;

/** A backup store by its address, as a kit names it. */
export type StoreAt = (address: string) => ArchiveStore;

/** The wallet's templates as a kit names them: the engine's identifier and the hash of the text. */
export const kitTemplates = (): TemplateReference[] => {
  const identifiers = walletTemplateIdentifiers();
  return (Object.keys(identifiers) as (keyof typeof identifiers)[]).map((name) => ({
    name,
    identifier: identifiers[name],
    contentHash: hex(sha256.hash(utf8ToBin(JSON.stringify(WALLET_TEMPLATES[name])))),
  }));
};

/** A new archive on the given stores: an identifier and a content key of its own. */
export const newArchive = (stores: string[]): KitArchive => ({
  stores,
  archiveId: hex(crypto.getRandomValues(new Uint8Array(16))),
  contentKey: hex(crypto.getRandomValues(new Uint8Array(32))),
});

const archiveOf = (access: KitArchive, storeAt: StoreAt): Archive => new Archive(hexToBin(access.archiveId), hexToBin(access.contentKey), access.stores.map(storeAt));
const contentsOf = (access: KitArchive, storeAt: StoreAt) => readArchive(hexToBin(access.archiveId), hexToBin(access.contentKey), access.stores.map(storeAt));

/** Write a signed text to an archive. Something may come to depend on it only when a store has confirmed it (section 10.5). */
export const keepOnStores = async (access: KitArchive, storeAt: StoreAt, type: 'viewing-key' | 'receipt', signed: SignedMessage, what: string): Promise<WriteResult> => {
  const result = await archiveOf(access, storeAt).write({ type, signed });
  if (!safelyStored(result)) {
    throw new Error(`No backup store confirmed ${what}: ${result.failed.map((failure) => `${failure.store}: ${failure.reason}`).join('; ')}. Nothing depends on it yet; try again when a store can be reached.`);
  }
  return result;
};

// ------------------------------------------------------------------ the owner's device

/** What the owner's device keeps about its recovery arrangement. Plain data. */
export interface RecoveryArrangement {
  /** The archive in use. */
  archive: KitArchive;
  /**
   * The transaction that created the controller, as the kit that was sent names it. A recoverer can act only
   * on that creation: if the network has another one, or none, the recoverer has to be set up again.
   */
  creationTransactionId?: string;
  /** The archives of earlier seeds, newest first. */
  earlierArchives: KitArchive[];
  /** The viewing-key records of earlier seeds, newest first, as the device was handed them. */
  earlierViewingKeyRecords: SignedJson[];
  /** What the device sent and waits for a receipt against. */
  sent?: SentToRecoverer;
  /** The hash of the receipt that last made recovery on. */
  latestReceiptHash?: string;
  /** A change that has been announced to a recoverer and not made yet (section 9.7). */
  change?: PreparedChange;
  /** Set on the old device once it has handed the wallet to a new seed: this device no longer owns it. */
  movedTo?: string;
  /** The earlier archives whose templates, notes, position records and labels are all in the archive in use, by identifier. */
  copiedArchives?: string[];
}

/** A change of the controller's settings that waits for the recoverer's prepared receipt. Plain data. */
export interface PreparedChange {
  kind: 'new seed' | 'new recoverer' | 'waiting period';
  /** What was sent about it, and what applies once it is made. */
  sent: SentToRecoverer;
  /** The change itself, as hex where it names a key. */
  update: { ownerKeyHash?: string; recovererKeyHash?: string; challengeDelay?: ChallengeDelay };
  /**
   * The change has been sent, in this transaction, and is not in a block yet. It takes effect as soon as the
   * network has it; the device keeps it here until a block holds it, and makes it again if it disappears.
   * `before` is what the device had sent the recoverer until then.
   */
  made?: { transactionId: string; before?: SentToRecoverer };
}

/** The recoverer as the owner's device knows it: a name to show, its page, and the key messages are sealed to. */
export interface Recipient {
  name: string;
  page: string;
  publicKey: Uint8Array;
}

/**
 * The controller's history, read as soon as the network has the wallet's creation. A server lists a transaction it
 * has just taken a moment later (Fulcrum asks its node every second or two), while it already gives it out: until
 * a block holds the creation, a history without it is read again, every half second for up to ten seconds, before
 * the wallet says it is not there.
 */
const historyAfterCreation = async (chain: ChainReader, identity: Uint8Array, creationInBlock: boolean): Promise<ControllerHistory> => {
  for (let attempt = 1; ; attempt++) {
    try {
      return await readControllerHistory(chain, identity);
    } catch (error) {
      if (creationInBlock || !(error instanceof IdentityValidationError) || attempt >= 20) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
};

/**
 * Enroll a recoverer (section 11.1, step 0). The viewing-key record goes to the backup stores first; then
 * the kit is made, signed with the controller key and sealed to the recoverer. The result is the link the
 * recoverer's device reads. Recovery is not on until the recoverer's receipt is found (`checkRecovery`).
 *
 * Records of earlier seeds are named by their hash; the recoverer fetches them from the stores.
 *
 * @throws if the wallet is not created yet, or no store confirmed the record
 */
export const enroll = async (options: {
  wallet: OwnerWallet;
  seed: Pick<SeedKeys, 'network' | 'viewingKey' | 'controllerKey'>;
  chain: ChainReader;
  credential: KitCredential;
  recipient: Recipient;
  /** The stores for a first archive. Ignored when the device already has an arrangement. */
  stores: string[];
  storeAt: StoreAt;
  arrangement?: RecoveryArrangement;
  /**
   * The kit is for a recoverer that the controller does not name yet (section 9.7, a new recoverer): the
   * arrangement in force stays as it is, and the change waits for that recoverer's prepared receipt.
   */
  newRecoverer?: { challengeDelay?: ChallengeDelay };
  /** Unix seconds: a note in the kit, not evidence. */
  madeAt: number;
}): Promise<{ link: string; arrangement: RecoveryArrangement }> => {
  const { wallet, seed, storeAt } = options;
  const { identity } = wallet.stored;
  // The network having the creating transaction is enough; a block is not waited for (section 7.9).
  if (identity === undefined || !wallet.created) throw new Error('The wallet is not created yet. A recoverer is enrolled after that.');
  const history = await historyAfterCreation(options.chain, hexToBin(identity), wallet.stored.creation.confirmed);
  const creationTransactionId = history.transactions[0]?.transactionId;
  if (creationTransactionId === undefined) throw new Error('The transaction that created the wallet was not found.');
  const arrangement: RecoveryArrangement = { ...(options.arrangement ?? { archive: newArchive(options.stores), earlierArchives: [], earlierViewingKeyRecords: [] }), creationTransactionId };

  const record = signViewingKeyRecord(seed);
  await keepOnStores(arrangement.archive, storeAt, 'viewing-key', record, 'this seed\'s viewing-key record');
  // Earlier records are in the archive in use too, so that the recoverer can fetch what the kit only names.
  for (const earlier of arrangement.earlierViewingKeyRecords) {
    await keepOnStores(arrangement.archive, storeAt, 'viewing-key', fromSignedJson(earlier, 'viewing-key record'), 'an earlier seed\'s viewing-key record');
  }
  const kit = signKit(
    {
      network: seed.network,
      identity,
      creationTransactionId,
      rules: { controller: CONTROLLER_STATE_VERSION, addressScheme: ADDRESS_SCHEME_VERSION, templates: kitTemplates() },
      credential: options.credential,
      viewingKeyRecords: [toSignedJson(record), ...arrangement.earlierViewingKeyRecords.map((earlier) => ({ reference: viewingKeyRecordHash(earlier) }))],
      archives: [arrangement.archive, ...arrangement.earlierArchives],
      policy: { challengeDelay: options.newRecoverer?.challengeDelay ?? history.current.state.challengeDelay, recipient: options.recipient.name, madeAt: options.madeAt },
    },
    seed.controllerKey,
  );
  const link = enrollmentLink(options.recipient.page, await sealEnrollment(kit, seed.network, options.recipient.publicKey));
  const sent: SentToRecoverer = {
    messageHash: messageHash(kit),
    viewingKeyRecordHash: viewingKeyRecordHash(record),
    recoveryKeyHash: readKit(kit, seed.network).kit.policy.recovererKeyHash,
    ownerKeyHash: hex(seed.controllerKey.keyHash),
  };
  if (options.newRecoverer !== undefined) {
    const { challengeDelay } = options.newRecoverer;
    const change: PreparedChange = { kind: 'new recoverer', sent, update: { recovererKeyHash: sent.recoveryKeyHash, ...(challengeDelay === undefined ? {} : { challengeDelay }) } };
    return { link, arrangement: { ...arrangement, change } };
  }
  // A new message is waiting for its own receipt.
  wallet.noteRecoveryConfirmed(false);
  const { latestReceiptHash: _earlier, ...rest } = arrangement;
  return { link, arrangement: { ...rest, sent } };
};

/**
 * Whether recovery is on (sections 9.5 and 10.5): the stores hold a receipt that matches what this device
 * sent, and the controller's state as the network shows it matches both. The wallet is told, and shows it.
 * Nothing waits for a block: each check works the status out again, so a transaction that disappears takes
 * the status with it.
 */
export const checkRecovery = async (options: {
  wallet: OwnerWallet;
  chain: ChainReader;
  arrangement: RecoveryArrangement | undefined;
  storeAt: StoreAt;
  network: SeedKeys['network'];
}): Promise<{ status: RecoveryStatus; arrangement?: RecoveryArrangement }> => {
  const { wallet, arrangement } = options;
  const { identity } = wallet.stored;
  if (arrangement?.sent === undefined || identity === undefined) {
    wallet.noteRecoveryConfirmed(false);
    return { status: { on: false, reasons: ['No recoverer has been sent a recovery kit from this device.'] }, ...(arrangement === undefined ? {} : { arrangement }) };
  }
  const history = await readControllerHistory(options.chain, hexToBin(identity));
  if (arrangement.creationTransactionId !== undefined && history.transactions[0]?.transactionId !== arrangement.creationTransactionId) {
    wallet.noteRecoveryConfirmed(false);
    return { status: { on: false, reasons: ['The wallet\'s controller was made again after the kit was sent, so the recoverer\'s kit no longer fits it. Send the recoverer a new kit.'] }, arrangement };
  }
  const contents = await contentsOf(arrangement.archive, options.storeAt);
  const receipts = contents.blobs.filter(({ blob }) => blob.type === 'receipt').map(({ blob }) => blob.signed);
  const status = recoveryStatus(receipts, arrangement.sent, history, options.network);
  wallet.noteRecoveryConfirmed(status.on);
  const reasons = contents.answered.length === 0 ? ['No backup store could be reached, so no receipt could be looked for.'] : status.reasons;
  const { latestReceiptHash: _earlier, ...rest } = arrangement;
  return { status: { ...status, reasons }, arrangement: status.receipt === undefined ? rest : { ...rest, latestReceiptHash: status.receipt.hash } };
};

// ------------------------------------------------------------------ a new device

/** What a new device keeps between its takeover message and the hand-over. Plain data. */
export interface PendingTakeover {
  /** Its own, new archive. */
  archive: KitArchive;
  /** The key the recoverer's answer is sealed to. */
  answerKey: { publicKey: string; privateKey: string };
  takeoverHash: string;
  viewingKeyRecordHash: string;
  /** What both sides show of the proposed key. */
  fingerprint: string;
}

/**
 * A new device asks to take a wallet over (section 11.1, step 1). It has a new seed and nothing else: no
 * identity, no earlier key. Its viewing-key record goes to a new archive of its own, and the takeover
 * message, sealed to the recoverer, names its controller key, that record, the archive and a key for the answer.
 */
export const startTakeover = async (options: {
  seed: Pick<SeedKeys, 'network' | 'viewingKey' | 'controllerKey'>;
  stores: string[];
  storeAt: StoreAt;
  recovererPublicKey: Uint8Array;
}): Promise<{ sealed: Uint8Array; pending: PendingTakeover }> => {
  const { seed } = options;
  const archive = newArchive(options.stores);
  const record = signViewingKeyRecord(seed);
  await keepOnStores(archive, options.storeAt, 'viewing-key', record, 'the new seed\'s viewing-key record');
  const answer = await generateRecipientKeyPair();
  const takeover = signTakeover(seed, archive, answer.publicKey);
  return {
    sealed: await sealPackage(takeover, options.recovererPublicKey),
    pending: {
      archive,
      answerKey: { publicKey: hex(answer.publicKey), privateKey: hex(answer.privateKey) },
      takeoverHash: messageHash(takeover),
      viewingKeyRecordHash: viewingKeyRecordHash(record),
      fingerprint: keyFingerprint(seed.controllerKey.keyHash),
    },
  };
};

/**
 * The new device takes the wallet over with what the recoverer hands it (section 11.1, steps 6 and 9). It
 * reads the identity's history itself and sees its own key as the owner. It then knows the earlier seeds'
 * viewing keys, which find what is to be swept, and whether recovery is on again.
 *
 * @returns the wallet, the arrangement to keep, and what the recoverer should have handed over and did not
 * @throws if the hand-over is not from the wallet's recoverer, or this device's key is not the owner
 */
export const finishTakeover = async (options: {
  sealedHandOver: Uint8Array;
  pending: PendingTakeover;
  seed: Pick<SeedKeys, 'network' | 'viewingKey' | 'controllerKey'>;
  backend: WalletBackend;
  chain: ChainReader;
  save?: (state: OwnerWalletState) => void;
  feeRate?: number;
}): Promise<{ wallet: OwnerWallet; arrangement: RecoveryArrangement; missing: string[]; recovery: RecoveryStatus }> => {
  const { pending, seed } = options;
  const signed = await openPackage(options.sealedHandOver, hexToBin(pending.answerKey.privateKey));
  const checked = await checkHandOver(signed, options.chain, seed.network, {
    controllerKeyHash: seed.controllerKey.keyHash,
    viewingKeyRecordHash: pending.viewingKeyRecordHash,
    takeoverHash: pending.takeoverHash,
  });
  // Oldest first, in the order the seeds owned the wallet.
  const order = checked.history.owners.map((period) => hex(period.ownerKeyHash));
  const position = (entry: (typeof checked.earlier)[number]): number => order.indexOf(hex(hash160(entry.record.controllerPublicKey)));
  const earlier = [...checked.earlier].sort((a, b) => position(a) - position(b));
  const wallet = await OwnerWallet.takeOver({
    backend: options.backend,
    chain: options.chain,
    seed,
    identity: hexToBin(checked.identity),
    earlierViewingKeys: earlier.map((entry) => entry.record.viewingKey),
    ...(options.save === undefined ? {} : { save: options.save }),
    ...(options.feeRate === undefined ? {} : { feeRate: options.feeRate }),
  });
  wallet.noteRecoveryConfirmed(checked.recovery.on);
  return {
    wallet,
    arrangement: {
      archive: pending.archive,
      earlierArchives: [...checked.archives].reverse(),
      earlierViewingKeyRecords: earlier.map((entry) => toSignedJson(entry.signed)).reverse(),
      sent: {
        messageHash: pending.takeoverHash,
        viewingKeyRecordHash: pending.viewingKeyRecordHash,
        recoveryKeyHash: hex(checked.history.current.state.recovererKeyHash),
        ownerKeyHash: hex(seed.controllerKey.keyHash),
      },
      ...(checked.recovery.receipt === undefined ? {} : { latestReceiptHash: checked.recovery.receipt.hash }),
    },
    missing: checked.missing,
    recovery: checked.recovery,
  };
};

// ------------------------------------------------------------------ the recoverer

/**
 * The recoverer takes in an enrollment link (section 9.5): it opens the message, fetches the viewing-key
 * records the kit only names, checks everything against the chain, and leaves its receipt in the wallet's
 * archive, where the owner's device finds it.
 *
 * @param options.ownRecoveryKey - for a recoverer that holds its own key instead of a credential's words
 * @returns the kit to keep. It is kept before the receipt is left: a receipt says that the kit is held.
 * @throws EnrollmentError with the reason the message is refused
 */
export const acceptEnrollment = async (options: {
  link: string;
  privateKey: Uint8Array;
  chain: ChainReader;
  network: SeedKeys['network'];
  storeAt: StoreAt;
  ownRecoveryKey?: KeyPair;
  /**
   * The controller does not name this recoverer yet: the owner makes the change after the receipt. What can
   * be checked is checked, and the receipt is a prepared one. If the controller moves before the change is
   * made, the link is taken in again.
   */
  forNewRecoverer?: boolean;
  /** Called with the kit before the receipt is written, so that it is saved first. */
  save?: (kept: KeptKit) => void | Promise<void>;
}): Promise<{ kept: KeptKit; recoveryKey: KeyPair }> => {
  const read = await openEnrollment(envelopeFromLink(options.link), options.privateKey, options.network);
  const fetched: SignedMessage[] = [];
  if (read.references.length > 0) {
    for (const archive of read.kit.archives) fetched.push(...viewingKeyRecordsIn(await contentsOf(archive, options.storeAt)));
  }
  const checked = await checkEnrollment(read, options.chain, { fetched, ...(options.forNewRecoverer === true ? { forNewRecoverer: true } : {}) });
  const recoveryKey = recoveryKeyOf(checked.kept.kit, options.ownRecoveryKey);
  const { receipt, kept } = receiptFor(checked.kept, recoveryKey, checked.prepared);
  await options.save?.(kept);
  const [current] = read.kit.archives;
  if (current === undefined) throw new Error('The kit names no archive to leave a receipt in.');
  await keepOnStores(current, options.storeAt, 'receipt', receipt, 'the receipt');
  return { kept, recoveryKey };
};

/**
 * The recoverer saves a takeover message (section 11.1, step 1). From here on it holds the new device's
 * viewing-key record and archive access, before any request is made.
 *
 * @returns the kit to keep, the key hash a request is to name, and the fingerprint both sides show
 */
export const acceptTakeover = async (options: {
  sealed: Uint8Array;
  privateKey: Uint8Array;
  kept: KeptKit;
  chain: ChainReader;
}): Promise<{ kept: KeptKit; proposedKeyHash: Uint8Array; fingerprint: string }> => {
  const { kit } = options.kept;
  const takeover = readTakeover(await openPackage(options.sealed, options.privateKey), kit.network);
  // An earlier takeover whose key came to own the wallet stays in the kit, handed over or not.
  const settled = settlePending(options.kept, await readControllerHistory(options.chain, hexToBin(kit.identity), kit.creationTransactionId));
  return {
    kept: saveTakeover(settled, takeover),
    proposedKeyHash: hexToBin(takeover.takeover.proposedKeyHash),
    fingerprint: keyFingerprint(takeover.takeover.proposedKeyHash),
  };
};

/**
 * After completion the recoverer hands over (section 11.1, step 6): sealed to the new device's key, the
 * identity, the creating transaction, the earlier seeds' viewing-key records, the access to earlier
 * archives and its receipt for the kit as it now stands. The receipt is also left in the new device's archive.
 *
 * @throws EnrollmentError before the chain shows the completion
 */
export const completeTakeover = async (options: {
  kept: KeptKit;
  chain: ChainReader;
  recoveryKey: KeyPair;
  storeAt: StoreAt;
  /** Called with the kit before the receipt is written, so that it is saved first. */
  save?: (kept: KeptKit) => void | Promise<void>;
}): Promise<{ sealed: Uint8Array; kept: KeptKit }> => {
  const handed = await handOver(options.kept, options.chain, options.recoveryKey);
  await options.save?.(handed.kept);
  const current = handed.kept.archives.at(-1);
  if (current === undefined) throw new Error('The takeover message named no archive to leave a receipt in.');
  await keepOnStores(current, options.storeAt, 'receipt', handed.receipt, 'the receipt');
  return { sealed: await sealPackage(handed.handOver, handed.answerKey), kept: handed.kept };
};

// ------------------------------------------------------------------ changes with the old device still working (section 9.7)

const receiptsIn = async (access: KitArchive, storeAt: StoreAt): Promise<SignedMessage[]> =>
  (await contentsOf(access, storeAt)).blobs.filter(({ blob }) => blob.type === 'receipt').map(({ blob }) => blob.signed);

const updateOf = (change: PreparedChange): ControllerUpdate => ({
  ...(change.update.ownerKeyHash === undefined ? {} : { ownerKeyHash: hexToBin(change.update.ownerKeyHash) }),
  ...(change.update.recovererKeyHash === undefined ? {} : { recovererKeyHash: hexToBin(change.update.recovererKeyHash) }),
  ...(change.update.challengeDelay === undefined ? {} : { challengeDelay: change.update.challengeDelay }),
});

/** What a new device makes for a move to its seed, and gives the old device: nothing in it needs the identity. */
export interface NewSeedPreparation {
  proposedKeyHash: string;
  viewingKeyRecord: SignedJson;
  archive: KitArchive;
  /** What both devices show of the new key. */
  fingerprint: string;
}

/**
 * Step 1 of a move to a new seed: the new device makes its viewing-key record and a new archive, and the
 * record is on the stores before anything depends on it.
 */
export const prepareNewSeed = async (options: {
  seed: Pick<SeedKeys, 'network' | 'viewingKey' | 'controllerKey'>;
  stores: string[];
  storeAt: StoreAt;
}): Promise<NewSeedPreparation> => {
  const archive = newArchive(options.stores);
  const record = signViewingKeyRecord(options.seed);
  await keepOnStores(archive, options.storeAt, 'viewing-key', record, 'the new seed\'s viewing-key record');
  return { proposedKeyHash: hex(options.seed.controllerKey.keyHash), viewingKeyRecord: toSignedJson(record), archive, fingerprint: keyFingerprint(options.seed.controllerKey.keyHash) };
};

/** What the old device gives the new one directly: the identity and every viewing-key record and archive so far, oldest first. */
export interface DirectHandOver {
  network: SeedKeys['network'];
  identity: string;
  creationTransactionId: string;
  viewingKeyRecords: SignedJson[];
  archives: KitArchive[];
  /** The hash of the update message, which the recoverer's receipt answers. */
  answers: string;
  recoveryKeyHash: string;
}

/**
 * Step 2 of a move to a new seed, or the announcement of a new waiting period: the device that owns the
 * wallet sends the recoverer an update message, signed with its controller key and sealed. For a new seed it
 * also makes what the new device is given directly. Nothing changes on chain here.
 *
 * @throws if the device has no recoverer enrolled: there is no one to update
 */
export const sendUpdate = async (options: {
  wallet: OwnerWallet;
  seed: Pick<SeedKeys, 'network' | 'viewingKey' | 'controllerKey'>;
  chain: ChainReader;
  arrangement: RecoveryArrangement;
  recipient: Pick<Recipient, 'publicKey'>;
  newSeed?: NewSeedPreparation;
  challengeDelay?: ChallengeDelay;
}): Promise<{ sealed: Uint8Array; arrangement: RecoveryArrangement; handOver?: DirectHandOver }> => {
  const { wallet, seed, arrangement, newSeed, challengeDelay } = options;
  const { identity } = wallet.stored;
  if (identity === undefined || arrangement.sent === undefined) throw new Error('No recoverer has been enrolled from this device. A change is announced to a recoverer that holds the kit.');
  if ((newSeed === undefined) === (challengeDelay === undefined)) throw new Error('An update announces one change: a new seed, or a new waiting period.');
  const update = signUpdate(
    {
      network: seed.network,
      identity,
      ...(newSeed === undefined ? {} : { newSeed: { proposedKeyHash: newSeed.proposedKeyHash, viewingKeyRecord: newSeed.viewingKeyRecord, archive: newSeed.archive } }),
      ...(challengeDelay === undefined ? {} : { challengeDelay }),
    },
    seed.controllerKey,
  );
  const sealed = await sealPackage(update, options.recipient.publicKey);
  const answers = messageHash(update);
  if (newSeed === undefined) {
    const change: PreparedChange = { kind: 'waiting period', sent: { ...arrangement.sent, messageHash: answers }, update: { ...(challengeDelay === undefined ? {} : { challengeDelay }) } };
    return { sealed, arrangement: { ...arrangement, change } };
  }
  const history = await readControllerHistory(options.chain, hexToBin(identity));
  const change: PreparedChange = {
    kind: 'new seed',
    sent: { messageHash: answers, viewingKeyRecordHash: viewingKeyRecordHash(newSeed.viewingKeyRecord), recoveryKeyHash: arrangement.sent.recoveryKeyHash, ownerKeyHash: newSeed.proposedKeyHash },
    update: { ownerKeyHash: newSeed.proposedKeyHash },
  };
  return {
    sealed,
    arrangement: { ...arrangement, change },
    handOver: {
      network: seed.network,
      identity,
      creationTransactionId: history.transactions[0]?.transactionId ?? '',
      viewingKeyRecords: [...[...arrangement.earlierViewingKeyRecords].reverse(), toSignedJson(signViewingKeyRecord(seed))],
      archives: [...[...arrangement.earlierArchives].reverse(), arrangement.archive],
      answers,
      recoveryKeyHash: arrangement.sent.recoveryKeyHash,
    },
  };
};

/**
 * Step 3: the recoverer takes an update message in. It checks that the key that owns the wallet signed it,
 * saves what it brings, and leaves a prepared receipt, which names the controller output the change is to
 * spend and the state it is to produce. The receipt is left in the archive in use and, for a new seed, in
 * the new one. If the controller has moved since, the same message is taken in again.
 */
export const acceptUpdate = async (options: {
  sealed: Uint8Array;
  privateKey: Uint8Array;
  kept: KeptKit;
  chain: ChainReader;
  recoveryKey: KeyPair;
  storeAt: StoreAt;
  /** Called with the kit before the receipt is written, so that it is saved first. */
  save?: (kept: KeptKit) => void | Promise<void>;
}): Promise<{ kept: KeptKit }> => {
  const update = readUpdate(await openPackage(options.sealed, options.privateKey), options.kept.kit.network);
  // The archive in use is the last one the recoverer holds that is not the new seed's own.
  const inUse = options.kept.archives.filter((archive) => archive.archiveId !== update.update.newSeed?.archive.archiveId).at(-1);
  const taken = await takeUpdate(options.kept, update, options.chain);
  // Taking the same message in again adds nothing twice.
  const records = new Map(taken.kept.viewingKeyRecords.map((record) => [viewingKeyRecordHash(record), record]));
  const archives = new Map(taken.kept.archives.map((archive) => [archive.archiveId, archive]));
  const { receipt, kept } = receiptFor({ ...taken.kept, viewingKeyRecords: [...records.values()], archives: [...archives.values()] }, options.recoveryKey, taken.prepared);
  await options.save?.(kept);
  for (const archive of new Map([inUse, update.update.newSeed?.archive].filter((entry) => entry !== undefined).map((entry) => [entry.archiveId, entry])).values()) {
    await keepOnStores(archive, options.storeAt, 'receipt', receipt, 'the prepared receipt');
  }
  return { kept };
};

/**
 * Step 4: the owner makes the change it announced, and only once the recoverer's prepared receipt for
 * exactly this change is on the stores. It takes effect as soon as the network has it. A change that the
 * chain already shows is not made again, so the step can be repeated after an interruption.
 *
 * After a new recoverer or a new waiting period, `checkRecovery` says when recovery is on again. After a
 * new seed this device no longer owns the wallet.
 *
 * The change stays in the arrangement, marked as made, until a block holds it; the device calls this at
 * every check meanwhile. If the change disappears (only a holder of the owner's key could replace it), the
 * arrangement is put back as it was and the change is made again: for a new seed, this device owns the
 * wallet again until then.
 *
 * @throws if the prepared receipt is not there, with the reasons
 */
export const makeChange = async (options: {
  wallet: OwnerWallet;
  chain: ChainReader;
  arrangement: RecoveryArrangement;
  storeAt: StoreAt;
  network: SeedKeys['network'];
}): Promise<{ sent?: Sent; arrangement: RecoveryArrangement }> => {
  const { wallet, arrangement } = options;
  const { change } = arrangement;
  const { identity } = wallet.stored;
  if (change === undefined || identity === undefined) throw new Error('No change has been announced to the recoverer.');
  const history = await readControllerHistory(options.chain, hexToBin(identity));
  const { change: _made, movedTo: _moved, ...rest } = arrangement;
  const afterWith = (made?: PreparedChange['made']): RecoveryArrangement => ({
    ...(change.kind === 'new seed' ? { ...rest, movedTo: change.sent.ownerKeyHash } : { ...rest, sent: change.sent }),
    ...(made === undefined ? {} : { change: { ...change, made } }),
  });
  if (changeMade(history, change)) {
    // Kept until a block holds the transaction that made it; one the device did not record is not followed.
    const madeIn = change.made === undefined ? undefined : history.transactions.find((entry) => entry.transactionId === change.made?.transactionId);
    return { arrangement: afterWith(madeIn !== undefined && !madeIn.confirmed ? change.made : undefined) };
  }
  // A change that was made and is gone: the arrangement is put back as it was before, and it is made again.
  let before: RecoveryArrangement = arrangement;
  if (change.made !== undefined) {
    const { made: _gone, ...unmade } = change;
    const { sent: _after, ...others } = rest;
    const earlier = change.kind === 'new seed' ? arrangement.sent : change.made.before;
    before = { ...others, ...(earlier === undefined ? {} : { sent: earlier }), change: unmade };
  }
  const intended = afterOwnerUpdate(history.current.state, updateOf(change));
  const ready = preparedReceipt(await receiptsIn(before.archive, options.storeAt), change.sent, history, intended, options.network);
  if (!ready.on) {
    if (before !== arrangement) return { arrangement: before };
    throw new Error(`The recoverer's prepared receipt for this change is not on the backup stores. The change is not made before it is. ${ready.reasons.join(' ')}`);
  }
  const sent = await wallet.changeSettings(updateOf(change));
  if (change.kind !== 'new seed') wallet.noteRecoveryConfirmed(false);
  return { sent, arrangement: afterWith({ transactionId: sent.transactionId, ...(before.sent === undefined ? {} : { before: before.sent }) }) };
};

/** Whether the chain already shows the settings a change is to produce. */
const changeMade = (history: ControllerHistory, change: PreparedChange): boolean => {
  const { state } = history.current;
  const { ownerKeyHash, recovererKeyHash, challengeDelay } = change.update;
  return (
    (ownerKeyHash === undefined || hex(state.ownerKeyHash) === ownerKeyHash) &&
    (recovererKeyHash === undefined || hex(state.recovererKeyHash) === recovererKeyHash) &&
    (challengeDelay === undefined || (state.challengeDelay.unit === challengeDelay.unit && state.challengeDelay.value === challengeDelay.value))
  );
};

/**
 * Step 5: the new device takes the wallet over with what the old device gave it. It reads the identity's
 * history itself, and goes on as soon as the network has the change that names its key, in a block or not;
 * before that it has no wallet and gives out no address. A viewing-key record counts only if the chain
 * shows its seed as an owner. If the change later disappears, the device follows the chain: it finds
 * another key named as the owner and stops until the change is made again.
 *
 * @throws if this device's key is not the owner
 */
export const finishMove = async (options: {
  handOver: DirectHandOver;
  preparation: NewSeedPreparation;
  seed: Pick<SeedKeys, 'network' | 'viewingKey' | 'controllerKey'>;
  backend: WalletBackend;
  chain: ChainReader;
  storeAt: StoreAt;
  save?: (state: OwnerWalletState) => void;
  feeRate?: number;
}): Promise<{ wallet: OwnerWallet; arrangement: RecoveryArrangement; missing: string[]; recovery: RecoveryStatus }> => {
  const { handOver: given, preparation, seed } = options;
  const history = await readControllerHistory(options.chain, hexToBin(given.identity), given.creationTransactionId);
  const own = hex(seed.controllerKey.keyHash);
  if (hex(history.current.state.ownerKeyHash) !== own) throw new Error('The wallet\'s controller does not name this device\'s key as the owner. The old device has not made the change yet.');
  const earlierOwners = history.owners.map((period) => hex(period.ownerKeyHash)).filter((keyHash) => keyHash !== own);
  const found = new Map<string, { signed: SignedJson; viewingKey: ReturnType<typeof readViewingKeyRecord>['viewingKey'] }>();
  for (const signed of given.viewingKeyRecords) {
    try {
      const record = readViewingKeyRecord(fromSignedJson(signed, 'viewing-key record'), seed.network);
      const keyHash = hex(hash160(record.controllerPublicKey));
      if (earlierOwners.includes(keyHash)) found.set(keyHash, { signed, viewingKey: record.viewingKey });
    } catch {
      // reported below as missing, if it was an owner's
    }
  }
  const missing = earlierOwners.filter((keyHash) => !found.has(keyHash)).map(() => 'The viewing key of a seed that owned the wallet was not handed over: coins at its addresses cannot be found.');
  const earlier = earlierOwners.flatMap((keyHash) => found.get(keyHash) ?? []);
  const wallet = await OwnerWallet.takeOver({
    backend: options.backend,
    chain: options.chain,
    seed,
    identity: hexToBin(given.identity),
    earlierViewingKeys: earlier.map((entry) => entry.viewingKey),
    ...(options.save === undefined ? {} : { save: options.save }),
    ...(options.feeRate === undefined ? {} : { feeRate: options.feeRate }),
  });
  const sent: SentToRecoverer = { messageHash: given.answers, viewingKeyRecordHash: viewingKeyRecordHash(preparation.viewingKeyRecord), recoveryKeyHash: given.recoveryKeyHash, ownerKeyHash: own };
  const recovery = recoveryStatus(await receiptsIn(preparation.archive, options.storeAt), sent, history, seed.network);
  wallet.noteRecoveryConfirmed(recovery.on);
  return {
    wallet,
    arrangement: {
      archive: preparation.archive,
      earlierArchives: [...given.archives].reverse(),
      earlierViewingKeyRecords: earlier.map((entry) => entry.signed).reverse(),
      sent,
      ...(recovery.receipt === undefined ? {} : { latestReceiptHash: recovery.receipt.hash }),
    },
    missing,
    recovery,
  };
};

// ------------------------------------------------------------------ records in the archive (section 10)

/**
 * Write a record (a template, its withdrawal, a position record or a label) to the archive in use, signed with this seed's controller key.
 * The result says which stores confirmed it; something may come to depend on the record only if one did.
 */
export const writeRecord = async (options: {
  entry: RecordEntry;
  identity: string;
  seed: Pick<SeedKeys, 'network' | 'controllerKey'>;
  arrangement: RecoveryArrangement;
  storeAt: StoreAt;
}): Promise<WriteResult> =>
  archiveOf(options.arrangement.archive, options.storeAt).write({ type: 'record', signed: signRecord(options.entry, { network: options.seed.network, identity: options.identity }, options.seed.controllerKey) });

/**
 * Whether the action a position record was written for was sent (section 10.2): `sent`; `never sent`, so
 * that the record is not copied; `cannot tell`, and the record is copied as the harmless suggestion it is;
 * or `not yet known`, and the copy is left unfinished and continued later.
 */
export type ActionSent = 'sent' | 'never sent' | 'cannot tell' | 'not yet known';

/** Says whether a record's action was sent, with the template texts the earlier archive holds, by identifier. */
export type WhetherSent = (entry: PositionRecordEntry, templateText: (identifier: string) => string | undefined) => Promise<ActionSent>;

/**
 * After a recovery or a move to a new seed (section 10.6): the templates, notes, position records and labels
 * of the earlier archives are copied into the archive in use, which the earlier device's content key does not
 * read. They stay what they were, records signed by an earlier owner: suggestions. Nothing is removed from an
 * earlier archive, and the access to it is kept; an archive counts as copied only when every one of its stores
 * answered and every record was confirmed in the new one. An unfinished copy is continued by calling this again.
 *
 * A position record of an action that was never sent is not copied: `whetherSent` says which those are.
 * Without it, every record is copied.
 *
 * @returns the arrangement to keep, how many records were copied this time, and what is unfinished and why
 */
export const copyEarlierArchives = async (options: {
  arrangement: RecoveryArrangement;
  storeAt: StoreAt;
  whetherSent?: WhetherSent;
}): Promise<{ arrangement: RecoveryArrangement; copied: number; unfinished: string[] }> => {
  const { arrangement, storeAt, whetherSent } = options;
  const done = new Set(arrangement.copiedArchives ?? []);
  const unfinished: string[] = [];
  const target = archiveOf(arrangement.archive, storeAt);
  let copied = 0;
  // What the archive in use already holds is not written again: a copy that is continued adds only what is missing.
  let present: Set<string> | undefined;
  for (const earlier of arrangement.earlierArchives) {
    if (done.has(earlier.archiveId)) continue;
    present ??= new Set((await contentsOf(arrangement.archive, storeAt)).blobs.filter(({ blob }) => blob.type === 'record').map(({ blob }) => messageHash(blob.signed)));
    const contents = await contentsOf(earlier, storeAt);
    let complete = contents.answered.length === earlier.stores.length && contents.problems.length === 0;
    if (!complete) unfinished.push(`An earlier archive could not be read in full: ${contents.problems.join('; ') || 'a store did not answer'}.`);
    // The templates the earlier archive holds, to work out the script a position record names.
    const templates = new Map<string, string>();
    for (const { blob } of contents.blobs) {
      const entry = blob.type === 'record' ? peekRecordEntry(blob.signed) : undefined;
      if (entry?.kind === 'template') templates.set(entry.identifier, entry.text);
    }
    for (const { blob } of contents.blobs) {
      if (blob.type !== 'record' || present.has(messageHash(blob.signed))) continue;
      const entry = peekRecordEntry(blob.signed);
      if (entry?.kind === 'position' && whetherSent !== undefined) {
        let sent: ActionSent;
        try {
          sent = await whetherSent(entry, (identifier) => templates.get(identifier));
        } catch {
          sent = 'not yet known';
        }
        if (sent === 'never sent') continue;
        if (sent === 'not yet known') {
          complete = false;
          unfinished.push('Whether the action of a position record was sent cannot be told yet: the wallet has not finished looking for its coins.');
          continue;
        }
      }
      const result = await target.write(blob);
      if (safelyStored(result)) {
        copied += 1;
        present.add(messageHash(blob.signed));
      } else {
        complete = false;
        unfinished.push(`No store of the archive in use confirmed a copied record: ${result.failed.map((failure) => `${failure.store}: ${failure.reason}`).join('; ')}.`);
      }
    }
    if (complete) done.add(earlier.archiveId);
  }
  return { arrangement: { ...arrangement, copiedArchives: [...done] }, copied, unfinished };
};
