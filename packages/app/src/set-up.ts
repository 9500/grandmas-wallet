import { binToHex, decodeTransactionBch, generateBip39Mnemonic, hashTransactionUiOrder, hexToBin } from '@bitauth/libauth';
import { signViewingKeyRecord, viewingKeyRecordHash } from '@grandmas-wallet/archive';
import {
  type ChainReader,
  type ChallengeDelay,
  type ControllerState,
  type KeyPair,
  type SeedKeys,
  type WalletBackend,
  ADDRESS_KIND,
  ADDRESS_SCHEME_VERSION,
  CONTROLLER_STATE_VERSION,
  IdentityValidationError,
  validateGenesis,
  walletAddress,
} from '@grandmas-wallet/core';
import {
  type KeptKit,
  type KitArchive,
  type ReadEnrollmentRequest,
  EnrollmentError,
  checkEnrollment,
  credentialKeys,
  kitForRequest,
  messageHash,
  openPackage,
  readEnrollmentRequest,
  receiptFor,
  sealPackage,
  signEnrollmentRequest,
} from '@grandmas-wallet/enrollment';

import { type OwnerWalletState, OwnerWallet } from './owner-wallet.js';
import { type CreationRecord, type RecovererFunds, FundsMissingError } from './recoverer-funds.js';
import { type RecoveryArrangement, type StoreAt, keepOnStores, kitTemplates, newArchive } from './recovery-flow.js';

/**
 * Setting a wallet up with the recoverer (proposal sections 7.9, 9.3 and 14.4). Whoever has the coins creates
 * the wallet: the phone makes its keys and sends the recoverer a sealed request; the recoverer creates the wallet
 * on chain from its own coins, keeps the kit it assembles from the request and from what it created, leaves its
 * receipt on the phone's backup stores, and answers with the identity. The phone checks the creation as any
 * client does and opens its wallet. Both pages are open at the same moment; the first transaction is trusted.
 */

const hex = binToHex;
const sameDelay = (a: ChallengeDelay, b: ChallengeDelay): boolean => a.unit === b.unit && a.value === b.value;
const wait = (milliseconds: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, milliseconds));

/** What a recoverer offers with its code: the waiting period it creates wallets with, and the starting balance. */
export interface SetUpOffer {
  challengeDelay: ChallengeDelay;
  startingSatoshis: bigint;
}

/** The recoverer's answer: the wallet it created. Everything in it is checked against the chain. */
export interface SetUpAnswer {
  identity: string;
  creationTransactionId: string;
  /** The recovery key hash the recoverer put in the controller's state. */
  recoveryKeyHash: string;
}

/** The creation is not the one the phone asked for, or cannot be read. The phone does not open it. */
export class SetUpError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SetUpError';
  }
}

// ------------------------------------------------------------------ the phone

/** What a phone keeps between its request and the recoverer's answer. Plain data. */
export interface PendingSetUp {
  requestId: string;
  /** The phone's own, new archive, where the recoverer leaves its receipt. */
  archive: KitArchive;
  /** What the receipt is to answer. */
  requestHash: string;
  viewingKeyRecordHash: string;
  challengeDelay: ChallengeDelay;
  firstAddress: number;
  /** The sealed request, hex: after a reload the same bytes go again, and the recoverer answers them as before. */
  sealed: string;
}

/**
 * The phone's request (section 7.9). The viewing-key record goes to a new archive of the phone's own first; the
 * request names the phone's controller key, carries that record and the archive's access, the waiting period the
 * phone was told and the change address the starting balance is to go to, and is sealed to the recoverer.
 *
 * @throws if no store confirmed the viewing-key record: nothing is sent then
 */
export const requestSetUp = async (options: {
  seed: Pick<SeedKeys, 'network' | 'viewingKey' | 'controllerKey'>;
  stores: string[];
  storeAt: StoreAt;
  recovererPublicKey: Uint8Array;
  challengeDelay: ChallengeDelay;
  firstAddress: number;
}): Promise<PendingSetUp> => {
  const archive = newArchive(options.stores);
  const record = signViewingKeyRecord(options.seed);
  await keepOnStores(archive, options.storeAt, 'viewing-key', record, 'this phone\'s viewing-key record');
  const requestId = hex(crypto.getRandomValues(new Uint8Array(16)));
  const signed = signEnrollmentRequest(options.seed, { requestId, archive, challengeDelay: options.challengeDelay, firstAddress: options.firstAddress });
  return {
    requestId,
    archive,
    requestHash: messageHash(signed),
    viewingKeyRecordHash: viewingKeyRecordHash(record),
    challengeDelay: options.challengeDelay,
    firstAddress: options.firstAddress,
    sealed: hex(await sealPackage(signed, options.recovererPublicKey)),
  };
};

/**
 * A transaction the recoverer has just sent. Servers give a transaction out as soon as they take it; one that
 * reached another server first may take a moment to reach this one, so it is asked for again for a few seconds.
 */
const transactionOf = async (chain: ChainReader, transactionId: string): Promise<string | undefined> => {
  for (let attempt = 1; ; attempt++) {
    const found = await chain.getTransaction(transactionId);
    if (found !== undefined || attempt >= 20) return found;
    await wait(500);
  }
};

/**
 * The phone's check of the creation (section 5.7): the transaction is the one the answer names, it creates the
 * identity as a valid controller in an Active state at epoch 0 and nothing else of its category, and the state
 * names this phone's controller key, the recoverer that answered, and the waiting period the phone was told.
 *
 * @returns the state, and what the creation paid to the phone's address
 * @throws SetUpError with the reason
 */
export const checkCreation = async (
  chain: ChainReader,
  answer: SetUpAnswer,
  expected: { ownerKeyHash: Uint8Array; challengeDelay: ChallengeDelay; viewingKey: SeedKeys['viewingKey']; firstAddress: number },
): Promise<{ state: ControllerState; startingSatoshis: bigint }> => {
  const text = await transactionOf(chain, answer.creationTransactionId);
  if (text === undefined) throw new SetUpError('The network does not have the transaction that is to have created your wallet.');
  const encoded = hexToBin(text);
  const transaction = decodeTransactionBch(encoded);
  if (typeof transaction === 'string' || hex(hashTransactionUiOrder(encoded)) !== answer.creationTransactionId) throw new SetUpError('The server gave something else in place of the transaction that created your wallet.');
  let state: ControllerState;
  try {
    state = validateGenesis(transaction, hexToBin(answer.creationTransactionId), hexToBin(answer.identity)).state;
  } catch (error) {
    if (error instanceof IdentityValidationError) throw new SetUpError(`The wallet was not created as a wallet must be: ${error.message}`);
    throw error;
  }
  if (hex(state.ownerKeyHash) !== hex(expected.ownerKeyHash)) throw new SetUpError('The wallet that was created names another owner than this phone.');
  if (hex(state.recovererKeyHash) !== answer.recoveryKeyHash) throw new SetUpError('The wallet that was created names another recoverer than the one that answered.');
  if (!sameDelay(state.challengeDelay, expected.challengeDelay)) throw new SetUpError('The wallet that was created has another waiting period than the one you were told.');
  const ours = hex(walletAddress(hexToBin(answer.identity), expected.viewingKey, ADDRESS_KIND.change, expected.firstAddress).lockingBytecode);
  const startingSatoshis = transaction.outputs.filter((output) => hex(output.lockingBytecode) === ours && output.token === undefined).reduce((sum, output) => sum + output.valueSatoshis, 0n);
  return { state, startingSatoshis };
};

/**
 * The phone opens the wallet its recoverer created (section 7.9), after checking the creation itself. It is in use
 * at once; nothing waits for a block. Recovery shows as on once the recoverer's receipt for the request is found on
 * the stores (`checkRecovery`), which the recoverer leaves before it answers.
 *
 * @param options.state - what the phone kept from an earlier set-up that did not hold
 * @throws SetUpError when the creation is not the one the phone asked for
 */
export const finishSetUp = async (options: {
  answer: SetUpAnswer;
  pending: PendingSetUp;
  seed: Pick<SeedKeys, 'network' | 'viewingKey' | 'controllerKey'>;
  backend: WalletBackend;
  chain: ChainReader;
  state?: OwnerWalletState;
  save?: (state: OwnerWalletState) => void;
  feeRate?: number;
}): Promise<{ wallet: OwnerWallet; arrangement: RecoveryArrangement; startingSatoshis: bigint }> => {
  const { answer, pending, seed } = options;
  const checked = await checkCreation(options.chain, answer, { ownerKeyHash: seed.controllerKey.keyHash, challengeDelay: pending.challengeDelay, viewingKey: seed.viewingKey, firstAddress: pending.firstAddress });
  const wallet = await OwnerWallet.enrolled({
    backend: options.backend,
    chain: options.chain,
    seed,
    identity: answer.identity,
    creationTransactionId: answer.creationTransactionId,
    firstCoinNumber: pending.firstAddress,
    ...(options.state === undefined ? {} : { state: options.state }),
    ...(options.save === undefined ? {} : { save: options.save }),
    ...(options.feeRate === undefined ? {} : { feeRate: options.feeRate }),
  });
  return {
    wallet,
    arrangement: {
      archive: pending.archive,
      creationTransactionId: answer.creationTransactionId,
      earlierArchives: [],
      earlierViewingKeyRecords: [],
      sent: { messageHash: pending.requestHash, viewingKeyRecordHash: pending.viewingKeyRecordHash, recoveryKeyHash: answer.recoveryKeyHash, ownerKeyHash: hex(seed.controllerKey.keyHash) },
    },
    startingSatoshis: checked.startingSatoshis,
  };
};

// ------------------------------------------------------------------ the recoverer

/**
 * Open a phone's request with the recoverer's encryption key and read it.
 * @throws EnrollmentError if it is not for this key, was altered, or does not hold together
 */
export const openSetUpRequest = async (sealed: Uint8Array, privateKey: Uint8Array, network: SeedKeys['network']): Promise<ReadEnrollmentRequest> =>
  readEnrollmentRequest(await openPackage(sealed, privateKey), network);

/** The recoverer will not create the wallet asked for, with a reason the phone is told. */
export class SetUpRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SetUpRefusal';
  }
}

/**
 * The recoverer's own check of its creation against the chain, as of any kit (section 9.5). A server lists a
 * transaction it has just taken a moment later while it already gives it out, so a history without the creation
 * is read again, every half second for up to ten seconds, before the kit is taken for one that does not hold.
 */
const checkedSoon = async (read: Parameters<typeof checkEnrollment>[0], chain: ChainReader): Promise<KeptKit> => {
  for (let attempt = 1; ; attempt++) {
    try {
      return (await checkEnrollment(read, chain)).kept;
    } catch (error) {
      if (!(error instanceof EnrollmentError) || !/not on chain as the message describes/.test(error.message) || attempt >= 20) throw error;
    }
    await wait(500);
  }
};

/**
 * Create the wallet a phone asked for, from the recoverer's own coins, or go on creating it (sections 7.9 and
 * 9.5). The creation is recorded before each transaction is sent (`save`), so that a request that arrives again,
 * after a reload on either side, goes on from where it stopped and never makes a second wallet. The kit is kept
 * (`keepKit`) before the receipt is left on the phone's stores: a receipt says that the kit is held.
 *
 * @param options.offer - what the recoverer offers now; a request for another waiting period is refused
 * @returns the answer for the phone, the kit, and the recovery key of this wallet
 * @throws SetUpRefusal, FundsMissingError, or an error of the network or the stores
 */
export const setUpForRequest = async (options: {
  read: ReadEnrollmentRequest;
  funds: RecovererFunds;
  chain: ChainReader;
  storeAt: StoreAt;
  offer: SetUpOffer;
  record: CreationRecord;
  save: (record: CreationRecord) => void | Promise<void>;
  reserved?: Set<string>;
  /** The recoverer's own name for the wallet. */
  label: string;
  madeAt: number;
  keepKit: (kept: KeptKit) => void | Promise<void>;
}): Promise<{ answer: SetUpAnswer; kept: KeptKit; recoveryKey: KeyPair }> => {
  const { read, offer } = options;
  const { request } = read;
  if (options.record.identity === undefined && !sameDelay(request.challengeDelay, offer.challengeDelay)) {
    throw new SetUpRefusal('The waiting period this phone was told is not the one the recoverer uses now. Scan the code again.');
  }
  const created = await options.funds.create({
    order: { network: request.network, ownerKeyHash: hexToBin(request.ownerKeyHash), viewingKey: read.viewingKey.viewingKey, firstAddress: request.firstAddress, challengeDelay: request.challengeDelay, startingSatoshis: offer.startingSatoshis },
    record: options.record,
    save: options.save,
    ...(options.reserved === undefined ? {} : { reserved: options.reserved }),
  });
  const kit = kitForRequest(read, {
    identity: created.identity,
    creationTransactionId: created.creationTransactionId,
    credentialWords: created.record.credentialWords,
    rules: { controller: CONTROLLER_STATE_VERSION, addressScheme: ADDRESS_SCHEME_VERSION, templates: kitTemplates() },
    recipient: options.label,
    madeAt: options.madeAt,
  });
  const checked = await checkedSoon(kit, options.chain);
  const { recoveryKey } = credentialKeys(created.record.credentialWords, request.network, kitTemplates());
  const { receipt, kept } = receiptFor(checked, recoveryKey);
  await options.keepKit(kept);
  await keepOnStores(request.archive, options.storeAt, 'receipt', receipt, 'the receipt');
  return { answer: { identity: created.identity, creationTransactionId: created.creationTransactionId, recoveryKeyHash: hex(recoveryKey.keyHash) }, kept, recoveryKey };
};

// ------------------------------------------------------------------ the recoverer's page

/** What the recoverer's page keeps about one phone's request, by the request's identifier. Plain data. */
export interface SetUpRecord {
  requestId: string;
  /** The sealed request, hex, so that the page can carry it on after a reload. */
  sealed: string;
  /** Unix seconds. */
  receivedAt: number;
  /** The recoverer's own name for the wallet. */
  label: string;
  /** A person has said yes, or the page sets wallets up without asking. */
  approved: boolean;
  creation: CreationRecord;
  /** The wallet, once created. The same answer goes to the phone however often it asks. */
  answer?: SetUpAnswer;
  /** Final: the request was refused, with the reason the phone is told. */
  refused?: string;
  /** Not final: what stopped the last attempt, for the recoverer's page. */
  problem?: string;
}

/** Where the page keeps its records; the page stores them in the browser, a test in memory. */
export interface SetUpRecords {
  get(requestId: string): SetUpRecord | undefined;
  set(record: SetUpRecord): void | Promise<void>;
  all(): SetUpRecord[];
}

/** What the page sends the phone about its request. */
export interface SetUpReply {
  status: 'received' | 'created' | 'refused';
  reason?: string;
  created?: SetUpAnswer;
}

/**
 * The recoverer's page answering phones that ask to have their wallet set up (proposal section 14.4). Every request
 * is kept by its identifier before anything is done for it, and every step of the creation is recorded before it is
 * sent, so that a request that arrives again (the phone sends it until it has its answer, after a reload too) is
 * answered from what is kept: with the same wallet once it exists, never with a second one. A page that was loaded
 * again carries on what it had begun ({@link resume}).
 *
 * A bank's page sets wallets up without asking (`automatic`); a friend's page asks first, and creates on one tap
 * ({@link approve}).
 */
export class SetUpDesk {
  private readonly busy = new Set<string>();

  constructor(
    private readonly options: {
      records: SetUpRecords;
      network: SeedKeys['network'];
      /** The recoverer's encryption key. */
      privateKey: Uint8Array;
      /** Send a reply to the phone, over the session the request came on. */
      reply: (requestId: string, reply: SetUpReply) => Promise<void>;
      /** Create the wallet and keep its kit: `setUpForRequest` with the page's funds, chain, stores and offer. */
      create: (read: ReadEnrollmentRequest, record: SetUpRecord, save: (creation: CreationRecord) => Promise<void>) => Promise<SetUpAnswer>;
      /** Whether to set wallets up without asking. Read at every request, so that a change of mode applies at once. */
      automatic: () => boolean;
      /** The recoverer's name, for what the phone is told. */
      name: () => string;
      /** The label of a request that arrives, as the page has it at that moment. */
      label?: () => string;
      onChange?: () => void;
    },
  ) {}

  private async store(record: SetUpRecord): Promise<void> {
    await this.options.records.set(record);
    this.options.onChange?.();
  }

  /** A request arrived over the session, for the first time or again. */
  async received(requestId: string, sealed: Uint8Array): Promise<void> {
    const known = this.options.records.get(requestId);
    if (known?.answer !== undefined) return this.options.reply(requestId, { status: 'created', created: known.answer });
    if (known?.refused !== undefined) return this.options.reply(requestId, { status: 'refused', reason: known.refused });
    if (known === undefined) {
      try {
        await openSetUpRequest(sealed, this.options.privateKey, this.options.network);
      } catch (error) {
        return this.options.reply(requestId, { status: 'refused', reason: `The request could not be read: ${(error as Error).message}` });
      }
      await this.store({ requestId, sealed: hex(sealed), receivedAt: Math.floor(Date.now() / 1000), label: this.options.label?.() ?? '', approved: this.options.automatic(), creation: { credentialWords: generateBip39Mnemonic() } });
    }
    await this.options.reply(requestId, { status: 'received' });
    const record = this.options.records.get(requestId) as SetUpRecord;
    if (record.approved || this.options.automatic()) await this.carryOut(requestId);
  }

  /** A person said yes to a request: the wallet is created now. */
  async approve(requestId: string, label?: string): Promise<void> {
    const record = this.options.records.get(requestId);
    if (record === undefined || record.answer !== undefined || record.refused !== undefined) return;
    await this.store({ ...record, approved: true, ...(label === undefined ? {} : { label }) });
    await this.carryOut(requestId);
  }

  /** A person said no. The phone is told. */
  async decline(requestId: string, reason = 'The recoverer did not set the wallet up.'): Promise<void> {
    const record = this.options.records.get(requestId);
    if (record === undefined || record.answer !== undefined || record.creation.identity !== undefined) return;
    await this.store({ ...record, refused: reason });
    await this.options.reply(requestId, { status: 'refused', reason });
  }

  /** After the page is loaded again: carry on every request that was said yes to and is not done. */
  async resume(): Promise<void> {
    for (const record of this.options.records.all()) {
      if (record.answer === undefined && record.refused === undefined && record.approved && record.creation.identity !== undefined) await this.carryOut(record.requestId);
    }
  }

  /** Identities that other unfinished creations are named after, so that no other creation spends their coins. */
  reserved(except: string): Set<string> {
    return new Set(this.options.records.all().flatMap((record) => (record.requestId !== except && record.answer === undefined && record.creation.identity !== undefined ? [record.creation.identity] : [])));
  }

  private async carryOut(requestId: string): Promise<void> {
    if (this.busy.has(requestId)) return;
    this.busy.add(requestId);
    try {
      const first = this.options.records.get(requestId);
      if (first === undefined || first.answer !== undefined || first.refused !== undefined) return;
      const read = await openSetUpRequest(hexToBin(first.sealed), this.options.privateKey, this.options.network);
      const { problem: _earlier, ...clean } = first;
      await this.store(clean);
      let answer: SetUpAnswer;
      try {
        answer = await this.options.create(read, clean, async (creation) => {
          const current = this.options.records.get(requestId) ?? clean;
          await this.store({ ...current, creation });
        });
      } catch (error) {
        const current = this.options.records.get(requestId) ?? clean;
        if (error instanceof SetUpRefusal) {
          await this.store({ ...current, refused: error.message });
          await this.options.reply(requestId, { status: 'refused', reason: error.message });
          return;
        }
        // Not final: the recoverer can add coins, or the network or a store can come back; a request that arrives
        // again is tried again.
        await this.store({ ...current, problem: (error as Error).message });
        const name = this.options.name() || 'Your helper';
        const reason = error instanceof FundsMissingError ? `${name} cannot set up a wallet just now: their balance is too low. Ask them to add coins, then try again.` : `${name}'s page could not set the wallet up just now. Try again in a moment.`;
        await this.options.reply(requestId, { status: 'refused', reason });
        return;
      }
      const current = this.options.records.get(requestId) ?? clean;
      await this.store({ ...current, answer });
      await this.options.reply(requestId, { status: 'created', created: answer });
    } finally {
      this.busy.delete(requestId);
    }
  }
}
